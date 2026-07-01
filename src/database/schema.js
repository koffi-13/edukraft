// src/database/schema.js
// Schéma SQLite EduKraft — version 2
// Toutes les données métier sont locales ; la colonne sync_status pilote la sync différentielle

export const SCHEMA_VERSION = 2;

// ── DDL ─────────────────────────────────────────────────────────────────────

export const CREATE_TABLES = `

-- Profil apprenant (un seul enregistrement pour le MVP)
CREATE TABLE IF NOT EXISTS learner (
  id              TEXT PRIMARY KEY,            -- UUID local
  name            TEXT NOT NULL,
  phone           TEXT,
  language        TEXT DEFAULT 'fr',
  total_xp        INTEGER DEFAULT 0,
  streak_days     INTEGER DEFAULT 0,
  last_active_at  TEXT,                        -- ISO 8601
  created_at      TEXT NOT NULL,
  server_id       TEXT,                        -- ID côté API après sync
  sync_status     TEXT DEFAULT 'pending',      -- pending | synced | error
  updated_at      TEXT NOT NULL,
  -- ── Profil étendu (v1.1) — nullable, rempli progressivement ──────────
  first_name      TEXT,
  last_name       TEXT,
  gender          TEXT,
  birth_date      TEXT,
  education_level TEXT,
  country         TEXT,
  state           TEXT,
  city            TEXT,
  address         TEXT,
  email           TEXT,
  photo_url       TEXT,
  bio             TEXT,
  profession      TEXT
);

-- Progression par module
CREATE TABLE IF NOT EXISTS module_progress (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  module_id       TEXT NOT NULL,               -- référence au JSON module
  status          TEXT DEFAULT 'not_started',  -- not_started | in_progress | completed
  current_lesson  INTEGER DEFAULT 0,
  lessons_done    INTEGER DEFAULT 0,
  total_xp_earned INTEGER DEFAULT 0,
  best_score      REAL DEFAULT 0,              -- 0.0–1.0
  started_at      TEXT,
  completed_at    TEXT,
  sync_status     TEXT DEFAULT 'pending',
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (learner_id) REFERENCES learner(id)
);

-- Résultats de quiz (une ligne par tentative)
CREATE TABLE IF NOT EXISTS quiz_attempt (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  lesson_index    INTEGER NOT NULL,
  attempt_number  INTEGER DEFAULT 1,
  score           REAL NOT NULL,               -- 0.0–1.0
  answers         TEXT NOT NULL,               -- JSON: [{qId, selected, correct}]
  xp_awarded      INTEGER DEFAULT 0,
  passed          INTEGER DEFAULT 0,           -- 0|1 (boolean)
  completed_at    TEXT NOT NULL,
  sync_status     TEXT DEFAULT 'pending',
  FOREIGN KEY (learner_id) REFERENCES learner(id)
);

-- Badges / certifications obtenus
CREATE TABLE IF NOT EXISTS badge (
  id              TEXT PRIMARY KEY,            -- UUID local = seed du hash blockchain
  learner_id      TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  module_title    TEXT NOT NULL,
  score           REAL NOT NULL,
  xp_total        INTEGER NOT NULL,
  badge_hash      TEXT NOT NULL,               -- SHA-256 simulé, tx hash Polygon plus tard
  qr_payload      TEXT NOT NULL,               -- URL de vérification encodée dans le QR
  blockchain_tx   TEXT,                        -- Hash tx Polygon (null tant que offline)
  issued_at       TEXT NOT NULL,
  sync_status     TEXT DEFAULT 'pending',      -- pending | synced | error
  FOREIGN KEY (learner_id) REFERENCES learner(id)
);

-- File d'attente de synchronisation différentielle
-- Tout enregistrement modifié offline enqueue une entrée ici
CREATE TABLE IF NOT EXISTS sync_queue (
  id              TEXT PRIMARY KEY,
  table_name      TEXT NOT NULL,               -- learner | module_progress | quiz_attempt | badge
  record_id       TEXT NOT NULL,
  operation       TEXT NOT NULL,               -- INSERT | UPDATE
  payload         TEXT NOT NULL,               -- JSON de l'objet complet
  queued_at       TEXT NOT NULL,
  retry_count     INTEGER DEFAULT 0,
  last_error      TEXT
);

-- Métadonnées de synchronisation globale
CREATE TABLE IF NOT EXISTS sync_meta (
  key             TEXT PRIMARY KEY,
  value           TEXT
);

-- ─── Gamification (v2) ───────────────────────────────────────────────────
-- Activité journalière (calcule les streaks + objectifs quotidiens)
CREATE TABLE IF NOT EXISTS streak_log (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  activity_date   TEXT NOT NULL,          -- 'YYYY-MM-DD' (date locale)
  lessons_done    INTEGER DEFAULT 0,
  xp_earned       INTEGER DEFAULT 0,
  streak_freeze_used INTEGER DEFAULT 0,
  goal_met        INTEGER DEFAULT 0,      -- 0|1
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  sync_status     TEXT DEFAULT 'pending',
  UNIQUE(learner_id, activity_date),
  FOREIGN KEY (learner_id) REFERENCES learner(id)
);

-- Succès débloqués (achievements liés à des comportements d'apprentissage)
CREATE TABLE IF NOT EXISTS achievement (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  achievement_key TEXT NOT NULL,          -- ex: 'first_lesson', 'streak_7'
  unlocked_at     TEXT NOT NULL,
  sync_status     TEXT DEFAULT 'pending',
  UNIQUE(learner_id, achievement_key),
  FOREIGN KEY (learner_id) REFERENCES learner(id)
);

-- Objectif quotidien (préférence apprenant — autonomie)
CREATE TABLE IF NOT EXISTS daily_goal (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT NOT NULL,
  goal_type       TEXT NOT NULL,          -- 'lessons' | 'xp'
  goal_target     INTEGER NOT NULL,       -- ex: 1 leçon, 30 XP
  enabled         INTEGER DEFAULT 1,
  updated_at      TEXT NOT NULL,
  sync_status     TEXT DEFAULT 'pending',
  UNIQUE(learner_id)
);
`;

