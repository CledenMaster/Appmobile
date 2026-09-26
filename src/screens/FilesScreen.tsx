import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { filesAPI } from '../services/api';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  apk: 'application/vnd.android.package-archive',
};

const getMimeType = (name: string): string => {
  const extension = name.split('.').pop();
  if (!extension) {
    return 'application/octet-stream';
  }
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream';
};

const formatSize = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) {
    return '--';
  }
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} Ko`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const formatDate = (value?: string | null): string => {
  if (!value) {
    return '--';
  }
  return new Date(value).toLocaleDateString('fr-FR');
};

const getErrorMessage = (error: any, fallback: string): string =>
  error?.response?.data?.error || error?.message || fallback;

const FilesScreen = ({ route, navigation }: any) => {
  const { ticketId } = route.params;
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      const res = await filesAPI.getByTicket(ticketId);
      setFiles(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Impossible de charger les fichiers'));
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      loadFiles();
    }, [loadFiles]),
  );

  const handleAdd = async () => {
    try {
      const result = await pick({
        type: [types.allFiles],
      });
      const file = result[0];
      if (!file) {
        return;
      }

      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name || 'fichier',
        type: file.type || getMimeType(file.name || ''),
      });

      setUploading(true);
      await filesAPI.upload(ticketId, formData);
      await loadFiles();
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      Alert.alert('Erreur', getErrorMessage(e, "L'envoi du fichier a échoué"));
    } finally {
      setUploading(false);
    }
  };

  const handleOpen = async (item: any) => {
    if (!item.url) {
      Alert.alert('Erreur', "Ce fichier n'a pas de lien de téléchargement");
      return;
    }
    try {
      await Linking.openURL(item.url);
    } catch {
      Alert.alert('Erreur', 'Impossible de ouvrir ce fichier');
    }
  };

  const handleDelete = (item: any) => {
    Alert.alert('Supprimer', `Supprimer « ${item.nom_original || 'ce fichier'} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await filesAPI.remove(item.id);
            await loadFiles();
          } catch (e) {
            Alert.alert('Erreur', getErrorMessage(e, 'Impossible de supprimer ce fichier'));
          }
        },
      },
    ]);
  };

  const renderFile = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Icon name="file-document-outline" size={24} color="#e94560" />
        <Text style={styles.fileName} numberOfLines={1}>
          {item.nom_original || item.cle_objet_minio}
        </Text>
      </View>
      <Text style={styles.fileMeta}>
        {formatSize(item.taille_octets)} · {formatDate(item.created_at)}
        {item.uploader_nom ? ` · ${item.uploader_nom}` : ''}
      </Text>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.openBtn} onPress={() => handleOpen(item)}>
          <Icon name="open-in-new" size={16} color="#fff" />
          <Text style={styles.actionText}>Ouvrir</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
          <Icon name="trash-can-outline" size={16} color="#fff" />
          <Text style={styles.actionText}>Supprimer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={30} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Fichiers du ticket</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <FlatList
            data={files}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={renderFile}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="file-outline" size={50} color="#444" />
                <Text style={styles.emptyText}>Aucun fichier pour ce ticket</Text>
              </View>
            }
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.addBtnText}>📎 Ajouter un fichier</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingBottom: 15, paddingHorizontal: 15, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#333' },
  backBtn: { padding: 5, marginRight: 5 },
  headerSpacer: { width: 30 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: 'bold', color: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#e94560', fontSize: 13, paddingHorizontal: 15, paddingTop: 10 },
  listContent: { padding: 15, flexGrow: 1 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileName: { flex: 1, fontSize: 15, fontWeight: 'bold', color: '#fff' },
  fileMeta: { color: '#888', fontSize: 12, marginTop: 8 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#333' },
  openBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#17a2b8', paddingVertical: 10, borderRadius: 8 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e94560', paddingVertical: 10, borderRadius: 8 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  addBtn: { backgroundColor: '#e94560', margin: 15, padding: 15, borderRadius: 12, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  empty: { alignItems: 'center', padding: 50 },
  emptyText: { color: '#888', fontSize: 16, marginTop: 15 },
});

export default FilesScreen;
