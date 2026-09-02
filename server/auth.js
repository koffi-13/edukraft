// server/auth.js
// Module d'authentification EduKraft — 5 providers + JWT + refresh rotation
//
// Providers supportés :
//   1. Email + mot de passe (bcrypt)
//   2. Google OAuth (vérification id_token côté serveur)
//   3. Apple Sign-In (vérification JWT via jose)
//   4. Facebook OAuth (vérification access_token via Graph API)
//   5. Phone OTP (code unique par téléphone, mock en dev)
//
// v1.1.9 — VÉRIFICATION D'EMAIL :
//   - Colonne email_verified sur user (Google/Apple/Facebook : vérifié
//     automatiquement dès la connexion — le provider a déjà validé l'email).
//   - POST /api/auth/verify-email/request : génère un code à 6 chiffres
//     (haché sha256, TTL 10 min, max 5 tentatives), envoyé par email via
//     Resend ou Brevo (API HTTP, zéro dépendance). Sans clé API configurée
//     (mode dev/test), le code est renvoyé dans la réponse — même pattern
//     que l'OTP téléphone mock.
//   - POST /api/auth/verify-email/confirm : vérifie le code → email_verified=1.
//
// Sécurité :
//   - Mots de passe hachés avec bcrypt (rounds configurables)
//   - Access token JWT court (7j par défaut) signé avec JWT_SECRET
//   - Refresh token longue durée (30j) stocké haché en DB, rotation à chaque usage
//   - Nettoyage automatique des refresh tokens expirés/révoqués
//
// ⚠️ Production : JWT_SECRET DOIT être défini (openssl rand -hex 32).
//    Sans cette variable, un secret aléatoire est généré à chaque redémarrage,
//    invalidant tous les tokens existants.

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const {
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
} = require('jose');

// ── Configuration ────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_ISSUER = 'edukraft';
const JWT_AUDIENCE = 'edukraft-app';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const REFRESH_EXPIRES_DAYS = parseInt(process.env.REFRESH_EXPIRES || '30', 10);
const REFRESH_EXPIRES_MS = REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

// OAuth config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.edukraft.app';
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';

// Phone OTP
const PHONE_OTP_ENABLED = process.env.PHONE_OTP_ENABLED !== 'false';
const OTP_MOCK_CODE = process.env.OTP_MOCK_CODE || null; // ex: '123456' en dev
const OTP_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

// Apple JWKS (clés publiques d'Apple pour vérifier les identityToken)
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const appleJWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

// Stores en mémoire (⚠️ utiliser Redis/SQLite en production)
const otpStore = new Map();     // phone → { code, expiresAt, attempts }
const refreshTokensIssued = new Set(); // anti-rejeu simple

// ── Helper : durée JWT → secondes ────────────────────────────────────────────
function durationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  const match = String(duration).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * multipliers[unit];
}

const JWT_EXPIRES_SECONDS = durationToSeconds(JWT_EXPIRES);

