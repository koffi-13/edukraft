// src/gamification/index.js
// Orchestrateur de gamification EduKraft — point d'entrée unique.
//
// Flux principal : recordLessonCompleted(db, ctx, payload)
//   1. Met à jour le streak (avec gels si besoin)
//   2. Enregistre l'activité dans streak_log
//   3. Évalue les achievements > débloque les nouveaux
//   4. Retourne un résumé { streak, freezes, newAchievements, goalMet, ... }
//      que l'UI peut utiliser pour une célébration discrète.
//
// Toutes les fonctions sont pures vis-à-vis de l'état React : elles lisent
// et écrivent directement dans la DB via les helpers passés en contexte.

import { computeStreak, regenerateFreezes, todayLocalDate, addDays, daysBetween,
  MAX_FREEZES,
} from './streakService';
import {
  ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, evaluateAchievements, getAchievement,
} from './achievements';

export { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, getAchievement, MAX_FREEZES };
export { computeStreak, todayLocalDate, addDays, daysBetween };

// ── Helper UUID léger (sans dépendance externe) ──────────────────────────────
function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

// ── Capture un snapshot de l'apprenant pour l'évaluation des achievements ───
/**
 * @param {Object} ctx - { db (sqlite natif ou null), learner, getAllProgress,
 *                         runQuery(name, params), getFirst(name, params),
 *                         MODULES }
 * @returns {Object} snapshot
 */
async function buildSnapshot(ctx) {
  const { learner, getAllProgress, getFirst, MODULES } = ctx;
  const learnerId = learner?.id;

  let perfectQuizzes = 0;
  let startedModules = 0;
  let completedModules = 0;

  if (learnerId && getFirst) {
    try {
      perfectQuizzes = (await getFirst('COUNT_PERFECT_QUIZZES', [learnerId]))?.cnt ?? 0;
      startedModules = (await getFirst('COUNT_STARTED_MODULES', [learnerId]))?.cnt ?? 0;
      completedModules = (await getFirst('COUNT_COMPLETED_MODULES', [learnerId]))?.cnt ?? 0;
    } catch (_) { /* mode mémoire : counts à 0 */ }
  }

  // Fallback mode mémoire : déduire de getAllProgress
  if (startedModules === 0 && getAllProgress) {
    try {
      const allProg = await getAllProgress() || [];
      startedModules = allProg.filter(p => p.status && p.status !== 'not_started').length;
      completedModules = allProg.filter(p => p.status === 'completed').length;
    } catch (_) {}
  }

  return {
    totalLessonsDone: learner?.total_lessons_done ?? 0,
    totalXp: learner?.total_xp ?? 0,
    bestStreak: learner?.best_streak ?? learner?.streak_days ?? 0,
    perfectQuizzes,
    startedModules,
    completedModules,
    totalAvailableModules: (MODULES?.length) ?? 0,
    comebackAfterDays: 0, // renseigné par recordLessonCompleted si applicable
  };
}

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Enregistre une leçon complétée et déclenche toute la machinerie gamification.
 *
 * @param {Object} ctx - contexte DB (voir buildSnapshot) + { getFirst, runAsync,
 *                        enqueue, setLearner }
 * @param {Object} payload - { xpEarned, moduleId, lessonIndex, score (0..1), passed }
 * @returns {Object} result - {
 *   streak: { current, best, freezes, freezeUsed, broken },
 *   newAchievements: Array<{key, title, description, category}>,
 *   goalMet: boolean,
 *   todayXp: number, todayLessons: number,
 * }
 */
