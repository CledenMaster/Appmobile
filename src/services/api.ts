import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Ajouter le token à chaque requête
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Gérer l'expiration du token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeMany(['token', 'user']);
    }
    return Promise.reject(error);
  }
);

// ===== Auth =====
export const authAPI = {
  register: (data: { nom: string; email: string; mot_de_passe: string; role: string }) =>
    api.post('/auth/register', data),
  login: (email: string, mot_de_passe: string) =>
    api.post('/auth/login', { email, mot_de_passe }),
  getMe: () => api.get('/auth/me'),
};

// ===== Tickets =====
export const ticketsAPI = {
  getAll: () => api.get('/api/tickets'),
  getById: (id: number) => api.get(`/api/tickets/${id}`),
  create: (data: { categorie: string; description: string }) =>
    api.post('/api/tickets', data),
  accept: (id: number) => api.post(`/api/tickets/${id}/accept`),
  close: (id: number) => api.post(`/api/tickets/${id}/close`),
};

// ===== Chat =====
export const chatAPI = {
  getMessages: (ticketId: number) => api.get(`/api/chat/${ticketId}`),
  sendMessage: (ticketId: number, contenu: string) =>
    api.post(`/api/chat/${ticketId}`, { contenu }),
};

// ===== Fichiers =====
export const filesAPI = {
  upload: (ticketId: number, formData: FormData) =>
    api.post(`/api/files/upload/${ticketId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // upload possible jusqu'à 50 Mo
    }),
  getByTicket: (ticketId: number) => api.get(`/api/files/${ticketId}`),
  remove: (fileId: number) => api.delete(`/api/files/${fileId}`),
};

// ===== Interventions =====
export const interventionsAPI = {
  getAll: () => api.get('/api/interventions'),
  getStats: () => api.get('/api/interventions/stats'),
  start: (ticketId: number, type?: string) =>
    api.post('/api/interventions/start', { ticket_id: ticketId, type }),
  end: (id: number) => api.post(`/api/interventions/${id}/end`),
};

// ===== Techniciens =====
export const techniciensAPI = {
  getAll: () => api.get('/api/techniciens'),
};

export default api;
