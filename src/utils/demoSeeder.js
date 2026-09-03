// src/utils/demoSeeder.js
// Peupleur de données de démonstration — Jour J de la compétition
//
// Charge un état réaliste en 2 secondes :
//   • 1 apprenant "Koffi Mensah" avec 420 XP (Niveau 3 "Confirmé")
//   • Module Marketing Digital : 2/3 leçons terminées, en cours
//   • Module Comptabilité Artisanale : terminé + badge émis
//   • 1 badge "Or" avec QR code généré
//   • 3 tentatives de quiz avec scores variés
//   • 7 jours de streak
//
// Usage : depuis ProfileScreen (bouton DevTools visible en __DEV__)
//   import { seedDemoData, clearDemoData } from '../utils/demoSeeder';
//   await seedDemoData(db);

import { generateBadge } from '../blockchain/badgeGenerator';

const DEMO_LEARNER = {
  id:          'demo_lrn_competition_2025',
  name:        'Koffi Mensah',
  phone:       '90 12 34 56',
  language:    'fr',
  total_xp:    420,
  streak_days: 7,
};

export async function seedDemoData(db) {
  if (!db?.db) throw new Error('DbProvider non initialisé');

  console.log('[DemoSeeder] Début du peuplement...');
  const now = new Date().toISOString();

  // ── 1. Supprimer les données existantes ───────────────────────────────────
  await db.db.execAsync(`
    DELETE FROM quiz_attempt;
    DELETE FROM badge;
    DELETE FROM module_progress;
    DELETE FROM sync_queue;
    DELETE FROM learner;
  `);

  // ── 2. Créer l'apprenant démo ─────────────────────────────────────────────
  await db.db.runAsync(`
    INSERT INTO learner
      (id, name, phone, language, total_xp, streak_days, last_active_at, created_at, updated_at, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [
    DEMO_LEARNER.id,
    DEMO_LEARNER.name,
    DEMO_LEARNER.phone,
    DEMO_LEARNER.language,
    DEMO_LEARNER.total_xp,
    DEMO_LEARNER.streak_days,
    now, now, now,
  ]);

  // Forcer la mise à jour du state React
  const freshLearner = await db.db.getFirstAsync('SELECT * FROM learner LIMIT 1');
  db.setLearner(freshLearner);
  console.log('[DemoSeeder] ✓ Apprenant créé:', DEMO_LEARNER.name);

  // ── 3. Module Marketing Digital — En cours (2/3 leçons) ──────────────────
  const mktId = 'marketing-digital-local-v1';
  const mktProgressId = `${DEMO_LEARNER.id}_${mktId}`;

  await db.db.runAsync(`
    INSERT INTO module_progress
      (id, learner_id, module_id, status, current_lesson, lessons_done,
       total_xp_earned, best_score, started_at, completed_at, sync_status, updated_at)
    VALUES (?, ?, ?, 'in_progress', 2, 2, 85, 0.89, ?, NULL, 'pending', ?)
  `, [mktProgressId, DEMO_LEARNER.id, mktId, _daysAgo(3), now]);

  // Quiz Leçon 0 — Score parfait (100%)
  await db.db.runAsync(`
    INSERT INTO quiz_attempt
      (id, learner_id, module_id, lesson_index, attempt_number, score,
       answers, xp_awarded, passed, completed_at, sync_status)
    VALUES (?, ?, ?, 0, 1, 1.0, ?, 40, 1, ?, 'synced')
  `, [
    _uid(), DEMO_LEARNER.id, mktId,
    JSON.stringify([
      { qId: 'q0_0', selected: 'c', correct: true },
      { qId: 'q0_1', selected: 'c', correct: true },
      { qId: 'q0_2', selected: 'b', correct: true },
    ]),
    _daysAgo(3),
  ]);

  // Quiz Leçon 1 — 1ère tentative échouée puis réussie (story réaliste)
  await db.db.runAsync(`
    INSERT INTO quiz_attempt
      (id, learner_id, module_id, lesson_index, attempt_number, score,
       answers, xp_awarded, passed, completed_at, sync_status)
    VALUES (?, ?, ?, 1, 1, 0.33, ?, 15, 0, ?, 'synced')
  `, [
    _uid(), DEMO_LEARNER.id, mktId,
    JSON.stringify([
      { qId: 'q1_0', selected: 'a', correct: false },
      { qId: 'q1_1', selected: 'b', correct: false },
      { qId: 'q1_2', selected: 'c', correct: true },
    ]),
    _daysAgo(2),
  ]);

  await db.db.runAsync(`
    INSERT INTO quiz_attempt
      (id, learner_id, module_id, lesson_index, attempt_number, score,
       answers, xp_awarded, passed, completed_at, sync_status)
    VALUES (?, ?, ?, 1, 2, 1.0, ?, 65, 1, ?, 'synced')
  `, [
    _uid(), DEMO_LEARNER.id, mktId,
    JSON.stringify([
      { qId: 'q1_0', selected: 'b', correct: true },
      { qId: 'q1_1', selected: 'a', correct: true },
      { qId: 'q1_2', selected: 'c', correct: true },
    ]),
    _daysAgo(1),
  ]);

  console.log('[DemoSeeder] ✓ Module Marketing Digital (2/3 leçons)');

  // ── 4. Module Comptabilité Artisanale — Terminé + Badge ───────────────────
  const cptId = 'comptabilite-artisanale-v1';
  const cptProgressId = `${DEMO_LEARNER.id}_${cptId}`;

  await db.db.runAsync(`
    INSERT INTO module_progress
      (id, learner_id, module_id, status, current_lesson, lessons_done,
       total_xp_earned, best_score, started_at, completed_at, sync_status, updated_at)
    VALUES (?, ?, ?, 'completed', 2, 3, 175, 0.92, ?, ?, 'pending', ?)
  `, [cptProgressId, DEMO_LEARNER.id, cptId, _daysAgo(6), _daysAgo(4), now]);

  // 3 quiz Comptabilité — tous réussis
  // v1.1.16 (Fix Issue 3) : total_xp_earned = Σ xp_awarded = 35+70+70 = 175
  // (avant 160 = meta.xp_reward statique, ce qui était faux vs les attempts).
  const cptQuizzes = [
    { li: 0, score: 0.89, answers: [{ qId:'q0_0',selected:'b',correct:true},{qId:'q0_1',selected:'b',correct:true},{qId:'q0_2',selected:'c',correct:true}], xp: 35, daysAgo: 6 },
    { li: 1, score: 1.00, answers: [{ qId:'q1_0',selected:'c',correct:true},{qId:'q1_1',selected:'c',correct:true},{qId:'q1_2',selected:'b',correct:true}], xp: 70, daysAgo: 5 },
    { li: 2, score: 0.89, answers: [{ qId:'q2_0',selected:'b',correct:true},{qId:'q2_1',selected:'b',correct:true},{qId:'q2_2',selected:'c',correct:true}], xp: 70, daysAgo: 4 },
  ];

  for (const q of cptQuizzes) {
    await db.db.runAsync(`
      INSERT INTO quiz_attempt
        (id, learner_id, module_id, lesson_index, attempt_number, score,
         answers, xp_awarded, passed, completed_at, sync_status)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, 'synced')
    `, [_uid(), DEMO_LEARNER.id, cptId, q.li, q.score, JSON.stringify(q.answers), q.xp, _daysAgo(q.daysAgo)]);
  }

  // Émettre le badge Comptabilité
  const badge = generateBadge({
    learnerId:   DEMO_LEARNER.id,
    learnerName: DEMO_LEARNER.name,
    moduleId:    cptId,
    moduleTitle: 'Certifié Comptabilité Artisanale',
    score:       0.92,
    xpTotal:     175,
  });

  await db.db.runAsync(`
    INSERT INTO badge
      (id, learner_id, module_id, module_title, score, xp_total,
       badge_hash, qr_payload, blockchain_tx, issued_at, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
  `, [
    badge.id,
    DEMO_LEARNER.id,
    cptId,
    'Certifié Comptabilité Artisanale',
    0.92,
    160,
    badge.hash,
    badge.qrPayload,
    // Simule un tx hash Polygon réaliste (64 hex chars)
    '0x' + badge.hash.slice(0, 62),
    badge.issuedAt,
  ]);

  console.log('[DemoSeeder] ✓ Module Comptabilité terminé + badge émis');
  console.log('[DemoSeeder] ✓ Badge hash:', badge.hash.slice(0, 16) + '...');

  // ── 5. Métadonnées sync ───────────────────────────────────────────────────
  await db.db.runAsync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync_at', ?)",
    [_daysAgo(1)]
  );

  console.log('[DemoSeeder] ✅ Données démo chargées avec succès');
  console.log(`[DemoSeeder]    Apprenant : ${DEMO_LEARNER.name}`);
  console.log(`[DemoSeeder]    XP total  : ${DEMO_LEARNER.total_xp} (Niveau 3 — Confirmé)`);
  console.log(`[DemoSeeder]    Streak    : ${DEMO_LEARNER.streak_days} jours`);
  console.log('[DemoSeeder]    Modules   : Marketing (en cours 2/3) + Comptabilité (terminé ✓)');
  console.log('[DemoSeeder]    Badges    : 1 badge Or certifié');

  return { success: true, learner: freshLearner, badgeId: badge.id };
}

export async function clearDemoData(db) {
  if (!db?.db) throw new Error('DbProvider non initialisé');
  await db.db.execAsync(`
    DELETE FROM quiz_attempt;
    DELETE FROM badge;
    DELETE FROM module_progress;
    DELETE FROM sync_queue;
    DELETE FROM learner;
    DELETE FROM sync_meta WHERE key != 'schema_version';
  `);
  db.setLearner(null);
  console.log('[DemoSeeder] Données effacées');
}

// ── Helpers privés ────────────────────────────────────────────────────────────
function _uid() {
  return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
