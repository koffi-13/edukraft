// src/database/repositories/learnerRepository.js
// Repository Learner — createLearner, addXP, getLearner, updateStreakCache.
//
// Gère la table `learner` (SQLite natif) ou le champ `store.learner` (mémoire).
// Les écritures enqueue une opération de sync via la fonction fournie.

import { makeId } from './baseRepository';

export function createLearnerRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Crée ou met à jour le learner local (singleton). */
  async function create({ id, name, phone, language = 'fr' }) {
    const now = new Date().toISOString();

    if (isMemory()) {
      const newLearner = {
        id, name, phone, language,
        total_xp: 0, streak_days: 0,
        streak_freezes: 2, best_streak: 0,
        last_active_date: null, total_lessons_done: 0,
        last_active_at: now, created_at: now,
        updated_at: now, server_id: null, sync_status: 'pending',
      };
      store.learner = newLearner;
      console.log('[DB/MEMORY] Learner créé :', name);
      if (enqueue) await enqueue('learner', 'INSERT', id, newLearner);
      return newLearner;
    }

    // SQLite natif
    await db.runAsync(QUERIES.UPSERT_LEARNER,
      [id, name, phone, language, 0, 0, now, now, now]);
    const updated = await db.getFirstAsync(QUERIES.GET_LEARNER);
    if (enqueue) await enqueue('learner', 'INSERT', id, updated);
    return updated;
  }

  /** Ajoute de l'XP au learner courant. */
  async function addXP(learner, amount) {
    if (!learner) return null;
    const now = new Date().toISOString();

    if (isMemory()) {
      const updated = {
        ...store.learner,
        total_xp: store.learner.total_xp + amount,
        last_active_at: now,
        updated_at: now,
      };
      store.learner = updated;
      console.log(`[DB/MEMORY] +${amount} XP. Total: ${updated.total_xp}`);
      if (enqueue) await enqueue('learner', 'UPDATE', updated.id, updated);
      return updated.total_xp;
    }

    await db.runAsync(QUERIES.ADD_XP, [amount, now, learner.id]);
    const updated = await db.getFirstAsync(QUERIES.GET_LEARNER);
    if (enqueue) await enqueue('learner', 'UPDATE', updated.id, updated);
    return updated.total_xp;
  }

  /** Met à jour le cache streak + champs gamification du learner. */
  async function updateStreakCache(learnerId, fields) {
    const now = new Date().toISOString();
    if (isMemory()) {
      Object.assign(store.learner, fields, { updated_at: now });
      return store.learner;
    }
    await db.runAsync(QUERIES.UPDATE_STREAK_CACHE, [
      fields.streak_days,
      fields.streak_freezes,
      fields.best_streak,
      fields.last_active_date,
      fields.last_active_at || now,
      fields.total_lessons_done_delta || 0,
      now,
      learnerId,
    ]);
    return db.getFirstAsync(QUERIES.GET_LEARNER);
  }

  /** Récupère le learner local. */
  async function get() {
    if (isMemory()) return store.learner;
    return db.getFirstAsync(QUERIES.GET_LEARNER);
  }

  /** Met à jour les champs du profil étendu (v1.1). */
  async function updateProfile(learnerId, fields) {
    const now = new Date().toISOString();
    const allowedFields = [
      'first_name', 'last_name', 'gender', 'birth_date', 'education_level',
      'country', 'state', 'city', 'address', 'email', 'phone', 'photo_url', 'bio', 'profession',
    ];

    if (isMemory()) {
      const current = store.learner || {};
      for (const f of allowedFields) {
        if (fields[f] !== undefined) current[f] = fields[f];
      }
      current.updated_at = now;
      store.learner = current;
      return current;
    }

    // SQLite natif : construire la requête UPDATE dynamiquement
    const setParts = [];
    const values = [];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) {
        setParts.push(`${f} = ?`);
        values.push(fields[f]);
      }
    }
    if (setParts.length === 0) return db.getFirstAsync(QUERIES.GET_LEARNER);

    setParts.push('updated_at = ?');
    values.push(now);
    values.push(learnerId);

    await db.runAsync(
      `UPDATE learner SET ${setParts.join(', ')} WHERE id = ?`,
      values
    );
    return db.getFirstAsync(QUERIES.GET_LEARNER);
  }

  return { create, addXP, updateStreakCache, get, updateProfile };
}
