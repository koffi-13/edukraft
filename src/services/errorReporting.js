// src/services/errorReporting.js
// v1.1.21 (Phase 3 — Track 1) : Error reporting pluggable SANS dépendance native.
//
// Objectif : capter les crashes et les SyncEngine failures silencieux (qui
// aujourd'hui disparaissent en console.warn) et les envoyer à Sentry SI un
// DSN est configuré. Sinon, no-op (juste console.warn).
//
// Pourquoi PAS @sentry/react-native ? L'ajout d'une dépendance native
// augmenterait l'APK de ~2 Mo et nécessiterait un plugin Expo + un build
// prebuild. Pour un MVP avec < 1000 users, un transport HTTP custom vers
// l'API REST Sentry (envelope format) suffit et reste pluggable.
//
// Quand l'utilisateur configure `EXPO_PUBLIC_SENTRY_DSN`, les erreurs sont
// envoyées à Sentry (free tier 5k events/mois). Sinon, tout est no-op.
//
// API publique :
//   init()                  > init asynchrone (capture les erreurs globales)
//   captureException(err, { tags, extra, level })
//   captureMessage(msg, { level, extra })
//   setUser({ id, email, username })
//   clearUser()
//   breadcrumb(message, { category, level, data })
//
// Format compatible Sentry : envelope JSON
//   https://develop.sentry.dev/sdk/data-model/envelopes/
//
// Usage côté DbProvider / SyncEngine :
//   import { captureException } from '../services/errorReporting';
//   try { ... } catch (e) {
//     console.warn('[syncEngine] push error:', e.message);
//     captureException(e, { tags: { module: 'syncEngine' }, extra: { op: 'push' } });
//   }

import { Platform } from 'react-native';
import ENV from '../config/env';

// ── Configuration ───────────────────────────────────────────────────────────
// EXPO_PUBLIC_SENTRY_DSN = "https://<publickey>@o<orgid>.ingest.sentry.io/<projectid>"
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
const ENABLED = !!DSN;
const SAMPLE_RATE = 1.0; // 100% des events (free tier 5k/mois)

// Parse DSN pour construire l'URL d'ingest
function parseDsn(dsn) {
  // Format: https://<pubkey>@o<orgid>.ingest.sentry.io/<projectid>
  const m = /^https?:\/\/([^@]+)@(.+?)\/(\d+)(\/)?$/.exec(dsn || '');
  if (!m) return null;
  const [, publicKey, host, projectId] = m;
  return {
    publicKey,
    host,
    projectId,
    // Sentry envelope endpoint
    url: `https://${host}/api/${projectId}/envelope/`,
  };
}

const PARSED = ENABLED ? parseDsn(DSN) : null;
if (ENABLED && !PARSED) {
  console.warn('[errorReporting] EXPO_PUBLIC_SENTRY_DSN mal formé — attendu https://<key>@o<org>.ingest.sentry.io/<project>');
}

// ── État ────────────────────────────────────────────────────────────────────
let currentUser = null;
let breadcrumbs = [];
const MAX_BREADCRUMBS = 30;
const appStartTime = Date.now();

// ── Helper : génère un UUID v4 léger ─────────────────────────────────────────
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Helper : payload d'événement Sentry ─────────────────────────────────────
function buildEventPayload(level, message, exception, tags = {}, extra = {}) {
  const event_id = uuidv4();
  const timestamp = new Date().toISOString();
  const sdk = {
    name: 'edukraft-custom-transport',
    version: '1.0.0',
  };
  const contexts = {
    os: { name: Platform.OS, version: Platform.Version?.toString?.() || 'unknown' },
    app: { build_number: '1.1.21', start_time: new Date(appStartTime).toISOString() },
  };
  const event = {
    event_id,
    timestamp,
    level,
    platform: Platform.OS === 'web' ? 'javascript' : 'react-native',
    sdk,
    contexts,
    tags: { ...tags, app_version: '1.1.21' },
    extra: { ...extra, app_uptime_ms: Date.now() - appStartTime },
    breadcrumbs: breadcrumbs.slice(),
    request: {
      headers: { 'User-Agent': `EduKraft/1.1.21 (${Platform.OS})` },
    },
  };
  if (message && !exception) event.message = message;
  if (exception) {
    event.exception = {
      values: [{
        type: exception.name || 'Error',
        value: exception.message || String(exception),
        stacktrace: exception.stack ? {
          frames: exception.stack.split('\n').slice(0, 50).map((line) => ({
            filename: 'app',
            function: line.trim().slice(0, 200),
          })),
        } : undefined,
      }],
    };
  }
  if (currentUser) {
    event.user = currentUser;
  }
  return event;
}

