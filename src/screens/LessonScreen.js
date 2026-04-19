// src/screens/LessonScreen.js
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';

export default function LessonScreen({ route, navigation }) {
  const { moduleId, lessonIndex } = route.params || {};
  const insets = useSafeAreaInsets();
  const { learner } = useDb();

  // Données simulées pour le test
  const lesson = {
    title: `Leçon ${lessonIndex || 1}`,
    content: "Contenu de la leçon en cours de chargement...",
    duration: 15
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{lesson.title}</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lessonText}>{lesson.content}</Text>
        
        <View style={styles.meta}>
          <Text style={styles.duration}>Durée: {lesson.duration} min</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.nextButton}
          onPress={() => navigation.navigate('Quiz', { moduleId, lessonIndex })}
        >
          <Text style={styles.nextButtonText}>Quiz suivant</Text>
        </TouchableOpacity>
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
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backText: {
    color: Colors.primary,
    fontSize: Typography.body,
    marginRight: Spacing.md,
  },
  title: {
    fontSize: Typography.h3,
    fontWeight: Typography.bold,
    color: Colors.ink,
    flex: 1,
  },
  content: {
    flex: 1,
    padding: Spacing.md,
  },
  lessonText: {
    fontSize: Typography.body,
    color: Colors.ink,
    lineHeight: 24,
    marginBottom: Spacing.lg,
  },
  meta: {
    paddingVertical: Spacing.sm,
  },
  duration: {
    fontSize: Typography.small,
    color: Colors.ink50,
  },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  nextButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
  },
  nextButtonText: {
    color: Colors.surface,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
});
