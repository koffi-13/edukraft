# EduKraft - Plan de deploiement v1

> Version: 1.1.0 (branche `feat/phase1-functional`, post-audit correctif)
> Date: 2025
> Statut: pret pour build APK de recette (profil EAS `preview`)

---

## 1. Checklist finale des fonctionnalites

### Cœur (offline-first) - VALIDE
- [x] **Persistance du learner** : SQLite (expo-sqlite) + double stockage AsyncStorage (`ek_learner`, `ek_progress`, `ek_badges`). Au demarrage : SQLite d'abord, puis AsyncStorage, avec **reinsertion automatique en SQLite** si la table est vide (correctif critique v1.1).
- [x] **Redemarrage -> Dashboard direct** : le gating de navigation (`AppNavigator`) ne depend QUE du learner local. Aucune dependance aux tokens serveur.
- [x] **Flux onboarding reparé** : `OnboardingScreen` est desormais MONTE dans l'AuthStack ; Login/Register naviguent vers Onboarding apres succes auth OU "Continuer hors ligne" ; la creation du learner bascule automatiquement vers le Dashboard.
- [x] **Logout conservateur** : `logout()` efface les tokens serveur (SecureStore + AsyncStorage + memoire) mais ne touche NI `ek_learner` NI `ek_progress` NI `ek_badges`. L'utilisateur deconnecte reste sur son Dashboard en mode hors-ligne.
- [x] **Bouton "Retour" Onboarding** : texte ASCII pur ("Retour"), appele `logout()` puis revient a Login.
- [x] **Un compte local par telephone** : `learnerRepository.create()` est singleton (purge + insert). Le learner local est unique par appareil.
- [x] **XP / streaks / badges / achievements** : gamification v2 operationnelle hors ligne, file de sync differentielle (`sync_queue`).
- [x] **Profil etendu** : EditProfileScreen sauvegarde le telephone (avec prefixe pays), photo via expo-image-picker, tous les champs persistes via `updateProfile`.
- [x] **Timeouts fetch 30 s + retry** : authService (toutes routes auth) ET syncEngine (AbortController). Le premier appel reveille Render (15-30 s) sans bloquer l'app.

### Authentification
- [x] **Email + mot de passe** (register/login/refresh/logout) - operationnel contre le backend Render.
- [x] **Google OAuth** :
  - Client ID resolu : `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (EAS profil preview/production, .env local) + fallback code.
  - redirect_uri envoye a Google : `https://auth.expo.io/@orion-k/edukraft` (proxy HTTPS, refuse les custom schemes).
  - returnUrl d'`openAuthSessionAsync` : scheme natif `edukraft://` (la session se referme proprement sur APK standalone).
  - Web : redirection pleine page, retour par hash fragment `#id_token=...` gere au chargement.
  - **A FAIRE (console Google)** : verifier les redirect URIs autorises (section 4).
- [x] **Phone OTP** : actif si `EXPO_PUBLIC_PHONE_OTP_ENABLED=true` (profil preview). Code de dev retourne par le serveur en mode mock.
- [x] **Apple Sign-In** : bouton STRICTEMENT iOS (`Platform.OS === 'ios'` + module expo-apple-authentication). Masque sur Android/Web.
- [ ] **Facebook OAuth (DIFFERE v1.1.1)** : code client complet (WebBrowser.openAuthSessionAsync + endpoint `/api/auth/facebook` serveur pret). **Le bouton est desormais MASQUE proprement tant que `EXPO_PUBLIC_FACEBOOK_APP_ID` est vide** (aucune alerte, aucun crash) — il reaparaitra automatiquement des que l'App ID sera cree (developers.facebook.com) et renseigne dans `eas.json` (profils preview + production) et `.env`. Voir section 5.

### Securite UI
- [x] Purge Unicode : plus AUCUN emoji/fleche/coche dans les boutons et textes visibles (uniquement ASCII). Les diacritiques francais (e, e, a, c) et l'alphabet Ewe (D, f, open-o...) sont conserves : ce sont des lettres standard rendues par les polices systeme.
- [x] IDs locaux : generateur maison `makeId()` (pas de `uuid` -> pas de crash crypto.getRandomValues sur Hermes).

---

## 2. Installation de l'APK

### Option A - Build local (recommande pour la recette)
```powershell
# Prerequis : Node 18+, JDK 17, Android SDK (ANDROID_HOME defini)
cd C:\edukraft-1

npm install --legacy-peer-deps

# Generer le projet natif Android
npx expo prebuild --platform android --clean

# Injecter le keystore STABLE versionne (signature identique a chaque build,
# mises a jour sans desinstallation)
copy android-signing\edukraft-release.keystore android\app\debug.keystore

# Builder l'APK release (signe avec le keystore ci-dessus)
cd android
.\gradlew.bat assembleRelease
# ou assembleDebug pour test rapide
# Sortie : android\app\build\outputs\apk\release\app-release.apk
```

