// scripts/deploy.js
// Déploiement du contrat EduKraftBadge sur Polygon Amoy ou Mainnet
//
// Usage:
//   npx hardhat run scripts/deploy.js --network amoy
//   npx hardhat run scripts/deploy.js --network polygon
//
// Prérequis dans .env :
//   POLYGON_PRIVATE_KEY=0x...  (clé privée du minter)
//   POLYGON_RPC_URL=...        (optionnel, utilise le RPC public par défaut)
//   MINTER_ADDRESS=0x...       (optionnel, par défaut = l'adresse du déployeur)

const hre = require('hardhat');

async function main() {
  console.log('=== EduKraft Badge - Deploiement ===\n');

  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`Reseau      : ${network}`);
  console.log(`Deployeur   : ${deployer.address}`);
  console.log(`Solde       : ${hre.ethers.formatEther(balance)} MATIC`);
  console.log(`Block       : ${await hre.ethers.provider.getBlockNumber()}\n`);

  if (balance === 0n) {
    console.error('ERREUR: Le deployeur n\'a pas de MATIC.');
    console.error('Obtenez du MATIC testnet sur : https://faucet.polygon.technology');
    process.exit(1);
  }

  // Déploiement du contrat
  console.log('Deploiement d\'EduKraftBadge...');
  const EduKraftBadge = await hre.ethers.getContractFactory('EduKraftBadge');
  const contract = await EduKraftBadge.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`Contrat deploye : ${contractAddress}`);

  // Configurer le minter (par défaut = l'adresse du déployeur)
  // En production, le minter doit etre une adresse differente (serveur backend)
  const minterAddress = process.env.MINTER_ADDRESS || deployer.address;
  if (minterAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\nConfiguration du minter : ${minterAddress}`);
    const tx = await contract.setMinter(minterAddress);
    await tx.wait();
    console.log('Minter configure avec succes.');
  }

  // Vérification
  const owner = await contract.owner();
  const minter = await contract.minter();
  const totalSupply = await contract.totalSupply();

  console.log('\n=== Contrat deploye avec succes ===');
  console.log(`Adresse    : ${contractAddress}`);
  console.log(`Owner      : ${owner}`);
  console.log(`Minter     : ${minter}`);
  console.log(`TotalSupply: ${totalSupply.toString()}`);
  console.log(`Network    : ${network}`);
  console.log(`Block      : ${await hre.ethers.provider.getBlockNumber()}`);

  // Explorer URL
  const explorer = network === 'polygon'
    ? `https://polygonscan.com/address/${contractAddress}`
    : `https://amoy.polygonscan.com/address/${contractAddress}`;
  console.log(`Explorer   : ${explorer}`);

  // Variables d'environnement à configurer dans le serveur
  console.log('\n=== Variables a ajouter au .env du serveur ===');
  console.log(`POLYGON_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`POLYGON_NETWORK=${network === 'polygon' ? 'mainnet' : 'amoy'}`);
  console.log(`POLYGON_CHAIN_ID=${network === 'polygon' ? 137 : 80002}`);
  console.log(`POLYGON_MOCK_MODE=false`);
  console.log(`POLYGON_PRIVATE_KEY=0x... (clé privée du minter)`);

  // Exporter l'adresse pour les scripts suivants
  // Écrire dans un fichier .deployed
  const fs = require('fs');
  const deployed = {
    network,
    address: contractAddress,
    deployer: deployer.address,
    minter,
    blockNumber: await hre.ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    `.deployed-${network}.json`,
    JSON.stringify(deployed, null, 2)
  );
  console.log(`\nFichier de deploiement: .deployed-${network}.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nERREUR DE DEPLOIEMENT:', error);
    process.exit(1);
  });