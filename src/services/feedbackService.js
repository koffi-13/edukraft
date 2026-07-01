// src/services/feedbackService.js
// Service de feedback haptique (vibration) + sonore pour les interactions clés.
//
// Utilise expo-haptics (vibration native, disponible sur Expo Go) et
// expo-av (sons — non disponible sur Expo Go SDK 50, désactivé par défaut).
// Sur web : désactivé (pas de vibration/son natif).
//
// API publique :
//   feedback.success()       — vibration légère + son succès (quiz réussi)
//   feedback.error()         — vibration forte + son erreur (mauvaise réponse)
//   feedback.warning()       — vibration moyenne (avertissement)
//   feedback.completion()    — pattern de célébration (module terminé)
//   feedback.streak()        — pattern streak (jour consécutif)
//   feedback.achievement()   — pattern succès débloqué
//   feedback.light()         — tap léger (feedback bouton)

import { Platform } from 'react-native';

let Haptics = null;
try {
  if (Platform.OS !== 'web') {
    Haptics = require('expo-haptics');
  }
} catch (_) {
  Haptics = null;
}

const enabled = !!Haptics && Platform.OS !== 'web';

export const feedback = {
  /** Tap léger — feedback bouton générique */
  light() {
    if (!enabled) return;
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
  },

  /** Réussite — quiz réponse correcte */
  success() {
    if (!enabled) return;
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch (_) {}
  },

  /** Erreur — quiz mauvaise réponse */
  error() {
    if (!enabled) return;
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch (_) {}
  },

  /** Avertissement — quiz échoué */
  warning() {
    if (!enabled) return;
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch (_) {}
  },

  /** Célébration — module terminé */
  completion() {
    if (!enabled) return;
    try {
      // Pattern : 3 vibrations successives croissantes
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 300);
    } catch (_) {}
  },

  /** Streak — jour consécutif (pattern feu qui crépite) */
  streak() {
    if (!enabled) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 100);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 200);
    } catch (_) {}
  },

  /** Succès débloqué — achievement */
  achievement() {
    if (!enabled) return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 200);
    } catch (_) {}
  },
};

export default feedback;
