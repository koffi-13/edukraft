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

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [skipAuth, setSkipAuth]   = useState(false);
  const [restored, setRestored]   = useState(false);
  const [error, setError]         = useState(null);

  const clearError = useCallback(() => setError(null), []);

  // ── Restauration de la session au démarrage (non bloquante) ────────────
  // Navigation ne dépend PAS de cet état (elle dépend du learner local),
  // mais ProfileScreen a besoin de savoir si l'utilisateur a un compte
  // serveur (user) ou est en mode hors-ligne (skipAuth).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await authService.getStoredAuth();
        if (!mounted) return;
        if (stored && stored.user) setUser(stored.user);
        if (stored && stored.skipAuth) setSkipAuth(true);
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
  const skip = useCallback(async () => {
    setUser(null);
    setError(null);
    try {
      await authService.skip();
      setSkipAuth(true);
    } catch (_) {
      setSkipAuth(true);
    }
  }, []);

  // Logout = supprime les tokens serveur MAIS GARDE le learner local.
  // authService.logout() ne touche PAS à la clé 'ek_learner' ni aux données
  // de progression ('ek_progress', 'ek_badges').
  const logout = useCallback(async () => {
    try {
      await authService.logout(); // révocation serveur + clearAll (tokens/user/skip)
    } catch (_) {
      // Réseau indisponible : on force au moins le nettoyage local
      try { await authService.clearAll(); } catch (_) {}
    }
    setUser(null);
    setSkipAuth(false);
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
    restored,
    error,
    isAuthenticated: !!user,
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
