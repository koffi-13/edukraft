// src/services/feedbackService.js
// Service de feedback haptique (vibration) pour les interactions clés.
//
// Utilise Vibration de react-native (API native, zéro dépendance externe).
// Sur web : désactivé (pas d'API vibration).
// Sur iOS : Vibration.vibrate() ne supporte pas les patterns complexes,
//   on utilise donc des vibrations simples.
//
// API publique :
//   feedback.success()       — vibration légère (quiz réponse correcte)
//   feedback.error()         — vibration forte (mauvaise réponse)
//   feedback.warning()       — vibration moyenne (avertissement)
//   feedback.completion()    — pattern de célébration (module terminé)
//   feedback.streak()        — pattern streak (jour consécutif)
//   feedback.achievement()   — pattern succès débloqué
//   feedback.light()         — tap léger (feedback bouton)

import { Platform, Vibration } from 'react-native';

const enabled = Platform.OS !== 'web';

// Patterns de vibration (Android : [vibre, pause, vibre, pause...])
// iOS ignore le pattern et vibre juste la durée du premier élément.
const PATTERNS = {
  light: [50],
  success: [100],
  error: [200, 100, 200],
  warning: [150, 50, 150],
  completion: [80, 60, 80, 60, 120],
  streak: [60, 40, 60, 40, 60],
  achievement: [100, 80, 150],
};

function vibrate(pattern) {
  if (!enabled) return;
  try {
    Vibration.vibrate(pattern);
  } catch (_) {}
}

export const feedback = {
  /** Tap léger — feedback bouton générique */
  light() { vibrate(PATTERNS.light); },

  /** Réussite — quiz réponse correcte */
  success() { vibrate(PATTERNS.success); },

  /** Erreur — quiz mauvaise réponse */
  error() { vibrate(PATTERNS.error); },

  /** Avertissement — quiz échoué */
  warning() { vibrate(PATTERNS.warning); },

  /** Célébration — module terminé */
  completion() { vibrate(PATTERNS.completion); },

  /** Streak — jour consécutif (pattern feu qui crépite) */
  streak() { vibrate(PATTERNS.streak); },

  /** Succès débloqué — achievement */
  achievement() { vibrate(PATTERNS.achievement); },
};

export default feedback;
