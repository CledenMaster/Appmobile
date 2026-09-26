import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ticketsAPI } from '../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';

const COLORS: Record<string, string> = {
  en_attente: '#ffc107',
  en_cours: '#17a2b8',
  resolu: '#28a745',
};

const HomeScreen = ({ navigation }: any) => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadTickets = async () => {
    try {
      const res = await ticketsAPI.getAll();
      setTickets(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useFocusEffect(useCallback(() => { loadTickets(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTickets();
    setRefreshing(false);
  };

  const isTechnicien = user?.role === 'technicien';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Bonjour, {user?.nom} 👋</Text>
        <Text style={styles.role}>{isTechnicien ? '🔧 Technicien' : '👤 Client'}</Text>
      </View>

      {!isTechnicien && (
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('NewTicket')}>
          <Icon name="plus-circle" size={22} color="#fff" />
          <Text style={styles.newBtnText}>Nouvelle demande</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('TicketDetail', { ticketId: item.id })}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {isTechnicien ? item.description : (item.technicien_nom || 'En attente')}
              </Text>
              <View style={[styles.badge, { backgroundColor: COLORS[item.status] || '#888' }]}>
                <Text style={styles.badgeText}>{item.status.replace('_', ' ')}</Text>
              </View>
            </View>
            <Text style={styles.cardCat}>{item.categorie}</Text>
            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString('fr-FR')}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="inbox" size={50} color="#444" />
            <Text style={styles.emptyText}>Aucun ticket</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  listContent: { padding: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  greeting: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  role: { fontSize: 12, color: '#888', backgroundColor: '#16213e', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e94560', margin: 15, padding: 14, borderRadius: 12 },
  newBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', flex: 1, marginRight: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  cardCat: { color: '#888', fontSize: 13, marginTop: 8 },
  cardDate: { color: '#666', fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', padding: 50 },
  emptyText: { color: '#888', fontSize: 16, marginTop: 15 },
});

export default HomeScreen;