// ── Création des tables ──────────────────────────────────────────────────────
function initAuthTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE,
      phone         TEXT UNIQUE,
      password_hash TEXT,
      display_name  TEXT NOT NULL,
      avatar_url    TEXT,
      provider      TEXT NOT NULL DEFAULT 'email',
      provider_uid  TEXT,
      language      TEXT DEFAULT 'fr',
      email_verified         INTEGER DEFAULT 0,
      verification_code_hash TEXT,
      verification_expires_at TEXT,
      verification_attempts  INTEGER DEFAULT 0,
      verification_sent_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS refresh_token (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      device_info TEXT,
      expires_at  TEXT NOT NULL,
      revoked_at  TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_user    ON refresh_token(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_email      ON user(email);
    CREATE INDEX IF NOT EXISTS idx_user_phone      ON user(phone);
    CREATE INDEX IF NOT EXISTS idx_user_provider   ON user(provider, provider_uid);
  `);

  // v1.1.9 : migration des bases existantes (try/catch — colonne déjà là)
  const MIGRATIONS_V119 = [
    'ALTER TABLE user ADD COLUMN email_verified INTEGER DEFAULT 0',
    'ALTER TABLE user ADD COLUMN verification_code_hash TEXT',
    'ALTER TABLE user ADD COLUMN verification_expires_at TEXT',
    'ALTER TABLE user ADD COLUMN verification_attempts INTEGER DEFAULT 0',
    'ALTER TABLE user ADD COLUMN verification_sent_at TEXT',
  ];
  for (const stmt of MIGRATIONS_V119) {
    try { db.exec(stmt); } catch (_) { /* colonne déjà présente */ }
  }
  console.log('[AUTH] Tables user + refresh_token initialisées');
}

// ── Nettoyage périodique des refresh tokens expirés ──────────────────────────
function cleanupExpiredTokens(db) {
  const now = new Date().toISOString();
  try {
    const result = db.prepare(
      `DELETE FROM refresh_token WHERE expires_at < ? OR revoked_at IS NOT NULL`
    ).run(now);
    if (result.changes > 0) {
      console.log(`[AUTH] ${result.changes} refresh token(s) obsolète(s) supprimé(s)`);
    }
  } catch (e) {
    console.warn('[AUTH] cleanup error:', e.message);
  }
}

// ── JWT : signature & vérification ───────────────────────────────────────────
async function signAccessToken(user) {
  const secretBytes = Buffer.from(JWT_SECRET, 'utf-8');
  const token = await new SignJWT({
    sub: user.id,
    email: user.email || null,
    phone: user.phone || null,
    name: user.display_name,
    provider: user.provider,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(`${JWT_EXPIRES_SECONDS}s`)
    .sign(secretBytes);
  return token;
}

async function verifyAccessToken(token) {
  const secretBytes = Buffer.from(JWT_SECRET, 'utf-8');
  const { payload } = await jwtVerify(token, secretBytes, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return payload;
}

// ── Refresh tokens : génération, stockage (haché), rotation ──────────────────
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function storeRefreshToken(db, userId, token, deviceInfo) {
  const id = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_EXPIRES_MS).toISOString();
  db.prepare(`
    INSERT INTO refresh_token (id, user_id, token_hash, device_info, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, hashToken(token), deviceInfo || null, expiresAt, now.toISOString());
  return { id, expiresAt };
}

function findRefreshToken(db, token) {
  return db.prepare(
    'SELECT * FROM refresh_token WHERE token_hash = ?'
  ).get(hashToken(token));
}

function revokeRefreshToken(db, tokenId) {
  db.prepare('UPDATE refresh_token SET revoked_at = ? WHERE id = ?')
    .run(new Date().toISOString(), tokenId);
}

function revokeAllUserTokens(db, userId) {
  db.prepare('UPDATE refresh_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), userId);
}

// ── Utilisateurs : recherche / création ──────────────────────────────────────
function findUserById(db, id) {
  return db.prepare('SELECT * FROM user WHERE id = ?').get(id);
}

function findUserByEmail(db, email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM user WHERE email = ?').get(String(email).toLowerCase().trim());
}

function findUserByPhone(db, phone) {
  if (!phone) return null;
  return db.prepare('SELECT * FROM user WHERE phone = ?').get(String(phone).trim());
}

function findUserByProvider(db, provider, providerUid) {
  return db.prepare(
    'SELECT * FROM user WHERE provider = ? AND provider_uid = ?'
  ).get(provider, providerUid);
}

// ── v1.1.11 : AVATAR GOOGLE MATERIALIZÉ EN DATA URI (photo stable) ──────────
//
// PROBLÈME (« la photo de profil ne s'affiche pas / n'est pas conservée ») :
//   1. Les URLs d'avatar Google (lh3.googleusercontent.com/a/ACg8oc…=s96-c)
//      sont PÉRISSABLES : Google les fait tourner (changement de photo,
//      révocation) et les anciennes meurent → l'app rend une <Image> vide
//      (onError silencieux) au lieu de la photo.
//   2. La connexion Google n'écrivait avatar_url qu'à la CRÉATION du compte :
//      aucune mise à jour ensuite → l'URL stockée vieillit et meurt.
//   3. Les lignes learner (compte + pull) portaient la même URL distante →
//      chaque appareil héritait d'une photo cassée, sans guérison possible.
//
// SOLUTION :
//   - À CHAQUE connexion Google : télécharger l'avatar (≈200 px, ≤ 120 Ko,
//     timeout 4 s) et le stocker en DATA URI auto-contenue
//     (data:image/…;base64,…) — toujours affichable, syncable, insensible à
//     l'expiration. En cas d'échec de téléchargement : on garde l'URL brute.
//   - Propager la data URI vers les lignes learner du compte (clé canonique
//     ou même email) UNIQUEMENT si leur photo est vide ou une URL http
//     distante — jamais si c'est une data URI (photo choisie par l'utilisateur
//     dans l'app, prioritaire).

const AVATAR_FETCH_TIMEOUT_MS = 4000;
const AVATAR_MAX_BYTES = 120 * 1024; // 120 Ko binaire (base64 ≈ 160 Ko, très loin de la limite sync 2 Mo)

/** …=s96-c → =s200-c (paramètre de taille Google) — meilleure qualité d'affichage.
 *  Ne touche QUE les URLs googleusercontent (le suffixe =sNNN est spécifique Google). */
function bumpAvatarSize(url, size = 200) {
  if (typeof url !== 'string' || !url.startsWith('http')) return url;
  if (!url.includes('googleusercontent.com')) return url;
  const m = url.match(/^(.*=s)\d+(-[a-z]*)?$/i);
  if (m) return `${m[1]}${size}${m[2] || ''}`;
  return url.includes('=s') ? url : `${url}=s${size}-c`;
}

/** Télécharge l'avatar et le convertit en data URI (null si indisponible). */
async function materializeAvatarDataUri(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith('http')) return null;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(bumpAvatarSize(avatarUrl, 200), { signal: controller.signal });
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > AVATAR_MAX_BYTES) return null;
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null; // CDN injoignable/lent : fallback = garder l'URL brute
  } finally {
    clearTimeout(tid);
  }
}

