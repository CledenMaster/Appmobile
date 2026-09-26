# AssistIT

Plateforme d'assistance informatique à distance : les clients déposent des demandes d'assistance, les techniciens les acceptent et interviennent en direct — chat, appel audio/vidéo, partage de fichiers et partage d'écran — avec historique complet des interventions.

## Fonctionnalités

- **Comptes** : client et technicien (inscription autonome des techniciens, pour les besoins des tests).
- **Demandes d'assistance** : création de tickets, file d'attente, acceptation par un technicien, résolution.
- **Chat en temps réel** (Socket.IO, authentification JWT sur le socket).
- **Appels audio / vidéo** : sonnerie via Socket.IO (avec vérification d'appartenance au ticket), médias WebRTC via PeerJS.
- **Partage de fichiers** : upload MinIO (bucket `assistit-files`), listing par ticket.
- **Partage d'écran** : second flux WebRTC (`getDisplayMedia`), enregistré comme intervention `partage_ecran`.
- **Historique des interventions** : chat, audio, vidéo, partage d'écran avec durées réelles.

## Architecture

| Couche | Technologie |
|---|---|
| Application mobile | React Native CLI (TypeScript), react-native-webrtc |
| API + temps réel | Node.js, Express, Socket.IO, PeerJS (signalisation WebRTC) |
| Données | PostgreSQL (schéma `schema.sql`) |
| Fichiers | MinIO (S3) |
| Infra locale | Docker Desktop (conteneurs `postgres`, `minio`) |

Le backend sert l'API et le signaliseur PeerJS sur le **même port (4000)** :

- HTTP PeerJS : `GET /peerjs/peerjs/id`
- WebSocket PeerJS : `ws://<host>:4000/peerjs/peerjs?key=peerjs`
- Socket.IO : `ws://<host>:4000/socket.io` (WebSocket)

## Démarrage

### 1. Base de données et stockage (Docker)

```powershell
docker start postgres minio   # déjà créés ; sinon voir docker-compose du projet
```

Appliquer le schéma (une fois) :

```powershell
docker exec -i postgres psql -U assistit -d assistit_db -f - < schema.sql
```

### 2. Backend

```powershell
cd assistit_backend
# fichier .env requis : DATABASE_URL, JWT_SECRET, MINIO_* (voir .env fourni)
npm install
npm start          # http://localhost:4000
```

### 3. Application mobile

```powershell
npm install
# Hôte unique "localhost" (src/config/api.ts + MINIO_PUBLIC_URL) : lancer les
# tunnels AVANT l'app, pour l'émulateur comme pour un téléphone physique :
powershell -ExecutionPolicy Bypass -File setup_tunnels.ps1   # reverse 4000/9000/8081
npx react-native run-android    # ou run-ios
```

> Sous PowerShell, préférer `npm.cmd` / `npx.cmd` si l'exécution de scripts est bloquée.

#### Windows : chemin du projet avec caractères non-ASCII (« Projet par défaut »)

Le projet vit dans un dossier contenant un `é` ; trois réglages sont donc nécessaires (déjà appliqués) :

- `android/gradle.properties` → `org.gradle.jvmargs` inclut `-Dfile.encoding=UTF-8` : sans quoi le daemon Gradle décode en Cp1252 la sortie UTF-8 de `npx @react-native-community/cli config`, les chemins d'autolinking deviennent `dÃ©faut` et Gradle échoue avec « Configuring project ':…' without an existing directory » alors que le dossier existe.
- `android/gradle.properties` → `android.overridePathCheck=true` : bypass du contrôle AGP sur les chemins non-ASCII (b.android.com/95744).
- `android/local.properties` → `sdk.dir` pointant vers le SDK Android (sinon « SDK location not found »).

En dernier recours (si un outil de la chaîne casse encore sur l'encodage), la solution robuste est de renommer le dossier parent en ASCII (`Projet par defaut`).

**Correctifs finalement appliqués** (l'état actuel du projet) :

- Dossier parent renommé : `Projet par défaut` → **`Projet par defaut`** — ninja 1.13.2 décode les chemins en UTF-8 strict et échouait avec « Illegal byte sequence » sur le `é` ; le renommage supprime la cause à la racine (les réglages ci-dessus restent en place par sécurité).
- **`LongPathsEnabled=1`** dans `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` (commande exécutée en administrateur) : lève la limite MAX_PATH de 260 caractères, sinon ninja échoue avec `Stat(...): Filename longer than 260 characters` (le chemin complet des objets C++ dépasse 390 caractères).
- **`ninja.exe` remplacé dans le SDK par ninja 1.13.2** (`%LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin\ninja.exe` ; original conservé en `ninja.exe.bak-1.10.2`) : le ninja embarqué 1.10.2 refuse les chemins plus longs que 260 caractères.
- Si VS Code ou des terminaux verrouillent le dossier lors d'un renommage, les fermer d'abord (un handle sans partage-écriture sur un sous-dossier bloque le renommage de l'ancêtre).

## Tests

```powershell
npm run lint                # ESLint
npx tsc --noEmit            # typage TypeScript
npm test                    # Jest (rendu de l'application)
node peer_signal_test.js    # signalisation PeerJS (HTTP + WS) contre le backend lancé
node socket_ring_test.js    # sonnerie d'appel : relais + appartenance au ticket (E2E)
```

Les deux scripts Node supposent le backend démarré sur `:4000` et des comptes de test présents en base (`client17875@test.fr`, `client12514@test.fr` / `Passw0rd!`).

## Dépannage (retour d'expérience démo)

- **App bloquée sur « Reloading… »** = famine de la **mémoire hôte** (pas Metro). Vérifier `FreePhysicalMemory` ≥ ~1,5 Go ; fermer 2ᵉ émulateur / builds Gradle en cours. Symptômes logcat : `loadJSBundleFromMetro` sans jamais `Running "AssistIT"`, images sautées (194 frames), horloge de la status bar figée. Dès que la mémoire remonte, l'app charge en ~6 s.
- **Démo à l'épreuve de Metro** : build release (bundle JS embarqué, zéro Metro) :
  ```powershell
  cd android
  .\gradlew.bat app:assembleRelease   # ~4 min en incrémental (51 min au 1er build)
  adb install -r app\build\outputs\apk\release\app-release.apk
  ```
  La release est signée avec le keystore debug et sans minification → installation directe par-dessus le build debug, session conservée. Metro peut rester éteint : preuve validée (login + tickets + socket sur `localhost:4000` via tunnels, Metro OFF).
- **Tunnels `adb reverse` perdus** (redémarrage adb/émulateur) : relancer `setup_tunnels.ps1`. Sans eux, l'app release ne joint ni l'API (4000) ni MinIO (9000). Contrôle : `adb -s emulator-5554 reverse --list`.
- **Capture d'écran « figée » / horloge gelée** = écran en veille (le screencap renvoie la dernière image) : `adb shell input keyevent KEYCODE_WAKEUP`, puis vérifier `dumpsys power | grep mWakefulness`. Timeout écran : `adb shell settings put system screen_off_timeout 1800000`.
- **`adb shell input text` perd des caractères** dans les `TextInput` de React Native : taper par blocs courts (≤4 car.) avec ~1 s de pause, attendre ~8 s que l'appareil stabilise, puis capturer. Pour un mot de passe non vérifiable (points), solution de contournement validée : hash temporaire d'un caractère en base SQL, connexion, puis restauration du hash d'origine (la session JWT reste valable).
- **Login 500 côté backend** : l'API attend `mot_de_passe` (français), pas `password` — `bcrypt.compare` reçoit `undefined` et plante (robustesse à améliorer : valider les champs manquants en 400).
- **Les `console.error` d'écran sont invisibles en release** : se fier à `adb logcat -s ReactNativeJS` (les `console.log` type `🔌 Socket connecté` passent bien).

## Notes de production

- **HTTPS / TLS** : en développement, tout tourne en HTTP. En production, placer un reverse-proxy (nginx/Caddy) devant le port 4000 avec certificat TLS ; PeerJS et Socket.IO passent alors automatiquement en `wss://` (côté mobile, passer `secure: true` dans `src/config/api.ts`).
- **MinIO** : bucket `assistit-files` en lecture publique pour simplifier les tests ; restreindre en écriture/lecture privée signée en production.
- **Clé de signature Android** : la build de debug utilise la keystore de debug ; fournir une keystore de release pour un APK de production.
