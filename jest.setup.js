jest.mock('react-native-webrtc', () => ({
  RTCView: 'RTCView',
  mediaDevices: {
    getUserMedia: jest.fn(() =>
      Promise.reject(new Error('WebRTC non disponible dans les tests')),
    ),
    getDisplayMedia: jest.fn(() =>
      Promise.reject(new Error('WebRTC non disponible dans les tests')),
    ),
    enumerateDevices: jest.fn(() => Promise.resolve([])),
  },
  registerGlobals: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

// Le picker appelle un TurboModule natif absent de l'environnement de test.
jest.mock('@react-native-documents/picker', () => ({
  __esModule: true,
  pick: jest.fn(() => Promise.resolve([])),
  types: { allFiles: '*/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: jest.fn(() => false),
}));
