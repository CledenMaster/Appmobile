import { mediaDevices } from 'react-native-webrtc';
import { PEER_CONFIG } from '../config/api';

const ANSWER_TIMEOUT = 30000;

class PeerService {
  private peer: any = null;
  private currentCall: any = null;
  private screenCall: any = null;
  private userId: number | null = null;
  private incomingHandler: ((call: any) => void) | null = null;
  // Appel reçu avant l'enregistrement du handler (course entre navigation et WebSocket)
  private pendingIncoming: any = null;
  // Appel de partage d'écran entrant (les deux côtés sont sur CallScreen au démarrage du partage)
  private screenHandler: ((call: any) => void) | null = null;
  // Appelé quand l'appel de partage se ferme (côté émetteur OU récepteur)
  private screenClosedHandler: (() => void) | null = null;

  initialize(userId: number): Promise<void> {
    this.userId = userId;
    return Promise.resolve();
  }

  /** Handler d'appel entrant ; les appels mis en tampon sont livrés immédiatement. */
  set onIncomingCall(handler: ((call: any) => void) | null) {
    this.incomingHandler = handler;
    if (handler && this.pendingIncoming) {
      const call = this.pendingIncoming;
      this.pendingIncoming = null;
      handler(call);
    }
  }

  get onIncomingCall(): ((call: any) => void) | null {
    return this.incomingHandler;
  }

  set onScreenCall(handler: ((call: any) => void) | null) {
    this.screenHandler = handler;
  }

  get onScreenCall(): ((call: any) => void) | null {
    return this.screenHandler;
  }

  set onScreenClosed(handler: (() => void) | null) {
    this.screenClosedHandler = handler;
  }

  get onScreenClosed(): (() => void) | null {
    return this.screenClosedHandler;
  }

  /** Ouvre la connexion PeerJS (lazy). Résout false si le serveur est injoignable. */
  private ensurePeer(): Promise<boolean> {
    if (this.peer?.open) return Promise.resolve(true);
    if (!this.userId) return Promise.resolve(false);
    if (this.peer) return Promise.resolve(this.peer.open === true);

    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      try {
        // Import dynamique pour éviter les erreurs au chargement
        const PeerConstructor = require('peerjs').default;
        const peer = new PeerConstructor(`assistit_${this.userId}`, {
          host: PEER_CONFIG.host,
          port: PEER_CONFIG.port,
          // Slash final OBLIGATOIRE : PeerJS concatène path + "peerjs" sans séparateur.
          path: '/peerjs/',
          secure: false,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              // Relais TURN auto-hébergé (coturn dans Docker) : les deux
              // appareils (émulateur + BlueStacks) sont derrière des NAT
              // différents sur la même machine — le hairpin STUN échoue,
              // seul le relais traverse. Les serveurs TURN publics PeerJS
              // sont morts (NXDOMAIN). UDP d'abord, TCP en secours.
              // IP de l'hôte = LAN (les VMs ne peuvent pas atteindre le
              // localhost de l'hôte autrement en UDP — adb reverse = TCP).
              {
                urls: [
                  'turn:192.168.1.12:3478?transport=udp',
                  'turn:192.168.1.12:3478?transport=tcp',
                ],
                username: 'assistit',
                credential: 'Passw0rdTURN',
              },
            ],
          },
        });
        this.peer = peer;

        peer.on('open', (id: string) => {
          console.log('📹 Peer ID:', id);
          done(true);
        });

        peer.on('call', (call: any) => {
          // Partage d'écran : répondu automatiquement, SANS écraser l'appel principal
          if (call.metadata && call.metadata.kind === 'screen') {
            if (this.screenHandler) {
              this.screenHandler(call);
            } else {
              try {
                call.close();
              } catch {
                // Ignorer
              }
            }
            return;
          }
          console.log('📹 Appel entrant de:', call.peer);
          this.currentCall = call;
          if (this.incomingHandler) {
            this.incomingHandler(call);
          } else {
            this.pendingIncoming = call;
          }
        });

        peer.on('error', (err: any) => {
          console.warn('Peer error:', err?.type || err?.message || 'unknown');
          done(false);
        });

        peer.on('disconnected', () => {
          try {
            peer.reconnect();
          } catch {
            // Ignorer
          }
        });

