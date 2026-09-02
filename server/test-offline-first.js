// server/test-offline-first.js
// Test E2E « OFFLINE-FIRST » — v1.1.13
//
// Objectif : prouver que les corrections offline (« les données ne se
// chargeaient pas sans connexion internet ») fonctionnent ET qu'elles
// n'ont compromis AUCUN des acquis précédents (photo, badges, XP,
// anti-ping-pong v1.1.12).
//
// Scénario réaliste (celui de l'utilisateur) :
//
//   PHASE 0 — EN LIGNE : l'utilisateur se connecte (compte créé serveur),
//   l'app SQLite locale est initialisée. PUIS LE RÉSEAU TOMBE.
//
//   PHASE A — HORS LIGNE (serveur mort — vérifié par fetch en échec) :
//     A1. Extraction du VRAI schéma de l'app (../src/database/schema.js)
//     A2. Écritures offline : progression, quiz, badge, objectif, streak
//         — chaque écriture enqueue en sync_queue (comme les repositories)
//     A3. Fermeture de la DB (= l'app est tuée / téléphone redémarré)
//     A4. COLD BOOT TOUJOURS SANS RÉSEAU : réouverture + requêtes EXACTES
//         de DbProvider.init → TOUTES les données doivent être là
//     A5. Mutations offline supplémentaires après le reboot → file accrue
//
//   PHASE B — RECONNEXION (le serveur redevient joignable) :
//     B1. Push du batch dédupliqué (logique syncEngine v1.1.12/1.1.13)
//         + purge des doublons zombies (v1.1.13)
//     B2. Pull GET /api/progress → XP UNION (pas MAX), badges uniques à la
//         date la plus ancienne, photo data URI, objectif, streaks
//     B3. ANTI PING-PONG : push d'une clé périmée du même email → la ligne
//         canonique ne doit PAS être aspirée
//     B4. IDEMPOTENCE : re-push du même batch (retry réseau simulé) →
//         aucun doublon (badges, quiz, XP inchangés)
//     B5. 2e APPAREIL (web) : cold boot vide + pull → même contenu que le
//         mobile (convergence web/mobile)
//
// Usage : cd server && node test-offline-first.js

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const SERVER_DIR = __dirname;
const APP_SCHEMA = path.join(SERVER_DIR, '..', 'src', 'database', 'schema.js');
const PORT = 3099;
const BASE = `http://localhost:${PORT}/api`;
const API_KEY = 'dev-key';
const HDRS = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'X-Client': 'edukraft-offline-test' };

const NOW0 = new Date('2026-09-01T10:00:00.000Z').toISOString(); // T1 : session offline n°1
const NOW1 = new Date('2026-09-01T12:00:00.000Z').toISOString(); // T2 : cold boot offline
const NOW2 = new Date('2026-09-02T08:00:00.000Z').toISOString(); // T3 : reconnexion

const EMAIL = 'offline.e2e@edukraft.app';
const PASSWORD = 'Offline1234!';
let   CLIENT_ID = null; // = lrn_<user.id> — résolu à l'inscription (phase 0)
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const MODULE_A = 'marketing-digital-local-v1';
const MODULE_B = 'ecommerce-whatsapp-business-v1';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`    ✓ ${label}`); }
  else { failed++; console.error(`    ✗ ${label}`); }
}
function section(s) { console.log(`\n  ── ${s}`); }

// ── A1 : extraire le VRAI schéma de l'app (reste synchronisé avec l'app) ──
function extractSchemaExports(src) {
  const text = fs.readFileSync(src, 'utf8');
  const grab = (name) => {
    const m = text.match(new RegExp(`export const ${name} = \\\`([\\s\\S]*?)\\\`;`));
    if (!m) throw new Error(`export ${name} introuvable dans ${src}`);
    return m[1];
  };
  return { CREATE_TABLES: grab('CREATE_TABLES'), INITIAL_SYNC_META: grab('INITIAL_SYNC_META') };
}

