// src/navigation/AppNavigator.js
// Navigation simplifiée — le learner local est la seule source de vérité.
//
// Logique :
//   1. DB pas prête → splash
//   2. Pas de learner local → Auth stack (Login / Register / Onboarding)
//   3. Learner existe → Dashboard direct
//
// PAS de isAuthenticated, PAS de skipAuth, PAS de tokens dans le gating.
// Le serveur est optionnel (backup uniquement).
//
// v1.1 (correctif critique) : Onboarding est maintenant MONTÉ dans AuthStack.
// Avant, l'écran était importé mais aucune route ne le rendait → impossible
// de créer un learner → bloqué sur Login / profil perdu.
// LoginScreen/RegisterScreen naviguent vers 'Onboarding' après un login
// réussi OU après "Continuer hors ligne" ; Onboarding crée le learner →
// le gating bascule automatiquement vers Root (Dashboard).

// v1.1.3 (gating v2 — persistance hors-ligne) :
//   2b. Learner existe MAIS session terminée (déconnexion volontaire) → Auth
//       (les données locales sont conservées : la reconnexion ou « Continuer
//       sans compte » les restaure immédiatement)
//   3. Learner existe et session active → Dashboard direct (le profil invité
//       et toutes ses progressions sont chargés automatiquement au démarrage)
//   + RegisterScreen montée en modal dans RootStack : l'invité qui demande
//     une déconnexion doit créer un compte pour sécuriser ses données avant.
//
// v1.1.7 (gating v3 — session-first, exigence utilisateur) :
//   « Il doit toujours voir son dashboard jusqu'à ce qu'il se déconnecte. »
//   - Le splash attend ready (DB) ET restored (session lue) → plus de course
//     entre DbProvider et AuthProvider au démarrage.
//   - showAuth = (!learner && !sessionActive) || sessionEnded : l'écran
//     Login n'apparaît QUE si (a) aucune session active et aucun profil
//     local, ou (b) déconnexion volontaire. Un utilisateur authentifié dont
//     le learner serait momentanément introuvable reste sur son Dashboard
//     (DbProvider.ensureSessionLearner recrée le profil de secours depuis
//     ek_user — la dernière couche de stockage encore lisible).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing } from '../theme';
import { t } from '../i18n';
import { useAuth } from '../contexts/AuthContext';

import DashboardScreen  from '../screens/DashboardScreen';
import LessonScreen     from '../screens/LessonScreen';
import QuizScreen       from '../screens/QuizScreen';
import BadgeWalletScreen from '../screens/BadgeWalletScreen';
import ProfileScreen    from '../screens/ProfileScreen';
import PaymentScreen     from '../screens/PaymentScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen      from '../screens/LoginScreen';
import RegisterScreen   from '../screens/RegisterScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import CommunityScreen   from '../screens/CommunityScreen';
import { useDb }        from '../database/DbProvider';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabIcon({ name, focused, color }) {
  // Icônes emoji d'origine (v1.1.3 — restauration) : elles s'affichaient
  // parfaitement sur l'appareil de test (captures AVANT). La purge ASCII
  // de la v1.1 ([#] [B] [C]…) dégradait l'interface : annulée.
  const icons = {
    dashboard: focused ? '⬛' : '□',
    learn:   focused ? '📖' : '📄',
    badges:  focused ? '🏅' : '🏷️',
    community: focused ? '👥' : '◯',
    profile: focused ? '👤' : '◯',
  };
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.iconText, { opacity: focused ? 1 : 0.5 }]}>
        {icons[name] || '◯'}
      </Text>
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: Colors.surface,
        borderTopColor: Colors.border,
        borderTopWidth: 1,
        paddingBottom: insets.bottom + 4,
        paddingTop: 8,
        height: 56 + insets.bottom,
      },
      tabBarLabelStyle: { fontSize: Typography.tiny, fontWeight: Typography.semibold, marginTop: 2 },
      tabBarActiveTintColor: Colors.primary,
      tabBarInactiveTintColor: Colors.ink30,
    }}>
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: t('nav.dashboard'), tabBarIcon: (p) => <TabIcon name="dashboard" {...p} /> }} />
      <Tab.Screen name="BadgeWallet" component={BadgeWalletScreen}
        options={{ tabBarLabel: t('nav.badges'), tabBarIcon: (p) => <TabIcon name="badges" {...p} /> }} />
      <Tab.Screen name="Community" component={CommunityScreen}
        options={{ tabBarLabel: 'Communauté', tabBarIcon: (p) => <TabIcon name="community" {...p} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarLabel: t('nav.profile'), tabBarIcon: (p) => <TabIcon name="profile" {...p} /> }} />
    </Tab.Navigator>
  );
}

