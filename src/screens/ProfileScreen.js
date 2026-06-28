// src/screens/ProfileScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { learner, getAllBadges, resetAll, getPendingQueue, getSyncMeta } = useDb();
  const [badges, setBadges] = useState([]);
  const [syncInfo, setSyncInfo] = useState({ pending: 0, lastSync: null });

  const loadBadges = useCallback(async () => {
    try {
      const userBadges = await getAllBadges();
      setBadges(userBadges || []);
    } catch (error) {
      console.error('Erreur chargement badges:', error);
    }
  }, [getAllBadges]);

  const loadSyncInfo = useCallback(async () => {
    try {
      const queue = await getPendingQueue();
      const lastSync = await getSyncMeta('last_sync_at');
      setSyncInfo({
        pending: queue?.length || 0,
        lastSync,
      });
    } catch (_) {}
  }, [getPendingQueue, getSyncMeta]);

  useEffect(() => {
    if (learner) {
      loadBadges();
      loadSyncInfo();
      // Rafraîchir la sync info toutes les 10s
      const interval = setInterval(loadSyncInfo, 10_000);
      return () => clearInterval(interval);
    }
  }, [learner, loadBadges, loadSyncInfo]);

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

  const formatSyncTime = (iso) => {
    if (!iso) return 'Jamais';
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-TG', { hour: '2-digit', minute: '2-digit' });
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

      {/* Sync status */}
      <View style={styles.syncCard}>
        <Text style={styles.syncTitle}>Synchronisation</Text>
        <View style={styles.syncRow}>
          <View style={styles.syncDotWrap}>
            <View style={[
              styles.syncDot,
              { backgroundColor: syncInfo.pending > 0 ? Colors.xpGold : Colors.teal },
            ]} />
          </View>
          <Text style={styles.syncText}>
            {syncInfo.pending > 0
              ? `${syncInfo.pending} élément(s) en attente de synchronisation`
              : 'Tout est à jour'
            }
          </Text>
        </View>
        <Text style={styles.syncSubtext}>
          Dernière sync : {formatSyncTime(syncInfo.lastSync)}
        </Text>
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
  syncCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  syncTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.sm,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  syncDotWrap: {
    width: 20,
    alignItems: 'center',
  },
  syncDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  syncText: {
    flex: 1,
    fontSize: Typography.caption,
    color: Colors.ink70,
    lineHeight: 18,
  },
  syncSubtext: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    marginTop: Spacing.sm,
    textAlign: 'right',
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