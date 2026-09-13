// src/components/SpeakButton.js
// Lecture vocale (TTS) d'un texte de leçon — accessibilité malvoyants,
// dyslexiques, et apprentissage audio.
//
// Pill compacte « 🔊 Écouter » / « ⏹ Arrêter » placée à côté des titres de
// section et de l'intro (LessonScreen). La voix est française (fr-FR) à un
// rythme légèrement ralenti (0.95) pour la compréhension.
//
// Robustesse :
//   - require expo-speech PROTÉGÉ (même pattern que ImagePicker dans
//     EditProfileScreen) : un module natif manquant ne crashe pas l'app ;
//   - WEB : rend null (l'API SpeechSynthesis du navigateur n'est pas
//     exposée ici — pas de bouton mort) ;
//   - mountedRef : aucun setState après démontage (callbacks natifs tardifs) ;
//   - Speech.stop() au démontage ET au changement de texte (la lecture en
//     cours ne correspond plus au contenu affiché).

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';

import { Colors, Typography, Spacing, Radius } from '../theme';
import { FONT_CAPS } from '../theme/fontCaps';

// Import dynamique protégé — le module natif peut manquer (build allégé,
// environnement de test) : le bouton disparaît proprement.
let Speech = null;
try { Speech = require('expo-speech'); } catch (_) {}

export default function SpeakButton({ text }) {
  const [speaking, setSpeaking] = useState(false);
  const mountedRef = useRef(true);

  // Démontage : plus aucun setState (callbacks natifs tardifs) + on coupe la voix.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { if (Speech) Speech.stop(); } catch (_) {}
    };
  }, []);

  // Changement de texte (l'utilisateur révèle une autre section) : la lecture
  // en cours est arrêtée — elle ne correspond plus au contenu affiché.
  useEffect(() => {
    return () => {
      try { if (Speech) Speech.stop(); } catch (_) {}
    };
  }, [text]);

  const handlePress = useCallback(() => {
    if (!Speech || !text) return;
    if (speaking) {
      Speech.stop(); // onStopped fera retomber l'état
      return;
    }
    setSpeaking(true);
    Speech.speak(text, {
      language: 'fr-FR',
      rate: 0.95,
      onDone:    () => { if (mountedRef.current) setSpeaking(false); },
      onStopped: () => { if (mountedRef.current) setSpeaking(false); },
      onError:   () => { if (mountedRef.current) setSpeaking(false); },
    });
  }, [speaking, text]);

  // Web : pas de TTS exposé → pas de bouton.
  if (Platform.OS === 'web') return null;
  // Module natif absent ou rien à lire → pas de bouton.
  if (!Speech || !text) return null;

  return (
    <TouchableOpacity
      style={[styles.pill, speaking && styles.pillActive]}
      onPress={handlePress}
      activeOpacity={0.8}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={speaking ? 'Arrêter la lecture vocale' : 'Écouter le texte à voix haute'}
    >
      <Text style={styles.icon} maxFontSizeMultiplier={FONT_CAPS.tight}>
        {speaking ? '⏹' : '🔊'}
      </Text>
      <Text
        style={[styles.label, speaking && styles.labelActive]}
        numberOfLines={1}
        maxFontSizeMultiplier={FONT_CAPS.tight}
      >
        {speaking ? 'Arrêter' : 'Écouter'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,                                   // cible tactile confortable
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    flexShrink: 0,                                   // ne jamais écraser le titre
  },
  pillActive: {
    backgroundColor: Colors.coralLight,
    borderColor: Colors.coral + '40',
  },
  icon: {
    fontSize: Typography.caption,
  },
  label: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  labelActive: {
    color: Colors.coral,
  },
});