        // Ne jamais bloquer l'appel sur la connexion PeerJS
        setTimeout(() => done(false), 5000);
      } catch (e) {
        console.warn('Peer creation error:', e);
        resolve(false);
      }
    });
  }

  /** À appeler avant de participer à un appel (ouvre le Peer si nécessaire). */
  connect(): Promise<boolean> {
    return this.ensurePeer();
  }

  /** Émet un appel et résout avec le flux distant (ou reject après échec/timeout). */
  async callUser(targetUserId: number, stream: any, callType = 'video'): Promise<any> {
    const ok = await this.ensurePeer();
    if (!ok || !this.peer) {
      throw new Error("Serveur d'appel injoignable");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onPeerError = (err: any) => {
        if (err?.type === 'peer-unavailable') {
          finish(new Error("L'utilisateur est injoignable (app fermée ?)"));
        }
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        try {
          this.peer?.off?.('error', onPeerError);
        } catch {
          // Ignorer
        }
      };

      const finish = (err: Error | null, remoteStream?: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(remoteStream);
      };

      let call: any = null;
      try {
        call = this.peer.call(`assistit_${targetUserId}`, stream, {
          metadata: { callType },
        });
      } catch (e: any) {
        finish(e instanceof Error ? e : new Error(String(e?.message || e)));
        return;
      }
      if (!call) {
        finish(new Error("Échec de l'appel"));
        return;
      }

      this.currentCall = call;
      this.peer.on('error', onPeerError);
      timer = setTimeout(
        () => finish(new Error("Pas de réponse de l'autre appareil")),
        ANSWER_TIMEOUT,
      );

      call.on('stream', (remoteStream: any) => finish(null, remoteStream));
      call.on('error', (err: any) =>
        finish(err instanceof Error ? err : new Error(String(err?.message || err))),
      );
      call.on('close', () => finish(new Error('Appel fermé par le distant')));
    });
  }

  /** Flux commun : répondre à un appel (principal ou partage) et attendre le flux distant. */
  private answerFlow(call: any, stream: any, slot: 'main' | 'screen'): Promise<any> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (err: Error | null, remoteStream?: any) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve(remoteStream);
      };

      try {
        call.answer(stream);
      } catch (e: any) {
        finish(e instanceof Error ? e : new Error(String(e?.message || e)));
        return;
      }
      if (slot === 'main') {
        this.currentCall = call;
      } else {
        this.screenCall = call;
        this.watchScreenClose(call);
      }
      timer = setTimeout(() => finish(new Error('Flux distant non reçu')), ANSWER_TIMEOUT);

      call.on('stream', (remoteStream: any) => finish(null, remoteStream));
      call.on('error', (err: any) =>
        finish(err instanceof Error ? err : new Error(String(err?.message || err))),
      );
      call.on('close', () => finish(new Error('Appel fermé par le distant')));
    });
  }

  /** Répond à un appel entrant et résout avec le flux distant. */
  answerCall(call: any, stream: any): Promise<any> {
    return this.answerFlow(call, stream, 'main');
  }

  /** Répond à un appel de partage d'écran et résout avec le flux distant. */
  answerScreen(call: any, stream: any): Promise<any> {
    return this.answerFlow(call, stream, 'screen');
  }

  /** Signale la fermeture de l'appel de partage (quel que soit le rôle). */
  private watchScreenClose(call: any) {
    call.on('close', () => {
      if (this.screenCall === call) {
        this.screenCall = null;
      }
      if (this.screenClosedHandler) {
        this.screenClosedHandler();
      }
    });
  }

  /** Lance un partage d'écran vers un pair (le flux doit venir de getScreenStream()). */
  async shareScreen(targetUserId: number, stream: any): Promise<void> {
    const ok = await this.ensurePeer();
    if (!ok || !this.peer) {
      throw new Error("Serveur d'appel injoignable");
    }
    const call = this.peer.call(`assistit_${targetUserId}`, stream, {
      metadata: { kind: 'screen' },
    });
    if (!call) {
      throw new Error("Échec du partage d'écran");
    }
    this.screenCall = call;
    this.watchScreenClose(call);
    call.on('error', (err: any) => {
      console.warn('Screen share error:', err?.message || err);
    });
  }

  /** Ferme l'appel de partage (émetteur OU récepteur) ; la fermeture se propage aux deux côtés. */
  closeScreen() {
    try {
      if (this.screenCall && typeof this.screenCall.close === 'function') {
        this.screenCall.close();
      }
    } catch {
      // Ignorer
    }
    this.screenCall = null;
  }

  endCall() {
    try {
      if (this.currentCall && typeof this.currentCall.close === 'function') {
        this.currentCall.close();
      }
    } catch {
      // Ignorer
    }
    this.currentCall = null;
    // L'appel principal se termine : le partage d'écran ne peut pas survivre seul
    this.closeScreen();
  }

  async getLocalStream(video = true, audio = true) {
    if (!mediaDevices?.getUserMedia) {
      throw new Error('Media non disponible sur cet appareil');
    }
    return mediaDevices.getUserMedia({
      audio,
      // 480p@15fps : le 720p faisait planter BlueStacks (HD-Player 0xc0000409)
      // en pleine transmission vidéo, et l'hôte (8 Go, deux émulateurs + Docker)
      // ne tient pas le encode/decode 720p des deux côtés.
      video: video
        ? {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 24 },
          }
        : false,
    });
  }

  async getScreenStream() {
    if (!mediaDevices?.getDisplayMedia) {
      throw new Error("Partage d'écran non disponible");
    }
    return mediaDevices.getDisplayMedia({});
  }

  destroy() {
    try {
      this.endCall();
      if (this.peer && typeof this.peer.destroy === 'function') {
        this.peer.destroy();
      }
    } catch {
      // Ignorer les erreurs de destruction
    }
    this.peer = null;
    this.userId = null;
    this.incomingHandler = null;
    this.pendingIncoming = null;
    this.screenHandler = null;
    this.screenClosedHandler = null;
    this.screenCall = null;
  }
}

const peerService = new PeerService();
export default peerService;
