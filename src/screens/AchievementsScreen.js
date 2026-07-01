// src/screens/AchievementsScreen.js
// Écran Succès + Objectif quotidien.
//
// Affiche :
//   - L'objectif quotidien actuel + un sélecteur (autonomie de l'apprenant)
//   - Tous les succès groupés par catégorie, avec état débloqué/verrouillé
//   - Une section "philosophie" expliquant notre approche (transparence éducative)
//
// Accès : depuis le Dashboard (widget objectif) et le Profile.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, getGamificationState } from '../gamification';
import StreakWidget from '../components/StreakWidget';
import DailyGoalRing from '../components/DailyGoalRing';

const GOAL_PRESETS = [
  { type: 'lessons', target: 1, label: () => t('gamification.preset_1_lesson') },
  { type: 'lessons', target: 2, label: () => t('gamification.preset_2_lessons') },
  { type: 'xp', target: 30, label: () => t('gamification.preset_30_xp') },
  { type: 'xp', target: 60, label: () => t('gamification.preset_60_xp') },
];

export default function AchievementsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { learner, getGamificationState, setDailyGoal, getDailyGoal } = useDb();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await getGamificationState();
      setState(s);
    } catch (e) {
      console.error('[Achievements] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [getGamificationState]);

  useEffect(() => { load(); }, [load]);

  // Recharger quand l'écran revient au premier plan (après un quiz par ex.)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handlePresetSelect = (preset) => {
    Alert.alert(
      t('gamification.goal_confirm_title'),
      t('gamification.goal_confirm_msg', { goal: preset.label() }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.save'),
          onPress: async () => {
            await setDailyGoal(preset.type, preset.target);
            await load();
          },
        },
      ],
    );
  };

  // Grouper les succès par catégorie
  const groupedAchievements = (state?.achievements?.list || ACHIEVEMENTS).reduce((acc, ach) => {
    if (!acc[ach.category]) acc[ach.category] = [];
    acc[ach.category].push(ach);
    return acc;
  }, {});

  if (loading || !state) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Text style={styles.loading}>{t('common.loading')}</Text>
      </View>
    );
  }

  const currentGoal = state.goal;

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('gamification.screen_title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Streak résumé */}
      <View style={styles.section}>
        <StreakWidget
          streak={state.streak}
          freezes={state.freezes}
          bestStreak={state.bestStreak}
        />
      </View>

      {/* Objectif quotidien actuel */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('gamification.daily_goal_section')}</Text>
        <DailyGoalRing
          goal={currentGoal}
          todayValue={currentGoal?.type === 'xp' ? state.todayXp : state.todayLessons}
        />

        {/* Sélecteur d'objectif */}
        <Text style={styles.subsectionTitle}>{t('gamification.choose_goal')}</Text>
        <View style={styles.presetsRow}>
          {GOAL_PRESETS.map((preset, i) => {
            const isActive = currentGoal
              && currentGoal.type === preset.type
              && currentGoal.target === preset.target;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.presetBtn, isActive && styles.presetBtnActive]}
                onPress={() => handlePresetSelect(preset)}
                activeOpacity={0.85}
              >
                <Text style={[styles.presetLabel, isActive && styles.presetLabelActive]}>
                  {preset.label()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.goalHint}>{t('gamification.goal_hint')}</Text>
      </View>

      {/* Succès groupés par catégorie */}
      <View style={styles.section}>
        <View style={styles.achievementsHeader}>
          <Text style={styles.sectionTitle}>{t('gamification.achievements_section')}</Text>
          <Text style={styles.countBadge}>
            {state.achievements.unlocked.length}/{state.achievements.total}
          </Text>
        </View>

        {Object.entries(groupedAchievements).map(([catKey, achs]) => {
          const cat = ACHIEVEMENT_CATEGORIES[catKey] || {};
          return (
            <View key={catKey} style={styles.categoryBlock}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryIcon}>{cat.icon}</Text>
                <Text style={[styles.categoryLabel, { color: cat.color }]}>
                  {t(`gamification.category_${catKey}`) || cat.label}
                </Text>
              </View>
              {achs.map((ach) => (
                <View
                  key={ach.key}
                  style={[styles.achievementCard, !ach.unlocked && styles.achievementLocked]}
                >
                  <View style={[styles.achievementIconWrap, { backgroundColor: (ach.categoryInfo?.color || Colors.primary) + '22' }]}>
                    <Text style={styles.achievementIconText}>
                      {ach.unlocked ? (cat.icon || '🏆') : '🔒'}
                    </Text>
                  </View>
                  <View style={styles.achievementInfo}>
                    <Text style={[styles.achievementTitle, !ach.unlocked && styles.titleLocked]}>
                      {ach.title}
                    </Text>
                    <Text style={styles.achievementDesc}>{ach.description}</Text>
                  </View>
                  {ach.unlocked && <Text style={styles.checkIcon}>✓</Text>}
                </View>
              ))}
            </View>
          );
        })}
      </View>

      {/* Section philosophie (transparence éducative) */}
      <View style={[styles.section, styles.philosophyCard]}>
        <Text style={styles.philosophyTitle}>{t('gamification.philosophy_title')}</Text>
        <Text style={styles.philosophyText}>
          {t('gamification.philosophy_text')}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backText: {
    fontSize: Typography.body,
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  title: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  loading: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: Typography.body,
    color: Colors.ink50,
  },
  section: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  subsectionTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginTop: Spacing.sm,
  },
  // Objectif presets
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  presetBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  presetBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  presetLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.ink60,
  },
  presetLabelActive: {
    color: Colors.primary,
  },
  goalHint: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    marginTop: Spacing.xs,
  },
  // Achievements
  achievementsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countBadge: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  categoryBlock: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  categoryIcon: { fontSize: 18 },
  categoryLabel: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
  },
  achievementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  achievementLocked: {
    opacity: 0.6,
    backgroundColor: Colors.surfaceAlt,
  },
  achievementIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementIconText: { fontSize: 20 },
  achievementInfo: { flex: 1 },
  achievementTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  titleLocked: { color: Colors.ink60 },
  achievementDesc: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    marginTop: 1,
  },
  checkIcon: {
    fontSize: Typography.h3,
    color: Colors.teal,
    fontWeight: Typography.bold,
  },
  // Philosophie
  philosophyCard: {
    backgroundColor: Colors.tealLight,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  philosophyTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.tealDark,
    marginBottom: Spacing.xs,
  },
  philosophyText: {
    fontSize: Typography.caption,
    color: Colors.tealDark,
    lineHeight: 19,
  },
});
