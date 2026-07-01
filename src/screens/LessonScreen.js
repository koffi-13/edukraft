// src/screens/LessonScreen.js
// Lecteur de leçon complet — rend le contenu JSON riche
// Sections révélées progressivement : l'apprenant lit l'intro, puis
// chaque section apparaît une par une après un bouton "Continuer".
// Cette approche améliore la concentration et la rétention.
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb } from '../database/DbProvider';
import { getModuleById, getLessonById } from '../content/moduleRegistry';
import { t } from '../i18n';
import feedback from '../services/feedbackService';

export default function LessonScreen({ route, navigation }) {
  const { moduleId, lessonIndex: li } = route.params || {};
  const insets = useSafeAreaInsets();
  const { learner, updateProgress } = useDb();

  // Sections révélées progressivement (0 = intro visible, 1 = section 1, etc.)
  const [visibleSections, setVisibleSections] = useState(0);

  // Reset quand on change de leçon
  useEffect(() => {
    setVisibleSections(0);
  }, [moduleId, lessonIndex]);

  
  const lessonIndex = typeof li === 'number' ? li : 0;
  const module = getModuleById(moduleId);
  const lesson = getLessonById(moduleId, lessonIndex);
  const totalLessons = module?.lessons?.length || 0;
  const isFirst = lessonIndex === 0;
  const isLast  = lessonIndex >= totalLessons - 1;

  // Marquer la progression au chargement
  useEffect(() => {
    if (module && learner) {
      updateProgress(module.id, {
        status: 'in_progress',
        current_lesson: lessonIndex,
      }).catch(e => console.warn('[Lesson] Progress update:', e));
    }
  }, [module?.id, lessonIndex, learner, updateProgress]);

  const goNextLesson = () => {
    if (isLast) {
      // Toutes les leçons terminées → quiz ou retour
      navigation.navigate('Quiz', { moduleId, lessonIndex });
    } else {
      navigation.replace('Lesson', { moduleId, lessonIndex: lessonIndex + 1 });
    }
  };

  const goPrevLesson = () => {
    if (!isFirst) {
      navigation.replace('Lesson', { moduleId, lessonIndex: lessonIndex - 1 });
    }
  };

  // ── Pas de leçon trouvée ───────────────────────────────────────────────
  if (!module || !lesson) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>{t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('lesson.no_lesson')}</Text>
        </View>
        <View style={styles.emptyContent}>
          <Text style={styles.emptyText}>{t('lesson.no_lesson')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const content = lesson.content || {};
  const sections = content.sections || [];
  const progress = ((lessonIndex + 1) / totalLessons) * 100;

  return (
    <View style={styles.container}>
      {/* Header fixe */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{module.title}</Text>
          <Text style={styles.headerSub}>{t('lesson.question_of', { current: lessonIndex + 1, total: totalLessons })}</Text>
        </View>
        <Text style={styles.xpChip}>+{lesson.xp_per_lesson} XP</Text>
      </View>

      {/* Progress bar fine */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: module.color || Colors.primary }]} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Titre de la leçon */}
        <View style={styles.lessonHeader}>
          <Text style={styles.lessonTitle}>{lesson.title}</Text>
          {lesson.subtitle && (
            <Text style={styles.lessonSubtitle}>{lesson.subtitle}</Text>
          )}
          <Text style={styles.durationText}>⏱ {lesson.duration_min} {t('lesson.read_time')}</Text>
        </View>

        {/* Introduction */}
        {content.intro && (
          <View style={styles.introBlock}>
            <Text style={styles.introLabel}>{t('lesson.intro')}</Text>
            <Text style={styles.introText}>{content.intro}</Text>
          </View>
        )}

        {/* Sections — révélées progressivement */}
        {sections.map((section, idx) => {
          if (idx >= visibleSections) return null;  // section pas encore révélée
          return (
            <View
              key={idx}
              style={[
                styles.sectionCard,
                section.highlight ? styles.sectionHighlight : null,
              ]}
            >
              <Text style={styles.sectionHeading}>{section.heading}</Text>
              <Text style={styles.sectionBody}>{section.body}</Text>
            </View>
          );
        })}

        {/* Bouton "Continuer la lecture" pour révéler la section suivante */}
        {visibleSections < sections.length && (
          <TouchableOpacity
            style={styles.continueReadingBtn}
            onPress={() => {
              setVisibleSections(visibleSections + 1);
              feedback.light();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.continueReadingText}>
              {visibleSections === 0 ? '📖 Commencer la lecture' : '👇 Continuer'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Key takeaway — visible uniquement quand toutes les sections sont lues */}
        {content.key_takeaway && visibleSections >= sections.length && (
          <View style={[styles.takeawayCard, Shadow.card]}>
            <Text style={styles.takeawayLabel}>💡 {t('lesson.key_takeaway')}</Text>
            <Text style={styles.takeawayText}>{content.key_takeaway}</Text>
          </View>
        )}

        {/* Spacer pour le footer */}
        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Footer fixe */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        {!isFirst && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={goPrevLesson}>
            <Text style={styles.secondaryBtnText}>← {t('lesson.prev_lesson')}</Text>
          </TouchableOpacity>
        )}

        {visibleSections >= sections.length ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: module.color || Colors.primary }]}
            onPress={goNextLesson}
          >
            <Text style={styles.primaryBtnText}>
              {isLast ? t('lesson.start_quiz') : t('common.next')}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.readHint}>📖 Lis toutes les sections pour continuer</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backText: {
    color: Colors.primary,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.ink60,
    textTransform: 'uppercase',
  },
  headerSub: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
  },
  xpChip: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.xpGold,
    backgroundColor: Colors.xpGold + '18',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: 3,
  },
  scroll: {
    flex: 1,
  },
  lessonHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  lessonTitle: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  lessonSubtitle: {
    fontSize: Typography.bodyLg,
    color: Colors.ink60,
    marginBottom: Spacing.sm,
  },
  durationText: {
    fontSize: Typography.caption,
    color: Colors.ink30,
  },

  // Intro
  introBlock: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.lg,
  },
  introLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.primary,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
    letterSpacing: 0.5,
  },
  introText: {
    fontSize: Typography.bodyLg,
    color: Colors.ink,
    lineHeight: 22,
  },

  // Sections
  sectionCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHighlight: {
    backgroundColor: Colors.tealLight,
    borderColor: Colors.teal + '40',
    borderLeftWidth: 4,
    borderLeftColor: Colors.teal,
  },
  sectionHeading: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.sm,
  },
  sectionBody: {
    fontSize: Typography.body,
    color: Colors.ink60,
    lineHeight: 22,
  },

  // Takeaway
  takeawayCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.xpGold + '12',
    borderRadius: Radius.md,
    borderLeftWidth: 4,
    borderLeftColor: Colors.xpGold,
  },
  takeawayLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.xpGold,
    marginBottom: Spacing.xs,
  },
  takeawayText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    lineHeight: 22,
  },

  // Bouton "Continuer la lecture"
  continueReadingBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  continueReadingText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  readHint: {
    fontSize: Typography.caption,
    color: Colors.ink30,
    fontStyle: 'italic',
    flex: 1,
    textAlign: 'center',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    ...Shadow.button,
  },
  primaryBtnText: {
    color: Colors.surface,
    fontSize: Typography.body,
    fontWeight: Typography.bold,
  },
  secondaryBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },

  // Empty state
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyText: {
    fontSize: Typography.bodyLg,
    color: Colors.ink50,
    marginBottom: Spacing.lg,
  },
});