// ── Simulation des écritures de l'app (mêmes SQL que les repositories) ──
function createAppDb(dbPath) {
  const { CREATE_TABLES, INITIAL_SYNC_META } = extractSchemaExports(APP_SCHEMA);
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(CREATE_TABLES);
  db.exec(INITIAL_SYNC_META);
  return db;
}

function enqueue(db, table, op, recordId, payload) {
  // Ordre des colonnes identique au syncRepository de l'app :
  // (id, table_name, record_id, operation, payload, queued_at)
  db.prepare(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload, queued_at, retry_count)
              VALUES (?, ?, ?, ?, ?, ?, 0)`)
    .run(`sq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, table, recordId, op, JSON.stringify(payload), new Date().toISOString());
}

function insertLearner(db, { id, name, email, photo, xp, now, streak = 0 }) {
  db.prepare(`INSERT INTO learner (id, name, phone, language, total_xp, streak_days, last_active_at, created_at, server_id, sync_status, updated_at, email, photo_url)
              VALUES (?, ?, '', 'fr', ?, ?, ?, ?, 'srv_offline', 'pending', ?, ?, ?)`)
    .run(id, name, xp, streak, now, now, now, email, photo);
  enqueue(db, 'learner', 'INSERT', id, { id, name, total_xp: xp, streak_days: streak, email, photo_url: photo, language: 'fr' });
}

function upsertProgress(db, lid, mod, { status = 'in_progress', lessons = 1, xp = 0, now }) {
  const id = `${lid}_${mod}`;
  const existing = db.prepare('SELECT * FROM module_progress WHERE id = ?').get(id);
  const merged = existing
    ? { ...existing, status, current_lesson: Math.max(lessons, existing.current_lesson), lessons_done: Math.max(lessons, existing.lessons_done), total_xp_earned: Math.max(xp, existing.total_xp_earned), updated_at: now }
    : { id, learner_id: lid, module_id: mod, status, current_lesson: lessons, lessons_done: lessons, total_xp_earned: xp, best_score: 0, started_at: now, completed_at: null, updated_at: now };
  db.prepare(`INSERT INTO module_progress
              (id, learner_id, module_id, status, current_lesson, lessons_done, total_xp_earned, best_score, started_at, completed_at, sync_status, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
              ON CONFLICT(id) DO UPDATE SET status=excluded.status, current_lesson=excluded.current_lesson,
                lessons_done=excluded.lessons_done, total_xp_earned=excluded.total_xp_earned,
                best_score=excluded.best_score, started_at=excluded.started_at,
                completed_at=excluded.completed_at, updated_at=excluded.updated_at, sync_status='pending'`)
    .run(merged.id, merged.learner_id, merged.module_id, merged.status, merged.current_lesson, merged.lessons_done, merged.total_xp_earned, merged.best_score, merged.started_at, merged.completed_at, now);
  enqueue(db, 'module_progress', existing ? 'UPDATE' : 'INSERT', id, { ...merged, updated_at: now });
  return merged;
}

function insertQuiz(db, lid, qaId, mod, lessonIndex, score, xp, passed, now) {
  const prev = db.prepare('SELECT COUNT(*) as c FROM quiz_attempt WHERE learner_id = ? AND module_id = ? AND lesson_index = ?').get(lid, mod, lessonIndex);
  db.prepare(`INSERT INTO quiz_attempt (id, learner_id, module_id, lesson_index, attempt_number, score, answers, xp_awarded, passed, completed_at, sync_status)
              VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 'pending')`)
    .run(qaId, lid, mod, lessonIndex, prev.c + 1, score, xp, passed ? 1 : 0, now);
  enqueue(db, 'quiz_attempt', 'INSERT', qaId, { learner_id: lid, module_id: mod, lesson_index: lessonIndex, attempt_number: prev.c + 1, score, answers: {}, xp_awarded: xp, passed: passed ? 1 : 0, completed_at: now });
}

