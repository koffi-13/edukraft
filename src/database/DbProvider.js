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

// ── Provider ─────────────────────────────────────────────────────────────────
export function DbProvider({ children }) {
  const [db, setDb]           = useState(null);
  const [learner, setLearner] = useState(null);
  const [ready, setReady]     = useState(false);
  const [error, setError]     = useState(null);
  const storeRef              = useRef(memoryStore);

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

          // Charger le learner existant
          const row = await nativeDb.getFirstAsync('SELECT * FROM learner LIMIT 1');
          if (row) setLearner(row);

          setDb(nativeDb);
          console.log('[DB] SQLite natif initialisé');
        } catch (sqliteErr) {
          // expo-sqlite non disponible (web, etc.) > fallback mémoire
          console.log('[DB] SQLite non disponible, mode mémoire activé');

          // Restaurer le learner depuis le store mémoire
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
    return result;
  }, [learnerRepo]);

  const addXP = useCallback(async (amount) => {
    if (!learner) return null;
    const totalXp = await learnerRepo().addXP(learner, amount);
    // Recharger le learner pour l'UI
    const updated = await learnerRepo().get();
    setLearner(updated);
    return totalXp;
  }, [learner, learnerRepo]);

  /** Met à jour les champs du profil étendu (v1.1). */
  const updateProfile = useCallback(async (fields) => {
    if (!learner) return null;
    const updated = await learnerRepo().updateProfile(learner.id, fields);
    setLearner(updated);
    // Enqueue pour sync (type 'learner' avec operation UPDATE)
    if (enqueue) await enqueue('learner', 'UPDATE', learner.id, updated);
    return updated;
  }, [learner, learnerRepo, enqueue]);

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
    return progressRepo().update(learner, moduleId, updates);
  }, [learner, progressRepo]);

  // ── Quiz ──────────────────────────────────────────────────────────────
  const saveQuizAttempt = useCallback(async (payload) => {
    return progressRepo().saveQuizAttempt(learner, payload);
  }, [learner, progressRepo]);

  // ── Badges ────────────────────────────────────────────────────────────
  const issueBadge = useCallback(async (payload) => {
    return badgeRepo().issue(learner, payload);
  }, [learner, badgeRepo]);

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
    return gamificationRepo().setDailyGoal(learner, goalType, target);
  }, [learner, gamificationRepo]);

  /**
   * Enregistre une leçon complétée et déclenche toute la gamification.
   * Wrapper autour de src/gamification/index.js::recordLessonCompleted.
   */
  const recordLessonCompleted = useCallback(async (payload) => {
    const gamification = require('../gamification');
    return gamification.recordLessonCompleted(
      {
        learner, setLearner, enqueue,
        getCurrentLearner: () => storeRef.current.learner,
        runAsync, getFirst, getAllProgress,
        getAchievements, getDailyGoal,
        MODULES: require('../content/moduleRegistry').MODULES,
      },
      payload,
    );
  }, [learner, enqueue, runAsync, getFirst, getAllProgress, getAchievements, getDailyGoal]);

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
  }, [db]);

  // ── Context value ─────────────────────────────────────────────────────
  const value = {
    db, ready, error,
    learner, setLearner,
    // Learner
    createLearner, addXP, updateProfile, getProfileCompletion,
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
