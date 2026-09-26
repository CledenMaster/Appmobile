import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from '../services/api';
import socketService from '../services/socket';
import peerService from '../services/peer';

type User = {
  id: number;
  nom: string;
  email: string;
  role: 'client' | 'technicien';
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (data: any) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  socket: typeof socketService;
  peer: typeof peerService;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isLoggingOut = useRef(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user && !isLoggingOut.current) {
      socketService.connect();
      peerService.initialize(user.id).catch((e: any) => {
        console.warn('Peer init non-critique:', e?.message || e);
      });
    }
    return () => {};
  }, [user]);

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const userData = await AsyncStorage.getItem('user');
      if (token && userData) {
        setUser(JSON.parse(userData));
      }
    } catch (e) {
      console.error('Auth check error:', e);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await authAPI.login(email, password);
      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.response?.data?.error || 'Erreur de connexion' };
    }
  };

  const register = async (data: any) => {
    try {
      const res = await authAPI.register(data);
      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.response?.data?.error || "Erreur d'inscription" };
    }
  };

  const logout = async () => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;

    // 1. Déconnecter socket et peer en premier
    try { socketService.disconnect(); } catch {}
    try { peerService.destroy(); } catch {}

    // 2. Nettoyer le stockage
    try {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
    } catch {}

    // 3. Mettre à jour l'état en dernier
    setUser(null);

    // Reset le flag après un délai pour permettre la reconnexion si besoin
    setTimeout(() => { isLoggingOut.current = false; }, 1000);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, socket: socketService, peer: peerService }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
