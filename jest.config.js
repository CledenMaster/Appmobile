module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-vector-icons|@react-native(-community)?|@react-native-async-storage|@react-navigation)/)',
  ],
};
