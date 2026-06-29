// server/test-e2e-selfcontained.js
// Test E2E autonome — démarre le serveur, teste, arrête le serveur
// Usage: node test-e2e-selfcontained.js

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = __dirname;
const DATA_DIR = path.join(SERVER_DIR, 'data');
const PORT = 3097;
const BASE = `http://localhost:${PORT}/api`;
const API_KEY = 'dev-key';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

let LEARNER_ID = `test_${Date.now()}`;

function log(emoji, msg) { console.log(`  ${emoji} ${msg}`); }

async function get(p) { return (await fetch(`${BASE}${p}`, { headers })).json(); }
async function post(p, body) {
  const res = await fetch(`${BASE}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start server ───────────────────────────────────────────────────
async function startServer() {
  // Clean data
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const env = {
    ...process.env,
    POLYGON_MOCK_MODE: 'true',
    PAYMENT_MOCK: 'true',
    API_KEY,
    PORT: String(PORT),
  };

  return new Promise((resolve, reject) => {
    const child = spawn('node', ['index.js'], {
      cwd: SERVER_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    let serverErr = '';
    child.stderr.on('data', d => { serverErr += d.toString(); });

    // Poll until server responds
    const checkReady = async () => {
      for (let i = 0; i < 20; i++) {
        try {
          const r = await fetch(`http://localhost:${PORT}/api/health`);
          if (r.ok) return true;
        } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    };
    checkReady().then(ok => ok ? resolve(child) : reject(new Error('Server not responding after 10s')));
  });
}

// ── Tests ──────────────────────────────────────────────────────────

async function testHealth() {
  console.log('\n\ud83d\udd0d 1. Health Check');
  const res = await get('/health');
  if (!res.success) throw new Error(`Health failed`);
  log('\u2713', `Version: ${res.data.version}, Phase: ${res.data.phase}`);
  log('\u2713', `Blockchain: ${res.data.blockchain.mode}, Network: ${res.data.blockchain.network}`);
  log('\u2713', `Payment mock: ${res.data.payment_mock}`);
}

async function testLearner() {
  console.log('\n\ud83d\udc64 2. Creation Learner');
  const { status, data } = await post('/learners', {
    id: LEARNER_ID, name: 'Kofi Testeur', phone: '22890123456', language: 'fr',
  });
  if (status !== 201 || !data.success) throw new Error(`Learner failed`);
  log('\u2713', `Cree: ${data.data.learner.name}`);
}

async function testSync() {
  console.log('\n\ud83d\udd04 3. Sync Batch');
  const { status, data } = await post('/sync', {
    operations: [{
      table_name: 'module_progress', operation: 'INSERT',
      record_id: `${LEARNER_ID}_mod1`,
      payload: { learner_id: LEARNER_ID, module_id: 'mod_entrepreneuriat',
        status: 'completed', current_lesson: 5, lessons_done: 5,
        total_xp_earned: 350, best_score: 0.88 },
    }, {
      table_name: 'quiz_attempt', operation: 'INSERT',
      record_id: `qa_${Date.now()}`,
      payload: { learner_id: LEARNER_ID, module_id: 'mod_entrepreneuriat',
        lesson_index: 4, score: 0.88, answers: { q1: 'B' },
        xp_awarded: 88, passed: true },
    }],
  });
  if (!data.success) throw new Error(`Sync failed`);
  log('\u2713', `${data.data.synced}/${data.data.processed} ops sync`);
}

async function testBadge() {
  console.log('\n\ud83c\udfc5 4. Badge Mint (Mock)');
  const { status, data } = await post('/badges', {
    learner_id: LEARNER_ID, module_id: 'mod_entrepreneuriat',
    module_title: 'Introduction a l\'entrepreneuriat', score: 0.88,
    xp_total: 350, badge_hash: '0x' + 'ab'.repeat(32),
    qr_payload: '{"id":"test-1"}', learner_name: 'Kofi Testeur',
  });
  if (status !== 201 || !data.success) throw new Error(`Badge failed`);
  log('\u2713', `tx: ${data.data.blockchain_tx.slice(0, 18)}...`);
  log('\u2713', `network: ${data.data.network}, on_chain: ${data.data.on_chain}`);
}

async function testVerifyBadge() {
  console.log('\n\ud83d\udd0e 5. Verification Badge');
  const res = await get(`/verify/${'0x' + 'ab'.repeat(32)}`);
  log('\u2713', `found=${res.data?.found}, network=${res.data?.network}`);
}

async function testPayment() {
  console.log('\n\ud83d\udcb3 6. Paiement T-Money (Mock)');
  const { status, data } = await post('/payments/initiate', {
    learner_id: LEARNER_ID, provider: 'tmoney',
    phone_number: '22890123456', product_type: 'certification',
  });
  if (status !== 201 || !data.success) throw new Error(`Payment failed: ${JSON.stringify(data)}`);
  log('\u2713', `Ref: ${data.data.reference}, Amount: ${data.data.amount} ${data.data.currency}`);

  log('\u23f3', 'Attente confirmation mock (4s)...');
  await wait(4000);

  const st = await get(`/payments/status/${data.data.reference}`);
  log('\u2713', `Statut: ${st.data.status}`);
}

async function testPaymentHistory() {
  console.log('\n\ud83d\udcca 7. Historique Paiements');
  const res = await get(`/payments/history/${LEARNER_ID}`);
  if (res.success) {
    log('\u2713', `${res.data.length} paiement(s)`);
  } else { log('\u2139', 'Aucun historique'); }
}

async function testProgress() {
  console.log('\n\ud83d\udcc8 8. Progression');
  const res = await get(`/progress/${LEARNER_ID}`);
  if (!res.success) throw new Error('Progress failed');
  log('\u2713', `${res.data.progress.length} prog, ${res.data.badges.length} badges`);
}

async function testStats() {
  console.log('\n\ud83d\udcca 9. Statistiques');
  const res = await get('/stats');
  if (!res.success) throw new Error('Stats failed');
  log('\u2713', `Learners: ${res.data.total_learners}, Badges: ${res.data.total_badges}`);
  log('\u2713', `Score moyen: ${res.data.average_score}%`);
}

async function testPricing() {
  console.log('\n\ud83d\udcb0 10. Tarification');
  const res = await get('/payments/pricing');
  if (!res.success) throw new Error('Pricing failed');
  log('\u2713', `Produits: ${JSON.stringify(res.data.products)}`);
}

// ── Runner ─────────────────────────────────────────────────────────

async function main() {
  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551   EduKraft API v2 - Test E2E Autonome         \u2551');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');

  const start = Date.now();
  let server;
  let serverErr = '';
  try {
    console.log('\nDemarrage du serveur...');
    server = await startServer();
    console.log('Serveur pret.\n');

    const tests = [
      testHealth, testLearner, testSync, testBadge, testVerifyBadge,
      testPayment, testPaymentHistory, testProgress, testStats, testPricing,
    ];

    let passed = 0, failed = 0;
    for (const test of tests) {
      try { await test(); passed++; }
      catch (err) { console.error(`  \u274c ${err.message}`); failed++; }
    }

    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(`${passed} reussi(s), ${failed} echoue(s) - ${dur}s`);
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

    if (failed > 0) process.exit(1);
  } finally {
    if (server) {
      server.kill('SIGTERM');
      setTimeout(() => server.kill('SIGKILL'), 1000);
      if (serverErr) console.error('\n[Server]', serverErr.slice(-300));
    }
    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
