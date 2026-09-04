// src/content/moduleRegistry.js
// Registry des modules de formation EduKraft
// Charge les fichiers JSON riches et les expose en structure plate pour le Dashboard
//
// v1.1.7 — catalogue distant (offline-first « nouveaux cours ») :
//   - MODULES démarre avec les modules BUNDLÉS (dans l'APK, dispo hors ligne).
//   - initRemoteModules() applique au démarrage le CACHE distant (AsyncStorage)
//     — les cours téléchargés lors d'une session précédente restent dispo
//     hors ligne.
//   - refreshRemoteModules() interroge GET /api/content/modules (appelé par le
//     SyncEngine au démarrage, à la reconnexion et au premier plan) : un
//     nouveau cours publié côté serveur apparaît dans l'app SANS mise à jour
//     de l'APK. Le cache AsyncStorage est mis à jour pour l'offline.
//   - Les écrans s'abonnent via subscribeModules() pour re-rendre quand la
//     liste change (mutation EN PLACE du tableau MODULES).

import marketingDigital from './modules/marketing_digital_local.json';
import comptabiliteArtisanale from './modules/comptabilite_artisanale.json';
import ecommerceWhatsapp from './modules/ecommerce_whatsapp_business.json';
import logistiqueTransit from './modules/logistique_transit_douane.json';
import comptabiliteOhada from './modules/comptabilite_pme_ohada.json';
import transformationAgro from './modules/transformation_agroalimentaire.json';
import communityManager from './modules/community_manager.json';
import agentMobileMoney from './modules/agent_mobile_money.json';

import persistentStorage from '../utils/persistentStorage';
import ENV from '../config/env';

// ── Transformation JSON riche > structure plate compatible Dashboard ─────
function normalizeModule(json) {
  // v1.1.16 (Fix Issue 3) : `meta.xp_reward` était une copie manuelle de
  // Σ(lessons[].xp_per_lesson). Rien ne garantissait l'égalité, et surtout
  // rien n'incluait les bonus « quiz parfait » (lessons[].quiz.xp_bonus_perfect).
  // La carte du module affichait donc Σ(base) alors que l'attribution réelle
  // vaut Σ(base + bonus_parfait). On calcule désormais la base depuis les
  // leçons (source unique de vérité) et on expose aussi maxXP (base + bonus)
  // pour que la carte affiche une plage honnête « base–max ».
  // v1.1.19 (Phase 2 — Fix 2.C) : validation declaredXp === xp à l'init.
  // Si un auteur modifie xp_per_lesson d'une leçon et oublie de mettre à jour
  // meta.xp_reward, la carte affichait un chiffre différent de l'attribution
  // réelle sans qu'aucun signal n'alerte. On log un warning en dev pour
  // détecter la divergence dès le chargement (visible en console Metro).
  const lessons = Array.isArray(json.lessons) ? json.lessons : [];
  const computedBaseXp = lessons.reduce((s, l) => s + (l?.xp_per_lesson || 0), 0);
  const computedMaxXp = lessons.reduce(
    (s, l) => s + (l?.xp_per_lesson || 0) + (l?.quiz?.xp_bonus_perfect || 0),
    0
  );
  const declaredXp = json.meta?.xp_reward;
  if (typeof declaredXp === 'number' && Math.abs(declaredXp - computedBaseXp) > 0.001) {
    console.warn(
      `[Content] ${json.id}: meta.xp_reward (${declaredXp}) ≠ Σ(xp_per_lesson) (${computedBaseXp}) ` +
      `— la carte affichera la base calculée (${computedBaseXp}), pas la valeur déclarée. ` +
      `Mettez à jour meta.xp_reward dans le JSON pour qu'il corresponde à la somme.`
    );
  }
  return {
    // Champs plate (utilisés par le Dashboard)
    id:          json.id,
    title:       json.meta.title,
    subtitle:    json.meta.subtitle,
    description: json.meta.description,
    duration:    json.meta.duration_min,
    // xp = base (Σ xp_per_lesson). Si l'auteur JSON a mal renseigné
    // meta.xp_reward, on conserve la valeur calculée (source de vérité).
    xp:          computedBaseXp,
    maxXP:       computedMaxXp,
    // Conserve la valeur déclarée pour audit/debug (sert à détecter la
    // divergence si un auteur modifie l'un et oubli l'autre).
    declaredXp:  declaredXp,
    color:       json.meta.color,

    // Champs étendus
    filiere:      json.filiere,
    difficulty:   json.difficulty,
    badge_title:  json.meta.badge_title,
    icon:         json.meta.icon,
    tags:         json.meta.tags,
    target_audience: json.meta.target_audience,
    version:      json.version,

    // Données riches (utilisés par LessonScreen et QuizScreen)
    lessons:          json.lessons,
    completion_criteria: json.completion_criteria,
    i18n:             json.i18n,

    // Marqueur : module venu du serveur (utile au debug)
    remote: !!json.__remote,
  };
}