// ── Helper : envoie l'envelope à Sentry ─────────────────────────────────────
async function sendEnvelope(event) {
  if (!ENABLED || !PARSED) return;
  // Sentry envelope format : header line + item line, séparés par \n
  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn: DSN,
    sdk: event.sdk,
  });
  const itemHeader = JSON.stringify({ type: 'event' });
  const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;
  try {
    // Best-effort : timeout 5s, non bloquant. Si réseau KO, on skip.
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    await fetch(PARSED.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      signal: controller.signal,
    });
    clearTimeout(tid);
  } catch (_) {
    // Best-effort : si l'envoi échoue, on ne bloque pas l'app.
    // Pas de console.warn ici pour ne pas spammer (network errors sont
    // communes en offline-first).
  }
}

// ── API publique ────────────────────────────────────────────────────────────

/** Initialise l'error reporting + capture les erreurs globales non gérées. */
export function init() {
  if (!ENABLED) {
    console.log('[errorReporting] EXPO_PUBLIC_SENTRY_DSN non configuré — error reporting désactivé (no-op).');
    return;
  }
  console.log(`[errorReporting] Activé — events envoyés à Sentry project ${PARSED.projectId}`);
  // Capture des erreurs globales (React Native global ErrorUtils)
  if (typeof global !== 'undefined' && global.ErrorUtils) {
    const prevHandler = global.ErrorUtils.getGlobalHandler?.();
    global.ErrorUtils.setGlobalHandler((err, isFatal) => {
      captureException(err, { tags: { fatal: isFatal ? 'yes' : 'no', source: 'global' }, level: 'fatal' });
      if (typeof prevHandler === 'function') prevHandler(err, isFatal);
    });
  }
  // Capture des rejets de Promesses non gérés (web/React Native 0.73+)
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason || new Error('unhandledrejection');
      captureException(reason, { tags: { source: 'unhandledrejection' }, level: 'error' });
    });
  }
}

/**
 * Capture une exception.
 * @param {Error} err
 * @param {Object} opts
 * @param {Object} [opts.tags] - tags Sentry (ex: { module: 'syncEngine' })
 * @param {Object} [opts.extra] - données supplémentaires (ex: { op: 'push' })
 * @param {string} [opts.level] - 'fatal' | 'error' | 'warning' | 'info'
 */
export function captureException(err, opts = {}) {
  const { tags = {}, extra = {}, level = 'error' } = opts;
  // Toujours logger en console (comportement historique)
  console.warn(`[errorReporting:${level}]`, err?.message || err, extra);
  if (!ENABLED) return;
  // Sample rate
  if (Math.random() > SAMPLE_RATE) return;
  const event = buildEventPayload(level, null, err, tags, extra);
  // Fire-and-forget : pas d'await
  sendEnvelope(event).catch(() => {});
}

/**
 * Capture un message (sans exception).
 * @param {string} message
 * @param {Object} opts
 * @param {string} [opts.level] - 'fatal' | 'error' | 'warning' | 'info'
 * @param {Object} [opts.extra]
 */
export function captureMessage(message, opts = {}) {
  const { level = 'info', extra = {}, tags = {} } = opts;
  console.log(`[errorReporting:${level}]`, message, extra);
  if (!ENABLED) return;
  if (Math.random() > SAMPLE_RATE) return;
  const event = buildEventPayload(level, message, null, tags, extra);
  sendEnvelope(event).catch(() => {});
}

/** Associe un user aux events ultérieurs. */
export function setUser(user) {
  if (!user) { currentUser = null; return; }
  currentUser = {
    id: user.id || user.email || 'anonymous',
    email: user.email,
    username: user.displayName || user.display_name || user.username,
  };
}

/** Détache le user. */
export function clearUser() {
  currentUser = null;
}

/**
 * Ajoute un breadcrumb (trace d'activité) aux events ultérieurs.
 * @param {string} message
 * @param {Object} opts
 * @param {string} [opts.category] - ex: 'sync', 'navigation', 'http'
 * @param {string} [opts.level] - 'fatal' | 'error' | 'warning' | 'info' | 'debug'
 * @param {Object} [opts.data]
 */
export function breadcrumb(message, opts = {}) {
  const { category = 'app', level = 'info', data = {} } = opts;
  breadcrumbs.push({
    timestamp: new Date().toISOString(),
    type: 'default',
    category,
    message,
    level,
    data,
  });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

export const is_enabled = ENABLED;