### Option B - Build GitHub Actions (Gradle DIRECT, sans EAS ni Android SDK local)
Le workflow `.github/workflows/build-release-apk.yml` a ete REECRIT en v1.1.1 :
il genere le projet natif (`expo prebuild --clean`), injecte le keystore stable
du depot, compile avec Gradle directement sur le runner GitHub et publie l'APK
dans une GitHub Release. **Aucun secret n'est requis** (plus de dependance
EXPO_TOKEN/EAS — la derniere soumission EAS du 2026-07-06 avait echoue).

1. Pousser la branche : `git push origin feat/phase1-functional`
2. Tagguer EXPLICITEMENT : `git tag -f v1.1.1 && git push origin v1.1.1`
   (NE PAS utiliser `git push --tags` : d'anciens tags locaux v1.1.0 a v1.7.0
   existent et declencheraient des builds obsoletes)
3. Suivre le build : onglet Actions du depot GitHub (~10-15 min)
4. L'APK est publie automatiquement dans https://github.com/koffi-13/edukraft/releases
   (+ artifact de secours telechargeable dans le detail du run)

> Signature : le keystore versionne `android-signing/edukraft-release.keystore`
> (PKCS12, alias `androiddebugkey`, mot de passe `android`) est PUBLIC par
> conception — convient a la distribution directe d'APK de test. Pour le Play
> Store, generer un keystore prive et le stocker dans les GitHub Secrets
> (voir android-signing/README.md).

### Option C - EAS CLI direct
```powershell
npx eas-cli build --platform android --profile preview
# -> APK téléchargeable sur la page EAS du projet
```

### Option D - Expo Go (test sans build)
```powershell
npx expo start
# Scanner le QR code avec Expo Go (Android/iOS)
```
Le `.env` local contient deja le Client ID Google, l'URL Render et l'OTP actif.

### Installation sur telephone
1. Copier `app-release.apk` sur le telephone (USB, WhatsApp, Drive...)
2. Parametres > Securite > Autoriser "Sources inconnues"
3. Ouvrir l'APK -> Installer
4. Premier lancement : Login (ou "Continuer hors ligne") -> Onboarding -> Dashboard
5. Fermer/rouvrir l'app : **Dashboard direct** (learner retrouve en SQLite/AsyncStorage)

---

## 3. Configuration backend Render

Service : https://edukraft-api.onrender.com (dossier `server/`)

Variables d'environnement Render (Dashboard > Service > Environment) :

| Variable | Valeur | Notes |
|---|---|---|
| `PORT` | 10000 (auto Render) | ne pas forcer |
| `NODE_ENV` | `production` | |
| `JWT_SECRET` | (long random) | rotation des access tokens |
| `REFRESH_SECRET` | (long random != JWT_SECRET) | rotation des refresh tokens |
| `API_KEY` | `dev-key` (ou valeur forte) | doit matcher `EXPO_PUBLIC_API_KEY` cote app |
| `PHONE_OTP_ENABLED` | `true` | active /api/auth/phone |
| `OTP_DEV_MODE` | `true` en recette | le serveur retourne le code (devCode) |
| `TWILIO_*` | (prod uniquement) | credentials SMS reels |
| `BLOCKCHAIN_RPC_URL` | `https://rpc-amoy.polygon.technology` | badges on-chain (Phase 3) |
| `BLOCKCHAIN_PRIVATE_KEY` | (seulement si mint reel) | NE JAMAIS committer |

Sante : `GET https://edukraft-api.onrender.com/api/health`

### Limites du free tier Render (IMPORTANT)
- **Le service s'endort apres ~15 min d'inactivite** : le premier appel prend 15-30 s. L'app gere ce cas (timeout 30 s + retry automatique), mais prevenir les testeurs.
- **Disque ephemere** : la base SQLite du serveur est REINITIALISEE a chaque redemarrage/deploiement (les comptes crees en recette disparaissent). C'est accepte en v1 car :
  - l'app fonctionne 100% offline apres le premier login ;
  - le learner local est la seule source de verite ;
  - la sync serveur est un backup de convenance, pas une dependance.
- 750 h/mois d'execution gratuites, CPU 0.1 - largement suffisant pour la recette.

---

## 4. Configuration Google OAuth

Client ID : `627774206464-ktg1e33crrdq398e6hiunvlg9pucf1j7.apps.googleusercontent.com`

