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
const replication = require('./dbReplication');

// ── Configuration ────────────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT, 10) || 3001;
const API_KEY = process.env.API_KEY || 'dev-key';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'edukraft.db');
// CORS_ORIGINS : liste d'origines séparées par des virgules, ou '*'.
// ⚠️ Bug v1.1.3 corrigé : avant, `CORS_ORIGINS='*'` produisait origin:['*'],
// un TABLEAU — que le middleware cors traite comme une liste blanche EXACTE
// (l'origine littérale '*' n'existe jamais) → AUCUNE réponse n'avait l'en-tête
// Access-Control-Allow-Origin → « Failed to fetch » sur TOUT le web (l'APK
// natif n'est pas soumis au CORS, d'où l'illusion que l'API marchait).
const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';

const app = express();

const corsOriginsList = CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
const corsAllowAll = corsOriginsList.length === 0 || corsOriginsList.includes('*');
app.use(cors({
  origin(origin, callback) {
    // Autorisé : mode ouvert ('*'), requêtes same-origin/sans Origin (curl,
    // apps natives, health checks), ou origine explicitement listée.
    if (corsAllowAll || !origin || corsOriginsList.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false); // origine non autorisée : pas d'en-tête CORS
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Client'],
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));

// v1.1.9 : suivi des écritures pour la réplication GitHub — DOIT être
// installé AVANT le montage des routes (middleware pass-through qui écoute
// res.on('finish')). L'attachement de la DB (attachDb) se fait après
// initDatabase() dans le démarrage asynchrone ci-dessous.
replication.installDirtyTracking(app);

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

/** Trouve ou crée un learner par client_id.
 *  v1.1.8 : les champs du PROFIL ÉTENDU (prénom, nom, email, photo, bio,
 *  profession, localisation…) sont désormais PERSISTÉS — avant, seuls
 *  name/phone/language/XP/streak étaient mis à jour et les « informations de
 *  l'utilisateur » saisies sur un appareil n'étaient jamais synchronisées.
 *  Sémantique : COALESCE (une valeur null/absente n'écrase jamais) + les
 *  compteurs restent en MAX (anti-rétrograde). */
const LEARNER_PROFILE_FIELDS = [
  'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
  'country', 'state', 'city', 'address', 'email', 'photo_url', 'bio', 'profession',
];

function findOrCreateLearner(clientId, payload) {
  let learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(clientId);
  const now = new Date().toISOString();

  if (!learner) {
    const id = uuidv4();
    const cols = ['id', 'server_id', 'client_id', 'name', 'phone', 'language', 'total_xp', 'streak_days', 'last_active_at', 'created_at', 'updated_at'];
    const vals = [id, `srv_${uuidv4().slice(0, 8)}`, clientId, payload.name, payload.phone || null, payload.language || 'fr',
      payload.total_xp || 0, payload.streak_days || 0, now, now, now];
    // v1.1.8 : insérer aussi les champs de profil connus du client
    for (const f of LEARNER_PROFILE_FIELDS) {
      if (payload[f] !== undefined && payload[f] !== null && String(payload[f]).trim() !== '') {
        cols.push(f);
        vals.push(payload[f]);
      }
    }
    db.prepare(`INSERT INTO learner (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    learner = db.prepare('SELECT * FROM learner WHERE id = ?').get(id);
  } else {
    // Mettre à jour les champs modifiés (COALESCE pour ne pas écraser les champs
    // absents du payload — important pour les updates partiels gamification)
    // v1.1.8 : + tous les champs du profil étendu (sync « informations de profil »)
    const setClauses = [
      'name = COALESCE(?, name)',
      'phone = COALESCE(?, phone)',
      'language = COALESCE(?, language)',
      'total_xp = MAX(total_xp, ?)',
      'streak_days = MAX(streak_days, ?)',
      'last_active_at = ?',
      'updated_at = ?',
    ];
    const params = [payload.name, payload.phone, payload.language,
      payload.total_xp || 0, payload.streak_days || 0, now, now];
    for (const f of LEARNER_PROFILE_FIELDS) {
      if (payload[f] !== undefined && payload[f] !== null && String(payload[f]).trim() !== '') {
        setClauses.push(`${f} = COALESCE(?, ${f})`);
        params.push(payload[f]);
      }
    }
    params.push(learner.id);
    db.prepare(`UPDATE learner SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
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

// ── Catalogue de cours (v1.1.7 — offline-first « nouveaux cours ») ───────────
// Sert les modules de formation depuis server/content/*.json. Un nouveau
// cours publié ici apparaît dans les apps (web + mobile) à la prochaine
// synchronisation, SANS mise à jour de l'APK. La réponse transporte une
// « version » (empreinte du contenu) : le client ne re-télécharge/cache pas
// si rien n'a changé. Contenu public → pas d'API key, rate-limit léger.
const CONTENT_DIR = path.join(__dirname, 'content');
let contentCache = null; // { version, modules } — rechargé si le disque change

function loadContentCatalog() {
  try {
    const files = fs.readdirSync(CONTENT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();
    const modules = [];
    const hash = crypto.createHash('sha1');
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
        const json = JSON.parse(raw);
        if (json?.id && json?.meta?.title) {
          modules.push(json);
          hash.update(f).update(':').update(raw).update('\n');
        }
      } catch (e) {
        console.warn(`[Content] ${f} ignoré :`, e.message);
      }
    }
    contentCache = { version: hash.digest('hex').slice(0, 16), modules };
    console.log(`[Content] Catalogue chargé : ${modules.length} module(s), version ${contentCache.version}`);
  } catch (e) {
    console.warn('[Content] Répertoire content/ indisponible :', e.message);
    contentCache = { version: 'empty', modules: [] };
  }
  return contentCache;
}

app.get('/api/content/modules', rateLimit(60, 60000), (req, res) => {
  // Recharger si le contenu du répertoire a changé (utile en dev ; sur Render
  // le disque est immuable entre déploiements → coût d'un readdir minime).
  if (!contentCache) loadContentCatalog();
  const catalog = contentCache || { version: 'empty', modules: [] };
  success(res, {
    version: catalog.version,
    count:   catalog.modules.length,
    modules: catalog.modules,
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
              // v1.1.6 : sémantique MAX sur tous les compteurs — quel que soit
              // l'ordre des pushes (web/mobile), le serveur ne peut jamais être
              // rétrogradé par un appareil en retard. 'completed' est collant.
              db.prepare(`
                UPDATE module_progress SET
                  status = CASE WHEN ? = 'completed' OR status = 'completed' THEN 'completed' ELSE COALESCE(?, status) END,
                  current_lesson = MAX(current_lesson, COALESCE(?, current_lesson)),
                  lessons_done = MAX(lessons_done, COALESCE(?, lessons_done)),
                  total_xp_earned = MAX(total_xp_earned, COALESCE(?, total_xp_earned)),
                  best_score = MAX(best_score, ?),
                  started_at = COALESCE(?, started_at),
                  completed_at = COALESCE(completed_at, ?),
                  updated_at = ?
                WHERE id = ?
              `).run(
                payload.status || null, payload.status || null,
                payload.current_lesson ?? null,
                payload.lessons_done ?? null,
                payload.total_xp_earned ?? null,
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
      'country', 'state', 'city', 'address', 'email', 'phone', 'photo_url', 'bio', 'profession'
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

/** Récupérer toute la progression d'un learner
 *  v1.1.6 (comptes uniques web + mobile) : la réponse inclut désormais AUSSI
 *  le learner complet, les succès, les logs de streak et l'objectif quotidien.
 *  C'est CETTE route que l'app appelle après une connexion réussie pour
 *  RESTAURER l'intégralité des données du compte sur un nouvel appareil
 *  (inscription sur le web → connexion dans l'app APK, et vice versa). */
app.get('/api/progress/:clientId', (req, res) => {
  const learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(req.params.clientId);
  if (!learner) return fail(res, 'Learner non trouvé', 404);

  const progress = db.prepare('SELECT * FROM module_progress WHERE learner_id = ? ORDER BY updated_at DESC').all(learner.id);
  const badges = db.prepare('SELECT * FROM badge WHERE learner_id = ? ORDER BY issued_at DESC').all(learner.id);
  const attempts = db.prepare('SELECT * FROM quiz_attempt WHERE learner_id = ? ORDER BY completed_at DESC LIMIT 50').all(learner.id);
  const achievements = db.prepare('SELECT achievement_key, unlocked_at FROM achievement WHERE learner_id = ? ORDER BY unlocked_at ASC').all(learner.id);
  const streakLogs = db.prepare('SELECT * FROM streak_log WHERE learner_id = ? ORDER BY activity_date ASC').all(learner.id);
  const dailyGoal = db.prepare('SELECT * FROM daily_goal WHERE learner_id = ?').get(learner.id) || null;

  success(res, {
    learner,
    progress,
    badges,
    recent_attempts: attempts,
    achievements,
    streak_logs: streakLogs,
    daily_goal: dailyGoal,
  });
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

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN — visualisation des données (v1.1.8)
// ═══════════════════════════════════════════════════════════════════════════════
// « J'ai la sensation que le serveur ne conserve pas les données. Comment
//  afficher les données utilisateurs sur Render ? »
// Render n'offre pas d'accès shell/SSH sur le free tier : ces endpoints
// permettent d'INSPECTER la base (users, learners, progressions, badges)
// depuis un navigateur ou curl. Protégés par ADMIN_KEY (défaut : API_KEY).
//
//   GET /api/admin/dump?admin_key=XXX                → vue d'ensemble
//   GET /api/admin/user/<userId>?admin_key=XXX       → détail complet d'un compte
//   GET /api/admin/user?email=a@b.tg&admin_key=XXX   → détail par email
//
// ⚠️ PERSISTANCE : sur le free tier de Render, le disque est ÉPHÉMÈRE —
// chaque redéploiement/restart RÉINITIALISE le fichier SQLite. Les données
// survivent tant que le service tourne, mais disparaissent au déploiement
// suivant. Voir docs/DEPLOYMENT-V1.md §12 (disque persistant Render / DB
// externe) pour conserver les données de production.

const ADMIN_KEY = process.env.ADMIN_KEY || API_KEY;

function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Clé admin invalide' });
  }
  next();
}

function sanitizeUserRow(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

// Vue d'ensemble : comptes, learners, progressions, badges + info stockage
app.get('/api/admin/dump', requireAdminKey, rateLimit(30, 60_000), (req, res) => {
  try {
    const users    = db.prepare('SELECT id, email, phone, display_name, provider, language, created_at, last_login_at FROM user ORDER BY created_at DESC LIMIT 100').all();
    const learners = db.prepare('SELECT client_id, name, email, phone, profession, city, country, total_xp, streak_days, best_streak, total_lessons_done, created_at, updated_at FROM learner ORDER BY total_xp DESC LIMIT 100').all();
    const counts = {
      users:            db.prepare('SELECT COUNT(*) as cnt FROM user').get().cnt,
      learners:         db.prepare('SELECT COUNT(*) as cnt FROM learner').get().cnt,
      module_progress:  db.prepare('SELECT COUNT(*) as cnt FROM module_progress').get().cnt,
      quiz_attempts:    db.prepare('SELECT COUNT(*) as cnt FROM quiz_attempt').get().cnt,
      badges:           db.prepare('SELECT COUNT(*) as cnt FROM badge').get().cnt,
      refresh_tokens:   db.prepare('SELECT COUNT(*) as cnt FROM refresh_token').get().cnt,
    };
    success(res, {
      generated_at: new Date().toISOString(),
      db_path: DB_PATH,
      storage_warning: 'Render free tier : disque éphémère — les données sont réinitialisées à chaque redéploiement. Voir docs/DEPLOYMENT-V1.md §12-13.',
      // v1.1.9 : état de la réplication GitHub (activée/dernier upload)
      replication: replication.getReplicationStatus(),
      counts,
      users,
      learners,
    });
  } catch (err) {
    console.error('[ADMIN/dump]', err.message);
    fail(res, 'Erreur lecture base : ' + err.message, 500);
  }
});

// Détail complet d'un compte (user + learner + progressions + badges + quiz)
app.get('/api/admin/user', requireAdminKey, rateLimit(30, 60_000), (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) return fail(res, 'Paramètre email requis');
    const user = db.prepare('SELECT * FROM user WHERE email = ?').get(email);
    if (!user) return fail(res, 'Aucun compte avec cet email', 404);
    const clientId = `lrn_${user.id}`;
    const learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(clientId);
    const payload = { user: sanitizeUserRow(user), learner: learner || null };
    if (learner) {
      payload.progress       = db.prepare('SELECT module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, updated_at FROM module_progress WHERE learner_id = ?').all(learner.id);
      payload.badges         = db.prepare('SELECT module_id, module_title, score, xp_total, blockchain_tx, issued_at FROM badge WHERE learner_id = ?').all(learner.id);
      payload.quiz_attempts  = db.prepare('SELECT COUNT(*) as cnt FROM quiz_attempt WHERE learner_id = ?').get(learner.id).cnt;
    }
    success(res, payload);
  } catch (err) {
    console.error('[ADMIN/user]', err.message);
    fail(res, 'Erreur lecture base : ' + err.message, 500);
  }
});

app.get('/api/admin/user/:userId', requireAdminKey, rateLimit(30, 60_000), (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM user WHERE id = ?').get(req.params.userId);
    if (!user) return fail(res, 'Compte introuvable', 404);
    const clientId = `lrn_${user.id}`;
    const learner = db.prepare('SELECT * FROM learner WHERE client_id = ?').get(clientId);
    const payload = { user: sanitizeUserRow(user), learner: learner || null };
    if (learner) {
      payload.progress       = db.prepare('SELECT module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, updated_at FROM module_progress WHERE learner_id = ?').all(learner.id);
      payload.badges         = db.prepare('SELECT module_id, module_title, score, xp_total, blockchain_tx, issued_at FROM badge WHERE learner_id = ?').all(learner.id);
      payload.quiz_attempts  = db.prepare('SELECT COUNT(*) as cnt FROM quiz_attempt WHERE learner_id = ?').get(learner.id).cnt;
    }
    success(res, payload);
  } catch (err) {
    console.error('[ADMIN/user/:id]', err.message);
    fail(res, 'Erreur lecture base : ' + err.message, 500);
  }
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
// v1.1.9 : vérification email — même limite que l'OTP téléphone (5/min/IP)
app.use('/api/auth/verify-email', otpLimiter);

// ── Démarrage ────────────────────────────────────────────────────────────────
// v1.1.9 : AVANT d'ouvrir la DB, restaurer le snapshot distant (GitHub) —
// le disque Render est éphémère (effacé à chaque redéploiement ET à chaque
// sortie de veille du free tier). Sans cette restauration, tous les comptes
// créés depuis le dernier démarrage sont perdus (« la connexion échoue
// alors que l'inscription avait fonctionné »).
(async () => {
  try {
    await replication.restoreDbFromRemote(DB_PATH);
  } catch (e) {
    console.warn('[BOOT] Restauration DB distante impossible :', e.message);
  }

  initDatabase();
  auth.initAuthTables(db);          // tables user + refresh_token (+ colonnes v1.1.9)
  auth.mountAuthRoutes(app, db);    // /api/auth/* (register, login, google, apple, facebook, phone, verify-email, me, refresh, logout)
  gamification.initGamificationTables(db);  // tables streak_log + achievement + daily_goal + colonnes learner v2
  gamification.mountGamificationRoutes(app, db);  // /api/gamification/*
  initBlockchain();
  payments.init(db);

  // v1.1.9 : DB ouverte → active les uploads répliqués (upload de démarrage
  // + flush debounced après chaque écriture + flush SIGTERM)
  replication.attachDb(db);

  app.listen(PORT, () => {
    console.log(`
  ┌─────────────────────────────────────┐
  │       EduKraft API v1.0.0           │
  │     http://localhost:${PORT}          │
  │     Health: /api/health              │
  │     Sync:   POST /api/sync           │
  │     DB remote: ${replication.getReplicationStatus().enabled ? 'ON (GitHub)' : 'OFF'}   │
  └─────────────────────────────────────┘
  `);
  });
})();
