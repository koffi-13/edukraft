// src/services/authService.js
// Service client d'authentification EduKraft.
//
// Responsabilités :
//   - Stockage sécurisé des tokens (expo-secure-store, fallback mémoire web)
//   - Headers Authorization automatiques (Bearer)
//   - Refresh token automatique quand l'access token expire (401)
//   - 5 providers : email, Google, Apple, Facebook, Phone OTP
//
// API publique :
//   register({email, password, displayName, language})
//   login({email, password})
//   loginGoogle(idToken)
//   loginApple({identityToken, authorizationCode})
//   loginFacebook(accessToken)
//   loginPhone({phone, action, code?})
//   me()                       > récupère l'utilisateur courant
//   refresh()                  > rotation du refresh token
//   logout()                   > révoque les tokens serveur + clear local
//   skip()                     > mode hors-ligne sans compte
//   getStoredAuth()            > {user, accessToken, skipAuth} depuis le storage
//   hasActiveSession()          > true si session active (auth ou invité, pas de logout)
//   authHeader()               > {Authorization: 'Bearer xxx'} ou {}
//   authenticatedFetch(url, opts)
//   clearAll()                 > efface tokens + user + skip (sans toucher ek_learner)
//   clearTokens()              > efface tokens + user uniquement

import ENV from '../config/env';
import { Platform } from 'react-native';

// ── Stockage sécurisé (expo-secure-store sur natif, fallback mémoire sur web) ─
// ⚠️ expo-secure-store v12 utilise setItemAsync/getItemAsync/deleteItemAsync
//    expo-secure-store v13 utilise setItem/getItem/deleteItem
// v1.1.3 : le fallback passe par persistentStorage (AsyncStorage natif >
// localStorage web > mémoire) — sur web, tokens et session survivent au
// rechargement de la page.

import persistentStorage from '../utils/persistentStorage';

let SecureStore = null;

if (Platform.OS !== 'web') {
  try { SecureStore = require('expo-secure-store'); } catch (_) {}
}

// Wrapper : SecureStore (sécurisé, natif) + persistentStorage (persistance
// multi-plateforme)
const store = {
  async setItem(key, value) {
    // 1. SecureStore (tokens sécurisés sur natif)
    if (SecureStore) {
      try {
        if (SecureStore.setItemAsync) await SecureStore.setItemAsync(key, value);
        else if (SecureStore.setItem) await SecureStore.setItem(key, value);
      } catch (e) { console.warn('[store] SecureStore setItem error:', e.message); }
    }
    // 2. Stockage persistant multi-plateforme (toujours)
    try { await persistentStorage.setItem(key, value); } catch (e) {}
  },

  async getItem(key) {
    // 1. SecureStore d'abord
    if (SecureStore) {
      try {
        let val = null;
        if (SecureStore.getItemAsync) val = await SecureStore.getItemAsync(key);
        else if (SecureStore.getItem) val = await SecureStore.getItem(key);
        if (val) return val;
      } catch (e) { console.warn('[store] SecureStore getItem error:', e.message); }
    }
    // 2. Stockage persistant multi-plateforme
    try {
      const val = await persistentStorage.getItem(key);
      if (val) return val;
    } catch (e) {}
    return null;
  },

  async deleteItem(key) {
    if (SecureStore) {
      try {
        if (SecureStore.deleteItemAsync) await SecureStore.deleteItemAsync(key);
        else if (SecureStore.deleteItem) await SecureStore.deleteItem(key);
      } catch (e) {}
    }
    try { await persistentStorage.removeItem(key); } catch (e) {}
  },
};

const KEYS = {
  ACCESS_TOKEN:  'ek_access_token',
  REFRESH_TOKEN: 'ek_refresh_token',
  USER:          'ek_user',
  SKIP_AUTH:     'ek_skip_auth',
  // v1.1.3 : flag « session explicitement terminée » — posé à la déconnexion,
  // retiré à la reconnexion. Force l'écran Login au démarrage même si un
  // learner local existe (ses données restent intactes et seront restaurées
  // dès la reconnexion).
  SESSION_ENDED: 'ek_logged_out',
};

