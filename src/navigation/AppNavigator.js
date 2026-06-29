// src/navigation/AppNavigator.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing } from '../theme';
import { t } from '../i18n';

// Screens
import DashboardScreen  from '../screens/DashboardScreen';
import LessonScreen     from '../screens/LessonScreen';
import QuizScreen       from '../screens/QuizScreen';
import BadgeWalletScreen from '../screens/BadgeWalletScreen';
import ProfileScreen    from '../screens/ProfileScreen';
import PaymentScreen     from '../screens/PaymentScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { useDb }        from '../database/DbProvider';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

// ── SVG Icons inline (pas d'assets externes — perf Android Go) ──────────────
function TabIcon({ name, focused, color }) {
  const icons = {
    dashboard: focused
      ? '⬛' : '□',
    learn:   focused ? '📖' : '📄',
    badges:  focused ? '🏅' : '🏷️',
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

// ── Main Tab Navigator ────────────────────────────────────────────────────────
function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor:   Colors.surface,
          borderTopColor:    Colors.border,
          borderTopWidth:    1,
          paddingBottom:     insets.bottom + 4,
          paddingTop:        8,
          height:            56 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize:   Typography.tiny,
          fontWeight: Typography.semibold,
          marginTop:  2,
        },
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.ink30,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: t('nav.dashboard'),
          tabBarIcon: (props) => <TabIcon name="dashboard" {...props} />,
        }}
      />
      <Tab.Screen
        name="BadgeWallet"
        component={BadgeWalletScreen}
        options={{
          tabBarLabel: t('nav.badges'),
          tabBarIcon: (props) => <TabIcon name="badges" {...props} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('nav.profile'),
          tabBarIcon: (props) => <TabIcon name="profile" {...props} />,
        }}
      />
    </Tab.Navigator>
  );
}

// ── Root Stack (inclut les écrans de leçon) ───────────────────────────────────
function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main"    component={MainTabs} />
      <Stack.Screen name="Lesson"  component={LessonScreen}
        options={{ presentation: 'card', gestureEnabled: true }}
      />
      <Stack.Screen name="Payment" component={PaymentScreen}
        options={{ presentation: 'card', gestureEnabled: true }}
      />
      <Stack.Screen name="Quiz"    component={QuizScreen}
        options={{ presentation: 'modal', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}

// ── App Navigator : gère l'onboarding ────────────────────────────────────────
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

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!learner ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
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
    flex:            1,
    backgroundColor: Colors.primary,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             Spacing.sm,
  },
  splashTitle: {
    fontSize:   36,
    fontWeight: Typography.bold,
    color:      Colors.surface,
  },
  splashSub: {
    fontSize: Typography.body,
    color:    Colors.surface + 'AA',
  },
});