export async function recordLessonCompleted(ctx, payload) {
  const { learner, getFirst, runAsync, enqueue, setLearner } = ctx;
  if (!learner) throw new Error('recordLessonCompleted: learner requis');

  const today = todayLocalDate();
  // v1.1.18 (Fix Bug B — stale closure lastActiveDate) : lire last_active_date
  // depuis le learner COURANT du store (storeRef.current.learner) plutôt que
  // depuis le closure `learner` (valeur au moment de la création du callback).
  // Scénario : SyncEngine.pull déclenche restoreFromServer → setLearner(final)
  // juste avant que recordLessonCompleted ne s'exécute. Le closure `learner`
  // est encore l'ancienne valeur avec last_active_date=null (ou périmée), alors
  // que storeRef.current.learner a été mis à jour (depuis v1.1.16 via le
  // wrapper setLearnerWithStore). On retombe sur le closure uniquement si
  // getCurrentLearner n'est pas exposé ou retourne null (legacy).
  const _currentLearnerForStreak = (ctx.getCurrentLearner && ctx.getCurrentLearner()) || learner;
  const lastActiveDate = _currentLearnerForStreak.last_active_date || learner.last_active_date || null;
  const comebackAfterDays = lastActiveDate ? daysBetween(lastActiveDate, today) : 0;

  // ── 1. Calcul du streak ──────────────────────────────────────────────
  const streakResult = computeStreak({
    today,
    lastActiveDate,
    currentStreak: learner.streak_days ?? 0,
    bestStreak: learner.best_streak ?? learner.streak_days ?? 0,
    currentFreezes: learner.streak_freezes ?? MAX_FREEZES,
  });
  const finalFreezes = regenerateFreezes(streakResult.newFreezes, streakResult.activityDaysCount);

  // ── 2. Enregistrer l'activité du jour (streak_log) ───────────────────
  const goalMet = await checkGoalMet(ctx, { todayXpDelta: payload.xpEarned || 0, todayLessonsDelta: 1 });
  const logId = makeId('sl');
  const nowIso = new Date().toISOString();
  try {
    if (runAsync) {
      await runAsync('UPSERT_STREAK_LOG', [
        logId, learner.id, today,
        1,                                  // lessons_done
        payload.xpEarned || 0,              // xp_earned
        streakResult.freezeUsed,            // streak_freeze_used
        goalMet ? 1 : 0,                    // goal_met
        nowIso, nowIso,
      ]);
    }
  } catch (e) {
    console.warn('[gamification] UPSERT_STREAK_LOG error:', e.message);
  }

  // v1.1.6 : pousser le log du JOUR (valeurs absolues) dans la file de sync.
  // Avant, les streak_logs n'étaient JAMAIS envoyés au serveur → l'objectif
  // quotidien (anneau) repartait de zéro sur un autre appareil après
  // restauration du compte. Le serveur applique un MAX idempotent.
  try {
    if (enqueue && getFirst) {
      const todayLog = await getFirst('GET_TODAY_LOG', [learner.id, today]);
      if (todayLog) {
        await enqueue('streak_log', 'UPDATE', `${learner.id}_${today}`, {
          learner_id: learner.id,
          activity_date: today,
          lessons_done: todayLog.lessons_done ?? 0,
          xp_earned: todayLog.xp_earned ?? 0,
          streak_freeze_used: todayLog.streak_freeze_used ?? 0,
          goal_met: todayLog.goal_met ?? 0,
          updated_at: nowIso,
        });
      }
    }
  } catch (_) {}

  // ── 3. Mettre à jour le cache learner (streak, freezes, lessons) ─────
  try {
    if (runAsync) {
      await runAsync('UPDATE_STREAK_CACHE', [
        streakResult.newStreak, finalFreezes, streakResult.newBestStreak,
        today, nowIso,
        1,                                  // +1 leçon
        nowIso, learner.id,
      ]);
    }
  } catch (e) {
    console.warn('[gamification] UPDATE_STREAK_CACHE error:', e.message);
  }

  // Mettre à jour l'état React du learner
  // ⚠️ Lire le learner COURANT depuis le store (pas depuis le closure) pour
  // éviter d'écraser l'XP qui vient d'être ajoutée par addXP. Le closure
  // `learner` peut être stale (valeur au moment de la création du callback).
  const currentLearner = (ctx.getCurrentLearner && ctx.getCurrentLearner()) || learner;
  const updatedLearner = {
    ...currentLearner,
    streak_days: streakResult.newStreak,
    streak_freezes: finalFreezes,
    best_streak: streakResult.newBestStreak,
    last_active_date: today,
    last_active_at: nowIso,
    total_lessons_done: (currentLearner.total_lessons_done ?? 0) + 1,
    updated_at: nowIso,
  };
  if (setLearner) setLearner(updatedLearner);
  if (enqueue) enqueue('learner', 'UPDATE', learner.id, updatedLearner);

  // ── 4. Évaluation des achievements ──────────────────────────────────
  let alreadyUnlocked = [];
  try {
    if (ctx.getAchievements) {
      alreadyUnlocked = await ctx.getAchievements();
    }
  } catch (_) {}

  // v1.1.5 : le snapshot est construit avec le learner À JOUR (XP et streak
  // de CETTE leçon inclus) — avant, ctx.learner était l'objet périmé du
  // closure, donc xp_100 / streak_3 etc. ne se débloquaient qu'un événement
  // trop tard.
  const snapshot = await buildSnapshot({ ...ctx, learner: updatedLearner });
  snapshot.comebackAfterDays = comebackAfterDays;
  snapshot.totalLessonsDone = updatedLearner.total_lessons_done;

  const newlyUnlockedKeys = evaluateAchievements(snapshot, alreadyUnlocked);

  // Persister les nouveaux achievements
  const newAchievements = [];
  for (const key of newlyUnlockedKeys) {
    const def = getAchievement(key);
    if (!def) continue;
    const achId = makeId('ach');
    try {
      if (runAsync) {
        await runAsync('INSERT_ACHIEVEMENT', [achId, learner.id, key, nowIso]);
      }
      if (enqueue) enqueue('achievement', 'INSERT', achId, { learner_id: learner.id, achievement_key: key, unlocked_at: nowIso });
    } catch (e) {
      console.warn('[gamification] INSERT_ACHIEVEMENT error:', e.message);
    }
    newAchievements.push(def);
  }

  return {
    streak: {
      current: streakResult.newStreak,
      best: streakResult.newBestStreak,
      freezes: finalFreezes,
      freezeUsed: streakResult.freezeUsed,
      broken: streakResult.newStreak === 1 && comebackAfterDays >= 2 && streakResult.freezeUsed === 0 && (learner.streak_days ?? 0) > 1,
    },
    newAchievements,
    goalMet,
    comebackAfterDays,
  };
}

