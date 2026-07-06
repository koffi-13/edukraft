// src/navigation/AppNavigator.js
// Navigation simplifiée — le learner local est la seule source de vérité.
//
// Logique :
//   1. DB pas prête → splash
//   2. Pas de learner local → Login (avec "Continuer hors ligne")
//   3. Learner existe → Dashboard direct
//
// PAS de isAuthenticated, PAS de skipAuth, PAS de tokens.
// Le serveur est optionnel (backup uniquement).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing } from '../theme';
import { t } from '../i18n';

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
        {icons[name]}
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { learner, ready } = useDb();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>EduKraft</Text>
        <Text style={styles.splashSub}>Chargement...</Text>
      </View>
    );
  }

  // SIMPLIFIÉ : learner existe → Dashboard. Pas de learner → Login.
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!learner ? (
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
