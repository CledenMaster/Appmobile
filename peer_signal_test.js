/* Test de signalisation PeerJS contre le backend local.
 * Valide : GET /peerjs/peerjs/id (récupération d'identité HTTP) + handshake WS /peerjs/peerjs.
 * Le stub RTCPeerConnection contourne le contrôle "browser-incompatible" de PeerJS en Node
 * (aucune vraie connexion WebRTC n'est ouverte ici : on teste la signalisation, pas les médias).
 */
global.location = global.location || { protocol: 'http:' };
global.RTCPeerConnection =
  global.RTCPeerConnection ||
  class RTCPeerConnection {
    createDataChannel() {
      return { ordered: true, close() {} };
    }
    close() {}
  };

const Peer = require('peerjs').default;

const peer = new Peer(undefined, {
  host: 'localhost',
  port: 4000,
  path: '/peerjs/',
  secure: false,
});

const timeout = setTimeout(() => {
  console.log('RESULTAT: TIMEOUT (8s) - le WS /peerjs/peerjs n\'a pas répondu');
  process.exit(2);
}, 8000);

peer.on('open', (id) => {
  clearTimeout(timeout);
  console.log('RESULTAT: OK - peer ouvert via HTTP+WS, id=' + id);
  peer.destroy();
  process.exit(0);
});

peer.on('error', (err) => {
  clearTimeout(timeout);
  console.log('RESULTAT: ERREUR - ' + (err.type || err.message));
  process.exit(1);
});
