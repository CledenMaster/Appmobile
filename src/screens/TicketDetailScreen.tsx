import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ticketsAPI } from '../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const COLORS: Record<string, string> = {
  en_attente: '#ffc107',
  en_cours: '#17a2b8',
  resolu: '#28a745',
};

const TicketDetailScreen = ({ route, navigation }: any) => {
  const { ticketId } = route.params;
  const { user } = useAuth();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadTicket = useCallback(async () => {
    try {
      const res = await ticketsAPI.getById(ticketId);
      setTicket(res.data);
    } catch {
      Alert.alert('Erreur', 'Ticket non trouvé');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [ticketId, navigation]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      await ticketsAPI.accept(ticketId);
      await loadTicket();
    } catch {
      Alert.alert('Erreur', "Impossible d'accepter");
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = async () => {
    Alert.alert('Clôturer', 'Confirmer la clôture ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Oui', onPress: async () => {
          try {
            await ticketsAPI.close(ticketId);
            await loadTicket();
          } catch { Alert.alert('Erreur'); }
        }
      },
    ]);
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#e94560" /></View>;
  if (!ticket) return null;

  const isTechnicien = user?.role === 'technicien';
  // L'autre partie du ticket = interlocuteur des appels
  const targetUserId = isTechnicien ? ticket.client_id : ticket.technicien_id;
  const canCall = ticket.status === 'en_cours' && !!targetUserId;
  // canAccessTicket() n'accepte que client_id / technicien_id. Tant que le
  // technicien n'est pas attribué (ticket encore en_attente), son accès est
  // refusé en 403 : on n'affiche donc pas un bouton qui mène dans un mur.
  const canChat = isTechnicien ? !!ticket.technicien_id : true;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.statusBar, { backgroundColor: COLORS[ticket.status] || '#888' }]}>
        <Text style={styles.statusText}>{ticket.status.replace('_', ' ')}</Text>
      </View>

      <View style={styles.card}>
        <InfoRow icon="tag" label="Catégorie" value={ticket.categorie} />
        <InfoRow icon="account" label="Client" value={ticket.client_nom} />
        {ticket.technicien_nom && <InfoRow icon="wrench" label="Technicien" value={ticket.technicien_nom} />}
        <InfoRow icon="calendar" label="Créé le" value={new Date(ticket.created_at).toLocaleDateString('fr-FR')} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.desc}>{ticket.description}</Text>
      </View>

      <View style={styles.actions}>
        {canChat && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionChat]}
            onPress={() => navigation.navigate('Chat', { ticketId: ticket.id })}>
            <Icon name="chat" size={20} color="#fff" />
            <Text style={styles.actionText}>Chat</Text>
          </TouchableOpacity>
        )}

        {canCall && (
          <>
            <TouchableOpacity style={[styles.actionBtn, styles.actionAudio]}
              onPress={() => navigation.navigate('Call', { ticketId: ticket.id, callType: 'audio', targetUserId })}>
              <Icon name="phone" size={20} color="#fff" />
              <Text style={styles.actionText}>Appel audio</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionBtn, styles.actionCall]}
              onPress={() => navigation.navigate('Call', { ticketId: ticket.id, callType: 'video', targetUserId })}>
              <Icon name="video" size={20} color="#fff" />
              <Text style={styles.actionText}>Appel vidéo</Text>
            </TouchableOpacity>
          </>
        )}

        {isTechnicien && ticket.status === 'en_attente' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionAccept]}
            onPress={handleAccept} disabled={actionLoading}>
            {actionLoading ? <ActivityIndicator color="#fff" /> : <><Icon name="check" size={20} color="#fff" /><Text style={styles.actionText}>Accepter</Text></>}
          </TouchableOpacity>
        )}

        {ticket.status !== 'resolu' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionClose]} onPress={handleClose}>
            <Icon name="close" size={20} color="#fff" />
            <Text style={styles.actionText}>Clôturer</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

const InfoRow = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <View style={infoStyles.row}>
    <Icon name={icon} size={16} color="#888" />
    <Text style={infoStyles.label}>{label}:</Text>
    <Text style={infoStyles.value}>{value}</Text>
  </View>
);

const infoStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  label: { color: '#888', fontSize: 14 },
  value: { color: '#fff', fontSize: 14, flex: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  statusBar: { padding: 12, borderRadius: 10, marginBottom: 15 },
  statusText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textTransform: 'capitalize' },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 18, marginBottom: 15 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  desc: { color: '#ccc', fontSize: 14, lineHeight: 22 },
  actions: { gap: 12, marginBottom: 30 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10 },
  actionChat: { backgroundColor: '#17a2b8' },
  actionAudio: { backgroundColor: '#007bff' },
  actionCall: { backgroundColor: '#28a745' },
  actionAccept: { backgroundColor: '#e94560' },
  actionClose: { backgroundColor: '#6c757d' },
  actionText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});

export default TicketDetailScreen;
