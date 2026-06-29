// server/blockchain.js
// Module d'interaction avec le smart contract EduKraftBadge sur Polygon PoS
//
// Modes :
//   - MOCK (défaut) : simule un mint, retourne un faux tx hash
//   - TESTNET : Polygon Amoy Testnet (remplace Mumbai déprécié)
//   - MAINNET : Polygon PoS Mainnet
//
// Le serveur agit comme "minter" autorisé — seul le backend peut minter des badges.
// L'app mobile ne manipule jamais de clé privée ni de wallet.

const { ethers } = require('ethers');

// ── Configuration ────────────────────────────────────────────────────────────
const MOCK_MODE = process.env.POLYGON_MOCK_MODE !== 'false'; // mock par défaut
const POLYGON_NETWORK = (process.env.POLYGON_NETWORK || 'amoy').toLowerCase();

// RPC URLs — Mumbai est déprécié depuis 2024, Amoy le remplace
const RPC_URLS = {
  amoy:    'https://rpc-amoy.polygon.technology',
  mumbai:  'https://rpc-mumbai.maticvigil.com',          // legacy fallback
  mainnet: 'https://polygon-rpc.com',
};

const NETWORK_NAMES = {
  amoy:    'Polygon Amoy Testnet',
  mumbai:  'Polygon Mumbai (deprecated)',
  mainnet: 'Polygon PoS Mainnet',
};

const CHAIN_IDS = {
  amoy:    80002,
  mumbai:  80001,
  mainnet: 137,
};

const CONTRACT_ADDRESS = process.env.POLYGON_CONTRACT_ADDRESS || '';
const RPC_URL          = process.env.POLYGON_RPC_URL || RPC_URLS[POLYGON_NETWORK] || RPC_URLS.amoy;
const PRIVATE_KEY      = process.env.POLYGON_PRIVATE_KEY || '';

// ABI minimal pour les fonctions utilisées
const CONTRACT_ABI = [
  'function mintBadge(address to, string learnerName, string moduleName, uint8 score, uint16 xpEarned, string certHash) returns (uint256)',
  'function getBadge(uint256 tokenId) view returns (tuple(string learnerName, string moduleName, uint8 score, uint16 xpEarned, uint256 issuedAt, string certHash))',
  'function verifyCertHash(string certHash) view returns (uint256)',
  'function owner() view returns (address)',
  'function minter() view returns (address)',
  'function setMinter(address _minter)',
  'function totalSupply() view returns (uint256)',
];

// ── Provider & Signer ────────────────────────────────────────────────────────
let provider = null;
let signer   = null;
let contract = null;
let initialized = false;

/**
 * Initialise la connexion au réseau Polygon.
 * Appelé une seule fois au démarrage du serveur.
 */
function init() {
  if (initialized) return;
  initialized = true;

  if (MOCK_MODE) {
    console.log(`[Blockchain] Mode MOCK activé — pas de vraies transactions Polygon`);
    console.log(`[Blockchain] Réseau cible : ${NETWORK_NAMES[POLYGON_NETWORK] || POLYGON_NETWORK}`);
    return;
  }

  if (!PRIVATE_KEY) {
    console.warn('[Blockchain] POLYGON_PRIVATE_KEY non configuré — mode mock activé');
    return;
  }

  if (!CONTRACT_ADDRESS) {
    console.warn('[Blockchain] POLYGON_CONTRACT_ADDRESS non configuré — mode mock activé');
    return;
  }

  try {
    provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 10,
    });

    signer   = new ethers.Wallet(PRIVATE_KEY, provider);
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    console.log(`[Blockchain] Connecté à ${NETWORK_NAMES[POLYGON_NETWORK] || POLYGON_NETWORK}`);
    console.log(`[Blockchain] Minter : ${signer.address}`);
    console.log(`[Blockchain] Contrat: ${CONTRACT_ADDRESS}`);
  } catch (err) {
    console.error('[Blockchain] Erreur d\'initialisation:', err.message);
    provider = null;
    signer   = null;
    contract = null;
  }
}

// ── Mint un badge ────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/**
 * Mint un badge sur Polygon PoS
 * @param {Object} params
 * @param {string} params.walletAddress - Adresse du wallet de l'apprenant
 * @param {string} params.learnerName   - Nom de l'apprenant
 * @param {string} params.moduleTitle   - Titre du module
 * @param {number} params.score         - Score 0-1 (normalisé en 0-100 pour le contrat)
 * @param {number} params.xpTotal       - XP gagnés
 * @param {string} params.certHash      - Hash SHA-256 de certification
 * @returns {Promise<{txHash: string, tokenId: string, network: string, real: boolean}>}
 */
