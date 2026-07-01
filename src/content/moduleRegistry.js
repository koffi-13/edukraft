// src/content/moduleRegistry.js
// Registry des modules de formation EduKraft
// Charge les fichiers JSON riches et les expose en structure plate pour le Dashboard

import marketingDigital from './modules/marketing_digital_local.json';
import comptabiliteArtisanale from './modules/comptabilite_artisanale.json';
import ecommerceWhatsapp from './modules/ecommerce_whatsapp_business.json';
import logistiqueTransit from './modules/logistique_transit_douane.json';
import comptabiliteOhada from './modules/comptabilite_pme_ohada.json';
import transformationAgro from './modules/transformation_agroalimentaire.json';
import communityManager from './modules/community_manager.json';
import agentMobileMoney from './modules/agent_mobile_money.json';

// ── Transformation JSON riche > structure plate compatible Dashboard ─────
function normalizeModule(json) {
  return {
    // Champs plate (utilisés par le Dashboard)
    id:          json.id,
    title:       json.meta.title,
    subtitle:    json.meta.subtitle,
    description: json.meta.description,
    duration:    json.meta.duration_min,
    xp:          json.meta.xp_reward,
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
  };
}

// ── Registre principal ───────────────────────────────────────────────────
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