// src/database/DbProvider.js
// Provider de données EduKraft — coordonne les repositories et gère l'état React.
//
// Architecture v2 (Repository Pattern) :
//   DbProvider instancie 5 repositories qui encapsulent l'accès data :
//     - LearnerRepository       (table learner)
//     - ProgressRepository      (module_progress, quiz_attempt)
//     - BadgeRepository         (badge)
//     - GamificationRepository  (streak_log, achievement, daily_goal)
//     - SyncRepository          (sync_queue, sync_meta)
//
//   DbProvider gère l'état React (learner, ready, error) + l'init SQLite/migration,
//   et délègue les opérations CRUD aux repositories. L'API publique useDb() est
//   IDENTIQUE à la v1 — aucun écran à modifier.
//
//   En mode natif (Android/iOS) : utilise expo-sqlite pour la persistance réelle.
//   En mode web/test : utilise un store en mémoire (MemoryStore) qui simule les opérations.

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { createLearnerRepository } from './repositories/learnerRepository';
import { createProgressRepository } from './repositories/progressRepository';
import { createBadgeRepository } from './repositories/badgeRepository';
import { createGamificationRepository } from './repositories/gamificationRepository';
import { createSyncRepository } from './repositories/syncRepository';
import persistentStorage from '../utils/persistentStorage';
import ENV from '../config/env';
import * as authService from '../services/authService';
import { initRemoteModules } from '../content/moduleRegistry';

const DbContext = createContext(null);

// ── In-Memory Store (fallback pour web / test) ─────────────────────────────────
class MemoryStore {
  constructor() {
    this.learner = null;
    this.progress = {};    // moduleId > progress object
    this.quizAttempts = [];
    this.badges = [];
    this.syncQueue = [];
    this.syncMeta = { schema_version: '2', last_sync_at: null, sync_cursor: '0' };
    // Gamification (v2)
    this.streakLogs = {};      // activityDate > { lessons_done, xp_earned, goal_met, streak_freeze_used }
    this.achievements = [];    // [{ achievement_key, unlocked_at }]
    this.dailyGoal = null;     // { goal_type, goal_target, enabled }
  }

  reset() {
    this.learner = null;
    this.progress = {};
    this.quizAttempts = [];
    this.badges = [];
    this.syncQueue = [];
    this.streakLogs = {};
    this.achievements = [];
    this.dailyGoal = null;
  }
}

const memoryStore = new MemoryStore();

// ── Clés de persistance ──────────────────────────────────────────────────
// v1.1.3 : tout passe par persistentStorage (AsyncStorage natif > localStorage
// web > mémoire). Avant, le `require('@react-native-async-storage/async-storage')`
// levait une exception silencieuse sur web → RIEN n'était persisté → au
// rechargement, le profil invité était perdu (écran Login à chaque fois).
//
// v1.1.8 (multi-comptes — « chaque donnée doit être liée à un utilisateur via
// son ID même en local ») :
//   - ACTIVE_LEARNER : pointeur vers le learner lié à la session courante
//     (lrn_<user.id> pour un compte, lrn_<timestamp> pour un invité).
//   - Le snapshot complet est désormais SCOPÉ PAR COMPTE : clé
//     ek_snap_<learnerId>. Le learner du compte A ET celui du compte B
//     coexistent sur l'appareil — changer de compte ne montre QUE les
//     données du compte connecté (les autres lignes restent en SQLite,
//     intactes, prêtes à être rechargées à la reconnexion du compte).
//   - ek_learner / ek_memory_snapshot restent écrits (compat ascendante :
//     profil « actif » pour les versions précédentes).
const KEYS = {
  LEARNER:  'ek_learner',
  SNAPSHOT: 'ek_memory_snapshot', // snapshot complet du store mémoire
  ACTIVE_LEARNER: 'ek_active_learner_id', // v1.1.8 : learner de la session
};

const snapKey = (learnerId) => `ek_snap_${learnerId}`;

// ── v1.1.14 : initialisation du schéma (réutilisable) ────────────────────
// PRAGMA + création des tables + migrations idempotentes. Utilisée à CHAQUE
// ouverture de base : au premier démarrage, par resetAll, et par la
// reconstruction automatique après corruption (voir l'init du provider).
async function initSchema(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
  const { CREATE_TABLES, INITIAL_SYNC_META, MIGRATE_LEARNER_V2, MIGRATE_LEARNER_V3 } = require('./schema');
  await db.execAsync(CREATE_TABLES);
  await db.execAsync(INITIAL_SYNC_META);
  // Migration v1 > v2 : ajoute les colonnes gamification au learner
  // (idempotent : chaque ALTER échoue silencieusement si la colonne existe)
  for (const stmt of MIGRATE_LEARNER_V2) {
    try { await db.execAsync(stmt); } catch (_) { /* colonne déjà là */ }
  }
  // Migration v1 > v1.1 : ajoute les colonnes du profil étendu au learner
  for (const stmt of MIGRATE_LEARNER_V3) {
    try { await db.execAsync(stmt); } catch (_) { /* colonne déjà là */ }
  }
}

/** v1.1.8 : id du learner attendu pour la session stockée.
 *  - Compte authentifié (pas de déconnexion) → lrn_<user.id> (clé canonique
 *    partagée web + mobile, et embarquant l'ID utilisateur dans chaque table)
 *  - Invité / déconnecté → null (résolution via pointeur actif ou ligne
 *    invité server_id IS NULL) */
export function resolveSessionLearnerId(stored) {
  if (stored?.user && stored.user.id && !stored.sessionEnded) {
    return `lrn_${stored.user.id}`;
  }
  return null;
}

// ── Helper : persister un objet learner complet dans SQLite ──────────────────
// v1.1 (correctif critique) : quand SQLite est vide mais qu'un learner existe
// dans AsyncStorage (fallback), il faut le RÉINSÉRER en SQLite. Sinon les
// repositories (mode SQLite) retournent null → addXP/get crashent.
const LEARNER_COLUMNS = [
  'id', 'name', 'phone', 'language',
  'total_xp', 'streak_days', 'streak_freezes', 'best_streak',
  'last_active_date', 'total_lessons_done', 'last_active_at',
  'created_at', 'server_id', 'sync_status', 'updated_at',
  'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
  'country', 'state', 'city', 'address', 'email', 'photo_url', 'bio', 'profession',
];

async function upsertLearnerRow(db, learner) {
  if (!db || !learner || !learner.id) return;
  const now = new Date().toISOString();
  const get = (k, d) => (learner[k] !== undefined && learner[k] !== null) ? learner[k] : d;
  const cols = LEARNER_COLUMNS.join(', ');
  const placeholders = LEARNER_COLUMNS.map(() => '?').join(', ');
  const values = [
    learner.id, get('name', ''), get('phone', null), get('language', 'fr'),
    get('total_xp', 0), get('streak_days', 0), get('streak_freezes', 2), get('best_streak', 0),
    get('last_active_date', null), get('total_lessons_done', 0), get('last_active_at', now),
    get('created_at', now), get('server_id', null), get('sync_status', 'pending'), get('updated_at', now),
    get('first_name', null), get('last_name', null), get('gender', null),
    get('birth_date', null), get('education_level', null),
    get('country', null), get('state', null), get('city', null), get('address', null),
    get('email', null), get('photo_url', null), get('bio', null), get('profession', null),
  ];
  const updateSet = LEARNER_COLUMNS.slice(1).map(c => `${c} = excluded.${c}`).join(', ');
  await db.runAsync(
    `INSERT INTO learner (${cols}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updateSet}`,
    values
  );
}

// ── Snapshot du store mémoire (mode web / SQLite indisponible) ────────────
// v1.1.3 : sauvegarde TOUT l'état (learner, progress, quiz, badges, streaks,
// succès, objectif quotidien) sous une seule clé — restauré intégralement au
// démarrage. C'est LA correction du bug de persistance : avant, seules les
// anciennes clés séparées (ek_learner/ek_progress/ek_badges) étaient écrites,
// et uniquement quand `learner` changeait — les progressions récentes
// n'étaient jamais re-sauvegardées, et sur web rien n'était persisté du tout.
async function saveMemorySnapshot(store) {
  try {
    if (!store.learner?.id) return;
    const snapshot = {
      learner: store.learner,
      progress: store.progress,
      quizAttempts: store.quizAttempts,
      badges: store.badges,
      streakLogs: store.streakLogs,
      achievements: store.achievements,
      dailyGoal: store.dailyGoal,
      // v1.1.14 : la FILE DE SYNC fait partie du snapshot — avant, les
      // écritures faites en mode mémoire (web / base corrompue) étaient
      // bien dans le learner… mais leurs ops sync n’étaient JAMAIS
      // restaurées au redémarrage : rien ne repartait vers le serveur à la
      // reconnexion (le pull écrasait ensuite le profil local).
      syncQueue: store.syncQueue || [],
      savedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(snapshot);
    // v1.1.8 : snapshot SCOPÉ PAR COMPTE + clés legacy (« actif »)
    await persistentStorage.setItem(snapKey(store.learner.id), json);
    await persistentStorage.setItem(KEYS.SNAPSHOT, json);
    await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, store.learner.id);
  } catch (_) {}
}

// v1.1.14 : fusionne la file de sync d’un snapshot dans le store SANS
// écraser les ops déjà présentes (switchActiveLearner préserve la file du
// compte sortant — chaque op est attribuée à son compte par record_id).
// Déduplication par id : une même op ne peut pas être dupliquée.
function mergeSnapshotQueue(store, snap) {
  try {
    if (!Array.isArray(snap?.syncQueue) || snap.syncQueue.length === 0) return;
    if (!Array.isArray(store.syncQueue)) store.syncQueue = [];
    const existing = new Set(store.syncQueue.map(s => s.id));
    for (const item of snap.syncQueue) {
      if (item?.id && !existing.has(item.id)) store.syncQueue.push(item);
    }
  } catch (_) {}
}

async function loadMemorySnapshot(store, learnerId = null) {
  try {
    // v1.1.8 : priorité au snapshot DU COMPTE demandé (isolation des données)
    if (learnerId) {
      const scoped = await persistentStorage.getItem(snapKey(learnerId));
      if (scoped) {
        const snap = JSON.parse(scoped);
        if (snap?.learner?.id === learnerId) {
          store.learner = snap.learner;
          if (snap.progress) store.progress = snap.progress;
          if (snap.quizAttempts) store.quizAttempts = snap.quizAttempts;
          if (snap.badges) store.badges = snap.badges;
          if (snap.streakLogs) store.streakLogs = snap.streakLogs;
          if (snap.achievements) store.achievements = snap.achievements;
          if (snap.dailyGoal) store.dailyGoal = snap.dailyGoal;
          mergeSnapshotQueue(store, snap); // v1.1.14
          return true;
        }
      }
      // Pas de snapshot pour CE compte → ne PAS retomber sur celui d'un autre
      return false;
    }
    const raw = await persistentStorage.getItem(KEYS.SNAPSHOT);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (snap.learner) store.learner = snap.learner;
    if (snap.progress) store.progress = snap.progress;
    if (snap.quizAttempts) store.quizAttempts = snap.quizAttempts;
    if (snap.badges) store.badges = snap.badges;
    if (snap.streakLogs) store.streakLogs = snap.streakLogs;
    if (snap.achievements) store.achievements = snap.achievements;
    if (snap.dailyGoal) store.dailyGoal = snap.dailyGoal;
    mergeSnapshotQueue(store, snap); // v1.1.14
    return !!snap.learner;
  } catch (_) {
    return false;
  }
}

// ── v1.1.6 : comptes uniques web + mobile (restauration multi-appareils) ────
// Clé canonique : le learner local d'un utilisateur AUTHENTIFIÉ porte
// TOUJOURS l'id `lrn_<user.id>` — le même sur le web et dans l'app — pour que
// le serveur agrège toutes ses données sous une seule entrée. Un invité qui
// se connecte voit son learner local RENOMMÉ vers cet id canonique.
export function canonicalLearnerId(serverUser) {
  return serverUser?.id ? `lrn_${serverUser.id}` : null;
}

