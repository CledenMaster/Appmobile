import React from 'react';
import { StatusBar, LogBox } from 'react-native';
import { registerGlobals } from 'react-native-webrtc';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

// react-native-webrtc ≥ 106 n'expose plus les globaux WebRTC automatiquement.
// Sans cet appel, global.RTCPeerConnection est absent et PeerJS échoue dès la
// première prise de contact avec "browser-incompatible" (affiché à tort par
// l'app sous forme de « Serveur d'appel injoignable »).
registerGlobals();

// Ignorer les warnings non critiques
LogBox.ignoreLogs([
  'Non-serializable values',
  'Sending `onAnimatedValueUpdate`',
]);

function App() {
  return (
    <AuthProvider>
      <StatusBar barStyle="light-content" />
      <AppNavigator />
    </AuthProvider>
  );
}

export default App;
