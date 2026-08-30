// src/database/repositories/learnerRepository.js
// Repository Learner — createLearner, addXP, getLearner, updateStreakCache.
//
// Gère la table `learner` (SQLite natif) ou le champ `store.learner` (mémoire).
// Les écritures enqueue une opération de sync via la fonction fournie.
//
// v1.1.8 (multi-comptes — isolation par ID utilisateur) :
//   - create() ne purge PLUS la table : chaque compte (et chaque invité)
//     possède SA PROPRE ligne `learner`, clé par son id (lrn_<user.id> pour
//     un compte authentifié, lrn_<timestamp> pour un invité). Les données des
//     autres comptes présents sur l'appareil sont INTACTES.
//   - Toutes les relectures sont SCOPÉES par learner.id (plus aucun
//     « LIMIT 1 » arbitraire qui pouvait renvoyer le learner d'un autre
//     compte après un changement de session).

import { makeId } from './baseRepository';

export function createLearnerRepository(db, store, enqueue) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  const getById = async (learnerId) =>
    db ? db.getFirstAsync('SELECT * FROM learner WHERE id = ?', [learnerId]) : store.learner;

  /**
   * Crée le learner — SANS purger les autres lignes (v1.1.8).
   * UPSERT par id : si le compte s'était déjà connecté sur cet appareil,
   * sa ligne (et donc ses progressions liées) est réutilisée, pas écrasée.
   */
  async function create({ id, name, phone, language = 'fr', server_id = null, email = null, photo_url = null }) {
    const now = new Date().toISOString();

    if (isMemory()) {
      // v1.1.8 : réutiliser les données éventuelles d'une précédente session
      // du MÊME compte (snapshot conservé par DbProvider au changement de
      // compte) — sinon profil neuf.
      const newLearner = {
        id, name, phone, language,
        email: email || null, photo_url: photo_url || null,
        total_xp: 0, streak_days: 0,
        streak_freezes: 2, best_streak: 0,
        last_active_date: null, total_lessons_done: 0,
        last_active_at: now, created_at: now,
        updated_at: now, server_id, sync_status: 'pending',
      };
      store.learner = newLearner;
      console.log('[DB/MEMORY] Learner créé :', name);
      if (enqueue) await enqueue('learner', 'INSERT', id, newLearner);
      return newLearner;
    }

    // SQLite natif — UPSERT par id, SANS toucher aux autres comptes (v1.1.8)
    await db.runAsync(QUERIES.UPSERT_LEARNER,
      [id, name, phone, language, 0, 0, now, now, now]);
    if (server_id) {
      await db.runAsync('UPDATE learner SET server_id = ?, updated_at = ? WHERE id = ?', [String(server_id), now, id]);
    }
    // v1.1.8 : champs de profil connus du compte (email Google, avatar…)
    const profileFields = {};
    if (email) profileFields.email = email;
    if (photo_url) profileFields.photo_url = photo_url;
    if (Object.keys(profileFields).length) {
      await updateProfile(id, profileFields);
    }
    const updated = await getById(id);
    if (enqueue) await enqueue('learner', 'INSERT', id, updated || { id, name, phone, language });
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
    // v1.1.8 : relecture SCOPÉE par id (jamais LIMIT 1 — risque multi-comptes)
    const updated = await getById(learner.id);
    // v1.1 : guard si la ligne learner a disparu (base corrompue) — on ne
    // crash plus sur updated.total_xp
    if (updated) {
      if (enqueue) await enqueue('learner', 'UPDATE', updated.id, updated);
      return updated.total_xp;
    }
    console.warn('[DB] addXP : learner introuvable en SQLite');
    return (learner.total_xp || 0) + amount;
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
    // v1.1 : guard null (base vide/corrompue) — on reconstruit un objet
    // cohérent plutôt que de crasher l'app
    // v1.1.8 : relecture SCOPÉE par id (jamais LIMIT 1 — risque multi-comptes)
    const row = await getById(learnerId);
    return row || { id: learnerId, ...fields, updated_at: now };
  }

  /** Récupère le learner ACTIF (v1.1.8 : jamais un LIMIT 1 arbitraire —
   *  priorité au learner actif du store, relecture scopee par id en SQLite). */
  async function get() {
    if (isMemory()) return store.learner;
    if (store.learner?.id) {
      const row = await getById(store.learner.id);
      if (row) return row;
    }
    return db.getFirstAsync(QUERIES.GET_LEARNER); // dernier recours (legacy)
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
    if (setParts.length === 0) return getById(learnerId);

    setParts.push('updated_at = ?');
    values.push(now);
    values.push(learnerId);

    await db.runAsync(
      `UPDATE learner SET ${setParts.join(', ')} WHERE id = ?`,
      values
    );
    return getById(learnerId); // v1.1.8 : scope par id (jamais LIMIT 1)
  }

  return { create, addXP, updateStreakCache, get, updateProfile };
}
