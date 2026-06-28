// server/blockchain.js
// Module d'interaction avec le smart contract EduKraftBadge sur Polygon PoS
//
// En production : utilise ethers.js v6 pour signer et envoyer les transactions
// En développement (TESTNET_MOCK=true) : simule un mint et retourne un faux tx hash
//
// Le serveur agit comme "minter" autorisé — seul le backend peut minter des badges.
// L'app mobile ne manipule jamais de clé privée ni de wallet.

const { ethers } = require('ethers');

// ── Configuration ────────────────────────────────────────────────────────────
const TESTNET_MOCK = process.env.POLYGON_TESTNET_MOCK !== 'false'; // mock par défaut

// Ces variables doivent être configurées en production
const CONTRACT_ADDRESS = process.env.POLYGON_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
const RPC_URL          = process.env.POLYGON_RPC_URL || 'https://rpc-mumbai.maticvigil.com';
const PRIVATE_KEY      = process.env.POLYGON_PRIVATE_KEY || '';

// ABI minimal pour les fonctions qu'on utilise
const CONTRACT_ABI = [
  'function mintBadge(address to, string learnerName, string moduleName, uint8 score, uint16 xpEarned, string certHash) returns (uint256)',
  'function getBadge(uint256 tokenId) view returns (tuple(string learnerName, string moduleName, uint8 score, uint16 xpEarned, uint256 issuedAt, string certHash))',
  'function verifyCertHash(string certHash) view returns (uint256)',
  'function owner() view returns (address)',
  'function minter() view returns (address)',
];

// ── Provider & Signer ────────────────────────────────────────────────────────
let provider = null;
let signer = null;
let contract = null;

function init() {
  if (TESTNET_MOCK) {
    console.log('[Blockchain] Mode MOCK activé — pas de vraies transactions Polygon');
    return;
  }

  if (!PRIVATE_KEY) {
    console.warn('[Blockchain] POLYGON_PRIVATE_KEY non configuré — mode mock activé');
    return;
  }

  provider = new ethers.JsonRpcProvider(RPC_URL);
  signer = new ethers.Wallet(PRIVATE_KEY, provider);
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  console.log(`[Blockchain] Connecté à Polygon. Minter: ${signer.address}`);
}

// ── Mint un badge ────────────────────────────────────────────────────────────
/**
 * Mint un badge sur Polygon PoS
 * @param {Object} params
 * @param {string} params.walletAddress - Adresse du wallet de l'apprenant (ou adresse dérivée)
 * @param {string} params.learnerName   - Nom de l'apprenant
 * @param {string} params.moduleTitle   - Titre du module
 * @param {number} params.score         - Score 0-100
 * @param {number} params.xpTotal       - XP gagnés
 * @param {string} params.certHash      - Hash SHA-256 de certification
 * @returns {Promise<{txHash: string, tokenId: string, network: string}>}
 */
async function mintBadge({ walletAddress, learnerName, moduleTitle, score, xpTotal, certHash }) {
  // Mode mock : simule une transaction réussie
  if (!contract) {
    const mockTxHash = '0x' + require('crypto').randomBytes(32).toString('hex');
    console.log(`[Blockchain/MOCK] Badge minté (simulé) pour ${learnerName}`);
    return {
      txHash:  mockTxHash,
      tokenId: `mock_${Date.now()}`,
      network: 'polygon-mumbai (mock)',
      real:    false,
    };
  }

  // Mode production : vraie transaction Polygon
  try {
    console.log(`[Blockchain] Minting badge pour ${learnerName}...`);

    const tx = await contract.mintBadge(
      walletAddress || ethers.ZeroAddress,
      learnerName,
      moduleTitle,
      Math.min(Math.round(score * 100), 100),
      xpTotal,
      certHash,
    );

    const receipt = await tx.wait();
    const tokenId = receipt.logs?.[0]?.args?.[1]?.toString() || 'unknown';

    console.log(`[Blockchain] Badge minté ! tx: ${tx.hash}, tokenId: ${tokenId}, gaz: ${receipt.gasUsed.toString()}`);

    return {
      txHash:  tx.hash,
      tokenId: tokenId,
      network: 'polygon-pos',
      real:    true,
    };
  } catch (err) {
    console.error('[Blockchain] Échec du mint:', err.message);
    // Fallback : retourner un mock si la transaction échoue
    const mockTxHash = '0x' + require('crypto').randomBytes(32).toString('hex');
    return {
      txHash:  mockTxHash,
      tokenId: `fallback_${Date.now()}`,
      network: 'polygon-pos (fallback)',
      real:    false,
      error:   err.message,
    };
  }
}

/**
 * Vérifie un badge sur la blockchain
 * @param {string} certHash - Le hash SHA-256 à vérifier
 * @returns {Promise<{found: boolean, tokenId?: string, network: string}>}
 */
async function verifyBadge(certHash) {
  if (!contract) {
    // Mode mock : on simule une vérification
    return { found: false, network: 'polygon-mumbai (mock)' };
  }

  try {
    const tokenId = await contract.verifyCertHash(certHash);
    if (tokenId.toString() === '0') {
      return { found: false, network: 'polygon-pos' };
    }
    const badge = await contract.getBadge(tokenId);
    return {
      found: true,
      tokenId: tokenId.toString(),
      network: 'polygon-pos',
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
    return { found: false, network: 'polygon-pos', error: err.message };
  }
}

module.exports = { init, mintBadge, verifyBadge, TESTNET_MOCK };