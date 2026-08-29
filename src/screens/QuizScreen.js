// src/screens/QuizScreen.js
// Moteur de quiz complet — scoring, XP, passage/échec, badge
import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Animated, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb } from '../database/DbProvider';
import { getModuleById, getLessonById, getQuizForLesson } from '../content/moduleRegistry';
import { t } from '../i18n';
import CelebrationModal from '../components/CelebrationModal';
import feedback from '../services/feedbackService';

// ── Écrans du quiz ──────────────────────────────────────────────────────
const STEP_QUESTION  = 'question';
const STEP_FEEDBACK  = 'feedback';
const STEP_RESULT    = 'result';

export default function QuizScreen({ route, navigation }) {
  const { moduleId, lessonIndex } = route.params || {};
  const insets = useSafeAreaInsets();
  const { learner, addXP, saveQuizAttempt, updateProgress, issueBadge, getProgress, recordLessonCompleted } = useDb();

  // ── State ─────────────────────────────────────────────────────────────
  const [step, setStep]             = useState(STEP_QUESTION);
  const [qIndex, setQIndex]         = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [textAnswer, setTextAnswer] = useState('');     // pour fill_blank
  const [answers, setAnswers]       = useState([]);     // [{ qId, selectedId, correct }]
  const [showExplanation, setShowExplanation] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(1));
  // Gamification : célébration post-quiz
  const [celebration, setCelebration] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);

  // ── Données du quiz ───────────────────────────────────────────────────
  const module   = getModuleById(moduleId);
  const lesson   = getLessonById(moduleId, lessonIndex);
  const quiz     = getQuizForLesson(moduleId, lessonIndex);

  // ── Versioning des questions : randomiser l'ordre des questions ET des options ──
  // Chaque instance de quiz a un ordre différent > empêche la mémorisation de position.
  // Les questions fill_blank (saisie texte) sont aussi supportées.
  const [shuffledQuestions] = useState(() => {
    const rawQuestions = quiz?.questions || [];
    if (rawQuestions.length === 0) return [];
    // Mélanger l'ordre des questions (Fisher-Yates)
    const shuffled = [...rawQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Pour chaque question single_choice, mélanger aussi l'ordre des options
    return shuffled.map(q => {
      if (q.type === 'single_choice' && q.options) {
        const opts = [...q.options];
        for (let i = opts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [opts[i], opts[j]] = [opts[j], opts[i]];
        }
        return { ...q, options: opts };
      }
      return q;
    });
  });
  const questions = shuffledQuestions;
  const currentQ  = questions[qIndex];
  const passingScore = quiz?.passing_score ?? 0.67;
  const totalQ   = questions.length;

  // ── Calculs résultat ──────────────────────────────────────────────────
  const correctCount = useMemo(() => answers.filter(a => a.correct).length, [answers]);
  const score = totalQ > 0 ? correctCount / totalQ : 0;
  const passed = score >= passingScore;
  const isPerfect = score === 1;
  const xpBase = lesson?.xp_per_lesson || 0;
  const xpBonus = isPerfect ? (quiz?.xp_bonus_perfect || 0) : 0;
  const totalXP = passed ? xpBase + xpBonus : 0;
  const isLastLesson = lessonIndex >= (module?.lessons?.length || 1) - 1;

  // ── Sélectionner une réponse ──────────────────────────────────────────
  const handleSelect = useCallback((optionId) => {
    if (step !== STEP_QUESTION) return;
    setSelectedId(optionId);
  }, [step]);

  // ── Valider la réponse ────────────────────────────────────────────────
  const handleValidate = useCallback(async () => {
    if (!currentQ) return;

    let isCorrect = false;
    let selectedVal = null;

    if (currentQ.type === 'fill_blank') {
      // Saisie texte : comparer (insensible à la casse, espaces trimés)
      const userAnswer = (textAnswer || '').trim().toLowerCase();
      const acceptedAnswers = currentQ.accepted_answers || (currentQ.options ? currentQ.options.map(o => o.text) : []);
      isCorrect = acceptedAnswers.some(a => String(a).trim().toLowerCase() === userAnswer);
      selectedVal = textAnswer;
      if (!textAnswer.trim()) return; // ne rien faire si vide
    } else {
      // single_choice (défaut)
      if (!selectedId) return;
      const correctOption = currentQ.options.find(o => o.correct);
      isCorrect = selectedId === correctOption?.id;
      selectedVal = selectedId;
    }

    // Feedback haptique selon la réponse
    if (isCorrect) feedback.success(); else feedback.error();

    const answer = {
      qId: currentQ.id,
      selectedId: selectedVal,
      correct: isCorrect,
    };
    const newAnswers = [...answers, answer];
    setAnswers(newAnswers);

    // Passer au feedback
    setStep(STEP_FEEDBACK);
    setShowExplanation(false);

    // Animation de fade
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.8, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [selectedId, currentQ, answers, fadeAnim]);

  // Référence locale pour les réponses (utilisée par handleFinish)
  const answersRef = React.useRef(answers);
  answersRef.current = answers;

  // ── Terminer le quiz ──────────────────────────────────────────────────
  const handleFinish = useCallback(async () => {
    const ans = answersRef.current;
    const correct = ans.filter(a => a.correct).length;
    const finalScore = totalQ > 0 ? correct / totalQ : 0;
    const finalPassed = finalScore >= passingScore;
    const perfect = finalScore === 1;
    const xp = finalPassed ? xpBase + (perfect ? (quiz?.xp_bonus_perfect || 0) : 0) : 0;

    // Sauvegarder la tentative
    if (learner) {
      try {
        // ── Vérifier la progression existante (anti-double XP) ──────────
        // Si la leçon a DÉJÀ été réussie (lessons_done > lessonIndex),
        // on ne redistribue PAS l'XP ni la gamification. Le module reste
        // accessible pour révision mais ne génère plus de récompense.
        const existingProgress = await getProgress(moduleId);
        const alreadyPassedThisLesson = existingProgress &&
          (existingProgress.lessons_done ?? 0) > lessonIndex;
        const moduleAlreadyCompleted = existingProgress?.status === 'completed';

        await saveQuizAttempt({
          moduleId, lessonIndex,
          score: finalScore,
          answers: ans,
          xpAwarded: alreadyPassedThisLesson ? 0 : xp,
          passed: finalPassed,
        });

        // Attribuer XP UNIQUEMENT si la leçon n'avait pas déjà été réussie
        if (xp > 0 && !alreadyPassedThisLesson) {
          await addXP(xp);
        }

        // Mettre à jour la progression
        const lessonsDone = finalPassed
          ? Math.max(lessonIndex + 1, existingProgress?.lessons_done ?? 0)
          : (existingProgress?.lessons_done ?? 0);
        const moduleCompleted = finalPassed && isLastLesson;

        await updateProgress(moduleId, {
          status: (moduleCompleted || moduleAlreadyCompleted) ? 'completed' : 'in_progress',
          current_lesson: finalPassed ? Math.max(lessonIndex + 1, existingProgress?.current_lesson ?? 0) : lessonIndex,
          lessons_done: lessonsDone,
          total_xp_earned: (module?.xp || 0),
          best_score: Math.max(finalScore, existingProgress?.best_score ?? 0),
          completed_at: (moduleCompleted || moduleAlreadyCompleted)
            ? (existingProgress?.completed_at || new Date().toISOString())
            : undefined,
        });

        // Émettre le badge UNIQUEMENT si module terminé ET pas déjà badgé
        if (moduleCompleted && module && !moduleAlreadyCompleted) {
          await issueBadge({
            moduleId: module.id,
            moduleTitle: module.badge_title || module.title,
            score: finalScore,
            xpTotal: module.xp,
          });
        }

        // ── Gamification : enregistrer la leçon complétée ──────────────
        // UNIQUEMENT si c'est une NOUVELLE leçon réussie (pas de double XP/streak).
        if (finalPassed && !alreadyPassedThisLesson && recordLessonCompleted) {
          try {
            const gResult = await recordLessonCompleted({
              xpEarned: xp,
              moduleId,
              lessonIndex,
              score: finalScore,
              passed: finalPassed,
            });
            // Célébration discrète — seulement s'il y a quelque chose de notable
            if (gResult && (gResult.newAchievements?.length > 0 || gResult.goalMet || xp > 0)) {
              setCelebration({
                ...gResult,
                score: finalScore,
                xp,
              });
              setShowCelebration(true);
              // Feedback haptique de célébration
              if (gResult.newAchievements?.length > 0) {
                feedback.achievement();
              } else if (gResult.streak?.current > 1) {
                feedback.streak();
              } else {
                feedback.completion();
              }
            }
          } catch (gErr) {
            console.warn('[Quiz] Gamification error (non-fatal):', gErr.message);
          }
        }
      } catch (e) {
        console.error('[Quiz] Erreur sauvegarde:', e);
      }
    }

    setStep(STEP_RESULT);
  }, [learner, moduleId, lessonIndex, totalQ, passingScore, xpBase, quiz, isLastLesson, module, saveQuizAttempt, addXP, updateProgress, issueBadge, recordLessonCompleted]);

  // ── Question suivante ─────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (qIndex + 1 < totalQ) {
      setQIndex(qIndex + 1);
      setSelectedId(null);
      setTextAnswer('');
      setStep(STEP_QUESTION);
    } else {
      // Dernière question > afficher résultat
      handleFinish();
    }
  }, [qIndex, totalQ, handleFinish]);

  // ── Réessayer le quiz ─────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setStep(STEP_QUESTION);
    setQIndex(0);
    setSelectedId(null);
    setTextAnswer('');
    setAnswers([]);
    setShowExplanation(false);
  }, []);

  // ── Retour au module ──────────────────────────────────────────────────
  const handleBackToModule = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  }, [navigation]);

  // ── Leçon suivante après réussite ─────────────────────────────────────
  const handleNextLesson = useCallback(() => {
    if (isLastLesson) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    } else {
      navigation.replace('Lesson', { moduleId, lessonIndex: lessonIndex + 1 });
    }
  }, [isLastLesson, moduleId, lessonIndex, navigation]);

  // ── Pas de quiz trouvé ────────────────────────────────────────────────
  if (!quiz || questions.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Main")}>
            <Text style={styles.backText}>{t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Quiz</Text>
        </View>
        <View style={styles.content}>
          <Text style={styles.message}>{t('lesson.no_lesson')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Main")}>
            <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── RENDER : Question en cours ────────────────────────────────────────
  if (step === STEP_QUESTION || step === STEP_FEEDBACK) {
    const correctOption = currentQ.options.find(o => o.correct);
    const isCorrect = selectedId === correctOption?.id;

    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Main")} hitSlop={8}>
            <Text style={styles.backText}>{t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{module?.title}</Text>
          <Text style={styles.qCounter}>
            {qIndex + 1}/{totalQ}
          </Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {
            width: `${((qIndex + 1) / totalQ) * 100}%`,
            backgroundColor: module?.color || Colors.primary,
          }]} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fadeAnim, padding: Spacing.lg, gap: Spacing.md }}>
            {/* Question */}
            <Text style={styles.questionText}>{currentQ.text}</Text>

            {/* Champ de saisie (fill_blank) */}
            {currentQ.type === 'fill_blank' ? (
              <View>
                <TextInput
                  style={styles.textInput}
                  value={textAnswer}
                  onChangeText={setTextAnswer}
                  placeholder={currentQ.placeholder || 'Tape ta réponse...'}
                  placeholderTextColor={Colors.ink30}
                  editable={step === STEP_QUESTION}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {step === STEP_FEEDBACK && (
                  <View style={[styles.feedbackBox, answers[answers.length - 1]?.correct ? styles.feedbackCorrect : styles.feedbackWrong]}>
                    <Text style={styles.feedbackText}>
                      {answers[answers.length - 1]?.correct ? 'OK - Correct !' : 'X - Réponse attendue : ' + (currentQ.accepted_answers?.[0] || currentQ.options?.[0]?.text || '')}
                    </Text>
                  </View>
                )}
                {currentQ.explanation && step === STEP_FEEDBACK && (
                  <Text style={styles.explanationText}>{currentQ.explanation}</Text>
                )}
              </View>
            ) : (
              /* Options (single_choice) */
              currentQ.options && currentQ.options.map((option) => {
              const isSelected = selectedId === option.id;
              const isCorrectOption = option.id === correctOption?.id;

              let optionStyle = styles.optionCard;
              let textStyle = styles.optionText;

              if (step === STEP_FEEDBACK) {
                if (isCorrectOption) {
                  optionStyle = styles.optionCorrect;
                  textStyle = styles.optionCorrectText;
                } else if (isSelected && !isCorrect) {
                  optionStyle = styles.optionWrong;
                  textStyle = styles.optionWrongText;
                } else {
                  textStyle = styles.optionMutedText;
                }
              } else if (isSelected) {
                optionStyle = styles.optionSelected;
              }

              return (
                <TouchableOpacity
                  key={option.id}
                  style={optionStyle}
                  onPress={() => handleSelect(option.id)}
                  activeOpacity={step === STEP_QUESTION ? 0.7 : 1}
                  disabled={step === STEP_FEEDBACK}
                >
                  <View style={styles.optionRow}>
                    <View style={[
                      styles.radioButton,
                      isSelected && styles.radioButtonSelected,
                      step === STEP_FEEDBACK && isCorrectOption && styles.radioButtonCorrect,
                    ]}>
                      {(step === STEP_FEEDBACK && isCorrectOption) && <Text style={styles.checkMark}>OK</Text>}
                      {step === STEP_FEEDBACK && isSelected && !isCorrect && <Text style={styles.xMark}>X</Text>}
                      {step === STEP_QUESTION && isSelected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={textStyle}>{option.text}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
            )}

            {/* Feedback (single_choice only — fill_blank a son propre feedback) */}
            {step === STEP_FEEDBACK && currentQ.type !== 'fill_blank' && (
              <View style={styles.feedbackBox}>
                <Text style={[styles.feedbackTitle, { color: isCorrect ? Colors.teal : Colors.error }]}>
                  {isCorrect ? t('lesson.correct') : t('lesson.incorrect')}
                </Text>

                {!isCorrect && correctOption && (
                  <Text style={styles.feedbackCorrect}>
                    {t('lesson.correct_answer')} {correctOption.text}
                  </Text>
                )}

                {currentQ.explanation && (
                  <TouchableOpacity
                    onPress={() => setShowExplanation(!showExplanation)}
                    style={styles.explanationToggle}
                  >
                    <Text style={styles.explanationToggleText}>
                      {showExplanation ? 'v' : '>'} Explication
                    </Text>
                  </TouchableOpacity>
                )}

                {showExplanation && currentQ.explanation && (
                  <Text style={styles.explanationText}>{currentQ.explanation}</Text>
                )}
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
          {step === STEP_QUESTION && (
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: module?.color || Colors.primary, opacity: selectedId ? 1 : 0.5 },
              ]}
              onPress={handleValidate}
              disabled={!selectedId}
            >
              <Text style={styles.primaryBtnText}>{t('lesson.validate')}</Text>
            </TouchableOpacity>
          )}
          {step === STEP_FEEDBACK && (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: module?.color || Colors.primary }]}
              onPress={handleNext}
            >
              <Text style={styles.primaryBtnText}>
                {qIndex + 1 < totalQ ? t('lesson.next_question') : t('common.done')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── RENDER : Écran de résultat ────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ width: 60 }} />
        <Text style={styles.title}>{t('lesson.quiz')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.resultContent}>
          {/* Cercle de résultat */}
          <View style={styles.resultCircle}>
            <View style={[
              styles.resultCircleInner,
              { borderColor: passed ? Colors.teal : Colors.error },
            ]}>
              <Text style={[styles.resultScore, { color: passed ? Colors.teal : Colors.error }]}>
                {Math.round(score * 100)}%
              </Text>
              <Text style={styles.resultLabel}>{t('lesson.score_percent', { percent: Math.round(score * 100) })}</Text>
            </View>
          </View>

          {/* Statut */}
          <Text style={[styles.resultStatus, { color: passed ? Colors.teal : Colors.error }]}>
            {passed ? t('lesson.passed') : t('lesson.failed')}
          </Text>

          {/* Message */}
          <Text style={styles.resultMessage}>
            {passed ? t('lesson.quiz_pass') : t('lesson.quiz_fail')}
          </Text>

          {/* Score minimum info */}
          <Text style={styles.minScoreInfo}>
            {t('lesson.min_score_info', { min: Math.round(passingScore * 100) })}
          </Text>

          {/* XP gagnés */}
          {totalXP > 0 && (
            <View style={styles.xpBanner}>
              <Text style={styles.xpBannerText}>
                [+] {t('lesson.xp_won', { xp: totalXP })}
              </Text>
              {isPerfect && (
                <Text style={styles.perfectText}>
                  {t('lesson.perfect_bonus', { xp: xpBonus })}
                </Text>
              )}
            </View>
          )}

          {/* Détail des réponses */}
          <View style={styles.answerSummary}>
            <Text style={styles.answerSummaryTitle}>
              {correctCount}/{totalQ} {t('lesson.correct').toLowerCase()}
            </Text>
            {answers.map((a, i) => {
              const q = questions[i];
              return (
                <View key={a.qId} style={styles.answerRow}>
                  <Text style={[styles.answerIcon, { color: a.correct ? Colors.teal : Colors.error }]}>
                    {a.correct ? 'OK' : 'X'}
                  </Text>
                  <Text style={styles.answerQuestion} numberOfLines={2}>{q?.text}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleBackToModule}
        >
          <Text style={styles.secondaryBtnText}>{t('lesson.back_to_module')}</Text>
        </TouchableOpacity>

        {passed && !isLastLesson && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: module?.color || Colors.primary }]}
            onPress={handleNextLesson}
          >
            <Text style={styles.primaryBtnText}>{t('lesson.next_lesson')}</Text>
          </TouchableOpacity>
        )}

        {!passed && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: Colors.error }]}
            onPress={handleRetry}
          >
            <Text style={styles.primaryBtnText}>{t('lesson.retry')}</Text>
          </TouchableOpacity>
        )}

        {passed && isLastLesson && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: module?.color || Colors.primary }]}
            onPress={handleBackToModule}
          >
            <Text style={styles.primaryBtnText}>{t('lesson.all_lessons_done')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Célébration gamification (streak, succès, objectif) */}
      <CelebrationModal
        visible={showCelebration}
        onClose={() => setShowCelebration(false)}
        result={celebration}
      />
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backText: {
    color: Colors.primary,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  title: {
    fontSize: Typography.bodyLg,
    fontWeight: Typography.bold,
    color: Colors.ink,
    flex: 1,
    textAlign: 'center',
  },
  qCounter: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    minWidth: 40,
    textAlign: 'center',
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  message: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },

  // Question
  questionText: {
    fontSize: Typography.bodyLg,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    lineHeight: 24,
  },

  // Options
  optionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  optionSelected: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
    borderWidth: 2,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  optionCorrect: {
    backgroundColor: Colors.tealLight,
    borderColor: Colors.teal,
    borderWidth: 2,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  optionWrong: {
    backgroundColor: Colors.coralLight,
    borderColor: Colors.error,
    borderWidth: 2,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.ink,
    lineHeight: 20,
  },
  optionCorrectText: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.tealDark,
    fontWeight: Typography.semibold,
    lineHeight: 20,
  },
  optionWrongText: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.error,
    lineHeight: 20,
  },
  optionMutedText: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.ink30,
    lineHeight: 20,
  },
  radioButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioButtonSelected: {
    borderColor: Colors.primary,
  },
  radioButtonCorrect: {
    borderColor: Colors.teal,
    backgroundColor: Colors.teal,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  checkMark: {
    color: Colors.surface,
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
  },
  xMark: {
    color: Colors.surface,
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
  },

  // Feedback
  feedbackBox: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  feedbackCorrect: {
    backgroundColor: Colors.tealLight,
    borderColor: Colors.teal,
  },
  feedbackWrong: {
    backgroundColor: Colors.coralLight,
    borderColor: Colors.error,
  },
  feedbackText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  explanationText: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  // Text input (fill_blank)
  textInput: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.bodyLg,
    color: Colors.ink,
    backgroundColor: Colors.surface,
  },
  feedbackTitle: {
    fontSize: Typography.bodyLg,
    fontWeight: Typography.bold,
    marginBottom: Spacing.xs,
  },
  feedbackCorrect: {
    fontSize: Typography.body,
    color: Colors.ink60,
    marginBottom: Spacing.sm,
  },
  explanationToggle: {
    paddingVertical: Spacing.xs,
  },
  explanationToggleText: {
    fontSize: Typography.caption,
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  explanationText: {
    fontSize: Typography.body,
    color: Colors.ink60,
    lineHeight: 22,
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
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

  // ── Résultat ──────────────────────────────────────────────────────────
  resultContent: {
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  resultCircle: {
    marginVertical: Spacing.lg,
  },
  resultCircleInner: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  resultScore: {
    fontSize: Typography.display,
    fontWeight: Typography.bold,
  },
  resultLabel: {
    fontSize: Typography.caption,
    color: Colors.ink60,
  },
  resultStatus: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
  },
  resultMessage: {
    fontSize: Typography.bodyLg,
    color: Colors.ink60,
    textAlign: 'center',
    lineHeight: 24,
  },
  minScoreInfo: {
    fontSize: Typography.caption,
    color: Colors.ink30,
    marginTop: Spacing.xs,
  },
  xpBanner: {
    backgroundColor: Colors.xpGold + '18',
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    width: '100%',
  },
  xpBannerText: {
    fontSize: Typography.bodyLg,
    fontWeight: Typography.bold,
    color: Colors.xpGold,
  },
  perfectText: {
    fontSize: Typography.caption,
    color: Colors.xpGold,
    marginTop: Spacing.xs,
  },
  answerSummary: {
    width: '100%',
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  answerSummaryTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  answerIcon: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    width: 20,
    textAlign: 'center',
  },
  answerQuestion: {
    flex: 1,
    fontSize: Typography.caption,
    color: Colors.ink60,
    lineHeight: 18,
  },
});