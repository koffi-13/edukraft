# EduKraft Smart Contract — Déploiement

## Contrat : EduKraftBadge (ERC-721)

Chaque badge de certification est un NFT unique minté sur **Polygon PoS**.
Les métadonnées sont stockées on-chain (pas besoin d'IPFS pour le MVP).

## Déploiement sur Polygon Amoy (testnet)

### Prérequis
- Node.js >= 18
- [Foundry](https://book.getfoundry.sh/) (forge, cast, anvil)
- Un wallet avec du MATIC testnet (faucet : https://faucet.polygon.technology)

### Installation des dépendances OpenZeppelin
```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

### Configuration
```bash
export PRIVATE_KEY=0xvotre_clé_privée
export RPC_URL=https://rpc-amoy.polygon.technology
```

### Compilation
```bash
forge build
```

### Déploiement
```bash
forge create \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args \
  src/EduKraftBadge.sol:EduKraftBadge
```

### Post-déploiement
1. Copier l'adresse du contrat déployé
2. Configurer le minter (adresse du serveur backend) :
```bash
cast send $CONTRACT_ADDRESS \
  "setMinter(address)" $SERVER_WALLET_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Variables d'environnement du serveur
```env
POLYGON_MOCK_MODE=false
POLYGON_NETWORK=amoy
POLYGON_CONTRACT_ADDRESS=0x...
POLYGON_PRIVATE_KEY=0x...
```

## Coûts
- Gas par mint : ~80 000 – 120 000 gas
- Coût sur Polygon Amoy : ~0.0001 MATIC (essentiellement gratuit)
- Coût sur Polygon Mainnet : ~0.001 MATIC (~$0.0005)

## Passage en production (Polygon Mainnet)

1. Déployer le contrat sur mainnet
2. Envoyer ~1 MATIC au wallet du serveur pour les frais de gaz
3. Configurer `POLYGON_NETWORK=mainnet` et `POLYGON_CHAIN_ID=137`
4. Mettre à jour le RPC URL si nécessaire
5. Mettre `POLYGON_MOCK_MODE=false`