/**
 * Vérifie si l'objectif quotidien est atteint pour aujourd'hui.
 * @param {Object} ctx
 * @param {Object} deltas - { todayXpDelta, todayLessonsDelta } activité en cours
 * @returns {Promise<boolean>}
 */
export async function checkGoalMet(ctx, deltas = { todayXpDelta: 0, todayLessonsDelta: 0 }) {
  const { learner, getFirst } = ctx;
  if (!learner || !getFirst) return false;

  let goal = ctx.getDailyGoal ? await ctx.getDailyGoal() : null;
  if (!goal || !goal.enabled) return false;

  try {
    const today = todayLocalDate();
    const todayLog = await getFirst('GET_TODAY_LOG', [learner.id, today]);
    const todayXp = (todayLog?.xp_earned ?? 0) + (deltas.todayXpDelta || 0);
    const todayLessons = (todayLog?.lessons_done ?? 0) + (deltas.todayLessonsDelta || 0);

    if (goal.goal_type === 'xp') return todayXp >= goal.goal_target;
    if (goal.goal_type === 'lessons') return todayLessons >= goal.goal_target;
  } catch (_) {}
  return false;
}

/**
 * Retourne l'état gamification complet pour l'affichage (Dashboard, Profile).
 * @param {Object} ctx
 * @returns {Promise<Object>} { streak, freezes, bestStreak, todayXp, todayLessons,
 *                               goalMet, goal, achievements, mastery }
 */
