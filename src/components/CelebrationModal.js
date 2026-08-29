// src/components/CelebrationModal.js
// Modal de célébration post-quiz — discret, orienté maîtrise.
//
// Design éducatif (anti-addictif) :
//   - Une seule célébration par événement (pas de cascade de pop-ups).
//   - Le contenu met en avant la MAÎTRISE (score, XP, streak) et les NOUVEAUX
//     succès, pas des récompenses aléatoires.
//   - Durée courte, dismissable, jamais bloquant plus de ~3s.
//   - Texte orienté progrès ("tu progresses", "ta série continue") pas
//     excitation ("INCROYABLE !!!", "JACKPOT").
//   - Pas de bouton "Partager sur les réseaux" (vanité).

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';
import { ACHIEVEMENT_CATEGORIES } from '../gamification';

export default function CelebrationModal({
  visible,
  onClose,
  result,  // { streak, newAchievements, goalMet, score, xp }
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 7, useNativeDriver: true }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible]);

  if (!result) return null;

  const { streak, newAchievements = [], goalMet, score, xp } = result;
  const hasAchievements = newAchievements.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.modal,
            Shadow.card,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* En-tête : maîtrise (pas fanfare) */}
          <Text style={styles.eyebrow}>
            {score !== undefined
              ? t('gamification.celebration_lesson_done')
              : t('gamification.celebration_progress')}
          </Text>

          <Text style={styles.title}>
            {goalMet
              ? t('gamification.celebration_goal_met_title')
              : hasAchievements
                ? t('gamification.celebration_achievement_title')
                : t('gamification.celebration_streak_title')}
          </Text>

          {/* Stats sobres */}
          <View style={styles.statsRow}>
            {xp !== undefined && xp > 0 && (
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: Colors.xpGold }]}>+{xp}</Text>
                <Text style={styles.statLabel}>XP</Text>
              </View>
            )}
            {streak && (
              <View style={styles.statItem}>
                {/* v1.1 : ASCII uniquement */}
                <Text style={[styles.statValue, { color: Colors.coral }]}>{streak.current} j</Text>
                <Text style={styles.statLabel}>{t('gamification.day_plural')}</Text>
              </View>
            )}
            {score !== undefined && (
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: Colors.teal }]}>
                  {Math.round(score * 100)}%
                </Text>
                <Text style={styles.statLabel}>{t('gamification.score_label')}</Text>
              </View>
            )}
          </View>

          {/* Streak cassé — message accueillant (anti-honte) */}
          {streak?.broken && (
            <Text style={styles.brokenMsg}>
              {t('gamification.streak_restarted')}
            </Text>
          )}

          {/* Nouveaux succès */}
          {hasAchievements && (
            <View style={styles.achievementsSection}>
              <Text style={styles.sectionLabel}>
                {t('gamification.new_achievements', { count: newAchievements.length })}
              </Text>
              {newAchievements.map((ach) => {
                const cat = ACHIEVEMENT_CATEGORIES[ach.category] || {};
                return (
                  <View key={ach.key} style={styles.achievementItem}>
                    {/* v1.1 : icône ASCII (les emojis peuvent manquer sur
                        certains appareils) */}
                    <Text style={styles.achievementIcon}>{cat.icon || '[*]'}</Text>
                    <View style={styles.achievementText}>
                      <Text style={styles.achievementTitle}>{ach.title}</Text>
                      <Text style={styles.achievementDesc}>{ach.description}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Objectif atteint */}
          {goalMet && !hasAchievements && (
            <Text style={styles.goalMetMsg}>
              {t('gamification.daily_goal_reached')}
            </Text>
          )}

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.closeBtnText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 26, 46, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modal: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 360,
    gap: Spacing.md,
  },
  eyebrow: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  title: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
  },
  statLabel: {
    fontSize: Typography.tiny,
    color: Colors.ink60,
  },
  brokenMsg: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  achievementsSection: {
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
  },
  sectionLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  achievementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  achievementIcon: { fontSize: 24 },
  achievementText: { flex: 1 },
  achievementTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  achievementDesc: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: 1,
  },
  goalMetMsg: {
    fontSize: Typography.body,
    color: Colors.teal,
    textAlign: 'center',
    fontWeight: Typography.semibold,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  closeBtnText: {
    fontSize: Typography.bodyLg,
    fontWeight: Typography.bold,
    color: Colors.surface,
  },
});
