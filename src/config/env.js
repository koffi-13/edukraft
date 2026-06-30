// src/config/env.js
// Configuration centralisée de l'application EduKraft
//
// En mode développement : utilise EXPO_PUBLIC_API_URL ou localhost
// En production : injecté via EAS build environment variables
//
// ⚠️ API_BASE doit pointer vers l'ORIGINE du serveur (sans suffixe de chemin).
//    Les routes serveur sont toutes préfixées /api/* (ex: /api/sync, /api/auth/login).
//    Les appelants ajoutent eux-mêmes le /api/... approprié.
//
// ⚠️ Web : sur plateforme web, API_BASE est TOUJOURS '' (vide) → URLs relatives.
//    Les appels fetch('/api/...') vont sur la MÊME origine que la page web,
//    ce qui permet à un reverse-proxy (Next.js/Caddy) de router vers le backend.
//    EXPO_PUBLIC_API_URL est IGNORÉ sur web (même si défini dans .env) car
//    le .env est partagé entre plateformes et l'IP LAN configurée pour le
//    téléphone ne marcherait pas depuis un navigateur (CORS / accessibilité).

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

let API_BASE;
if (isWeb) {
  // Web : toujours URL relative (reverse proxy gère le routing)
  API_BASE = '';
} else {
  // Natif (Android/iOS) : EXPO_PUBLIC_API_URL ou défaut selon l'environnement
  const _apiBaseFromEnv = process.env.EXPO_PUBLIC_API_URL;
  API_BASE = _apiBaseFromEnv !== undefined
    ? _apiBaseFromEnv
    : (__DEV__ ? 'http://10.0.2.2:3001' : 'https://api.edukraft.tg');
}

const ENV = {
  // ── API ───────────────────────────────────────────────────────────────────
  API_BASE,

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
