# 🔐 Sécurité EduKraft — Runbook opérationnel

> **Objectif** : corriger les 3 vulnérabilités identifiées (V1, V2, V3) et
> privatiser le code source SANS casser l'application mobile ni les liens de
> téléchargement de l'APK. Ce runbook est **100 % réalisable sans terminal** :
> uniquement l'interface GitHub (navigateur) et le dashboard Render.
>
> **Durée estimée : 30–45 minutes.** Respecter l'ordre des étapes 1 → 2 → 3 → 4
> (chaque étape prépare la suivante ; inverser §1 et §2 casserait les liens APK).

---

## 0. Situation (pourquoi ce runbook)

Audit du **13/09** — trois problèmes de sécurité actifs :

### V1 — L'API d'administration est ouverte avec la clé par défaut `dev-key`

L'API de production ne définit pas `ADMIN_KEY` sur Render. Or, sans `ADMIN_KEY`,
le serveur **retombe sur `API_KEY`** — qui vaut la valeur par défaut publique
`dev-key`. Conséquence : **n'importe qui peut lire TOUTE la base** (comptes,
emails, numéros de téléphone, progression, XP…) dans son navigateur :

```
https://edukraft-api.onrender.com/api/admin/dump?admin_key=dev-key
```

Cette URL renvoie actuellement **HTTP 200 avec le dump complet** (vérifié en
live le 13/09 : 6 users, 9 learners, 9 refresh tokens). Les routes exposées :

| Route | Ce qu'elle révèle |
|---|---|
| `GET /api/admin/dump?admin_key=dev-key` | Vue d'ensemble : users, learners, compteurs |
| `GET /api/admin/user?email=…&admin_key=dev-key` | Détail complet d'un compte par email |
| `GET /api/admin/user/:userId?admin_key=dev-key` | Détail complet d'un compte par id |

Le code livré avec ce runbook affiche désormais un **avertissement impossible
à rater en tête des logs Render** tant que la clé n'est pas configurée
(`warnInsecureDefaults()` dans `server/index.js`) — mais le vrai verrou est
l'étape 4 ci-dessous (définir `ADMIN_KEY` sur Render).

### V2 — La base SQLite de production est répliquée dans un dépôt PUBLIC

Le mécanisme de persistance (disque Render éphémère → snapshot GitHub) pousse
le fichier `edukraft.db` **complet** — données utilisateurs incluses — dans le
dépôt public `koffi-13/edukraft`, release **tag `db-backup`** (dernier upload
constaté : 13/09 12:37). Le dépôt devant devenir privé (voir §2), la réplication
doit être basculée vers un dépôt **privé dédié** (`koffi-13/edukraft-data`,
déjà créé, vide) — c'est l'objet de l'étape 4, qui contient un **piège de perte
de données** documenté.

### V3 — L'APK doit rester téléchargeable publiquement après privatisation

Les apprenants installent l'APK depuis les releases GitHub du dépôt principal.
Une fois le dépôt privé, ces liens cassent → il faut d'abord un **dépôt miroir
public** (`koffi-13/edukraft-releases`, étape 1). Le workflow
`.github/workflows/build-release-apk.yml` livré avec ce runbook republie
automatiquement chaque nouvelle release sur ce miroir (secret optionnel
`RELEASES_TOKEN`, étape 3).

---

## 1. Créer le dépôt miroir public (APK) — `koffi-13/edukraft-releases`

**Pourquoi en premier** : si le dépôt principal devient privé avant cela, les
liens de téléchargement des APK v1.1.1 → v1.1.17 cessent de fonctionner pour
tout le monde.

