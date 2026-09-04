// src/database/repositories/progressRepository.js
// Repository Progression — module_progress, quiz_attempt.

import { makeId } from './baseRepository';

export function createProgressRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  // v1.1.16 : DÉDOUBLONNAGE défensif par module. Des lignes dupliquées pour un
  // même (learner, module) peuvent exister sur des appareils ayant traversé
  // les bugs de renommage v1.1.8-1.1.15 (id ≠ mais même couple) : le Dashboard
  // lisait alors la PREMIÈRE ligne arbitraire (« module terminé marqué En
  // cours » alors qu'une ligne « completed » cohabitait). La MEILLEURE ligne
  // gagne : statut le plus avancé, puis lessons_done, puis fraîcheur.
  const RANK = { not_started: 0, in_progress: 1, completed: 2 };
  function pickBestRow(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ra = RANK[a.status] ?? 0;
    const rb = RANK[b.status] ?? 0;
    if (ra !== rb) return ra > rb ? a : b;
    if ((a.lessons_done || 0) !== (b.lessons_done || 0)) {
      return (a.lessons_done || 0) > (b.lessons_done || 0) ? a : b;
    }
    return (a.updated_at || '') >= (b.updated_at || '') ? a : b;
  }

  /** Récupère la progression d'un module. */
  async function get(learner, moduleId) {
    if (isMemory()) {
      return store.progress[moduleId] || null;
    }
    const rows = await db.getAllAsync(
      'SELECT * FROM module_progress WHERE learner_id = ? AND module_id = ?',
      [learner?.id, moduleId]
    );
    return rows.reduce((best, r) => pickBestRow(best, r), null);
  }

  /** Récupère toute la progression du learner (UNE ligne par module). */
  async function getAll(learner) {
    if (isMemory()) {
      return Object.values(store.progress);
    }
    const rows = await db.getAllAsync(QUERIES.GET_ALL_PROGRESS, [learner?.id]);
    const byModule = {};
    for (const r of rows) {
      byModule[r.module_id] = pickBestRow(byModule[r.module_id], r);
    }
    return Object.values(byModule);
  }

  /** Met à jour (ou crée) la progression d'un module. */
  async function update(learner, moduleId, updates) {
    const now = new Date().toISOString();
    const learnerId = learner?.id || store.learner?.id;
    if (!learnerId) return null;

    // v1.1.5 (correctif « module En cours N/N ») : le statut 'completed' est
    // COLLANT. Avant, le useEffect de LessonScreen réécrivait status:'in_progress'
    // à chaque ré-ouverture d'une leçon d'un module TERMINÉ → le Dashboard
    // affichait « En cours » avec N/N leçons faites, et le re-passage du quiz
    // final ré-émettait le badge (moduleAlreadyCompleted=false à cause du
    // statut rétrogradé). Un module complété ne redevient jamais « en cours ».
    const guardStatus = (existing, requested) => {
      if (existing?.status === 'completed' && requested && requested !== 'completed') {
        return 'completed';
      }
      return requested ?? existing?.status ?? 'not_started';
    };

    if (isMemory()) {
      const existing = store.progress[moduleId];
      const id = existing?.id ?? `${learnerId}_${moduleId}`;
      const merged = {
        id,
        learner_id: learnerId,
        module_id: moduleId,
        status:          guardStatus(existing, updates.status),
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
      status:          guardStatus(existing, updates.status),
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
