# Plan de Déploiement EduKraft v1 — Budget Zéro

> **Objectif** : App téléchargeable sur téléphone Android, backend hébergé
> gratuitement, sync offline-first fonctionnelle, auth opérationnelle.
> **Budget** : 0 FCFA (tout gratuit)

---

## Architecture

```
Téléphone Android
├── APK téléchargé depuis getech.tg (ou Play Store plus tard)
├── SQLite local (offline-first)
└── Sync vers backend quand online
        │
        ▼
Backend Fly.io (gratuit, volume persistant)
├── Express API (auth + sync + gamification + badges)
├── SQLite persistant (/data/edukraft.db)
└── URL : https://edukraft-api.fly.dev
        │
        ▼
Polygon Amoy (testnet gratuit)
└── Smart contract EduKraftBadge (badges NFT)
```

---

## PHASE 1 — Backend sur Fly.io (gratuit, ~30 min)

Fly.io offre : 3 VMs gratuites, 256MB RAM, 3GB stockage persistant.
C'est suffisant pour EduKraft (SQLite + Express, ~1000 utilisateurs).

### Tâche 1.1 — Créer un compte Fly.io
1. Aller sur https://fly.io/app/sign-up
2. S'inscrire avec GitHub (ou email)
3. Installer flyctl (CLI) :
   ```powershell
   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex
   ```
4. Se connecter :
   ```powershell
   flyctl auth login
   ```

### Tâche 1.2 — Préparer le .env de production
```powershell
cd C:\edukraft-1\server
copy .env.production.example .env
```
Éditer `.env` :
- `JWT_SECRET` : générer avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `API_KEY` : générer avec `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
- `PUBLIC_URL=https://edukraft-api.fly.dev`

### Tâche 1.3 — Déployer sur Fly.io
```powershell
cd C:\edukraft-1\server
flyctl deploy
```
Fly.io va :
1. Construire l'image Docker (Dockerfile déjà créé)
2. Créer la VM
3. Créer le volume persistant `/data`
4. Démarrer le serveur

### Tâche 1.4 — Configurer les secrets
```powershell
# Définir les variables d'environnement (secrets, non visibles dans le code)
flyctl secrets set JWT_SECRET=votre_secret_genere
flyctl secrets set API_KEY=votre_api_key_genere
flyctl secrets set PAYMENT_WEBHOOK_SECRET=votre_webhook_secret
```

### Tâche 1.5 — Vérifier le backend
```powershell
curl https://edukraft-api.fly.dev/api/health
# Doit renvoyer : {"success":true,"data":{"status":"ok",...}}
```

### Tâche 1.6 — Créer le volume persistant (si pas auto-créé)
```powershell
flyctl volumes create edukraft_data --region cdg --size 1
flyctl deploy
```

---

## PHASE 2 — Build APK via EAS (gratuit, ~20 min)

EAS Build (Expo Application Services) offre 30 builds gratuits par mois.

### Tâche 2.1 — Créer un compte Expo
1. Aller sur https://expo.dev/signup
2. Créer un compte gratuit

### Tâche 2.2 — Configurer eas.json pour la production
Le fichier `eas.json` existe déjà. Vérifier que le profil `preview` contient :
```json
{
  "preview": {
    "distribution": "internal",
    "android": {
      "buildType": "apk",
      "gradleCommand": ":app:assembleRelease"
    },
    "env": {
      "EXPO_PUBLIC_API_URL": "https://edukraft-api.fly.dev",
      "EXPO_PUBLIC_API_KEY": "votre_api_key",
      "EXPO_PUBLIC_PHONE_OTP_ENABLED": "true"
    }
  }
}
```

