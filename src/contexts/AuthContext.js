// src/contexts/AuthContext.js
// Contexte React d'authentification EduKraft.
//
// Logique :
//   1. Au démarrage, lire les tokens depuis SecureStore
//   2. Si token existe :
//      a. Online → valider via /api/auth/me (refresh auto si expiré)
//      b. Offline → accès direct avec le user stocké localement (pas d'appel serveur)
//   3. Si pas de token → écran de login (PAS de mode "continuer sans compte")
//   4. Session persistante : 7j (access) + 30j (refresh)
//   5. Après 30j d'inactivité → l'utilisateur doit se reconnecter

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

// Détecter la connexion réseau (offline-first)
async function isOnline() {
  try {
    const NetworkModule = require('expo-network');
    const state = await NetworkModule.getNetworkStateAsync();
    return !!state.isInternetReachable;
  } catch (_) {
    // Si expo-network n'est pas dispo, supposer online
    return true;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
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

        if (stored.accessToken && stored.user) {
          // L'utilisateur a des tokens locaux — accès garanti
          // On utilise le user local IMMÉDIATEMENT (pas d'attente serveur)
          setUser(stored.user);
          setLoading(false);

          // En arrière-plan, valider le token si online (non-bloquant)
          const online = await isOnline();
          if (online) {
            authService.me()
              .then(freshUser => {
                if (freshUser) setUser(freshUser);
              })
              .catch(err => {
                console.warn('[Auth] Token validation failed (non-blocking):', err.message);
                // On garde le user local — pas de déconnexion
              });
          }
          return;
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

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setError(null);
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
    // State
    user,
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
