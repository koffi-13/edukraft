// EduKraft API REST — Backend minimal pour sync offline
// Conçu pour fonctionner sur un VPS bas coût (DigitalOcean / Railway / Render)

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { init: initBlockchain, mintBadge: mintOnChain, verifyBadge: verifyOnChain, getHealth: getBlockchainHealth } = require('./blockchain');
const payments = require('./payments');
const auth = require('./auth');
const gamification = require('./gamification');

// ── Configuration ────────────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT, 10) || 3001;
const API_KEY = process.env.API_KEY || 'dev-key';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'edukraft.db');
const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGINS.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '2mb' }));

// ── Base de données SQLite ───────────────────────────────────────────────────
let db;

function initDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS learner (
      id              TEXT PRIMARY KEY,
      server_id       TEXT UNIQUE,
      client_id       TEXT NOT NULL,
      name            TEXT NOT NULL,
      phone           TEXT,
      language        TEXT DEFAULT 'fr',
      total_xp        INTEGER DEFAULT 0,
      streak_days     INTEGER DEFAULT 0,
      last_active_at  TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      -- ── Profil étendu (v1.1) ───────────────────────────────────────────
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

    CREATE TABLE IF NOT EXISTS module_progress (
      id              TEXT PRIMARY KEY,
      server_id       TEXT UNIQUE,
      client_id       TEXT NOT NULL,
      learner_id      TEXT NOT NULL REFERENCES learner(id),
      module_id       TEXT NOT NULL,
      status          TEXT DEFAULT 'not_started',
      current_lesson  INTEGER DEFAULT 0,
      lessons_done    INTEGER DEFAULT 0,
      total_xp_earned INTEGER DEFAULT 0,
      best_score      REAL DEFAULT 0,
      started_at      TEXT,
      completed_at    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempt (
      id              TEXT PRIMARY KEY,
      server_id       TEXT UNIQUE,
      client_id       TEXT NOT NULL,
      learner_id      TEXT NOT NULL REFERENCES learner(id),
      module_id       TEXT NOT NULL,
      lesson_index    INTEGER NOT NULL,
      attempt_number  INTEGER DEFAULT 1,
      score           REAL NOT NULL,
      answers         TEXT NOT NULL,
      xp_awarded      INTEGER DEFAULT 0,
      passed          INTEGER DEFAULT 0,
      completed_at    TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS badge (
      id              TEXT PRIMARY KEY,
      server_id       TEXT UNIQUE,
      client_id       TEXT NOT NULL,
      learner_id      TEXT NOT NULL REFERENCES learner(id),
      module_id       TEXT NOT NULL,
      module_title    TEXT NOT NULL,
      score           REAL NOT NULL,
      xp_total        INTEGER NOT NULL,
      badge_hash      TEXT NOT NULL,
      qr_payload      TEXT NOT NULL,
      blockchain_tx   TEXT,
      issued_at       TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_progress_learner ON module_progress(learner_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_learner    ON quiz_attempt(learner_id);
    CREATE INDEX IF NOT EXISTS idx_badge_learner    ON badge(learner_id);
  `);

  console.log(`[DB] SQLite initialisé : ${DB_PATH}`);
}

// ── Middleware : API Key ─────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Clé API invalide' });
  }
  next();
}

// ── Middleware : rate limiting simple (en mémoire) ──────────────────────────
const rateLimitMap = new Map();
function rateLimit(maxReqs = 60, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, start: now };

    if (now - entry.start > windowMs) {
      entry.count = 0;
      entry.start = now;
    }
    entry.count++;
    rateLimitMap.set(ip, entry);

    if (entry.count > maxReqs) {
      return res.status(429).json({ error: 'Trop de requêtes. Réessayez plus tard.' });
    }
    next();
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function fail(res, message, statusCode = 400) {
  return res.status(statusCode).json({ success: false, error: message });
}

/** Trouve ou crée un learner par client_id */
function findOrCreateLearner(clientId, payload) {
  let learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(clientId);
  const now = new Date().toISOString();

  if (!learner) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO learner (id, server_id, client_id, name, phone, language, total_xp, streak_days, last_active_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, `srv_${uuidv4().slice(0, 8)}`, clientId, payload.name, payload.phone || null, payload.language || 'fr',
      payload.total_xp || 0, payload.streak_days || 0, now, now, now);
    learner = db.prepare('SELECT * FROM learner WHERE id = ?').get(id);
  } else {
    // Mettre à jour les champs modifiés (COALESCE pour ne pas écraser les champs
    // absents du payload — important pour les updates partiels gamification)
    db.prepare(`
      UPDATE learner SET name = COALESCE(?, name), phone = COALESCE(?, phone), language = COALESCE(?, language),
        total_xp = MAX(total_xp, ?), streak_days = MAX(streak_days, ?),
        last_active_at = ?, updated_at = ?
      WHERE id = ?
    `).run(payload.name, payload.phone, payload.language, payload.total_xp || 0, payload.streak_days || 0, now, now, learner.id);
    learner = db.prepare('SELECT * FROM learner WHERE id = ?').get(learner.id);
  }
  return learner;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  success(res, {
    status: 'ok',
    version: '2.0.0',
    phase: 3,
    features: ['offline_sync', 'blockchain_certification', 'mobile_payment'],
    blockchain: await getBlockchainHealth(),
    payment_mock: payments.PAYMENT_MOCK,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── Sync endpoint principal ──────────────────────────────────────────────────
// Le client envoie un batch d'opérations, le serveur les traite et renvoie
// le serveur_id de chaque enregistrement pour que le client puisse les lier.
app.post('/api/sync', rateLimit(30, 60000), async (req, res) => {
  try {
    const { operations, client_cursor } = req.body;

    if (!Array.isArray(operations) || operations.length === 0) {
      return fail(res, 'Le champ operations doit être un tableau non vide');
    }

    if (operations.length > 50) {
      return fail(res, 'Maximum 50 opérations par requête');
    }

    const results = [];
    const now = new Date().toISOString();

    // Commencer par s'assurer que le learner existe
    let learnerServerId = null;

    for (const op of operations) {
      const { table_name, operation, payload, record_id } = op;
      const clientId = record_id || payload?.id;

      try {
        let result = { client_id: clientId, status: 'ok' };

        switch (table_name) {
          case 'learner': {
            const learner = findOrCreateLearner(clientId, payload);
            learnerServerId = learner.id;
            result.server_id = learner.id;
            result.client_id = clientId;
            // Gamification : sync des champs streak/freezes/best_streak si présents
            if (payload.streak_days !== undefined || payload.streak_freezes !== undefined
                || payload.best_streak !== undefined || payload.last_active_date !== undefined
                || payload.total_lessons_done !== undefined) {
              gamification.applySyncOperation(db, 'learner', {
                ...payload,
                learner_id: learner.id,
              });
            }
            break;
          }

          case 'streak_log':
          case 'achievement':
          case 'daily_goal': {
            // Tables gamification — déléguer au module gamification
            // Résoudre le learner_id (client_id → server id)
            if (!payload.learner_id) {
              result.status = 'error';
              result.error = 'learner_id manquant';
              results.push(result);
              continue;
            }
            let gLearnerId = learnerServerId;
            if (!gLearnerId) {
              const l = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(payload.learner_id);
              if (!l) {
                result.status = 'error';
                result.error = 'Learner non trouvé';
                results.push(result);
                continue;
              }
              gLearnerId = l.id;
              learnerServerId = l.id;
            }
            const gRes = gamification.applySyncOperation(db, table_name, {
              ...payload,
              learner_id: gLearnerId,
            });
            result.status = gRes.status;
            if (gRes.server_id) result.server_id = gRes.server_id;
            if (gRes.error) result.error = gRes.error;
            break;
          }

          case 'module_progress': {
            // S'assurer que le learner existe
            if (!learnerServerId) {
              // Chercher le learner par payload.learner_id
              const l = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(payload.learner_id);
              if (!l) {
                result.status = 'error';
                result.error = 'Learner non trouvé';
                results.push(result);
                continue;
              }
              learnerServerId = l.id;
            }

            const existing = db.prepare('SELECT * FROM module_progress WHERE client_id = ?').get(clientId);
            if (existing) {
              db.prepare(`
                UPDATE module_progress SET
                  status = ?, current_lesson = ?, lessons_done = ?, total_xp_earned = ?,
                  best_score = MAX(best_score, ?), started_at = COALESCE(?, started_at),
                  completed_at = ?, updated_at = ?
                WHERE id = ?
              `).run(
                payload.status || existing.status,
                payload.current_lesson ?? existing.current_lesson,
                payload.lessons_done ?? existing.lessons_done,
                payload.total_xp_earned ?? existing.total_xp_earned,
                payload.best_score || 0,
                payload.started_at || null,
                payload.completed_at || null,
                now, existing.id
              );
              result.server_id = existing.server_id;
            } else {
              const srvId = `srv_${uuidv4().slice(0, 8)}`;
              db.prepare(`
                INSERT INTO module_progress (id, server_id, client_id, learner_id, module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, started_at, completed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                uuidv4(), srvId, clientId, learnerServerId, payload.module_id,
                payload.status || 'not_started', payload.current_lesson || 0,
                payload.lessons_done || 0, payload.total_xp_earned || 0,
                payload.best_score || 0, payload.started_at || null,
                payload.completed_at || null, now, now
              );
              result.server_id = srvId;
            }
            break;
          }

          case 'quiz_attempt': {
            if (!learnerServerId) {
              const l = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(payload.learner_id);
              if (!l) {
                result.status = 'error';
                result.error = 'Learner non trouvé';
                results.push(result);
                continue;
              }
              learnerServerId = l.id;
            }

            const srvId = `srv_${uuidv4().slice(0, 8)}`;
            db.prepare(`
              INSERT INTO quiz_attempt (id, server_id, client_id, learner_id, module_id, lesson_index, attempt_number, score, answers, xp_awarded, passed, completed_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              uuidv4(), srvId, clientId, learnerServerId,
              payload.module_id, payload.lesson_index, payload.attempt_number || 1,
              payload.score, JSON.stringify(payload.answers),
              payload.xp_awarded || 0, payload.passed ? 1 : 0,
              payload.completed_at || now, now
            );
            result.server_id = srvId;
            break;
          }

          case 'badge': {
            if (!learnerServerId) {
              const l = db.prepare('SELECT id, name FROM learner WHERE client_id = ?').get(payload.learner_id);
              if (!l) {
                result.status = 'error';
                result.error = 'Learner non trouvé';
                results.push(result);
                continue;
              }
              learnerServerId = l.id;
            }

            const srvId = `srv_${uuidv4().slice(0, 8)}`;

            // Mint on-chain Polygon (mock en dev, réel en prod)
            const mintResult = await mintOnChain({
              walletAddress: learnerServerId,
              learnerName:  payload.learner_name || db.prepare('SELECT name FROM learner WHERE id = ?').get(learnerServerId)?.name || 'Unknown',
              moduleTitle:  payload.module_title,
              score:        payload.score,
              xpTotal:      payload.xp_total,
              certHash:     payload.badge_hash,
            });

            db.prepare(`
              INSERT INTO badge (id, server_id, client_id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              uuidv4(), srvId, clientId, learnerServerId,
              payload.module_id, payload.module_title, payload.score,
              payload.xp_total, payload.badge_hash, payload.qr_payload,
              mintResult.txHash, payload.issued_at || now, now
            );
            result.server_id = srvId;
            result.blockchain_tx = mintResult.txHash;
            result.on_chain = mintResult.real;
            break;
          }

          default:
            result.status = 'error';
            result.error = `Table inconnue: ${table_name}`;
        }

        results.push(result);
      } catch (err) {
        results.push({
          client_id: clientId,
          status: 'error',
          error: err.message,
        });
      }
    }

    const synced = results.filter(r => r.status === 'ok').length;
    const errors  = results.filter(r => r.status === 'error').length;

    success(res, {
      processed: operations.length,
      synced,
      errors,
      results,
      server_cursor: `srv_${Date.now()}`,
    });
  } catch (err) {
    console.error('[SYNC] Erreur:', err);
    fail(res, 'Erreur interne du serveur', 500);
  }
});