function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { flex: 1, minHeight: 0 } }}>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen name="Lesson" component={LessonScreen}
        options={{ presentation: 'card', gestureEnabled: true }} />
      <Stack.Screen name="Payment" component={PaymentScreen}
        options={{ presentation: 'card', gestureEnabled: true }} />
      <Stack.Screen name="Quiz" component={QuizScreen}
        options={{ presentation: 'modal', gestureEnabled: false }} />
      <Stack.Screen name="Achievements" component={AchievementsScreen}
        options={{ presentation: 'card', gestureEnabled: true }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen}
        options={{ presentation: 'card', gestureEnabled: true }} />
      {/* v1.1.3 : inscription depuis le Profil (invité demandant une
          déconnexion) — il doit créer un compte pour sécuriser ses données
          avant de pouvoir se déconnecter. */}
      <Stack.Screen name="RegisterAccount" component={RegisterScreen}
        options={{ presentation: 'modal', gestureEnabled: false }} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { flex: 1, minHeight: 0 } }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      {/* Correctif : Onboarding doit être ATTEIGNABLE — c'est le seul écran
          qui appelle createLearner. Login/Register y naviguent après succès
          auth OU "Continuer hors ligne". */}
      <Stack.Screen name="Onboarding" component={OnboardingScreen}
        options={{ gestureEnabled: false }} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { learner, ready } = useDb();
  const { sessionEnded, user, restored } = useAuth();
  // v1.1.7 : session AUTHENTIFIÉE (compte Google/email/téléphone…).
  // NB : le mode invité (skipAuth) n'est PAS inclus — un invité qui a perdu
  // son profil local doit repasser par l'Onboarding (aucun prénom connu pour
  // le recréer) ; un utilisateur authentifié, lui, reste sur son Dashboard
  // (ensureSessionLearner recrée son profil depuis ek_user).
  const authedSession = !!user && !sessionEnded;

  // v1.1.7 : splash jusqu'à CE QUE la DB soit prête ET la session restaurée.
  // Avant, seul `ready` (DB) était attendu : si AuthContext terminait après
  // DbProvider (SecureStore lent), le gating décidait avec sessionEnded
  // encore à false (état initial) → flash d'écran / bascule tardive.
  if (!ready || !restored) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>EduKraft</Text>
        <Text style={styles.splashSub}>Chargement...</Text>
      </View>
    );
  }

  // GATING v3 (v1.1.7 - session-first) :
  //   - Pas de learner ET pas de session authentifiée -> Auth (premier
  //     lancement, ou invité sans données locales -> Onboarding)
  //   - sessionEnded (déconnexion volontaire) -> Auth (donnees conservees,
  //     restaurées à la reconnexion)
  //   - Learner OU session authentifiée -> Dashboard direct.
  //     ensureSessionLearner (DbProvider) garantit un learner dès qu'une
  //     session authentifiée existe ; le « || authedSession » est la ceinture
  //     de sécurité si même cette recreation échouait : un utilisateur
  //     authentifié ne retourne PAS à l'écran Login (dashboard jusqu'au logout).
  const showAuth = (!learner && !authedSession) || sessionEnded;

  return (
    <NavigationContainer>
      {/* cardStyle flex:1 + minHeight:0 — correctif WEB v1.1.4 : le CardSheet de
          @react-navigation/stack rend le conteneur d'écran avec minHeight:'100%'
          SANS contrainte max. Sur web (body en overflow:hidden), un écran plus
          haut que la fenêtre s'étirait au lieu de défiler → contenu coupé,
          défilement impossible (bouton « Continuer sans compte » invisible).
          minHeight:0 + flex:1 contraignent le card à la hauteur du viewport,
          le ScrollView interne déborde alors et le défilement fonctionne. */}
      <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { flex: 1, minHeight: 0 } }}>
        {showAuth ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : (
          <Stack.Screen name="Root" component={RootStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 18 },
  splash: {
    flex: 1, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  splashTitle: { fontSize: 36, fontWeight: Typography.bold, color: Colors.surface },
  splashSub: { fontSize: Typography.body, color: Colors.surface + 'AA' },
});
