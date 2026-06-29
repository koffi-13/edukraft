// src/config/env.js
// Configuration centralisée de l'application EduKraft
//
// En mode développement : utilise EXPO_PUBLIC_API_URL ou localhost
// En production : injecté via EAS build environment variables
//
// ⚠️ API_BASE doit pointer vers l'ORIGINE du serveur (sans suffixe de chemin).
//    Les routes serveur sont toutes préfixées /api/* (ex: /api/sync, /api/auth/login).
//    Les appelants ajoutent eux-mêmes le /api/... approprié.

const ENV = {
  // ── API ───────────────────────────────────────────────────────────────────
  // Origine du backend. Remplacer par votre domaine en production.
  // Sur Android Emulator : utiliser 10.0.2.2 au lieu de localhost
  API_BASE:  __DEV__
    ? (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001')
    : (process.env.EXPO_PUBLIC_API_URL || 'https://api.edukraft.tg'),

  // Clé API pour l'authentification (injectée via EAS secrets en production)
  API_KEY: process.env.EXPO_PUBLIC_API_KEY || 'dev-key',

  // ── Sync ──────────────────────────────────────────────────────────────────
  SYNC_INTERVAL_MS: 30_000,   // Vérifie la file toutes les 30s
  SYNC_BATCH_SIZE:  20,       // Max 20 opérations par requête
  SYNC_MAX_RETRIES: 5,        // Abandon après 5 échecs

  // ── Blockchain (Phase 3) ─────────────────────────────────────────────────
  // Mumbai est déprécié — utiliser Amoy pour le testnet
  POLYGON_NETWORK: 'amoy',
  POLYGON_CHAIN_ID: 80002,
};

export default ENV;
