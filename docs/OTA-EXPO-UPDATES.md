# Mises à jour OTA (Over-The-Air) avec `expo-updates`

> **Statut : documenté, PAS encore activé.** Ce document explique (1) pourquoi
> l'OTA est devenu indispensable, (2) pourquoi il n'est volontairement PAS
> activé aujourd'hui, (3) les étapes exactes pour l'activer le jour venu.
> **N'ajoutez jamais de `projectId` factice dans `app.json` avant d'avoir fait
> `eas init` — cela casserait le build Gradle de la CI (détail plus bas).**

---

## 1. Pourquoi l'OTA : la classe d'échec « le téléphone qui ne se met jamais à jour »

Toute la saga v1.1.15 → v1.1.18 vient d'un même problème racine : **l'APK
installé sur le téléphone de l'apprenant ne se met jamais à jour tout seul.**

- Chaque correctif (SQLite réparé, file de sync restaurée, données conservées
  après déconnexion, streak/jokers, résilience grande police…) était bien
  poussé sur GitHub et bien compilé en APK par la CI — mais l'apprenant
  continuait à utiliser **l'ancien APK v1.1.14 installé des semaines plus tôt**.
- Résultat : « ça marche chez le développeur, pas chez moi », des bugs
  « persistants » qui n'étaient que des bugs **déjà corrigés mais jamais
  livrés**, et une impression que rien n'avance.
- Un APK sideloadé (hors Play Store) n'a **aucun mécanisme de mise à jour
  automatique** : il faut désinstaller/réinstaller manuellement, ce qu'aucun
  utilisateur ne fait spontanément.

**L'OTA (`expo-updates`) corrige exactement cela** : à chaque démarrage de
l'app, le téléphone interroge le serveur Expo et télécharge la couche
**JavaScript** à jour (bundle + assets). Le correctif arrive chez tout le
monde en quelques minutes, **sans réinstaller l'APK**.

---

## 2. Pourquoi ce n'est PAS activé maintenant

Le pipeline de build actuel est **Gradle direct sur GitHub Actions, sans EAS**
(workflows `build-release-apk.yml` / `build-android.yml` : `expo prebuild` +
`./gradlew assembleRelease` + publication GitHub Releases). Or l'OTA exige un
**`projectId` EAS réel** dans `app.json` :

```json
"updates": { "url": "https://u.expo.dev/<projectId>" },
"runtimeVersion": { "policy": "appVersion" }
```

Ce `projectId` n'existe qu'après `eas init` (il identifie le projet côté
compte Expo). **Un placeholder inventé (`00000000-…`) casserait la chaîne** :

- `expo prebuild`/EAS Update injectent la configuration dans le projet natif ;
  un ID inconnu du serveur Expo fait échouer la requête de configuration au
  **build** (et de toute façon toutes les requêtes OTA au runtime).
- La CI Gradle n'a pas de compte Expo : il n'y a **aucun moyen d'obtenir un
  projectId valide sans créer le projet EAS d'abord**.

C'est pourquoi **`app.json` est volontairement laissé INTACT** (aucun bloc
`updates`, aucun `projectId` factice) : la voie APK GitHub reste saine et
reproductible tant que le projet EAS n'est pas créé. L'activation se fait en
une seule session courte, quand on décide de couper la v1.2.0 (étapes §3).

---

## 3. Étapes d'activation (à exécuter dans l'ordre, sans interruption)

