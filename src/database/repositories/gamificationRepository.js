// src/database/repositories/gamificationRepository.js
// Repository Gamification — streak_log, achievement, daily_goal.
//
// Fournit les helpers de data-access utilisés par l'orchestrateur
// src/gamification/index.js (runAsync, getFirst, getAchievements, getDailyGoal,
// setDailyGoal, getTodayLog, etc.).

import { makeId } from './baseRepository';

export function createGamificationRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Exécute une requête préparée par nom.
   * v1.1.5 (correctif « Progression & succès figé ») : le mode MÉMOIRE (web)
   * n'est plus un no-op ! Avant, runAsync retournait null sans rien faire →
   * UPSERT_STREAK_LOG / UPDATE_STREAK_CACHE / INSERT_ACHIEVEMENT /
   * UPSERT_DAILY_GOAL n'écrivaient JAMAIS rien sur web → les succès ne
   * se débloquaient pas et l'objectif quotidien restait à 0, quelles que
   * soient les activités. Chaque mutation SQL a désormais son équivalent
   * mémoire sur le store. */
  async function runAsync(queryName, params = []) {
    if (isMemory()) {
      const s = store;
      const now = new Date().toISOString();
      if (queryName === 'UPSERT_STREAK_LOG') {
        // params: [id, learnerId, date, lessons, xp, freezeUsed, goalMet, createdAt, updatedAt]
        const [, , date, lessons, xp, freezeUsed, goalMet] = params;
        const ex = s.streakLogs[date];
        if (ex) {
          ex.lessons_done += lessons || 0;
          ex.xp_earned += xp || 0;
          ex.goal_met = Math.max(ex.goal_met || 0, goalMet || 0);
          ex.streak_freeze_used = Math.max(ex.streak_freeze_used || 0, freezeUsed || 0);
          ex.updated_at = now;
        } else {
          s.streakLogs[date] = {
            lessons_done: lessons || 0,
            xp_earned: xp || 0,
            goal_met: goalMet || 0,
            streak_freeze_used: freezeUsed || 0,
            created_at: now,
            updated_at: now,
          };
        }
        return null;
      }
      if (queryName === 'UPDATE_STREAK_CACHE') {
        // params: [streak, freezes, best, lastActiveDate, lastActiveAt, lessonsDelta, updatedAt, learnerId]
        const [streak, freezes, best, lastActiveDate, lastActiveAt, lessonsDelta] = params;
        if (s.learner) {
          s.learner.streak_days = streak;
          s.learner.streak_freezes = freezes;
          s.learner.best_streak = best;
          s.learner.last_active_date = lastActiveDate;
          s.learner.last_active_at = lastActiveAt || now;
          s.learner.total_lessons_done = (s.learner.total_lessons_done ?? 0) + (lessonsDelta || 0);
          s.learner.updated_at = now;
        }
        return null;
      }
      if (queryName === 'INSERT_ACHIEVEMENT') {
        // params: [id, learnerId, key, unlockedAt]
        const [, , key, unlockedAt] = params;
        if (key && !s.achievements.some(a => a.achievement_key === key)) {
          s.achievements.push({ achievement_key: key, unlocked_at: unlockedAt || now });
        }
        return null;
      }
      if (queryName === 'UPSERT_DAILY_GOAL') {
        // params: [id, learnerId, goalType, target, enabled, updatedAt]
        const [, , goalType, target, enabled] = params;
        s.dailyGoal = { goal_type: goalType, goal_target: target, enabled: enabled ?? 1, updated_at: now };
        return null;
      }
      return null; // requête de lecture → utiliser getFirst
    }
    const sql = QUERIES[queryName];
    if (!sql) throw new Error(`Query inconnue: ${queryName}`);
    return db.runAsync(sql, params);
  }

  /** Récupère la première ligne d'une requête par nom. */
  async function getFirst(queryName, params = []) {
    if (isMemory()) {
      const s = store;
      if (queryName === 'GET_TODAY_LOG' || queryName === 'GET_STREAK_LOG') {
        const [lid, date] = params;
        const log = s.streakLogs[date];
        return log ? { ...log, learner_id: lid, activity_date: date } : null;
      }
      if (queryName === 'COUNT_PASSED_QUIZZES') return { cnt: s.quizAttempts.filter(a => a.passed).length };
      if (queryName === 'COUNT_PERFECT_QUIZZES') return { cnt: s.quizAttempts.filter(a => a.score >= 1.0).length };
      if (queryName === 'COUNT_STARTED_MODULES') return { cnt: Object.values(s.progress).filter(p => p.status !== 'not_started').length };
      if (queryName === 'COUNT_COMPLETED_MODULES') return { cnt: Object.values(s.progress).filter(p => p.status === 'completed').length };
      return null;
    }
    const sql = QUERIES[queryName];
    if (!sql) throw new Error(`Query inconnue: ${queryName}`);
    return db.getFirstAsync(sql, params);
  }

  /** Liste les clés d'achievements débloqués. */
  async function getAchievements(learner) {
    if (isMemory()) {
      return store.achievements.map(a => a.achievement_key);
    }
    const rows = await db.getAllAsync(QUERIES.GET_ACHIEVEMENTS, [learner?.id]);
    return rows.map(r => r.achievement_key);
  }

  /** Ajoute un achievement débloqué. */
  async function addAchievement(learner, key) {
    const now = new Date().toISOString();
    const id = makeId('ach');
    if (isMemory()) {
      store.achievements.push({ achievement_key: key, unlocked_at: now });
      return id;
    }
    await db.runAsync(QUERIES.INSERT_ACHIEVEMENT, [id, learner?.id, key, now]);
    if (enqueue) await enqueue('achievement', 'INSERT', id, { learner_id: learner?.id, achievement_key: key, unlocked_at: now });
    return id;
  }

  /** Récupère l'objectif quotidien. */
  async function getDailyGoal(learner) {
    if (isMemory()) return store.dailyGoal;
    return db.getFirstAsync(QUERIES.GET_DAILY_GOAL, [learner?.id]);
  }

  /** Définit l'objectif quotidien. */
  async function setDailyGoal(learner, goalType, target) {
    const now = new Date().toISOString();
    if (isMemory()) {
      store.dailyGoal = { goal_type: goalType, goal_target: target, enabled: 1, updated_at: now };
      return;
    }
    const id = `goal_${learner?.id}`;
    await db.runAsync(QUERIES.UPSERT_DAILY_GOAL, [id, learner?.id, goalType, target, 1, now]);
    if (enqueue) await enqueue('daily_goal', 'UPDATE', id, { learner_id: learner?.id, goal_type: goalType, goal_target: target, enabled: 1, updated_at: now });
  }

  /** Upsert du log journalier (streak_log). */
  async function upsertStreakLog(learner, date, fields) {
    const now = new Date().toISOString();
    const id = makeId('sl');
    if (isMemory()) {
      const existing = store.streakLogs[date];
      if (existing) {
        existing.lessons_done += fields.lessons_done || 0;
        existing.xp_earned += fields.xp_earned || 0;
        existing.goal_met = Math.max(existing.goal_met, fields.goal_met ? 1 : 0);
        existing.streak_freeze_used = Math.max(existing.streak_freeze_used, fields.streak_freeze_used || 0);
        existing.updated_at = now;
      } else {
        store.streakLogs[date] = {
          lessons_done: fields.lessons_done || 0,
          xp_earned: fields.xp_earned || 0,
          goal_met: fields.goal_met ? 1 : 0,
          streak_freeze_used: fields.streak_freeze_used || 0,
          created_at: now,
          updated_at: now,
        };
      }
      return id;
    }
    await db.runAsync(QUERIES.UPSERT_STREAK_LOG, [
      id, learner?.id, date,
      fields.lessons_done || 0,
      fields.xp_earned || 0,
      fields.streak_freeze_used || 0,
      fields.goal_met ? 1 : 0,
      now, now,
    ]);
    return id;
  }

  return { runAsync, getFirst, getAchievements, addAchievement, getDailyGoal, setDailyGoal, upsertStreakLog };
}
