// src/components/MasteryCard.js
// Vue Maîtrise par filière — remplace le simple "nombre XP" par une progression
// de compétence par domaine.
//
// Design éducatif :
//   - Montrer la compétence acquise par filière (marketing, comptabilité...)
//     plutôt qu'un seul chiffre global — l'apprenant voit où il est fort.
//   - Une filière partiellement complétée affiche "en cours", pas "incomplet".
//   - Pas de comparaison entre filières (chacune a sa valeur).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';

export default function MasteryCard({ mastery = [] }) {
  if (!mastery || mastery.length === 0) {
    return (
      <View style={[styles.card, Shadow.card]}>
        <Text style={styles.title}>{t('gamification.mastery_title')}</Text>
        <Text style={styles.empty}>{t('gamification.mastery_empty')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, Shadow.card]}>
      <Text style={styles.title}>{t('gamification.mastery_title')}</Text>
      <Text style={styles.subtitle}>{t('gamification.mastery_subtitle')}</Text>

      <View style={styles.filiereList}>
        {mastery.map((f, i) => {
          const pct = f.total > 0 ? f.completed / f.total : 0;
          return (
            <View key={i} style={styles.filiere}>
              <View style={styles.filiereHeader}>
                <Text style={styles.filiereName}>{f.filiere}</Text>
                <Text style={styles.filiereCount}>
                  {f.completed}/{f.total}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, {
                  width: `${Math.round(pct * 100)}%`,
                  backgroundColor: pct === 1 ? Colors.teal : pct > 0 ? Colors.primary : Colors.border,
                }]} />
              </View>
              <Text style={styles.filiereStatus}>
                {pct === 1
                  ? t('gamification.mastery_mastered')
                  : f.inProgress > 0
                    ? t('gamification.mastery_in_progress')
                    : t('gamification.mastery_not_started')}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  title: {
    fontSize: Typography.h3,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  subtitle: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginBottom: Spacing.sm,
  },
  empty: {
    fontSize: Typography.caption,
    color: Colors.ink30,
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
  filiereList: { gap: Spacing.md },
  filiere: { gap: 4 },
  filiereHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filiereName: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  filiereCount: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    fontWeight: Typography.semibold,
  },
  barTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: Radius.full,
  },
  filiereStatus: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
  },
});
