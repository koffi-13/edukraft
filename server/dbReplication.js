// server/dbReplication.js
// ═══════════════════════════════════════════════════════════════════════════
// PERSISTANCE DE LA DB SQLITE SUR RENDER (v1.1.9)
//
// PROBLÈME (cause racine de plusieurs bugs v1.1.8) :
//   Render free tier = disque ÉPHÉMÈRE. À chaque redéploiement ET à chaque
//   sortie de veille (le service s'endort après 15 min d'inactivité), le
//   conteneur repart d'une image neuve : le fichier SQLite est EFFACÉ.
//   Conséquences observées :
//     - « la création de compte fonctionne mais la connexion échoue »
//       (les comptes créés après le dernier effacement n'existent plus) ;
//     - Google find-or-create recrée l'utilisateur avec un NOUVEL UUID →
//       le client croit à un changement de compte → profil/objectif/photo
//       locaux basculés vers un learner vide ;
//     - « le serveur ne conserve pas les données ».
//
// SOLUTION (zéro dépendance, zéro nouveau compte, gratuit) :
//   Répliquer le fichier SQLite sur GitHub — l'utilisateur a déjà un dépôt
//   privé + un PAT. Le snapshot est stocké en PIÈCE JOINTE (asset) d'une
//   release dédiée (tag « db-backup ») : contrairement à un fichier commité,
//   un asset est REMPLACÉ à chaque upload → pas de gonflement de l'historique
//   git, et les données utilisateurs ne polluent pas le code source.
//
//   1. AU DÉMARRAGE (avant l'ouverture de la DB) : télécharger l'asset
//      edukraft.db depuis la release → écraser le fichier local vide.
//      → les comptes, learners, progressions survivent aux redéploiements.
//   2. APRÈS CHAQUE ÉCRITURE (middleware debounced ~4 s) : snapshot cohérent
//      via db.backup() (inclut le contenu WAL) → upload (suppression de
//      l'asset précédent + nouvel upload). Flush forcé sur SIGTERM.
//
// CONFIGURATION (variables d'environnement Render — voir DEPLOYMENT-V1.md §13) :
//   GITHUB_DB_TOKEN        PAT GitHub (scope repo)              — REQUIS pour activer
//   GITHUB_DB_REPO         dépôt cible (défaut : koffi-13/edukraft)
//   GITHUB_DB_RELEASE_TAG  tag de la release (défaut : db-backup)
//   GITHUB_DB_ASSET_NAME   nom de l'asset (défaut : edukraft.db)
//
//   ⚠️ Si GITHUB_DB_TOKEN est absent → module inactif (log d'avertissement),
//      comportement éphémère inchangé (l'app reste fonctionnelle).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GITHUB_DB_TOKEN || '';
const REPO = process.env.GITHUB_DB_REPO || 'koffi-13/edukraft';
const RELEASE_TAG = process.env.GITHUB_DB_RELEASE_TAG || 'db-backup';
const ASSET_NAME = process.env.GITHUB_DB_ASSET_NAME || 'edukraft.db';

const API_BASE = 'https://api.github.com';
const UPLOAD_BASE = 'https://uploads.github.com';
const DEBOUNCE_MS = parseInt(process.env.GITHUB_DB_DEBOUNCE_MS || '4000', 10);

const enabled = () => !!TOKEN;

function ghHeaders(extra = {}) {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'edukraft-db-replication',
    ...extra,
  };
}

async function ghFetch(url, options = {}) {
  const resp = await fetch(url, options);
  return resp;
}

