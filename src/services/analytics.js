// src/services/analytics.js
// v1.1.21 (Phase 3 — Track 2) : Analytics pluggable SANS dépendance native.
//
// Objectif : mesurer le taux de complétion par module, le drop-off par
// leçon, et la streak retention D1/D7/D30 — sans installer PostHog/Mixpanel
// tout de suite. L'abstraction est prête à être branchée via env vars plus
// tard, sans re-pousser de code.
//
// Stratégie :
//   - Si EXPO_PUBLIC_ANALYTICS_PROVIDER est défini ('posthog' | 'mixpanel'
//     | 'amplitude' | 'custom'), on envoie les events vers le provider
//     configuré via son API REST (transport HTTP custom, sans SDK natif).
//   - Sinon, on log les events en console (en dev) ou on no-op (en prod).
//   - Le mode "console" est utile pour valider l'instrumentation avant de
//     brancher un vrai provider.
//
// Le schéma d'events est volontairement simple et stable (pour pouvoir
// rétro-analyser) :
//
//   app_open                  { source: 'cold' | 'foreground' }
//   learner_identified        { learner_id, server_id?, streak_days, total_xp, level }
//   module_started             { module_id, lesson_count }
//   lesson_started             { module_id, lesson_index }
//   lesson_completed           { module_id, lesson_index, score, xp, perfect }
//   module_completed           { module_id, lessons_done, total_xp_earned, score, badge_issued }
//   streak_increased           { streak_days, last_active_date }
//   streak_lost                { prev_streak_days }
//   achievement_unlocked       { key, title }
//   sync_push                  { ops_count, success, duration_ms, error? }
//   sync_pull                  { ops_count, success, duration_ms, error? }
//   profile_photo_healed       { source: 'local' | 'server', refreshed: bool }
//   error                      { message, module, fatal }
//
// API publique :
//   init()                       > init asynchrone
//   track(event, props?)         > emit un event
//   identify(userId, props?)     > associe un user aux events ultérieurs
//   reset()                      > détache le user
//
// Usage côté QuizScreen.handleFinish :
//   import { track } from '../services/analytics';
//   track('module_completed', { module_id, lessons_done, total_xp_earned, score, badge_issued: !!badge });

import { Platform } from 'react-native';
import ENV from '../config/env';

// ── Configuration ───────────────────────────────────────────────────────────
const PROVIDER = (process.env.EXPO_PUBLIC_ANALYTICS_PROVIDER || '').toLowerCase();
const API_KEY = process.env.EXPO_PUBLIC_ANALYTICS_KEY || '';
const API_HOST = process.env.EXPO_PUBLIC_ANALYTICS_HOST || '';
const ENABLED = !!PROVIDER && !!API_KEY;
const SAMPLE_RATE = 1.0; // 100% des events

// ── État ────────────────────────────────────────────────────────────────────
let currentUser = null;
let anonymousId = generateAnonId();
const appStartTime = Date.now();

function generateAnonId() {
  return 'anon_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// ── Helper : URL d'ingest par provider ─────────────────────────────────────
function getIngestUrl() {
  if (!ENABLED) return null;
  switch (PROVIDER) {
    case 'posthog':
      // PostHog capture endpoint
      return API_HOST ? `${API_HOST.replace(/\/$/, '')}/capture/` : 'https://app.posthog.com/capture/';
    case 'mixpanel':
      return 'https://api.mixpanel.com/track/';
    case 'amplitude':
      return 'https://api2.amplitude.com/2/httpapi';
    case 'custom':
      return API_HOST;
    default:
      return null;
  }
}

// ── Helper : payload par provider ───────────────────────────────────────────
function buildPayload(event, props) {
  if (!ENABLED) return null;
  const common = {
    event,
    properties: {
      ...props,
      // Propriétés communes (modèle PostHog-like, le plus universel)
      distinct_id: currentUser?.id || anonymousId,
      $lib: 'edukraft-custom-transport',
      $lib_version: '1.1.21',
      $platform: Platform.OS,
      $app_version: '1.1.21',
      $device_id: anonymousId,
      $time: Date.now(),
      $app_uptime_ms: Date.now() - appStartTime,
    },
  };
  if (currentUser) {
    common.properties.$set = {
      email: currentUser.email,
      name: currentUser.displayName,
      streak_days: currentUser.streak_days,
      total_xp: currentUser.total_xp,
      level: currentUser.level,
    };
  }
  switch (PROVIDER) {
    case 'posthog':
      return {
        api_key: API_KEY,
        event: common.event,
        properties: common.properties,
        timestamp: new Date(common.properties.$time).toISOString(),
        distinct_id: common.properties.distinct_id,
      };
    case 'mixpanel':
      return {
        type: 'track',
        event: common.event,
        properties: { ...common.properties, token: API_KEY },
      };
    case 'amplitude':
      return {
        api_key: API_KEY,
        events: [{
          event_type: common.event,
          user_id: currentUser?.id || anonymousId,
          device_id: anonymousId,
          timestamp: common.properties.$time,
          event_properties: common.properties,
          user_properties: common.properties.$set || {},
        }],
      };
    case 'custom':
      return common;
    default:
      return null;
  }
}

// ── Helper : envoie l'event au provider ─────────────────────────────────────
async function sendEvent(event, props) {
  if (!ENABLED) return;
  const url = getIngestUrl();
  if (!url) return;
  const payload = buildPayload(event, props);
  if (!payload) return;
  if (Math.random() > SAMPLE_RATE) return;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
  } catch (_) {
    // Best-effort : si l'envoi échoue, on ne bloque pas l'app.
  }
}

// ── API publique ────────────────────────────────────────────────────────────

/** Initialise l'analytics. */
export function init() {
  if (!ENABLED) {
    console.log('[analytics] Pas de provider configuré (EXPO_PUBLIC_ANALYTICS_PROVIDER absent) — events en console en dev, no-op en prod.');
    return;
  }
  console.log(`[analytics] Activé — provider: ${PROVIDER}, events envoyés à ${getIngestUrl()}`);
}

/**
 * Émet un event analytics.
 * @param {string} event - nom de l'event (ex: 'module_completed')
 * @param {Object} [props] - propriétés (ex: { module_id, score })
 */
export function track(event, props = {}) {
  if (!__DEV__ && !ENABLED) return; // no-op en prod sans provider
  if (__DEV__ && !ENABLED) {
    console.log(`[analytics] track:`, event, props);
    return;
  }
  // Fire-and-forget
  sendEvent(event, props).catch(() => {});
}

/**
 * Associe un user aux events ultérieurs (et envoie un event $identify).
 * @param {Object} user - { id, email, displayName, streak_days, total_xp, level }
 */
export function identify(user) {
  if (!user) { reset(); return; }
  currentUser = {
    id: user.id || user.email || anonymousId,
    email: user.email,
    displayName: user.display_name || user.displayName,
    streak_days: user.streak_days,
    total_xp: user.total_xp,
    level: user.level,
  };
  track('learner_identified', {
    learner_id: currentUser.id,
    server_id: user.server_id,
    streak_days: currentUser.streak_days || 0,
    total_xp: currentUser.total_xp || 0,
    level: currentUser.level,
  });
}

/** Détache le user. */
export function reset() {
  currentUser = null;
  anonymousId = generateAnonId();
}

export const is_enabled = ENABLED;
export const get_anon_id = () => anonymousId;
