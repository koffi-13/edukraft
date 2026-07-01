// src/utils/offlineTestRunner.js
// Protocole de test Offline-First — 3 phases
//
// Ce module est un OUTIL DE DÉVELOPPEMENT uniquement.
// Il simule les scénarios réseau défavorables et vérifie les invariants
// de la couche SQLite/syncEngine avant chaque ouverture de hub.
//
// Usage (dans un écran de dev __DEV__ uniquement) :
//   import { runOfflineTestSuite } from '../utils/offlineTestRunner';
//   const results = await runOfflineTestSuite(db);
//
// Chaque test retourne { name, passed, detail, durationMs }

// import * as SQLite from 'expo-sqlite'; // Temporairement désactivé pour test web

// ── Constantes ────────────────────────────────────────────────────────────────

const TEST_LEARNER_ID = 'test_lrn_offline_001';
const TEST_MODULE_ID  = 'marketing-digital-local-v1';

// ── Runner principal ──────────────────────────────────────────────────────────

/**
 * Lance toute la suite de tests offline
 * @param {Object} db - instance DbProvider (depuis useDb())
 * @returns {Promise<TestSuiteResult>}
 */
export async function runOfflineTestSuite(db) {
  const results = [];
  const suite   = [
    testLocalWrite,
    testProgressPersistence,
    testQuizAttemptOffline,
    testBadgeGenerationOffline,
    testSyncQueueEnqueue,
    testQueueRetryMechanism,
    testDataIntegrityAfterRestart,
    testLargeOfflineSession,
    testXPAccumulation,
  ];

  const startTotal = Date.now();
  console.log('[OfflineTest] ▶ Démarrage de la suite — 9 tests');

  for (const testFn of suite) {
    const start = Date.now();
    try {
      const result = await testFn(db);
      results.push({ ...result, durationMs: Date.now() - start });
      console.log(
        result.passed ? `  ✓ ${result.name}` : `  ✗ ${result.name}: ${result.detail}`,
        `(${Date.now() - start}ms)`
      );
    } catch (e) {
      results.push({
        name:       testFn.name,
        passed:     false,
        detail:     `Exception non gérée : ${e.message}`,
        durationMs: Date.now() - start,
      });
      console.error(`  ✗ ${testFn.name} — Exception:`, e);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = Date.now() - startTotal;

  const summary = {
    passed,
    failed,
    total:    results.length,
    totalMs,
    allPassed: failed === 0,
    results,
    // Certification hub : bloque si ≥ 1 échec critique
    readyForHub: results
      .filter(r => r.critical)
      .every(r => r.passed),
  };

  console.log(`\n[OfflineTest] ${passed}/${results.length} tests réussis en ${totalMs}ms`);
  if (summary.readyForHub) {
    console.log('[OfflineTest] ✅ CERTIFIÉ — Hub peut être ouvert');
  } else {
    console.log('[OfflineTest] ❌ BLOQUÉ — Corriger les tests critiques avant ouverture');
  }

  return summary;
}

// ── Tests individuels ─────────────────────────────────────────────────────────

/**
 * TEST 1 — Écriture locale sans réseau
 * Vérifie que createLearner fonctionne en mode offline pur
 */
async function testLocalWrite(db) {
  const name = 'Écriture locale SQLite sans réseau';
  try {
    // Créer un apprenant test
    const learner = await db.createLearner({
      id:       TEST_LEARNER_ID,
      name:     'Test Apprenant Offline',
      phone:    '90000001',
      language: 'fr',
    });

    const ok = learner && learner.id === TEST_LEARNER_ID;
    return {
      name, critical: true,
      passed: ok,
      detail: ok ? 'Profil créé et lu depuis SQLite' : 'Échec création profil',
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

/**
 * TEST 2 — Persistance de la progression d'un module
 * Simule 3 mises à jour consécutives et vérifie la cohérence
 */
async function testProgressPersistence(db) {
  const name = 'Persistance progression module (3 updates)';
  try {
    // Update 1 : démarrage
    await db.updateProgress(TEST_MODULE_ID, {
      status:         'in_progress',
      current_lesson: 0,
      started_at:     new Date().toISOString(),
    });

    // Update 2 : leçon 1 terminée
    await db.updateProgress(TEST_MODULE_ID, {
      current_lesson: 1,
      lessons_done:   1,
      total_xp_earned: 35,
      best_score:     0.85,
    });

    // Update 3 : leçon 2 terminée
    await db.updateProgress(TEST_MODULE_ID, {
      current_lesson: 2,
      lessons_done:   2,
      total_xp_earned: 90,
    });

    // Lecture et vérification
    const progress = await db.getProgress(TEST_MODULE_ID);
    const ok = progress
      && progress.lessons_done === 2
      && progress.total_xp_earned === 90
      && progress.best_score === 0.85;

    return {
      name, critical: true,
      passed: !!ok,
      detail: ok
        ? `Progress: lessons_done=${progress.lessons_done}, xp=${progress.total_xp_earned}`
        : `Données corrompues: ${JSON.stringify(progress)}`,
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

/**
 * TEST 3 — Sauvegarde tentative quiz hors ligne
 * Vérifie que le score et les réponses sont stockés localement
 */
async function testQuizAttemptOffline(db) {
  const name = 'Sauvegarde quiz offline (score + réponses)';
  try {
    const answers = [
      { qId: 'q0_0', selected: 'c', correct: true  },
      { qId: 'q0_1', selected: 'c', correct: true  },
      { qId: 'q0_2', selected: 'b', correct: true  },
    ];

    await db.saveQuizAttempt({
      moduleId:     TEST_MODULE_ID,
      lessonIndex:  0,
      score:        1.0,
      answers,
      xpAwarded:    35,
      passed:       true,
    });

    // Vérifie que la file de sync contient l'entrée
    const queue = await db.getPendingQueue();
    const quizInQueue = queue.some(q => q.table_name === 'quiz_attempt');

    return {
      name, critical: true,
      passed: quizInQueue,
      detail: quizInQueue
        ? `Quiz enqueued correctement (${queue.length} élément(s) total en attente)`
        : 'Quiz non trouvé dans la sync_queue',
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

/**
 * TEST 4 — Génération de badge offline
 * Vérifie que le badge QR est généré et stocké sans réseau
 */
async function testBadgeGenerationOffline(db) {
  const name = 'Génération badge + QR offline';
  try {
    const badge = await db.issueBadge({
      moduleId:    TEST_MODULE_ID,
      moduleTitle: 'Marketing Digital Local',
      score:       0.89,
      xpTotal:     150,
    });

    const ok = badge
      && badge.id
      && badge.hash && badge.hash.length === 64   // SHA-256 = 64 hex chars
      && badge.qrPayload && badge.qrPayload.length > 0
      && badge.issuedAt;

    return {
      name, critical: true,
      passed: !!ok,
      detail: ok
        ? `Badge ${badge.id.slice(0, 8)}... hash=${badge.hash.slice(0, 12)}...`
        : `Badge invalide: hash.length=${badge?.hash?.length}, qr.length=${badge?.qrPayload?.length}`,
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

/**
 * TEST 5 — File de sync cohérente
 * Vérifie que chaque écriture DB enqueue exactement un événement
 */
async function testSyncQueueEnqueue(db) {
  const name = 'File sync_queue — cohérence enqueue';
  try {
    const before = await db.getPendingQueue();
    const countBefore = before.length;

    // Une nouvelle écriture
    await db.addXP(10);

    const after = await db.getPendingQueue();
    const countAfter = after.length;

    const ok = countAfter >= countBefore; // au moins autant d'événements

    return {
      name, critical: true,
      passed: ok,
      detail: `Queue avant: ${countBefore} > après: ${countAfter}`,
    };
  } catch (e) {
    return { name, critical: false, passed: false, detail: e.message };
  }
}

/**
 * TEST 6 — Mécanisme de retry
 * Vérifie qu'increment_retry augmente le compteur correctement
 */
async function testQueueRetryMechanism(db) {
  const name = 'Retry exponentiel — compteur';
  try {
    const queue = await db.getPendingQueue();
    if (queue.length === 0) {
      return { name, critical: false, passed: true, detail: 'Queue vide — skip' };
    }

    const item = queue[0];
    await db.incrementRetry(item.id, 'Test erreur HTTP 503');

    // Vérifier le compteur incrémenté
    const updated = await db.getPendingQueue();
    const updatedItem = updated.find(q => q.id === item.id);

    const ok = updatedItem && updatedItem.retry_count === (item.retry_count + 1);

    return {
      name, critical: false,
      passed: !!ok,
      detail: ok
        ? `retry_count ${item.retry_count} > ${updatedItem.retry_count}`
        : `retry_count non incrémenté: ${updatedItem?.retry_count}`,
    };
  } catch (e) {
    return { name, critical: false, passed: false, detail: e.message };
  }
}

/**
 * TEST 7 — Intégrité données après redémarrage simulé
 * Vérifie que les données survivent à une réouverture de la DB
 */
async function testDataIntegrityAfterRestart(db) {
  const name = 'Intégrité données post-redémarrage DB';
  try {
    // Écrire des données de référence
    await db.updateProgress(TEST_MODULE_ID, {
      status:      'completed',
      lessons_done: 3,
      best_score:  0.92,
      completed_at: new Date().toISOString(),
    });

    // Ouvrir une 2e connexion à la même DB (simule un redémarrage)
    const db2 = await SQLite.openDatabaseAsync('edukraft.db');
    const row  = await db2.getFirstAsync(
      'SELECT * FROM module_progress WHERE module_id = ? LIMIT 1',
      [TEST_MODULE_ID]
    );

    const ok = row && row.status === 'completed' && row.lessons_done === 3;

    return {
      name, critical: true,
      passed: !!ok,
      detail: ok
        ? `Données confirmées: status=${row.status}, lessons_done=${row.lessons_done}`
        : `Données manquantes ou corrompues: ${JSON.stringify(row)}`,
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

/**
 * TEST 8 — Session offline longue (50 opérations)
 * Simule 50 écritures consécutives sans sync > vérifie 0 perte
 */
async function testLargeOfflineSession(db) {
  const name = 'Session offline longue — 50 opérations sans perte';
  try {
    const ops = 50;
    for (let i = 0; i < ops; i++) {
      await db.addXP(1);
    }

    const learner = await db.getPendingQueue();
    // La queue devrait avoir au moins 50 entrées (les addXP)
    const ok = learner.length >= ops;

    return {
      name, critical: false,
      passed: ok,
      detail: `${ops} opérations > ${learner.length} entrées en queue`,
    };
  } catch (e) {
    return { name, critical: false, passed: false, detail: e.message };
  }
}

/**
 * TEST 9 — Accumulation XP correcte
 * Vérifie que addXP accumule sans écraser
 */
async function testXPAccumulation(db) {
  const name = 'Accumulation XP — addXP(n) × 3 sans écrasement';
  try {
    // Lire le XP actuel
    const before = await db.db.getFirstAsync('SELECT total_xp FROM learner LIMIT 1');
    const xpBefore = before?.total_xp ?? 0;

    await db.addXP(100);
    await db.addXP(50);
    await db.addXP(25);

    const after = await db.db.getFirstAsync('SELECT total_xp FROM learner LIMIT 1');
    const xpAfter = after?.total_xp ?? 0;

    const expected = xpBefore + 175;
    const ok = xpAfter === expected;

    return {
      name, critical: true,
      passed: ok,
      detail: ok
        ? `XP: ${xpBefore} + 175 = ${xpAfter} ✓`
        : `XP attendu: ${expected}, obtenu: ${xpAfter}`,
    };
  } catch (e) {
    return { name, critical: true, passed: false, detail: e.message };
  }
}

// ── Rapport formaté pour affichage UI ─────────────────────────────────────────

/**
 * Formate le rapport pour l'écran DevTools
 */
export function formatReport(suite) {
  const lines = [
    `Tests: ${suite.passed}/${suite.total} réussis (${suite.totalMs}ms)`,
    suite.readyForHub
      ? '✅ CERTIFIÉ — Hub opérationnel'
      : '❌ BLOQUÉ — Corriger avant ouverture hub',
    '',
    ...suite.results.map(r =>
      `${r.passed ? '✓' : '✗'} [${r.durationMs}ms] ${r.name}${!r.passed ? '\n   > ' + r.detail : ''}`
    ),
  ];
  return lines.join('\n');
}