/** Récupère (ou crée) la release de sauvegarde. */
async function getOrCreateRelease() {
  // 1. Release existante ?
  let resp = await ghFetch(`${API_BASE}/repos/${REPO}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`, {
    headers: ghHeaders(),
  });
  if (resp.ok) return await resp.json();
  if (resp.status !== 404) {
    throw new Error(`GitHub release lookup ${resp.status}: ${await resp.text()}`);
  }
  // 2. Créer la release (brouillon, pour ne pas alerter les watchers)
  resp = await ghFetch(`${API_BASE}/repos/${REPO}/releases`, {
    method: 'POST',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tag_name: RELEASE_TAG,
      name: 'Sauvegarde DB EduKraft (automatique)',
      body: 'Release technique : stockage du snapshot SQLite de l\'API. Ne pas supprimer.',
      draft: false,
      prerelease: true,
    }),
  });
  if (resp.ok) return await resp.json();
  // 3. Concurrence (créée entre-temps) → relire
  if (resp.status === 422 || resp.status === 409) {
    resp = await ghFetch(`${API_BASE}/repos/${REPO}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`, {
      headers: ghHeaders(),
    });
    if (resp.ok) return await resp.json();
  }
  throw new Error(`GitHub create release ${resp.status}: ${await resp.text()}`);
}

/**
 * Télécharge le snapshot distant vers dbPath. Retourne true si restauré.
 * Appelé AVANT l'ouverture de better-sqlite3.
 */
async function restoreDbFromRemote(dbPath) {
  if (!enabled()) {
    console.warn('[DB-REPL] GITHUB_DB_TOKEN absent — persistance distante DÉSACTIVÉE (disque éphémère : les données seront perdues au prochain redémarrage Render)');
    return false;
  }
  try {
    const release = await getOrCreateRelease();
    const asset = (release.assets || []).find(a => a.name === ASSET_NAME);
    if (!asset) {
      console.log(`[DB-REPL] Aucun asset ${ASSET_NAME} sur la release ${RELEASE_TAG} — démarrage avec base locale`);
      return false;
    }
    const resp = await ghFetch(asset.url, {
      headers: ghHeaders({ 'Accept': 'application/octet-stream' }),
    });
    if (!resp.ok) throw new Error(`download asset ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    // Garde-fou : un vrai fichier SQLite commence par « SQLite format 3\0 »
    if (buf.length < 100 || buf.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
      throw new Error('asset téléchargé n\'est pas un fichier SQLite valide');
    }
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Supprimer les résidus WAL/SHM d'une vie antérieure du fichier
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
    }
    fs.writeFileSync(dbPath, buf);
    console.log(`[DB-REPL] DB restaurée depuis GitHub (${Math.round(buf.length / 1024)} Ko, asset #${asset.id}) — ${new Date(asset.updated_at).toISOString()}`);
    return true;
  } catch (e) {
    console.warn('[DB-REPL] Restauration impossible (démarrage sur base locale) :', e.message);
    return false;
  }
}

// ── Upload debounced ────────────────────────────────────────────────────────

let dbRef = null;
let dirty = false;
let uploading = false;
let timer = null;
let lastUploadAt = 0;
let uploadCount = 0;

/** Upload le snapshot courant. Exclusion mutuelle (pas d'upload parallèle). */
async function flushNow(reason = 'manual') {
  if (!enabled() || !dbRef || uploading) return false;
  uploading = true;
  try {
    // Snapshot cohérent via better-sqlite3 .backup() (lit aussi le WAL)
    const tmp = `${dbRef.name}.snapshot-${Date.now()}.tmp`;
    await dbRef.backup(tmp);
    const buf = fs.readFileSync(tmp);
    try { fs.unlinkSync(tmp); } catch (_) {}

    if (buf.length < 100 || buf.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
      throw new Error('snapshot SQLite invalide');
    }

    const release = await getOrCreateRelease();
    // Remplacer l'asset : supprimer l'ancien puis uploader le nouveau
    const old = (release.assets || []).find(a => a.name === ASSET_NAME);
    if (old) {
      const del = await ghFetch(`${API_BASE}/repos/${REPO}/releases/assets/${old.id}`, {
        method: 'DELETE',
        headers: ghHeaders(),
      });
      // 204 attendu ; en cas d'échec on tente quand même l'upload (doublon
      // de nom → GitHub peut renvoyer 422, on retentera au prochain flush)
      if (!del.ok) console.warn(`[DB-REPL] Suppression ancien asset ${del.status} (ignoré)`);
    }
    const up = await ghFetch(`${UPLOAD_BASE}/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(ASSET_NAME)}`, {
      method: 'POST',
      headers: ghHeaders({
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buf.length),
      }),
      body: buf,
    });
    if (!up.ok) throw new Error(`upload asset ${up.status}: ${(await up.text()).slice(0, 300)}`);

    dirty = false;
    lastUploadAt = Date.now();
    uploadCount++;
    console.log(`[DB-REPL] Snapshot uploadé (${Math.round(buf.length / 1024)} Ko, upload #${uploadCount}, raison: ${reason})`);
    return true;
  } catch (e) {
    console.warn('[DB-REPL] Échec upload (nouvelle tentative au prochain changement) :', e.message);
    return false;
  } finally {
    uploading = false;
  }
}

function scheduleFlush(reason) {
  if (!enabled()) return;
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushNow(reason).catch(() => {});
  }, DEBOUNCE_MS);
}

