// src/database/repositories/badgeRepository.js
// Repository Badges — issueBadge, getAllBadges, updateBadgeTx.

import { makeId } from './baseRepository';
import { generateBadge } from '../../blockchain/badgeGenerator';

export function createBadgeRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Émet un badge (génère le hash + QR payload, insère en DB).
   * v1.1.5 : IDEMPOTENT — si un badge existe déjà pour ce module, on le
   * retourne au lieu d'en émettre un nouveau. Avant, le re-passage du quiz
   * final d'un module (statut rétrogradé « En cours » par le bug du
   * LessonScreen) ré-émettait un 2e badge identique. */
  async function issue(learner, { moduleId, moduleTitle, score, xpTotal }) {
    const learnerId = learner?.id || store.learner?.id;
    if (!learnerId) return null;

    // Badge déjà émis pour ce module ? → idempotence (anti-doublon)
    if (isMemory()) {
      const existingBadge = store.badges.find(b => b.module_id === moduleId);
      if (existingBadge) {
        console.log(`[DB/MEMORY] Badge déjà émis pour ${moduleTitle} — pas de doublon`);
        return existingBadge;
      }
    } else {
      const existingBadge = await db.getFirstAsync(
        'SELECT * FROM badge WHERE learner_id = ? AND module_id = ? LIMIT 1',
        [learnerId, moduleId]
      );
      if (existingBadge) {
        console.log(`[DB] Badge déjà émis pour ${moduleTitle} — pas de doublon`);
        return existingBadge;
      }
    }

    const badge = generateBadge({
      learnerId,
      learnerName: store.learner?.name || learner?.name,
      moduleId, moduleTitle, score, xpTotal,
    });

    if (isMemory()) {
      const badgeRow = {
        id: badge.id, learner_id: learnerId, module_id: moduleId,
        module_title: moduleTitle, score, xp_total: xpTotal,
        badge_hash: badge.hash, qr_payload: badge.qrPayload,
        blockchain_tx: null, issued_at: badge.issuedAt,
        sync_status: 'pending',
      };
      store.badges.push(badgeRow);
      console.log(`[DB/MEMORY] Badge émis: ${moduleTitle}`);
      if (enqueue) await enqueue('badge', 'INSERT', badge.id, {
        learner_id: learnerId, module_id: moduleId,
        module_title: moduleTitle, score, xp_total: xpTotal,
        badge_hash: badge.hash, qr_payload: badge.qrPayload,
        issued_at: badge.issuedAt,
      });
      return badge;
    }

    // SQLite natif
    await db.runAsync(QUERIES.INSERT_BADGE, [
      badge.id, learnerId, moduleId, moduleTitle,
      score, xpTotal, badge.hash, badge.qrPayload,
      null, badge.issuedAt,
    ]);
    if (enqueue) await enqueue('badge', 'INSERT', badge.id, {
      learner_id: learnerId, module_id: moduleId,
      module_title: moduleTitle, score, xp_total: xpTotal,
      badge_hash: badge.hash, qr_payload: badge.qrPayload,
      issued_at: badge.issuedAt,
    });
    return badge;
  }

  /** Récupère tous les badges du learner (triés par date décroissante). */
  async function getAll(learner) {
    if (isMemory()) {
      return store.badges.slice().reverse();
    }
    return db.getAllAsync(QUERIES.GET_ALL_BADGES, [learner?.id]);
  }

  /** Met à jour le tx hash blockchain d'un badge. */
  async function updateTx(badgeId, txHash) {
    if (isMemory()) {
      const b = store.badges.find(b => b.id === badgeId);
      if (b) b.blockchain_tx = txHash;
      return;
    }
    await db.runAsync(QUERIES.UPDATE_BADGE_TX, [txHash, badgeId]);
  }

  return { issue, getAll, updateTx };
}