function insertBadge(db, lid, badgeId, mod, title, score, xp, issuedAt) {
  db.prepare(`INSERT INTO badge (id, learner_id, module_id, module_title, score, xp_total, badge_hash, qr_payload, blockchain_tx, issued_at, sync_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending')`)
    .run(badgeId, lid, mod, title, score, xp, `0x${'ab'.repeat(20)}`, `{"id":"${badgeId}"}`, issuedAt);
  enqueue(db, 'badge', 'INSERT', badgeId, { learner_id: lid, module_id: mod, module_title: title, score, xp_total: xp, badge_hash: `0x${'ab'.repeat(20)}`, qr_payload: `{"id":"${badgeId}"}`, issued_at: issuedAt });
}

function setDailyGoal(db, lid, type, target, now) {
  db.prepare(`INSERT INTO daily_goal (id, learner_id, goal_type, goal_target, enabled, updated_at, sync_status)
              VALUES (?, ?, ?, ?, 1, ?, 'pending')
              ON CONFLICT(learner_id) DO UPDATE SET goal_type=excluded.goal_type, goal_target=excluded.goal_target, enabled=1, updated_at=excluded.updated_at, sync_status='pending'`)
    .run(`goal_${lid}`, lid, type, target, now);
  enqueue(db, 'daily_goal', 'UPDATE', `goal_${lid}`, { learner_id: lid, goal_type: type, goal_target: target, enabled: 1, updated_at: now });
}

function upsertStreakLog(db, lid, date, lessons, xp, now) {
  db.prepare(`INSERT INTO streak_log (id, learner_id, activity_date, lessons_done, xp_earned, streak_freeze_used, goal_met, created_at, updated_at, sync_status)
              VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'pending')
              ON CONFLICT(learner_id, activity_date) DO UPDATE SET lessons_done = streak_log.lessons_done + excluded.lessons_done,
                xp_earned = streak_log.xp_earned + excluded.xp_earned, goal_met = MAX(streak_log.goal_met, excluded.goal_met), updated_at = excluded.updated_at, sync_status='pending'`)
    .run(`sl_${lid}_${date}`, lid, date, lessons, xp, now, now);
  enqueue(db, 'streak_log', 'INSERT', `sl_${lid}_${date}`, { learner_id: lid, activity_date: date, lessons_done: lessons, xp_earned: xp, goal_met: 0, updated_at: now });
}

function addXp(db, lid, amount, now) {
  db.prepare(`UPDATE learner SET total_xp = total_xp + ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`).run(amount, now, lid);
}

// ── SyncEngine : batch dédupliqué (v1.1.12), learner en tête,
//    purge par clé après succès (v1.1.13) — miroir exact de l'app ──
function buildBatch(db) {
  const queue = db.prepare('SELECT * FROM sync_queue ORDER BY queued_at ASC LIMIT 50').all();
  const byKey = new Map();
  for (const item of queue) byKey.set(`${item.table_name}|${item.record_id}`, item);
  const deduped = [...byKey.values()];
  const learnerOps = deduped.filter(i => i.table_name === 'learner');
  const otherOps = deduped.filter(i => i.table_name !== 'learner');
  const sendItems = [...learnerOps, ...otherOps];
  const operations = sendItems.map(i => ({
    table_name: i.table_name, operation: i.operation, record_id: i.record_id,
    payload: typeof i.payload === 'string' ? JSON.parse(i.payload) : i.payload,
  }));
  return { sendItems, operations };
}
function purgeSyncedKeys(db, sendItems) {
  // v1.1.13 : suppression de l'op ET de ses versions obsolètes (≤ queued_at
  // de l'op envoyée) — les écritures PLUS RÉCENTES (survenues pendant le POST
  // en vol) doivent survivre (course critique).
  for (const item of sendItems) {
    db.prepare('DELETE FROM sync_queue WHERE table_name = ? AND record_id = ? AND queued_at <= ?')
      .run(item.table_name, item.record_id, item.queued_at);
  }
}

