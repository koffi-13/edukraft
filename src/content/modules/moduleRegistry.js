// src/content/moduleRegistry.js
// Registre des modules EduKraft
// Pour ajouter un nouveau module : importer le JSON et l'ajouter à MODULES[]
// Aucune modification de code ailleurs requise.

import marketingDigital       from './modules/marketing_digital_local.json';
import comptabiliteArtisanale from './modules/comptabilite_artisanale.json';
// import soudureMIG         from './modules/soudure_mig.json';
// import hygienePastry      from './modules/hygiene_alimentaire.json';

export const MODULES = [
  marketingDigital,
  comptabiliteArtisanale,
  // soudureMIG,
  // hygienePastry,
];

/** Récupère un module par son ID */
export function getModuleById(id) {
  return MODULES.find(m => m.id === id) ?? null;
}

/** Liste des modules d'une filière */
export function getModulesByFiliere(filiere) {
  return MODULES.filter(m => m.filiere === filiere);
}

/** Calcul du XP total d'un module */
export function getTotalXP(module) {
  return module.lessons.reduce((sum, l) => sum + l.xp_per_lesson, 0)
    + (module.completion_criteria?.xp_completion_bonus ?? 0);
}

/** Durée totale en minutes */
export function getTotalDuration(module) {
  return module.lessons.reduce((sum, l) => sum + l.duration_min, 0);
}