Dans Google Cloud Console (https://console.cloud.google.com/apis/credentials) :

1. **Type de client** : "Application Web" (obligatoire - le proxy Expo est une URL HTTPS).
2. **Authorized redirect URIs** - il FAUT que ces entrees existent :
   - `https://auth.expo.io/@orion-k/edukraft`  <- proxy Expo Go + APK standalone
   - `https://auth.expo.io`  <- variante racine (certains comptes Expo l'utilisent)
   - (si test web local) `http://localhost:8081` et/ou l'origine hebergee
3. **Authorized JavaScript origins** : meme valeurs sans chemin.
4. **Consent screen** : ajouter les comptes de test tant que l'app est en "Testing".

> Le `@orion-k` du proxy correspond au compte Expo proprietaire du projet. Si le compte Expo reel est different (ex: `koffi-13`), remplacer dans Google Console ET dans `src/config/env.js` + `LoginScreen.js` + `RegisterScreen.js` (`OAUTH_PROXY_REDIRECT` / `EXPO_PROXY_REDIRECT`).

Erreur 400 `redirect_uri_mismatch` = une des URIs ci-dessus manque dans la console Google.

---

## 5. Facebook OAuth (DIFFERE - a terminer plus tard)

Etat v1.1.1 : le bouton Facebook est MASQUE proprement dans l'app tant que
l'App ID est vide (aucune alerte, aucun crash). Le flux complet (client +
serveur) est deja code et sera reactif automatiquement. Pour l'activer :

1. Creer l'app sur https://developers.facebook.com -> type "Consumer".
2. Produit "Facebook Login" -> Settings :
   - Valid OAuth Redirect URIs : `https://auth.expo.io/@orion-k/edukraft`
3. App ID -> renseigner :
   - `eas.json` : `EXPO_PUBLIC_FACEBOOK_APP_ID` (profils preview + production)
   - `.env` local : meme valeur
   - `app.json` > `extra` (optionnel)
4. Rebuild : le bouton reaparait automatiquement sur Login/Register, sans
   aucune autre modification de code.
   (Le flux client `handleFacebook` et le endpoint serveur `/api/auth/facebook`
   sont DEJA prets.)

## 6. Apple Sign-In

- Deja code (expo-apple-authentication), bouton iOS uniquement.
- Pour un build iOS : activer la capability Sign in with Apple dans l'Apple Developer account + `eas.json` profil iOS. Hors perimetre v1 Android.

---

## 7. Plan de migration vers Fly.io (donnees persistantes)

Pourquoi migrer : Render free tier = disque ephemere + sleep. Fly.io offre un volume persistant gratuit (3 Go) et une facturation a la seconde (~2-3 USD/mois pour une tiny machine).

Un `fly.toml` existe deja a la racine.

### Etapes
```bash
# 1. Installer flyctl : https://fly.io/docs/flyctl/install/
fly auth signup   # ou login

# 2. Creer l'app + le volume persistant
fly launch --no-deploy --name edukraft-api --region cdg   # Paris (proche Togo)
fly volumes create edukraft_data --size 3 --region cdg

# 3. Secrets (equivalents Render)
fly secrets set JWT_SECRET=... REFRESH_SECRET=... API_KEY=... \
  PHONE_OTP_ENABLED=true OTP_DEV_MODE=true NODE_ENV=production

# 4. Deployer (le Dockerfile est fourni)
fly deploy

# 5. Verifier
curl https://edukraft-api.fly.dev/api/health
```

### Montage du volume SQLite
Dans `fly.toml`, le montage est :
```toml
[[mounts]]
  source      = "edukraft_data"
  destination = "/data"
```
Et positionner cote serveur : `DB_PATH=/data/edukraft.db` (le server/index.js utilise `process.env.DB_PATH || './data/edukraft.db'` - verifier que le chemin du volume correspond).

### Bascule cote mobile
Une seule variable a changer, partout ou l'API est declaree :
- `eas.json` (profils preview/production) : `EXPO_PUBLIC_API_URL=https://edukraft-api.fly.dev`
- `.env` local
- Rien d'autre : l'app gere deja les timeouts, retries et le mode offline.

### Checklist post-migration
- [ ] Donnees de compte qui survivent aux deploiements (`fly deploy` ne perd plus la base)
- [ ] Cold start ~1-2 s (vs 15-30 s Render) : reduire le timeout client a 15 s si souhaite
- [ ] Sauvegarde du volume : `fly ssh sftp get /data/edukraft.db` (hebdomadaire)
- [ ] monitoring : `fly status`, `fly logs`

---

## 8. Tests de recette recommandes (avant publication APK)

1. **Premier lancement** : Login s'affiche -> "Continuer hors ligne" -> Onboarding -> creer profil -> Dashboard.
2. **Persistance** : tuer l'app completement -> rouvrir -> Dashboard DIRECT (pas d'Onboarding).
3. **Login email** : se connecter -> Onboarding PRE-REMPLI (nom/email du compte) -> Dashboard.
4. **Deconnexion** (Profil > Se deconnecter) -> reste sur Dashboard en hors-ligne, XP/badges conserves.
5. **Re-connexion** avec un autre compte -> Onboarding -> nouveau learner singleton (l'ancien est remplace localement).
6. **Google** : bouton G -> navigateur Google -> retour automatique dans l'app (verifier redirect URIs sinon erreur 400).
7. **Mode avion** : faire une lecon complete + quiz -> XP et streak s'incrementent -> raviver la connexion -> la sync se vide (profil > sync).
8. **Bouton Retour Onboarding** : revient a Login, caracteres ASCII propres partout.
9. **Photo de profil** : choisir une image galerie -> sauvegarde -> visible dans le Profil.
10. **Render endormi** : attendre 20 min -> login -> message d'attente puis succes (timeout+retry 30 s).

---

*Genere automatiquement apres l'audit complet v1.1 - voir worklog pour le detail des 15 constats et correctifs.*
