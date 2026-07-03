// src/config/env.js
// Configuration centralisée de l'application EduKraft
//
// ⚠️ API_BASE doit pointer vers l'ORIGINE du serveur (sans suffixe de chemin).
//    Les routes serveur sont toutes préfixées /api/* (ex: /api/sync, /api/auth/login).
//    Les appelants ajoutent eux-mêmes le /api/... approprié.
//
// Résolution de API_BASE (par ordre de priorité) :
//   1. EXPO_PUBLIC_API_URL (si défini ET non vide dans .env) — URL absolue
//   2. Défaut selon plateforme :
//      - web derrière proxy (Next.js port 3000) : '' (URL relative)
//      - web standalone (npx expo start --web, port 8081) : http://localhost:3001
//      - Android émulateur : http://10.0.2.2:3001
//      - prod : https://api.edukraft.tg

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

function resolveApiBase() {
  // 1. Variable d'environnement explicite (priorité maximale)
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim();

  // 2. Défaut selon plateforme
  if (isWeb) {
    // Web : détecter si on est derrière un proxy (Next.js sur port 3000)
    if (typeof window !== 'undefined' && window.location && window.location.port === '3000') {
      return '';  // proxy Next.js détecté
    }
    // Web standalone (npx expo start --web, port 8081) : utiliser Render
    return 'https://edukraft-api.onrender.com';
  }
  // Natif : utiliser Render en prod, localhost en dev
  return __DEV__ ? 'http://10.0.2.2:3001' : 'https://edukraft-api.onrender.com';
}

const API_BASE = resolveApiBase();

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
