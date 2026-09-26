const express = require('express');
const { Pool } = require('pg');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function canAccessTicket(ticketId, userId) {
  const result = await pool.query(
    `SELECT 1 FROM tickets
     WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)`,
    [ticketId, userId],
  );
  return result.rowCount > 0;
}

// Récupérer les messages d'un ticket
router.get('/:ticketId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessTicket(req.params.ticketId, req.user.id))) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      `SELECT m.*, u.nom as expediteur_nom, u.role as expediteur_role
       FROM messages m
       JOIN users u ON m.expediteur_id = u.id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.ticketId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Envoyer un message
router.post('/:ticketId', authMiddleware, async (req, res) => {
  try {
    const { contenu } = req.body;
    if (!contenu || !contenu.trim()) {
      return res.status(400).json({ error: 'Message vide' });
    }

    if (!(await canAccessTicket(req.params.ticketId, req.user.id))) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      'INSERT INTO messages (ticket_id, expediteur_id, contenu) VALUES ($1, $2, $3) RETURNING *',
      [req.params.ticketId, req.user.id, contenu.trim()]
    );

    // Enrichir avec les infos de l'expéditeur
    const message = {
      ...result.rows[0],
      expediteur_nom: req.user.nom,
      expediteur_role: req.user.role,
    };

    // Diffuser via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket-${req.params.ticketId}`).emit('chat-message', message);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
