// server/gamification.js
// Module gamification EduKraft — backend.
//
// Responsabilités :
//   - Création des tables v2 (streak_log, achievement, daily_goal) + colonnes learner
//   - Endpoints REST pour lire l'état gamification d'un apprenant
//   - Traitement des opérations gamification reçues via /api/sync (sync_queue)
//
// ⚠️ La logique métier (calcul streak, évaluation achievements) reste côté CLIENT
// (src/gamification/) — le serveur est principalement un magasin persistant.
// Le client envoie les opérations via sync_queue, le serveur les applique.
// Cette séparation garde le serveur simple et permet le mode hors-ligne.

'use strict';

const { v4: uuidv4 } = require('uuid');

// ── Définition des achievements (réplique serveur de src/gamification/achievements.js)
// Gardé en sync manuel — utilisé uniquement pour GET /api/gamification/achievements
// (renvoie la liste statique au client pour l'affichage).
const ACHIEVEMENT_DEFS = [
  { key: 'first_lesson', category: 'first_step', title: 'Premier pas', description: 'Terminer ta première leçon avec succès.' },
  { key: 'first_module', category: 'first_step', title: 'Premier diplôme', description: 'Obtenir ton premier badge de module certifié.' },
  { key: 'xp_100', category: 'first_step', title: 'Cent points', description: 'Accumuler 100 XP au total.' },
  { key: 'streak_3', category: 'consistency', title: 'Trois jours', description: 'Apprendre 3 jours de suite.' },
  { key: 'streak_7', category: 'consistency', title: 'Une semaine solide', description: 'Apprendre 7 jours de suite.' },
  { key: 'streak_30', category: 'consistency', title: 'Un mois de constance', description: 'Atteindre un meilleur streak de 30 jours.' },
  { key: 'perfect_quiz', category: 'mastery', title: 'Sans faute', description: 'Obtenir un score parfait (100%) à un quiz.' },
  { key: 'perfect_5', category: 'mastery', title: 'Régulier et précis', description: 'Obtenir 5 scores parfaits à des quiz.' },
  { key: 'modules_3', category: 'mastery', title: 'Polyvalent', description: 'Compléter 3 modules certifiés.' },
  { key: 'explore_2', category: 'curiosity', title: 'Explorateur', description: 'Commencer 2 modules différents.' },
  { key: 'explore_all', category: 'curiosity', title: 'Touche-à-tout', description: 'Commencer tous les modules disponibles.' },
  { key: 'comeback', category: 'resilience', title: 'Bon retour', description: 'Reprendre l’apprentissage après une absence d’au moins 7 jours.' },
];