/** Remplace la photo des lignes learner du compte par la data URI fraîche. */
function propagateAvatarToLearners(db, user, photoValue) {
  if (!photoValue || typeof photoValue !== 'string' || !photoValue.startsWith('data:')) return 0;
  try {
    const now = new Date().toISOString();
    const canonicalClientId = `lrn_${user.id}`;
    const email = user.email ? String(user.email).toLowerCase().trim() : null;
    const conditions = ['client_id = ?'];
    const params = [photoValue, now, canonicalClientId];
    if (email) { conditions.push("LOWER(TRIM(COALESCE(email, ''))) = ?"); params.push(email); }
    const res = db.prepare(
      `UPDATE learner SET photo_url = ?, updated_at = ?
       WHERE (photo_url IS NULL OR photo_url = '' OR photo_url LIKE 'http%')
         AND (${conditions.join(' OR ')})`
    ).run(...params);
    return res.changes || 0;
  } catch (_) {
    return 0;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, verification_code_hash, verification_expires_at,
    verification_attempts, verification_sent_at, ...safe } = user;
  // v1.1.9 : email_verified exposé au client (gating de l'écran de
  // vérification) — booléen strict pour éviter les surprises SQLite (0/1).
  safe.email_verified = !!user.email_verified;
  return safe;
}

