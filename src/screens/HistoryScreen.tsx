import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { interventionsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const HistoryScreen = () => {
  const { user } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await interventionsAPI.getAll();
      setData(res.data);
    } catch (e) { console.error(e); }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const fmtDuration = (sec: number | null) => {
    if (!sec) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const isTech = user?.role === 'technicien';

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#e94560" />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardType}>{item.type}</Text>
              <View style={[styles.badge, item.ticket_status === 'resolu' ? styles.badgeResolved : styles.badgeOpen]}>
                <Text style={styles.badgeText}>{item.ticket_status}</Text>
              </View>
            </View>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.ticket_description}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.footerText}>⏱ {fmtDuration(item.duree_secondes)}</Text>
              <Text style={styles.footerText}>{isTech ? item.client_nom : item.technicien_nom}</Text>
              <Text style={styles.footerText}>{new Date(item.date_debut).toLocaleDateString('fr-FR')}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="history" size={50} color="#444" />
            <Text style={styles.emptyText}>Aucune intervention</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  listContent: { padding: 15 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardType: { color: '#fff', fontSize: 16, fontWeight: 'bold', textTransform: 'capitalize' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeResolved: { backgroundColor: '#28a745' },
  badgeOpen: { backgroundColor: '#17a2b8' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  cardDesc: { color: '#ccc', fontSize: 13, marginTop: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#333' },
  footerText: { color: '#888', fontSize: 11 },
  empty: { alignItems: 'center', padding: 50 },
  emptyText: { color: '#888', fontSize: 16, marginTop: 15 },
});

export default HistoryScreen;