### Tâche 2.3 — Configurer les variables d'environnement
Dans `eas.json`, remplacer les valeurs par :
- `EXPO_PUBLIC_API_URL` = URL Fly.io (ex: `https://edukraft-api.fly.dev`)
- `EXPO_PUBLIC_API_KEY` = la même `API_KEY` que le backend
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` = (voir Phase 4)
- `EXPO_PUBLIC_PHONE_OTP_ENABLED` = `true`

### Tâche 2.4 — Installer EAS CLI et se connecter
```powershell
npm install -g eas-cli
eas login
```

### Tâche 2.5 — Build l'APK
```powershell
cd C:\edukraft-1
eas build --profile preview --platform android
```
- Durée : ~10-15 min (build sur les serveurs Expo)
- Résultat : URL de téléchargement de l'APK
- L'APK est installable sur n'importe quel téléphone Android

### Tâche 2.6 — Télécharger l'APK
```powershell
eas build:list --platform android --status finished
# Copier l'URL de download
```
Ou télécharger directement depuis https://expo.dev/accounts/[votre-compte]/projects/edukraft/builds

---

## PHASE 3 — Distribution APK (gratuit, ~15 min)

### Tâche 3.1 — Héberger l'APK sur GitHub Releases
1. Sur GitHub, aller dans https://github.com/koffi-13/edukraft/releases
2. Cliquer "Draft a new release"
3. Tag : `v1.0.0`
4. Title : `EduKraft v1.0 — Première version`
5. Glisser-déposer le fichier APK (jusqu'à 2 Go gratuit)
6. Publier

### Tâche 3.2 — Lien de téléchargement direct
L'URL sera :
```
https://github.com/koffi-13/edukraft/releases/download/v1.0.0/edukraft-v1.0.0.apk
```

### Tâche 3.3 — Page de téléchargement sur getech.tg
Ajouter sur le site GeTech un bouton de téléchargement :
```html
<a href="https://github.com/koffi-13/edukraft/releases/download/v1.0.0/edukraft-v1.0.0.apk"
   download>
  📲 Télécharger EduKraft (Android)
</a>
```

### Tâche 3.4 — QR code pour le téléchargement
Générer un QR code (gratuit sur https://qrcode-monkey.com) pointant vers
l'URL de l'APK. Afficher ce QR code sur :
- Le site GeTech
- Les flyers / affiches
- Les formations en présentiel

### Tâche 3.5 — Instructions d'installation (à inclure sur le site)
```
1. Téléchargez le fichier APK en cliquant sur le bouton ci-dessus.
2. Ouvrez le fichier téléchargé sur votre téléphone.
3. Si demandé, autorisez "Installer depuis des sources inconnues"
   (Paramètres > Sécurité).
4. Ouvrez l'application EduKraft.
5. Créez un compte ou utilisez "Continuer sans compte".
```

---

## PHASE 4 — Configuration Auth (gratuit, ~30 min)

### Tâche 4.1 — Email + Mot de passe (déjà fonctionnel)
Aucune configuration nécessaire. Fonctionne out-of-the-box.

### Tâche 4.2 — Google OAuth (gratuit)
1. Aller sur https://console.cloud.google.com/
2. Créer un projet "EduKraft"
3. Activer "Google+ API" et "Google Identity"
4. Créer des identifiants OAuth 2.0 :
   - Type : Application Web
   - Origines autorisées : `https://edukraft-api.fly.dev`
   - URI de redirection : `https://auth.expo.io/@votre-compte/edukraft`
5. Copier le `Client ID` dans :
   - Backend `.env` : `GOOGLE_CLIENT_ID=...`
   - Client `eas.json` : `EXPO_PUBLIC_GOOGLE_CLIENT_ID=...`
6. Redéployer le backend : `flyctl deploy`

### Tâche 4.3 — Phone OTP (mode gratuit)
En v1 gratuite, garder le mode mock :
- `OTP_MOCK_CODE=123456` dans le `.env` backend
- Le code `123456` est accepté pour n'importe quel numéro
- Afficher le code dans les logs serveur : `flyctl logs`
- Côté client, afficher un message "Code de test : 123456"

Plus tard (avec budget) : intégrer Twilio ($15 crédit gratuit) ou Vonage.

### Tâche 4.4 — Facebook OAuth (gratuit, optionnel)
1. Aller sur https://developers.facebook.com/apps/
2. Créer une app "EduKraft"
3. Configurer Facebook Login
4. Ajouter l'URI de redirection Expo
5. Copier `APP_ID` dans `eas.json` : `EXPO_PUBLIC_FACEBOOK_APP_ID=...`

### Tâche 4.5 — Apple Sign-In (skip pour v1)
Nécessite un compte développeur Apple ($99/an). Skip pour v1.
L'auth email + Google + Phone suffit pour démarrer.

