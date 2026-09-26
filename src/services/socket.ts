import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOCKET_URL } from '../config/api';

type Listener = (...args: any[]) => void;

class SocketService {
  private socket: Socket | null = null;
  // Listeners enregistrés AVANT la connexion (les effets enfants s'exécutent
  // avant l'effet parent qui appelle connect()).
  private listeners: { event: string; fn: Listener }[] = [];

  async connect() {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        // Reconnexion active : une coupure transitoire (mémoire, tunnel) ne
        // doit pas tuer le socket définitivement — la reconnexion rejoue
        // l'authentification automatiquement (handler 'connect' ci-dessous).
        reconnection: true,
      });

      // Réattacher les listeners déjà enregistrés
      this.listeners.forEach(({ event, fn }) => this.socket?.on(event, fn as any));

      this.socket.on('connect', () => {
        console.log('🔌 Socket connecté');
        this.socket?.emit('authenticate', token);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('🔌 Socket déconnecté:', reason);
      });

      this.socket.on('connect_error', (err) => {
        console.warn('🔌 Socket error:', err.message);
      });
    } catch (e) {
      console.warn('Socket connect error:', e);
    }
  }

  disconnect() {
    try {
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }
    } catch (e) {
      console.warn('Socket disconnect error:', e);
    }
    this.socket = null;
    this.listeners = [];
  }

  joinTicket(ticketId: number) {
    this.socket?.emit('join-ticket', ticketId);
  }

  leaveTicket(ticketId: number) {
    this.socket?.emit('leave-ticket', ticketId);
  }

  sendMessage(ticketId: number, message: any) {
    this.socket?.emit('chat-message', { ticketId, message });
  }

  startTyping(ticketId: number, userId: number) {
    this.socket?.emit('typing', { ticketId, userId });
  }

  stopTyping(ticketId: number, userId: number) {
    this.socket?.emit('stop-typing', { ticketId, userId });
  }

  // ----- Appels : la sonnerie passe par Socket.IO, le média par PeerJS -----
  callUser(targetUserId: number, callType: string, ticketId: number) {
    this.socket?.emit('call-user', { targetUserId, callType, ticketId });
  }

  acceptCall(targetUserId: number, ticketId: number) {
    this.socket?.emit('accept-call', { targetUserId, ticketId });
  }

  rejectCall(targetUserId: number, ticketId: number) {
    this.socket?.emit('reject-call', { targetUserId, ticketId });
  }

  endCall(targetUserId: number, ticketId: number) {
    this.socket?.emit('end-call', { targetUserId, ticketId });
  }

  startScreenShare(ticketId: number) {
    this.socket?.emit('screen-share-start', { ticketId });
  }

  stopScreenShare(ticketId: number) {
    this.socket?.emit('screen-share-stop', { ticketId });
  }

  on(event: string, callback: Listener) {
    if (this.listeners.some((l) => l.event === event && l.fn === callback)) return;
    this.listeners.push({ event, fn: callback });
    this.socket?.on(event, callback as any);
  }

  off(event: string, callback?: Listener) {
    if (callback) {
      this.listeners = this.listeners.filter((l) => !(l.event === event && l.fn === callback));
      this.socket?.off(event, callback as any);
    } else {
      this.listeners = this.listeners.filter((l) => l.event !== event);
      this.socket?.removeAllListeners(event);
    }
  }

  getSocket() {
    return this.socket;
  }
}

const socketService = new SocketService();
export default socketService;
