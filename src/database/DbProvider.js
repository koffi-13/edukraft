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
const KEYS = {
  LEARNER:  'ek_learner',
  SNAPSHOT: 'ek_memory_snapshot', // snapshot complet du store mémoire
};

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
    const snapshot = {
      learner: store.learner,
      progress: store.progress,
      quizAttempts: store.quizAttempts,
      badges: store.badges,
      streakLogs: store.streakLogs,
      achievements: store.achievements,
      dailyGoal: store.dailyGoal,
      savedAt: new Date().toISOString(),
    };
    await persistentStorage.setItem(KEYS.SNAPSHOT, JSON.stringify(snapshot));
  } catch (_) {}
}

async function loadMemorySnapshot(store) {
  try {
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
    return !!snap.learner;
  } catch (_) {
    return false;
  }
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

    console.log('[DB] Snapshot complet restauré dans SQLite (persistance renforcée)');
    return true;
  } catch (e) {
    console.warn('[DB] restoreSnapshotToSqlite échec :', e.message);
    return false;
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function DbProvider({ children }) {
  const [db, setDb]           = useState(null);
  const [learner, setLearner] = useState(null);
  const [ready, setReady]     = useState(false);
  const [error, setError]     = useState(null);
  const storeRef              = useRef(memoryStore);

  // ── Synchroniser le learner dans le stockage persistant à chaque changement ──
  // Garantit que le learner survit au redémarrage même sans SQLite
  useEffect(() => {
    if (learner) {
      persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(learner)).catch(() => {});
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

        // Tentative d'ouverture SQLite native (Android/iOS)
        try {
          const SQLite = require('expo-sqlite');
          nativeDb = await SQLite.openDatabaseAsync('edukraft.db');
          await nativeDb.execAsync(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
          `);

          // Création des tables
          const { CREATE_TABLES, INITIAL_SYNC_META, MIGRATE_LEARNER_V2, MIGRATE_LEARNER_V3 } = require('./schema');
          await nativeDb.execAsync(CREATE_TABLES);
          await nativeDb.execAsync(INITIAL_SYNC_META);

          // Migration v1 > v2 : ajoute les colonnes gamification au learner
          // (idempotent : chaque ALTER échoue silencieusement si la colonne existe)
          for (const stmt of MIGRATE_LEARNER_V2) {
            try { await nativeDb.execAsync(stmt); } catch (_) { /* colonne déjà là */ }
          }
          // Migration v1 > v1.1 : ajoute les colonnes du profil étendu
          for (const stmt of MIGRATE_LEARNER_V3) {
            try { await nativeDb.execAsync(stmt); } catch (_) { /* colonne déjà là */ }
          }

          // Charger le learner existant depuis SQLite
          const row = await nativeDb.getFirstAsync('SELECT * FROM learner LIMIT 1');
          if (row) {
            setLearner(row);
            // Aussi sauvegarder dans le stockage persistant (fallback)
            try {
              await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(row));
            } catch (_) {}
          } else {
            // Pas de learner en SQLite — vérifier le stockage persistant
            try {
              // v1.1.5 : essayer d'abord le SNAPSHOT COMPLET (learner +
              // progressions + badges + succès + streaks + objectif) —
              // réinséré intégralement dans SQLite. Avant, seul le learner
              // était réinséré : le profil revenait mais toutes les
              // progressions étaient perdues.
              let snapRaw = null;
              try { snapRaw = await persistentStorage.getItem(KEYS.SNAPSHOT); } catch (_) {}
              if (snapRaw) {
                const snap = JSON.parse(snapRaw);
                await restoreSnapshotToSqlite(nativeDb, snap);
                if (snap.learner) {
                  storeRef.current.learner = snap.learner;
                  // Le store mémoire sert de fallback — on le remplit aussi
                  await loadMemorySnapshot(storeRef.current);
                  setLearner(snap.learner);
                }
              } else {
                const storedLearner = await persistentStorage.getItem(KEYS.LEARNER);
                if (storedLearner) {
                  const parsed = JSON.parse(storedLearner);
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
            } catch (_) {}
          }

          setDb(nativeDb);
          console.log('[DB] SQLite natif initialisé');
        } catch (sqliteErr) {
          // expo-sqlite non disponible (web, etc.) > fallback mémoire
          console.log('[DB] SQLite non disponible, mode mémoire activé');

          // v1.1.3 : restaurer le SNAPSHOT COMPLET depuis le stockage
          // persistant (learner + progressions + badges + streaks + succès).
          // Avant : sur web le require AsyncStorage échouait silencieusement
          // → rien n'était restauré → écran Login à chaque rechargement.
          const restoredFromSnapshot = await loadMemorySnapshot(storeRef.current);
          if (restoredFromSnapshot) {
            console.log('[DB] Snapshot complet restauré (learner + progressions)');
            setLearner(storeRef.current.learner);
          } else {
            // Compat : ancienne clé individuelle (ek_learner seul)
            try {
              const storedLearner = await persistentStorage.getItem(KEYS.LEARNER);
              if (storedLearner) {
                const parsed = JSON.parse(storedLearner);
                storeRef.current.learner = parsed;
                setLearner(parsed);
                console.log('[DB] Learner restauré depuis le stockage persistant');
              }
            } catch (_) {}
          }

          if (storeRef.current.learner) {
            setLearner(storeRef.current.learner);
          }
        }

        setReady(true);
      } catch (e) {
        console.error('[DB] Initialisation échouée :', e);
        setError(e.message);
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
  const createLearner = useCallback(async ({ id, name, phone, language = 'fr' }) => {
    const result = await learnerRepo().create({ id, name, phone, language });
    setLearner(result);
    storeRef.current.learner = result;
    // Persister dans le stockage multi-plateforme + snapshot complet
    try {
      await persistentStorage.setItem(KEYS.LEARNER, JSON.stringify(result));
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
   */
  const linkLearnerToAccount = useCallback(async (serverUser) => {
    if (!learner || !serverUser?.id) return learner;
    const now = new Date().toISOString();
    try {
      if (db) {
        await db.runAsync(
          'UPDATE learner SET server_id = ?, sync_status = ?, updated_at = ? WHERE id = ?',
          [String(serverUser.id), 'pending', now, learner.id]
        );
        const { QUERIES } = require('./schema');
        const refreshed = await db.getFirstAsync(QUERIES.GET_LEARNER);
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
    const result = await gamificationRepo().setDailyGoal(learner, goalType, target);
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
    if (!db) {
      storeRef.current.reset();
      setLearner(null);
      // v1.1.3 : purge aussi le stockage persistant (reset = tout effacer)
      try {
        await persistentStorage.removeItem(KEYS.LEARNER);
        await persistentStorage.removeItem(KEYS.SNAPSHOT);
      } catch (_) {}
      return;
    }
    // SQLite : supprimer et recréer la DB
    const SQLite = require('expo-sqlite');
    await SQLite.deleteDatabaseAsync('edukraft.db');
    const newDb = await SQLite.openDatabaseAsync('edukraft.db');
    const { CREATE_TABLES, INITIAL_SYNC_META, MIGRATE_LEARNER_V2, MIGRATE_LEARNER_V3 } = require('./schema');
    await newDb.execAsync(CREATE_TABLES);
    await newDb.execAsync(INITIAL_SYNC_META);
    for (const stmt of [...MIGRATE_LEARNER_V2, ...MIGRATE_LEARNER_V3]) {
      try { await newDb.execAsync(stmt); } catch (_) {}
    }
    setDb(newDb);
    setLearner(null);
    // v1.1.3 : purge aussi le stockage persistant (reset = tout effacer)
    try {
      await persistentStorage.removeItem(KEYS.LEARNER);
      await persistentStorage.removeItem(KEYS.SNAPSHOT);
    } catch (_) {}
  }, [db]);

  // ── Context value ─────────────────────────────────────────────────────
  const value = {
    db, ready, error,
    learner, setLearner,
    // Learner
    createLearner, addXP, updateProfile, getProfileCompletion, linkLearnerToAccount,
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
    getPendingQueue, removeFromQueue, incrementRetry,
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
