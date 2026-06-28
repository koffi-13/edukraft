// src/screens/DashboardScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb }              from '../database/DbProvider';
import { MODULES, getTotalXP, getTotalDuration } from '../content/moduleRegistry';
import XPBar                  from '../components/XPBar';
import OfflineIndicator       from '../components/OfflineIndicator';
import { t }                  from '../i18n';

export default function DashboardScreen({ navigation }) {
  const insets          = useSafeAreaInsets();
  const { learner, getAllProgress } = useDb();
  const [allProgress, setAllProgress] = useState([]);
  const [refreshing, setRefreshing]   = useState(false);

  const load = useCallback(async () => {
    try {
      const prog = await getAllProgress();
      setAllProgress(prog || []);
    } catch (error) {
      console.error('Erreur chargement progression:', error);
      setAllProgress([]);
    }
  }, [getAllProgress]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return t('dashboard.greeting_morning');
    if (h < 18) return t('dashboard.greeting_afternoon');
    return t('dashboard.greeting_evening');
  };

  const getModuleProgress = (moduleId) =>
    allProgress.find(p => p.module_id === moduleId);

  const completedCount = allProgress.filter(p => p.status === 'completed').length;
  const { current } = getLevel(learner?.total_xp ?? 0);

  return (
    <View style={styles.root}>
      <OfflineIndicator />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>{greeting()}, {learner?.name?.split(' ')[0]} 👋</Text>
          <Text style={styles.levelChip}>{current.label} · {t('dashboard.level_label')} {current.level}</Text>
        </View>
        <View style={styles.streakBadge}>
          <Text style={styles.streakEmoji}>🔥</Text>
          <Text style={styles.streakNum}>{learner?.streak_days ?? 0}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* XP Card */}
        <View style={[styles.xpCard, Shadow.card]}>
          <XPBar xp={learner?.total_xp ?? 0} />
          <View style={styles.statsRow}>
            <StatBox value={completedCount} label={t('dashboard.completed')} color={Colors.teal} />
            <StatBox value={allProgress.filter(p => p.status === 'in_progress').length} label={t('dashboard.in_progress')} color={Colors.amber} />
            <StatBox value={learner?.streak_days ?? 0} label={t('dashboard.streak_label')} color={Colors.coral} />
          </View>
        </View>

        {/* Modules */}
        <Text style={styles.sectionTitle}>{t('dashboard.modules_available')}</Text>

        {MODULES.map(module => {
          const prog   = getModuleProgress(module.id);
          const status = prog?.status ?? 'not_started';
          const totalLessons = module.lessons?.length || 1;
          const pct    = prog ? (prog.lessons_done / totalLessons) : 0;

          return (
            <TouchableOpacity
              key={module.id}
              style={[styles.moduleCard, Shadow.card]}
              onPress={() => navigation.navigate('Lesson', {
                moduleId: module.id,
                lessonIndex: status === 'not_started' ? 0 : (prog?.current_lesson ?? 0),
              })}
              activeOpacity={0.88}
            >
              {/* Color band */}
              <View style={[styles.moduleColorBand, { backgroundColor: module.color || Colors.primary }]} />

              <View style={styles.moduleBody}>
                <View style={styles.moduleTop}>
                  <View style={styles.moduleMeta}>
                    <Text style={styles.moduleFiliere}>{module.filiere}</Text>
                    <Text style={styles.moduleTitle}>{module.title}</Text>
                    <Text style={styles.moduleSubtitle}>{module.subtitle}</Text>
                  </View>
                  <StatusChip status={status} />
                </View>

                {/* Stats */}
                <View style={styles.moduleStats}>
                  <Text style={styles.statText}>
                    📚 {totalLessons} {t('module.lessons_count', { count: totalLessons })}
                  </Text>
                  <Text style={styles.statText}>
                    ⏱ {module.duration} {t('lesson.read_time')}
                  </Text>
                  <Text style={styles.statText}>
                    ⭐ {module.xp} XP
                  </Text>
                </View>

                {/* Progress bar */}
                {status === 'in_progress' && (
                  <View style={styles.progressWrap}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, {
                        width: `${Math.round(pct * 100)}%`,
                        backgroundColor: module.color || Colors.primary,
                      }]} />
                    </View>
                    <Text style={styles.progressLabel}>
                      {prog.lessons_done}/{totalLessons} {t('dashboard.lessons_done')}
                    </Text>
                  </View>
                )}

                {/* CTA */}
                <View style={[styles.cta, { backgroundColor: (module.color || Colors.primary) + '18' }]}>
                  <Text style={[styles.ctaText, { color: module.color || Colors.primary }]}>
                    {status === 'not_started' ? t('module.start')
                      : status === 'completed' ? '✓ ' + t('module.completed')
                      : t('module.resume')} →
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function StatBox({ value, label, color }) {
  return (
    <View style={statStyles.box}>
      <Text style={[statStyles.val, { color }]}>{value}</Text>
      <Text style={statStyles.lbl}>{label}</Text>
    </View>
  );
}

function StatusChip({ status }) {
  const map = {
    completed:   { label: '✓',         bg: Colors.tealLight,    text: Colors.teal   },
    in_progress: { label: 'En cours',  bg: Colors.amberLight,   text: Colors.amber  },
    not_started: { label: 'Nouveau',   bg: Colors.primaryLight, text: Colors.primary },
  };
  const s = map[status] ?? map.not_started;
  return (
    <View style={[chipStyles.chip, { backgroundColor: s.bg }]}>
      <Text style={[chipStyles.text, { color: s.text }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.surfaceAlt },
  header:  {
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.lg,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  greeting:   { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.ink },
  levelChip:  { fontSize: Typography.caption, color: Colors.ink60, marginTop: 2 },
  streakBadge: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface + '22',
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:    Radius.full,
    gap: 4,
  },
  streakEmoji: { fontSize: 16 },
  streakNum:   { fontSize: Typography.body, fontWeight: Typography.bold, color: Colors.ink },
  scroll: {
    flex:                 1,
    backgroundColor:      Colors.surfaceAlt,
  },
  content:      { padding: Spacing.lg, gap: Spacing.md },
  xpCard: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    gap:             Spacing.md,
  },
  statsRow:     { flexDirection: 'row', gap: Spacing.sm },
  sectionTitle: {
    fontSize:   Typography.h3,
    fontWeight: Typography.bold,
    color:      Colors.ink,
    marginTop:  Spacing.sm,
  },
  moduleCard: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    overflow:        'hidden',
    flexDirection:   'row',
  },
  moduleColorBand: { width: 6 },
  moduleBody:      { flex: 1, padding: Spacing.md, gap: Spacing.sm },
  moduleTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  moduleMeta:      { flex: 1 },
  moduleFiliere:   {
    fontSize:   Typography.tiny,
    color:      Colors.ink30,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  moduleTitle: {
    fontSize:   Typography.h3,
    fontWeight: Typography.bold,
    color:      Colors.ink,
  },
  moduleSubtitle: {
    fontSize: Typography.caption,
    color:    Colors.ink60,
    marginTop: 2,
  },
  moduleStats: { flexDirection: 'row', gap: Spacing.md },
  statText:    { fontSize: Typography.caption, color: Colors.ink60 },
  progressWrap: { gap: 4 },
  progressTrack: {
    height:          4,
    backgroundColor: Colors.border,
    borderRadius:    Radius.full,
    overflow:        'hidden',
  },
  progressFill: { height: 4, borderRadius: Radius.full },
  progressLabel: { fontSize: Typography.tiny, color: Colors.ink60 },
  cta: {
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  ctaText: { fontSize: Typography.caption, fontWeight: Typography.bold },
});

const statStyles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', gap: 2 },
  val: { fontSize: Typography.h2, fontWeight: Typography.bold },
  lbl: { fontSize: Typography.tiny, color: Colors.ink60, textAlign: 'center' },
});

const chipStyles = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  text: { fontSize: Typography.tiny, fontWeight: Typography.bold },
});