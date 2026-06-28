// src/database/schema.js
// Schéma SQLite EduKraft — version 1
// Toutes les données métier sont locales ; la colonne sync_status pilote la sync différentielle

export const SCHEMA_VERSION = 1;

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
  updated_at      TEXT NOT NULL
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
`;

export const INITIAL_SYNC_META = `
INSERT OR IGNORE INTO sync_meta (key, value) VALUES
  ('schema_version', '${SCHEMA_VERSION}'),
  ('last_sync_at',   NULL),
  ('sync_cursor',    '0');
`;

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