// ── Registre principal (mutable en place — les abonnés re-rendent) ────────
export const MODULES = [
  normalizeModule(marketingDigital),
  normalizeModule(comptabiliteArtisanale),
  normalizeModule(ecommerceWhatsapp),
  normalizeModule(logistiqueTransit),
  normalizeModule(comptabiliteOhada),
  normalizeModule(transformationAgro),
  normalizeModule(communityManager),
  normalizeModule(agentMobileMoney),
];

// ── v1.1.7 : catalogue distant ───────────────────────────────────────────────
const CACHE_KEY    = 'ek_remote_modules';
const VERSION_KEY  = 'ek_remote_modules_version';
let remoteVersion  = null;
let initialized    = false;
const listeners    = new Set();

/** S'abonner aux changements du registre (nouveau cours / màj de cours). */
export function subscribeModules(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch (_) {}
  }
}

/** Fusionne des modules JSON bruts (format serveur = format bundle) dans
 *  MODULES, EN PLACE : même id → remplacement si version différente,
 *  nouvel id → ajout à la fin. Retourne true si le registre a changé. */
function applyRemoteModules(rawModules) {
  let changed = false;
  for (const raw of (rawModules || [])) {
    if (!raw?.id || !raw?.meta?.title) continue; // entrée invalide → ignorée
    const m = normalizeModule({ ...raw, __remote: true });
    const idx = MODULES.findIndex(x => x.id === m.id);
    if (idx >= 0) {
      // Cours déjà connu (bundlé ou distant précédent) : remplacer seulement
      // si la version distante diffère (sinon on écrase les données locales
      // identiques pour rien et on notifie à tort).
      if (String(MODULES[idx].version || '') !== String(m.version || '')) {
        MODULES[idx] = m;
        changed = true;
      }
    } else {
      MODULES.push(m);
      changed = true;
    }
  }
  if (changed) notify();
  return changed;
}

/** Au démarrage : applique le CACHE distant (AsyncStorage). Appelé par
 *  DbProvider pendant l'init — les cours distants restent visibles offline. */
export async function initRemoteModules() {
  if (initialized) return;
  initialized = true;
  try {
    const [raw, ver] = await Promise.all([
      persistentStorage.getItem(CACHE_KEY),
      persistentStorage.getItem(VERSION_KEY),
    ]);
    if (ver) remoteVersion = ver;
    if (raw) {
      const modules = JSON.parse(raw);
      if (Array.isArray(modules) && modules.length) {
        const changed = applyRemoteModules(modules);
        if (changed) {
          console.log(`[Content] ${modules.length} module(s) distant(s) restauré(s) depuis le cache`);
        }
      }
    }
  } catch (_) {}
}

/** Interroge le serveur pour le catalogue de cours. Ne fait rien si la
 *  version est inchangée. Retourne true si de nouveaux cours ont été
 *  téléchargés. Appelé par le SyncEngine (démarrage / reconnexion / 1er plan). */
export async function refreshRemoteModules() {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(`${ENV.API_BASE}/api/content/modules`, {
      headers: { 'X-Client': 'edukraft-content' },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) return false;
    const json = await resp.json();
    if (!json?.success || !Array.isArray(json?.data?.modules)) return false;

    const version = String(json.data.version || Date.now());
    if (version === remoteVersion) return false; // catalogue inchangé
    remoteVersion = version;

    const raws = json.data.modules;
    // 1. Persister le cache AVANT de l'appliquer (offline-first)
    await persistentStorage.setItem(CACHE_KEY, JSON.stringify(raws));
    await persistentStorage.setItem(VERSION_KEY, version);
    // 2. Appliquer au registre vivant
    const changed = applyRemoteModules(raws);
    if (changed) {
      console.log(`[Content] Catalogue distant v${version} : ${raws.length} module(s), registre mis à jour`);
    }
    return changed;
  } catch (_) {
    return false; // hors ligne / serveur endormi : le cache local reste en place
  }
}

/** Version courante du catalogue distant (debug). */
export function getRemoteVersion() {
  return remoteVersion;
}

// ── Fonctions utilitaires ────────────────────────────────────────────────

export function getModuleById(moduleId) {
  return MODULES.find(m => m.id === moduleId);
}

/** Récupère une leçon par moduleId et index */
export function getLessonById(moduleId, lessonIndex) {
  const module = getModuleById(moduleId);
  return module?.lessons?.[lessonIndex] ?? null;
}

/** Récupère le quiz d'une leçon */
export function getQuizForLesson(moduleId, lessonIndex) {
  const lesson = getLessonById(moduleId, lessonIndex);
  return lesson?.quiz ?? null;
}

/** Calcule le XP total de tous les modules */
export function getTotalXP() {
  return MODULES.reduce((sum, m) => sum + m.xp, 0);
}

/** Calcule la durée totale de tous les modules */
export function getTotalDuration() {
  return MODULES.reduce((sum, m) => sum + m.duration, 0);
}

/** Nombre total de leçons */
export function getTotalLessons() {
  return MODULES.reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
}