function createUser(db, { email, phone, password, displayName, avatarUrl, provider, providerUid, language, emailVerified }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = password ? bcrypt.hashSync(password, BCRYPT_ROUNDS) : null;
  db.prepare(`
    INSERT INTO user (id, email, phone, password_hash, display_name, avatar_url, provider, provider_uid, language, email_verified, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    email ? String(email).toLowerCase().trim() : null,
    phone ? String(phone).trim() : null,
    passwordHash,
    displayName,
    avatarUrl || null,
    provider || 'email',
    providerUid || null,
    language || 'fr',
    emailVerified ? 1 : 0,
    now, now, now
  );
  return findUserById(db, id);
}

function updateLastLogin(db, userId) {
  db.prepare('UPDATE user SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), userId);
}

// ── Réponse auth standardisée ────────────────────────────────────────────────
async function buildAuthResponse(db, user, deviceInfo) {
  const accessToken = await signAccessToken(user);
  const refreshToken = generateRefreshToken();
  storeRefreshToken(db, user.id, refreshToken, deviceInfo);
  updateLastLogin(db, user.id);
  return {
    accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRES_SECONDS,
    user: sanitizeUser(user),
  };
}

// ── Vérification des providers OAuth ─────────────────────────────────────────

/** Google : vérifie l'id_token via les clés publiques Google */
async function verifyGoogleIdToken(idToken) {
  // Google fournit les claims directement dans le JWT signé avec RS256.
  // On vérifie la signature via les clés publiques de Google.
  const googleJWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  const { payload } = await jwtVerify(idToken, googleJWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  });

  // Vérifier l'audience (client_id)
  if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('audience mismatch');
  }

  return {
    providerUid: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    displayName: payload.name || (payload.email ? payload.email.split('@')[0] : 'Google User'),
    avatarUrl: payload.picture || null,
  };
}

/** Apple : vérifie l'identityToken via les clés publiques Apple */
async function verifyAppleIdentityToken(identityToken) {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: 'https://appleid.apple.com',
  });

  // Vérifier l'audience (bundle ID)
  if (APPLE_BUNDLE_ID && payload.aud !== APPLE_BUNDLE_ID) {
    throw new Error('apple audience mismatch');
  }

  return {
    providerUid: payload.sub,
    email: payload.email || null,
    emailVerified: !!payload.email_verified,
    displayName: payload.name || 'Apple User',
    avatarUrl: null,
  };
}

/** Facebook : vérifie l'access_token via le Graph API */
async function verifyFacebookAccessToken(accessToken) {
  const url = new URL('https://graph.facebook.com/v18.0/me');
  url.searchParams.set('fields', 'id,name,email,picture');
  url.searchParams.set('access_token', accessToken);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Facebook API error: ${resp.status} ${body}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);

  // Vérifier l'app_id si configuré
  if (FACEBOOK_APP_ID) {
    const appUrl = new URL('https://graph.facebook.com/v18.0/app');
    appUrl.searchParams.set('access_token', accessToken);
    const appResp = await fetch(appUrl.toString());
    const appData = await appResp.json();
    if (appData.id && appData.id !== FACEBOOK_APP_ID) {
      throw new Error('facebook app mismatch');
    }
  }

  return {
    providerUid: data.id,
    email: data.email || null,
    emailVerified: !!data.email,
    displayName: data.name || 'Facebook User',
    avatarUrl: data.picture?.data?.url || null,
  };
}

// ── Phone OTP ────────────────────────────────────────────────────────────────
function generateOtp() {
  if (OTP_MOCK_CODE) return OTP_MOCK_CODE;
  // Code à 6 chiffres
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendOtp(phone, code) {
  // En dev (OTP_MOCK_CODE défini), on log simplement le code.
  // En prod : remplacer par Twilio / Vonage / provider SMS local togolais.
  console.log(`[AUTH/OTP] SMS vers ${phone} — code: ${code}`);
  // TODO prod : await twilioClient.messages.create({ ... })
}

// ── v1.1.9 : Vérification d'email ─────────────────────────────────────────────
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || '').toLowerCase(); // 'resend' | 'brevo' | ''
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'EduKraft <onboarding@resend.dev>';
const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const VERIFY_MAX_ATTEMPTS = 5;

function emailProviderConfigured() {
  if (EMAIL_PROVIDER === 'resend' && RESEND_API_KEY) return 'resend';
  if (EMAIL_PROVIDER === 'brevo' && BREVO_API_KEY) return 'brevo';
  // Auto-détection : une clé présente suffit même sans EMAIL_PROVIDER explicite
  if (RESEND_API_KEY) return 'resend';
  if (BREVO_API_KEY) return 'brevo';
  return null;
}

/**
 * Envoie l'email de vérification via Resend ou Brevo (API HTTP — zéro
 * dépendance, compatible Render qui filtre parfois le SMTP sortant).
 * Retourne { sent: true } ou { sent: false, reason } — l'appelant décide
 * du fallback (mode test : code renvoyé dans la réponse API).
 */
async function sendVerificationEmail(toEmail, code, displayName) {
  const provider = emailProviderConfigured();
  if (!provider) return { sent: false, reason: 'no-provider' };

  const subject = 'EduKraft — Vérifiez votre adresse email';
  const text =
    `Bonjour ${displayName || ''},\n\n` +
    `Votre code de vérification EduKraft est : ${code}\n\n` +
    `Il expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.\n\n` +
    `— L'équipe EduKraft`;
  const html =
    `<div style="font-family:-apple-system,Roboto,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#5B4ABB;margin:0 0 12px">EduKraft</h2>` +
    `<p style="color:#333;font-size:15px">Bonjour ${displayName || ''},</p>` +
    `<p style="color:#333;font-size:15px">Voici votre code de vérification :</p>` +
    `<p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#5B4ABB;background:#F4F2FA;border-radius:12px;padding:16px;text-align:center">${code}</p>` +
    `<p style="color:#777;font-size:13px">Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>` +
    `</div>`;

  try {
    if (provider === 'resend') {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: [toEmail], subject, text, html }),
      });
      if (!resp.ok) throw new Error(`resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return { sent: true };
    }
    if (provider === 'brevo') {
      const fromMatch = EMAIL_FROM.match(/<(.+)>/);
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'EduKraft', email: fromMatch ? fromMatch[1] : EMAIL_FROM },
          to: [{ email: toEmail }],
          subject,
          textContent: text,
          htmlContent: html,
        }),
      });
      if (!resp.ok) throw new Error(`brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return { sent: true };
    }
  } catch (e) {
    console.error('[AUTH/verify-email] Échec envoi via', provider, ':', e.message);
    return { sent: false, reason: 'provider-error', error: e.message };
  }
  return { sent: false, reason: 'no-provider' };
}

function validatePhone(phone) {
  // Format attendu : numéro international sans '+', ex: 22890123456 (Togo)
  const cleaned = String(phone).replace(/[\s+()-]/g, '');
  return /^\d{8,15}$/.test(cleaned);
}

// ── Middlewares ──────────────────────────────────────────────────────────────

/** Exige un access token JWT valide */
function requireAuth(db) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Token manquant' });
    }

    try {
      const payload = await verifyAccessToken(token);
      const user = findUserById(db, payload.sub);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Utilisateur introuvable' });
      }
      req.user = user;
      req.accessToken = token;
      next();
    } catch (err) {
      // Token expiré ou invalide
      return res.status(401).json({
        success: false,
        error: 'Token invalide ou expiré',
        code: 'TOKEN_EXPIRED',
      });
    }
  };
}

