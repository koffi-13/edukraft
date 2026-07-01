# Guide de déploiement EduKraft v1

Runbook consolidé pour passer du code à une v1 en production.
Couvre : backend, smart contract, build mobile, soumission Play Store.

---

## Sommaire
1. [Checklist pré-déploiement](#1-checklist-pré-déploiement)
2. [Déploiement du backend](#2-déploiement-du-backend)
3. [Déploiement du smart contract (Polygon Amoy)](#3-déploiement-du-smart-contract-polygon-amoy)
4. [Build de l'app mobile (EAS)](#4-build-de-lapp-mobile-eas)
5. [Soumission Play Store](#5-soumission-play-store)
6. [Variables d'environnement de production](#6-variables-denvironnement-de-production)
7. [Vérifications post-déploiement](#7-vérifications-post-déploiement)

---

## 1. Checklist pré-déploiement

Avant de commencer, vérifiez que vous avez :

- [ ] Node.js 20 LTS installé (recommandé pour Expo SDK 50 + better-sqlite3 précompilé)
- [ ] Compte GitHub avec accès en écriture au dépôt `koffi-13/edukraft`
- [ ] Compte Expo (gratuit sur expo.dev)
- [ ] Un wallet Polygon avec des MATIC de test sur Amoy (faucet)
- [ ] Compte développeur Google Play ($25, une seule fois)
- [ ] Les CI GitHub Actions au vert (push → onglet Actions)

```bash
# Vérifier l'état du code
git checkout feat/phase1-functional
git pull
git log --oneline -5   # doit montrer les commits récents

# Lancer les tests localement avant déploiement
cd server && JWT_SECRET=test API_KEY=dev-key OTP_MOCK_CODE=123456 PHONE_OTP_ENABLED=true POLYGON_MOCK_MODE=true PAYMENT_MOCK=true node test-e2e-selfcontained.js
cd ../contracts && npx hardhat test
cd ..
```

---

## 2. Déploiement du backend

Le backend (Express + SQLite) peut être déployé sur Railway, Render, Fly.io ou un VPS.

### Option A — Railway / Render / Fly.io (recommandé, le plus simple)

1. Connecter le dépôt GitHub à la plateforme.
2. Configurer :
   - **Root directory** : `server`
   - **Build command** : `npm install`
   - **Start command** : `npm start`
3. Ajouter les variables d'environnement (voir [section 6](#6-variables-denvironnement-de-production)).
4. Déployer. L'URL publique sera du type `https://edukraft-api.up.railway.app`.

### Option B — VPS (DigitalOcean / Hetzner)

```bash
# Sur le VPS, installer Node 20 + pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# Cloner et démarrer
git clone https://github.com/koffi-13/edukraft.git
cd edukraft/server
npm install --production
cp .env.example .env  # puis éditer avec les valeurs de prod (section 6)
pm2 start index.js --name edukraft-api
pm2 save
pm2 startup

# Configurer Nginx + Let's Encrypt pour HTTPS
sudo apt install nginx
# configurer le reverse proxy /api/* → localhost:3001
sudo certbot --nginx -d api.edukraft.tg
```

### Vérification backend

```bash
curl https://VOTRE_URL/api/health
# doit renvoyer {"success":true,"data":{"status":"ok",...}}

curl -X POST https://VOTRE_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@edukraft.tg","password":"123456","displayName":"Test"}'
# doit renvoyer un accessToken + refreshToken
```

---

## 3. Déploiement du smart contract (Polygon Amoy)

Le contrat `EduKraftBadge.sol` (ERC-721) certifie les badges on-chain. En v1, déployer sur le testnet Amoy (gratuit). La migration vers mainnet se fait en changeant une variable d'env.

### Étape 1 — Obtenir des MATIC de test sur Amoy

1. Créez un wallet MetaMask (si pas déjà fait).
2. Basculez sur le réseau Polygon Amoy (Chain ID 80002, RPC `https://rpc-amoy.polygon.technology`).
3. Obtenez des MATIC de test depuis un faucet :
   - https://faucet.polygon.technology/ (sélectionner Amoy)
   - ou https://www.alchemy.com/faucets/polygon-amoy

### Étape 2 — Configurer les variables

```bash
cd contracts
cp .env.example .env  # si n'existe pas, créer
```

Éditer `contracts/.env` :
```env
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_PRIVATE_KEY=0x...   # votre clé privée wallet (NE JAMAIS COMMITTER)
POLYGONSCAN_API_KEY=...      # optionnel, pour vérifier le contrat sur Polygonscan
```

### Étape 3 — Déployer

```bash
cd contracts
npm install
npm run deploy:amoy
```

Le script affiche l'adresse du contrat déployé et crée un fichier `.deployed-amoy.json`.

### Étape 4 — Renseigner l'adresse dans le backend

Copier l'adresse du contrat (ex: `0x1234...`) dans `server/.env` :
```env
POLYGON_MOCK_MODE=false
POLYGON_CONTRACT_ADDRESS=0x...   # l'adresse déployée
POLYGON_PRIVATE_KEY=0x...        # clé du wallet qui mint les badges
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
```

Redémarrer le backend. Vérifier :
```bash
curl https://VOTRE_URL/api/health
# blockchain.connected doit être true, blockchain.mode "real"
```

---

## 4. Build de l'app mobile (EAS)

### Configuration initiale

```bash
# Installer EAS CLI
npm install -g eas-cli

# Se connecter à Expo
eas login

# Initialiser le projet EAS (si pas déjà fait)
eas build:configure
```

### Variables d'environnement client

Vérifier `eas.json` — les profils `demo` et `production` injectent `EXPO_PUBLIC_API_URL` :
- `demo` → `https://demo.api.edukraft.tg`
- `production` → `https://api.edukraft.tg`

Adaptez ces URLs à votre backend déployé.

### Build APK (test interne)

```bash
eas build --profile demo --platform android
# Télécharge l'APK, installe-le sur un téléphone pour test
```

### Build AAB (production Play Store)

```bash
eas build --profile production --platform android
# Génère un Android App Bundle (.aab) pour le Play Store
```

---

## 5. Soumission Play Store

### Prérequis
- Compte développeur Google Play ($25, https://play.google.com/console)
- Service account JSON pour l'API Play Developer (voir doc Google)

### Étapes

1. Placer le fichier `google-service-account.json` à la racine du projet (référencé dans `eas.json`).
2. Soumettre l'AAB :
   ```bash
   eas submit --profile production --platform android
   ```
3. Sur la Play Console, renseigner :
   - Fiche de l'app (titre, description, icônes, captures d'écran)
   - Classification du contenu (questionnaire)
   - Prix (gratuit)
   - Pays disponibles (Togo + autres)
4. Soumettre pour revue (24-72h pour la première validation).

### Assets requis (à préparer)
- Icône 512×512 px
- Bannière Play Store 1024×500 px
- Captures d'écran (minimum 2, format téléphone)
- Splash screen 1242×2436 px

---

## 6. Variables d'environnement de production

### Backend (`server/.env`)

```env
# Serveur
PORT=3001
CORS_ORIGINS=https://app.edukraft.tg,https://edukraft.tg
DB_PATH=./data/edukraft.db

# Sécurité
API_KEY=<générer avec openssl rand -hex 16>
JWT_SECRET=<générer avec openssl rand -hex 32>   # ⚠️ OBLIGATOIRE, ne pas utiliser la valeur par défaut
JWT_EXPIRES=7d
REFRESH_EXPIRES=30d
BCRYPT_ROUNDS=10

# URL publique
PUBLIC_URL=https://api.edukraft.tg

# OAuth (voir docs OAuth Google/Facebook/Apple)
GOOGLE_CLIENT_ID=<votre client ID Google>
APPLE_BUNDLE_ID=com.edukraft.app
FACEBOOK_APP_ID=<votre app ID Facebook>

# Phone OTP
PHONE_OTP_ENABLED=true
OTP_MOCK_CODE=              # LAISSER VIDE en prod (sinon code fixe accepté)
# TWILIO_ACCOUNT_SID=...    # décommenter et remplir pour SMS réels
# TWILIO_AUTH_TOKEN=...
# TWILIO_PHONE_NUMBER=...

# Blockchain
POLYGON_MOCK_MODE=false
POLYGON_NETWORK=amoy
POLYGON_CONTRACT_ADDRESS=<adresse déployée section 3>
POLYGON_PRIVATE_KEY=<clé du wallet minter>
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology

# Paiements (obtenir credentials T-Money/Flooz — voir docs/PAYMENT_INTEGRATION_GUIDE.md)
PAYMENT_MOCK=false
PAYMENT_WEBHOOK_SECRET=<générer avec openssl rand -hex 16>
TMONEY_MERCHANT_ID=...
TMONEY_API_KEY=...
TMONEY_API_SECRET=...
FLOOZ_MERCHANT_ID=...
FLOOZ_API_KEY=...
FLOOZ_API_SECRET=...
```

### Client (EAS env vars dans `eas.json`)

```json
{
  "production": {
    "env": {
      "EXPO_PUBLIC_API_URL": "https://api.edukraft.tg",
      "EXPO_PUBLIC_API_KEY": "<même API_KEY que le backend>",
      "EXPO_PUBLIC_GOOGLE_CLIENT_ID": "<votre client ID Google OAuth>",
      "EXPO_PUBLIC_FACEBOOK_APP_ID": "<votre app ID Facebook>",
      "EXPO_PUBLIC_PHONE_OTP_ENABLED": "true"
    }
  }
}
```

---

## 7. Vérifications post-déploiement

### Backend
- [ ] `GET /api/health` → `status: ok`, `blockchain.connected: true`, `payment_mock: false`
- [ ] `POST /api/auth/register` → crée un user + tokens
- [ ] `POST /api/auth/login` → renvoie tokens
- [ ] `POST /api/sync` → batch sync fonctionne
- [ ] `GET /api/gamification/achievements` → 12 succès
- [ ] Aucune erreur dans les logs serveur

### App mobile
- [ ] L'app démarre sur Expo Go SDK 50 (téléphone)
- [ ] Login email fonctionne
- [ ] Login SMS reçoit un vrai OTP (pas 123456)
- [ ] Le Dashboard affiche les 8 modules
- [ ] Un quiz complété déclenche la célébration + débloque un succès
- [ ] La sync hors-ligne fonctionne (coupez le réseau, terminez une leçon, reconnectez)
- [ ] Un badge minté apparaît avec un tx hash Polygon (vérifiable sur amoy.polygonscan.com)

### Blockchain
- [ ] Le contrat est visible sur https://www.oklink.com/amoy/address/VOTRE_ADRESSE
- [ ] Un badge minté a une transaction valide
- [ ] `verifyCertHash` retourne le bon tokenId

---

## Rollback

### Backend
- Railway/Render : déployer un commit précédent via l'interface.
- VPS : `git checkout <commit> && pm2 restart edukraft-api`.

### Smart contract
- Le contrat est immutable. En cas de bug critique, déployer une nouvelle version et mettre à jour `POLYGON_CONTRACT_ADDRESS`. Les badges déjà mintés restent sur l'ancien contrat (communiquer aux utilisateurs).

### App mobile
- Play Console → Production → Roll back to previous release.

---

## Support

- Guide de lancement dev : `docs/LAUNCH-GUIDE.md`
- Guide d'intégration paiements : `docs/PAYMENT_INTEGRATION_GUIDE.md`
- README général : `README.md`
- Issues : https://github.com/koffi-13/edukraft/issues
