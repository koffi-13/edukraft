// src/contexts/AuthContext.js
// Contexte React d'authentification EduKraft.
//
// Exposé via le hook useAuth() :
//   - state : { user, loading, error, isAuthenticated, skipAuth }
//   - actions : login, register, loginGoogle, loginApple, loginFacebook,
//               loginPhone, skip, logout, refreshUser, clearError
//
// Au montage :
//   1. Lit les tokens depuis expo-secure-store (ou fallback mémoire)
//   2. Si un access token existe → GET /api/auth/me pour valider et récupérer le user
//   3. Si skipAuth est actif → mode hors-ligne (pas de token)
//   4. Sinon → user = null (l'utilisateur devra se connecter)

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [skipAuth, setSkipAuth]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const initialized               = useRef(false);

  // ── Initialisation : restaurer la session depuis le storage ──────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        const stored = await authService.getStoredAuth();

        // Mode "continuer sans compte"
        if (stored.skipAuth) {
          setSkipAuth(true);
          setUser(null);
          setLoading(false);
          return;
        }

        // Session existante → valider via /me
        if (stored.accessToken) {
          try {
            const freshUser = await authService.me();
            setUser(freshUser);
          } catch (err) {
            // Token invalide/expiré et refresh échoué → déconnecté
            // (authService.me() tente déjà le refresh automatique)
            console.warn('[Auth] Session invalide:', err.message);
            setUser(null);
          }
        }
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
      // En mode "send", on ne reçoit pas de user → pas de handleAuthSuccess
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
    await authService.skip();
    setSkipAuth(true);
    setUser(null);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
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
      // Si le refresh échoue, on déconnecte
      setUser(null);
      setSkipAuth(false);
      throw e;
    }
  }, []);

  // ── Valeur du contexte ───────────────────────────────────────────────────
  const value = {
    // State
    user,
    skipAuth,
    loading,
    error,
    isAuthenticated: !!user,
    // Actions
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

// ── Hook ────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
