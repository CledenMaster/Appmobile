import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { ticketsAPI } from '../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const CATEGORIES = ['💻 Logiciel', '🖥️ Matériel', '🌐 Réseau', '🦠 Virus', '💾 Données', '📦 Autre'];

const NewTicketScreen = ({ navigation }: any) => {
  const [categorie, setCategorie] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!categorie || !description.trim()) {
      Alert.alert('Erreur', 'Remplis tous les champs');
      return;
    }
    setLoading(true);
    try {
      await ticketsAPI.create({ categorie, description: description.trim() });
      Alert.alert('Succès', 'Demande envoyée !', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch {
      Alert.alert('Erreur', "Impossible de créer la demande");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="lifebuoy" size={40} color="#e94560" />
        <Text style={styles.headerTitle}>Nouvelle Demande</Text>
      </View>

      <Text style={styles.label}>Catégorie *</Text>
      <View style={styles.catGrid}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity key={cat} style={[styles.catBtn, categorie === cat && styles.catActive]}
            onPress={() => setCategorie(cat)}>
            <Text style={[styles.catText, categorie === cat && styles.catTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Description *</Text>
      <TextInput style={[styles.input, styles.textArea]} placeholder="Décris ton problème..."
        placeholderTextColor="#666" value={description} onChangeText={setDescription}
        multiline numberOfLines={5} textAlignVertical="top" />

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Envoyer</Text>}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  header: { alignItems: 'center', marginBottom: 25, padding: 20, backgroundColor: '#16213e', borderRadius: 15 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 10 },
  label: { fontSize: 14, color: '#aaa', fontWeight: 'bold', marginBottom: 10, marginTop: 15 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catBtn: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#333' },
  catActive: { borderColor: '#e94560', backgroundColor: '#1f1f3a' },
  catText: { color: '#888', fontSize: 13 },
  catTextActive: { color: '#fff' },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 15, color: '#fff', borderWidth: 1, borderColor: '#333' },
  textArea: { height: 150, paddingTop: 15 },
  button: { backgroundColor: '#e94560', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 25 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

export default NewTicketScreen;
