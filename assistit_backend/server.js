require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('./middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'change_moi_en_production';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ===== Socket.IO =====
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

// Stocker les utilisateurs connectés : userId -> Set<socketId>
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('Socket connecté:', socket.id);

  // Authentification du socket
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;

      // Ajouter aux utilisateurs connectés
      if (!connectedUsers.has(decoded.id)) {
        connectedUsers.set(decoded.id, new Set());
      }
      connectedUsers.get(decoded.id).add(socket.id);

      // Rejoindre sa room personnelle
      socket.join(`user-${decoded.id}`);

      console.log(`Utilisateur ${decoded.id} authentifié (${decoded.role})`);
      socket.emit('authenticated', { userId: decoded.id });
    } catch (err) {
      socket.emit('auth-error', { error: 'Token invalide' });
    }
  });

  // Rejoindre la room d'un ticket (après vérification JWT et accès au ticket)
  socket.on('join-ticket', async (ticketId) => {
    if (!socket.userId) {
      socket.emit('ticket-error', { error: 'Authentification requise' });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT 1 FROM tickets
         WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)`,
        [ticketId, socket.userId],
      );

      if (result.rowCount === 0) {
        socket.emit('ticket-error', { error: 'Accès au ticket refusé' });
        return;
      }

      socket.join(`ticket-${ticketId}`);
      console.log(`Socket ${socket.id} rejoint ticket-${ticketId}`);
    } catch (err) {
      console.error('Erreur join-ticket:', err.message);
      socket.emit('ticket-error', { error: 'Erreur lors de la jointure' });
    }
  });

  // Quitter la room d'un ticket
  socket.on('leave-ticket', (ticketId) => {
    socket.leave(`ticket-${ticketId}`);
  });

  // Messages de chat
  socket.on('chat-message', ({ ticketId, message }) => {
    if (!socket.userId || !socket.rooms.has(`ticket-${ticketId}`)) return;
    if (!message || typeof message.contenu !== 'string' || !message.contenu.trim()) return;

    io.to(`ticket-${ticketId}`).emit('chat-message', {
      ...message,
      expediteur_id: socket.userId,
      contenu: message.contenu.trim(),
    });
  });

  // Indicateur de frappe
  socket.on('typing', ({ ticketId, userId }) => {
    socket.to(`ticket-${ticketId}`).emit('typing', { userId });
  });

  socket.on('stop-typing', ({ ticketId, userId }) => {
    socket.to(`ticket-${ticketId}`).emit('stop-typing', { userId });
  });

  // Appels audio/vidéo — sonnerie via Socket.IO.
  // La signalisation WebRTC (offre/réponse/ICE) passe par PeerJS, pas par ici.
  socket.on('call-user', async ({ targetUserId, callType, ticketId }) => {
    if (!socket.userId || !targetUserId || !ticketId) return;
    try {
      // Vérifier que les deux utilisateurs sont bien les membres du ticket
      const result = await pool.query(
        `SELECT 1 FROM tickets
         WHERE id = $1
           AND ((client_id = $2 AND technicien_id = $3) OR (client_id = $3 AND technicien_id = $2))`,
        [ticketId, socket.userId, targetUserId],
      );
      if (result.rowCount === 0) return;

      io.to(`user-${targetUserId}`).emit('incoming-call', {
        callerId: socket.userId,
        callType,
        ticketId: Number(ticketId),
      });
    } catch (err) {
      console.error('Erreur call-user:', err.message);
    }
  });

  socket.on('accept-call', ({ targetUserId, ticketId }) => {
    if (!socket.userId || !targetUserId) return;
    io.to(`user-${targetUserId}`).emit('call-accepted', {
      accepterId: socket.userId,
      ticketId,
    });
  });

  socket.on('reject-call', ({ targetUserId, ticketId }) => {
    if (!socket.userId || !targetUserId) return;
    io.to(`user-${targetUserId}`).emit('call-rejected', {
      rejecterId: socket.userId,
      ticketId,
    });
  });

  socket.on('end-call', ({ targetUserId, ticketId }) => {
    if (!socket.userId || !targetUserId) return;
    io.to(`user-${targetUserId}`).emit('call-ended', {
      enderId: socket.userId,
      ticketId,
    });
  });

  // Partage d'écran
  socket.on('screen-share-start', ({ ticketId }) => {
    socket.to(`ticket-${ticketId}`).emit('screen-share-started', {
      userId: socket.userId,
    });
  });

  socket.on('screen-share-stop', ({ ticketId }) => {
    socket.to(`ticket-${ticketId}`).emit('screen-share-stopped', {
      userId: socket.userId,
    });
  });

  // Déconnexion
  socket.on('disconnect', () => {
    if (socket.userId) {
      const userSockets = connectedUsers.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(socket.userId);
        }
      }
    }
    console.log('Socket déconnecté:', socket.id);
  });
});

// ===== PeerJS Server =====
// Monté sur /peerjs avec un sous-path '/' → HTTP: /peerjs/:key/id, WS: /peerjs/peerjs
// (sans ce '/', les chemins se doubleraient et le client PeerJS recevait des 404)
//
// createWebSocketServer : ws({server}) ABORTE en 400 tout upgrade dont le chemin
// ne correspond pas à SIEN — le listener ws de peer partageant le serveur HTTP
// avec socket.io, il détruisait les upgrades /socket.io → WebSocket impossible
// pour le chat (polling OK, peer OK, socket.io mort). En mode noServer, on ne
// traite que /peerjs/peerjs et on laisse les autres upgrades tranquilles.
const peerServer = ExpressPeerServer(server, {
  path: '/',
  createWebSocketServer: (wsOptions) => {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ ...wsOptions, server: null, noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const url = req.url || '';
      const idx = url.indexOf('?');
      const pathname = idx === -1 ? url : url.slice(0, idx);
      if (pathname !== wsOptions.path) return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    return wss;
  },
});
app.use('/peerjs', peerServer);

// ===== PostgreSQL =====
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== Routes Auth =====
app.post('/auth/register', async (req, res) => {
  try {
    const { nom, email, mot_de_passe, role } = req.body;
    if (!nom || !email || !mot_de_passe || !role) {
      return res.status(400).json({ error: 'Champs manquants' });
    }
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const result = await pool.query(
      'INSERT INTO users (nom, email, mot_de_passe, role) VALUES ($1, $2, $3, $4) RETURNING id, nom, email, role',
      [nom, email, hash, role]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: user.role, nom: user.nom }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

    const valide = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!valide) return res.status(401).json({ error: 'Identifiants invalides' });

    const token = jwt.sign({ id: user.id, role: user.role, nom: user.nom }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Profil utilisateur
app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, email, role, disponible, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ===== Routes API =====
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/files', require('./routes/files'));
app.use('/api/interventions', require('./routes/interventions'));

// Liste des techniciens en ligne
app.get('/api/techniciens', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, nom, email, disponible FROM users WHERE role = 'technicien'"
    );
    // Ajouter le statut en ligne
    const techniciens = result.rows.map((t) => ({
      ...t,
      en_ligne: connectedUsers.has(t.id),
    }));
    res.json(techniciens);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/', (req, res) => res.send("Backend Assist'IT opérationnel"));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Serveur sur http://localhost:${PORT}`));