/** Meilleur nom d'affichage connu pour le compte (Google : display_name).
 *  Retourne '' si aucun nom exploitable (ex : comptes téléphone dont le
 *  display_name est juste le numéro) → l'app orientera vers l'Onboarding. */
function pickAccountDisplayName(serverUser, serverLearner) {
  const dn = serverUser?.display_name || serverUser?.first_name || serverUser?.name || '';
  const phoneLike = (v) => typeof v === 'string' && /^\+?\d[\d\s-]{6,}$/.test(v.trim());
  if (dn && !phoneLike(dn)) return String(dn).trim();
  // Compte téléphone (display_name = "+228…") : le learner serveur peut
  // connaître le vrai prénom choisi lors d'un précédent Onboarding.
  if (serverLearner?.name && !phoneLike(serverLearner.name)) return String(serverLearner.name).trim();
  return '';
}

/** Réduit les lignes module_progress renvoyées par le serveur à UNE ligne par
 *  module (le serveur peut conserver plusieurs client_id pour un même module
 *  après un changement d'appareil) — sémantique MAX par champ. */
function reduceServerProgressRows(rows) {
  const byModule = {};
  const rank = { not_started: 0, in_progress: 1, completed: 2 };
  for (const r of rows || []) {
    if (!r?.module_id) continue;
    const cur = byModule[r.module_id];
    if (!cur) { byModule[r.module_id] = { ...r }; continue; }
    byModule[r.module_id] = {
      ...cur,
      status: (rank[r.status] ?? 0) >= (rank[cur.status] ?? 0) ? (r.status ?? cur.status) : cur.status,
      current_lesson:  Math.max(cur.current_lesson || 0, r.current_lesson || 0),
      lessons_done:    Math.max(cur.lessons_done || 0, r.lessons_done || 0),
      total_xp_earned: Math.max(cur.total_xp_earned || 0, r.total_xp_earned || 0),
      best_score:      Math.max(cur.best_score || 0, r.best_score || 0),
      started_at:      cur.started_at || r.started_at || null,
      completed_at:    cur.completed_at || r.completed_at || null,
    };
  }
  return byModule;
}

