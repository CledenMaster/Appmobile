import React, { useEffect } from 'react';
import { NavigationContainer, useNavigationContainerRef, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';

// Écrans
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import HomeScreen from '../screens/HomeScreen';
import TicketDetailScreen from '../screens/TicketDetailScreen';
import ChatScreen from '../screens/ChatScreen';
import CallScreen from '../screens/CallScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NewTicketScreen from '../screens/NewTicketScreen';
import FilesScreen from '../screens/FilesScreen';
import socketService from '../services/socket';

import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const COLORS = {
  primary: '#1a1a2e',
  secondary: '#16213e',
  accent: '#e94560',
  white: '#fff',
};

// ===== Auth Stack =====
const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Login" component={LoginScreen} />
    <Stack.Screen name="Register" component={RegisterScreen} />
  </Stack.Navigator>
);

// ===== Home Stack =====
const HomeStack = () => (
  <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: COLORS.white }}>
    <Stack.Screen name="HomeMain" component={HomeScreen} options={{ title: 'Assist\'IT' }} />
    <Stack.Screen name="NewTicket" component={NewTicketScreen} options={{ title: 'Nouvelle demande' }} />
    <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'Détails' }} />
    <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
    <Stack.Screen name="Files" component={FilesScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
  </Stack.Navigator>
);

// ===== Tabs =====
const TAB_ICONS: Record<string, string> = { Home: 'home', History: 'history', Profile: 'account' };

const TabBarIcon = ({ color, size }: { color: string; size: number }) => {
  const route = useRoute<any>();
  return <Icon name={TAB_ICONS[route.name] || 'help'} size={size} color={color} />;
};

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarIcon: TabBarIcon,
      tabBarActiveTintColor: COLORS.accent,
      tabBarInactiveTintColor: '#666',
      tabBarStyle: { backgroundColor: COLORS.secondary, borderTopWidth: 0 },
    }}>
    <Tab.Screen name="Home" component={HomeStack} />
    <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'Historique' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profil' }} />
  </Tab.Navigator>
);

// ===== Root =====
const AppNavigator = () => {
  const { user, loading } = useAuth();
  const navigationRef = useNavigationContainerRef<any>();

  // Appel entrant : sonnerie globale, l'utilisateur peut être n'importe où dans l'app
  useEffect(() => {
    if (!user) return undefined;

    const onIncomingCall = ({ callerId, callType, ticketId }: any) => {
      if (callerId === user.id) return;
      const kind = callType === 'video' ? 'Appel vidéo' : 'Appel audio';
      Alert.alert('Appel entrant', `${kind} — ticket n°${ticketId}`, [
        { text: 'Refuser', style: 'cancel', onPress: () => socketService.rejectCall(callerId, ticketId) },
        {
          text: 'Accepter',
          onPress: () => {
            // Call est imbriqué dans l'onglet Home
            navigationRef.navigate('Home', {
              screen: 'Call',
              params: { ticketId, callType, targetUserId: callerId, mode: 'callee' },
            });
          },
        },
      ]);
    };

    socketService.on('incoming-call', onIncomingCall);
    return () => {
      socketService.off('incoming-call', onIncomingCall);
    };
  }, [user, navigationRef]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      {user ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
});

export default AppNavigator;