/** Accepte soit un Bearer JWT, soit une clé API (x-api-key) */
function requireAuthOrApiKey(db, apiKey) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const key = req.headers['x-api-key'] || req.query.api_key;

    // Clé API valide
    if (key && key === apiKey) {
      return next();
    }

    // Bearer token valide
    if (token) {
      try {
        const payload = await verifyAccessToken(token);
        const user = findUserById(db, payload.sub);
        if (user) {
          req.user = user;
          req.accessToken = token;
          return next();
        }
      } catch (_) {
        // tombe dans le 401 ci-dessous
      }
    }

    return res.status(401).json({ success: false, error: 'Authentification requise' });
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * Montage de toutes les routes /api/auth/* sur l'app Express.
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 */
function mountAuthRoutes(app, db) {
  // Nettoyage au démarrage, puis toutes les heures
  cleanupExpiredTokens(db);
  setInterval(() => cleanupExpiredTokens(db), 60 * 60 * 1000);

  // ── GET /api/auth/google/callback · GET /api/auth/facebook/callback ──────
  // Page relais OAuth (v1.1.2) : Google/Facebook n'acceptent que des
  // redirect_uri HTTPS ; le proxy Expo (auth.expo.io) exige un projet
  // enregistré chez Expo, incompatible avec un build Gradle direct.
  // Cette page, servie par le backend, lit le fragment (#id_token=...&state=...)
  // posé par le provider et redirige vers l'URL de retour de l'app portée par
  // `state` (edukraft:// en APK, exp://... en Expo Go), avec liste blanche de
  // préfixes. Aucun secret n'est manipulé ici : le id_token est vérifié
  // côté serveur ensuite via POST /api/auth/google.
  const sendOAuthRelayPage = (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.send('<!doctype html>\n' +
      '<html lang="fr"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
      '<title>EduKraft - Connexion</title>' +
      '<style>' +
      "body{font-family:-apple-system,Roboto,'Segoe UI',sans-serif;background:#F4F2FA;color:#241C4B;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}" +
      '.card{max-width:420px;padding:28px;text-align:center}' +
      'h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#555;margin:0}' +
      'a.btn{display:inline-block;margin-top:16px;padding:12px 22px;background:#5B4ABB;color:#fff;text-decoration:none;border-radius:10px;font-weight:600}' +
      '.spin{display:inline-block;width:26px;height:26px;border:3px solid #DDD6F3;border-top-color:#5B4ABB;border-radius:50%;animation:r 1s linear infinite;margin-bottom:14px}' +
      '@keyframes r{to{transform:rotate(360deg)}}' +
      '</style></head><body><div class="card">' +
      '<div class="spin"></div>' +
      '<h1>Finalisation de la connexion...</h1>' +
      '<p id="msg">Retour vers EduKraft en cours...</p>' +
      '<a id="btn" class="btn" href="#" style="display:none">Revenir a l\'application</a>' +
      '</div>' +
      '<scr' + 'ipt>(function(){' +
      "var ALLOWED=['edukraft://','exp://','https://exp.direct','http://localhost','http://127.0.0.1'];" +
      "function ps(str){var o={};(str||'').split('&').forEach(function(kv){if(!kv)return;var i=kv.indexOf('=');if(i<0){o[decodeURIComponent(kv)]=''}else{o[decodeURIComponent(kv.slice(0,i))]=decodeURIComponent(kv.slice(i+1))}});return o}" +
      'var p={};' +
      'if(location.search.length>1){var q=ps(location.search.slice(1));for(var k in q){p[k]=q[k]}}' +
      'if(location.hash.length>1){var h=ps(location.hash.slice(1));for(var k2 in h){p[k2]=h[k2]}}' +
      "var st=p.state||'edukraft://';" +
      'var ok=false;for(var i=0;i<ALLOWED.length;i++){if(st.indexOf(ALLOWED[i])===0){ok=true;break}}' +
      "if(!ok){document.getElementById('msg').textContent='Destination non autorisee. Fermez cet ecran et rouvrez EduKraft.';return}" +
      "var frag=Object.keys(p).filter(function(k){return k!=='state'}).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(p[k])}).join('&');" +
      "var target=st+(st.indexOf('?')>=0?'&':'?')+frag;" +
      'location.replace(target);' +
      'setTimeout(function(){' +
      "document.getElementById('msg').textContent='Touchez le bouton ci-dessous pour revenir a EduKraft, puis fermez cet ecran.';" +
      "var b=document.getElementById('btn');b.href=target;b.style.display='inline-block';" +
      '},1500);' +
      '})();</scr' + 'ipt></body></html>');
  };
  app.get('/api/auth/google/callback', sendOAuthRelayPage);
  app.get('/api/auth/facebook/callback', sendOAuthRelayPage);

  // ── POST /api/auth/register ──────────────────────────────────────────────
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, displayName, language } = req.body || {};

      if (!email || !password || !displayName) {
        return res.status(400).json({
          success: false,
          error: 'Champs requis: email, password, displayName',
        });
      }
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Le mot de passe doit faire au moins 6 caractères',
        });
      }
      if (findUserByEmail(db, email)) {
        return res.status(409).json({
          success: false,
          error: 'Un compte existe déjà avec cet email',
        });
      }

      const user = createUser(db, {
        email,
        password,
        displayName,
        provider: 'email',
        language: language || 'fr',
      });

      const authResponse = await buildAuthResponse(
        db, user, req.headers['user-agent']
      );
      return res.status(201).json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/register]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email et mot de passe requis',
        });
      }

      const user = findUserByEmail(db, email);
      if (!user || !user.password_hash) {
        return res.status(401).json({
          success: false,
          error: 'Identifiants invalides',
        });
      }

      const ok = bcrypt.compareSync(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({
          success: false,
          error: 'Identifiants invalides',
        });
      }

      const authResponse = await buildAuthResponse(
        db, user, req.headers['user-agent']
      );
      return res.json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/login]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── POST /api/auth/google ────────────────────────────────────────────────
  app.post('/api/auth/google', async (req, res) => {
    try {
      const { idToken } = req.body || {};
      if (!idToken) {
        return res.status(400).json({ success: false, error: 'idToken requis' });
      }

      const profile = await verifyGoogleIdToken(idToken);

      let user = profile.email
        ? findUserByEmail(db, profile.email)
        : findUserByProvider(db, 'google', profile.providerUid);

      if (user) {
        // Lier le provider si ce n'était pas déjà fait
        if (user.provider !== 'google' && !user.provider_uid) {
          db.prepare('UPDATE user SET provider = ?, provider_uid = ?, updated_at = ? WHERE id = ?')
            .run('google', profile.providerUid, new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
        // v1.1.9 : Google a déjà validé l'email — marquer vérifié (une fois)
        if (profile.emailVerified && !user.email_verified) {
          db.prepare('UPDATE user SET email_verified = 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
      } else {
        user = createUser(db, {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          provider: 'google',
          providerUid: profile.providerUid,
          // v1.1.9 : email déjà vérifié par Google
          emailVerified: profile.emailVerified,
        });
      }

      // v1.1.11 : RAFRAÎCHIR L'AVATAR À CHAQUE CONNEXION GOOGLE —
      // l'avatar est téléchargé et matérialisé en data URI stable (les URLs
      // lh3.googleusercontent.com périment → « photo de profil qui ne
      // s'affiche plus »). Puis propagé vers les lignes learner du compte
      // dont la photo est vide ou une URL http distante périssable.
      try {
        const sourceUrl = profile.avatarUrl
          || (String(user.avatar_url || '').startsWith('http') ? user.avatar_url : null);
        if (sourceUrl) {
          const dataUri = await materializeAvatarDataUri(sourceUrl);
          const value = dataUri || sourceUrl; // data URI si possible, sinon URL brute
          if (value !== user.avatar_url) {
            db.prepare('UPDATE user SET avatar_url = ?, updated_at = ? WHERE id = ?')
              .run(value, new Date().toISOString(), user.id);
            user = findUserById(db, user.id);
          }
          if (dataUri) {
            const n = propagateAvatarToLearners(db, user, dataUri);
            if (n > 0) console.log(`[AUTH/google] Avatar matérialisé + propagé à ${n} ligne(s) learner (${user.email})`);
          }
        }
      } catch (_) { /* best-effort : ne jamais bloquer la connexion */ }

      const authResponse = await buildAuthResponse(
        db, user, req.headers['user-agent']
      );
      return res.json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/google]', err.message);
      return res.status(401).json({
        success: false,
        error: 'Authentification Google échouée',
      });
    }
  });

  // ── POST /api/auth/apple ─────────────────────────────────────────────────
  app.post('/api/auth/apple', async (req, res) => {
    try {
      const { identityToken, authorizationCode } = req.body || {};
      if (!identityToken) {
        return res.status(400).json({ success: false, error: 'identityToken requis' });
      }

      const profile = await verifyAppleIdentityToken(identityToken);

      let user = profile.email
        ? findUserByEmail(db, profile.email)
        : findUserByProvider(db, 'apple', profile.providerUid);

      if (user) {
        if (user.provider !== 'apple' && !user.provider_uid) {
          db.prepare('UPDATE user SET provider = ?, provider_uid = ?, updated_at = ? WHERE id = ?')
            .run('apple', profile.providerUid, new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
        if (profile.emailVerified && !user.email_verified) {
          db.prepare('UPDATE user SET email_verified = 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
      } else {
        user = createUser(db, {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          provider: 'apple',
          providerUid: profile.providerUid,
          emailVerified: profile.emailVerified,
        });
      }

      const authResponse = await buildAuthResponse(
        db, user, req.headers['user-agent']
      );
      return res.json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/apple]', err.message);
      return res.status(401).json({
        success: false,
        error: 'Authentification Apple échouée',
      });
    }
  });

  // ── POST /api/auth/facebook ──────────────────────────────────────────────
  app.post('/api/auth/facebook', async (req, res) => {
    try {
      const { accessToken } = req.body || {};
      if (!accessToken) {
        return res.status(400).json({ success: false, error: 'accessToken requis' });
      }

      const profile = await verifyFacebookAccessToken(accessToken);

      let user = profile.email
        ? findUserByEmail(db, profile.email)
        : findUserByProvider(db, 'facebook', profile.providerUid);

      if (user) {
        if (user.provider !== 'facebook' && !user.provider_uid) {
          db.prepare('UPDATE user SET provider = ?, provider_uid = ?, updated_at = ? WHERE id = ?')
            .run('facebook', profile.providerUid, new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
        if (profile.emailVerified && !user.email_verified) {
          db.prepare('UPDATE user SET email_verified = 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);
          user = findUserById(db, user.id);
        }
      } else {
        user = createUser(db, {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          provider: 'facebook',
          providerUid: profile.providerUid,
          emailVerified: profile.emailVerified,
        });
      }

      const authResponse = await buildAuthResponse(
        db, user, req.headers['user-agent']
      );
      return res.json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/facebook]', err.message);
      return res.status(401).json({
        success: false,
        error: 'Authentification Facebook échouée',
      });
    }
  });

  // ── POST /api/auth/phone ─────────────────────────────────────────────────
  // Deux actions : "send" (envoi du code) et "verify" (vérification + login)
  app.post('/api/auth/phone', async (req, res) => {
    try {
      const { phone, action, code } = req.body || {};

      if (!phone || !validatePhone(phone)) {
        return res.status(400).json({
          success: false,
          error: 'Numéro de téléphone invalide',
        });
      }
      if (!PHONE_OTP_ENABLED) {
        return res.status(403).json({
          success: false,
          error: 'Authentification par téléphone désactivée',
        });
      }
      if (!action || !['send', 'verify'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Action requise: "send" ou "verify"',
        });
      }

      // ── Action : send ──────────────────────────────────────────────────
      if (action === 'send') {
        const otpCode = generateOtp();
        const expiresAt = Date.now() + OTP_TTL_MS;
        otpStore.set(phone, { code: otpCode, expiresAt, attempts: 0 });
        sendOtp(phone, otpCode);

        return res.json({
          success: true,
          data: {
            otpSent: true,
            // En mode mock, on renvoie le code pour faciliter les tests
            devCode: OTP_MOCK_CODE ? otpCode : undefined,
            expiresIn: OTP_TTL_MS / 1000,
          },
        });
      }

      // ── Action : verify ────────────────────────────────────────────────
      if (action === 'verify') {
        const entry = otpStore.get(phone);
        if (!entry) {
          return res.status(400).json({
            success: false,
            error: 'Aucun code envoyé à ce numéro. Demandez un nouveau code.',
          });
        }
        if (Date.now() > entry.expiresAt) {
          otpStore.delete(phone);
          return res.status(400).json({
            success: false,
            error: 'Code expiré. Demandez un nouveau code.',
          });
        }
        if (entry.attempts >= OTP_MAX_ATTEMPTS) {
          otpStore.delete(phone);
          return res.status(429).json({
            success: false,
            error: 'Trop de tentatives. Demandez un nouveau code.',
          });
        }
        if (!code || String(code).trim() !== entry.code) {
          entry.attempts++;
          return res.status(400).json({
            success: false,
            error: 'Code incorrect',
          });
        }

        // Code valide → créer/trouver l'utilisateur
        otpStore.delete(phone);
        let user = findUserByPhone(db, phone);
        if (!user) {
          user = createUser(db, {
            phone,
            displayName: `+${phone}`,
            provider: 'phone',
            providerUid: phone,
          });
        }

        const authResponse = await buildAuthResponse(
          db, user, req.headers['user-agent']
        );
        return res.json({ success: true, data: authResponse });
      }
    } catch (err) {
      console.error('[AUTH/phone]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── v1.1.9 : POST /api/auth/verify-email/request ─────────────────────────
  // Génère et envoie un code de vérification à 6 chiffres (haché en DB,
  // TTL 10 min, max 5 tentatives). Sans provider email configuré, le code
  // est renvoyé dans la réponse (mode test — même pattern que l'OTP mock).
  app.post('/api/auth/verify-email/request', requireAuth(db), async (req, res) => {
    try {
      const user = req.user;
      if (!user.email) {
        return res.status(400).json({
          success: false,
          error: 'Ce compte n\'a pas d\'adresse email à vérifier',
        });
      }
      if (user.email_verified) {
        return res.status(400).json({
          success: false,
          error: 'Votre email est déjà vérifié',
          code: 'ALREADY_VERIFIED',
        });
      }
      // Anti-spam simple : 1 envoi / 45 s (sauf admin via DB reset)
      if (user.verification_sent_at) {
        const since = Date.now() - new Date(user.verification_sent_at).getTime();
        if (since < 45_000) {
          return res.status(429).json({
            success: false,
            error: `Un code vient d'être envoyé. Réessayez dans ${Math.ceil((45_000 - since) / 1000)} s.`,
            code: 'COOLDOWN',
            retryInSeconds: Math.ceil((45_000 - since) / 1000),
          });
        }
      }

      // Code à 6 chiffres (crypto → imprévisible)
      const code = String(100000 + crypto.randomInt(0, 900000));
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL_MS).toISOString();
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE user
        SET verification_code_hash = ?, verification_expires_at = ?,
            verification_attempts = 0, verification_sent_at = ?, updated_at = ?
        WHERE id = ?
      `).run(codeHash, expiresAt, now, now, user.id);

      const mail = await sendVerificationEmail(user.email, code, user.display_name);
      if (!mail.sent) {
        // Mode test (aucun provider configuré) OU échec provider :
        // on log côté serveur et on renvoie le code pour ne pas bloquer
        // l'utilisateur (déploiement sans clé email).
        console.log(`[AUTH/verify-email] Code de vérification pour ${user.email} : ${code} (mode test — provider email non configuré)`);
      }

      return res.json({
        success: true,
        data: {
          sent: mail.sent,
          email: user.email,
          expiresInSeconds: VERIFY_CODE_TTL_MS / 1000,
          // Mode test uniquement : jamais renvoyé si un vrai email est parti
          devCode: mail.sent ? undefined : code,
        },
      });
    } catch (err) {
      console.error('[AUTH/verify-email/request]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── v1.1.9 : POST /api/auth/verify-email/confirm ─────────────────────────
  app.post('/api/auth/verify-email/confirm', requireAuth(db), async (req, res) => {
    try {
      const { code } = req.body || {};
      const user = req.user;
      if (!user.email) {
        return res.status(400).json({ success: false, error: 'Aucune adresse email sur ce compte' });
      }
      if (user.email_verified) {
        return res.json({ success: true, data: { user: sanitizeUser(user), alreadyVerified: true } });
      }
      if (!code || !/^\d{6}$/.test(String(code).trim())) {
        return res.status(400).json({ success: false, error: 'Code invalide (6 chiffres attendus)' });
      }
      if (!user.verification_code_hash || !user.verification_expires_at) {
        return res.status(400).json({
          success: false,
          error: 'Aucun code en attente. Demandez un nouveau code.',
          code: 'NO_CODE',
        });
      }
      if (Date.now() > new Date(user.verification_expires_at).getTime()) {
        return res.status(400).json({
          success: false,
          error: 'Code expiré. Demandez un nouveau code.',
          code: 'CODE_EXPIRED',
        });
      }
      if ((user.verification_attempts || 0) >= VERIFY_MAX_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          error: 'Trop de tentatives. Demandez un nouveau code.',
          code: 'TOO_MANY_ATTEMPTS',
        });
      }

      const codeHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
      if (codeHash !== user.verification_code_hash) {
        db.prepare('UPDATE user SET verification_attempts = verification_attempts + 1 WHERE id = ?')
          .run(user.id);
        return res.status(400).json({ success: false, error: 'Code incorrect' });
      }

      // ✓ Code valide
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE user
        SET email_verified = 1, verification_code_hash = NULL,
            verification_expires_at = NULL, verification_attempts = 0, updated_at = ?
        WHERE id = ?
      `).run(now, user.id);
      const fresh = findUserById(db, user.id);

      console.log(`[AUTH/verify-email] Email vérifié : ${fresh.email}`);
      return res.json({ success: true, data: { user: sanitizeUser(fresh) } });
    } catch (err) {
      console.error('[AUTH/verify-email/confirm]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  app.get('/api/auth/me', requireAuth(db), (req, res) => {
    res.json({ success: true, data: { user: sanitizeUser(req.user) } });
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────────────
  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(400).json({ success: false, error: 'refreshToken requis' });
      }

      const stored = findRefreshToken(db, refreshToken);
      if (!stored || stored.revoked_at) {
        return res.status(401).json({ success: false, error: 'Refresh token invalide' });
      }
      if (new Date(stored.expires_at) < new Date()) {
        revokeRefreshToken(db, stored.id);
        return res.status(401).json({ success: false, error: 'Refresh token expiré' });
      }

      const user = findUserById(db, stored.user_id);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Utilisateur introuvable' });
      }

      // Rotation : révoquer l'ancien, émettre un nouveau
      revokeRefreshToken(db, stored.id);
      const authResponse = await buildAuthResponse(
        db, user, stored.device_info
      );
      return res.json({ success: true, data: authResponse });
    } catch (err) {
      console.error('[AUTH/refresh]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  app.post('/api/auth/logout', requireAuth(db), (req, res) => {
    try {
      // Révoquer tous les refresh tokens de cet utilisateur
      revokeAllUserTokens(db, req.user.id);
      return res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      console.error('[AUTH/logout]', err);
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });
}

module.exports = {
  initAuthTables,
  mountAuthRoutes,
  requireAuth,
  requireAuthOrApiKey,
  cleanupExpiredTokens,
  // Exposés pour les tests éventuels
  signAccessToken,
  verifyAccessToken,
  sanitizeUser,
};
