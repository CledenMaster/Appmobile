// Hôte unique valable partout : émulateur Android, téléphone réel et simulateur iOS.
//
// On passe par "localhost" + les tunnels `adb reverse` gérés par setup_tunnels.ps1 :
//   tcp:4000 -> API + socket          tcp:9000 -> MinIO          tcp:8081 -> Metro
// L'ancien "10.0.2.2" ne fonctionne que depuis un émulateur ; les tunnels, eux,
// fonctionnent sur tous les appareils (aucune dépendance Wi-Fi ni pare-feu).
const DEV_HOST = 'localhost';

const API_BASE = `http://${DEV_HOST}:4000`;
const SOCKET_URL = API_BASE;

const PEER_CONFIG = {
  host: DEV_HOST,
  port: 4000,
};

const MINIO_URL = `http://${DEV_HOST}:9000/assistit-files`;

export { API_BASE, SOCKET_URL, PEER_CONFIG, MINIO_URL };
