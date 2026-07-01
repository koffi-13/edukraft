// src/gamification/streakService.js
// Logique de streak (série de jours consécutifs) — approche "grâce plutôt que punition".
//
// Principes éducatifs :
//   - La régularité est encouragée, mais un jour manqué ne détruit pas tout.
//   - 2 "gels" (freeze) sont offerts au départ ; un gel consomme 1 jour manqué
//     sans casser la série. Les gels se régénèrent lentement (1 tous les 5 jours actifs).
//   - Le streak est calculé à partir des dates d'activité réelles (streak_log),
//     pas d'un compteur fragile incrémenté à chaque action.
//   - last_active_date est en DATE LOCALE (YYYY-MM-DD), pas UTC — sinon minuit
//     UTC casse artificiellement les séries selon le fuseau.

/**
 * Retourne la date locale actuelle au format 'YYYY-MM-DD'.
 * Utilise l'heure de l'appareil (fuseau local) — important pour les streaks.
 */
export function todayLocalDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Ajoute n jours à une date 'YYYY-MM-DD' et retourne 'YYYY-MM-DD'.
 * n peut être négatif.
 */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Différence en jours entre deux dates 'YYYY-MM-DD' (b - a).
 * Retourne un entier (positif si b après a, négatif si avant).
 */
export function daysBetween(aStr, bStr) {
  const [ay, am, ad] = aStr.split('-').map(Number);
  const [by, bm, bd] = bStr.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export const MAX_FREEZES = 2;
export const FREEZE_REGEN_EVERY_DAYS = 5; // 1 gel régénéré tous les 5 jours actifs

/**
 * Calcule l'état du streak après une activité à la date `today`.
 *
 * @param {Object} params
 * @param {string} params.today             - 'YYYY-MM-DD' date de l'activité
 * @param {string|null} params.lastActiveDate - 'YYYY-MM-DD' dernière activité enregistrée
 * @param {number}  params.currentStreak    - streak actuel (cache learner)
 * @param {number}  params.bestStreak       - meilleur streak
 * @param {number}  params.currentFreezes   - gels disponibles (0..MAX_FREEZES)
 * @returns {Object} { newStreak, newBestStreak, newFreezes, freezeUsed, activityDaysCount }
 *   - freezeUsed: nombre de gels consommés pour combler les jours manqués (0, 1, ou 0 si série cassée)
 *   - activityDaysCount: utilisé pour la régénération des gels (jours actifs consécutifs avant today)
 */
export function computeStreak({ today, lastActiveDate, currentStreak, bestStreak, currentFreezes }) {
  // 1ʳᵉ activité jamais enregistrée
  if (!lastActiveDate) {
    return {
      newStreak: 1,
      newBestStreak: Math.max(bestStreak, 1),
      newFreezes: currentFreezes,
      freezeUsed: 0,
      activityDaysCount: 1,
    };
  }

  const gap = daysBetween(lastActiveDate, today);

  // Même jour (activité multiple) > pas de changement de streak
  if (gap === 0) {
    return {
      newStreak: currentStreak,
      newBestStreak: bestStreak,
      newFreezes: currentFreezes,
      freezeUsed: 0,
      activityDaysCount: currentStreak,
    };
  }

  // Journée précédente > streak +1 (cas normal, idéal)
  if (gap === 1) {
    const newStreak = currentStreak + 1;
    return {
      newStreak,
      newBestStreak: Math.max(bestStreak, newStreak),
      newFreezes: currentFreezes,
      freezeUsed: 0,
      activityDaysCount: newStreak,
    };
  }

  // gap >= 2 : il y a des jours manqués.
  // Combien de gels faudrait-il ? gap - 1 (les jours entre les deux dates, excluant today).
  // Par exemple gap=2 > 1 jour manqué > 1 gel nécessaire.
  const freezesNeeded = gap - 1;

  if (freezesNeeded <= currentFreezes) {
    // On a assez de gels > la série continue, streak += 1 (le jour today),
    // les jours manqués sont "pardonnés".
    return {
      newStreak: currentStreak + 1,
      newBestStreak: Math.max(bestStreak, currentStreak + 1),
      newFreezes: currentFreezes - freezesNeeded,
      freezeUsed: freezesNeeded,
      activityDaysCount: currentStreak + 1,
    };
  }

  // Pas assez de gels > la série est cassée. On redémarre à 1.
  return {
    newStreak: 1,
    newBestStreak: bestStreak,
    newFreezes: currentFreezes, // les gels sont conservés (non consommés sur un échec)
    freezeUsed: 0,
    activityDaysCount: 1,
  };
}

/**
 * Recalcule le nombre de gels disponibles après `activityDaysCount` jours actifs.
 * La régénération est lente : 1 gel tous les FREEZE_REGEN_EVERY_DAYS jours actifs,
 * plafonné à MAX_FREEZES.
 *
 * @param {number} currentFreezes - gels actuels (après consommation éventuelle)
 * @param {number} activityDaysCount - jours actifs consécutifs (newStreak)
 * @returns {number} gels finaux (peut être supérieur si régénération)
 */
export function regenerateFreezes(currentFreezes, activityDaysCount) {
  const earned = Math.floor(activityDaysCount / FREEZE_REGEN_EVERY_DAYS);
  return Math.min(MAX_FREEZES, currentFreezes + earned);
}