// ── Base URL ─────────────────────────────────────────────────────────────────
// ENV.API_BASE pointe vers l'origine du serveur (ex: http://10.0.2.2:3001).
// Sur web, ENV.API_BASE peut être '' (vide) > URLs relatives (reverse proxy).
// On garde un strip de /v1 par sécurité au cas où un opérateur configure
// EXPO_PUBLIC_API_URL avec un suffixe /v1.
const AUTH_BASE = (ENV.API_BASE || 'http://localhost:3001').replace(/\/v1\/?$/, '');

// ── Gestion du refresh en cours (anti-boucle) ────────────────────────────────
let refreshPromise = null;

// ── Erreur custom ────────────────────────────────────────────────────────────
export class AuthenticationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

// ── Helpers storage ──────────────────────────────────────────────────────────
async function saveAuth({ accessToken, refreshToken, user }) {
  await Promise.all([
    store.setItem(KEYS.ACCESS_TOKEN, accessToken),
    store.setItem(KEYS.REFRESH_TOKEN, refreshToken),
    store.setItem(KEYS.USER, JSON.stringify(user)),
    store.deleteItem(KEYS.SKIP_AUTH).catch(() => {}),
    // v1.1.3 : reconnexion → la session redevient active (auto-login autorisé)
    store.deleteItem(KEYS.SESSION_ENDED).catch(() => {}),
  ]);
}

export async function clearTokens() {
  await Promise.all([
    store.deleteItem(KEYS.ACCESS_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.REFRESH_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.USER).catch(() => {}),
  ]);
}

/** Efface tokens + user + flag skip. NE TOUCHE PAS à 'ek_learner' /
 *  'ek_progress' / 'ek_badges' (le learner local survit à la déconnexion). */
export async function clearAll() {
  await Promise.all([
    store.deleteItem(KEYS.ACCESS_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.REFRESH_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.USER).catch(() => {}),
    store.deleteItem(KEYS.SKIP_AUTH).catch(() => {}),
  ]);
}

/** v1.1.3 : marque la session comme terminée (déconnexion volontaire).
 *  Le learner local et ses progressions NE SONT PAS supprimés — ils seront
 *  restaurés à la prochaine connexion, ou via « Continuer sans compte ». */
export async function markSessionEnded() {
  try { await store.setItem(KEYS.SESSION_ENDED, '1'); } catch (_) {}
}

/** v1.1.3 : la session était-elle explicitement terminée ? */
export async function isSessionEnded() {
  try {
    const v = await store.getItem(KEYS.SESSION_ENDED);
    return v === '1';
  } catch (_) {
    return false;
  }
}

export async function getStoredAuth() {
  try {
    const [accessToken, refreshToken, userStr, skip, ended] = await Promise.all([
      store.getItem(KEYS.ACCESS_TOKEN),
      store.getItem(KEYS.REFRESH_TOKEN),
      store.getItem(KEYS.USER),
      store.getItem(KEYS.SKIP_AUTH),
      store.getItem(KEYS.SESSION_ENDED),
    ]);
    const user = userStr ? JSON.parse(userStr) : null;
    return {
      accessToken,
      refreshToken,
      user,
      skipAuth: skip === '1',
      sessionEnded: ended === '1',
    };
  } catch (e) {
    console.warn('[authService] getStoredAuth error:', e.message);
    return { accessToken: null, refreshToken: null, user: null, skipAuth: false, sessionEnded: false };
  }
}

/** v1.1.7 : une session est-elle ACTIVE ?
 *  (utilisateur authentifié avec token, ou mode invité assumé) — et PAS de
 *  déconnexion volontaire. C'est la clé du « dashboard jusqu'à déconnexion » :
 *  tant que cette fonction renvoie true, l'utilisateur ne doit JAMAIS voir
 *  l'écran Login. Utilisée par DbProvider pour recréer le learner de secours
 *  si toutes les autres couches de persistance ont échoué. */