export const INITIAL_SYNC_META = `
INSERT OR IGNORE INTO sync_meta (key, value) VALUES
  ('schema_version', '${SCHEMA_VERSION}'),
  ('last_sync_at',   NULL),
  ('sync_cursor',    '0');
`;

// ── Migration v1 → v2 : ajoute les colonnes gamification au learner ─────────
// SQLite ne supporte pas ADD COLUMN IF NOT EXISTS → DbProvider exécute chaque
// ALTER dans un try/catch (idempotent : une colonne déjà existante lève une
// erreur qui est ignorée). Chaque instruction doit être lancée séparément.
export const MIGRATE_LEARNER_V2 = [
  'ALTER TABLE learner ADD COLUMN streak_freezes INTEGER DEFAULT 2',
  'ALTER TABLE learner ADD COLUMN best_streak INTEGER DEFAULT 0',
  'ALTER TABLE learner ADD COLUMN last_active_date TEXT',
  'ALTER TABLE learner ADD COLUMN total_lessons_done INTEGER DEFAULT 0',
];

// ── Migration v1 → v1.1 : ajoute les colonnes du profil étendu au learner ────
export const MIGRATE_LEARNER_V3 = [
  'ALTER TABLE learner ADD COLUMN first_name TEXT',
  'ALTER TABLE learner ADD COLUMN last_name TEXT',
  'ALTER TABLE learner ADD COLUMN gender TEXT',
  'ALTER TABLE learner ADD COLUMN birth_date TEXT',
  'ALTER TABLE learner ADD COLUMN education_level TEXT',
  'ALTER TABLE learner ADD COLUMN country TEXT',
  'ALTER TABLE learner ADD COLUMN state TEXT',
  'ALTER TABLE learner ADD COLUMN city TEXT',
  'ALTER TABLE learner ADD COLUMN address TEXT',
  'ALTER TABLE learner ADD COLUMN email TEXT',
  'ALTER TABLE learner ADD COLUMN photo_url TEXT',
  'ALTER TABLE learner ADD COLUMN bio TEXT',
  'ALTER TABLE learner ADD COLUMN profession TEXT',
];

// ── Requêtes préparées fréquentes ───────────────────────────────────────────

