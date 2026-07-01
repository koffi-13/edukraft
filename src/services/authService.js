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
//   authHeader()               > {Authorization: 'Bearer xxx'} ou {}
//   authenticatedFetch(url, opts)

import ENV from '../config/env';
import { Platform } from 'react-native';

// ── Stockage sécurisé (expo-secure-store sur natif, fallback mémoire sur web) ─
// ⚠️ expo-secure-store a un shim web cassé en SDK 50 (getValueWithKeySync manquant).
// On force le fallback mémoire sur web — les tokens ne persistent pas au reload
// mais fonctionnent pendant la session (suffisant pour démos web).
let SecureStore = null;
if (Platform.OS !== 'web') {
  try {
    SecureStore = require('expo-secure-store');
  } catch (_) {
    SecureStore = null;
  }
}

// Fallback mémoire (web / tests) — pas persistant, mais fonctionnel
const memoryStorage = new Map();
const fallbackStorage = {
  async setItem(key, value) { memoryStorage.set(key, value); },
  async getItem(key) { return memoryStorage.get(key) ?? null; },
  async deleteItem(key) { memoryStorage.delete(key); },
};

const store = SecureStore || fallbackStorage;

const KEYS = {
  ACCESS_TOKEN:  'ek_access_token',
  REFRESH_TOKEN: 'ek_refresh_token',
  USER:          'ek_user',
  SKIP_AUTH:     'ek_skip_auth',
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
  ]);
}

async function clearTokens() {
  await Promise.all([
    store.deleteItem(KEYS.ACCESS_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.REFRESH_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.USER).catch(() => {}),
  ]);
}

async function clearAll() {
  await Promise.all([
    store.deleteItem(KEYS.ACCESS_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.REFRESH_TOKEN).catch(() => {}),
    store.deleteItem(KEYS.USER).catch(() => {}),
    store.deleteItem(KEYS.SKIP_AUTH).catch(() => {}),
  ]);
}

export async function getStoredAuth() {
  try {
    const [accessToken, refreshToken, userStr, skip] = await Promise.all([
      store.getItem(KEYS.ACCESS_TOKEN),
      store.getItem(KEYS.REFRESH_TOKEN),
      store.getItem(KEYS.USER),
      store.getItem(KEYS.SKIP_AUTH),
    ]);
    const user = userStr ? JSON.parse(userStr) : null;
    return {
      accessToken,
      refreshToken,
      user,
      skipAuth: skip === '1',
    };
  } catch (e) {
    console.warn('[authService] getStoredAuth error:', e.message);
    return { accessToken: null, refreshToken: null, user: null, skipAuth: false };
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

  let response = await fetch(url, { ...options, headers });

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
        response = await fetch(url, {
          ...options,
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

// ═══════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE — 5 providers + gestion session
// ═══════════════════════════════════════════════════════════════════════════════

/** Inscription email + mot de passe */
export async function register({ email, password, displayName, language }) {
  const response = await fetch(`${AUTH_BASE}/api/auth/register`, {
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
  const response = await fetch(`${AUTH_BASE}/api/auth/login`, {
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
  const response = await fetch(`${AUTH_BASE}/api/auth/google`, {
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
  const response = await fetch(`${AUTH_BASE}/api/auth/apple`, {
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
  const response = await fetch(`${AUTH_BASE}/api/auth/facebook`, {
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
  const response = await fetch(`${AUTH_BASE}/api/auth/phone`, {
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

/** Rotation du refresh token > nouveaux tokens */
export async function refresh() {
  const { refreshToken } = await getStoredAuth();
  if (!refreshToken) {
    throw new AuthenticationError('Pas de refresh token', 'NO_REFRESH_TOKEN');
  }
  const response = await fetch(`${AUTH_BASE}/api/auth/refresh`, {
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

/** Déconnexion : révoque les tokens serveur + clear local */
export async function logout() {
  try {
    await authFetch(`${AUTH_BASE}/api/auth/logout`, { method: 'POST' });
  } catch (_) {
    // Même si la requête échoue (réseau), on nettoie localement
  }
  await clearAll();
}

/** Active le mode "continuer sans compte" (hors-ligne, pas de token) */
export async function skip() {
  await clearTokens();
  await store.setItem(KEYS.SKIP_AUTH, '1');
}

/** fetch authentifié exporté pour les autres services */
export { authFetch as authenticatedFetch };