async function mintBadge({ walletAddress, learnerName, moduleTitle, score, xpTotal, certHash }) {
  // Mode mock : simule une transaction réussie
  if (!contract) {
    return _mockMint(learnerName);
  }

  // Mode production : vraie transaction Polygon avec retry
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Blockchain] Retry ${attempt}/${MAX_RETRIES} pour ${learnerName}...`);
        await _sleep(RETRY_DELAY_MS * attempt);
      }

      console.log(`[Blockchain] Minting badge pour ${learnerName} (attempt ${attempt + 1})...`);

      // Estimer le gaz avant d'envoyer
      const scorePercent = Math.min(Math.round(score * 100), 100);
      const gasEstimate = await contract.mintBadge.estimateGas(
        walletAddress || ethers.ZeroAddress,
        learnerName,
        moduleTitle,
        scorePercent,
        xpTotal,
        certHash,
      );

      // Ajouter 20% de marge au gaz estimé
      const gasLimit = (gasEstimate * 120n) / 100n;

      // Envoyer la transaction
      const tx = await contract.mintBadge(
        walletAddress || ethers.ZeroAddress,
        learnerName,
        moduleTitle,
        scorePercent,
        xpTotal,
        certHash,
        { gasLimit },
      );

      console.log(`[Blockchain] Tx envoyée : ${tx.hash}, gaz estimé : ${gasEstimate.toString()}`);

      // Attendre la confirmation (1 confirmation suffit sur Polygon)
      const receipt = await tx.wait(1);

      // Extraire le tokenId depuis l'événement BadgeMinted (indexed tokenId = logs[0].topics[1])
      let tokenId = 'unknown';
      try {
        // L'événement BadgeMinted(uint256 indexed tokenId, ...) → topics[1] = tokenId
        if (receipt.logs?.[0]?.topics?.[1]) {
          tokenId = BigInt(receipt.logs[0].topics[1]).toString();
        }
      } catch (_) {
        tokenId = `receipt_${receipt.hash.slice(0, 10)}`;
      }

      const networkName = NETWORK_NAMES[POLYGON_NETWORK] || 'polygon-pos';
      console.log(`[Blockchain] Badge minté ! tx: ${tx.hash}, tokenId: ${tokenId}, gaz: ${receipt.gasUsed.toString()}`);

      return {
        txHash:  tx.hash,
        tokenId: tokenId,
        network: networkName,
        real:    true,
      };
    } catch (err) {
      lastError = err;
      console.error(`[Blockchain] Échec attempt ${attempt + 1}:`, err.shortMessage || err.message);
    }
  }

  // Tous les retries ont échoué → fallback mock
  console.error('[Blockchain] Tous les retries ont échoué, fallback mock');
  const fallback = _mockMint(learnerName);
  fallback.error = lastError?.shortMessage || lastError?.message;
  fallback.network = `${NETWORK_NAMES[POLYGON_NETWORK] || 'polygon-pos'} (fallback)`;
  return fallback;
}

/**
 * Vérifie un badge sur la blockchain
 * @param {string} certHash - Le hash SHA-256 à vérifier
 * @returns {Promise<{found: boolean, tokenId?: string, network: string, data?: Object}>}
 */
async function verifyBadge(certHash) {
  if (!contract) {
    return { found: false, network: `${NETWORK_NAMES[POLYGON_NETWORK] || 'polygon'} (mock)` };
  }

  try {
    const tokenId = await contract.verifyCertHash(certHash);
    if (tokenId.toString() === '0') {
      return { found: false, network: NETWORK_NAMES[POLYGON_NETWORK] || 'polygon-pos' };
    }

    const badge = await contract.getBadge(tokenId);
    return {
      found: true,
      tokenId: tokenId.toString(),
      network: NETWORK_NAMES[POLYGON_NETWORK] || 'polygon-pos',
      data: {
        learnerName: badge.learnerName,
        moduleName:  badge.moduleName,
        score:       Number(badge.score),
        xpEarned:    Number(badge.xpEarned),
        issuedAt:    Number(badge.issuedAt),
        certHash:    badge.certHash,
      },
    };
  } catch (err) {
    return {
      found: false,
      network: NETWORK_NAMES[POLYGON_NETWORK] || 'polygon-pos',
      error: err.shortMessage || err.message,
    };
  }
}

/**
 * Retourne les infos de santé de la connexion blockchain
 */
async function getHealth() {
  if (!provider) {
    return {
      connected: false,
      network: POLYGON_NETWORK,
      mode: 'mock',
      contract: CONTRACT_ADDRESS || 'not deployed',
    };
  }

  try {
    const blockNumber = await provider.getBlockNumber();
    const balance = await provider.getBalance(signer.address);
    return {
      connected: true,
      network: POLYGON_NETWORK,
      networkName: NETWORK_NAMES[POLYGON_NETWORK],
      chainId: CHAIN_IDS[POLYGON_NETWORK],
      blockNumber,
      minterBalance: ethers.formatEther(balance),
      contract: CONTRACT_ADDRESS,
      mode: 'production',
    };
  } catch (err) {
    return {
      connected: false,
      network: POLYGON_NETWORK,
      error: err.shortMessage || err.message,
      mode: 'error',
    };
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

function _mockMint(learnerName) {
  const mockTxHash = '0x' + require('crypto').randomBytes(32).toString('hex');
  console.log(`[Blockchain/MOCK] Badge minté (simulé) pour ${learnerName}`);
  return {
    txHash:  mockTxHash,
    tokenId: `mock_${Date.now()}`,
    network: `${NETWORK_NAMES[POLYGON_NETWORK] || 'polygon'} (mock)`,
    real:    false,
  };
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { init, mintBadge, verifyBadge, getHealth, MOCK_MODE, POLYGON_NETWORK };