export const QUERIES = {
  // Learner
  GET_LEARNER:              'SELECT * FROM learner LIMIT 1',
  UPSERT_LEARNER:           `INSERT INTO learner (id, name, phone, language, total_xp, streak_days, last_active_at, created_at, updated_at, sync_status)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                              ON CONFLICT(id) DO UPDATE SET
                                name=excluded.name, language=excluded.language,
                                total_xp=excluded.total_xp, streak_days=excluded.streak_days,
                                last_active_at=excluded.last_active_at,
                                updated_at=excluded.updated_at, sync_status='pending'`,
  ADD_XP:                   `UPDATE learner SET total_xp = total_xp + ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,

  // ── Gamification : streak ─────────────────────────────────────────────
  // Met à jour le cache streak côté learner
  UPDATE_STREAK_CACHE:      `UPDATE learner SET
                                streak_days = ?, streak_freezes = ?, best_streak = ?,
                                last_active_date = ?, last_active_at = ?,
                                total_lessons_done = total_lessons_done + ?,
                                updated_at = ?, sync_status = 'pending'
                              WHERE id = ?`,
  // Upsert du log journalier (incrément lessons/xp si ligne existe déjà)
  UPSERT_STREAK_LOG:        `INSERT INTO streak_log
                              (id, learner_id, activity_date, lessons_done, xp_earned, streak_freeze_used, goal_met, created_at, updated_at, sync_status)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                              ON CONFLICT(learner_id, activity_date) DO UPDATE SET
                                lessons_done = streak_log.lessons_done + excluded.lessons_done,
                                xp_earned = streak_log.xp_earned + excluded.xp_earned,
                                goal_met = MAX(streak_log.goal_met, excluded.goal_met),
                                streak_freeze_used = MAX(streak_log.streak_freeze_used, excluded.streak_freeze_used),
                                updated_at = excluded.updated_at, sync_status = 'pending'`,
  GET_TODAY_LOG:            'SELECT * FROM streak_log WHERE learner_id = ? AND activity_date = ?',
  GET_STREAK_LOGS_RANGE:    'SELECT * FROM streak_log WHERE learner_id = ? AND activity_date >= ? AND activity_date <= ? ORDER BY activity_date ASC',
  GET_LAST_ACTIVITY_DATE:   'SELECT last_active_date FROM learner WHERE id = ?',

  // ── Gamification : achievements ───────────────────────────────────────
  INSERT_ACHIEVEMENT:       `INSERT OR IGNORE INTO achievement
                              (id, learner_id, achievement_key, unlocked_at, sync_status)
                              VALUES (?, ?, ?, ?, 'pending')`,
  GET_ACHIEVEMENTS:         'SELECT achievement_key, unlocked_at FROM achievement WHERE learner_id = ? ORDER BY unlocked_at ASC',

  // ── Gamification : objectif quotidien ─────────────────────────────────
  GET_DAILY_GOAL:           'SELECT * FROM daily_goal WHERE learner_id = ?',
  UPSERT_DAILY_GOAL:        `INSERT INTO daily_goal
                              (id, learner_id, goal_type, goal_target, enabled, updated_at, sync_status)
                              VALUES (?, ?, ?, ?, ?, ?, 'pending')
                              ON CONFLICT(learner_id) DO UPDATE SET
                                goal_type = excluded.goal_type,
                                goal_target = excluded.goal_target,
                                enabled = excluded.enabled,
                                updated_at = excluded.updated_at,
                                sync_status = 'pending'`,

  // Module progress
  GET_MODULE_PROGRESS:      'SELECT * FROM module_progress WHERE learner_id = ? AND module_id = ?',
  GET_ALL_PROGRESS:         'SELECT * FROM module_progress WHERE learner_id = ?',
  UPSERT_PROGRESS:          `INSERT INTO module_progress
                              (id, learner_id, module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, started_at, completed_at, sync_status, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                              ON CONFLICT(id) DO UPDATE SET
                                status=excluded.status, current_lesson=excluded.current_lesson,
                                lessons_done=excluded.lessons_done, total_xp_earned=excluded.total_xp_earned,
                                best_score=excluded.best_score, started_at=excluded.started_at,
                                completed_at=excluded.completed_at,
                                updated_at=excluded.updated_at, sync_status='pending'`,

  // Quiz attempts
  INSERT_QUIZ_ATTEMPT:      `INSERT INTO quiz_attempt
                              (id, learner_id, module_id, lesson_index, attempt_number, score, answers, xp_awarded, passed, completed_at, sync_status)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  GET_QUIZ_ATTEMPTS:        'SELECT * FROM quiz_attempt WHERE learner_id = ? AND module_id = ? AND lesson_index = ? ORDER BY completed_at DESC',
  COUNT_PASSED_QUIZZES:     'SELECT COUNT(*) as cnt FROM quiz_attempt WHERE learner_id = ? AND passed = 1',
  COUNT_PERFECT_QUIZZES:    'SELECT COUNT(*) as cnt FROM quiz_attempt WHERE learner_id = ? AND score = 1.0',
  COUNT_STARTED_MODULES:    'SELECT COUNT(*) as cnt FROM module_progress WHERE learner_id = ? AND status != "not_started"',
  COUNT_COMPLETED_MODULES:  'SELECT COUNT(*) as cnt FROM module_progress WHERE learner_id = ? AND status = "completed"',

  // Badges
  INSERT_BADGE:             `INSERT INTO badge
                              (id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, sync_status)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  GET_ALL_BADGES:           'SELECT * FROM badge WHERE learner_id = ? ORDER BY issued_at DESC',
  UPDATE_BADGE_TX:          `UPDATE badge SET blockchain_tx = ?, sync_status = 'synced' WHERE id = ?`,

  // Sync queue
  ENQUEUE:                  `INSERT INTO sync_queue (id, table_name, record_id, operation, payload, queued_at, retry_count)
                              VALUES (?, ?, ?, ?, ?, ?, 0)`,
  GET_PENDING_QUEUE:        'SELECT * FROM sync_queue ORDER BY queued_at ASC LIMIT 50',
  DELETE_FROM_QUEUE:        'DELETE FROM sync_queue WHERE id = ?',
  INCREMENT_RETRY:          'UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?',

  // Sync meta
  GET_META:                 'SELECT value FROM sync_meta WHERE key = ?',
  SET_META:                 `INSERT INTO sync_meta (key, value) VALUES (?, ?)
                              ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
};