export async function hasActiveSession() {
  try {
    const [userStr, token, skip, ended] = await Promise.all([
      store.getItem(KEYS.USER),
      store.getItem(KEYS.ACCESS_TOKEN),
      store.getItem(KEYS.SKIP_AUTH),
      store.getItem(KEYS.SESSION_ENDED),
    ]);
    if (ended === '1') return false;      // déconnexion volontaire → Login
    if (skip === '1') return true;        // invité « Continuer sans compte »
    return !!(userStr && token);          // authentifié avec token valide
  } catch (_) {
    return false;
  }
}

export async function authHeader() {
  const { accessToken } = await getStoredAuth();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// ── Fetch wrapper avec refresh automatique sur 401 ───────────────────────────
async function authFetch(url, options = {}) {
  const { accessToken } = await getStoredAuth();
  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.headers || {}),
  };

  // Timeout 30s aussi ici (Render free tier s'endort : premier appel lent)
  const opts = { ...options, headers };
  delete opts._retried;
  let response = await fetchWithTimeout(url, opts);

  // Si 401 et qu'on a un refresh token > tenter le refresh puis retry
  if (response.status === 401 && !options._retried) {
    const { refreshToken } = await getStoredAuth();
    if (refreshToken) {
      try {
        if (!refreshPromise) {
          refreshPromise = refresh().finally(() => { refreshPromise = null; });
        }
        await refreshPromise;

        // Retry avec le nouveau token
        const { accessToken: newToken } = await getStoredAuth();
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${newToken}`,
        };
        response = await fetchWithTimeout(url, {
          ...opts,
          headers: retryHeaders,
          _retried: true,
        });
      } catch (_refreshErr) {
        // Refresh échoué > déconnexion
        await clearAll();
        throw new AuthenticationError('Session expirée', 'SESSION_EXPIRED');
      }
    }
  }

  return response;
}

// ── Helper : parse réponse JSON ──────────────────────────────────────────────
async function parseResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { error: text || `Erreur ${response.status}` };
  }

  if (!response.ok) {
    const message = data.error || data.message || `Erreur ${response.status}`;
    const code = data.code || (response.status === 401 ? 'UNAUTHORIZED' : null);
    throw new AuthenticationError(message, code);
  }

  return data;
}

// ── Fetch avec timeout + retries (Render free tier s'endort : cold start
// jusqu'à ~60 s — la 1re tentative peut expirer AVANT le réveil complet) ──
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  // v1.1.9 : 3 tentatives max (30 s chacune + backoff 2 s/5 s) ≈ 100 s de
  // fenêtre totale — largement le temps d'un réveil Render. Avant : une
  // seule retry → « connexion Google sans activité » / login en échec
  // quand le serveur dormait depuis 15 min.
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      const retryable = error.name === 'AbortError' ||
        /network|fetch|failed/i.test(error.message || '');
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;
      const delay = attempt === 1 ? 2000 : 5000;
      console.log(`[authService] Tentative ${attempt} échouée (${error.name}) — retry dans ${delay / 1000}s (réveil serveur ?)`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE — 5 providers + gestion session
// ═══════════════════════════════════════════════════════════════════════════════

/** Inscription email + mot de passe */
export async function register({ email, password, displayName, language }) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName, language }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  throw new AuthenticationError(data.error || 'Inscription échouée');
}

/** Connexion email + mot de passe */
export async function login({ email, password }) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  throw new AuthenticationError(data.error || 'Connexion échouée');
}

/** Connexion Google (idToken obtenu côté client via expo-auth-session) */
export async function loginGoogle(idToken) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  throw new AuthenticationError(data.error || 'Connexion Google échouée');
}

/** Connexion Apple (identityToken de expo-apple-authentication) */
export async function loginApple({ identityToken, authorizationCode }) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken, authorizationCode }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  throw new AuthenticationError(data.error || 'Connexion Apple échouée');
}

/** Connexion Facebook (accessToken du SDK Facebook) */
export async function loginFacebook(accessToken) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/facebook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  throw new AuthenticationError(data.error || 'Connexion Facebook échouée');
}

/**
 * Authentification par téléphone (OTP).
 * @param {Object} params
 * @param {string} params.phone   - Numéro international sans '+', ex: 22890123456
 * @param {'send'|'verify'} params.action
 * @param {string} [params.code]  - Code à 6 chiffres (action=verify)
 * @returns {Promise<Object>} - {otpSent} pour send, {user, accessToken, ...} pour verify
 */
export async function loginPhone({ phone, action, code }) {
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/phone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, action, code }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    // En mode verify, on reçoit les tokens > on les stocke
    if (action === 'verify' && data.data.accessToken) {
      await saveAuth(data.data);
    }
    return data.data;
  }
  throw new AuthenticationError(data.error || 'OTP échoué');
}

/** Récupère l'utilisateur courant (requête authentifiée) */
export async function me() {
  const response = await authFetch(`${AUTH_BASE}/api/auth/me`);
  const data = await parseResponse(response);
  if (data.success && data.data?.user) {
    await store.setItem(KEYS.USER, JSON.stringify(data.data.user));
    return data.data.user;
  }
  throw new AuthenticationError(data.error || 'Utilisateur introuvable');
}

// ── v1.1.9 : VÉRIFICATION D'EMAIL ───────────────────────────────────────────

/** Demande l'envoi d'un code de vérification à l'email du compte connecté.
 *  Réponse : { sent, email, expiresInSeconds, devCode? } — devCode n'est
 *  renvoyé QUE en mode test (aucun provider email configuré côté serveur). */
export async function requestEmailVerification() {
  const response = await authFetch(`${AUTH_BASE}/api/auth/verify-email/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) return data.data;
  throw new AuthenticationError(data.error || 'Envoi du code impossible');
}

/** Vérifie le code reçu par email → user actualisé (email_verified: true). */
export async function confirmEmailVerification(code) {
  const response = await authFetch(`${AUTH_BASE}/api/auth/verify-email/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code || '').trim() }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data?.user) {
    // Persister immédiatement l'utilisateur vérifié (session + restart)
    await store.setItem(KEYS.USER, JSON.stringify(data.data.user));
    return data.data.user;
  }
  throw new AuthenticationError(data.error || 'Code incorrect');
}

/** Rotation du refresh token > nouveaux tokens */
export async function refresh() {
  const { refreshToken } = await getStoredAuth();
  if (!refreshToken) {
    throw new AuthenticationError('Pas de refresh token', 'NO_REFRESH_TOKEN');
  }
  const response = await fetchWithTimeout(`${AUTH_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await parseResponse(response);
  if (data.success && data.data) {
    await saveAuth(data.data);
    return data.data;
  }
  // Refresh échoué > nettoyer
  await clearAll();
  throw new AuthenticationError(data.error || 'Refresh échoué', 'REFRESH_FAILED');
}

/** Déconnexion : révoque les tokens serveur + clear local.
 *  v1.1.3 : marque AUSSI la session terminée — l'écran Login réapparaîtra au
 *  prochain démarrage, mais le learner local et ses progressions sont
 *  conservés (restaurés dès la reconnexion). */
export async function logout() {
  try {
    await authFetch(`${AUTH_BASE}/api/auth/logout`, { method: 'POST' });
  } catch (_) {
    // Même si la requête échoue (réseau), on nettoie localement
  }
  await clearAll();
  await markSessionEnded();
}

/** Active le mode "continuer sans compte" (hors-ligne, pas de token).
 *  v1.1.3 : reprend la session locale si des données existent — le flag
 *  sessionEnded est retiré pour rouvrir directement le Dashboard. */
export async function skip() {
  await clearTokens();
  await store.setItem(KEYS.SKIP_AUTH, '1');
  try { await store.deleteItem(KEYS.SESSION_ENDED); } catch (_) {}
}

/** fetch authentifié exporté pour les autres services */
export { authFetch as authenticatedFetch };
