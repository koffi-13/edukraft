// src/screens/DashboardScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb }              from '../database/DbProvider';
import { MODULES, subscribeModules } from '../content/moduleRegistry';
import XPBar                  from '../components/XPBar';
import OfflineIndicator       from '../components/OfflineIndicator';
import StreakWidget           from '../components/StreakWidget';
import DailyGoalRing          from '../components/DailyGoalRing';
import MasteryCard            from '../components/MasteryCard';
import { t }                  from '../i18n';

export default function DashboardScreen({ navigation }) {
  const insets          = useSafeAreaInsets();
  const { learner, getAllProgress, getGamificationState, getProfileCompletion } = useDb();
  const [allProgress, setAllProgress] = useState([]);
  const [refreshing, setRefreshing]   = useState(false);
  const [gamo, setGamo]               = useState(null);  // état gamification

  const load = useCallback(async () => {
    try {
      const [prog, gState] = await Promise.all([
        getAllProgress(),
        getGamificationState ? getGamificationState() : Promise.resolve(null),
      ]);
      setAllProgress(prog || []);
      if (gState) setGamo(gState);
    } catch (error) {
      console.error('Erreur chargement progression:', error);
      setAllProgress([]);
    }
  }, [getAllProgress, getGamificationState]);

  useEffect(() => { load(); }, [load]);

  // v1.1.7 : réagir au catalogue distant — un nouveau cours téléchargé par
  // le SyncEngine (reconnexion / premier plan) apparaît sans recharger l'app.
  const [, bumpRegistry] = useState(0);
  useEffect(() => subscribeModules(() => bumpRegistry(n => n + 1)), []);

  // Recharger quand le Dashboard revient au premier plan (après un quiz par ex.)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
        {/* Bannière complétion profil */}
        {(() => {
          const completion = getProfileCompletion ? getProfileCompletion() : 0;
          if (completion >= 100) return null;
          return (
            <TouchableOpacity
              style={styles.profileBanner}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.85}
            >
              <View style={styles.profileBannerLeft}>
                <Text style={styles.profileBannerTitle}>Complète ton profil ({completion}%)</Text>
                <Text style={styles.profileBannerSub}>
                  {completion < 50 ? 'Plus d\'infos = meilleurs certificats' : 'Presque fini !'}
                </Text>
                <View style={styles.profileBarTrack}>
                  <View style={[styles.profileBarFill, { width: `${completion}%` }]} />
                </View>
              </View>
              <Text style={styles.profileBannerArrow}>›</Text>
            </TouchableOpacity>
          );
        })()}

        {/* XP Card */}
        <View style={[styles.xpCard, Shadow.card]}>
          <XPBar xp={learner?.total_xp ?? 0} />
          <View style={styles.statsRow}>
            <StatBox value={completedCount} label={t('dashboard.completed')} color={Colors.teal} />
            <StatBox value={allProgress.filter(p => p.status === 'in_progress').length} label={t('dashboard.in_progress')} color={Colors.amber} />
            <StatBox value={learner?.streak_days ?? 0} label={t('dashboard.streak_label')} color={Colors.coral} />
          </View>
        </View>

        {/* Gamification : Objectif quotidien + Streak (côte à côte) */}
        {gamo && (
          <View style={styles.gamoRow}>
            <View style={styles.gamoColLeft}>
              <DailyGoalRing
                goal={gamo.goal}
                todayValue={gamo.goal?.type === 'xp' ? gamo.todayXp : gamo.todayLessons}
                onPress={() => navigation.navigate('Achievements')}
              />
            </View>
            <View style={styles.gamoColRight}>
              <StreakWidget
                streak={gamo.streak}
                freezes={gamo.freezes}
                bestStreak={gamo.bestStreak}
              />
            </View>
          </View>
        )}

        {/* Gamification : Maîtrise par filière */}
        {gamo?.mastery?.length > 0 && (
          <MasteryCard mastery={gamo.mastery} />
        )}

        {/* Lien vers tous les succès */}
        {gamo && (
          <TouchableOpacity
            style={styles.achievementsLink}
            onPress={() => navigation.navigate('Achievements')}
            activeOpacity={0.85}
          >
            <Text style={styles.achievementsLinkIcon}>🏆</Text>
            <View style={styles.achievementsLinkText}>
              <Text style={styles.achievementsLinkTitle}>
                {t('gamification.achievements_link_title')}
              </Text>
              <Text style={styles.achievementsLinkSub}>
                {t('gamification.achievements_link_sub', {
                  unlocked: gamo.achievements.unlocked.length,
                  total: gamo.achievements.total,
                })}
              </Text>
            </View>
            <Text style={styles.achievementsLinkArrow}>›</Text>
          </TouchableOpacity>
        )}

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
              onPress={() => {
                // Cap lessonIndex à lessons.length - 1 (évite "Leçon introuvable"
                // quand current_lesson = lessons.length après completion)
                const totalLessons = module.lessons?.length || 1;
                const rawLesson = status === 'not_started' ? 0 : (prog?.current_lesson ?? 0);
                const lessonIndex = Math.min(rawLesson, totalLessons - 1);
                navigation.navigate('Lesson', { moduleId: module.id, lessonIndex });
              }}
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
                    📚 {t('module.lessons_count', { count: totalLessons })}
                  </Text>
                  <Text style={styles.statText}>
                    ⏱ {module.duration} {t('lesson.read_time')}
                  </Text>
                  {/* v1.1.16 (Fix Issue 3) : XP affichée honnête.
                      Avant, la carte affichait `module.xp` (= Σ base XP sans les
                      bonus « quiz parfait »), mais l'attribution réelle après
                      réussite du module valait Σ(base + bonus_parfait). L'user
                      voyait « 220 XP » et gagnait jusqu'à 280 XP → divergence
                      = Σ bonus parfaits. Désormais :
                      - Module terminé → on affiche le XP réellement attribué
                        (prog.total_xp_earned, cumulatif,bonus inclus).
                      - Module en cours / non commencé → on affiche une plage
                        « base–max » si des bonus existent, sinon juste base. */}
                  {(() => {
                    const baseXP = module.xp;
                    const maxXP = module.maxXP ?? baseXP;
                    const earned = prog?.total_xp_earned;
                    let label;
                    if (status === 'completed' && typeof earned === 'number' && earned > 0) {
                      label = `⭐ ${earned} XP`;
                    } else if (maxXP > baseXP) {
                      label = `⭐ ${baseXP}–${maxXP} XP`;
                    } else {
                      label = `⭐ ${baseXP} XP`;
                    }
                    return <Text style={styles.statText}>{label}</Text>;
                  })()}
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
                      : t('module.resume')} >
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
  // Bannière complétion profil
  profileBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealLight,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.teal,
    gap: Spacing.sm,
  },
  profileBannerLeft: { flex: 1, gap: 4 },
  profileBannerTitle: { fontSize: Typography.body, fontWeight: Typography.bold, color: Colors.tealDark },
  profileBannerSub: { fontSize: Typography.caption, color: Colors.tealDark },
  profileBarTrack: {
    height: 4,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    overflow: 'hidden',
    marginTop: 4,
  },
  profileBarFill: { height: 4, backgroundColor: Colors.teal, borderRadius: Radius.full },
  profileBannerArrow: { fontSize: 24, color: Colors.tealDark, fontWeight: '300' },
  xpCard: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    gap:             Spacing.md,
  },
  // Gamification row (objectif + streak)
  gamoRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  gamoColLeft:   { flex: 1 },
  gamoColRight:  { flex: 1 },
  // Lien Succès
  achievementsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  achievementsLinkIcon: { fontSize: 28 },
  achievementsLinkText: { flex: 1 },
  achievementsLinkTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  achievementsLinkSub: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: 2,
  },
  achievementsLinkArrow: {
    fontSize: 24,
    color: Colors.ink30,
    fontWeight: '300',
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