// src/gamification/achievements.js
// Définition des succès EduKraft — chaque succès récompense un COMPORTEMENT
// d'apprentissage réel, pas un indicateur de vanité.
//
// Catégories :
//   - first_step   : démarrage (récompense l'engagement initial)
//   - consistency  : régularité (streaks — récompense la constance, pas l'intensité)
//   - mastery      : maîtrise (scores parfaits, modules complétés — récompense la compétence)
//   - curiosity    : curiosité (explorer plusieurs domaines — récompense l'ouverture)
//   - resilience   : résilience (revenir après une absence — anti-honte de l'échec)
//
// ⚠️ Anti-patterns volontairement ABSENTS :
//   - Pas de "quiz réussi en moins de X secondes" (encourage la précipitation, pas la compréhension)
//   - Pas de "X jours sans rater" (punition déguisée)
//   - Pas de classement vs autres (anxiété de comparaison)
//   - Pas de succès secrets non documentés (frustration)

export const ACHIEVEMENT_CATEGORIES = {
  // v1.1 : icones ASCII uniquement (emojis remplaces pour compatibilite Android)
  first_step:  { label: 'Premiers pas', color: '#5B4ABB', icon: '[1]' },
  consistency: { label: 'Constance',    color: '#D85A30', icon: '[*]' },
  mastery:     { label: 'Maitrise',     color: '#1D9E75', icon: '[M]' },
  curiosity:   { label: 'Curiosite',    color: '#BA7517', icon: '[?]' },
  resilience:  { label: 'Resilience',   color: '#F0B429', icon: '[R]' },
};

export const ACHIEVEMENTS = [
  // ── Premiers pas ────────────────────────────────────────────────────────
  {
    key: 'first_lesson',
    category: 'first_step',
    title: 'Premier pas',
    description: 'Terminer ta première leçon avec succès.',
    // evaluate reçoit un snapshot de l'apprenant, retourne true si débloqué
    evaluate: (s) => s.totalLessonsDone >= 1,
  },
  {
    key: 'first_module',
    category: 'first_step',
    title: 'Premier diplôme',
    description: 'Obtenir ton premier badge de module certifié.',
    evaluate: (s) => s.completedModules >= 1,
  },
  {
    key: 'xp_100',
    category: 'first_step',
    title: 'Cent points',
    description: 'Accumuler 100 XP au total.',
    evaluate: (s) => s.totalXp >= 100,
  },

  // ── Constance (streaks) ─────────────────────────────────────────────────
  {
    key: 'streak_3',
    category: 'consistency',
    title: 'Trois jours',
    description: 'Apprendre 3 jours de suite.',
    evaluate: (s) => s.bestStreak >= 3,
  },
  {
    key: 'streak_7',
    category: 'consistency',
    title: 'Une semaine solide',
    description: 'Apprendre 7 jours de suite.',
    evaluate: (s) => s.bestStreak >= 7,
  },
  {
    key: 'streak_30',
    category: 'consistency',
    title: 'Un mois de constance',
    description: 'Atteindre un meilleur streak de 30 jours.',
    evaluate: (s) => s.bestStreak >= 30,
  },

  // ── Maîtrise ────────────────────────────────────────────────────────────
  {
    key: 'perfect_quiz',
    category: 'mastery',
    title: 'Sans faute',
    description: 'Obtenir un score parfait (100%) à un quiz.',
    evaluate: (s) => s.perfectQuizzes >= 1,
  },
  {
    key: 'perfect_5',
    category: 'mastery',
    title: 'Régulier et précis',
    description: 'Obtenir 5 scores parfaits à des quiz.',
    evaluate: (s) => s.perfectQuizzes >= 5,
  },
  {
    key: 'modules_3',
    category: 'mastery',
    title: 'Polyvalent',
    description: 'Compléter 3 modules certifiés.',
    evaluate: (s) => s.completedModules >= 3,
  },

  // ── Curiosité ───────────────────────────────────────────────────────────
  {
    key: 'explore_2',
    category: 'curiosity',
    title: 'Explorateur',
    description: 'Commencer 2 modules différents.',
    evaluate: (s) => s.startedModules >= 2,
  },
  {
    key: 'explore_all',
    category: 'curiosity',
    title: 'Touche-à-tout',
    description: 'Commencer tous les modules disponibles.',
    evaluate: (s) => s.startedModules >= s.totalAvailableModules && s.totalAvailableModules > 0,
  },

  // ── Résilience (anti-honte : revenir après absence est un succès) ────────
  {
    key: 'comeback',
    category: 'resilience',
    title: 'Bon retour',
    description: "Reprendre l'apprentissage après une absence d'au moins 7 jours.",
    evaluate: (s) => s.comebackAfterDays >= 7,
  },
];

/**
 * Retourne la définition d'un achievement par sa clé.
 */
export function getAchievement(key) {
  return ACHIEVEMENTS.find(a => a.key === key);
}

/**
 * Évalue tous les achievements non encore débloqués contre un snapshot.
 * @param {Object} snapshot - { totalLessonsDone, completedModules, totalXp,
 *                              bestStreak, perfectQuizzes, startedModules,
 *                              totalAvailableModules, comebackAfterDays }
 * @param {string[]} alreadyUnlockedKeys - clés déjà débloquées (à ignorer)
 * @returns {string[]} clés des achievements nouvellement débloqués
 */
export function evaluateAchievements(snapshot, alreadyUnlockedKeys = []) {
  const unlockedSet = new Set(alreadyUnlockedKeys);
  const newlyUnlocked = [];
  for (const ach of ACHIEVEMENTS) {
    if (unlockedSet.has(ach.key)) continue;
    try {
      if (ach.evaluate(snapshot)) {
        newlyUnlocked.push(ach.key);
      }
    } catch (_) {
      // une erreur d'évaluation ne doit pas casser le flux
    }
  }
  return newlyUnlocked;
}
