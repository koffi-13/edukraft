// src/database/repositories/badgeRepository.js
// Repository Badges — issueBadge, getAllBadges, updateBadgeTx.

import { makeId } from './baseRepository';
import { generateBadge } from '../../blockchain/badgeGenerator';

export function createBadgeRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Émet un badge (génère le hash + QR payload, insère en DB). */
  async function issue(learner, { moduleId, moduleTitle, score, xpTotal }) {
    const learnerId = learner?.id || store.learner?.id;
    if (!learnerId) return null;

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
