// src/theme/fontCaps.js
// Plafonds de scaling de police — résilience « grande police système ».
//
// Bug utilisateur : « Disposition des données cassée surtout dans les blocs
// des modules quand la police système du téléphone est grande ». L'app
// n'avait AUCUN usage de maxFontSizeMultiplier/allowFontScaling : chaque
// Text suivait le fontScale système sans limite et cassait les grilles
// denses (blocs modules, stats, chips, pills, headers).
//
// Stratégie : PAS de Text.defaultProps global — props explicites par
// composant :
//   - UI dense (chips, pills, stats, headers, boutons) → tight + numberOfLines
//     1-2 + ellipsizeMode="tail" (tronque proprement en « … ») ;
//   - contenu de lecture (corps de leçon) → reading sans troncature, avec
//     des lineHeight qui suivent le plafond via scaledLineHeight ;
//   - question de quiz → 1.75 (compromis lisibilité/hauteur).
//
// À l'échelle 1 le design par défaut est strictement préservé.

import { PixelRatio, Platform } from 'react-native';

export const FONT_CAPS = {
  tight:  1.25,  // UI dense : chips, pills, stats, headers, boutons
  normal: 1.4,   // texte secondaire — compatible lineHeight 22 (14×1.4 = 19.6 ≤ 22)
  reading: 2,    // contenu de lecture (corps de leçon) — accessibilité max
};

// Multiplie un lineHeight fixe par le fontScale système PLAFONNÉ à `cap`.
// Sans ça, un Text dont la police grossit au-delà de son lineHeight fixe
// fait des lignes rognées (le texte dépasse du cadre). Web exclu (le zoom
// du navigateur gère déjà la mise en page), fontScale clampé ≥ 1, arrondi
// au pixel : à l'échelle 1, base est renvoyé tel quel (22 → 22).
export function scaledLineHeight(base, cap = FONT_CAPS.reading) {
  if (Platform.OS === 'web') return base;
  const scale = Math.max(1, PixelRatio.getFontScale());
  return Math.round(base * Math.min(scale, cap));
}
