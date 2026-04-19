// src/screens/ProfileScreen.js
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { learner, addXP, getAllBadges } = useDb();
  const [badges, setBadges] = useState([]);

  React.useEffect(() => {
    if (learner) {
      loadBadges();
    }
  }, [learner]);

  const loadBadges = async () => {
    try {
      const userBadges = await getAllBadges();
      setBadges(userBadges);
    } catch (error) {
      console.error('Erreur chargement badges:', error);
    }
  };

  const handleAddXP = async () => {
    try {
      const newXP = await addXP(10);
      Alert.alert('XP ajouté!', `Total XP: ${newXP}`);
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'ajouter des XP');
    }
  };

  if (!learner) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.loading}>Chargement...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.name}>{learner.name}</Text>
        <Text style={styles.phone}>{learner.phone}</Text>
        <Text style={styles.language}>Langue: {learner.language}</Text>
      </View>

      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{learner.total_xp}</Text>
          <Text style={styles.statLabel}>XP Total</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{badges.length}</Text>
          <Text style={styles.statLabel}>Badges</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions de test</Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleAddXP}>
          <Text style={styles.actionButtonText}>+10 XP (test)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Badges obtenus</Text>
        {badges.length === 0 ? (
          <Text style={styles.emptyText}>Aucun badge pour le moment</Text>
        ) : (
          badges.map((badge) => (
            <View key={badge.id} style={styles.badgeItem}>
              <Text style={styles.badgeTitle}>{badge.module_title}</Text>
              <Text style={styles.badgeScore}>Score: {badge.score}%</Text>
            </View>
          ))
        )}
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
    padding: Spacing.lg,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    fontSize: Typography.small,
    color: Colors.ink30,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  statLabel: {
    fontSize: Typography.small,
    color: Colors.ink50,
    marginTop: Spacing.xs,
  },
  section: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.md,
  },
  actionButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  actionButtonText: {
    color: Colors.surface,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  emptyText: {
    fontSize: Typography.body,
    color: Colors.ink50,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  badgeItem: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  badgeScore: {
    fontSize: Typography.small,
    color: Colors.ink50,
  },
});
