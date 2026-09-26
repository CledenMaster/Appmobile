import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../context/AuthContext';
import peerService from '../services/peer';
import { interventionsAPI } from '../services/api';

type CallStatus = 'ringing' | 'connecting' | 'connected' | 'ended';

const formatDuration = (total: number): string => {
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const statusLabelFor = (status: CallStatus, duration: number): string => {
  if (status === 'connected') return formatDuration(duration);
  if (status === 'ringing') return 'Sonnerie en cours…';
  if (status === 'connecting') return 'Connexion…';
  return 'Appel terminé';
};

/**
 * Écran d'appel audio/vidéo + partage d'écran.
 * - mode 'caller' : émis depuis TicketDetail, sonne chez l'autre partie puis appelle via PeerJS.
 * - mode 'callee' : ouvert après acceptation de l'appel entrant (Alert dans AppNavigator).
 * - partage d'écran : second appel PeerJS avec metadata kind:'screen', répondu automatiquement.
 * La sonnerie passe par Socket.IO, les médias par PeerJS/WebRTC.
 */
const CallScreen = ({ route, navigation }: any) => {
  const { ticketId, callType = 'video', targetUserId, mode = 'caller' } = route.params ?? {};
  const { socket } = useAuth();

  const [status, setStatus] = useState<CallStatus>(mode === 'callee' ? 'connecting' : 'ringing');
  const [duration, setDuration] = useState(0);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [screenStream, setScreenStream] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(callType === 'video');

  const localStreamRef = useRef<any>(null);
  const screenLocalRef = useRef<any>(null);
  const sharingRef = useRef(false);
  const interventionIdRef = useRef<number | null>(null);
  const screenInterventionRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const connectedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isVideo = callType === 'video';

  const cleanup = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    peerService.onIncomingCall = null;
    peerService.onScreenCall = null;
    peerService.onScreenClosed = null;

    // Partage d'écran actif : couper les tracks + l'intervention associée
    if (sharingRef.current) {
      sharingRef.current = false;
      const ss = screenLocalRef.current;
      screenLocalRef.current = null;
      try {
        ss?.getTracks?.().forEach((track: any) => track.stop());
      } catch {
        // Ignorer
      }
    }
    const screenId = screenInterventionRef.current;
    screenInterventionRef.current = null;
    if (screenId) {
      interventionsAPI.end(screenId).catch(() => {
        // Historique best-effort
      });
    }

    try {
      localStreamRef.current?.getTracks?.().forEach((track: any) => track.stop());
    } catch {
      // Ignorer
    }
    localStreamRef.current = null;
    // endCall ferme aussi l'appel de partage éventuel (peer.ts)
    peerService.endCall();

    const interventionId = interventionIdRef.current;
    interventionIdRef.current = null;
    if (interventionId) {
      interventionsAPI.end(interventionId).catch(() => {
        // Historique best-effort : un échec réseau ne doit pas bloquer l'écran
      });
    }
  }, []);

  /** Termine l'appel, prévient éventuellement le distant puis quitte l'écran. */
  const finish = useCallback(
    (message?: string, notifyRemote = false) => {
      if (endedRef.current) return;
      endedRef.current = true;
      if (notifyRemote && targetUserId) {
        socket.endCall(targetUserId, ticketId);
      }
      cleanup();
      if (message) {
        setStatus('ended');
        Alert.alert('Appel', message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        navigation.goBack();
      }
    },
    [socket, targetUserId, ticketId, cleanup, navigation],
  );

  const hangUp = useCallback(() => finish(undefined, true), [finish]);

  const markConnected = useCallback(() => {
    if (endedRef.current || connectedRef.current) return;
    connectedRef.current = true;
    setStatus('connected');
    if (!timerRef.current) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    }
    // Une seule ligne d'historique par appel : créée par l'appelant
    if (mode === 'caller' && interventionIdRef.current === null) {
      interventionsAPI
        .start(ticketId, callType)
        .then((res) => {
          interventionIdRef.current = res.data?.id ?? null;
        })
        .catch(() => {
          // Historique best-effort
        });
    }
  }, [mode, ticketId, callType]);

  /**
   * Arrête le partage côté émetteur : tracks, appel PeerJS, socket et intervention.
   * Idempotent (le flag part avant toute fermeture, qui re-déclencherait le handler).
   */
  const stopShare = useCallback(
    (closePeer = true) => {
      if (!sharingRef.current) return;
      sharingRef.current = false;
      setSharing(false);
      if (closePeer) {
        peerService.closeScreen();
      }
      const ss = screenLocalRef.current;
      screenLocalRef.current = null;
      try {
        ss?.getTracks?.().forEach((track: any) => track.stop());
      } catch {
        // Ignorer
      }
      socket.stopScreenShare(ticketId);
      const screenId = screenInterventionRef.current;
      screenInterventionRef.current = null;
      if (screenId) {
        interventionsAPI.end(screenId).catch(() => {
          // Historique best-effort
        });
      }
    },
    [socket, ticketId],
  );

  /** Démarre le partage d'écran (boîte de dialogue système, puis second appel PeerJS). */
  const startShare = useCallback(async () => {
    if (endedRef.current || sharingRef.current) return;
    try {
      const stream = await peerService.getScreenStream();
      const tracks = stream.getTracks();
      if (!tracks || tracks.length === 0) {
        throw new Error('Partage annulé');
      }
      screenLocalRef.current = stream;
      sharingRef.current = true;
      setSharing(true);
      // L'OS peut couper le partage depuis sa barre de notifications
      tracks.forEach((track: any) => {
        const onEnded = () => stopShare();
        if (typeof track.addEventListener === 'function') {
          track.addEventListener('ended', onEnded);
        } else {
          track.onended = onEnded;
        }
      });
      await peerService.shareScreen(targetUserId, stream);
      socket.startScreenShare(ticketId);
      interventionsAPI
        .start(ticketId, 'partage_ecran')
        .then((res) => {
          screenInterventionRef.current = res.data?.id ?? null;
        })
        .catch(() => {
          // Historique best-effort
        });
    } catch (e: any) {
      if (sharingRef.current) {
        stopShare();
      }
      const msg = String(e?.message || e);
      if (!endedRef.current && !/cancel|annul/i.test(msg)) {
        Alert.alert('Partage d’écran', msg || "Le partage d'écran n'a pas pu démarrer.");
      }
    }
  }, [targetUserId, ticketId, socket, stopShare]);

  // ----- Écoutes Socket.IO (sonnerie) -----
  useEffect(() => {
    const onAccepted = async () => {
      if (endedRef.current || mode !== 'caller') return;
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      setStatus('connecting');
      try {
        const remote = await peerService.callUser(targetUserId, localStreamRef.current, callType);
        if (endedRef.current) return;
        setRemoteStream(remote);
        markConnected();
      } catch (e: any) {
        finish(e?.message || "Échec de l'appel", true);
      }
    };

    const onRejected = () => finish('Appel refusé.');
    const onEnded = () => finish('Appel terminé.');

    socket.on('call-accepted', onAccepted);
    socket.on('call-rejected', onRejected);
    socket.on('call-ended', onEnded);
    return () => {
      socket.off('call-accepted', onAccepted);
      socket.off('call-rejected', onRejected);
      socket.off('call-ended', onEnded);
    };
  }, [socket, mode, targetUserId, callType, markConnected, finish]);

  // ----- Initialisation (flux local + PeerJS + sonnerie + partage) -----
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (!ticketId || !targetUserId) {
        Alert.alert('Appel', "Paramètres d'appel manquants.", [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }
      try {
        const stream = await peerService.getLocalStream(isVideo, true);
        if (cancelled) {
          stream.getTracks().forEach((track: any) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);

        const ready = await peerService.connect();
        if (cancelled) return;
        if (!ready) throw new Error("Serveur d'appel injoignable.");

        // Partage d'écran : réception (les deux côtés sont sur cet écran)
        peerService.onScreenCall = async (call: any) => {
          if (cancelled || endedRef.current) {
            try {
              call.close();
            } catch {
              // Ignorer
            }
            return;
          }
          try {
            const remote = await peerService.answerScreen(call, localStreamRef.current);
            if (cancelled || endedRef.current) return;
            setScreenStream(remote);
          } catch {
            if (!cancelled) setScreenStream(null);
          }
        };
        // Le partage a été coupé côté distant (ou l'appel a pris fin)
        peerService.onScreenClosed = () => {
          if (sharingRef.current) {
            stopShare(false);
          } else {
            setScreenStream(null);
          }
        };

        if (mode === 'callee') {
          // Répondre à l'offre PeerJS dès qu'elle arrive (tampon si en avance)
          peerService.onIncomingCall = async (call: any) => {
            if (cancelled || endedRef.current) {
              try {
                call.close();
              } catch {
                // Ignorer
              }
              return;
            }
            try {
              const remote = await peerService.answerCall(call, localStreamRef.current);
              if (cancelled || endedRef.current) return;
              setRemoteStream(remote);
              markConnected();
            } catch (e: any) {
              if (!cancelled) finish(e?.message || 'Flux distant indisponible.', true);
            }
          };
          socket.acceptCall(targetUserId, ticketId);
          // Filet de sécurité : si l'appelant disparaît, ne pas rester bloqué
          ringTimeoutRef.current = setTimeout(() => {
            if (!connectedRef.current) finish('Pas de réponse.', true);
          }, 40000);
        } else {
          socket.callUser(targetUserId, callType, ticketId);
          ringTimeoutRef.current = setTimeout(() => {
            if (!connectedRef.current) finish('Pas de réponse.', true);
          }, 45000);
        }
      } catch (e: any) {
        if (!cancelled) finish(e?.message || 'Erreur inconnue.', true);
      }
    };

    boot();

    return () => {
      cancelled = true;
      if (!endedRef.current) {
        endedRef.current = true;
        // Quitte l'écran en cours d'appel : prévenir le distant
        if (targetUserId) socket.endCall(targetUserId, ticketId);
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks?.().forEach((track: any) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleVideo = () => {
    const next = !videoOn;
    localStreamRef.current?.getVideoTracks?.().forEach((track: any) => {
      track.enabled = next;
    });
    setVideoOn(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.infoBox}>
        <Text style={styles.type}>{isVideo ? 'Appel vidéo' : 'Appel audio'}</Text>
        <Text style={styles.status}>{statusLabelFor(status, duration)}</Text>
        {sharing && <Text style={styles.shareBadge}>Vous partagez votre écran</Text>}
      </View>

      <View style={styles.mediaZone}>
        {isVideo ? (
          <View style={styles.videoArea}>
            {remoteStream && (
              <RTCView
                streamURL={remoteStream.toURL()}
                style={styles.remoteVideo}
                objectFit="cover"
                zOrder={0}
              />
            )}
            {!remoteStream && <Text style={styles.waiting}>En attente du flux distant…</Text>}
            {localStream && videoOn && (
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.localVideo}
                objectFit="cover"
                mirror
                zOrder={2}
              />
            )}
          </View>
        ) : (
          <View style={styles.audioArea}>
            <Icon
              name={status === 'connected' ? 'phone-in-talk' : 'phone'}
              size={90}
              color="#e94560"
            />
            <Text style={styles.waiting}>
              {status === 'connected' ? 'Communication en cours' : statusLabelFor(status, duration)}
            </Text>
          </View>
        )}

        {/* Partage d'écran reçu : plein écran (au-dessus de l'appel, sous la caméra en PiP) */}
        {!!screenStream && (
          <View style={styles.screenOverlay}>
            <RTCView
              streamURL={screenStream.toURL()}
              style={styles.screenVideo}
              objectFit="contain"
              zOrder={1}
            />
            <View style={styles.screenBar}>
              <Text style={styles.screenLabel}>Partage d’écran en cours</Text>
              <TouchableOpacity
                style={styles.screenClose}
                onPress={() => peerService.closeScreen()}
              >
                <Icon name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.ctrl, muted && styles.ctrlActive]} onPress={toggleMute}>
          <Icon name={muted ? 'microphone-off' : 'microphone'} size={26} color="#fff" />
        </TouchableOpacity>
        {isVideo && (
          <TouchableOpacity
            style={[styles.ctrl, !videoOn && styles.ctrlActive]}
            onPress={toggleVideo}
          >
            <Icon name={videoOn ? 'video' : 'video-off'} size={26} color="#fff" />
          </TouchableOpacity>
        )}
        {status === 'connected' && (
          <TouchableOpacity
            style={[styles.ctrl, sharing && styles.ctrlActive]}
            onPress={() => {
              if (sharing) {
                stopShare();
              } else {
                startShare();
              }
            }}
          >
            <Icon name={sharing ? 'monitor-off' : 'monitor-share'} size={26} color="#fff" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.ctrl, styles.ctrlEnd]} onPress={hangUp}>
          <Icon name="phone-hangup" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingTop: 60 },
  infoBox: { alignItems: 'center', marginBottom: 20, paddingHorizontal: 20 },
  type: { color: '#888', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 },
  status: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginTop: 8 },
  shareBadge: { color: '#4cd964', fontSize: 13, fontWeight: '600', marginTop: 6 },
  mediaZone: { flex: 1 },
  videoArea: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 16,
    margin: 16,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  remoteVideo: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  localVideo: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#333',
  },
  audioArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  waiting: { color: '#888', fontSize: 16, textAlign: 'center', paddingHorizontal: 30 },
  screenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  screenVideo: { flex: 1 },
  screenBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(26, 26, 46, 0.95)',
  },
  screenLabel: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  screenClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e94560',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 30,
    paddingHorizontal: 16,
  },
  ctrl: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlActive: { backgroundColor: '#444' },
  ctrlEnd: { backgroundColor: '#e94560' },
});

export default CallScreen;
