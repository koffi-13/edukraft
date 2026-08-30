// src/screens/ProfileScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Radius, Shadow, getLevel } from '../theme';
import { useDb } from '../database/DbProvider';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import persistentStorage from '../utils/persistentStorage';
import * as authService from '../services/authService';
import { getRemoteVersion } from '../content/moduleRegistry';

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { db, learner, getAllBadges, resetAll, getPendingQueue, getSyncMeta } = useDb();
  const { user, skipAuth, logout } = useAuth();
  const [badges, setBadges] = useState([]);
  const [syncInfo, setSyncInfo] = useState({ pending: 0, lastSync: null });
  // v1.1.7 : diagnostics de persistance (aide au support « écran Login en
  // boucle ») — état de chaque couche de stockage + clés présentes.
  const [diagOpen, setDiagOpen] = useState(false);
  const [diag, setDiag] = useState(null);
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

  // v1.1.7 : sonde l'état réel des couches de stockage (SQLite, AsyncStorage,
  // SecureStore/tokens, clés de session) + le catalogue distant.
  const runDiagnostics = useCallback(async () => {
    const out = {
      sqlite: null, storage: false, keys: {}, session: 'inconnue',
      learnerId: learner?.id || null, serverId: learner?.server_id || null,
      snapshot: false, remoteCatalog: getRemoteVersion() || '—',
    };
    try {
      out.sqlite = !!db; // instance expo-sqlite vivante (mode mémoire sinon)
    } catch (_) {}
    try {
      const [l, snap] = await Promise.all([
        persistentStorage.getItem('ek_learner'),
        persistentStorage.getItem('ek_memory_snapshot'),
      ]);
      out.storage = true;
      out.keys.ek_learner = !!l;
      out.snapshot = !!snap;
    } catch (_) { out.storage = false; }
    try {
      const st = await authService.getStoredAuth();
      out.keys.ek_user = !!st?.user;
      out.keys.ek_logged_out = st?.sessionEnded === true;
      out.session = st?.user
        ? (st.sessionEnded ? 'terminée (déconnecté)' : 'active')
        : (st?.skipAuth ? 'invité (hors-ligne)' : 'aucune');
    } catch (_) {}
    setDiag(out);
  }, [db, learner]);

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

  // v1.1.3 — Déconnexion CONDITIONNELLE (cahier des charges) :
  //   • Utilisateur SANS compte (mode « sans compte » / invité) : ses données
  //     (XP, badges, progressions) ne vivent que sur ce téléphone. Avant de
  //     l'autoriser à se déconnecter, il doit créer un compte pour stocker
  //     ses données et pouvoir les retrouver à sa prochaine connexion.
  //     → On l'oriente vers l'inscription (modal). S'il refuse, ses données
  //     locales restent dans l'app — rien n'est supprimé.
  //   • Utilisateur AVEC compte : déconnexion normale (confirmée) — le flag
  //     sessionEnded s'affiche et l'écran Login réapparaît ; ses données
  //     locales ET serveur sont conservées.
  const handleLogout = () => {
    if (!user) {
      Alert.alert(
        'Crée ton compte pour te déconnecter',
        'Tes données (progression, badges, XP) sont enregistrées uniquement sur ce téléphone.\n\nCrée un compte : elles seront sauvegardées en ligne et restaurées automatiquement à ta prochaine connexion, même sur un autre appareil.',
        [
          { text: 'Plus tard', style: 'cancel' },
          {
            text: 'Créer un compte',
            onPress: () => navigation.navigate('RegisterAccount', { fromLogout: true }),
          },
        ],
      );
      return;
    }
    Alert.alert(
      t('auth.logout_button'),
      t('auth.logout_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auth.logout_button'),
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ],
    );
  };

  // Badge visuel pour le provider d'authentification
  const providerLabel = (provider) => {
    const labels = {
      email: 'Email', google: 'Google', apple: 'Apple',
      facebook: 'Facebook', phone: 'SMS',
    };
    return labels[provider] || provider || '—';
  };

  const providerColor = (provider) => {
    const colors = {
      email: Colors.primary, google: '#4285F4', apple: Colors.ink,
      facebook: '#1877F2', phone: Colors.teal,
    };
    return colors[provider] || Colors.ink50;
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
        {/* v1.1.7 : diagnostics de persistance — visible par l'utilisateur en
            cas de problème (« je rouvre l'app et je retombe sur Login ») :
            indique précisément quelle couche de stockage est HS. */}
        <TouchableOpacity
          style={styles.diagToggle}
          onPress={() => {
            const next = !diagOpen;
            setDiagOpen(next);
            if (next) runDiagnostics();
          }}
        >
          <Text style={styles.diagToggleText}>
            {diagOpen ? '▾' : '▸'} Diagnostics du stockage
          </Text>
        </TouchableOpacity>
        {diagOpen && diag && (
          <View style={styles.diagBox}>
            <Text style={styles.diagRow}>SQLite : {diag.sqlite ? '✓ actif' : '✗ indisponible (mode mémoire)'}</Text>
            <Text style={styles.diagRow}>Stockage persistant : {diag.storage ? '✓ opérationnel' : '✗ HS'}</Text>
            <Text style={styles.diagRow}>Session : {diag.session}</Text>
            <Text style={styles.diagRow}>Clé profil (ek_learner) : {diag.keys.ek_learner ? '✓ présente' : '✗ absente'}</Text>
            <Text style={styles.diagRow}>Snapshot complet : {diag.snapshot ? '✓ présent' : '✗ absent'}</Text>
            <Text style={styles.diagRow}>Compte (ek_user) : {diag.keys.ek_user ? '✓ présent' : '✗ absent'}</Text>
            <Text style={styles.diagRow}>Flag déconnexion : {diag.keys.ek_logged_out ? '⚠ posé (déconnecté)' : '✓ non posé'}</Text>
            {diag.learnerId && <Text style={styles.diagRow}>Learner : {diag.learnerId}</Text>}
            {diag.serverId && <Text style={styles.diagRow}>Compte lié : {diag.serverId}</Text>}
            <Text style={styles.diagRow}>Catalogue cours distant : v{diag.remoteCatalog}</Text>
          </View>
        )}
      </View>

      {/* Premium section */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.premiumCard, Shadow.card]}
          onPress={() => navigation.navigate('Payment')}
        >
          <View style={styles.premiumLeft}>
            <Text style={styles.premiumIcon}>💎</Text>
            <View>
              <Text style={styles.premiumTitle}>{t('profile.go_premium')}</Text>
              <Text style={styles.premiumDesc}>{t('profile.premium_desc')}</Text>
            </View>
          </View>
          <Text style={styles.premiumArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Badges */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.badges_section')}</Text>
        {badges.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏆</Text>
            <Text style={styles.emptyText}>{t('badge.empty_text')}</Text>
          </View>
        ) : (
          <View style={styles.badgeGrid}>
            {badges.map((badge) => (
              <TouchableOpacity
                key={badge.id}
                style={[styles.badgeItem, Shadow.card]}
                activeOpacity={0.85}
                onPress={() => Alert.alert(
                  badge.module_title,
                  'Score : ' + Math.round(badge.score * 100) + '%\n' +
                  'XP : ' + badge.xp_total + '\n' +
                  'Date : ' + new Date(badge.issued_at).toLocaleDateString('fr-TG') + '\n' +
                  'Hash : ' + (badge.badge_hash || 'N/A').substring(0, 20) + '...\n' +
                  'Blockchain : ' + (badge.blockchain_tx || 'En attente de sync'),
                )}
              >
                <Text style={styles.badgeIcon}>🏅</Text>
                <Text style={styles.badgeTitle} numberOfLines={2}>
                  {badge.module_title}
                </Text>
                <View style={styles.badgeRow}>
                  <Text style={styles.badgeScore}>{Math.round(badge.score * 100)}%</Text>
                  <Text style={styles.badgeXP}>+{badge.xp_total} XP</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Section Gamification (streak + succès) */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.premiumCard, Shadow.card, { borderColor: Colors.teal }]}
          onPress={() => navigation.navigate('Achievements')}
          activeOpacity={0.85}
        >
          <View style={styles.premiumLeft}>
            <Text style={styles.premiumIcon}>🏆</Text>
            <View>
              <Text style={styles.premiumTitle}>{t('gamification.profile_link_title')}</Text>
              <Text style={styles.premiumDesc}>{t('gamification.profile_link_desc')}</Text>
            </View>
          </View>
          <Text style={styles.premiumArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Section Mes informations (profil étendu) */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.premiumCard, Shadow.card, { borderColor: Colors.primary }]}
          onPress={() => navigation.navigate('EditProfile')}
          activeOpacity={0.85}
        >
          <View style={styles.premiumLeft}>
            <Text style={styles.premiumIcon}>👤</Text>
            <View>
              <Text style={styles.premiumTitle}>{t('profile.edit_title')}</Text>
              <Text style={styles.premiumDesc}>{t('profile.edit_desc')}</Text>
            </View>
          </View>
          <Text style={styles.premiumArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Section Compte / Authentification */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('auth.account_section')}</Text>
        {user ? (
          <View style={[styles.accountCard, Shadow.card]}>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>{t('auth.email_display')}</Text>
              <Text style={styles.accountValue}>{user.email || user.phone || '-'}</Text>
            </View>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>{t('auth.provider_label')}</Text>
              <View style={[styles.providerBadge, { backgroundColor: providerColor(user.provider) }]}>
                <Text style={styles.providerBadgeText}>{providerLabel(user.provider)}</Text>
              </View>
            </View>
            {user.display_name && (
              <View style={styles.accountRow}>
                <Text style={styles.accountLabel}>{t('auth.name_label')}</Text>
                <Text style={styles.accountValue}>{user.display_name}</Text>
              </View>
            )}
          </View>
        ) : skipAuth ? (
          <View style={[styles.accountCard, Shadow.card]}>
            <Text style={styles.skipAuthText}>
              {t('auth.skip')} — {t('auth.skip_description')}
            </Text>
          </View>
        ) : null}

        {/* v1.1.3 : le bouton de déconnexion est TOUJOURS visible (invité
            compris) — pour l'invité, il déclenche le parcours « créer un
            compte pour sécuriser tes données » (handleLogout). */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>{t('auth.logout_button')}</Text>
        </TouchableOpacity>
      </View>

      {/* Reset */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
          <Text style={styles.resetButtonText}>{t('profile.reset_title')}</Text>
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
  // v1.1.7 : diagnostics du stockage
  diagToggle: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
    alignSelf: 'flex-start',
  },
  diagToggleText: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  diagBox: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    gap: 3,
  },
  diagRow: {
    fontSize: Typography.tiny,
    color: Colors.ink60,
    lineHeight: 17,
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
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  badgeItem: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    width: '48%',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  badgeIcon: {
    fontSize: 24,
  },
  badgeTitle: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    textAlign: 'center',
    minHeight: 34,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  badgeScore: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.teal,
  },
  badgeXP: {
    fontSize: Typography.tiny,
    color: Colors.xpGold,
    fontWeight: Typography.semibold,
  },
  premiumCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.xpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  premiumLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  premiumIcon: {
    fontSize: 28,
  },
  premiumTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  premiumDesc: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    marginTop: 2,
    lineHeight: 16,
    maxWidth: 240,
  },
  premiumArrow: {
    fontSize: 24,
    color: Colors.ink30,
    fontWeight: '300',
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
  // ── Section Compte / Auth ───────────────────────────────────────────────
  accountCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  accountLabel: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    fontWeight: Typography.semibold,
  },
  accountValue: {
    fontSize: Typography.body,
    color: Colors.ink,
    fontWeight: Typography.medium,
    maxWidth: 200,
    textAlign: 'right',
  },
  providerBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  providerBadgeText: {
    fontSize: Typography.tiny,
    color: Colors.surface,
    fontWeight: Typography.bold,
  },
  skipAuthText: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    lineHeight: 18,
  },
  logoutButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    backgroundColor: Colors.coralLight,
    marginTop: Spacing.sm,
  },
  logoutButtonText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.error,
  },
});