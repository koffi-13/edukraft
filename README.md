# EduKraft MVP — Base de Code

> Plateforme Ed-Tech togolaise · Formation gamifiée · Certification blockchain Polygon · Matching IA

---

## Démarrage rapide (3 commandes)

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer sur Android (émulateur ou téléphone USB)
npm run android

# 3. Lancer en web (demo rapide)
npm run web
```

**Prérequis :** Node 18+, Expo CLI (`npm install -g expo-cli`), Android Studio ou Expo Go sur téléphone.

---

## Structure du projet

```
edukraft-mvp/
│
├── App.js                          # Point d'entrée — monte les providers
│
├── src/
│   ├── theme/
│   │   └── index.js                # Tokens : couleurs, typographie, espacements, XP levels
│   │
│   ├── i18n/
│   │   ├── fr.json                 # Catalogue français (100% complet)
│   │   ├── ewe.json                # Catalogue Ewe (35% — à compléter)
│   │   └── index.js                # Moteur i18n avec fallback FR
│   │
│   ├── database/
│   │   ├── schema.js               # DDL SQLite (5 tables) + requêtes préparées
│   │   ├── DbProvider.js           # Context React — toutes les ops DB
│   │   └── syncEngine.js           # Moteur sync différentielle offline→online
│   │
│   ├── blockchain/
│   │   └── badgeGenerator.js       # Générateur hash SHA-256 + QR payload Polygon
│   │
│   ├── content/
│   │   ├── moduleRegistry.js       # Registre dynamique — ajouter un module = 1 import
│   │   └── modules/
│   │       └── marketing_digital_local.json   # Module pilote (3 leçons × 3 quiz)
│   │
│   ├── navigation/
│   │   └── AppNavigator.js         # Tabs + Stack + Onboarding gate
│   │
│   ├── components/
│   │   ├── OfflineIndicator.js     # Bannière offline animée
│   │   ├── XPBar.js                # Barre XP avec niveaux et animation
│   │   └── BadgeCard.js            # Carte badge avec QR code
│   │
│   └── screens/
│       ├── OnboardingScreen.js     # Création de profil (1er lancement)
│       ├── DashboardScreen.js      # Tableau de bord + liste modules
│       ├── LessonScreen.js         # Lecteur de leçon avec progression
│       ├── QuizScreen.js           # Moteur quiz complet + attribution XP
│       └── BadgeWalletScreen.js    # Portefeuille de certifications + QR
```

---

## Architecture Offline-First

```
┌─────────────────────────────────────────────────────────────────┐
│                         TÉLÉPHONE ANDROID                        │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Écrans UI   │───▶│   DbProvider     │───▶│  SQLite local │  │
│  │  (React)     │◀───│   (Context)      │◀───│  (expo-sqlite)│  │
│  └──────────────┘    └─────────┬────────┘    └───────────────┘  │
│                                │                                  │
│                       ┌────────▼────────┐                        │
│                       │   sync_queue    │  ← chaque écriture     │
│                       │   (table SQL)   │    locale enqueue       │
│                       └────────┬────────┘                        │
│                                │                                  │
│                       ┌────────▼────────┐                        │
│                       │  SyncEngine     │  ← toutes les 30s      │
│                       │  (hook React)   │    si réseau dispo      │
│                       └────────┬────────┘                        │
└────────────────────────────────┼────────────────────────────────┘
                                 │ HTTPS (batch, retry expo.)
                    ┌────────────▼────────────┐
                    │   API REST EduKraft      │
                    │   api.edukraft.tg        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Blockchain Polygon PoS │
                    │   Smart contract ERC-721 │
                    │   (badges NFT)           │
                    └─────────────────────────┘
```

### Garanties Offline-First

| Situation | Comportement |
|-----------|-------------|
| Zéro réseau pendant l'apprentissage | ✅ Aucune interruption. Tout en SQLite local. |
| Quiz terminé hors ligne | ✅ Score sauvé localement, XP crédité immédiatement. |
| Badge généré hors ligne | ✅ Hash SHA-256 local émis. QR fonctionnel. Tx Polygon en attente. |
| Reconnexion 2G | ✅ `syncEngine` vide la file automatiquement en batch de 20. |
| Erreur API | ✅ Retry exponentiel × 5. Log pour analyse. Abandon propre après MAX_RETRIES. |
| Appareil Android Go (1 Go RAM) | ✅ Pas de lib native lourde. Assets SVG uniquement. SQLite WAL mode. |

---

## Ajouter un nouveau module (sans coder)

1. Créer `src/content/modules/mon_module.json` en respectant le schéma.
2. L'importer dans `src/content/moduleRegistry.js` :
   ```js
   import monModule from './modules/mon_module.json';
   export const MODULES = [marketingDigital, monModule, ...];
   ```
3. C'est tout. Le module apparaît automatiquement sur le dashboard.

### Schéma JSON d'un module

```json
{
  "id":      "nom-module-v1",
  "filiere": "Nom de la filière",
  "meta": {
    "title":       "Titre affiché",
    "subtitle":    "Accroche courte",
    "duration_min": 6,
    "xp_reward":    150,
    "badge_title":  "Certifié [Module]",
    "color":        "#HEXCOLOR"
  },
  "lessons": [
    {
      "index":         0,
      "title":         "Titre leçon",
      "xp_per_lesson": 50,
      "min_quiz_score": 0.67,
      "content": {
        "intro":    "Texte d'introduction...",
        "sections": [
          { "heading": "Titre", "body": "Contenu...", "highlight": false }
        ],
        "key_takeaway": "Message clé à retenir"
      },
      "quiz": {
        "passing_score": 0.67,
        "xp_bonus_perfect": 10,
        "questions": [
          {
            "id":   "q0_0",
            "text": "Question ?",
            "type": "single_choice",
            "options": [
              { "id": "a", "text": "Option A" },
              { "id": "b", "text": "Option B", "correct": true }
            ],
            "explanation": "Explication de la bonne réponse."
          }
        ]
      }
    }
  ]
}
```

---

## Intégration Blockchain Polygon (Phase Production)

Remplacer dans `src/blockchain/badgeGenerator.js` :

```js
// MVP : hash SHA-256 local
const hash = sha256(seed);

// PRODUCTION : appel smart contract ERC-721 Polygon PoS
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
const tx       = await contract.mint(learnerId, metadataURI);
const receipt  = await tx.wait();
// receipt.hash = le vrai hash de transaction Polygon
```

---

## Variables d'environnement

```env
# EAS env vars (préfixe EXPO_PUBLIC_ requis pour le bundle client)
EXPO_PUBLIC_API_URL=https://api.edukraft.tg
EXPO_PUBLIC_API_KEY=dev-key
POLYGON_RPC_URL=https://polygon-rpc.com
CONTRACT_ADDRESS=0x...  # Adresse du smart contract ERC-721
SYNC_INTERVAL_MS=30000
```

---

## Roadmap Technique (J1 → J3)

| Jour | Tâches |
|------|--------|
| **J1 (fait)** | Schema SQLite, DbProvider, syncEngine, i18n, thème, moduleJSON |
| **J2 (fait)** | Tous les écrans, navigation, composants, badgeGenerator |
| **J3** | Tests offline (3 phases), ajout module Comptabilité Artisanale, intégration T-Money/Flooz, build APK debug |

---

## Contact & Contribution

**EduKraft Togo** · dev@edukraft.tg  
Licence : MIT (code) · CC-BY-SA 4.0 (contenu pédagogique)
