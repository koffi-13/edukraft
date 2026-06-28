// src/database/DbProvider.js
// Provider de données EduKraft — SQLite natif + fallback mémoire fonctionnel
// En mode natif (Android) : utilise expo-sqlite pour la persistance réelle
// En mode web/test : utilise un store en mémoire qui simule toutes les opérations DB

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { generateBadge } from '../blockchain/badgeGenerator';

const DbContext = createContext(null);

// ── In-Memory Store (fallback pour web / test) ─────────────────────────────────
class MemoryStore {
  constructor() {
    this.learner = null;
    this.progress = {};    // moduleId → progress object
    this.quizAttempts = [];
    this.badges = [];
    this.syncQueue = [];
    this.syncMeta = { schema_version: '1', last_sync_at: null, sync_cursor: '0' };
  }

  reset() {
    this.learner = null;
    this.progress = {};
    this.quizAttempts = [];
    this.badges = [];
    this.syncQueue = [];
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
          const { CREATE_TABLES, INITIAL_SYNC_META } = require('./schema');
          await nativeDb.execAsync(CREATE_TABLES);
          await nativeDb.execAsync(INITIAL_SYNC_META);

          // Charger le learner existant
          const row = await nativeDb.getFirstAsync('SELECT * FROM learner LIMIT 1');
          if (row) setLearner(row);

          setDb(nativeDb);
          console.log('[DB] SQLite natif initialisé');
        } catch (sqliteErr) {
          // expo-sqlite non disponible (web, etc.) → fallback mémoire
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

  // ── Helper : vérifie si on est en mode mémoire ─────────────────────────
  const isMemory = () => !db;
  const store = () => storeRef.current;

  // ── Learner ───────────────────────────────────────────────────────────

  const createLearner = useCallback(async ({ id, name, phone, language = 'fr' }) => {
    const now = new Date().toISOString();

    if (isMemory()) {
      const newLearner = {
        id, name, phone, language,
        total_xp: 0, streak_days: 0,
        last_active_at: now, created_at: now,
        updated_at: now, server_id: null, sync_status: 'pending',
      };
      store().learner = newLearner;
      setLearner(newLearner);
      console.log('[DB/MEMORY] Learner créé :', name);
      return newLearner;
    }

    // Mode SQLite natif
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.UPSERT_LEARNER,
      [id, name, phone, language, 0, 0, now, now, now]);
    const updated = await db.getFirstAsync(QUERIES.GET_LEARNER);
    setLearner(updated);
    return updated;
  }, [db]);

