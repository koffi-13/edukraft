// src/database/repositories/progressRepository.js
// Repository Progression — module_progress, quiz_attempt.

import { makeId } from './baseRepository';

export function createProgressRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Récupère la progression d'un module. */
  async function get(learner, moduleId) {
    if (isMemory()) {
      return store.progress[moduleId] || null;
    }
    return db.getFirstAsync(QUERIES.GET_MODULE_PROGRESS, [learner?.id, moduleId]);
  }

  /** Récupère toute la progression du learner. */
  async function getAll(learner) {
    if (isMemory()) {
      return Object.values(store.progress);
    }
    return db.getAllAsync(QUERIES.GET_ALL_PROGRESS, [learner?.id]);
  }

  /** Met à jour (ou crée) la progression d'un module. */
  async function update(learner, moduleId, updates) {
    const now = new Date().toISOString();
    const learnerId = learner?.id || store.learner?.id;
    if (!learnerId) return null;

    if (isMemory()) {
      const existing = store.progress[moduleId];
      const id = existing?.id ?? `${learnerId}_${moduleId}`;
      const merged = {
        id,
        learner_id: learnerId,
        module_id: moduleId,
        status:          updates.status          ?? existing?.status          ?? 'not_started',
        current_lesson:  Math.max(updates.current_lesson ?? 0, existing?.current_lesson ?? 0),
        lessons_done:    Math.max(updates.lessons_done ?? 0, existing?.lessons_done ?? 0),
        total_xp_earned: Math.max(updates.total_xp_earned ?? 0, existing?.total_xp_earned ?? 0),
        best_score:      Math.max(updates.best_score ?? 0, existing?.best_score ?? 0),
        started_at:      updates.started_at      ?? existing?.started_at      ?? now,
        completed_at:    updates.completed_at    ?? existing?.completed_at    ?? null,
        updated_at: now,
      };
      store.progress[moduleId] = merged;
      if (enqueue) await enqueue('module_progress', existing ? 'UPDATE' : 'INSERT', merged.id, merged);
      return merged;
    }

    // SQLite natif
    const existing = await get(learner, moduleId);
    const id = existing?.id ?? `${learnerId}_${moduleId}`;
    const merged = {
      id, learner_id: learnerId, module_id: moduleId,
      status:          updates.status          ?? existing?.status          ?? 'not_started',
      current_lesson:  Math.max(updates.current_lesson ?? 0, existing?.current_lesson ?? 0),
      lessons_done:    Math.max(updates.lessons_done ?? 0, existing?.lessons_done ?? 0),
      total_xp_earned: Math.max(updates.total_xp_earned ?? 0, existing?.total_xp_earned ?? 0),
      best_score:      Math.max(updates.best_score ?? 0, existing?.best_score ?? 0),
      started_at:      updates.started_at      ?? existing?.started_at      ?? null,
      completed_at:    updates.completed_at    ?? existing?.completed_at    ?? null,
    };
    await db.runAsync(QUERIES.UPSERT_PROGRESS, [
      merged.id, merged.learner_id, merged.module_id, merged.status,
      merged.current_lesson, merged.lessons_done, merged.total_xp_earned,
      merged.best_score, merged.started_at, merged.completed_at, now,
    ]);
    if (enqueue) await enqueue('module_progress', existing ? 'UPDATE' : 'INSERT', merged.id, merged);
    return merged;
  }

  /** Enregistre une tentative de quiz. */
  async function saveQuizAttempt(learner, { moduleId, lessonIndex, score, answers, xpAwarded, passed }) {
    const now = new Date().toISOString();
    const learnerId = learner?.id || store.learner?.id;
    if (!learnerId) return null;
    const id = makeId('qa');

    if (isMemory()) {
      const previous = store.quizAttempts.filter(
        a => a.learner_id === learnerId && a.module_id === moduleId && a.lesson_index === lessonIndex
      );
      const attemptNumber = previous.length + 1;
      const attempt = {
        id, learner_id: learnerId, module_id: moduleId,
        lesson_index: lessonIndex, attempt_number: attemptNumber,
        score, answers: JSON.stringify(answers), xp_awarded: xpAwarded,
        passed: passed ? 1 : 0, completed_at: now,
      };
      store.quizAttempts.push(attempt);
      if (enqueue) await enqueue('quiz_attempt', 'INSERT', id, {
        learner_id: learnerId, module_id: moduleId,
        lesson_index: lessonIndex, score, answers,
        xp_awarded: xpAwarded, passed: passed ? 1 : 0,
        completed_at: now,
      });
      return id;
    }

    // SQLite natif
    const previous = await db.getAllAsync(QUERIES.GET_QUIZ_ATTEMPTS,
      [learnerId, moduleId, lessonIndex]);
    const attemptNumber = previous.length + 1;
    await db.runAsync(QUERIES.INSERT_QUIZ_ATTEMPT, [
      id, learnerId, moduleId, lessonIndex, attemptNumber,
      score, JSON.stringify(answers), xpAwarded, passed ? 1 : 0, now,
    ]);
    if (enqueue) await enqueue('quiz_attempt', 'INSERT', id, {
      learner_id: learnerId, module_id: moduleId,
      lesson_index: lessonIndex, attempt_number: attemptNumber,
      score, answers, xp_awarded: xpAwarded, passed: passed ? 1 : 0,
      completed_at: now,
    });
    return id;
  }

  return { get, getAll, update, saveQuizAttempt };
}
