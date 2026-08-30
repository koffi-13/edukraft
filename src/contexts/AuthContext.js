// src/contexts/AuthContext.js
// Authentification SIMPLIFIÉE — le learner local est la seule source de vérité.
//
// L'authentification serveur est OPTIONNELLE (backup dans "Mes informations").
// L'app fonctionne entièrement en local après la première utilisation.
//
// Flux :
//   1. Premier lancement → LoginScreen (avec "Continuer hors ligne")
//   2. Hors ligne → Onboarding → Dashboard (learner local créé)
//   3. Email login → Onboarding → Dashboard (learner local + tokens serveur)
//   4. Redémarrage → Dashboard direct (learner local trouvé)
//   5. Déconnexion → Dashboard (learner local conservé, tokens supprimés)
//
// v1.1 (correctifs) :
//   - L'état { user, skipAuth } est RESTAURÉ au démarrage depuis le storage
//     (getStoredAuth) — plus d'état fantôme après restart.
//   - logout() appelle authService.logout() (révocation serveur + clearAll,
//     désormais exporté) SANS toucher au learner local (ek_learner).
//   - skip() persiste le flag ek_skip_auth (mode hors-ligne détectable).
//
// v1.1.3 (persistance hors-ligne — cahier des charges) :
//   - Nouvel état sessionEnded : « l'utilisateur s'est déconnecté
//     volontairement ». Il est restauré au démarrage et utilisé par le gating
//     de AppNavigator : learner && !sessionEnded → Dashboard direct ;
//     learner && sessionEnded → écran Login (données locales conservées).
//   - Toute authentification réussie (login / register / Google / OTP…)
//     ré-ouvre la session (sessionEnded = false).
//   - « Continuer sans compte » reprend la session locale existante.
//
// v1.1.7 (session-first) :
//   - Nouveau dérivé sessionActive = (user || skipAuth) && !sessionEnded.
//     EXIGENCE : « l'utilisateur doit TOUJOURS voir son dashboard jusqu'à ce
//     qu'il se déconnecte ». Le gating de AppNavigator ne renvoie vers l'écran
//     Login QUE si aucune session active n'existe. Combiné au
//     ensureSessionLearner de DbProvider (recréation du profil de secours
//     depuis ek_user), l'écran Login devient impossible tant que la session
//     est ouverte — même si une couche de stockage échoue.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [skipAuth, setSkipAuth]   = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [restored, setRestored]   = useState(false);
  const [error, setError]         = useState(null);

  const clearError = useCallback(() => setError(null), []);

  // ── Restauration de la session au démarrage (non bloquante) ────────────
  // v1.1.3 : la navigation dépend du couple (learner local, sessionEnded) :
  //   - learner && !sessionEnded → Dashboard direct (auto-chargement du
  //     profil invité et de ses progressions — cahier des charges)
  //   - learner && sessionEnded  → écran Login (déconnexion volontaire : les
  //     données restent sur l'appareil, restaurées à la reconnexion)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await authService.getStoredAuth();
        if (!mounted) return;
        if (stored && stored.user) setUser(stored.user);
        if (stored && stored.skipAuth) setSkipAuth(true);
        if (stored && stored.sessionEnded) setSessionEnded(true);
      } catch (_) {
        // Storage indisponible → mode invité, non bloquant
      } finally {
        if (mounted) setRestored(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleAuthSuccess = useCallback((data) => {
    setUser(data.user);
    setSkipAuth(false);
    setSessionEnded(false); // reconnexion → session ré-ouverte
    setError(null);
  }, []);

  const login = useCallback(async (credentials) => {
    setError(null);
    try {
      const data = await authService.login(credentials);
      handleAuthSuccess(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  const register = useCallback(async (payload) => {
    setError(null);
    try {
      const data = await authService.register(payload);
      handleAuthSuccess(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  const loginGoogle = useCallback(async (idToken) => {
    setError(null);
    try {
      const data = await authService.loginGoogle(idToken);
      handleAuthSuccess(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  const loginApple = useCallback(async (payload) => {
    setError(null);
    try {
      const data = await authService.loginApple(payload);
      handleAuthSuccess(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  const loginFacebook = useCallback(async (accessToken) => {
    setError(null);
    try {
      const data = await authService.loginFacebook(accessToken);
      handleAuthSuccess(data);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  const loginPhone = useCallback(async (params) => {
    setError(null);
    try {
      const data = await authService.loginPhone(params);
      if (params.action === 'verify' && data.user) {
        handleAuthSuccess(data);
      }
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [handleAuthSuccess]);

  // Skip = mode hors-ligne (pas de compte serveur). On persiste le flag
  // pour que ProfileScreen l'affiche correctement après un restart.
  // v1.1.3 : skip REPREND la session locale — si un learner existe déjà
  // (ex : utilisateur déconnecté qui revient sans se connecter), ses
  // données sont rechargées automatiquement (sessionEnded retiré).
  const skip = useCallback(async () => {
    setUser(null);
    setError(null);
    try {
      await authService.skip();
    } catch (_) {}
    setSkipAuth(true);
    setSessionEnded(false);
  }, []);

  // Logout = supprime les tokens serveur MAIS GARDE le learner local et
  // toutes ses progressions. v1.1.3 : marque la session terminée → l'écran
  // Login s'affiche (fin de session réelle), les données locales attendent
  // la reconnexion pour être restaurées.
  const logout = useCallback(async () => {
    try {
      await authService.logout(); // révocation serveur + clearAll + markSessionEnded
    } catch (_) {
      // Réseau indisponible : on force au moins le nettoyage local
      try {
        await authService.clearAll();
        await authService.markSessionEnded();
      } catch (_) {}
    }
    setUser(null);
    setSkipAuth(false);
    setSessionEnded(true);
    setError(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const freshUser = await authService.me();
      setUser(freshUser);
      return freshUser;
    } catch (e) {
      throw e;
    }
  }, []);

  const value = {
    user,
    skipAuth,
    sessionEnded,
    restored,
    error,
    isAuthenticated: !!user,
    // v1.1.7 : session active = authentifié OU invité assumé, sans logout.
    // NB : le gating de AppNavigator utilise la variante AUTHENTIFIÉE
    // (!!user) — un invité sans learner local retourne à l'Onboarding.
    sessionActive: (!!user || skipAuth) && !sessionEnded,
    login, register,
    loginGoogle, loginApple, loginFacebook, loginPhone,
    skip, logout, refreshUser, clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
