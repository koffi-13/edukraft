// src/components/StreakWidget.js
// Affiche le streak (série de jours) + gels disponibles.
//
// Design éducatif :
//   - La flamme grandit avec le streak, mais sans effet clinquant.
//   - Les gels (freezes) sont montrés comme une "grâce" disponible, pas comme
//     une ressource à thésauriser — l'apprenant sait qu'il est pardonné.
//   - Pas de message culpabilisant si streak = 0 ou cassé : on encourage juste
//     à "reprendre aujourd'hui".

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';
import { MAX_FREEZES } from '../gamification';

export default function StreakWidget({ streak, freezes = MAX_FREEZES, bestStreak = 0, compact = false }) {
  // Animation : la flamme pulse si streak > 0 (feu qui crépite)
  const flameAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (streak > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(flameAnim, { toValue: 1.15, duration: 600, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(flameAnim, { toValue: 0.95, duration: 400, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(flameAnim, { toValue: 1.1, duration: 500, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(flameAnim, { toValue: 1, duration: 700, easing: Easing.ease, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [streak]);

  if (compact) {
    return (
      <View style={styles.compact}>
        {/* v1.1.3 : icône d'origine restaurée */}
        <Animated.Text style={[styles.flameCompact, { transform: [{ scale: flameAnim }] }]}>🔥</Animated.Text>
        <Text style={styles.streakNumCompact}>{streak}</Text>
        {freezes > 0 && (
          <Text style={styles.freezeCompact}>❄{freezes}</Text>
        )}
      </View>
    );
  }

  const flameSize = streak >= 30 ? 40 : streak >= 7 ? 34 : streak >= 3 ? 30 : 26;

  return (
    <View style={[styles.card, Shadow.card]}>
      <View style={styles.header}>
        {/* v1.1.3 : icône d'origine restaurée */}
        <Animated.Text style={[styles.flame, { fontSize: flameSize, transform: [{ scale: flameAnim }] }]}>🔥</Animated.Text>
        <View style={styles.info}>
          <Text style={styles.streakNum}>{streak}</Text>
          <Text style={styles.streakLabel}>
            {streak <= 1 ? t('gamification.day_singular') : t('gamification.day_plural')}
          </Text>
        </View>
      </View>

      {/* Gels */}
      <View style={styles.freezesRow}>
        <Text style={styles.freezesLabel}>{t('gamification.freezes_label')}</Text>
        <View style={styles.freezesDots}>
          {Array.from({ length: MAX_FREEZES }).map((_, i) => (
            <View
              key={i}
              style={[styles.freezeDot, i < freezes && styles.freezeDotActive]}
            >
              <Text style={[styles.freezeDotText, i < freezes && styles.freezeDotTextActive]}>❄</Text>
            </View>
          ))}
        </View>
      </View>

      {bestStreak > streak && bestStreak > 0 && (
        <Text style={styles.bestStreak}>
          {t('gamification.best_streak', { count: bestStreak })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  flame: { lineHeight: 44 },
  info: { flex: 1 },
  streakNum: {
    fontSize: Typography.display,
    fontWeight: Typography.bold,
    color: Colors.coral,
  },
  streakLabel: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: -2,
  },
  freezesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  freezesLabel: {
    fontSize: Typography.tiny,
    color: Colors.ink60,
  },
  freezesDots: {
    flexDirection: 'row',
    gap: 4,
  },
  freezeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  freezeDotActive: {
    borderColor: Colors.teal,
    backgroundColor: Colors.tealLight,
  },
  freezeDotText: {
    fontSize: 11,
    opacity: 0.3,
  },
  freezeDotTextActive: {
    opacity: 1,
  },
  bestStreak: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    textAlign: 'center',
  },
  // Compact (header)
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface + '22',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  flameCompact: { fontSize: 16 },
  streakNumCompact: { fontSize: Typography.body, fontWeight: Typography.bold, color: Colors.ink },
  freezeCompact: { fontSize: Typography.tiny, color: Colors.teal, marginLeft: 2 },
});