async function post(p, body) {
  const res = await fetch(`${BASE}${p}`, { method: 'POST', headers: HDRS, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function get(p) { return (await fetch(`${BASE}${p}`, { headers: HDRS })).json(); }

// ── Démarrage/arrêt du serveur (simule la connexion qui va/revient) ──
function startServer(dbPath) {
  const env = {
    ...process.env,
    POLYGON_MOCK_MODE: 'true', PAYMENT_MOCK: 'true', API_KEY,
    PORT: String(PORT),
    DB_PATH: dbPath, // PERSISTANT entre les redémarrages (comme Render + GitHub)
    OTP_MOCK_CODE: '123456', PHONE_OTP_ENABLED: 'true',
    JWT_SECRET: 'offline-test-secret',
  };
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['index.js'], { cwd: SERVER_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let errBuf = '';
    child.stderr.on('data', d => { errBuf += d.toString(); });
    (async () => {
      for (let i = 0; i < 40; i++) {
        try { const r = await fetch(`http://localhost:${PORT}/api/health`); if (r.ok) return resolve(child); } catch {}
        await new Promise(r => setTimeout(r, 300));
      }
      reject(new Error('Serveur non prêt : ' + errBuf.slice(-300)));
    })();
  });
}
function stopServer(child) {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} resolve(); }, 2000);
  });
}

// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  EduKraft — E2E OFFLINE-FIRST v1.1.13                 ║');
  console.log('║  « les données se chargent-elles sans internet ? »    ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-offline-'));
  const appDbPath = path.join(tmpDir, 'app.db');
  const serverDbPath = path.join(tmpDir, 'server.db');
  let server = null;

  try {
    // ══ PHASE 0 — EN LIGNE : connexion initiale, puis le réseau tombe ═══
    console.log('\n▣ PHASE 0 — EN LIGNE (connexion initiale de l\'utilisateur)');
    server = await startServer(serverDbPath);
    const reg = await post('/auth/register', { email: EMAIL, password: PASSWORD, displayName: 'Offline Testeur' });
    ok(reg.status === 201 && reg.data?.data?.user?.id, 'compte créé côté serveur (register 201)');
    const userId = reg.data.data.user.id;
    CLIENT_ID = `lrn_${userId}`;
    console.log(`    ✓ clé canonique du compte : ${CLIENT_ID}`);

    // L'app initialise sa DB locale au login (learner + profil + photo)
    {
      const db = createAppDb(appDbPath);
      insertLearner(db, { id: CLIENT_ID, name: 'Offline Testeur', email: EMAIL, photo: PHOTO, xp: 0, now: NOW0 });
      upsertProgress(db, CLIENT_ID, MODULE_A, { lessons: 1, xp: 0, now: NOW0 });
      db.close();
    }
    await stopServer(server); server = null;
    console.log('    ✓ réseau coupé (serveur arrêté)');

    // ══ PHASE A — HORS LIGNE ════════════════════════════════════════════
    console.log('\n▣ PHASE A — HORS LIGNE (connectivité vérifiée absente)');

    section('A0. Preuve d\'absence de connexion');
    {
      let unreachable = false;
      try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }); }
      catch (_) { unreachable = true; }
      ok(unreachable, 'le serveur est INJOIGNABLE (fetch en échec) — nous sommes bien hors ligne');
    }

    section('A1. Schéma réel de l\'app extrait de src/database/schema.js');
    const schemaOk = (() => { try { extractSchemaExports(APP_SCHEMA); return true; } catch { return false; } })();
    ok(schemaOk, 'CREATE_TABLES + INITIAL_SYNC_META extraits (test synchronisé sur le VRAI schéma)');

    section('A2. Session offline n°1 — écritures locales (comme les repositories)');
    {
      const db = new Database(appDbPath, { fileMustExist: true });
      insertQuiz(db, CLIENT_ID, 'qa_off_1', MODULE_A, 1, 0.8, 25, true, NOW0);   // +25 XP
      addXp(db, CLIENT_ID, 25, NOW0);
      upsertProgress(db, CLIENT_ID, MODULE_A, { lessons: 2, xp: 0, now: NOW0 });
      insertBadge(db, CLIENT_ID, 'bg_off_1', MODULE_A, 'Marketing Digital', 0.8, 25, NOW0);
      setDailyGoal(db, CLIENT_ID, 'lessons', 1, NOW0);
      upsertStreakLog(db, CLIENT_ID, '2026-09-01', 2, 25, NOW0);
      const q = db.prepare('SELECT COUNT(*) as c FROM sync_queue').get();
      ok(q.c >= 6, `6+ opérations en file d'attente sync (=${q.c}) — l'app écrit offline et diffère l'envoi`);
      db.close(); // l'app est tuée
    }

    section('A3. COLD BOOT SANS RÉSEAU (redémarrage du téléphone, avion ON)');
    {
      const db = new Database(appDbPath); // réouverture = DbProvider.init

      // Requêtes EXACTES de DbProvider.init (résolution session → learner)
      const learner = db.prepare('SELECT * FROM learner WHERE id = ?').get(CLIENT_ID);
      ok(!!learner, 'learner restauré depuis SQLite — SANS AUCUNE connexion');
      ok(learner && learner.photo_url === PHOTO, 'photo de profil (data URI) intacte hors ligne');
      ok(learner && learner.total_xp === 25, `XP restauré hors ligne (=25, trouvé ${learner?.total_xp})`);

      const progress = db.prepare('SELECT * FROM module_progress WHERE learner_id = ?').all(CLIENT_ID);
      ok(progress.length === 1 && progress[0].lessons_done === 2, 'progression restaurée (2 leçons faites)');

      const quizzes = db.prepare('SELECT COUNT(*) as c FROM quiz_attempt WHERE learner_id = ?').get(CLIENT_ID);
      ok(quizzes.c === 1, 'tentative de quiz restaurée');

      const badges = db.prepare('SELECT * FROM badge WHERE learner_id = ?').all(CLIENT_ID);
      ok(badges.length === 1 && badges[0].module_id === MODULE_A, 'badge restauré');

      const goal = db.prepare('SELECT * FROM daily_goal WHERE learner_id = ?').get(CLIENT_ID);
      ok(!!goal && goal.goal_target === 1, 'objectif quotidien restauré');

      const streak = db.prepare('SELECT * FROM streak_log WHERE learner_id = ?').all(CLIENT_ID);
      ok(streak.length === 1 && streak[0].xp_earned === 25, 'journal de streak restauré');

      section('A4. Mutations PENDANT l\'offline (après le reboot)');
      insertQuiz(db, CLIENT_ID, 'qa_off_2', MODULE_A, 2, 1.0, 45, true, NOW1);   // +45 XP
      addXp(db, CLIENT_ID, 45, NOW1);
      upsertProgress(db, CLIENT_ID, MODULE_A, { lessons: 3, xp: 70, now: NOW1 });
      insertBadge(db, CLIENT_ID, 'bg_off_2', MODULE_B, 'E-commerce WhatsApp', 1.0, 45, NOW1);
      upsertStreakLog(db, CLIENT_ID, '2026-09-02', 1, 45, NOW1);

      const l2 = db.prepare('SELECT total_xp FROM learner WHERE id = ?').get(CLIENT_ID);
      ok(l2.total_xp === 70, `XP cumule offline (25+45=70, trouvé ${l2.total_xp})`);
      const q = db.prepare('SELECT COUNT(*) as c FROM sync_queue').get();
      ok(q.c >= 10, `file sync continue de grossir offline (=${q.c})`);
      db.close();
    }

    // ══ PHASE B — RECONNEXION ═══════════════════════════════════════════
    console.log('\n▣ PHASE B — RECONNEXION (le serveur redevient joignable)');
    server = await startServer(serverDbPath); // MÊME DB_PATH : les données survivent
    console.log('    ✓ serveur API de retour en ligne (DB persistante)');

    section('B1. Push du batch dédupliqué (logique syncEngine v1.1.12 + purge v1.1.13)');
    {
      const db = new Database(appDbPath);
      const before = db.prepare('SELECT COUNT(*) as c FROM sync_queue').get().c;
      const { sendItems, operations } = buildBatch(db);
      const { status, data } = await post('/sync', { operations });
      ok(status === 200 && data.success, `batch accepté (${before} ops → ${sendItems.length} dédupliquées)`);
      const errs = (data.data?.results || []).filter(r => r.status === 'error');
      ok(errs.length === 0, `toutes les ops traitées sans erreur (${errs.length} erreur(s))`);
      if (errs.length) console.log('      ⚠ détail :', JSON.stringify(errs).slice(0, 400));

      // Course critique : une écriture survient PENDANT le POST en vol
      // (même clé que l'op envoyée, queued_at POSTÉRIEUR) → elle doit
      // SURVIVRE à la purge v1.1.13.
      const progressKey = `${CLIENT_ID}_${MODULE_A}`;
      const sentProgress = sendItems.find(i => i.table_name === 'module_progress' && i.record_id === progressKey);
      ok(!!sentProgress, 'l\'op module_progress envoyée identifiée (pour le test de course)');
      const laterTs = new Date(Date.parse(sentProgress.queued_at) + 5000).toISOString();
      db.prepare(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload, queued_at, retry_count)
                  VALUES (?, 'module_progress', ?, 'UPDATE', '{}', ?, 0)`)
        .run('sq_race_inflight', progressKey, laterTs);

      // v1.1.13 : purge par clé (ops ≤ queued_at envoyée), comme le syncEngine
      purgeSyncedKeys(db, sendItems);
      const remaining = db.prepare('SELECT * FROM sync_queue').all();
      ok(remaining.length === 1 && remaining[0].id === 'sq_race_inflight',
        'zombies purgés + écriture en vol PRÉSERVÉE (course critique maîtrisée)');
      // Nettoyage de l'artefact de test
      db.prepare('DELETE FROM sync_queue WHERE id = ?').run('sq_race_inflight');
      const left = db.prepare('SELECT COUNT(*) as c FROM sync_queue').get();
      ok(left.c === 0, `file VIDÉE après sync (reste ${left.c})`);
      db.close();
    }

    section('B2. Pull serveur — acquis v1.1.12 intacts');
    const sv = await get(`/progress/${encodeURIComponent(CLIENT_ID)}`);
    ok(sv.success && sv.data.learner, 'pull du compte OK');
    const L = sv.data.learner;
    ok(Number(L.total_xp) === 70, `XP = UNION des quiz réussis 25+45=70 (pas MAX=45) — acquis XP v1.1.12 (trouvé ${L.total_xp})`);
    ok(L.photo_url === PHOTO, 'photo data URI conservée serveur — acquis photo v1.1.12');
    ok(L.email === EMAIL, 'email conservé');
    ok((sv.data.progress || []).length >= 1, 'progression serveur présente');
    const svBadges = sv.data.badges || [];
    ok(svBadges.length === 2, `2 badges (1/module, pas de doublon) — acquis badges v1.1.12 (trouvé ${svBadges.length})`);
    const bgA = svBadges.find(b => b.module_id === MODULE_A);
    ok(bgA && bgA.issued_at === NOW0, `badge A daté de la 1re fois (${NOW0}) — convergence des dates v1.1.12`);
    ok(!!(sv.data.daily_goal), 'objectif quotidien synchronisé');
    ok((sv.data.streak_logs || []).length >= 2, 'streaks synchronisés');

    section('B3. ANTI PING-PONG v1.1.12 — push d\'une clé périmée du même email');
    {
      // Appareil à clé périmée (ancienne incarnation du compte) qui pousse
      // ses données avec le même email : il ne doit PAS aspirer la ligne
      // canonique (données plus anciennes, XP 30 < 70).
      const { data } = await post('/sync', { operations: [{
        table_name: 'learner', operation: 'INSERT', record_id: 'lrn_stale_ghost',
        payload: { id: 'lrn_stale_ghost', name: 'Offline Testeur', email: EMAIL, total_xp: 30, streak_days: 0 },
      }] });
      const opOk = (data.data?.results || []).every(r => r.status !== 'error');
      ok(opOk, 'push périmé traité (l\'op elle-même est valide)');
      const canon = await get(`/progress/${encodeURIComponent(CLIENT_ID)}`);
      ok(canon.success && canon.data.learner, 'la ligne canonique SURVIT (pas d\'aspiration ping-pong)');
      ok(Number(canon.data.learner.total_xp) === 70, `XP canonique intact (70, trouvé ${canon.data.learner.total_xp})`);
    }

    section('B4. IDEMPOTENCE — re-push du même batch (retry réseau simulé)');
    {
      const retryOps = [
        { table_name: 'learner', operation: 'INSERT', record_id: CLIENT_ID, payload: { id: CLIENT_ID, name: 'Offline Testeur', email: EMAIL, total_xp: 70, photo_url: PHOTO } },
        { table_name: 'quiz_attempt', operation: 'INSERT', record_id: 'qa_off_1', payload: { learner_id: CLIENT_ID, module_id: MODULE_A, lesson_index: 1, score: 0.8, xp_awarded: 25, passed: 1, completed_at: NOW0, answers: {} } },
        { table_name: 'badge', operation: 'INSERT', record_id: 'bg_off_1', payload: { learner_id: CLIENT_ID, module_id: MODULE_A, module_title: 'Marketing Digital', score: 0.8, xp_total: 25, issued_at: NOW0 } },
      ];
      await post('/sync', { operations: retryOps });
      const sv2 = await get(`/progress/${encodeURIComponent(CLIENT_ID)}`);
      ok(Number(sv2.data.learner.total_xp) === 70, `XP inchangé après re-push (70, trouvé ${sv2.data.learner.total_xp})`);
      ok((sv2.data.badges || []).length === 2, `aucun badge fantôme après re-push (${sv2.data.badges.length})`);
      const attempts = sv2.data.recent_attempts || [];
      const dupA = attempts.filter(a => a.module_id === MODULE_A && a.lesson_index === 1);
      ok(dupA.length <= 1, `quiz non dupliqué sur retry (${dupA.length} tentative(s))`);
    }

    section('B5. 2e APPAREIL (web) — convergence du contenu');
    {
      // Cold boot d'un appareil NEUF : DB vide, pull serveur, état reconstruit
      const webDbPath = path.join(tmpDir, 'web.db');
      const db = createAppDb(webDbPath);
      const sv3 = await get(`/progress/${encodeURIComponent(CLIENT_ID)}`);
      const wl = sv3.data.learner;
      insertLearner(db, { id: CLIENT_ID, name: wl.name, email: wl.email, photo: wl.photo_url, xp: wl.total_xp, now: NOW2 });
      for (const p of (sv3.data.progress || [])) {
        upsertProgress(db, CLIENT_ID, p.module_id, { lessons: p.lessons_done, xp: p.total_xp_earned, now: NOW2 });
      }
      const wl2 = db.prepare('SELECT * FROM learner WHERE id = ?').get(CLIENT_ID);
      ok(Number(wl2.total_xp) === 70, 'l\'appareil 2 voit le MÊME XP que l\'appareil 1 (70)');
      ok(wl2.photo_url === PHOTO, 'l\'appareil 2 voit la MÊME photo');
      const svBadges2 = (sv3.data.badges || []).map(b => b.issued_at).sort();
      ok(svBadges2[0] === NOW0, 'l\'appareil 2 reçoit la MÊME date de badge (la plus ancienne) — plus de divergence web/mobile');
      db.close();
    }
  } finally {
    await stopServer(server);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ${passed} réussi(s), ${failed} échoué(s)`);
  console.log('════════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