1. Sur GitHub : **New repository** → Owner `koffi-13`, nom
   **`edukraft-releases`**, Public, avec un README (ex. « Téléchargements
   publics de l'APK EduKraft »). Créer.
2. **Migrer les releases existantes** (v1.1.1 → v1.1.17) pour que les anciens
   liens de téléchargement continuent de fonctionner :
   - Ouvrir `https://github.com/koffi-13/edukraft/releases` ;
   - Pour chaque release **v1.1.1 → v1.1.17** : télécharger l'APK
     (`edukraft-vX.Y.Z.apk`) sur votre ordinateur ;
   - Sur `edukraft-releases` : **Releases → Draft a new release** →
     « Choose a tag » → taper le même tag (ex. `v1.1.17`) → « Create new tag
     on publish » → même titre (« EduKraft v1.1.17 ») → même description →
     **Attach files** : glisser l'APK téléchargé → **Publish release**.
3. Vérifier : `https://github.com/koffi-13/edukraft-releases/releases` liste
   toutes les versions et chaque APK se télécharge.

> Les futures releases seront republiées **automatiquement** par le workflow
> (étape 3 : secret `RELEASES_TOKEN`) — cette migration manuelle ne concerne
> que l'existant.

---

## 2. Privatiser le dépôt principal — `koffi-13/edukraft`

1. Sur `https://github.com/koffi-13/edukraft` : **Settings → General → tout en
   bas « Danger Zone » → Change repository visibility → Make private**.
2. Confirmer (taper le nom du dépôt).

**Effets — à connaître AVANT de cliquer :**

| Quoi | Impact | Pourquoi |
|---|---|---|
| **App mobile (API)** | ✅ **Aucun** | L'APK parle à `https://edukraft-api.onrender.com` (Render), pas à GitHub. Sync, connexion, progression : inchangés. |
| **CI GitHub Actions** | ✅ Continue de fonctionner | Les workflows tournent aussi sur les dépôts privés (quota de minutes gratuit partagé). |
| **Liens de téléchargement APK** | ⚠️ Cassés pour le public | D'où l'étape 1 d'abord — le miroir `edukraft-releases` prend le relais. |
| **Release `db-backup` (V2)** | ⚠️ Devient inaccessible SANS token | La réplication serveur utilise `GITHUB_DB_TOKEN` — bascule prévue à l'étape 4 vers le dépôt privé dédié. |
| **Clones/forks publics existants** | ℹ️ Restent en ligne | Un fork public déjà fait garde une copie du code (pas de la DB, elle vit dans les releases). À vérifier/effacer si besoin. |

---

## 3. Révoquer le PAT exposé + créer le token du miroir (`RELEASES_TOKEN`)

> 🚨 **Un Personal Access Token a été partagé en clair dans le chat à plusieurs
> reprises.** Il faut le considérer comme COMPROMIS et le révoquer, même s'il
> semble inactif.

### 3.1 Révoquer l'ancien PAT

1. GitHub → photo de profil → **Settings → Developer settings → Personal
   access tokens** (Tokens classic **et** Fine-grained tokens).
2. Identifier le token partagé → **Delete / Revoke**.

### 3.2 Créer un PAT fine-grained minimal (pour le workflow miroir)

1. **Settings → Developer settings → Fine-grained tokens → Generate new token** :
   - **Token name** : `edukraft-releases-mirror` ;
   - **Expiration** : 1 an (ou 90 jours + rappel) ;
   - **Repository access** : **Only select repositories** → cocher
     **`koffi-13/edukraft-releases`** uniquement (2-3 dépôts MAXIMUM — jamais
     « All repositories ») ;
   - **Permissions → Repository permissions → Contents : Read and write**
     (seule permission nécessaire pour publier une release ; tout le reste sur
     « No access »).
2. **Generate token** → copier la valeur (elle ne sera plus jamais affichée).

### 3.3 L'ajouter comme secret `RELEASES_TOKEN`

1. Sur `https://github.com/koffi-13/edukraft` (dépôt principal) :
   **Settings → Secrets and variables → Actions → New repository secret** ;
2. Name : **`RELEASES_TOKEN`** — Secret : la valeur copiée → **Add secret**.

> Le workflow APK (`.github/workflows/build-release-apk.yml`) publie désormais
> chaque release **aussi** sur `edukraft-releases` (step « Mirror release to
> public repo », activé par la présence du secret). Sans le secret, le
> comportement reste strictement celui d'avant — rien ne casse.

---

## 4. Render — clés fortes + bascule de la réplication DB vers `edukraft-data`

Sur **https://dashboard.render.com** → service `edukraft-api` → **Environment**.

### 4.1 (🚨 LIRE EN ENTIER AVANT DE TOUCHER À `GITHUB_DB_REPO` 🚨)

> ### 🚨 ORDRE CRITIQUE — PIÈGE DE PERTE DE DONNÉES
>
> Le serveur **restaure sa base depuis GitHub à chaque démarrage**
> (`restoreDbFromRemote`) et **écrase** le fichier local. Le dépôt privé dédié
> **`koffi-13/edukraft-data`** existe mais est **VIDE**.
>
> **Si vous changez `GITHUB_DB_REPO` vers `edukraft-data` AVANT d'y avoir
> téléversé la base actuelle, le serveur restaurera une base VIDE au prochain
> démarrage → PERTE TOTALE des comptes et des progressions.**
>
> Ordre obligatoire :
> 1. **Télécharger** `edukraft.db` depuis la release `db-backup` **actuelle**
>    (encore sur le dépôt PUBLIC `koffi-13/edukraft`, tag `db-backup`,
>    asset `edukraft.db`) ;
> 2. **Téléverser** ce fichier sur `koffi-13/edukraft-data` : Releases →
>    Draft a new release → tag **`db-backup`** → « Create new tag on publish » →
>    attacher le fichier **`edukraft.db`** → Publish ;
> 3. **Vérifier** que `https://github.com/koffi-13/edukraft-data/releases/tag/db-backup`
>    montre bien l'asset `edukraft.db` (téléchargeable) ;
> 4. **SEULEMENT APRÈS** : changer `GITHUB_DB_REPO` dans Render (§4.2) et
>    redéployer.

### 4.2 Variables à définir sur Render (Environment → Add)

| Variable | Valeur | Rôle |
|---|---|---|
| **`ADMIN_KEY`** | clé forte générée avec `openssl rand -hex 32` (voir ci-dessous) | Protège `/api/admin/*` (dump, user?email, user/:userId). **C'est le correctif de V1.** |
| **`GITHUB_DB_TOKEN`** | un PAT fine-grained avec accès à `koffi-13/edukraft-data` uniquement, permission **Contents : Read and write** | Authentifie l'upload/téléchargement du snapshot DB vers le dépôt PRIVÉ |
| **`GITHUB_DB_REPO`** | `koffi-13/edukraft-data` | Cible de la réplication (après le §4.1 !) |

**Générer une clé forte** (n'importe quelle machine avec OpenSSL, ou un
générateur de secrets en ligne de confiance) :

```
openssl rand -hex 32
```

→ 64 caractères hexadécimaux. Une clé par usage (ne PAS réutiliser `ADMIN_KEY`
comme `API_KEY`).

> 📌 `GITHUB_DB_TOKEN` peut être le MÊME fine-grained token que
> `RELEASES_TOKEN` **seulement si** son accès couvre les deux dépôts
> (`edukraft-releases` + `edukraft-data`) — plus simple : deux tokens dédiés,
> deux périmètres minimaux.
>
> 📌 **Bonus (après stabilisation)** : une fois la réplication basculée et
> vérifiée sur `edukraft-data`, supprimer la release `db-backup` du dépôt
> PUBLIC `koffi-13/edukraft` (les données utilisateurs n'ont plus à y vivre).

### 4.3 Redéployer

**Manual Deploy → Deploy latest commit** (le déploiement recharge
l'environnement). Au démarrage, le serveur doit **restaurer la base depuis
`edukraft-data`** et l'avertissement de sécurité doit avoir **disparu** des
logs (voir §5).

---

## 5. Vérifications (5 minutes, sans terminal)

| # | Vérification | Résultat attendu |
|---|---|---|
| 1 | Ouvrir `https://edukraft-api.onrender.com/api/admin/dump?admin_key=dev-key` dans le navigateur | **401** `{"success":false,"error":"Clé admin invalide"}` — la clé par défaut est morte |
| 2 | `curl -H "x-admin-key: <nouvelle ADMIN_KEY>" https://edukraft-api.onrender.com/api/admin/dump` (ou l'URL `?admin_key=<clé>` dans le navigateur) | **200** + dump — l'owner garde l'accès |
| 3 | Ouvrir l'app mobile installée (ou la web app), se connecter, faire une action | Connexion + sync OK — l'app parle à Render, pas à GitHub : rien n'a changé pour elle |
| 4 | **Panneau Admin** (dashboard de monitoring) → **Settings / Paramètres** | Mettre à jour la **clé admin** avec la nouvelle valeur (le panneau interroge `/api/admin/*` : l'ancienne `dev-key` ne marche plus) |
| 5 | `https://github.com/koffi-13/edukraft-releases` | Public, releases v1.1.1 → v1.1.17 présentes, APK téléchargeables |
| 6 | Logs Render (démarrage du service) | **Plus d'avertissement** « CLÉS PAR DÉFAUT ACTIVES » — le warning `warnInsecureDefaults()` s'est tu (silence = clés fortes) |
| 7 | `https://github.com/koffi-13/edukraft-data/releases/tag/db-backup` | Asset `edukraft.db` mis à jour au premier flush après la bascule (réplication vivante) |

---

## 6. Nettoyage des données (dump live du 13/09)

Analyse du dump de production du 13/09 (`/api/admin/dump` + `/api/admin/user`) :

### ✅ Compte réel à CONSERVER

- **`jonathaneasare12@gmail.com`** — 690 XP, 6/6 modules « completed »,
  badgés. C'est le seul compte d'apprenant réel.

### 🗑️ 7 comptes de TEST à supprimer

- `v1112.prod.test@gmail.com` (et variantes `v1112.prod…`)
- `photo.e2e.test@gmail.com` (et variantes `photo.e2e…`)
- `v1111@test.app`
- Comptes invités « Kofi » / « Yawo » (créés pour tester le flux invité)
- « Sammy » (test manuel)
- `+233257977651` (inscription OTP de test)

### 🤔 Cas limite — décision owner

- **Kwame AZIALE** — 340 XP, actif le 09/09. Peut être un vrai apprenant
  précoce OU un test. À décider par l'owner avant purge (le moindre doute →
  conserver).

### ♻️ 9 refresh tokens expirés

- Déjà **auto-purgés** : le serveur nettoie les tokens expirés au démarrage
  **et** toutes les heures (`cleanupExpiredTokens` dans `server/auth.js`).
  Rien à faire manuellement.

> ⚠️ **L'endpoint/script de suppression des comptes de test est À VENIR**
> (suppression user + learner + progressions + badges + tokens liés). En
> attendant : ne pas supprimer à la main dans la base — la réplication GitHub
> et les fusions d'orphelins rendraient l'opération fragile. Le dump admin
> reste le seul outil d'inspection.

---

## 7. Prochaines étapes (après ce runbook)

1. **Play Store** : remplacer le keystore de test versionné
   (`android-signing/edukraft-release.keystore`, mot de passe `android`) par un
   keystore PRIVÉ avant toute publication — le keystore actuel est public par
   construction.
2. **OTA (mises à jour sans réinstaller)** : suivre
   [`docs/OTA-EXPO-UPDATES.md`](./OTA-EXPO-UPDATES.md) — expo-updates + EAS.
3. **Rotation de `JWT_SECRET`** (Render) : ⚠️ effet de bord = **déconnexion
   globale** de tous les utilisateurs (tokens invalidés) — à faire à une heure
   creuse, jamais en même temps qu'un autre changement.
4. **`API_KEY` forte** : aujourd'hui `dev-key` en prod (publique). La renforcer
   exige de **coordonner le changement avec l'APK** (la clé est embarquée dans
   l'app) : publier d'abord un APK avec la nouvelle clé → puis changer la
   variable Render → garder une période de grâce pour les anciens APK.
5. **Surveillance** : le Panneau Admin (dashboard de monitoring) — penser à
   mettre à jour la clé admin dans ses Paramètres (§5, point 4).

---

*Runbook généré avec le durcissement v1.1.19 (`warnInsecureDefaults`, colonne
`learner.interests`, workflow APK double-dépôt). Références code :
`server/index.js`, `server/gamification.js`, `server/.env.example`,
`.github/workflows/build-release-apk.yml`.*
