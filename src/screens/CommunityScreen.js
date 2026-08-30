// src/screens/CommunityScreen.js
// Onglet "Communauté" — placeholder en attendant la fonctionnalité.
// Header sticky (hors ScrollView) + corps scrollable.

import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';

// ── Liste des fonctionnalités à venir ─────────────────────────────────────────
const UPCOMING_FEATURES = [
  {
    icon: '📊',
    title: 'Classements locaux',
    desc: 'Compare ta progression avec d\'autres apprenants de ta ville',
  },
  {
    icon: '💬',
    title: 'Forum d\'entraide',
    desc: 'Pose tes questions et partage tes expériences',
  },
  {
    icon: '🎯',
    title: 'Défis de groupe',
    desc: 'Rejoins des défis collectifs pour te motiver',
  },
  {
    icon: '🤝',
    title: 'Mentorat',
    desc: 'Connecte-toi avec des professionnels expérimentés',
  },
];

// ── Bénéfices clés de la communauté ───────────────────────────────────────────
const BENEFITS = [
  'Partage tes succès avec d\'autres apprenants',
  'Pose des questions et aide les autres',
  'Participe à des défis de groupe',
  'Accède à des mentors locaux',
];

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* Sticky header (hors ScrollView) */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Communauté</Text>
          <Text style={styles.headerSub}>
            Apprends, partage et progresse ensemble
          </Text>
        </View>
        <View style={styles.soonBadge}>
          <Text style={styles.soonBadgeText}>Bientôt disponible</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Héro / illustration */}
        <View style={[styles.hero, Shadow.card]}>
          <Text style={styles.heroEmoji}>👥</Text>
          <Text style={styles.heroTitle}>Une communauté qui apprend ensemble</Text>
          <Text style={styles.heroDesc}>
            EduKraft construit un espace où les apprenants du Togo et d'ailleurs
            peuvent échanger, s'encourager et grandir collectivement.
            Cette fonctionnalité arrive très prochainement.
          </Text>
        </View>

        {/* Liste des bénéfices */}
        <View style={styles.benefitsCard}>
          <Text style={styles.sectionLabel}>Ce que tu pourras faire</Text>
          {BENEFITS.map((benefit, i) => (
            <View key={i} style={styles.benefitRow}>
              <Text style={styles.benefitBullet}>✓</Text>
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        {/* Section titre + feature cards */}
        <Text style={styles.featuresTitle}>Fonctionnalités à venir</Text>

        <View style={styles.grid}>
          {UPCOMING_FEATURES.map((feature, i) => (
            <View
              key={i}
              style={[styles.featureCard, Shadow.card]}
              opacity={0.85}
            >
              <View style={styles.featureIconWrap}>
                <Text style={styles.featureIcon}>{feature.icon}</Text>
              </View>
              <Text style={styles.featureTitle} numberOfLines={2}>
                {feature.title}
              </Text>
              <Text style={styles.featureDesc} numberOfLines={3}>
                {feature.desc}
              </Text>
              <View style={styles.comingTag}>
                <Text style={styles.comingTagText}>Bientôt</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Bannière de bas de page */}
        <View style={[styles.bottomBanner, Shadow.card]}>
          <Text style={styles.bottomBannerEmoji}>🚀</Text>
          <View style={styles.bottomBannerTextWrap}>
            <Text style={styles.bottomBannerTitle}>Bientôt disponible</Text>
            <Text style={styles.bottomBannerDesc}>
              Nous finalisons les derniers réglages. En attendant,
              continue à apprendre et à collectionner tes badges !
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
  },

  // Header sticky
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  headerSub: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    marginTop: 2,
  },
  soonBadge: {
    backgroundColor: Colors.amberLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.amber + '33',
  },
  soonBadgeText: {
    fontSize: Typography.tiny,
    fontWeight: Typography.semibold,
    color: Colors.amber,
  },

  // ScrollView
  scroll: { flex: 1 },
  content: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // Héro
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroEmoji: {
    fontSize: 64,
    marginBottom: Spacing.xs,
  },
  heroTitle: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  heroDesc: {
    fontSize: Typography.body,
    color: Colors.ink60,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Bénéfices
  benefitsCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  benefitBullet: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.teal,
    marginTop: -1,
  },
  benefitText: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.ink,
    lineHeight: 22,
  },

  // Features grid
  featuresTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginTop: Spacing.sm,
    marginBottom: -Spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  featureCard: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
    // Visuellement "grisé" pour signaler que c'est non-interactif
    opacity: 0.85,
  },
  featureIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  featureIcon: {
    fontSize: 24,
  },
  featureTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    textAlign: 'center',
  },
  featureDesc: {
    fontSize: Typography.tiny,
    color: Colors.ink60,
    textAlign: 'center',
    lineHeight: 16,
  },
  comingTag: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.ink10,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  comingTagText: {
    fontSize: Typography.tiny,
    fontWeight: Typography.semibold,
    color: Colors.ink50,
  },

  // Bannière bas
  bottomBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  bottomBannerEmoji: {
    fontSize: 32,
  },
  bottomBannerTextWrap: {
    flex: 1,
    gap: 2,
  },
  bottomBannerTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.surface,
  },
  bottomBannerDesc: {
    fontSize: Typography.caption,
    color: Colors.surface + 'DD',
    lineHeight: 18,
  },
});