export async function getGamificationState(ctx) {
  const { learner, getFirst, getAllProgress, getAchievements, getDailyGoal, MODULES } = ctx;
  const today = todayLocalDate();

  let todayLog = null;
  try {
    if (getFirst && learner) {
      todayLog = await getFirst('GET_TODAY_LOG', [learner.id, today]);
    }
  } catch (_) {}

  let unlockedAchievements = [];
  try {
    if (getAchievements) unlockedAchievements = await getAchievements();
  } catch (_) {}

  // v1.1.5 (correctif « Progression & succès figé ») : l'affichage fusionne
  // les succès STOCKÉS avec les succès SATISFAITS PAR LES DONNÉES ACTUELLES.
  // Ainsi, même si l'écriture avait échoué (ancien no-op mémoire sur web,
  // migration, base effacée), l'écran reflète toujours la réalité du
  // parcours au lieu de rester figé à 0.
  try {
    const liveSnapshot = await buildSnapshot(ctx);
    const liveKeys = evaluateAchievements(liveSnapshot, []);
    const merged = new Set([...unlockedAchievements, ...liveKeys]);
    unlockedAchievements = ACHIEVEMENTS.map(a => a.key).filter(k => merged.has(k));
  } catch (_) {}

  let goal = null;
  try {
    if (getDailyGoal) goal = await getDailyGoal();
  } catch (_) {}

  // Maîtrise par filière
  let mastery = [];
  try {
    if (getAllProgress && MODULES) {
      const allProg = await getAllProgress() || [];
      const byFiliere = {};
      for (const m of MODULES) {
        if (!byFiliere[m.filiere]) {
          byFiliere[m.filiere] = { filiere: m.filiere, total: 0, completed: 0, inProgress: 0 };
        }
        byFiliere[m.filiere].total += 1;
        const prog = allProg.find(p => p.module_id === m.id);
        if (prog?.status === 'completed') byFiliere[m.filiere].completed += 1;
        else if (prog?.status === 'in_progress') byFiliere[m.filiere].inProgress += 1;
      }
      mastery = Object.values(byFiliere);
    }
  } catch (_) {}

  const goalMet = todayLog?.goal_met === 1;

  return {
    streak: learner?.streak_days ?? 0,
    bestStreak: learner?.best_streak ?? learner?.streak_days ?? 0,
    freezes: learner?.streak_freezes ?? MAX_FREEZES,
    todayXp: todayLog?.xp_earned ?? 0,
    todayLessons: todayLog?.lessons_done ?? 0,
    goalMet,
    goal: goal ? { type: goal.goal_type, target: goal.goal_target, enabled: goal.enabled } : null,
    achievements: {
      unlocked: unlockedAchievements,
      total: ACHIEVEMENTS.length,
      remaining: ACHIEVEMENTS.length - unlockedAchievements.length,
      list: ACHIEVEMENTS.map(a => ({
        ...a,
        unlocked: unlockedAchievements.includes(a.key),
        categoryInfo: ACHIEVEMENT_CATEGORIES[a.category],
      })),
    },
    mastery,
  };
}

/**
 * Définit l'objectif quotidien de l'apprenant (préférence — autonomie).
 * @param {Object} ctx
 * @param {'lessons'|'xp'} goalType
 * @param {number} target
 */
export async function setDailyGoal(ctx, goalType, target) {
  const { learner, runAsync, enqueue } = ctx;
  if (!learner) throw new Error('setDailyGoal: learner requis');
  const id = `goal_${learner.id}`;
  const nowIso = new Date().toISOString();
  try {
    if (runAsync) {
      await runAsync('UPSERT_DAILY_GOAL', [id, learner.id, goalType, target, 1, nowIso]);
    }
    if (enqueue) enqueue('daily_goal', 'UPDATE', id, { learner_id: learner.id, goal_type: goalType, goal_target: target, enabled: 1, updated_at: nowIso });
  } catch (e) {
    console.warn('[gamification] UPSERT_DAILY_GOAL error:', e.message);
  }
}
