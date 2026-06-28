// src/screens/ProfileScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { learner, getAllBadges, resetAll } = useDb();
  const [badges, setBadges] = useState([]);

  const loadBadges = useCallback(async () => {
    try {
      const userBadges = await getAllBadges();
      setBadges(userBadges || []);
    } catch (error) {
      console.error('Erreur chargement badges:', error);
    }
  }, [getAllBadges]);

  useEffect(() => {
    if (learner) loadBadges();
  }, [learner, loadBadges]);

  const handleReset = () => {
    Alert.alert(
      'Réinitialiser',
      'Toutes tes données seront effacées. Cette action est irréversible.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: 'Réinitialiser',
          style: 'destructive',
          onPress: async () => {
            await resetAll();
          },
        },
      ],
    );
  };

  if (!learner) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.loading}>{t('common.loading')}</Text>
      </View>
    );
  }

  const { current } = getLevel(learner.total_xp || 0);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {/* Header profil */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>
            {(learner.name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{learner.name}</Text>
        <Text style={styles.phone}>{learner.phone}</Text>
        <Text style={styles.language}>
          {learner.language === 'fr' ? 'Français' : 'Eʋe'}
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: Colors.xpGold }]}>{learner.total_xp || 0}</Text>
          <Text style={styles.statLabel}>XP Total</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: Colors.primary }]}>{current.level}</Text>
          <Text style={styles.statLabel}>{current.label}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: Colors.teal }]}>{badges.length}</Text>
          <Text style={styles.statLabel}>Badges</Text>
        </View>
      </View>

      {/* Badges */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Badges obtenus</Text>
        {badges.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏆</Text>
            <Text style={styles.emptyText}>{t('badge.empty_text')}</Text>
          </View>
        ) : (
          badges.map((badge) => (
            <View key={badge.id} style={[styles.badgeItem, Shadow.card]}>
              <View style={styles.badgeLeft}>
                <Text style={styles.badgeIcon}>🏅</Text>
                <View>
                  <Text style={styles.badgeTitle}>{badge.module_title}</Text>
                  <Text style={styles.badgeDate}>{t('badge.earned_on')} {new Date(badge.issued_at).toLocaleDateString('fr-TG')}</Text>
                </View>
              </View>
              <View style={styles.badgeRight}>
                <Text style={styles.badgeScore}>{Math.round(badge.score * 100)}%</Text>
                <Text style={styles.badgeXP}>+{badge.xp_total} XP</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Reset */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
          <Text style={styles.resetButtonText}>Réinitialiser mes données</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: Typography.body,
    color: Colors.ink50,
  },
  header: {
    padding: Spacing.xl,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  avatarInitial: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    color: Colors.surface,
  },
  name: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  phone: {
    fontSize: Typography.body,
    color: Colors.ink50,
    marginBottom: Spacing.xs,
  },
  language: {
    fontSize: Typography.caption,
    color: Colors.ink30,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statItem: {
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },
  statValue: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
  },
  statLabel: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    marginTop: Spacing.xs,
  },
  section: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: Typography.body,
    color: Colors.ink50,
    textAlign: 'center',
    lineHeight: 22,
  },
  badgeItem: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  badgeIcon: {
    fontSize: 28,
  },
  badgeTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  badgeDate: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    marginTop: 2,
  },
  badgeRight: {
    alignItems: 'flex-end',
  },
  badgeScore: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.teal,
  },
  badgeXP: {
    fontSize: Typography.tiny,
    color: Colors.xpGold,
    fontWeight: Typography.semibold,
  },
  resetButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  resetButtonText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.error,
  },
});