// src/components/DailyGoalRing.js
// Anneau de progression de l'objectif quotidien.
//
// Design éducatif :
//   - L'objectif est défini par l'apprenant (autonomie), pas imposé.
//   - L'anneau se remplit discrètement ; quand l'objectif est atteint, un
//     discret "✓" apparaît — pas de fanfare, juste une satisfaction calme.
//   - Si l'objectif n'est pas activé, on propose de le définir (lien vers
//     AchievementsScreen où se trouve le sélecteur).
//
// v1.1.6 (correctif « l'anneau ne réagit pas à la progression ») :
//   L'ancien rendu utilisait un hack View + borderTop/RightColor tourné de
//   progress×360° : seul un QUART d'arc était coloré, quelle que soit la
//   progression — l'anneau tournait sans jamais se remplir (et
//   animatedDashOffset était calculé mais jamais utilisé). Remplacé par un
//   vrai anneau SVG (react-native-svg — déjà utilisé pour les QR badges)
//   avec strokeDasharray/strokeDashoffset animés : l'arc se remplit de 0 %
//   à 100 % proportionnellement à la progression réelle du jour, sur web
//   comme sur mobile.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';

const AnimatedCircle = Animated.createAnimatedComponent(SvgCircle);

export default function DailyGoalRing({ goal, todayValue, onPress }) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progress = goal && goal.target > 0
    ? Math.min(1, (todayValue || 0) / goal.target)
    : 0;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 600,
      // Pas de useNativeDriver : les attributs SVG (strokeDashoffset) ne
      // sont pas supportés par le driver natif.
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const goalMet = progress >= 1;
  const size = 72;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Pas d'objectif défini
  if (!goal || !goal.enabled) {
    return (
      <TouchableOpacity
        style={[styles.card, styles.emptyCard, Shadow.card]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <View style={styles.emptyContent}>
          {/* v1.1.3 : icône d'origine restaurée */}
          <Text style={styles.emptyIcon}>🎯</Text>
          <View style={styles.emptyText}>
            <Text style={styles.emptyTitle}>{t('gamification.set_goal_title')}</Text>
            <Text style={styles.emptyDesc}>{t('gamification.set_goal_desc')}</Text>
          </View>
          <Text style={styles.emptyArrow}>›</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const label = goal.type === 'lessons'
    ? t('gamification.goal_lessons', { target: goal.target })
    : t('gamification.goal_xp', { target: goal.target });

  return (
    <TouchableOpacity
      style={[styles.card, Shadow.card, goalMet && styles.cardMet]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={!onPress}
    >
      <View style={styles.row}>
        {/* Anneau SVG — l'arc se remplit proportionnellement à la progression */}
        <View style={[styles.ringWrap, { width: size, height: size }]}>
          <Svg width={size} height={size} style={styles.ringSvg}>
            {/* Piste de fond */}
            <SvgCircle
              cx={center}
              cy={center}
              r={radius}
              stroke={Colors.border}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {/* Arc de progression (départ à 12 h, sens horaire) */}
            <AnimatedCircle
              cx={center}
              cy={center}
              r={radius}
              stroke={goalMet ? Colors.teal : Colors.primary}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [circumference, 0],
              })}
              transform={`rotate(-90 ${center} ${center})`}
            />
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringValue}>{todayValue || 0}</Text>
            <Text style={styles.ringUnit}>/ {goal.target}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.status}>
            {goalMet
              ? t('gamification.goal_met')
              : t('gamification.goal_remaining', {
                  remaining: Math.max(0, goal.target - (todayValue || 0)),
                })}
          </Text>
          {goalMet && <Text style={styles.check}>✓</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cardMet: {
    borderWidth: 1.5,
    borderColor: Colors.teal,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ringWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  ringCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  ringUnit: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
  },
  info: { flex: 1, flexShrink: 1, gap: 2 },
  label: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  status: {
    fontSize: Typography.caption,
    color: Colors.ink60,
  },
  check: {
    fontSize: Typography.h3,
    color: Colors.teal,
    fontWeight: Typography.bold,
    marginTop: 4,
  },
  // Empty state
  emptyCard: { padding: Spacing.md },
  emptyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyIcon: { fontSize: 28 },
  emptyText: { flex: 1 },
  emptyTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  emptyDesc: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: 2,
  },
  emptyArrow: {
    fontSize: 24,
    color: Colors.ink30,
    fontWeight: '300',
  },
});
