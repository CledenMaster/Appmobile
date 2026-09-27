const express = require('express');
const { Pool } = require('pg');
const { authMiddleware, requireClient } = require('../middleware/auth');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Créer une demande d'assistance
router.post('/', authMiddleware, requireClient, async (req, res) => {
  try {
    const { categorie, description } = req.body;
    if (!categorie || !description) {
      return res.status(400).json({ error: 'Catégorie et description requises' });
    }

    const result = await pool.query(
      'INSERT INTO tickets (client_id, categorie, description) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, categorie, description]
    );

    // Notifier les techniciens via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('new-ticket', result.rows[0]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lister les tickets (selon le rôle)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query, params;

    if (req.user.role === 'technicien') {
      // Technicien voit les tickets en attente + les siens
      query = `
        SELECT t.*, u.nom as client_nom 
        FROM tickets t 
        JOIN users u ON t.client_id = u.id 
        WHERE t.status = 'en_attente' OR t.technicien_id = $1
        ORDER BY t.created_at DESC
      `;
      params = [req.user.id];
    } else {
      // Client voit ses tickets
      query = `
        SELECT t.*, u.nom as technicien_nom 
        FROM tickets t 
        LEFT JOIN users u ON t.technicien_id = u.id 
        WHERE t.client_id = $1 
        ORDER BY t.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détails d'un ticket
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, 
        c.nom as client_nom, 
        tc.nom as technicien_nom 
       FROM tickets t 
       JOIN users c ON t.client_id = c.id 
       LEFT JOIN users tc ON t.technicien_id = tc.id 
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket non trouvé' });
    }

    const ticket = result.rows[0];

    // Vérifier l'accès
    if (req.user.role === 'client' && ticket.client_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Accepter un ticket (technicien)
router.post('/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'technicien') {
      return res.status(403).json({ error: 'Seuls les techniciens peuvent accepter' });
    }

    const result = await pool.query(
      `UPDATE tickets SET technicien_id = $1, status = 'en_cours', updated_at = NOW() 
       WHERE id = $2 AND status = 'en_attente' 
       RETURNING *`,
      [req.user.id, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket non trouvé ou déjà pris' });
    }

    // Notifier le client
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket-${req.params.id}`).emit('ticket-accepted', {
        ticket: result.rows[0],
        technicien_nom: req.user.nom || 'Technicien',
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Clôturer un ticket
router.post('/:id/close', authMiddleware, async (req, res) => {
  try {
    const existing = await pool.query(
      'SELECT id, client_id, technicien_id FROM tickets WHERE id = $1',
      [req.params.id],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket non trouvé' });
    }

    const ticket = existing.rows[0];
    const isOwner = req.user.role === 'client' && ticket.client_id === req.user.id;
    const isAssignedTechnician =
      req.user.role === 'technicien' && ticket.technicien_id === req.user.id;

    if (!isOwner && !isAssignedTechnician) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      `UPDATE tickets SET status = 'resolu', updated_at = NOW()
       WHERE id = $1 AND status <> 'resolu'
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Ticket déjà clôturé' });
    }

    // Enregistrer l'intervention « chat » couvrant toute la durée du ticket,
    // avec une durée réelle (sinon l'historique affiche une durée vide).
    // $2 doit être casté `timestamp` aux deux endroits : PostgreSQL déduit un type
    // par occurrence du paramètre, et un mélange `timestamp` (colonne date_debut)
    // / `timestamptz` (via NOW()) levait 42P08 "inconsistent types deduced for
    // parameter $2" — l'UPDATE passait, l'INSERT plantait et le client recevait 500.
    await pool.query(
      `INSERT INTO interventions (ticket_id, type, date_debut, date_fin, duree_secondes)
       VALUES ($1, 'chat', $2::timestamp, NOW(),
               GREATEST(EXTRACT(EPOCH FROM (NOW() - $2::timestamp))::int, 0))`,
      [req.params.id, result.rows[0].created_at]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