// ── Learner endpoints ────────────────────────────────────────────────────────

/** Récupérer ou créer un learner */
app.post('/api/learners', (req, res) => {
  try {
    const { id: clientId, name, phone, language, total_xp, streak_days } = req.body;
    if (!clientId || !name) {
      return fail(res, 'Les champs id et name sont requis');
    }
    const learner = findOrCreateLearner(clientId, { name, phone, language, total_xp, streak_days });
    success(res, { learner }, 201);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

/** Récupérer un learner par client_id */
app.get('/api/learners/:clientId', (req, res) => {
  const learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(req.params.clientId);
  if (!learner) return fail(res, 'Learner non trouvé', 404);
  success(res, { learner });
});

/** Mettre à jour le profil étendu d'un learner (v1.1) */
app.patch('/api/learners/:clientId/profile', (req, res) => {
  try {
    const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const allowedFields = [
      'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
      'country', 'state', 'city', 'address', 'email', 'photo_url', 'bio', 'profession'
    ];
    const updates = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (Object.keys(updates).length === 0) {
      return fail(res, 'Aucun champ à mettre à jour');
    }

    // Construire dynamiquement la requête UPDATE
    const setClauses = Object.keys(updates).map(f => `${f} = @${f}`);
    setClauses.push('updated_at = @updated_at');
    updates.updated_at = new Date().toISOString();
    updates.id = learner.id;

    db.prepare(`UPDATE learner SET ${setClauses.join(', ')} WHERE id = @id`).run(updates);

    const updated = db.prepare('SELECT * FROM learner WHERE id = ?').get(learner.id);
    success(res, { learner: updated });
  } catch (err) {
    console.error('[PATCH profile]', err);
    fail(res, err.message, 500);
  }
});

/** Upload photo de profil (base64, limité à 200 Ko) */
app.post('/api/learners/:clientId/photo', (req, res) => {
  try {
    const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const { photoBase64 } = req.body || {};
    if (!photoBase64) return fail(res, 'photoBase64 requis');

    // Limite ~200 Ko (base64 ~270 Ko)
    if (photoBase64.length > 300000) {
      return fail(res, 'Photo trop volumineuse (max 200 Ko)', 413);
    }

    // Stocker en base (pour MVP — en prod : stockage objet S3/Minio + URL)
    const now = new Date().toISOString();
    db.prepare('UPDATE learner SET photo_url = ?, updated_at = ? WHERE id = ?')
      .run(photoBase64, now, learner.id);

    success(res, { photo_url: photoBase64 });
  } catch (err) {
    fail(res, err.message, 500);
  }
});

// ── Progress endpoints ───────────────────────────────────────────────────────

/** Récupérer toute la progression d'un learner */
app.get('/api/progress/:clientId', (req, res) => {
  const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
  if (!learner) return fail(res, 'Learner non trouvé', 404);

  const progress = db.prepare('SELECT * FROM module_progress WHERE learner_id = ? ORDER BY updated_at DESC').all(learner.id);
  const badges = db.prepare('SELECT * FROM badge WHERE learner_id = ? ORDER BY issued_at DESC').all(learner.id);
  const attempts = db.prepare('SELECT * FROM quiz_attempt WHERE learner_id = ? ORDER BY completed_at DESC LIMIT 50').all(learner.id);

  success(res, { progress, badges, recent_attempts: attempts });
});

/** Mettre à jour la progression d'un module */
app.patch('/api/progress/:clientId/:moduleId', (req, res) => {
  try {
    const { clientId, moduleId } = req.params;
    const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const existing = db.prepare('SELECT * FROM module_progress WHERE learner_id = ? AND module_id = ?').get(learner.id, moduleId);
    const now = new Date().toISOString();
    const p = req.body;

    if (existing) {
      db.prepare(`
        UPDATE module_progress SET
          status = ?, current_lesson = ?, lessons_done = ?, total_xp_earned = ?,
          best_score = MAX(best_score, ?), completed_at = COALESCE(?, completed_at),
          updated_at = ?
        WHERE id = ?
      `).run(
        p.status || existing.status, p.current_lesson ?? existing.current_lesson,
        p.lessons_done ?? existing.lessons_done, p.total_xp_earned ?? existing.total_xp_earned,
        p.best_score || 0, p.completed_at || null, now, existing.id
      );
      const updated = db.prepare('SELECT * FROM module_progress WHERE id = ?').get(existing.id);
      success(res, { progress: updated });
    } else {
      const srvId = `srv_${uuidv4().slice(0, 8)}`;
      const id = uuidv4();
      db.prepare(`
        INSERT INTO module_progress (id, server_id, client_id, learner_id, module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, started_at, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, srvId, `${clientId}_${moduleId}`, learner.id, moduleId,
        p.status || 'not_started', p.current_lesson || 0, p.lessons_done || 0,
        p.total_xp_earned || 0, p.best_score || 0, now, null, now, now);
      const created = db.prepare('SELECT * FROM module_progress WHERE id = ?').get(id);
      success(res, { progress: created }, 201);
    }
  } catch (err) {
    fail(res, err.message, 500);
  }
});

// ── Quiz attempts ────────────────────────────────────────────────────────────

/** Enregistrer une tentative de quiz */
app.post('/api/quiz-attempts', (req, res) => {
  try {
    const { learner_id: clientId, module_id, lesson_index, score, answers, xp_awarded, passed } = req.body;
    if (!clientId || !module_id) {
      return fail(res, 'Les champs learner_id et module_id sont requis');
    }

    const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const previous = db.prepare('SELECT COUNT(*) as cnt FROM quiz_attempt WHERE learner_id = ? AND module_id = ? AND lesson_index = ?')
      .get(learner.id, module_id, lesson_index);

    const now = new Date().toISOString();
    const srvId = `srv_${uuidv4().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO quiz_attempt (id, server_id, client_id, learner_id, module_id, lesson_index, attempt_number, score, answers, xp_awarded, passed, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), srvId, `qa_${Date.now()}`, learner.id,
      module_id, lesson_index, previous.cnt + 1,
      score, JSON.stringify(answers), xp_awarded || 0, passed ? 1 : 0, now, now
    );

    success(res, { server_id: srvId }, 201);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

// ── Badges ───────────────────────────────────────────────────────────────────

/** Enregistrer un badge (mint on-chain Polygon) */
app.post('/api/badges', async (req, res) => {
  try {
    const { learner_id: clientId, module_id, module_title, score, xp_total, badge_hash, qr_payload, learner_name } = req.body;
    if (!clientId || !module_id) {
      return fail(res, 'Les champs learner_id et module_id sont requis');
    }

    const learner = db.prepare('SELECT id, name FROM learner WHERE client_id = ?').get(clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const now = new Date().toISOString();
    const srvId = `srv_${uuidv4().slice(0, 8)}`;

    // Mint sur Polygon PoS (mock en dev, réel en prod)
    const mintResult = await mintOnChain({
      walletAddress: learner.id, // En prod : adresse wallet réelle
      learnerName:  learner_name || learner.name,
      moduleTitle:  module_title,
      score,
      xpTotal:     xp_total,
      certHash:    badge_hash,
    });

    db.prepare(`
      INSERT INTO badge (id, server_id, client_id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), srvId, `badge_${Date.now()}`, learner.id,
      module_id, module_title, score, xp_total,
      badge_hash, qr_payload, mintResult.txHash, now, now
    );

    success(res, {
      server_id:     srvId,
      blockchain_tx:  mintResult.txHash,
      token_id:      mintResult.tokenId,
      network:        mintResult.network,
      on_chain:      mintResult.real,
    }, 201);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

/** Vérifier un badge sur la blockchain */
app.get('/api/verify/:certHash', async (req, res) => {
  try {
    const result = await verifyOnChain(req.params.certHash);
    success(res, result);
  } catch (err) {
    fail(res, err.message, 500);
  }
});

// ── Paiements mobiles (T-Money / Flooz) ────────────────────────────────────────

/** Initier un paiement mobile */
app.post('/api/payments/initiate', async (req, res) => {
  try {
    const { learner_id: clientId, provider, phone_number, product_type, product_id } = req.body;
    if (!clientId || !provider || !phone_number || !product_type) {
      return fail(res, 'Champs requis: learner_id, provider, phone_number, product_type');
    }

    const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(clientId);
    if (!learner) return fail(res, 'Learner non trouvé', 404);

    const result = await payments.createPayment(db, {
      learnerServerId: learner.id,
      provider,
      phoneNumber: phone_number,
      productType: product_type,
      productId: product_id,
    });

    success(res, result, 201);
  } catch (err) {
    fail(res, err.message, 400);
  }
});

/** Vérifier le statut d'un paiement */
app.get('/api/payments/status/:reference', async (req, res) => {
  try {
    const result = await payments.checkStatus(db, req.params.reference);
    success(res, result);
  } catch (err) {
    fail(res, err.message, 404);
  }
});

/** Historique des paiements */
app.get('/api/payments/history/:clientId', (req, res) => {
  const learner = db.prepare('SELECT id FROM learner WHERE client_id = ?').get(req.params.clientId);
  if (!learner) return fail(res, 'Learner non trouvé', 404);
  success(res, payments.getPaymentHistory(db, learner.id));
});

/** Webhook callback du fournisseur de paiement */
app.post('/api/payments/callback', (req, res) => {
  const signature = req.headers['x-signature'];
  const result = payments.handleProviderCallback(db, req.body, signature);
  result.success ? success(res, { received: true }) : fail(res, result.error, 403);
});

/** Tarification disponible */
app.get('/api/payments/pricing', (req, res) => {
  success(res, {
    products: payments.PRICING,
    providers: payments.PROVIDERS,
    currency: 'XOF',
    mock_mode: payments.PAYMENT_MOCK,
  });
});

// ── Statistiques publiques (pour leaderboard futur) ────────────────────────
app.get('/api/stats', (req, res) => {
  const totalLearners  = db.prepare('SELECT COUNT(*) as cnt FROM learner').get().cnt;
  const totalBadges    = db.prepare('SELECT COUNT(*) as cnt FROM badge').get().cnt;
  const totalAttempts  = db.prepare('SELECT COUNT(*) as cnt FROM quiz_attempt').get().cnt;
  const avgScore       = db.prepare('SELECT AVG(score) as avg FROM quiz_attempt').get().avg;

  success(res, {
    total_learners: totalLearners,
    total_badges: totalBadges,
    total_quiz_attempts: totalAttempts,
    average_score: Math.round((avgScore || 0) * 100),
  });
});

// ── Gestion des erreurs globales ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  fail(res, 'Erreur interne du serveur', 500);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTIFICATION — 5 providers (email, Google, Apple, Facebook, Phone OTP)
// ═══════════════════════════════════════════════════════════════════════════════
// Les routes /api/auth/* sont montées ci-dessous après initDatabase() (db requis).
// Rate-limiting spécifique :
//   - /api/auth/register & /api/auth/login : 10 req/min/IP (anti brute-force)
//   - /api/auth/phone                      : 5 req/min/IP   (anti spam SMS)

const authLimiter = rateLimit(10, 60_000);       // login/register
const otpLimiter  = rateLimit(5, 60_000);        // phone OTP

app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/phone',    otpLimiter);

// ── Démarrage ────────────────────────────────────────────────────────────────
initDatabase();
auth.initAuthTables(db);          // tables user + refresh_token
auth.mountAuthRoutes(app, db);    // /api/auth/* (register, login, google, apple, facebook, phone, me, refresh, logout)
gamification.initGamificationTables(db);  // tables streak_log + achievement + daily_goal + colonnes learner v2
gamification.mountGamificationRoutes(app, db);  // /api/gamification/*
initBlockchain();
payments.init(db);

app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────┐
  │       EduKraft API v1.0.0           │
  │     http://localhost:${PORT}          │
  │     Health: /api/health              │
  │     Sync:   POST /api/sync           │
  └─────────────────────────────────────┘
  `);
});
