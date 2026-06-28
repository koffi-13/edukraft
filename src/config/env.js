// src/config/env.js
// Configuration centralisée de l'application EduKraft
//
// En mode développement : utilise API_URL depuis app.config.js ou localhost
// En production : injecté via EAS build environment variables

const ENV = {
  // ── API ───────────────────────────────────────────────────────────────────
  // URL du backend. Remplacer par votre domaine en production.
  // Sur Android Emulator : utiliser 10.0.2.2 au lieu de localhost
  API_BASE:  __DEV__
    ? (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001/v1')
    : (process.env.EXPO_PUBLIC_API_URL || 'https://api.edukraft.tg/v1'),

  // Clé API pour l'authentification (injectée via EAS secrets en production)
  API_KEY: process.env.EXPO_PUBLIC_API_KEY || 'dev-key',

  // ── Sync ──────────────────────────────────────────────────────────────────
  SYNC_INTERVAL_MS: 30_000,   // Vérifie la file toutes les 30s
  SYNC_BATCH_SIZE:  20,       // Max 20 opérations par requête
  SYNC_MAX_RETRIES: 5,        // Abandon après 5 échecs

  // ── Blockchain (Phase 3) ─────────────────────────────────────────────────
  POLYGON_NETWORK: 'mumbai',  // mumbai (testnet) → mainnet en prod
  POLYGON_CHAIN_ID: 80001,
};

export default ENV;
