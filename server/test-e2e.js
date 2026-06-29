// server/test-e2e.js
// Test end-to-end complet du backend EduKraft API v2
//
// Usage :
//   cd server && node test-e2e.js
//
// Teste tous les endpoints de l'API en mode mock :
//   - Health check (avec infos blockchain + paiement)
//   - Création de learner
//   - Sync batch (progress + quiz + badge avec mint mock)
//   - Vérification de badge blockchain
//   - Paiement T-Money (init + status polling)
//   - Historique des paiements
//   - Statistiques

const BASE = 'http://localhost:3001/api';
const API_KEY = 'dev-key';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

let LEARNER_ID = `test_${Date.now()}`;
let SERVER_LEARNER_ID = null;

// ── Helpers ──────────────────────────────────────────────────────────
function log(emoji, msg) {
  console.log(`  ${emoji} ${msg}`);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Tests ────────────────────────────────────────────────────────────

async function testHealth() {
  console.log('\n🔍 1. Health Check');
  const res = await get('/health');
  if (!res.success) throw new Error(`Health failed: ${JSON.stringify(res)}`);

  log('✓', `Version: ${res.data.version}`);
  log('✓', `Phase: ${res.data.phase}`);
  log('✓', `Features: ${res.data.features.join(', ')}`);
  log('✓', `Blockchain mode: ${res.data.blockchain.mode}`);
  log('✓', `Payment mock: ${res.data.payment_mock}`);
}

async function testLearner() {
  console.log('\n👤 2. Création Learner');
  const { status, data } = await post('/learners', {
    id: LEARNER_ID,
    name: 'Kofi Testeur',
    phone: '22890123456',
    language: 'fr',
  });

  if (status !== 201 || !data.success) throw new Error(`Learner failed: ${JSON.stringify(data)}`);
  SERVER_LEARNER_ID = data.data.learner.id;
  log('✓', `Learner créé: ${data.data.learner.name} (${SERVER_LEARNER_ID.slice(0, 12)}...)`);
}

async function testSync() {
  console.log('\n🔄 3. Sync Batch (progress + quiz + badge)');

  const { status, data } = await post('/sync', {
    operations: [
      {
        table_name: 'module_progress',
        operation: 'INSERT',
        record_id: `${LEARNER_ID}_mod_intro`,
        payload: {
          learner_id: LEARNER_ID,
          module_id: 'mod_entrepreneuriat',
          status: 'completed',
          current_lesson: 5,
          lessons_done: 5,
          total_xp_earned: 350,
          best_score: 0.88,
          completed_at: new Date().toISOString(),
        },
      },
      {
        table_name: 'quiz_attempt',
        operation: 'INSERT',
        record_id: `qa_${Date.now()}`,
        payload: {
          learner_id: LEARNER_ID,
          module_id: 'mod_entrepreneuriat',
          lesson_index: 4,
          score: 0.88,
          answers: { q1: 'B', q2: 'A', q3: 'C', q4: 'B', q5: 'A' },
          xp_awarded: 88,
          passed: true,
        },
      },
    ],
  });

  if (!data.success) throw new Error(`Sync failed: ${JSON.stringify(data)}`);
  log('✓', `${data.data.synced}/${data.data.processed} opérations synchronisées`);
  log('✓', `Résultats: ${JSON.stringify(data.data.results.map(r => ({ table: r.table_name || r.client_id?.slice(0, 10), status: r.status })))}`);
}

async function testBadge() {
  console.log('\n🏅 4. Badge avec Mint Blockchain (Mock)');

  const { status, data } = await post('/badges', {
    learner_id: LEARNER_ID,
    module_id: 'mod_entrepreneuriat',
    module_title: 'Introduction a l\'entrepreneuriat',
    score: 0.88,
    xp_total: 350,
    badge_hash: '0x' + 'ab'.repeat(32),
    qr_payload: '{"id":"test-badge-1"}',
    learner_name: 'Kofi Testeur',
  });

  if (status !== 201 || !data.success) throw new Error(`Badge failed: ${JSON.stringify(data)}`);
  log('✓', `Badge minté — tx: ${data.data.blockchain_tx.slice(0, 18)}...`);
  log('✓', `Token ID: ${data.data.token_id}`);
  log('✓', `Network: ${data.data.network}`);
  log('✓', `On-chain: ${data.data.on_chain}`);
}

async function testVerifyBadge() {
  console.log('\n🔎 5. Vérification Badge Blockchain');
  const certHash = '0x' + 'ab'.repeat(32);
  const res = await get(`/verify/${certHash}`);

  log('✓', `Résultat: found=${res.data?.found}, network=${res.data?.network}`);
}

async function testPayment() {
  console.log('\n💳 6. Paiement Mobile T-Money (Mock)');

  // Initier un paiement
  const { status, data } = await post('/payments/initiate', {
    learner_id: LEARNER_ID,
    provider: 'tmoney',
    phone_number: '22890123456',
    product_type: 'certification',
  });

  if (status !== 201 || !data.success) throw new Error(`Payment init failed: ${JSON.stringify(data)}`);
  const reference = data.data.reference;
  log('✓', `Paiement initié: ${reference}`);
  log('✓', `Montant: ${data.data.amount} ${data.data.currency}`);
  log('✓', `Mode mock: ${data.data.mock_mode}`);

  // Attendre que le mock confirme (3s minimum)
  log('⏳', 'Attente confirmation mock (4s)...');
  await wait(4000);

  // Vérifier le statut
  const statusRes = await get(`/payments/status/${reference}`);
  log('✓', `Statut: ${statusRes.data.status}`);
  log('✓', `Confirmé: ${statusRes.data.confirmed_at ? 'OUI' : 'NON'}`);

  return reference;
}

async function testPaymentHistory() {
  console.log('\n📊 7. Historique des Paiements');
  const res = await get(`/payments/history/${LEARNER_ID}`);

  if (res.success) {
    log('✓', `${res.data.length} paiement(s) dans l'historique`);
    res.data.forEach((tx, i) => {
      log('✓', `  [${i}] ${tx.product_type} — ${tx.amount} FCFA — ${tx.status}`);
    });
  } else {
    log('i', 'Aucun historique disponible');
  }
}

async function testProgress() {
  console.log('\n📈 8. Progression du Learner');
  const res = await get(`/progress/${LEARNER_ID}`);

  if (!res.success) throw new Error(`Progress failed: ${JSON.stringify(res)}`);
  log('✓', `${res.data.progress.length} progression(s) enregistrée(s)`);
  log('✓', `${res.data.badges.length} badge(s)`);
  log('✓', `${res.data.recent_attempts.length} tentative(s) de quiz récentes`);
}

async function testStats() {
  console.log('\n📊 9. Statistiques Globales');
  const res = await get('/stats');

  if (!res.success) throw new Error(`Stats failed: ${JSON.stringify(res)}`);
  log('✓', `Learners: ${res.data.total_learners}`);
  log('✓', `Badges: ${res.data.total_badges}`);
  log('✓', `Quiz attempts: ${res.data.total_quiz_attempts}`);
  log('✓', `Score moyen: ${res.data.average_score}%`);
}

async function testPricing() {
  console.log('\n💰 10. Tarification');
  const res = await get('/payments/pricing');

  if (!res.success) throw new Error(`Pricing failed: ${JSON.stringify(res)}`);
  log('✓', `Produits: ${JSON.stringify(res.data.products)}`);
  log('✓', `Opérateurs: ${JSON.stringify(res.data.providers)}`);
  log('✓', `Devise: ${res.data.currency}`);
  log('✓', `Mock: ${res.data.mock_mode}`);
}

// ── Runner ───────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   EduKraft API v2 — Test End-to-End Complet    ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const start = Date.now();
  const tests = [
    testHealth,
    testLearner,
    testSync,
    testBadge,
    testVerifyBadge,
    testPayment,
    testPaymentHistory,
    testProgress,
    testStats,
    testPricing,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.error(`  ❌ ÉCHEC: ${err.message}`, err.cause?.code || '');
      failed++;
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════');
  console.log(`Résultats: ${passed} réussi(s), ${failed} échoué(s) — ${duration}s`);
  console.log('══════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});