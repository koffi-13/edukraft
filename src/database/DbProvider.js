// src/database/DbProvider.js
// Provider SQLite global — wraps expo-sqlite et expose toutes les opérations DB
// Utilisation : const { db, learner, progress, badges, ... } = useDb()

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
// import * as SQLite from 'expo-sqlite'; // Temporairement désactivé pour test web
import { CREATE_TABLES, INITIAL_SYNC_META, QUERIES } from './schema';
import { generateBadge } from '../blockchain/badgeGenerator';

const DbContext = createContext(null);

// ── Provider ─────────────────────────────────────────────────────────────────
export function DbProvider({ children }) {
  const [db, setDb]           = useState(null);
  const [learner, setLearner] = useState(null);
  const [ready, setReady]     = useState(false);
  const [error, setError]     = useState(null);

  // ── Initialisation DB ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // Simulation de données pour test web
        const mockLearner = {
          id: 'demo_user_001',
          name: 'Utilisateur Demo',
          phone: '+22890000000',
          language: 'fr',
          total_xp: 50,
          level: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen: new Date().toISOString()
        };

        setLearner(mockLearner);
        setReady(true);
        console.log('[DB] Mode demo - données simulées chargées');
      } catch (e) {
        console.error('[DB] Initialisation échouée :', e);
        setError(e.message);
      }
    })();
  }, []);

  // ── Learner ───────────────────────────────────────────────────────────────

  const createLearner = useCallback(async ({ id, name, phone, language = 'fr' }) => {
    if (!db) return null;
    const now = new Date().toISOString();
    await db.runAsync(QUERIES.UPSERT_LEARNER,
      [id, name, phone, language, 0, 0, now, now, now]);
    await _enqueue(db, 'learner', id, 'INSERT', { id, name, phone, language });
    const updated = await db.getFirstAsync(QUERIES.GET_LEARNER);
    setLearner(updated);
    return updated;
  }, [db]);

  const addXP = useCallback(async (amount) => {
    if (!learner) return;
    const updated = {
      ...learner,
      total_xp: learner.total_xp + amount,
      updated_at: new Date().toISOString()
    };
    setLearner(updated);
    console.log(`[DEMO] +${amount} XP ajoutés. Total: ${updated.total_xp}`);
    return updated.total_xp;
  }, [learner]);

  // ── Module Progress ───────────────────────────────────────────────────────

  const getProgress = useCallback(async (moduleId) => {
    if (!db || !learner) return null;
    return db.getFirstAsync(QUERIES.GET_MODULE_PROGRESS, [learner.id, moduleId]);
  }, [db, learner]);

  const getAllProgress = useCallback(async () => {
    if (!db || !learner) return [];
    return db.getAllAsync(QUERIES.GET_ALL_PROGRESS, [learner.id]);
  }, [db, learner]);

  const updateProgress = useCallback(async (moduleId, updates) => {
    if (!db || !learner) return;
    const existing = await getProgress(moduleId);
    const now      = new Date().toISOString();
    const id       = existing?.id ?? `${learner.id}_${moduleId}`;

    const merged = {
      id,
      learner_id:      learner.id,
      module_id:       moduleId,
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
    await _enqueue(db, 'module_progress', id, existing ? 'UPDATE' : 'INSERT', merged);
    return merged;
  }, [db, learner, getProgress]);

  // ── Quiz Attempts ─────────────────────────────────────────────────────────

  const saveQuizAttempt = useCallback(async ({
    moduleId, lessonIndex, score, answers, xpAwarded, passed
  }) => {
    if (!db || !learner) return null;
    const id  = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Numéro de tentative
    const previous = await db.getAllAsync(QUERIES.GET_QUIZ_ATTEMPTS,
      [learner.id, moduleId, lessonIndex]);
    const attemptNumber = previous.length + 1;

    await db.runAsync(QUERIES.INSERT_QUIZ_ATTEMPT, [
      id, learner.id, moduleId, lessonIndex, attemptNumber,
      score, JSON.stringify(answers), xpAwarded, passed ? 1 : 0, now,
    ]);
    await _enqueue(db, 'quiz_attempt', id, 'INSERT', {
      id, learner_id: learner.id, module_id: moduleId,
      lesson_index: lessonIndex, score, passed, xp_awarded: xpAwarded,
    });
    return id;
  }, [db, learner]);

  // ── Badges ────────────────────────────────────────────────────────────────

  const issueBadge = useCallback(async ({ moduleId, moduleTitle, score, xpTotal }) => {
    if (!db || !learner) return null;

    const badge = generateBadge({
      learnerId:   learner.id,
      learnerName: learner.name,
      moduleId,
      moduleTitle,
      score,
      xpTotal,
    });

    await db.runAsync(QUERIES.INSERT_BADGE, [
      badge.id, learner.id, moduleId, moduleTitle,
      score, xpTotal, badge.hash, badge.qrPayload,
      null, badge.issuedAt,
    ]);
    await _enqueue(db, 'badge', badge.id, 'INSERT', badge);
    return badge;
  }, [db, learner]);

  const getAllBadges = useCallback(async () => {
    if (!learner) return [];
    // Simulation de badges pour le test
    return [
      {
        id: 'badge_demo_001',
        learner_id: learner.id,
        module_id: 'marketing_digital_local',
        module_title: 'Marketing Digital Local',
        score: 85,
        xp_total: 100,
        hash: '0x123abc',
        qr_payload: 'demo_qr_payload',
        tx_hash: null,
        issued_at: new Date().toISOString()
      }
    ];
  }, [learner]);

  // ── Sync helpers (exposés pour SyncEngine) ────────────────────────────────

  const getPendingQueue = useCallback(async () => {
    if (!db) return [];
    return db.getAllAsync(QUERIES.GET_PENDING_QUEUE);
  }, [db]);

  const removeFromQueue = useCallback(async (queueId) => {
    if (!db) return;
    await db.runAsync(QUERIES.DELETE_FROM_QUEUE, [queueId]);
  }, [db]);

  const incrementRetry = useCallback(async (queueId, errorMsg) => {
    if (!db) return;
    await db.runAsync(QUERIES.INCREMENT_RETRY, [errorMsg, queueId]);
  }, [db]);

  const updateBadgeTx = useCallback(async (badgeId, txHash) => {
    if (!db) return;
    await db.runAsync(QUERIES.UPDATE_BADGE_TX, [txHash, badgeId]);
  }, [db]);

  const getSyncMeta = useCallback(async (key) => {
    if (!db) return null;
    const row = await db.getFirstAsync(QUERIES.GET_META, [key]);
    return row?.value ?? null;
  }, [db]);

  const setSyncMeta = useCallback(async (key, value) => {
    if (!db) return;
    await db.runAsync(QUERIES.SET_META, [key, String(value)]);
  }, [db]);

  // ── Context value ─────────────────────────────────────────────────────────
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
  };

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useDb() {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used inside <DbProvider>');
  return ctx;
}

// ── Helper privé : enqueue sync ───────────────────────────────────────────────
async function _enqueue(db, tableName, recordId, operation, payload) {
  const id      = `sq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now     = new Date().toISOString();
  try {
    await db.runAsync(QUERIES.ENQUEUE,
      [id, tableName, recordId, operation, JSON.stringify(payload), now]);
  } catch (e) {
    console.warn('[Sync] Enqueue échoué :', e.message);
  }
}
