import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { chatAPI } from '../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Bouton « trombone » du header du chat : défini au niveau module
// (règle react/no-unstable-nested-components).
const createChatHeaderRight = (navigation: any, ticketId: any) => () => (
  <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Files', { ticketId })}>
    <Icon name="paperclip" size={22} color="#fff" />
  </TouchableOpacity>
);

const ChatScreen = ({ route, navigation }: any) => {
  const { ticketId } = route.params;
  const { user, socket } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: createChatHeaderRight(navigation, ticketId),
    });
  }, [navigation, ticketId]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await chatAPI.getMessages(ticketId);
      setMessages(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadMessages();
    socket.joinTicket(ticketId);

    const onMessage = (msg: any) => {
      setMessages((prev) =>
        msg?.id && prev.some((existing) => existing.id === msg.id)
          ? prev
          : [...prev, msg],
      );
    };
    socket.on('chat-message', onMessage);

    return () => {
      socket.leaveTicket(ticketId);
      socket.off('chat-message', onMessage);
    };
  }, [ticketId, socket, loadMessages]);

  const handleSend = async () => {
    const contenu = text.trim();
    if (!contenu) return;
    setText('');

    try {
      const res = await chatAPI.sendMessage(ticketId, contenu);
      const savedMessage = res.data;
      setMessages((prev) =>
        savedMessage?.id && prev.some((existing) => existing.id === savedMessage.id)
          ? prev
          : [...prev, savedMessage],
      );
    } catch (e) {
      console.error(e);
      setText(contenu);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMine = item.expediteur_id === user?.id;
    return (
      <View style={[styles.bubble, isMine ? styles.mine : styles.other]}>
        {!isMine && <Text style={styles.sender}>{item.expediteur_nom}</Text>}
        <Text style={[styles.msgText, isMine && styles.msgTextMine]}>{item.contenu}</Text>
        <Text style={[styles.time, isMine && styles.timeMine]}>
          {new Date(item.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#e94560" /></View>;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(_, i) => i.toString()}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
      <View style={styles.inputRow}>
        <TextInput style={styles.input} placeholder="Message..." placeholderTextColor="#666"
          value={text} onChangeText={setText} multiline />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  headerBtn: { marginRight: 5, padding: 5 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  bubble: { maxWidth: '75%', padding: 12, borderRadius: 14, marginBottom: 10 },
  messagesContent: { padding: 15 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#e94560', borderBottomRightRadius: 4 },
  other: { alignSelf: 'flex-start', backgroundColor: '#16213e', borderBottomLeftRadius: 4 },
  sender: { fontSize: 11, color: '#17a2b8', fontWeight: 'bold', marginBottom: 3 },
  msgText: { fontSize: 15, color: '#fff', lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  time: { fontSize: 10, color: '#888', marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.6)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#333' },
  input: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, color: '#fff', maxHeight: 100, marginRight: 10 },
  sendBtn: { backgroundColor: '#e94560', borderRadius: 20, padding: 10, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 18 },
});

export default ChatScreen;
