# Guide de lancement EduKraft sur Expo Go (sans JDK)

Ce guide vous permet de démarrer EduKraft sur votre téléphone via **Expo Go**, sans aucune contrainte de compatibilité JDK.

> **Pourquoi pas de JDK ?** Expo Go est une application pré-construite (disponible sur le Play Store) qui exécute directement le bundle JavaScript. Le JDK n'est nécessaire **que** pour compiler du code natif (`expo run:android`, build d'APK/AAB, dev client personnalisé). Avec Expo Go, vous contournez entièrement cette étape.

---

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation des dépendances](#2-installation-des-dépendances)
3. [Démarrage du backend](#3-démarrage-du-backend)
4. [Configuration de l'URL API pour le téléphone](#4-configuration-de-lurl-api-pour-le-téléphone)
5. [Démarrage de Metro + Expo Go](#5-démarrage-de-metro--expo-go)
6. [Accès depuis le téléphone](#6-accès-depuis-le-téléphone)
7. [Dépannage](#7-dépannage)

---

## 1. Prérequis

### Sur votre ordinateur (machine de développement)

| Logiciel | Version requise | Vérification |
|----------|-----------------|--------------|
| **Node.js** | 18, 20 ou 22 (LTS recommandé) | `node --version` |
| **npm** | ≥ 9 (inclus avec Node) | `npm --version` |
| **Git** | toute version récente | `git --version` |

> ⚠️ **Node 24+** fonctionne mais peut afficher des warnings non bloquants. Préférez Node 22 LTS si possible.

> ❌ **Vous n'avez PAS besoin de** : JDK, Java, Android Studio, Android SDK, Gradle, Xcode. C'est tout l'intérêt d'Expo Go.

### Sur votre téléphone

| Application | Source |
|-------------|--------|
| **Expo Go** | [Google Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) (Android) ou App Store (iOS) |

> Expo Go supporte Android 6+ et iOS 15+. L'application est gratuite.

### Réseau

- **L'ordinateur et le téléphone doivent être sur le même réseau WiFi** (mode LAN).
- Alternative si le WiFi est bloqué : mode tunnel (voir [section 5](#5-démarrage-de-metro--expo-go), plus lent).

---

## 2. Installation des dépendances

```bash
# 1. Cloner le dépôt (si pas déjà fait)
git clone https://github.com/koffi-13/edukraft.git
cd edukraft
git checkout feat/phase1-functional

# 2. Installer les dépendances du frontend
npm install --legacy-peer-deps
```

> ⚠️ **L'option `--legacy-peer-deps` est obligatoire.** Expo SDK 50 a des conflits de peer dependencies avec certaines versions de `react-dom`/`react-native-web`. Sans cette option, `npm install` échoue avec `ERESOLVE`.

### Vérification

```bash
ls node_modules/.bin/expo
# doit afficher : node_modules/.bin/expo
```

### (Optionnel) Installer les dépendances du backend

```bash
cd server
npm install
cd ..
```

---

## 3. Démarrage du backend

EduKraft a besoin du backend (authentification + sync + gamification). En développement, il tourne en local sur le port **3001**.

```bash
cd server

# 1. Créer le fichier .env à partir de l'exemple
cp .env.example .env

# 2. (Recommandé) Générer un JWT_SECRET fixe pour le développement
#    Sur Linux/Mac :
#    echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
#    Puis éditer .env pour remplacer la ligne JWT_SECRET existante.

# 3. Démarrer le serveur
npm run dev
```

### Vérification

Le serveur affiche au démarrage :

```
[DB] SQLite initialisé : ./data/edukraft.db
[AUTH] Tables user + refresh_token initialisées
[GAMIFICATION] Tables streak_log + achievement + daily_goal initialisées
  ┌─────────────────────────────────────┐
  │       EduKraft API v1.0.0           │
  │     http://localhost:3001          │
  └─────────────────────────────────────┘
```

Test rapide (dans un autre terminal) :

```bash
curl http://localhost:3001/api/health
# doit renvoyer {"success":true,"data":{"status":"ok",...}}
```

> 💡 Laissez ce terminal ouvert. Le backend doit tourner pendant toute la session de développement.

---

## 4. Configuration de l'URL API pour le téléphone

C'est l'étape la plus importante. Par défaut, l'app pointe vers `10.0.2.2:3001`, qui est l'adresse de l'**émulateur Android**, PAS du téléphone physique.

### Récupérer l'IP LAN de votre ordinateur

```bash
# Linux / Mac
ip addr show | grep "inet " | grep -v 127.0.0.1
# ou
hostname -I

# Windows (PowerShell)
ipconfig | findstr IPv4
```

Notez l'adresse qui ressemble à `192.168.x.x` ou `10.0.x.x`.

### Configurer la variable d'environnement

Créez un fichier `.env` à la racine du projet EduKraft (pas dans `server/`) :

```bash
# À la racine du projet edukraft/
cat > .env << 'EOF'
EXPO_PUBLIC_API_URL=http://VOTRE_IP_LAN:3001
EXPO_PUBLIC_API_KEY=dev-key
EXPO_PUBLIC_PHONE_OTP_ENABLED=true
EOF
```

Remplacez `VOTRE_IP_LAN` par l'adresse notée (ex: `192.168.1.42`).

**Exemple final :**

```env
EXPO_PUBLIC_API_URL=http://192.168.1.42:3001
EXPO_PUBLIC_API_KEY=dev-key
EXPO_PUBLIC_PHONE_OTP_ENABLED=true
```

> ⚠️ **Points critiques** :
> - L'URL doit commencer par `http://` (pas `https://`) en développement local.
> - **Aucun suffixe `/v1` ni `/api`** à la fin — l'app ajoute `/api/...` automatiquement.
> - Le téléphone et l'ordinateur doivent être sur le **même WiFi**.
> - Si votre pare-feu bloque le port 3001, autorisez-le (ou désactivez temporairement le pare-feu pour le test).

---

## 5. Démarrage de Metro + Expo Go

Depuis la racine du projet EduKraft :

```bash
npx expo start
```

Metro démarre et affiche un QR code dans le terminal :

```
» Metro waiting on http://localhost:8081
» Scan the QR code above with Expo Go (Android) or the Camera app (iOS)

› Press a to open Android emulator (ne pas utiliser — on vise Expo Go)
› Press r to reload the app
› Press j to open debugger
› Press ? to show all commands
```

### Deux modes de connexion

| Mode | Commande | Quand l'utiliser |
|------|----------|------------------|
| **LAN** (recommandé) | `npx expo start` | Téléphone et ordi sur même WiFi — rapide |
| **Tunnel** (plan B) | `npx expo start --tunnel` | WiFi bloqué/réstrictif — plus lent, nécessite un compte Expo |

> Le mode tunnel crée une URL publique (type `https://xxx.exp.direct`) qui contourne les restrictions réseau. Utile sur les réseaux d'entreprise ou campus. Inscrivez-vous gratuitement sur [expo.dev](https://expo.dev) si demandé.

---

## 6. Accès depuis le téléphone

### Sur Android

1. Ouvrez l'application **Expo Go** (installée depuis le Play Store).
2. Touchez **« Scan QR code »**.
3. Scannez le QR code affiché dans le terminal sur votre ordinateur.
4. L'app EduKraft se charge (premier chargement : ~15-20s, bundle de 3,5 Mo).

### Sur iOS

1. Ouvrez l'application **Caméra** native.
2. Pointez vers le QR code.
3. Une notification « Open in Expo Go » apparaît — touchez-la.
4. L'app se charge.

### Premier lancement

- L'écran de démarrage (splash violet « EduKraft ») s'affiche brièvement.
- Vous arrivez sur l'écran de **connexion** (LoginScreen).
- Vous pouvez :
  - Créer un compte (email + mot de passe)
  - Vous connecter par SMS (OTP code de test : `123456`)
  - **Continuer sans compte** (mode hors-ligne — l'app fonctionne sans backend)

### Vérifier que le backend est bien joint

Si vous voyez une erreur réseau au login/sync :
1. Vérifiez que le backend tourne (`curl http://VOTRE_IP_LAN:3001/api/health` depuis le téléphone si possible, ou depuis un autre ordi du réseau).
2. Vérifiez l'IP dans `.env` (section 4).
3. Vérifiez que téléphone et ordi sont sur le même WiFi.
4. Essayez le mode tunnel (section 5).

---

## 7. Dépannage

### `npm install` échoue avec ERESOLVE

```
npm error Conflicting peer dependency: react@18.3.1
```

**Solution** : utilisez `npm install --legacy-peer-deps` (cf. section 2).

### Le QR code ne se charge pas sur le téléphone

**Causes possibles** :
- Téléphone et ordi pas sur le même WiFi → connectez les deux au même réseau.
- Pare-feu de l'ordi bloque le port 8081 (Metro) → autorisez-le ou utilisez `--tunnel`.
- Réseau d'entreprise/campus restrictif → utilisez `npx expo start --tunnel`.

### Erreur « Network request failed » au login/sync

L'app ne peut pas joindre le backend. Vérifiez :

```bash
# Depuis le téléphone (navigateur) :
http://VOTRE_IP_LAN:3001/api/health
# doit renvoyer du JSON

# Si ça ne marche pas :
# 1. Vérifiez l'IP dans .env (EXPO_PUBLIC_API_URL)
# 2. Vérifiez que le backend tourne (terminal 2)
# 3. Vérifiez le pare-feu (autorisez le port 3001)
```

### Metro affiche « Unable to resolve module »

```bash
# Nettoyer le cache Metro
npx expo start --clear
# ou
rm -rf node_modules/.cache
npx expo start
```

### Warnings de compatibilité de versions au démarrage

```
The following packages should be updated for best compatibility...
expo-apple-authentication@6.4.2 - expected version: ~6.3.0
...
```

**Ces warnings sont non bloquants.** L'app fonctionne avec les versions installées. Pour les supprimer (optionnel) :

```bash
npx expo install --check --fix
npm install --legacy-peer-deps
```

> ⚠️ Ne lancez `--fix` que si l'app ne fonctionne pas — les versions plus récentes peuvent introduire des régressions.

### L'app se charge mais reste sur l'écran de splash

- Vérifiez la console Metro (terminal où tourne `npx expo start`) pour des erreurs rouges.
- Redémarrez Metro avec `--clear`.
- Si l'erreur persiste, essayez en mode dev : `npx expo start --dev`.

### Erreur « expo-sqlite » ou module natif

Expo Go supporte `expo-sqlite`, mais si vous voyez une erreur de module natif :
- Vérifiez que vous utilisez bien Expo Go (pas un dev client).
- En mode web (`npx expo start --web`), expo-sqlite n'est pas disponible — l'app bascule automatiquement en mode mémoire (fallback).

---

## Récapitulatif des commandes (raccourci)

```bash
# Terminal 1 — Backend
cd edukraft/server
cp .env.example .env      # une seule fois
npm install               # une seule fois
npm run dev

# Terminal 2 — Frontend / Metro
cd edukraft
npm install --legacy-peer-deps   # une seule fois
# Créer .env avec EXPO_PUBLIC_API_URL=http://VOTRE_IP:3001
npx expo start

# Téléphone — Expo Go → scanner le QR code
```

---

## Notes

- **Mode hors-ligne** : l'app fonctionne sans backend grâce au mode mémoire (SQLite fallback). Le bouton « Continuer sans compte » sur l'écran de login active ce mode. Les données sont locales et synchronisées quand le backend redevient accessible.
- **Pas de build natif** : pour générer un APK/AAB installable hors Expo Go, il faudra alors configurer un JDK (voir `eas build` dans la doc Expo). Mais pour le développement et les tests, Expo Go suffit entièrement.
- **OTP SMS en dev** : le code de test est `123456` (configuré dans `server/.env` via `OTP_MOCK_CODE`). Aucun SMS réel n'est envoyé.