/**
 * Installe le suivi des écritures + le flush périodique/signaux.
 * IMPORTANT : installDirtyTracking() doit être appelé AVANT le montage
 * des routes (middleware pass-through : il s'exécute pour TOUTE requête
 * et se contente d'écouter res.on('finish')) — un middleware enregistré
 * APRÈS les routes ne verrait jamais les requêtes qui matchent (la réponse
 * part avant de l'atteindre).
 * @param {import('express').Express} app
 */
function installDirtyTracking(app) {
  // Middleware pass-through : marque la DB « sale » après toute requête
  // mutante terminée (POST/PUT/PATCH/DELETE, quel que soit le code réponse —
  // un 4xx peut avoir écrit partiellement, un flush inutile est sans risque).
  app.use((req, res, next) => {
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => {
        if (res.statusCode < 500) scheduleFlush(`${req.method} ${req.path}`);
      });
    }
    next();
  });
}

/**
 * Attache la DB ouverte (après initDatabase) : active les uploads et le
 * premier flush de démarrage.
 * @param {import('better-sqlite3').Database} db
 */
function attachDb(db) {
  dbRef = db;

  // Filet de sécurité : flush périodique si un upload a échoué (dirty restant)
  setInterval(() => {
    if (dirty && Date.now() - lastUploadAt > 60_000) {
      flushNow('retry-periodique').catch(() => {});
    }
  }, 60_000).unref();

  // Flush immédiat à l'arrêt (Render envoie SIGTERM avant de tuer le conteneur)
  const shutdown = (signal) => {
    if (dirty || Date.now() - lastUploadAt > 5_000) {
      // best-effort : 4 s max d'attente avant de rendre la main
      Promise.race([
        flushNow(signal),
        new Promise(r => setTimeout(r, 4000)),
      ]).finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Premier upload (base locale existante → seed du remote), sans attendre
  setTimeout(() => {
    flushNow('boot').catch(() => {});
  }, 1500);
}

/** Compat : installation en une étape (suivi + attachement). ⚠️ À appeler
 *  AVANT le montage des routes pour que le middleware voie les requêtes. */
function initDbReplication(app, db) {
  installDirtyTracking(app);
  attachDb(db);
}

/** Statut (diagnostics / admin) */
function getReplicationStatus() {
  return {
    enabled: enabled(),
    repo: enabled() ? REPO : null,
    releaseTag: enabled() ? RELEASE_TAG : null,
    uploadCount,
    lastUploadAt: lastUploadAt ? new Date(lastUploadAt).toISOString() : null,
    dirty,
  };
}

module.exports = { restoreDbFromRemote, installDirtyTracking, attachDb, initDbReplication, flushNow, getReplicationStatus };