---

## PHASE 5 — Vérification Sync Offline-First (~15 min)

### Tâche 5.1 — Scénario de test offline
1. Ouvrir l'app sur le téléphone (avec réseau)
2. Créer un compte / se connecter
3. Couper le connexion (mode avion)
4. Compléter une leçon + quiz
5. Vérifier que l'XP et le streak sont mis à jour localement
6. Rallumer le réseau
7. Vérifier dans les logs backend que la sync s'effectue :
   ```powershell
   flyctl logs
   # Doit afficher : [Sync] X opération(s) synchronisée(s)
   ```

### Tâche 5.2 — Vérifier la persistance backend
```powershell
# Lister les learners en base
flyctl ssh console -C "node -e \"
  const db = require('better-sqlite3')('/data/edukraft.db');
  console.log(db.prepare('SELECT COUNT(*) as cnt FROM learner').get());
\""
```

### Tâche 5.3 — Corriger les erreurs de sync
Si erreurs dans les logs :
- `13 values for 14 columns` → déjà corrigé (commit d61240f)
- `certificate has expired` → vérifier la date du serveur
- `ECONNRESET` → normal en offline, retry automatique

---

## PHASE 6 — Play Store (optionnel, $25 unique)

Le Play Store nécessite un compte développeur Google à $25 (paiement unique,
à vie). Pas obligatoire pour v1 — l'APK peut être distribué directement.

### Tâche 6.1 — Créer un compte Google Play Console
1. Aller sur https://play.google.com/console
2. Payer les $25 (carte bancaire ou carte prépayée)
3. Remplir le profil développeur

### Tâche 6.2 — Build AAB (Play Store format)
```powershell
eas build --profile production --platform android
# Génère un .aab (Android App Bundle) au lieu d'APK
```

### Tâche 6.3 — Soumettre au Play Store
1. Sur Play Console → "Créer une application"
2. Renseigner : nom, description, icônes, captures d'écran
3. Téléverser l'AAB
4. Soumettre pour revue (24-72h)

---

## PHASE 7 — Web Demo (optionnel, gratuit)

### Tâche 7.1 — Build web
```powershell
cd C:\edukraft-1
npx expo export --platform web
# Génère dist/ avec le site web statique
```

### Tâche 7.2 — Héberger sur Vercel (gratuit)
```powershell
npm install -g vercel
cd dist
vercel --prod
```
URL : `https://edukraft.vercel.app` (ou similaire)

### Tâche 7.3 — Configurer le proxy API
Sur Vercel, configurer les rewrites :
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://edukraft-api.fly.dev/api/:path*" }
  ]
}
```

---

## Résumé des coûts

| Service | Coût | Usage |
|---------|------|-------|
| Fly.io (backend) | **0 FCFA** | Hébergement API + SQLite |
| EAS Build (APK) | **0 FCFA** | 30 builds/mois gratuits |
| GitHub Releases (APK) | **0 FCFA** | Hébergement APK (2 Go) |
| Google OAuth | **0 FCFA** | Authentification Google |
| Polygon Amoy (blockchain) | **0 FCFA** | Testnet gratuit |
| Vercel (web, optionnel) | **0 FCFA** | Hébergement web |
| **Play Store** | **~15 000 FCFA ($25)** | Optionnel, paiement unique |
| **Twilio (SMS)** | **~9 000 FCFA ($15)** | Optionnel, crédit gratuit initial |

**Total v1 sans Play Store : 0 FCFA**
**Total v1 avec Play Store : ~15 000 FCFA (paiement unique)**

---

## Checklist finale avant déploiement

- [ ] Backend déployé sur Fly.io et répond sur /api/health
- [ ] JWT_SECRET et API_KEY générés (pas les valeurs par défaut)
- [ ] APK build avec EAS et téléchargeable
- [ ] APK hébergé sur GitHub Releases
- [ ] Lien de téléchargement sur le site GeTech
- [ ] QR code généré
- [ ] Test offline-first réussi (leçon complétée hors ligne → sync au retour)
- [ ] Google OAuth configuré (optionnel mais recommandé)
- [ ] Code OTP mock = 123456 documenté pour les démos
- [ ] Volume persistant Fly.io vérifié (données surviven au redémarrage)