// ── Création des tables ──────────────────────────────────────────────────────
function initGamificationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streak_log (
      id              TEXT PRIMARY KEY,
      learner_id      TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
      activity_date   TEXT NOT NULL,
      lessons_done    INTEGER DEFAULT 0,
      xp_earned       INTEGER DEFAULT 0,
      streak_freeze_used INTEGER DEFAULT 0,
      goal_met        INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE(learner_id, activity_date)
    );

    CREATE TABLE IF NOT EXISTS achievement (
      id              TEXT PRIMARY KEY,
      learner_id      TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
      achievement_key TEXT NOT NULL,
      unlocked_at     TEXT NOT NULL,
      UNIQUE(learner_id, achievement_key)
    );

    CREATE TABLE IF NOT EXISTS daily_goal (
      id              TEXT PRIMARY KEY,
      learner_id      TEXT NOT NULL UNIQUE REFERENCES learner(id) ON DELETE CASCADE,
      goal_type       TEXT NOT NULL,
      goal_target     INTEGER NOT NULL,
      enabled         INTEGER DEFAULT 1,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_streak_log_learner ON streak_log(learner_id);
    CREATE INDEX IF NOT EXISTS idx_achievement_learner ON achievement(learner_id);
  `);

  // Migration : colonnes gamification sur learner (idempotent)
  const migrations = [
    'ALTER TABLE learner ADD COLUMN streak_freezes INTEGER DEFAULT 2',
    'ALTER TABLE learner ADD COLUMN best_streak INTEGER DEFAULT 0',
    'ALTER TABLE learner ADD COLUMN last_active_date TEXT',
    'ALTER TABLE learner ADD COLUMN total_lessons_done INTEGER DEFAULT 0',
  ];
  for (const stmt of migrations) {
    try { db.exec(stmt); } catch (_) { /* colonne déjà là */ }
  }

  console.log('[GAMIFICATION] Tables streak_log + achievement + daily_goal initialisées');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function now() { return new Date().toISOString(); }

/** Récupère l'état gamification complet d'un apprenant (côté serveur). */
function getGamificationState(db, learnerId) {
  const learner = db.prepare(
    'SELECT total_xp, streak_days, streak_freezes, best_streak, last_active_date, total_lessons_done FROM learner WHERE id = ?'
  ).get(learnerId);
  if (!learner) return null;

  // Today's log
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = db.prepare(
    'SELECT lessons_done, xp_earned, goal_met FROM streak_log WHERE learner_id = ? AND activity_date = ?'
  ).get(learnerId, today) || { lessons_done: 0, xp_earned: 0, goal_met: 0 };

  // Achievements débloqués
  const achievements = db.prepare(
    'SELECT achievement_key, unlocked_at FROM achievement WHERE learner_id = ? ORDER BY unlocked_at ASC'
  ).all(learnerId).map(r => r.achievement_key);

  // Daily goal
  const goal = db.prepare(
    'SELECT goal_type, goal_target, enabled FROM daily_goal WHERE learner_id = ?'
  ).get(learnerId) || null;

  return {
    streak: learner.streak_days || 0,
    bestStreak: learner.best_streak || 0,
    freezes: learner.streak_freezes ?? 2,
    totalLessonsDone: learner.total_lessons_done || 0,
    todayXp: todayLog.xp_earned,
    todayLessons: todayLog.lessons_done,
    goalMet: todayLog.goal_met === 1,
    goal: goal ? { type: goal.goal_type, target: goal.goal_target, enabled: goal.enabled } : null,
    achievements: {
      unlocked: achievements,
      total: ACHIEVEMENT_DEFS.length,
      remaining: ACHIEVEMENT_DEFS.length - achievements.length,
    },
    lastActiveDate: learner.last_active_date,
  };
}

// ── Application d'une opération de sync gamification ─────────────────────────
// Appelé par server/index.js lors du traitement de /api/sync.
// @param {string} tableName - 'streak_log' | 'achievement' | 'daily_goal' | 'learner' (gamification fields)
// @param {Object} payload - données de l'opération
// @returns {Object} { status: 'ok'|'error', server_id?, error? }
function applySyncOperation(db, tableName, payload) {
  const t = now();
  try {
    switch (tableName) {
      case 'streak_log': {
        // Upsert par (learner_id, activity_date) — MAX (idempotent).
        // v1.1.6 : le client pousse les VALEURS ABSOLUES du jour (pas des
        // deltas). L'ancien sémantique d'incrément double-comptait lorsqu'une
        // même journée était poussée deux fois (fusion multi-appareils, retry,
        // reconnexion). MAX converge sans jamais doublonner.
        const id = uuidv4();
        db.prepare(`
          INSERT INTO streak_log (id, learner_id, activity_date, lessons_done, xp_earned, streak_freeze_used, goal_met, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(learner_id, activity_date) DO UPDATE SET
            lessons_done = MAX(streak_log.lessons_done, excluded.lessons_done),
            xp_earned = MAX(streak_log.xp_earned, excluded.xp_earned),
            goal_met = MAX(streak_log.goal_met, excluded.goal_met),
            streak_freeze_used = MAX(streak_log.streak_freeze_used, excluded.streak_freeze_used),
            updated_at = excluded.updated_at
        `).run(
          id, payload.learner_id, payload.activity_date,
          payload.lessons_done || 0, payload.xp_earned || 0,
          payload.streak_freeze_used || 0, payload.goal_met ? 1 : 0,
          t, t
        );
        return { status: 'ok', server_id: id };
      }

      case 'achievement': {
        const id = uuidv4();
        db.prepare(`
          INSERT OR IGNORE INTO achievement (id, learner_id, achievement_key, unlocked_at)
          VALUES (?, ?, ?, ?)
        `).run(id, payload.learner_id, payload.achievement_key, payload.unlocked_at || t);
        return { status: 'ok', server_id: id };
      }

      case 'daily_goal': {
        const id = `goal_${payload.learner_id}`;
        db.prepare(`
          INSERT INTO daily_goal (id, learner_id, goal_type, goal_target, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(learner_id) DO UPDATE SET
            goal_type = excluded.goal_type,
            goal_target = excluded.goal_target,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `).run(id, payload.learner_id, payload.goal_type, payload.goal_target, payload.enabled ?? 1, t);
        return { status: 'ok', server_id: id };
      }

      case 'learner': {
        // Les champs gamification du learner (streak_days, streak_freezes, best_streak,
        // last_active_date, total_lessons_done) sont mis à jour ici si présents.
        // v1.1.6 : sémantique MAX sur les compteurs (cohérente avec
        // findOrCreateLearner) — un appareil en retard ne peut plus rétrograder
        // les valeurs du compte (COALESCE seul écrasait streak_days=4 par 1).
        if (payload.learner_id || payload.id) {
          const lid = payload.learner_id || payload.id;
          db.prepare(`
            UPDATE learner SET
              streak_days = MAX(streak_days, COALESCE(?, streak_days)),
              streak_freezes = MAX(streak_freezes, COALESCE(?, streak_freezes)),
              best_streak = MAX(best_streak, COALESCE(?, best_streak)),
              last_active_date = COALESCE(?, last_active_date),
              total_lessons_done = MAX(total_lessons_done, COALESCE(?, total_lessons_done)),
              last_active_at = COALESCE(?, last_active_at),
              updated_at = ?
            WHERE id = ?
          `).run(
            payload.streak_days ?? null,
            payload.streak_freezes ?? null,
            payload.best_streak ?? null,
            payload.last_active_date ?? null,
            payload.total_lessons_done ?? null,
            payload.last_active_at ?? null,
            t, lid
          );
          return { status: 'ok' };
        }
        return { status: 'error', error: 'learner_id manquant' };
      }

      default:
        return { status: 'error', error: `Table gamification inconnue: ${tableName}` };
    }
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// ── Montage des routes ───────────────────────────────────────────────────────
function mountGamificationRoutes(app, db) {
  // ⚠️ Ordre important : les routes statiques doivent être déclarées AVANT les
  // routes paramétrées (/:clientId), sinon Express matche "achievements" comme
  // un clientId.

  // ── GET /api/gamification/achievements — liste statique des succès ───────
  app.get('/api/gamification/achievements', (req, res) => {
    res.json({ success: true, data: ACHIEVEMENT_DEFS });
  });

  // ── GET /api/gamification/:clientId — état gamification complet ──────────
  app.get('/api/gamification/:clientId', (req, res) => {
    try {
      const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
      if (!learner) return res.status(404).json({ success: false, error: 'Learner non trouvé' });

      const state = getGamificationState(db, learner.id);
      if (!state) return res.status(404).json({ success: false, error: 'État gamification introuvable' });

      res.json({ success: true, data: state });
    } catch (err) {
      console.error('[GAMIFICATION/get]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  // ── GET /api/gamification/:clientId/streak-log — historique (30 derniers j) ─
  app.get('/api/gamification/:clientId/streak-log', (req, res) => {
    try {
      const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
      if (!learner) return res.status(404).json({ success: false, error: 'Learner non trouvé' });

      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const logs = db.prepare(
        'SELECT * FROM streak_log WHERE learner_id = ? AND activity_date >= ? ORDER BY activity_date ASC'
      ).all(learner.id, since);

      res.json({ success: true, data: logs });
    } catch (err) {
      console.error('[GAMIFICATION/streak-log]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });
}

module.exports = {
  initGamificationTables,
  mountGamificationRoutes,
  applySyncOperation,
  ACHIEVEMENT_DEFS,
  getGamificationState,
};
