// src/contexts/AuthContext.js
// Contexte React d'authentification EduKraft.
//
// Logique :
//   1. Au démarrage, vérifier si un learner local existe (AsyncStorage)
//   2. Si learner existe → Dashboard direct (hors ligne ou en ligne)
//   3. Si pas de learner → écran de login (avec "Continuer hors ligne")
//   4. Hors ligne : créer un learner local → Dashboard
//   5. En ligne : auth serveur + learner local → Dashboard
//   6. Dans "Mes informations" : option pour créer un compte en ligne

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [skipAuth, setSkipAuth]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const initialized               = useRef(false);

  // ── Initialisation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        // 1. Vérifier si un learner local existe (AsyncStorage)
        let learnerExists = false;
        try {
          const AsyncStorage = require('@react-native-async-storage/async-storage');
          const storedLearner = await AsyncStorage.getItem('ek_learner');
          if (storedLearner) {
            learnerExists = true;
          }
        } catch (_) {}

        // 2. Vérifier les tokens d'auth (SecureStore + AsyncStorage)
        const stored = await authService.getStoredAuth();

        if (stored.accessToken && stored.user) {
          // L'utilisateur s'est connecté en ligne avant
          setUser(stored.user);
          setSkipAuth(false);
          setLoading(false);

          // Valider le token en arrière-plan (non-bloquant)
          authService.me()
            .then(freshUser => { if (freshUser) setUser(freshUser); })
            .catch(() => {
              // Token expiré — on garde le user local
              console.log('[Auth] Token expiré, utilisation du user local');
            });
          return;
        }

        // 3. Si learner existe mais pas de token → mode hors-ligne
        if (learnerExists) {
          setSkipAuth(true);
          setLoading(false);
          return;
        }

        // 4. Pas de learner, pas de token → écran de login
      } catch (e) {
        console.warn('[Auth] Init error:', e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const clearError = useCallback(() => setError(null), []);

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

  const skip = useCallback(async () => {
    try {
      await authService.skip();
    } catch (e) {
      console.warn('[Auth] skip storage error (non-fatal):', e.message);
    }
    setSkipAuth(true);
    setUser(null);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    // Supprimer les tokens mais GARDER le learner local
    try { await authService.clearAll(); } catch (_) {}
    setUser(null);
    setError(null);
    // NE PAS mettre skipAuth = false ici — le AppNavigator vérifie aussi
    // si le learner existe. Si on met skipAuth = false, l'utilisateur
    // retourne à l'écran de login même si son learner existe.
    // Le AppNavigator a la logique : hasAccess = isAuthenticated || skipAuth || !!learner
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const freshUser = await authService.me();
      setUser(freshUser);
      return freshUser;
    } catch (e) {
      setUser(null);
      throw e;
    }
  }, []);

  // ── Valeur du contexte ───────────────────────────────────────────────────
  const value = {
    user,
    skipAuth,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    register,
    loginGoogle,
    loginApple,
    loginFacebook,
    loginPhone,
    skip,
    logout,
    refreshUser,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
