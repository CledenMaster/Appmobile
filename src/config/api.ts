// Hôte unique valable partout : émulateur Android, téléphone réel et simulateur iOS.
//
// MODE LAN (téléphone réel sans débogage USB) : le PC et les appareils sont sur
// le même Wi-Fi, on parle donc directement à l'IP du PC — aucun tunnel adb,
// aucun Metro. L'IP est celle attribuée par le routeur : si elle change (DHCP),
// la remplacer ici ET dans assistit_backend/.env (MINIO_PUBLIC_URL) puis
// relancer le backend et rebuild l'APK.
// Ancien mode tunnels (nécessite `adb reverse` + débogage USB activé) :
//   DEV_HOST = 'localhost'  -> tcp:4000 API+socket, tcp:9000 MinIO, tcp:8081 Metro
const DEV_HOST = '192.168.1.22';

const API_BASE = `http://${DEV_HOST}:4000`;
const SOCKET_URL = API_BASE;

const PEER_CONFIG = {
  host: DEV_HOST,
  port: 4000,
};

const MINIO_URL = `http://${DEV_HOST}:9000/assistit-files`;

export { API_BASE, SOCKET_URL, PEER_CONFIG, MINIO_URL };