  const addXP = useCallback(async (amount) => {
    if (!learner) return null;
    const now = new Date().toISOString();

    if (isMemory()) {
      const updated = {
        ...store().learner,
        total_xp: store().learner.total_xp + amount,
        last_active_at: now,
        updated_at: now,
      };
      store().learner = updated;
      setLearner(updated);
      console.log(`[DB/MEMORY] +${amount} XP. Total: ${updated.total_xp}`);
      return updated.total_xp;
    }

    // Mode SQLite natif
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.ADD_XP, [amount, now, learner.id]);
    const updated = await db.getFirstAsync(QUERIES.GET_LEARNER);
    setLearner(updated);
    return updated.total_xp;
  }, [db, learner]);

  // ── Module Progress ───────────────────────────────────────────────────

  const getProgress = useCallback(async (moduleId) => {
    if (isMemory()) {
      return store().progress[moduleId] || null;
    }
    const { QUERIES } = require('./schema');
    return db.getFirstAsync(QUERIES.GET_MODULE_PROGRESS, [learner?.id, moduleId]);
  }, [db, learner]);

  const getAllProgress = useCallback(async () => {
    if (isMemory()) {
      return Object.values(store().progress);
    }
    const { QUERIES } = require('./schema');
    return db.getAllAsync(QUERIES.GET_ALL_PROGRESS, [learner?.id]);
  }, [db, learner]);

  const updateProgress = useCallback(async (moduleId, updates) => {
    const now = new Date().toISOString();
    const learnerId = learner?.id || store().learner?.id;
    if (!learnerId) return null;

    if (isMemory()) {
      const existing = store().progress[moduleId];
      const id = existing?.id ?? `${learnerId}_${moduleId}`;

      const merged = {
        id,
        learner_id: learnerId,
        module_id: moduleId,
        status:          updates.status          ?? existing?.status          ?? 'not_started',
        current_lesson:  updates.current_lesson  ?? existing?.current_lesson  ?? 0,
        lessons_done:    updates.lessons_done    ?? existing?.lessons_done    ?? 0,
        total_xp_earned: updates.total_xp_earned ?? existing?.total_xp_earned ?? 0,
        best_score:      updates.best_score      ?? existing?.best_score      ?? 0,
        started_at:      updates.started_at      ?? existing?.started_at      ?? now,
        completed_at:    updates.completed_at    ?? existing?.completed_at    ?? null,
        updated_at: now,
      };

      store().progress[moduleId] = merged;
      console.log(`[DB/MEMORY] Progress mis à jour: ${moduleId} → ${merged.status}`);
      return merged;
    }

    // Mode SQLite natif
    const { QUERIES } = require('./schema');
    const existing = await getProgress(moduleId);
    const id = existing?.id ?? `${learnerId}_${moduleId}`;

    const merged = {
      id, learner_id: learnerId, module_id: moduleId,
      status:          updates.status          ?? existing?.status          ?? 'not_started',
      current_lesson:  updates.current_lesson  ?? existing?.current_lesson  ?? 0,
      lessons_done:    updates.lessons_done    ?? existing?.lessons_done    ?? 0,
      total_xp_earned: updates.total_xp_earned ?? existing?.total_xp_earned ?? 0,
      best_score:      updates.best_score      ?? existing?.best_score      ?? 0,
      started_at:      updates.started_at      ?? existing?.started_at      ?? null,
      completed_at:    updates.completed_at    ?? existing?.completed_at    ?? null,
    };

    await db.runAsync(QUERIES.UPSERT_PROGRESS, [
      merged.id, merged.learner_id, merged.module_id, merged.status,
      merged.current_lesson, merged.lessons_done, merged.total_xp_earned,
      merged.best_score, merged.started_at, merged.completed_at, now,
    ]);
    return merged;
  }, [db, learner, getProgress]);

  // ── Quiz Attempts ─────────────────────────────────────────────────────

  const saveQuizAttempt = useCallback(async ({
    moduleId, lessonIndex, score, answers, xpAwarded, passed
  }) => {
    const now = new Date().toISOString();
    const learnerId = learner?.id || store().learner?.id;
    if (!learnerId) return null;

    const id = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (isMemory()) {
      const previous = store().quizAttempts.filter(
        a => a.learner_id === learnerId && a.module_id === moduleId && a.lesson_index === lessonIndex
      );
      const attemptNumber = previous.length + 1;

      const attempt = {
        id, learner_id: learnerId, module_id: moduleId,
        lesson_index: lessonIndex, attempt_number: attemptNumber,
        score, answers: JSON.stringify(answers), xp_awarded: xpAwarded,
        passed: passed ? 1 : 0, completed_at: now,
      };
      store().quizAttempts.push(attempt);
      console.log(`[DB/MEMORY] Quiz sauvé: ${moduleId}/L${lessonIndex} → ${Math.round(score * 100)}%`);
      return id;
    }

    // Mode SQLite natif
    const { QUERIES } = require('./schema');
    const previous = await db.getAllAsync(QUERIES.GET_QUIZ_ATTEMPTS,
      [learnerId, moduleId, lessonIndex]);
    const attemptNumber = previous.length + 1;

    await db.runAsync(QUERIES.INSERT_QUIZ_ATTEMPT, [
      id, learnerId, moduleId, lessonIndex, attemptNumber,
      score, JSON.stringify(answers), xpAwarded, passed ? 1 : 0, now,
    ]);
    return id;
  }, [db, learner]);

  // ── Badges ────────────────────────────────────────────────────────────

  const issueBadge = useCallback(async ({ moduleId, moduleTitle, score, xpTotal }) => {
    const learnerId = learner?.id || store().learner?.id;
    if (!learnerId) return null;

    const badge = generateBadge({
      learnerId, learnerName: store().learner?.name || learner?.name,
      moduleId, moduleTitle, score, xpTotal,
    });

    if (isMemory()) {
      const badgeRow = {
        id: badge.id, learner_id: learnerId, module_id: moduleId,
        module_title: moduleTitle, score, xp_total: xpTotal,
        badge_hash: badge.hash, qr_payload: badge.qrPayload,
        blockchain_tx: null, issued_at: badge.issuedAt,
      };
      store().badges.push(badgeRow);
      console.log(`[DB/MEMORY] Badge émis: ${moduleTitle}`);
      return badge;
    }

    // Mode SQLite natif
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.INSERT_BADGE, [
      badge.id, learnerId, moduleId, moduleTitle,
      score, xpTotal, badge.hash, badge.qrPayload,
      null, badge.issuedAt,
    ]);
    return badge;
  }, [db, learner]);

  const getAllBadges = useCallback(async () => {
    if (isMemory()) {
      return store().badges.slice().reverse();
    }
    const { QUERIES } = require('./schema');
    return db.getAllAsync(QUERIES.GET_ALL_BADGES, [learner?.id]);
  }, [db, learner]);

  // ── Sync helpers (exposés pour SyncEngine) ────────────────────────────

  const getPendingQueue = useCallback(async () => {
    if (isMemory()) return store().syncQueue.slice(0, 50);
    const { QUERIES } = require('./schema');
    return db.getAllAsync(QUERIES.GET_PENDING_QUEUE);
  }, [db]);

  const removeFromQueue = useCallback(async (queueId) => {
    if (isMemory()) {
      store().syncQueue = store().syncQueue.filter(s => s.id !== queueId);
      return;
    }
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.DELETE_FROM_QUEUE, [queueId]);
  }, [db]);

  const incrementRetry = useCallback(async (queueId, errorMsg) => {
    if (isMemory()) {
      const item = store().syncQueue.find(s => s.id === queueId);
      if (item) { item.retry_count = (item.retry_count || 0) + 1; item.last_error = errorMsg; }
      return;
    }
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.INCREMENT_RETRY, [errorMsg, queueId]);
  }, [db]);

  const updateBadgeTx = useCallback(async (badgeId, txHash) => {
    if (isMemory()) {
      const b = store().badges.find(b => b.id === badgeId);
      if (b) b.blockchain_tx = txHash;
      return;
    }
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.UPDATE_BADGE_TX, [txHash, badgeId]);
  }, [db]);

  const getSyncMeta = useCallback(async (key) => {
    if (isMemory()) return store().syncMeta[key] ?? null;
    const { QUERIES } = require('./schema');
    const row = await db.getFirstAsync(QUERIES.GET_META, [key]);
    return row?.value ?? null;
  }, [db]);

  const setSyncMeta = useCallback(async (key, value) => {
    if (isMemory()) { store().syncMeta[key] = String(value); return; }
    const { QUERIES } = require('./schema');
    await db.runAsync(QUERIES.SET_META, [key, String(value)]);
  }, [db]);

  // ── Reset (utile pour déconnexion / tests) ────────────────────────────
  const resetAll = useCallback(async () => {
    if (isMemory()) {
      store().reset();
      setLearner(null);
      return;
    }
    // SQLite : supprimer et recréer la DB
    const SQLite = require('expo-sqlite');
    await SQLite.deleteDatabaseAsync('edukraft.db');
    const newDb = await SQLite.openDatabaseAsync('edukraft.db');
    const { CREATE_TABLES, INITIAL_SYNC_META } = require('./schema');
    await newDb.execAsync(CREATE_TABLES);
    await newDb.execAsync(INITIAL_SYNC_META);
    setDb(newDb);
    setLearner(null);
  }, [db]);

  // ── Context value ─────────────────────────────────────────────────────
  const value = {
    db, ready, error,
    learner, setLearner,
    // Learner
    createLearner, addXP,
    // Progress
    getProgress, getAllProgress, updateProgress,
    // Quiz
    saveQuizAttempt,
    // Badges
    issueBadge, getAllBadges,
    // Sync internals
    getPendingQueue, removeFromQueue, incrementRetry,
    updateBadgeTx, getSyncMeta, setSyncMeta,
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