Prérequis : compte Expo (https://expo.dev), `bun` et `eas-cli` (`npm i -g eas-cli`)
installés, être connecté (`eas login`).

1. **Ajouter la lib native** (elle doit être dans l'APK AVANT tout update OTA) :

   ```bash
   bun add expo-updates@~0.24.12   # version du dist-tag sdk-50 (SDK 50)
   ```

   ⚠ Comme `expo-av`/`expo-speech`, la version doit être celle du SDK 50 —
   un `bun add expo-updates` nu installerait une version incompatible. Puis
   resynchroniser le lock npm (la CI installe avec `npm install`) :

   ```bash
   npm install --package-lock-only --legacy-peer-deps
   rm -f bun.lock   # le repo n'a pas de bun.lock racine, la CI utilise npm
   ```

2. **Créer le projet EAS** (c'est CE step qui génère le vrai `projectId`) :

   ```bash
   eas init
   ```

   Noter l'ID affiché (ou le relire avec `eas whoami` / sur le dashboard Expo).

3. **Configurer `app.json`** — ajouter les deux clés, avec le VRAI projectId :

   ```json
   "updates": { "url": "https://u.expo.dev/<projectId>" },
   "runtimeVersion": { "policy": "appVersion" }
   ```

   `runtimeVersion: appVersion` lie le canal OTA à la `version` de l'app
   (1.2.0 ne peut recevoir que les updates publiés pour 1.2.0) : simple et
   sûr tant qu'on ne touche pas aux libs natives sans bump de version.

4. **Bumper la version et couper la release native** :

   ```json
   "version": "1.2.0",        // app.json
   "android": { "versionCode": 10400 }   // bump cohérent (10318 → 10400)
   ```

   ```bash
   git add -A && git commit -m "v1.2.0 : OTA expo-updates"
   git tag v1.2.0 && git push origin main --tags
   ```

   → le workflow GitHub « Build & Release APK » produit **l'APK v1.2.0 qui
   contient expo-updates** (⚠ tant qu'aucun build EAS n'est fait, `eas.json`
   peut rester tel quel ; le workflow Gradle compile la lib via prebuild).

5. **Publier un update OTA** (couche JS uniquement, quelques minutes) :

   ```bash
   eas update --branch production
   ```

   L'update est téléchargé au prochain démarrage de l'app et appliqué au
   redémarrage suivant (ou immédiatement avec `Updates.reloadAsync()` si on
   veut coder un bandeau « Mise à jour prête »).

---

## 4. ⚠ La contrainte du premier build : il doit être installé manuellement

L'OTA ne peut livrer que **ce qui est du JavaScript**. Tant que le téléphone
porte un APK **antérieur** à la v1.2.0 (celle qui embarque `expo-updates`),
il ne sait pas interroger le serveur OTA. Concrètement :

- Les APK v1.1.x installés « sur le terrain » doivent être **remplacés une
  dernière fois** par l'APK v1.2.0 (via https://github.com/koffi-13/edukraft/releases).
- Ce n'est qu'À PARTIR de v1.2.0 que les correctifs JS suivants arriveront
  tout seuls (v1.2.1, v1.2.2… publiés par `eas update`, sans nouvel APK).
- Chaque ajout/suppression de **lib native** (`expo-av`, `expo-speech`…)
  exige un NOUVEL APK : l'OTA ne remplace jamais le code natif.

**Vue d'ensemble livrable par chaque canal :**

| Type de changement | OTA (`eas update`) | Nouvel APK (workflow GitHub) |
|---|---|---|
| Écrans, composants, logique JS (`src/**`) | ✅ | ✅ |
| Corrections de bugs UI / texte / traductions | ✅ | ✅ |
| Contenu de cours JSON bundlé | ✅ | ✅ |
| Nouvelle lib native (`expo-*` à installer) | ❌ | ✅ |
| Bump Expo SDK / React Native | ❌ | ✅ |
| `versionCode`, permissions, icônes, splash | ❌ | ✅ |
| Serveur API (`server/**`) | n/a (indépendant) | n/a |

Règle pratique : si `bun add`/`bun remove` touche une dépendance avec du code
natif, ou si `app.json` change (permissions, versionCode), → **APK**.
Sinon → `eas update --branch production` suffit.

---

## 5. Coexistence avec le workflow GitHub APK

Les deux canaux ne se concurrencent pas, ils se complètent :

- **APK GitHub (build-release-apk.yml)** : reste **la voie principale pour
  tout ce qui est natif** — releases, tags, signature keystore versionnée,
  miroir public `edukraft-releases`. Inchangé.
- **OTA EAS** : couche rapide pour les correctifs JS entre deux releases.
- ⚠ Après activation, ne PAS mettre de `projectId` EAS dans les secrets du
  workflow Gradle : le build GitHub n'a pas besoin du compte Expo, il
  compile simplement la lib `expo-updates` via `expo prebuild`.
- ⚠ Ordre à respecter pour une release avec natif : tag GitHub d'abord
  (APK de référence), puis `eas update --branch production` pour poser la
  couche JS courante sur le même `runtimeVersion`.

---

## 6. Checklist d'activation (à dérouler le jour J)

- [ ] `eas login` fonctionnel, compte Expo identifié
- [ ] `bun add expo-updates@~0.24.12` (dist-tag sdk-50, PAS de version nue)
- [ ] `npm install --package-lock-only --legacy-peer-deps` + `rm -f bun.lock`
- [ ] `eas init` → récupérer le VRAI `projectId`
- [ ] `app.json` : bloc `updates.url = https://u.expo.dev/<projectId>` +
      `runtimeVersion.policy = appVersion` (JAMAIS de placeholder)
- [ ] Bump `version` → 1.2.0 + `versionCode` → 10400
- [ ] Commit + tag `v1.2.0` + push → APK GitHub OK (workflow vert)
- [ ] Installer l'APK v1.2.0 sur un appareil de test
- [ ] `eas update --branch production` → redémarrer l'app 2× → vérifier que
      la couche JS est bien téléchargée (log `expo-updates` au démarrage)
- [ ] Vérifier la coexistence : nouveau tag `v1.2.1-apk` (natif) + update
      OTA (JS) sur le même runtime → les deux canaux vivants