// ── v1.1.5 : restaure un snapshot COMPLET dans SQLite (natif) ─────────────
// Sécurité de persistance : si la base SQLite a été vidée/réinitialisée
// (mise à jour de l'app, migration, corruption) alors qu'un snapshot existe
// dans le stockage persistant, on réinsère TOUT — le learner ET ses
// progressions, badges, succès, streaks et objectif quotidien. Avant, seul
// le learner était réinséré : l'utilisateur retrouvait son profil mais
// TOUTES ses progressions étaient perdues (« la persistance ne fonctionne
// pas »). Idempotent : ne fait rien si les tables contiennent déjà des
// lignes pour ce learner.
async function restoreSnapshotToSqlite(db, snap) {
  if (!db || !snap?.learner?.id) return false;
  const learnerId = snap.learner.id;
  try {
    // Learner
    await upsertLearnerRow(db, snap.learner);

    // Progressions
    const progRows = Object.values(snap.progress || {});
    for (const p of progRows) {
      const existing = await db.getFirstAsync(
        'SELECT id FROM module_progress WHERE learner_id = ? AND module_id = ?',
        [learnerId, p.module_id]
      );
      if (existing) continue;
      await db.runAsync(
        `INSERT INTO module_progress
         (id, learner_id, module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, started_at, completed_at, sync_status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [p.id ?? `${learnerId}_${p.module_id}`, learnerId, p.module_id,
         p.status ?? 'in_progress', p.current_lesson ?? 0, p.lessons_done ?? 0,
         p.total_xp_earned ?? 0, p.best_score ?? 0, p.started_at ?? null,
         p.completed_at ?? null, p.updated_at ?? new Date().toISOString()]
      );
    }

    // Badges
    for (const b of (snap.badges || [])) {
      const existing = await db.getFirstAsync(
        'SELECT id FROM badge WHERE learner_id = ? AND module_id = ?',
        [learnerId, b.module_id]
      );
      if (existing) continue;
      await db.runAsync(
        `INSERT INTO badge
         (id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [b.id, learnerId, b.module_id, b.module_title ?? '', b.score ?? 0,
         b.xp_total ?? 0, b.badge_hash ?? '', b.qr_payload ?? '',
         b.blockchain_tx ?? null, b.issued_at ?? new Date().toISOString()]
      );
    }

    // Quiz attempts (v1.1.14 — l'historique des tentatives était ABSENT de
    // la restauration : seuls learner/progressions/badges/streaks/objectif
    // revenaient ; l'historique des quiz passés offline disparaissait)
    for (const qa of (snap.quizAttempts || [])) {
      await db.runAsync(
        `INSERT OR IGNORE INTO quiz_attempt
         (id, learner_id, module_id, lesson_index, attempt_number, score, answers, xp_awarded, passed, completed_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [qa.id ?? `${learnerId}_${qa.module_id}_${qa.lesson_index}_${qa.attempt_number ?? 1}`,
         learnerId, qa.module_id, qa.lesson_index ?? 0, qa.attempt_number ?? 1,
         qa.score ?? 0, qa.answers ?? '[]', qa.xp_awarded ?? 0, qa.passed ?? 0,
         qa.completed_at ?? new Date().toISOString()]
      );
    }

    // Achievements
    for (const a of (snap.achievements || [])) {
      await db.runAsync(
        `INSERT OR IGNORE INTO achievement (id, learner_id, achievement_key, unlocked_at, sync_status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [`${learnerId}_${a.achievement_key}`, learnerId, a.achievement_key,
         a.unlocked_at ?? new Date().toISOString()]
      );
    }

    // Streak logs
    for (const [date, log] of Object.entries(snap.streakLogs || {})) {
      await db.runAsync(
        `INSERT OR IGNORE INTO streak_log
         (id, learner_id, activity_date, lessons_done, xp_earned, streak_freeze_used, goal_met, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [`${learnerId}_${date}`, learnerId, date,
         log.lessons_done ?? 0, log.xp_earned ?? 0, log.streak_freeze_used ?? 0,
         log.goal_met ?? 0, log.created_at ?? date, log.updated_at ?? date]
      );
    }

    // Objectif quotidien
    if (snap.dailyGoal?.goal_type) {
      await db.runAsync(
        `INSERT INTO daily_goal (id, learner_id, goal_type, goal_target, enabled, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(learner_id) DO UPDATE SET
           goal_type = excluded.goal_type, goal_target = excluded.goal_target,
           enabled = excluded.enabled, updated_at = excluded.updated_at`,
        [`goal_${learnerId}`, learnerId, snap.dailyGoal.goal_type,
         snap.dailyGoal.goal_target ?? 1, snap.dailyGoal.enabled ?? 1,
         snap.dailyGoal.updated_at ?? new Date().toISOString()]
      );
    }

    // File de sync (v1.1.14 — CRITIQUE pour le mode offline) : les ops
    // enregistrées pendant une session en mode mémoire (base corrompue,
    // depuis reconstruite par la Phase A de l'init) vivent UNIQUEMENT dans
    // le snapshot. Si on ne les réinsérait pas dans sync_queue, l'app étant
    // désormais repassée en mode SQLite, le SyncEngine lirait la TABLE
    // (vide) → les changements offline faits pendant la période « mode
    // mémoire » ne partiraient JAMAIS vers le serveur. INSERT OR IGNORE :
    // déduplication par id (une op déjà présente en table n'est pas
    // dupliquée — utile aussi pour la guérison, où la file n'est jamais
    // purgée).
    for (const q of (snap.syncQueue || [])) {
      if (!q?.id || !q?.table_name || !q?.record_id) continue;
      await db.runAsync(
        `INSERT OR IGNORE INTO sync_queue
         (id, table_name, record_id, operation, payload, queued_at, retry_count, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [q.id, q.table_name, q.record_id, q.operation ?? 'UPDATE',
         typeof q.payload === 'string' ? q.payload : JSON.stringify(q.payload ?? {}),
         q.queued_at ?? new Date().toISOString(), q.retry_count ?? 0, q.last_error ?? null]
      );
    }

    console.log('[DB] Snapshot complet restauré dans SQLite (persistance renforcée)');
    return true;
  } catch (e) {
    console.warn('[DB] restoreSnapshotToSqlite échec :', e.message);
    return false;
  }
}

// ── v1.1.8 : renommage canonique SQLite (module-level) ────────────────────
// Repointe TOUTES les lignes d'un learner (progressions, quiz, badges,
// streaks, succès, objectif) + la file de sync vers un nouvel id. Utilisé :
//   - à l'init (legacy server_id → id canonique du compte)
//   - par adoptCanonicalLearnerId (invité → compte)
async function renameLearnerRowsSqlite(db, oldId, newId) {
  if (!db || !oldId || !newId || oldId === newId) return;
  const old = await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [oldId]);
  if (!old) return;
  await upsertLearnerRow(db, { ...old, id: newId });
  await db.runAsync(
    `UPDATE module_progress SET learner_id = ?, id = ? || '_' || module_id WHERE learner_id = ?`,
    [newId, newId, oldId]
  );
  await db.runAsync('UPDATE quiz_attempt SET learner_id = ? WHERE learner_id = ?', [newId, oldId]);
  await db.runAsync('UPDATE badge SET learner_id = ? WHERE learner_id = ?', [newId, oldId]);
  await db.runAsync(
    `UPDATE streak_log SET learner_id = ?, id = ? || '_' || activity_date WHERE learner_id = ?`,
    [newId, newId, oldId]
  );
  await db.runAsync(
    `UPDATE achievement SET learner_id = ?, id = ? || '_' || achievement_key WHERE learner_id = ?`,
    [newId, newId, oldId]
  );
  await db.runAsync('UPDATE daily_goal SET learner_id = ?, id = ? WHERE learner_id = ?', [newId, `goal_${newId}`, oldId]);
  await db.runAsync('DELETE FROM learner WHERE id = ?', [oldId]);

  // File de sync : réécrire record_id + payload des opérations en attente
  const rows = await db.getAllAsync('SELECT id, table_name, record_id, payload FROM sync_queue');
  for (const row of rows) {
    let obj = null;
    try { obj = JSON.parse(row.payload); } catch (_) {}
    let recordId = row.record_id;
    let changed = false;
    if (obj && typeof obj === 'object') {
      if (obj.learner_id === oldId) { obj.learner_id = newId; changed = true; }
      if (obj.id === oldId) { obj.id = newId; changed = true; }
    }
    if (recordId === oldId) { recordId = newId; changed = true; }
    if (typeof recordId === 'string' && recordId.startsWith(oldId + '_')) {
      recordId = newId + recordId.slice(oldId.length);
      if (obj && typeof obj === 'object') obj.id = recordId;
      changed = true;
    }
    if (recordId === `goal_${oldId}`) {
      recordId = `goal_${newId}`;
      if (obj && typeof obj === 'object') obj.id = recordId;
      changed = true;
    }
    if (changed) {
      const payload = obj ? JSON.stringify(obj) : row.payload;
      await db.runAsync('UPDATE sync_queue SET record_id = ?, payload = ? WHERE id = ?', [recordId, payload, row.id]);
    }
  }
  console.log(`[DB] Learner renommé (SQLite) : ${oldId} → ${newId}`);
}

// ── v1.1.7 : filet de sécurité session-first (ensureSessionLearner) ────────
// Si une session est ACTIVE mais qu'AUCUN learner n'a pu être restauré
// (SQLite vide/corrompue + snapshot illisible), on recrée le profil DEPUIS
// le compte stocké (ek_user, lu via SecureStore/AsyncStorage — la dernière
// couche encore lisible). L'utilisateur garde ainsi son dashboard (« jusqu'à
// ce qu'il se déconnecte ») et ses progressions serveur seront re-téléchargées
// par l'auto-restauration / la sync pull.
// Attendu : appelé à la FIN de l'init, avant setReady(true).
async function ensureSessionLearner(nativeDb, store, setLearnerFn, persistSnapshotFn) {
  if (store.learner) return; // déjà restauré — rien à faire
  try {
    const stored = await authService.getStoredAuth();
    // Session authentifiée active uniquement (l'invité sans learner doit
    // repasser par l'Onboarding : on n'a pas son prénom en stock).
    if (!stored?.user || stored.sessionEnded || !stored.accessToken) return;
    const u = stored.user;
    const phoneLike = (v) => typeof v === 'string' && /^\+?\d[\d\s-]{6,}$/.test(v.trim());
    const dn = u.display_name || u.first_name || u.name || '';
    const name = (dn && !phoneLike(dn) && dn.trim())
      || (u.email ? u.email.split('@')[0] : 'Apprenant');
    const now = new Date().toISOString();
    const learner = {
      id: canonicalLearnerId(u) || `lrn_${u.id}`,
      name: String(name).trim(),
      phone: u.phone || null,
      language: u.language || 'fr',
      // v1.1.8 : l'email du compte (Google : email vérifié) et l'avatar sont
      // connus dès la création — « l'email doit être connu pour un utilisateur
      // ayant connecté son compte Google ».
      email: u.email || null,
      photo_url: u.avatar_url || u.picture || null,
      total_xp: 0, streak_days: 0, streak_freezes: 2, best_streak: 0,
      last_active_date: null, total_lessons_done: 0,
      last_active_at: now, created_at: now,
      server_id: String(u.id), sync_status: 'pending', updated_at: now,
    };
    if (nativeDb) {
      try {
        await upsertLearnerRow(nativeDb, learner);
      } catch (e) {
        console.warn('[DB] ensureSessionLearner : upsert SQLite ignoré :', e.message);
      }
    }
    store.learner = learner;
    setLearnerFn(learner);
    try { await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(learner)); } catch (_) {}
    if (persistSnapshotFn) persistSnapshotFn();
    console.log('[DB] ensureSessionLearner : profil de secours recréé depuis ek_user (', learner.name, ')');
  } catch (e) {
    console.warn('[DB] ensureSessionLearner échec :', e.message);
  }
}

// ── v1.1.8 : champs du profil étendu fusionnés depuis le serveur ──────────
// « Certaines données ne sont toujours pas maintenues ni synchronisées, il
//  s'agit par exemples des informations de l'utilisateur (profil) » :
// auparavant la fusion pull ne copiait QUE XP/streaks/phone/language — les
// champs de profil (prénom, nom, email, ville, bio…) remplis sur un autre
// appareil n'étaient JAMAIS ramenés. Règle : la valeur locale gagne si elle
// est remplie, sinon on prend celle du serveur (jamais d'écrasement).
const PROFILE_FIELDS = [
  'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
  'country', 'state', 'city', 'address', 'email', 'photo_url', 'bio', 'profession',
];

// v1.1.11 : une DATA URI (photo auto-contenue, toujours affichable) est
// STABLE — une URL http distante (avatar Google lh3.googleusercontent.com…)
// est PÉRISSABLE (rotation/expiration). Sans cette règle, une URL morte
// LOCALE battait une data URI fraîche du serveur → « la photo de profil
// n'est pas conservée ».
const isDataUri = (v) => typeof v === 'string' && v.startsWith('data:');

function mergeProfileFields(localLearner, serverLearner) {
  const merged = {};
  for (const f of PROFILE_FIELDS) {
    const lv = localLearner?.[f];
    const sv = serverLearner?.[f];
    if (f === 'photo_url') {
      // photo : data URI (locale ou serveur) > valeur locale remplie > serveur
      if (isDataUri(lv)) merged[f] = lv;
      else if (isDataUri(sv)) merged[f] = sv;
      else merged[f] = (lv !== undefined && lv !== null && String(lv).trim() !== '') ? lv : (sv ?? null);
      continue;
    }
    merged[f] = (lv !== undefined && lv !== null && String(lv).trim() !== '') ? lv : (sv ?? null);
  }
  return merged;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function DbProvider({ children }) {
  const [db, setDb]           = useState(null);
  const [learner, setLearner] = useState(null);
  const [ready, setReady]     = useState(false);
  const [error, setError]     = useState(null);
  // v1.1.14 : cause exacte d'un fallback mémoire / d'une reconstruction —
  // affichée dans « Diagnostics du stockage » (ProfileScreen) pour que
  // l'utilisateur (et le support) voie POURQUOI SQLite serait indisponible.
  const [dbInitError, setDbInitError] = useState(null);
  const storeRef              = useRef(memoryStore);

  // ── Synchroniser le learner actif dans le stockage persistant à chaque changement ──
  // Garantit que le learner survit au redémarrage même sans SQLite.
  // v1.1.8 : maintient AUSSI le pointeur de session ek_active_learner_id —
  // c'est lui qui, au démarrage, désigne le learner du COMPTE CONNECTÉ
  // (isolation multi-comptes : jamais un LIMIT 1 arbitraire).
  useEffect(() => {
    if (learner) {
      persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(learner)).catch(() => {});
      persistentStorage.setItem(KEYS.ACTIVE_LEARNER, learner.id).catch(() => {});
    }
  }, [learner]);

  // ── Persister un snapshot complet après chaque mutation ────────────────
  // v1.1.3 : l'ancien useEffect ne se déclenchait qu'au changement du
  // learner — les PROGRESSIONS (leçons terminées, quiz, badges) n'étaient
  // jamais re-sauvegardées. persistSnapshot est maintenant appelé après
  // CHAQUE mutation publique (createLearner, updateProgress, saveQuizAttempt,
  // issueBadge, addXP, recordLessonCompleted, setDailyGoal, updateProfile).
  const persistSnapshot = useCallback(() => {
    saveMemorySnapshot(storeRef.current);
  }, []);

  // ── Initialisation ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        let nativeDb = null;
        let initErr  = null;

        // ── Phase A : ouverture SQLite + schéma — AVEC AUTO-RÉPARATION ──
        // v1.1.14 : avant, le MOINDRE échec dans le bloc ci-dessous
        // (fichier corrompu par un crash pendant une écriture — l'app a
        // traversé ~9 mises à jour APK avec le MÊME fichier edukraft.db —
        // WAL endommagé, etc.) faisait échouer le PREMIER PRAGMA → l'app
        // retombait en « mode mémoire » À CHAQUE démarrage : le diagnostic
        // affichait « SQLite ✗ indisponible (mode mémoire) » alors
        // qu'expo-sqlite est bien embarqué dans l'APK, et toutes les
        // écritures ne survivaient que par le snapshot AsyncStorage.
        // Désormais :
        //   1. base illisible → suppression + RECONSTRUCTION automatique
        //      (les données sont intégralement restaurées depuis le snapshot
        //      persistant par la Phase D ci-dessous) ;
        //   2. setDb est posé IMMÉDIATEMENT après le schéma : la sélection du
        //      learner et les restaurations (Phases B-D) sont best-effort et
        //      ne peuvent PLUS rétrograder l'app en mode mémoire.
        try {
          const SQLite = require('expo-sqlite');
          try {
            nativeDb = await SQLite.openDatabaseAsync('edukraft.db');
            await initSchema(nativeDb);
          } catch (dbOpenErr) {
            // Base corrompue/illisible → reconstruction complète (db + wal + shm)
            initErr = `base reconstruite (origine : ${dbOpenErr?.message || dbOpenErr})`;
            console.warn('[DB] Base illisible/corrompue — reconstruction automatique :', dbOpenErr?.message || dbOpenErr);
            try { nativeDb?.closeAsync?.(); } catch (_) {}
            nativeDb = null;
            try {
              await SQLite.deleteDatabaseAsync('edukraft.db'); // efface db + -wal + -shm
            } catch (_) {}
            nativeDb = await SQLite.openDatabaseAsync('edukraft.db');
            await initSchema(nativeDb);
            console.log('[DB] Base reconstruite — les données seront restaurées depuis le snapshot persistant');
          }

          // v1.1.14 : setDb TÔT — dès que SQLite + schéma sont opérationnels.
          // Une erreur dans les phases suivantes ne doit JAMAIS faire
          // retomber l'app en mode mémoire (les repos écriraient alors hors
          // de SQLite alors que la base est saine).
          setDb(nativeDb);

          // ── Phase B : SÉLECTION DU LEARNER PAR SESSION (best-effort) ──
          // v1.1.8 : isolation multi-comptes — Avant : « SELECT * FROM
          // learner LIMIT 1 » chargeait le PREMIER learner de la table,
          // quel que soit le compte connecté → après une déconnexion du
          // compte A puis connexion au compte B, les données de A
          // s'affichaient. Désormais chaque ligne de chaque table est liée
          // à un utilisateur via son ID (lrn_<user.id>) et on ne charge QUE
          // le learner de la session courante.
          let storedAuth = null;
          let expectedId = null;
          let row = null;
          try {
            storedAuth = await authService.getStoredAuth();
            expectedId = resolveSessionLearnerId(storedAuth);

            if (expectedId) {
            // 1. Ligne canonique du compte (lrn_<user.id>)
            row = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE id = ?', [expectedId]);
            // 2. Legacy : ligne liée par server_id (appareil v1.1.6-1.1.7)
            if (!row && storedAuth.user) {
              const legacy = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE server_id = ? LIMIT 1', [String(storedAuth.user.id)]);
              if (legacy && legacy.id !== expectedId) {
                try {
                  // v1.1.8 : renameLearnerRowsSqlite module-level (nativeDb
                  // direct — le `db` du contexte est encore null à l'init)
                  await renameLearnerRowsSqlite(nativeDb, legacy.id, expectedId);
                  row = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE id = ?', [expectedId]);
                } catch (_) { row = legacy; }
              } else if (legacy) {
                row = legacy;
              }
            }
          } else {
            // Invité / déconnecté : pointeur de session, sinon la ligne invité
            // (server_id IS NULL), sinon l'unique ligne (appareil mono-compte)
            let pointerId = null;
            try { pointerId = await persistentStorage.getItem(KEYS.ACTIVE_LEARNER); } catch (_) {}
            if (pointerId) {
              row = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE id = ?', [pointerId]);
            }
            if (!row) {
              row = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE server_id IS NULL ORDER BY created_at DESC LIMIT 1');
            }
            if (!row) {
              row = await nativeDb.getFirstAsync('SELECT * FROM learner ORDER BY created_at DESC LIMIT 1');
            }
          }
          } catch (selErr) {
            // v1.1.14 : best-effort — une relecture impossible (base
            // endommagée en profondeur) NE FAIT PAS tomber l'app en mode
            // mémoire (setDb est déjà posé) : on tente la restauration par
            // snapshot ci-dessous, sinon ensureSessionLearner recréera le
            // profil de secours. L'erreur est tracée pour le diagnostic.
            console.warn('[DB] Sélection du learner impossible :', selErr?.message || selErr);
            if (!initErr) initErr = `relecture impossible (${selErr?.message || selErr})`;
          }

          if (row) {
            setLearner(row);
            // v1.1.7 : alimenter AUSSI le store mémoire (mode fallback) —
            // avant, seul l'état React était rempli : si SQLite tombait en
            // panne plus tard, les mutations basculaient en mémoire sur un
            // store VIDE (learner null → addXP/updateProgress sans effet).
            storeRef.current.learner = row;
            // Aussi sauvegarder dans le stockage persistant (fallback)
            try {
              await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(row));
              await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, row.id);
            } catch (_) {}

            // ── v1.1.14 : GUÉRISON « snapshot plus récent que SQLite » ──────
            // Si l'app a fonctionné en mode mémoire (base corrompue à
            // l'époque — reconstruite depuis par la Phase A), les données
            // écrites pendant ces sessions ne vivent QUE dans le snapshot
            // AsyncStorage : la ligne SQLite est plus ANCIENNE. On restaure
            // alors le snapshot complet DANS SQLite (source la plus fraîche)
            // — sinon les changements offline « disparaissaient » au boot
            // suivant dès que SQLite redevenait accessible.
            try {
              const snapHealRaw = await persistentStorage.getItem(snapKey(row.id));
              if (snapHealRaw) {
                const snapHeal = JSON.parse(snapHealRaw);
                const snapTime = snapHeal?.savedAt || snapHeal?.learner?.updated_at || null;
                const rowTime  = row.updated_at || null;
                if (snapTime && rowTime && Date.parse(snapTime) > Date.parse(rowTime)) {
                  // Purger les lignes du learner (JAMAIS la file de sync —
                  // les ops en attente doivent partir) puis tout restaurer.
                  for (const tbl of ['module_progress', 'quiz_attempt', 'badge', 'achievement', 'streak_log', 'daily_goal']) {
                    try { await nativeDb.runAsync(`DELETE FROM ${tbl} WHERE learner_id = ?`, [row.id]); } catch (_) {}
                  }
                  await restoreSnapshotToSqlite(nativeDb, snapHeal);
                  const healed = await nativeDb.getFirstAsync('SELECT * FROM learner WHERE id = ?', [row.id]);
                  if (healed) {
                    row = healed;
                    setLearner(healed);
                    storeRef.current.learner = healed;
                    try { await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(healed)); } catch (_) {}
                    console.log('[DB] Snapshot plus récent que SQLite — données restaurées (guérison v1.1.14)');
                  }
                }
              }
            } catch (healErr) {
              console.warn('[DB] Guérison snapshot impossible :', healErr?.message);
            }

            // ── v1.1.10 : RÉPARATION des objectifs orphelins ──
            // Bug de closure v1.1.9 : l'objectif de l'Onboarding était écrit
            // avec learner_id NULL / id « goal_undefined » → invisible pour
            // getDailyGoal (WHERE learner_id = ?) et jamais poussé. On
            // repointe la ligne vers le learner ACTIF puis on l'enfile pour
            // le serveur (INSERT direct sync_queue, comme syncRepository).
            try {
              const orphanGoal = await nativeDb.getFirstAsync(
                "SELECT * FROM daily_goal WHERE learner_id IS NULL OR id = 'goal_undefined' OR learner_id = 'undefined'"
              );
              if (orphanGoal) {
                await nativeDb.runAsync(
                  'UPDATE daily_goal SET learner_id = ?, id = ? WHERE id = ?',
                  [row.id, `goal_${row.id}`, orphanGoal.id]
                );
                const fixed = await nativeDb.getFirstAsync(
                  'SELECT * FROM daily_goal WHERE learner_id = ?', [row.id]
                );
                if (fixed) {
                  await nativeDb.runAsync(
                    `INSERT INTO sync_queue (id, table_name, record_id, operation, payload, queued_at, retry_count)
                     VALUES (?, ?, ?, ?, ?, ?, 0)`,
                    [
                      `sq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      'daily_goal', 'UPDATE', fixed.id, JSON.stringify({
                        learner_id: row.id,
                        goal_type: fixed.goal_type,
                        goal_target: fixed.goal_target,
                        enabled: fixed.enabled ?? 1,
                        updated_at: fixed.updated_at || new Date().toISOString(),
                      }),
                      new Date().toISOString(),
                    ]
                  );
                  console.log('[DB] v1.1.10 : objectif orphelin réparé et ré-enfilé pour', row.id);
                }
              }
            } catch (e) {
              console.warn('[DB] Réparation objectif orphelin :', e.message);
            }
          } else {
            // Pas de learner en SQLite pour CETTE session — vérifier le
            // stockage persistant (v1.1.8 : snapshot SCOPÉ au compte attendu)
            try {
              // v1.1.5 : essayer d'abord le SNAPSHOT COMPLET (learner +
              // progressions + badges + succès + streaks + objectif) —
              // réinséré intégralement dans SQLite. Avant, seul le learner
              // était réinséré : le profil revenait mais toutes les
              // progressions étaient perdues.
              let snapRaw = null;
              try { snapRaw = await persistentStorage.getItem(expectedId ? snapKey(expectedId) : KEYS.SNAPSHOT); } catch (_) {}
              // Compat : ancienne clé globale — acceptée UNIQUEMENT si elle
              // correspond au compte attendu (ou mode invité mono-compte)
              if (!snapRaw && !expectedId) {
                try { snapRaw = await persistentStorage.getItem(KEYS.SNAPSHOT); } catch (_) {}
              }
              if (snapRaw) {
                const snap = JSON.parse(snapRaw);
                const snapBelongsToSession = !expectedId || snap?.learner?.id === expectedId
                  || String(snap?.learner?.server_id || '') === String(storedAuth?.user?.id || '');
                if (snapBelongsToSession) {
                  await restoreSnapshotToSqlite(nativeDb, snap);
                  if (snap.learner) {
                    storeRef.current.learner = snap.learner;
                    // Le store mémoire sert de fallback — on le remplit aussi
                    await loadMemorySnapshot(storeRef.current, snap.learner.id);
                    setLearner(snap.learner);
                  }
                } else {
                  console.log('[DB] Snapshot ignoré : appartient à un autre compte (isolation v1.1.8)');
                }
              } else {
                const storedLearner = await persistentStorage.getItem(KEYS.LEARNER);
                if (storedLearner) {
                  const parsed = JSON.parse(storedLearner);
                  const belongs = !expectedId || parsed?.id === expectedId
                    || String(parsed?.server_id || '') === String(storedAuth?.user?.id || '');
                  if (belongs) {
                    // v1.1 : RÉINSÉRER le learner dans SQLite (avant il restait
                    // uniquement en state → get()/addXP() retournaient null)
                    try {
                      await upsertLearnerRow(nativeDb, parsed);
                      console.log('[DB] Learner réinséré en SQLite depuis le stockage persistant');
                    } catch (reinsertErr) {
                      console.warn('[DB] Échec réinsertion SQLite :', reinsertErr.message);
                    }
                    storeRef.current.learner = parsed;
                    setLearner(parsed);
                    console.log('[DB] Learner restauré (SQLite vide → stockage persistant)');
                  }
                }
              }
            } catch (_) {}
          }

          // (setDb est déjà posé depuis la Phase A — v1.1.14)
          console.log('[DB] SQLite natif initialisé' + (initErr ? ` — ${initErr}` : ''));
        } catch (sqliteErr) {
          // expo-sqlite non disponible (web, etc.) > fallback mémoire
          initErr = initErr || sqliteErr?.message || String(sqliteErr);
          console.log('[DB] SQLite non disponible, mode mémoire activé :', initErr);

          // v1.1.3 : restaurer le SNAPSHOT COMPLET depuis le stockage
          // persistant (learner + progressions + badges + streaks + succès).
          // Avant : sur web le require AsyncStorage échouait silencieusement
          // → rien n'était restauré → écran Login à chaque rechargement.
          // v1.1.8 : snapshot SCOPÉ AU COMPTE de la session (un autre compte
          // ayant utilisé ce navigateur ne doit JAMAIS être restauré ici).
          const storedAuthMem = await authService.getStoredAuth();
          const expectedIdMem = resolveSessionLearnerId(storedAuthMem);
          const restoredFromSnapshot = await loadMemorySnapshot(storeRef.current, expectedIdMem);
          if (restoredFromSnapshot) {
            console.log('[DB] Snapshot complet restauré (learner + progressions)');
            setLearner(storeRef.current.learner);
          } else {
            // Compat : ancienne clé individuelle (ek_learner seul) — acceptée
            // uniquement si elle correspond au compte attendu (isolation v1.1.8)
            try {
              const storedLearner = await persistentStorage.getItem(KEYS.LEARNER);
              if (storedLearner) {
                const parsed = JSON.parse(storedLearner);
                const belongs = !expectedIdMem || parsed?.id === expectedIdMem
                  || String(parsed?.server_id || '') === String(storedAuthMem?.user?.id || '');
                if (belongs) {
                  storeRef.current.learner = parsed;
                  setLearner(parsed);
                  console.log('[DB] Learner restauré depuis le stockage persistant');
                } else {
                  console.log('[DB] ek_learner ignoré : appartient à un autre compte (isolation v1.1.8)');
                }
              }
            } catch (_) {}
          }

          if (storeRef.current.learner) {
            setLearner(storeRef.current.learner);
          }
        }

        // ── v1.1.7 : filet de sécurité session-first ──
        // Session active + aucun learner restauré (SQLite ET snapshot vides)
        // → profil recréé depuis ek_user. Garantit l'exigence « dashboard
        // jusqu'à déconnexion » même si une couche de stockage échoue.
        await ensureSessionLearner(nativeDb, storeRef.current, setLearner, persistSnapshot);

        // ── v1.1.7 : catalogue de cours distant (cache offline) ──
        // Applique AVANT ready : le Dashboard affiche d'emblée les cours
        // distants téléchargés lors d'une session précédente (hors ligne).
        try { await initRemoteModules(); } catch (_) {}

        setDbInitError(initErr); // v1.1.14 : visible dans « Diagnostics du stockage »
        setReady(true);
      } catch (e) {
        console.error('[DB] Initialisation échouée :', e);
        setError(e.message);
        setDbInitError(initErr || e?.message || null); // v1.1.14
        // v1.1.7 : même en erreur d'init, tenter le profil de secours
        try {
          await ensureSessionLearner(null, storeRef.current, setLearner, persistSnapshot);
        } catch (_) {}
        setReady(true); // Même en erreur, on débloque l'UI
      }
    })();
  }, []);

  // ── Instanciation des repositories (recréés quand db change) ────────────
  // Chaque repo reçoit (db, store, enqueue). L'enqueue est créé après les repos
  // mais c'est OK car il est appelé de façon différée (pas au constructeur).
  const syncRepo = useRef(null);
  if (!syncRepo.current) syncRepo.current = createSyncRepository(db, storeRef.current);
  // Re-créer si db change (la ref est mise à jour)
  const getSyncRepo = useCallback(() => {
    if (syncRepo.current === null || syncRepo.current.db !== db) {
      syncRepo.current = createSyncRepository(db, storeRef.current);
    }
    return syncRepo.current;
  }, [db]);

  const enqueue = useCallback(async (tableName, operation, recordId, payload) => {
    return getSyncRepo().enqueue(tableName, operation, recordId, payload);
  }, [getSyncRepo]);

  // Repositories principaux (recréés quand db ou enqueue change)
  const learnerRepo = useCallback(() => createLearnerRepository(db, storeRef.current, enqueue), [db, enqueue]);
  const progressRepo = useCallback(() => createProgressRepository(db, storeRef.current, enqueue), [db, enqueue]);
  const badgeRepo = useCallback(() => createBadgeRepository(db, storeRef.current, enqueue), [db, enqueue]);
  const gamificationRepo = useCallback(() => createGamificationRepository(db, storeRef.current, enqueue), [db, enqueue]);

  // ── Learner ───────────────────────────────────────────────────────────
  const createLearner = useCallback(async ({ id, name, phone, language = 'fr', server_id = null, email = null, photo_url = null }) => {
    const result = await learnerRepo().create({ id, name, phone, language, server_id, email, photo_url });
    setLearner(result);
    storeRef.current.learner = result;
    // Persister dans le stockage multi-plateforme + snapshot complet
    try {
      await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(result));
      await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, result.id);
    } catch (_) {}
    persistSnapshot();
    return result;
  }, [learnerRepo, persistSnapshot]);

  const addXP = useCallback(async (amount) => {
    if (!learner) return null;
    const totalXp = await learnerRepo().addXP(learner, amount);
    // Recharger le learner pour l'UI
    const updated = await learnerRepo().get();
    setLearner(updated);
    storeRef.current.learner = updated || storeRef.current.learner;
    // Persister dans le stockage multi-plateforme
    if (updated) {
      try {
        await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(updated));
      } catch (_) {}
    }
    persistSnapshot();
    return totalXp;
  }, [learner, learnerRepo, persistSnapshot]);

  /** Met à jour les champs du profil étendu (v1.1). */
  const updateProfile = useCallback(async (fields) => {
    if (!learner) return null;
    const updated = await learnerRepo().updateProfile(learner.id, fields);
    setLearner(updated);
    storeRef.current.learner = updated || storeRef.current.learner;
    // Enqueue pour sync (type 'learner' avec operation UPDATE)
    if (enqueue) await enqueue('learner', 'UPDATE', learner.id, updated);
    persistSnapshot();
    return updated;
  }, [learner, learnerRepo, enqueue, persistSnapshot]);

  /**
   * v1.1.3 : lie le learner local à un compte serveur (après inscription ou
   * connexion). Le learner GARDE toutes ses progressions locales — il gagne
   * un server_id pour la synchronisation. Utilisé notamment quand un invité
   * crée son compte au moment de demander une déconnexion : ses données
   * locales deviennent rattachées au compte et seront synchronisées.
   *
   * v1.1.8 : GARDE D'ISOLATION — on ne lie JAMAIS au compte B un learner qui
   * appartient déjà au compte A (bug « après déconnexion puis connexion à un
   * autre compte, ce sont les informations de l'ancien utilisateur qui
   * apparaissent »). Seuls un invité (server_id NULL) ou le learner du compte
   * lui-même peuvent être liés. Le changement de compte réel est opéré par
   * restoreFromServer → switchActiveLearner.
   */
  const linkLearnerToAccount = useCallback(async (serverUser) => {
    if (!learner || !serverUser?.id) return learner;
    // v1.1.8 : refus si le learner actif appartient à un AUTRE compte
    if (learner.server_id && String(learner.server_id) !== String(serverUser.id)) {
      // v1.1.9 : EXCEPTION — même EMAIL = même compte RECRÉÉ côté serveur.
      // Le disque Render étant éphémère, le find-or-create peut générer un
      // NOUVEL user.id pour le même utilisateur (même email Google/email).
      // Refuser le lien ici ferait traiter ce cas comme un « changement de
      // compte » → bascule vers un learner VIDE (objectif, photo, profil,
      // XP perdus). On autorise donc le re-liage quand l'email coïncide —
      // la promesse « comptes uniques par email » (v1.1.6) reste intacte.
      const sameEmail = !!(learner.email && serverUser.email
        && String(learner.email).toLowerCase().trim() === String(serverUser.email).toLowerCase().trim());
      if (!sameEmail) {
        console.warn('[DB] linkLearnerToAccount REFUSÉ : le learner actif appartient à un autre compte (isolation v1.1.8)');
        return learner; // restoreFromServer effectuera le switch de profil
      }
      console.log('[DB] linkLearnerToAccount : compte serveur recréé (même email) — re-liage autorisé');
    }
    const now = new Date().toISOString();
    try {
      if (db) {
        await db.runAsync(
          'UPDATE learner SET server_id = ?, sync_status = ?, updated_at = ? WHERE id = ?',
          [String(serverUser.id), 'pending', now, learner.id]
        );
        // v1.1.8 : relecture SCOPÉE par id (jamais GET_LEARNER LIMIT 1)
        const refreshed = await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [learner.id]);
        if (refreshed) {
          setLearner(refreshed);
          storeRef.current.learner = refreshed;
          try {
            await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(refreshed));
          } catch (_) {}
        }
      } else {
        // Mode mémoire
        const updated = {
          ...storeRef.current.learner,
          server_id: String(serverUser.id),
          sync_status: 'pending',
          updated_at: now,
        };
        storeRef.current.learner = updated;
        setLearner(updated);
        try {
          await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(updated));
        } catch (_) {}
      }
      // Enqueue pour que la sync pousse le learner vers le compte serveur
      if (enqueue) {
        await enqueue('learner', 'UPDATE', learner.id, storeRef.current.learner);
      }
      persistSnapshot();
      console.log('[DB] Learner lié au compte serveur', serverUser.id);
    } catch (e) {
      console.warn('[DB] linkLearnerToAccount échec :', e.message);
    }
    return storeRef.current.learner;
  }, [learner, db, enqueue, persistSnapshot]);

  /** Calcule le pourcentage de complétion du profil. */
  const getProfileCompletion = useCallback(() => {
    if (!learner) return 0;
    const fields = [
      'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
      'country', 'state', 'city', 'address', 'phone', 'email', 'profession',
    ];
    const filled = fields.filter(f => learner[f] && String(learner[f]).trim() !== '').length;
    return Math.round((filled / fields.length) * 100);
  }, [learner]);

  // ── v1.1.6 : RENOMMAGE canonique du learner local ──────────────────────
  // Un invité (id lrn_<timestamp>) qui se connecte adopte l'id canonique de
  // son compte (lrn_<user.id>) : ses lignes locales (progressions, quiz,
  // badges, streaks, succès, objectif) sont repointées, et les opérations
  // encore en file d'attente sont réécrites. Web et mobile partagent ainsi
  // la MÊME clé de synchronisation serveur pour un même compte.
  //
  // ⚠️ v1.1.8 : ce renommage n'est autorisé QUE pour un invité NON LIÉ
  // (server_id NULL) ou une ligne appartenant DÉJÀ au compte cible — jamais
  // pour transférer les données d'un compte vers un autre (voir
  // restoreFromServer / switchActiveLearner).
  const adoptCanonicalLearnerId = useCallback(async (oldId, newId) => {
    if (!oldId || !newId || oldId === newId) return;

    if (!db) {
      // ── Mode mémoire (web) ──
      const s = storeRef.current;
      if (s.learner?.id === oldId) s.learner = { ...s.learner, id: newId, updated_at: new Date().toISOString() };
      for (const [moduleId, p] of Object.entries(s.progress || {})) {
        if (p.learner_id === oldId) s.progress[moduleId] = { ...p, learner_id: newId, id: `${newId}_${moduleId}` };
      }
      s.quizAttempts = (s.quizAttempts || []).map(a => (a.learner_id === oldId ? { ...a, learner_id: newId } : a));
      s.badges = (s.badges || []).map(b => (b.learner_id === oldId ? { ...b, learner_id: newId } : b));
      // achievements / streakLogs / dailyGoal du store mémoire ne portent pas
      // de learner_id (portée implicite) — rien à réécrire.
      // File de sync : réécrire record_id + payload
      for (const item of s.syncQueue || []) {
        let obj = null;
        try { obj = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload; } catch (_) {}
        let changed = false;
        if (obj && typeof obj === 'object') {
          if (obj.learner_id === oldId) { obj.learner_id = newId; changed = true; }
          if (obj.id === oldId) { obj.id = newId; changed = true; }
        }
        if (item.record_id === oldId) { item.record_id = newId; changed = true; }
        if (typeof item.record_id === 'string' && item.record_id.startsWith(oldId + '_')) {
          item.record_id = newId + item.record_id.slice(oldId.length);
          if (obj && typeof obj === 'object') obj.id = item.record_id;
          changed = true;
        }
        if (item.record_id === `goal_${oldId}`) {
          item.record_id = `goal_${newId}`;
          if (obj && typeof obj === 'object') obj.id = item.record_id;
          changed = true;
        }
        if (changed && obj) item.payload = JSON.stringify(obj);
      }
      console.log(`[DB] Learner renommé (mémoire) : ${oldId} → ${newId}`);
      return;
    }

    // ── SQLite natif ──
    await renameLearnerRowsSqlite(db, oldId, newId);
  }, [db]);

  // ── v1.1.6 : FUSION de l'état serveur dans l'état local (MAX par champ) ──
  // Après le pull : XP/streaks/progressions prennent le MAX des deux mondes,
  // les badges et succès absents localement sont importés, et les valeurs
  // locales supérieures sont renfilées dans la file de sync pour que le
  // serveur converge vers l'union (web ↔ mobile).
  const mergeServerStateIntoLocal = useCallback(async (sv, canonicalId) => {
    if (!sv) return;
    const now = new Date().toISOString();
    const { QUERIES } = require('./schema');
    const pushOps = []; // ops à enfiler APRÈS l'op learner (ordre important)

    if (!db) {
      // ── Mode mémoire (web) ──
      const s = storeRef.current;
      const svLearner = sv.learner;

      // Learner : MAX des champs numériques + champs de profil (v1.1.8)
      if (s.learner && svLearner) {
        const merged = { ...s.learner };
        merged.total_xp           = Math.max(s.learner.total_xp || 0, svLearner.total_xp || 0);
        merged.streak_days        = Math.max(s.learner.streak_days || 0, svLearner.streak_days || 0);
        merged.best_streak        = Math.max(s.learner.best_streak || 0, svLearner.best_streak || 0);
        merged.streak_freezes     = Math.max(s.learner.streak_freezes ?? 2, svLearner.streak_freezes ?? 2);
        merged.total_lessons_done = Math.max(s.learner.total_lessons_done || 0, svLearner.total_lessons_done || 0);
        merged.phone   = s.learner.phone || svLearner.phone || null;
        merged.language = s.learner.language || svLearner.language || 'fr';
        // v1.1.8 : profil étendu — le serveur complète les champs locaux vides
        Object.assign(merged, mergeProfileFields(s.learner, svLearner));
        merged.updated_at = now;
        s.learner = merged;
      }

      // Progressions (MAX par module)
      const svProgress = reduceServerProgressRows(sv.progress || []);
      for (const [moduleId, sp] of Object.entries(svProgress)) {
        const lp = s.progress[moduleId];
        const rank = { not_started: 0, in_progress: 1, completed: 2 };
        const merged = {
          id: lp?.id ?? `${canonicalId}_${moduleId}`,
          learner_id: canonicalId,
          module_id: moduleId,
          status: (rank[lp?.status] ?? 0) >= (rank[sp.status] ?? 0) ? (lp?.status ?? sp.status) : sp.status,
          current_lesson:  Math.max(lp?.current_lesson || 0, sp.current_lesson || 0),
          lessons_done:    Math.max(lp?.lessons_done || 0, sp.lessons_done || 0),
          total_xp_earned: Math.max(lp?.total_xp_earned || 0, sp.total_xp_earned || 0),
          best_score:      Math.max(lp?.best_score || 0, sp.best_score || 0),
          started_at:      lp?.started_at || sp.started_at || now,
          completed_at:    lp?.completed_at || sp.completed_at || null,
          updated_at: now,
        };
        s.progress[moduleId] = merged;
        if (lp) pushOps.push(['module_progress', 'UPDATE', merged.id, merged]);
      }

      // Badges : importer ceux du serveur absents localement
      // v1.1.12 : RÉCONCILIATION DES DATES — avant, un badge serveur pour un
      // module déjà badgé localement était IGNORÉ (`continue`) : chaque
      // appareil gardait « sa » date d'émission (horloge de l'appareil qui a
      // (re-)gagné le badge) → « badges avec des dates différentes entre le
      // web et le mobile », divergence PERMANENTE. Désormais : la date la
      // PLUS ANCIENNE gagne (première fois que le badge a réellement été
      // gagné) — côté local (UPDATE) et côté serveur (re-push si le local
      // est plus ancien, le serveur appliquant lui aussi MIN).
      const localBadgeModules = new Set((s.badges || []).map(b => b.module_id));
      const svBadgeModules = new Set((sv.badges || []).map(b => b.module_id));
      const svBadgeByModule = {};
      for (const sb of sv.badges || []) svBadgeByModule[sb.module_id] = sb;
      for (const sb of sv.badges || []) {
        if (localBadgeModules.has(sb.module_id)) {
          // v1.1.12 : module déjà badgé localement → réconcilier la date
          const lb = (s.badges || []).find(b => b.module_id === sb.module_id);
          if (lb && sb.issued_at && lb.issued_at && sb.issued_at < lb.issued_at) {
            lb.issued_at = sb.issued_at; // le serveur est plus ancien → adopté
          }
          continue;
        }
        s.badges.push({
          id: `srv_${sb.server_id || sb.id || sb.module_id}`,
          learner_id: canonicalId,
          module_id: sb.module_id,
          module_title: sb.module_title || '',
          score: sb.score || 0,
          xp_total: sb.xp_total || 0,
          badge_hash: sb.badge_hash || '',
          qr_payload: sb.qr_payload || '',
          blockchain_tx: sb.blockchain_tx || null,
          issued_at: sb.issued_at || now,
          sync_status: 'synced',
        });
      }
      for (const lb of s.badges || []) {
        if (!svBadgeModules.has(lb.module_id)) {
          pushOps.push(['badge', 'INSERT', lb.id, {
            learner_id: canonicalId, module_id: lb.module_id,
            module_title: lb.module_title, score: lb.score, xp_total: lb.xp_total,
            badge_hash: lb.badge_hash, qr_payload: lb.qr_payload, issued_at: lb.issued_at,
          }]);
        } else {
          // v1.1.12 : badge des DEUX côtés — si le LOCAL est plus ancien, le
          // re-pousser pour que le serveur adopte la date la plus ancienne
          // (son upsert v1.1.12 fait issued_at = MIN(existant, entrant)).
          const sb = svBadgeByModule[lb.module_id];
          if (lb.issued_at && sb?.issued_at && lb.issued_at < sb.issued_at) {
            pushOps.push(['badge', 'INSERT', lb.id, {
              learner_id: canonicalId, module_id: lb.module_id,
              module_title: lb.module_title, score: lb.score, xp_total: lb.xp_total,
              badge_hash: lb.badge_hash, qr_payload: lb.qr_payload, issued_at: lb.issued_at,
            }]);
          }
        }
      }

      // Succès : importer ceux du serveur absents localement
      const localAchKeys = new Set((s.achievements || []).map(a => a.achievement_key));
      const svAchKeys = new Set((sv.achievements || []).map(a => a.achievement_key));
      for (const sa of sv.achievements || []) {
        if (sa.achievement_key && !localAchKeys.has(sa.achievement_key)) {
          s.achievements.push({ achievement_key: sa.achievement_key, unlocked_at: sa.unlocked_at || now });
        }
      }
      for (const la of s.achievements || []) {
        if (!svAchKeys.has(la.achievement_key)) {
          pushOps.push(['achievement', 'INSERT', `${canonicalId}_${la.achievement_key}`, {
            learner_id: canonicalId, achievement_key: la.achievement_key, unlocked_at: la.unlocked_at || now,
          }]);
        }
      }

      // Streak logs (MAX par date)
      const logsToPush = {};
      for (const sl of sv.streak_logs || []) {
        const ll = s.streakLogs[sl.activity_date];
        const mLessons = Math.max(ll?.lessons_done || 0, sl.lessons_done || 0);
        const mXp = Math.max(ll?.xp_earned || 0, sl.xp_earned || 0);
        const mGoal = Math.max(ll?.goal_met || 0, sl.goal_met || 0) ? 1 : 0;
        const mFreeze = Math.max(ll?.streak_freeze_used || 0, sl.streak_freeze_used || 0);
        s.streakLogs[sl.activity_date] = {
          lessons_done: mLessons, xp_earned: mXp, goal_met: mGoal,
          streak_freeze_used: mFreeze,
          created_at: ll?.created_at || sl.created_at || now,
          updated_at: now,
        };
        logsToPush[sl.activity_date] = { activity_date: sl.activity_date, lessons_done: mLessons, xp_earned: mXp, goal_met: mGoal, streak_freeze_used: mFreeze };
      }
      for (const [date, ll] of Object.entries(s.streakLogs || {})) {
        if (!logsToPush[date]) {
          logsToPush[date] = {
            activity_date: date,
            lessons_done: ll.lessons_done || 0, xp_earned: ll.xp_earned || 0,
            goal_met: ll.goal_met || 0, streak_freeze_used: ll.streak_freeze_used || 0,
          };
        }
      }
      for (const m of Object.values(logsToPush)) {
        pushOps.push(['streak_log', 'UPDATE', `${canonicalId}_${m.activity_date}`, { learner_id: canonicalId, ...m }]);
      }

      // Objectif quotidien : importer si absent localement
      if (!s.dailyGoal?.goal_type && sv.daily_goal?.goal_type) {
        s.dailyGoal = {
          goal_type: sv.daily_goal.goal_type,
          goal_target: sv.daily_goal.goal_target ?? 1,
          enabled: sv.daily_goal.enabled ?? 1,
          updated_at: now,
        };
      } else if (s.dailyGoal?.goal_type && !sv.daily_goal?.goal_type) {
        pushOps.push(['daily_goal', 'UPDATE', `goal_${canonicalId}`, {
          learner_id: canonicalId, goal_type: s.dailyGoal.goal_type,
          goal_target: s.dailyGoal.goal_target, enabled: s.dailyGoal.enabled ?? 1, updated_at: now,
        }]);
      }
    } else {
      // ── SQLite natif ──
      const localLearner = await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId]);
      const svLearner = sv.learner;

      // Learner : MAX des champs numériques + champs de profil (v1.1.8)
      if (localLearner && svLearner) {
        const merged = { ...localLearner };
        merged.total_xp           = Math.max(localLearner.total_xp || 0, svLearner.total_xp || 0);
        merged.streak_days        = Math.max(localLearner.streak_days || 0, svLearner.streak_days || 0);
        merged.best_streak        = Math.max(localLearner.best_streak || 0, svLearner.best_streak || 0);
        merged.streak_freezes     = Math.max(localLearner.streak_freezes ?? 2, svLearner.streak_freezes ?? 2);
        merged.total_lessons_done = Math.max(localLearner.total_lessons_done || 0, svLearner.total_lessons_done || 0);
        merged.phone   = localLearner.phone || svLearner.phone || null;
        merged.language = localLearner.language || svLearner.language || 'fr';
        // v1.1.8 : profil étendu — le serveur complète les champs locaux vides
        Object.assign(merged, mergeProfileFields(localLearner, svLearner));
        merged.updated_at = now;
        await upsertLearnerRow(db, merged);
      }

      // Progressions (MAX par module)
      const svProgress = reduceServerProgressRows(sv.progress || []);
      const localRows = await db.getAllAsync('SELECT * FROM module_progress WHERE learner_id = ?', [canonicalId]);
      const localByModule = {};
      localRows.forEach(p => { localByModule[p.module_id] = p; });
      const rank = { not_started: 0, in_progress: 1, completed: 2 };
      for (const [moduleId, sp] of Object.entries(svProgress)) {
        const lp = localByModule[moduleId];
        const merged = {
          id: lp?.id ?? `${canonicalId}_${moduleId}`,
          learner_id: canonicalId,
          module_id: moduleId,
          status: (rank[lp?.status] ?? 0) >= (rank[sp.status] ?? 0) ? (lp?.status ?? sp.status) : sp.status,
          current_lesson:  Math.max(lp?.current_lesson || 0, sp.current_lesson || 0),
          lessons_done:    Math.max(lp?.lessons_done || 0, sp.lessons_done || 0),
          total_xp_earned: Math.max(lp?.total_xp_earned || 0, sp.total_xp_earned || 0),
          best_score:      Math.max(lp?.best_score || 0, sp.best_score || 0),
          started_at:      lp?.started_at || sp.started_at || now,
          completed_at:    lp?.completed_at || sp.completed_at || null,
          updated_at: now,
        };
        await db.runAsync(QUERIES.UPSERT_PROGRESS, [
          merged.id, merged.learner_id, merged.module_id, merged.status,
          merged.current_lesson, merged.lessons_done, merged.total_xp_earned,
          merged.best_score, merged.started_at, merged.completed_at, now,
        ]);
        if (lp) pushOps.push(['module_progress', 'UPDATE', merged.id, merged]);
      }

      // Badges
      // v1.1.12 : réconciliation des dates (la plus ANCIENNE gagne) — cf.
      // commentaire du mode mémoire ci-dessus.
      const localBadges = await db.getAllAsync('SELECT * FROM badge WHERE learner_id = ?', [canonicalId]);
      const localBadgeModules = new Set(localBadges.map(b => b.module_id));
      const svBadgeModules = new Set((sv.badges || []).map(b => b.module_id));
      const svBadgeByModule = {};
      for (const sb of sv.badges || []) svBadgeByModule[sb.module_id] = sb;
      const localBadgeByModule = {};
      localBadges.forEach(b => { localBadgeByModule[b.module_id] = b; });
      for (const sb of sv.badges || []) {
        if (localBadgeModules.has(sb.module_id)) {
          // v1.1.12 : module déjà badgé localement → réconcilier la date
          const lb = localBadgeByModule[sb.module_id];
          if (lb && sb.issued_at && lb.issued_at && sb.issued_at < lb.issued_at) {
            await db.runAsync(
              'UPDATE badge SET issued_at = ? WHERE id = ?',
              [sb.issued_at, lb.id]
            );
          }
          continue;
        }
        await db.runAsync(
          `INSERT OR IGNORE INTO badge
           (id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [`srv_${sb.server_id || sb.id || sb.module_id}`, canonicalId, sb.module_id,
           sb.module_title || '', sb.score || 0, sb.xp_total || 0, sb.badge_hash || '',
           sb.qr_payload || '', sb.blockchain_tx || null, sb.issued_at || now]
        );
      }
      for (const lb of localBadges) {
        if (!svBadgeModules.has(lb.module_id)) {
          pushOps.push(['badge', 'INSERT', lb.id, {
            learner_id: canonicalId, module_id: lb.module_id,
            module_title: lb.module_title, score: lb.score, xp_total: lb.xp_total,
            badge_hash: lb.badge_hash, qr_payload: lb.qr_payload, issued_at: lb.issued_at,
          }]);
        } else {
          // v1.1.12 : badge des DEUX côtés — si le LOCAL est plus ancien, le
          // re-pousser pour que le serveur adopte la date la plus ancienne.
          const sb = svBadgeByModule[lb.module_id];
          if (lb.issued_at && sb?.issued_at && lb.issued_at < sb.issued_at) {
            pushOps.push(['badge', 'INSERT', lb.id, {
              learner_id: canonicalId, module_id: lb.module_id,
              module_title: lb.module_title, score: lb.score, xp_total: lb.xp_total,
              badge_hash: lb.badge_hash, qr_payload: lb.qr_payload, issued_at: lb.issued_at,
            }]);
          }
        }
      }

      // Succès
      const localAch = await db.getAllAsync('SELECT achievement_key, unlocked_at FROM achievement WHERE learner_id = ?', [canonicalId]);
      const localAchKeys = new Set(localAch.map(a => a.achievement_key));
      const svAchKeys = new Set((sv.achievements || []).map(a => a.achievement_key));
      for (const sa of sv.achievements || []) {
        if (!sa.achievement_key || localAchKeys.has(sa.achievement_key)) continue;
        await db.runAsync(
          `INSERT OR IGNORE INTO achievement (id, learner_id, achievement_key, unlocked_at, sync_status)
           VALUES (?, ?, ?, ?, 'synced')`,
          [`${canonicalId}_${sa.achievement_key}`, canonicalId, sa.achievement_key, sa.unlocked_at || now]
        );
      }
      for (const la of localAch) {
        if (!svAchKeys.has(la.achievement_key)) {
          pushOps.push(['achievement', 'INSERT', `${canonicalId}_${la.achievement_key}`, {
            learner_id: canonicalId, achievement_key: la.achievement_key, unlocked_at: la.unlocked_at || now,
          }]);
        }
      }

      // Streak logs (MAX par date)
      const localLogs = await db.getAllAsync('SELECT * FROM streak_log WHERE learner_id = ?', [canonicalId]);
      const localByDate = {};
      localLogs.forEach(l => { localByDate[l.activity_date] = l; });
      const logsToPush = {};
      for (const sl of sv.streak_logs || []) {
        const ll = localByDate[sl.activity_date];
        const mLessons = Math.max(ll?.lessons_done || 0, sl.lessons_done || 0);
        const mXp = Math.max(ll?.xp_earned || 0, sl.xp_earned || 0);
        const mGoal = Math.max(ll?.goal_met || 0, sl.goal_met || 0) ? 1 : 0;
        const mFreeze = Math.max(ll?.streak_freeze_used || 0, sl.streak_freeze_used || 0);
        if (!ll) {
          await db.runAsync(
            `INSERT OR IGNORE INTO streak_log
             (id, learner_id, activity_date, lessons_done, xp_earned, streak_freeze_used, goal_met, created_at, updated_at, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
            [`${canonicalId}_${sl.activity_date}`, canonicalId, sl.activity_date,
             mLessons, mXp, mFreeze, mGoal, sl.created_at || now, now]
          );
        } else if (mLessons > ll.lessons_done || mXp > ll.xp_earned) {
          await db.runAsync(
            `UPDATE streak_log SET lessons_done = ?, xp_earned = ?, goal_met = ?, streak_freeze_used = ?, updated_at = ?
             WHERE learner_id = ? AND activity_date = ?`,
            [mLessons, mXp, mGoal, mFreeze, now, canonicalId, sl.activity_date]
          );
        }
        logsToPush[sl.activity_date] = { activity_date: sl.activity_date, lessons_done: mLessons, xp_earned: mXp, goal_met: mGoal, streak_freeze_used: mFreeze };
      }
      for (const l of localLogs) {
        if (!logsToPush[l.activity_date]) {
          logsToPush[l.activity_date] = {
            activity_date: l.activity_date,
            lessons_done: l.lessons_done || 0, xp_earned: l.xp_earned || 0,
            goal_met: l.goal_met || 0, streak_freeze_used: l.streak_freeze_used || 0,
          };
        }
      }
      for (const m of Object.values(logsToPush)) {
        pushOps.push(['streak_log', 'UPDATE', `${canonicalId}_${m.activity_date}`, { learner_id: canonicalId, ...m }]);
      }

      // Objectif quotidien
      const localGoal = await db.getFirstAsync('SELECT * FROM daily_goal WHERE learner_id = ?', [canonicalId]);
      if (!localGoal && sv.daily_goal?.goal_type) {
        await db.runAsync(
          `INSERT INTO daily_goal (id, learner_id, goal_type, goal_target, enabled, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'synced')`,
          [`goal_${canonicalId}`, canonicalId, sv.daily_goal.goal_type,
           sv.daily_goal.goal_target ?? 1, sv.daily_goal.enabled ?? 1, now]
        );
      } else if (localGoal && !sv.daily_goal?.goal_type) {
        pushOps.push(['daily_goal', 'UPDATE', `goal_${canonicalId}`, {
          learner_id: canonicalId, goal_type: localGoal.goal_type,
          goal_target: localGoal.goal_target, enabled: localGoal.enabled ?? 1, updated_at: now,
        }]);
      }
    }

    // ── Pousser l'union vers le serveur (le learner D'ABORD : son op crée la
    // ligne serveur client_id=lrn_<user.id> dont dépendent les autres ops) ──
    if (enqueue) {
      const finalLearner = storeRef.current.learner
        ? storeRef.current.learner
        : (db ? await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId]) : null);
      if (finalLearner) {
        try { await enqueue('learner', 'UPDATE', canonicalId, finalLearner); } catch (_) {}
      }
      for (const [table, op, recordId, payload] of pushOps) {
        try { await enqueue(table, op, recordId, payload); } catch (_) {}
      }
    }
  }, [db, enqueue]);

  // ── v1.1.6 : RESTAURATION depuis le compte serveur ───────────────────────
  // Appelée après TOUTE authentification réussie. Corrige :
  //   • Bug « l'écran Bienvenue s'affiche toujours après Google auth sur
  //     mobile » : le learner est créé DIRECTEMENT depuis le compte (nom
  //     Google/inscription) — plus jamais d'Onboarding pour un compte connu.
  //   • Bug « comptes uniques web + mobile » : les données du compte (XP,
  //     progressions, badges, succès, streaks, objectif) sont PULL-ées puis
  //     fusionnées localement (MAX), et le learner local adopte l'id canonique
  //     lrn_<user.id> — la même clé de sync sur toutes les plateformes.
  // Hors-ligne : best-effort (le learner local est conservé tel quel).
  //
  // v1.1.8 : ISOLATION DES COMPTES (bug grave « après déconnexion puis
  // connexion à un autre compte, ce sont les informations de l'ancien
  // utilisateur qui apparaissent »). Le learner actif qui appartient à un
  // AUTRE compte (server_id ≠ user.id) n'est PLUS renommé vers le nouveau
  // compte — ses données restent sur l'appareil, intouchées. On bascule
  // vers le learner du compte connecté (switchActiveLearner) : ligne SQLite
  // existante si le compte s'était déjà connecté ici, sinon snapshot web,
  // sinon création depuis le compte, sinon Onboarding (learner = null).
  const switchActiveLearner = useCallback(async (canonicalId, serverUser, sv) => {
    // 1. Snapshotter le learner sortant SOUS SA PROPRE clé (mode mémoire) :
    //    ses données resteront restaurables quand ce compte se reconnectera.
    if (storeRef.current.learner && storeRef.current.learner.id !== canonicalId) {
      await saveMemorySnapshot(storeRef.current); // clé ek_snap_<ancien id>
    }
    // 2. Vider le store mémoire (les collections appartiennent à l'ancien
    //    compte — en SQLite les lignes restent en base, scopées par learner_id)
    // v1.1.8 : la file de sync est PRÉSERVÉE — chaque op y est attribuée à
    // son compte par record_id (lrn_<user.id>_…) : les ops du compte sortant
    // partiront vers SON compte serveur, jamais vers celui qui se connecte.
    const outgoingQueue = (storeRef.current.syncQueue || []).slice();
    storeRef.current.reset();
    storeRef.current.syncQueue = outgoingQueue;

    // 3. Charger les données DU compte connecté
    if (db) {
      const row = await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId]);
      if (row) {
        storeRef.current.learner = row;
        setLearner(row);
        try {
          await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(row));
          await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, row.id);
        } catch (_) {}
        persistSnapshot();
        console.log('[DB] Switch de compte → données locales du compte restaurées :', row.name);
        return row;
      }
    } else {
      const restored = await loadMemorySnapshot(storeRef.current, canonicalId);
      if (restored && storeRef.current.learner) {
        setLearner(storeRef.current.learner);
        try { await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, canonicalId); } catch (_) {}
        console.log('[DB] Switch de compte → snapshot web du compte restauré :', storeRef.current.learner.name);
        return storeRef.current.learner;
      }
    }

    // 4. Aucune donnée locale pour ce compte → création depuis le compte
    const name = pickAccountDisplayName(serverUser, sv?.learner);
    if (!name) {
      // Compte sans prénom connu (ex : téléphone neuf) → Onboarding.
      // IMPORTANT : learner = null, sinon l'UI montrerait le Dashboard de
      // l'ancien compte (le gating bascule sur l'écran Bienvenue).
      setLearner(null);
      console.log('[DB] Switch de compte : aucun prénom connu → Onboarding');
      return null;
    }
    return await createLearner({
      id: canonicalId,
      name,
      phone: serverUser.phone || '',
      language: serverUser.language || 'fr',
      server_id: String(serverUser.id),
      email: serverUser.email || sv?.learner?.email || null,
      photo_url: serverUser.avatar_url || serverUser.picture || sv?.learner?.photo_url || null,
    });
  }, [db, createLearner, persistSnapshot]);

  // ── v1.1.9 : re-push de l'état local après re-liage ─────────────────────
  // Après un effacement serveur (disque éphémère), le compte recréé est VIDE.
  // Les ops sync de la session précédente ont déjà été consommées → le serveur
  // ne recevrait rien. On ré-enfile donc l'état local complet : learner
  // (profil + XP + photo), objectif du jour et progressions des modules —
  // la continuité multi-appareils est rétablie au premier passage en ligne.
  const reEnqueueLocalState = useCallback(async (learnerId) => {
    if (!enqueue) return;
    try {
      if (db) {
        const goalRow = await db.getFirstAsync('SELECT * FROM daily_goal WHERE learner_id = ?', [learnerId]);
        if (goalRow) await enqueue('daily_goal', 'UPDATE', `goal_${learnerId}`, goalRow);
        const progressRows = await db.getAllAsync('SELECT * FROM module_progress WHERE learner_id = ?', [learnerId]);
        for (const pr of progressRows) {
          await enqueue('module_progress', 'UPDATE', pr.id, pr);
        }
      } else {
        const s = storeRef.current;
        if (s.dailyGoal?.goal_type) {
          await enqueue('daily_goal', 'UPDATE', `goal_${learnerId}`, { learner_id: learnerId, ...s.dailyGoal });
        }
        for (const [moduleId, pr] of Object.entries(s.progress || {})) {
          await enqueue('module_progress', 'UPDATE', pr.id || `${learnerId}_${moduleId}`, { learner_id: learnerId, ...pr });
        }
      }
    } catch (e) {
      console.warn('[DB] reEnqueueLocalState partiel :', e.message);
    }
  }, [db, enqueue]);

  const restoreFromServer = useCallback(async (serverUser) => {
    const canonicalId = canonicalLearnerId(serverUser);
    if (!canonicalId) return null;

    // ── 1. Pull de l'état serveur (404 = compte sans données : normal) ──
    let sv = null;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch(
        `${ENV.API_BASE}/api/progress/${encodeURIComponent(canonicalId)}`,
        {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': ENV.API_KEY, 'X-Client': 'edukraft-restore' },
          signal: controller.signal,
        }
      );
      clearTimeout(tid);
      if (resp.ok) {
        const json = await resp.json();
        if (json?.success && json?.data) sv = json.data;
      }
    } catch (_) { /* hors-ligne / serveur endormi : restauration best-effort */ }

    // ── 2. v1.1.8 : le learner actif appartient-il à un AUTRE compte ? ──
    let local = storeRef.current.learner || learner;
    if (local && local.id !== canonicalId) {
      const belongsToOtherAccount = !!local.server_id
        && String(local.server_id) !== String(serverUser.id);
      if (belongsToOtherAccount) {
        // v1.1.9 : MÊME EMAIL = MÊME COMPTE recréé côté serveur (disque
        // éphémère Render : le find-or-create a généré un nouvel user.id
        // pour le même utilisateur). On RE-LIE le learner local au compte :
        // toutes ses données (objectif, photo, profil, XP, progressions)
        // suivent — c'est la continuité de « comptes uniques par email ».
        // Sans ce re-liage, chaque effacement serveur faisait basculer
        // l'utilisateur vers un learner vide (« objectif non conservé »,
        // « photo disparue », « informations de profil perdues »).
        const sameAccountByEmail = !!(local.email && serverUser.email
          && String(local.email).toLowerCase().trim() === String(serverUser.email).toLowerCase().trim());
        if (sameAccountByEmail) {
          console.log('[DB] Même email — compte serveur recréé : re-liage du learner local (', local.id, '→', canonicalId, ')');
          try {
            const nowIso = new Date().toISOString();
            await adoptCanonicalLearnerId(local.id, canonicalId);
            if (db) {
              await db.runAsync(
                'UPDATE learner SET server_id = ?, sync_status = ?, updated_at = ? WHERE id = ?',
                [String(serverUser.id), 'pending', nowIso, canonicalId]
              );
              const refreshed = await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId]);
              // v1.1.9 : l'état local complet repart aussitôt au serveur
              // (le compte recréé est vide) — XP, profil, photo, objectif.
              if (refreshed && enqueue) {
                await enqueue('learner', 'UPDATE', canonicalId, refreshed);
              }
              await reEnqueueLocalState(canonicalId);
              local = refreshed;
            } else {
              storeRef.current.learner = {
                ...storeRef.current.learner,
                id: canonicalId,
                server_id: String(serverUser.id),
                sync_status: 'pending',
                updated_at: nowIso,
              };
              if (enqueue) {
                await enqueue('learner', 'UPDATE', canonicalId, storeRef.current.learner);
              }
              local = storeRef.current.learner;
            }
          } catch (e) {
            console.warn('[DB] Re-liage par email échoué :', e.message);
          }
        } else {
          // VRAI changement de compte : jamais de renommage croisé — on bascule
          // vers les données du compte qui se connecte (ou l'Onboarding).
          console.log('[DB] Changement de compte détecté — isolation des données de l\'ancien compte');
          const switched = await switchActiveLearner(canonicalId, serverUser, sv);
          if (!switched) return null; // → Onboarding (prénom inconnu)
          local = switched;
        }
      }
      // Sinon : invité non lié (server_id NULL) → adoption ci-dessous
    }

    // ── 3. Learner local absent → création DIRECTE depuis le compte ──
    if (!local) {
      const name = pickAccountDisplayName(serverUser, sv?.learner);
      if (!name) {
        // Aucun prénom connu (ex : compte téléphone neuf) → l'Onboarding
        // reste le seul recours pour collecter le prénom.
        return null;
      }
      await createLearner({
        id: canonicalId,
        name,
        phone: serverUser.phone || '',
        language: serverUser.language || 'fr',
        server_id: String(serverUser.id),
        email: serverUser.email || sv?.learner?.email || null,
        photo_url: serverUser.avatar_url || serverUser.picture || sv?.learner?.photo_url || null,
      });
      local = storeRef.current.learner;
    }

    // ── 4. Adoption de l'id canonique du compte (invité → compte) ──
    // v1.1.8 : réservé aux invités NON LIÉS (la garde du §2 a déjà traité
    // le cas d'un learner appartenant à un autre compte).
    if (local && local.id !== canonicalId) {
      try {
        await adoptCanonicalLearnerId(local.id, canonicalId);
        // Lier au compte (server_id) si ce n'était pas déjà fait
        if (db) {
          await db.runAsync('UPDATE learner SET server_id = ?, updated_at = ? WHERE id = ? AND (server_id IS NULL OR server_id = ?)',
            [String(serverUser.id), new Date().toISOString(), canonicalId, String(serverUser.id)]);
        } else if (!storeRef.current.learner.server_id) {
          storeRef.current.learner = { ...storeRef.current.learner, server_id: String(serverUser.id) };
        }
        const refreshed = db
          ? await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId])
          : storeRef.current.learner;
        if (refreshed) { storeRef.current.learner = refreshed; setLearner(refreshed); }
        // v1.1.9 : pousser l'état local complet vers le compte serveur —
        // indispensable après un re-liage (compte serveur recréé sur disque
        // éphémère) : sans cet enqueue, le serveur resterait vide et un autre
        // appareil ne verrait jamais ces données (XP, profil, photo, objectif).
        if (refreshed && enqueue) {
          await enqueue('learner', 'UPDATE', canonicalId, refreshed);
        }
        await reEnqueueLocalState(canonicalId);
      } catch (e) {
        console.warn('[DB] adoptCanonicalLearnerId échec :', e.message);
      }
    }

    // ── 5. Fusion serveur → local (MAX par champ + champs de profil v1.1.8) ──
    if (sv) {
      try {
        await mergeServerStateIntoLocal(sv, canonicalId);
      } catch (e) {
        console.warn('[DB] mergeServerStateIntoLocal échec :', e.message);
      }
    }

    // ── 6. Rafraîchir l'UI + persister ──
    const finalLearner = db
      ? await db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [canonicalId])
      : storeRef.current.learner;
    if (finalLearner) {
      storeRef.current.learner = finalLearner;
      setLearner(finalLearner);
      try {
        await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(finalLearner));
        await persistentStorage.setItem(KEYS.ACTIVE_LEARNER, finalLearner.id);
      } catch (_) {}
    }
    persistSnapshot();
    console.log('[DB] Restauration compte terminée', sv ? '(données serveur fusionnées)' : '(aucune donnée serveur)');
    return finalLearner || storeRef.current.learner;
  }, [learner, db, createLearner, adoptCanonicalLearnerId, mergeServerStateIntoLocal, persistSnapshot, switchActiveLearner, enqueue, reEnqueueLocalState]);

  // ── v1.1.6 : auto-restauration au DÉMARRAGE ────────────────────────────
  // Si une session authentifiée existe (l'utilisateur ne s'est pas
  // déconnecté), on pull les dernières données du compte dès que la DB est
  // prête : les activités effectuées sur un AUTRE appareil (ex : le web)
  // pendant ce temps apparaissent sans attendre une reconnexion. Le garde
  // ref évite toute boucle (une seule fois par lancement de l'app).
  const autoRestoreDoneRef = useRef(false);
  useEffect(() => {
    if (!ready || autoRestoreDoneRef.current) return;
    autoRestoreDoneRef.current = true;
    let mounted = true;
    (async () => {
      try {
        const stored = await authService.getStoredAuth();
        if (!mounted) return;
        // Session active (pas de déconnexion volontaire) + token présent → pull
        if (stored?.user && stored.accessToken && !stored.sessionEnded) {
          console.log('[DB] Session active détectée — pull des données du compte…');
          await restoreFromServer(stored.user);
        }
      } catch (_) { /* best-effort */ }
    })();
    return () => { mounted = false; };
  }, [ready, restoreFromServer]);

  // ── Progress ──────────────────────────────────────────────────────────
  const getProgress = useCallback(async (moduleId) => {
    return progressRepo().get(learner, moduleId);
  }, [learner, progressRepo]);

  const getAllProgress = useCallback(async () => {
    return progressRepo().getAll(learner);
  }, [learner, progressRepo]);

  const updateProgress = useCallback(async (moduleId, updates) => {
    const result = await progressRepo().update(learner, moduleId, updates);
    persistSnapshot();
    return result;
  }, [learner, progressRepo, persistSnapshot]);

  // ── Quiz ──────────────────────────────────────────────────────────────
  const saveQuizAttempt = useCallback(async (payload) => {
    const result = await progressRepo().saveQuizAttempt(learner, payload);
    persistSnapshot();
    return result;
  }, [learner, progressRepo, persistSnapshot]);

  // ── Badges ────────────────────────────────────────────────────────────
  const issueBadge = useCallback(async (payload) => {
    const result = await badgeRepo().issue(learner, payload);
    persistSnapshot();
    return result;
  }, [learner, badgeRepo, persistSnapshot]);

  const getAllBadges = useCallback(async () => {
    return badgeRepo().getAll(learner);
  }, [learner, badgeRepo]);

  // ── Gamification (v2) ─────────────────────────────────────────────────
  const runAsync = useCallback(async (queryName, params = []) => {
    return gamificationRepo().runAsync(queryName, params);
  }, [gamificationRepo]);

  const getFirst = useCallback(async (queryName, params = []) => {
    return gamificationRepo().getFirst(queryName, params);
  }, [gamificationRepo]);

  const getAchievements = useCallback(async () => {
    return gamificationRepo().getAchievements(learner);
  }, [learner, gamificationRepo]);

  const getDailyGoal = useCallback(async () => {
    return gamificationRepo().getDailyGoal(learner);
  }, [learner, gamificationRepo]);

  const setDailyGoal = useCallback(async (goalType, target) => {
    // v1.1.10 : le state `learner` peut être NULL juste après createLearner
    // (closure obsolète — OnboardingScreen appelle setDailyGoal dans le MÊME
    // handler que createLearner, avant le re-render React). Résultat v1.1.9 :
    // ligne daily_goal écrite avec learner_id NULL (invisible ensuite —
    // « l'objectif n'est jamais conservé ») et op sync rejetée par le serveur
    // (« learner_id manquant » → abandon après retries). On résout
    // dynamiquement le learner ACTIF : state, sinon store mémoire.
    const active = learner || storeRef.current?.learner || null;
    const result = await gamificationRepo().setDailyGoal(active, goalType, target);
    persistSnapshot();
    return result;
  }, [learner, gamificationRepo, persistSnapshot]);

  /**
   * Enregistre une leçon complétée et déclenche toute la gamification.
   * Wrapper autour de src/gamification/index.js::recordLessonCompleted.
   */
  const recordLessonCompleted = useCallback(async (payload) => {
    const gamification = require('../gamification');
    const result = await gamification.recordLessonCompleted(
      {
        learner, setLearner, enqueue,
        getCurrentLearner: () => storeRef.current.learner,
        runAsync, getFirst, getAllProgress,
        getAchievements, getDailyGoal,
        MODULES: require('../content/moduleRegistry').MODULES,
      },
      payload,
    );
    persistSnapshot();
    return result;
  }, [learner, enqueue, runAsync, getFirst, getAllProgress, getAchievements, getDailyGoal, persistSnapshot]);

  /** Retourne l'état gamification complet pour l'affichage. */
  const getGamificationState = useCallback(async () => {
    const gamification = require('../gamification');
    return gamification.getGamificationState({
      learner: storeRef.current.learner || learner,
      getFirst, getAllProgress,
      getAchievements, getDailyGoal,
      MODULES: require('../content/moduleRegistry').MODULES,
    });
  }, [learner, getFirst, getAllProgress, getAchievements, getDailyGoal]);

  // ── Sync helpers (exposés pour SyncEngine) ────────────────────────────
  const getPendingQueue = useCallback(async () => {
    return getSyncRepo().getPendingQueue();
  }, [getSyncRepo]);

  const removeFromQueue = useCallback(async (queueId) => {
    return getSyncRepo().removeFromQueue(queueId);
  }, [getSyncRepo]);

  // v1.1.13 : purge des doublons obsolètes d'une même clé après sync réussie
  // (rows ≤ queued_at de l'op envoyée — jamais les écritures plus récentes)
  const removeQueueKey = useCallback(async (tableName, recordId, queuedAtInclusive) => {
    return getSyncRepo().removeAllForKey(tableName, recordId, queuedAtInclusive);
  }, [getSyncRepo]);

  const incrementRetry = useCallback(async (queueId, errorMsg) => {
    return getSyncRepo().incrementRetry(queueId, errorMsg);
  }, [getSyncRepo]);

  const updateBadgeTx = useCallback(async (badgeId, txHash) => {
    return badgeRepo().updateTx(badgeId, txHash);
  }, [badgeRepo]);

  const getSyncMeta = useCallback(async (key) => {
    return getSyncRepo().getMeta(key);
  }, [getSyncRepo]);

  const setSyncMeta = useCallback(async (key, value) => {
    return getSyncRepo().setMeta(key, value);
  }, [getSyncRepo]);

  // ── Reset (utile pour déconnexion / tests) ────────────────────────────
  const resetAll = useCallback(async () => {
    // v1.1.14 : « Réinitialiser » doit effacer AUSSI le snapshot SCOPÉ du
    // learner actif (ek_snap_<id>) et le pointeur de session — avant, ces
    // clés survivaient au reset : au boot suivant (mode mémoire), le profil
    // « revenait d'entre les morts » et les données semblaient indestructibles.
    const activeId = storeRef.current.learner?.id || null;
    const purgePersistent = async () => {
      try {
        await persistentStorage.removeItem(KEYS.LEARNER);
        await persistentStorage.removeItem(KEYS.SNAPSHOT);
        if (activeId) await persistentStorage.removeItem(snapKey(activeId));
        await persistentStorage.removeItem(KEYS.ACTIVE_LEARNER);
      } catch (_) {}
    };
    if (!db) {
      storeRef.current.reset();
      setLearner(null);
      await purgePersistent();
      return;
    }
    // SQLite : supprimer et recréer la DB (schéma via initSchema v1.1.14)
    const SQLite = require('expo-sqlite');
    await SQLite.deleteDatabaseAsync('edukraft.db');
    const newDb = await SQLite.openDatabaseAsync('edukraft.db');
    await initSchema(newDb);
    setDb(newDb);
    setLearner(null);
    await purgePersistent();
  }, [db]);

  // ── Context value ─────────────────────────────────────────────────────
  const value = {
    db, ready, error, dbInitError,
    learner, setLearner,
    // Learner
    createLearner, addXP, updateProfile, getProfileCompletion, linkLearnerToAccount,
    // v1.1.6 : restauration multi-appareils (appelée après chaque login)
    restoreFromServer,
    // Progress
    getProgress, getAllProgress, updateProgress,
    // Quiz
    saveQuizAttempt,
    // Badges
    issueBadge, getAllBadges,
    // Gamification (v2)
    recordLessonCompleted, getGamificationState,
    getAchievements, getDailyGoal, setDailyGoal,
    // Sync internals
    getPendingQueue, removeFromQueue, removeQueueKey, incrementRetry,
    updateBadgeTx, getSyncMeta, setSyncMeta, enqueue,
    // Utils
    resetAll,
  };

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useDb() {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used inside <DbProvider>');
  return ctx;
}
