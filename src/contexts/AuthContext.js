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

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [error, setError]     = useState(null);

  const clearError = useCallback(() => setError(null), []);

  const handleAuthSuccess = useCallback((data) => {
    setUser(data.user);
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

  // Skip = mode hors-ligne (pas de compte serveur)
  const skip = useCallback(async () => {
    setUser(null);
    setError(null);
  }, []);

  // Logout = supprime tokens serveur MAIS GARDE le learner local
  const logout = useCallback(async () => {
    try { await authService.clearAll(); } catch (_) {}
    setUser(null);
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
