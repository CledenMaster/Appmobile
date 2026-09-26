const express = require('express');
const { Pool } = require('pg');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Historique des interventions (pour le technicien)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query, params;

    if (req.user.role === 'technicien') {
      query = `
        SELECT i.*, t.description as ticket_description, t.categorie, t.status as ticket_status,
          c.nom as client_nom
        FROM interventions i
        JOIN tickets t ON i.ticket_id = t.id
        JOIN users c ON t.client_id = c.id
        WHERE t.technicien_id = $1
        ORDER BY i.date_debut DESC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT i.*, t.description as ticket_description, t.categorie, t.status as ticket_status,
          tc.nom as technicien_nom
        FROM interventions i
        JOIN tickets t ON i.ticket_id = t.id
        LEFT JOIN users tc ON t.technicien_id = tc.id
        WHERE t.client_id = $1
        ORDER BY i.date_debut DESC
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

// Statistiques du technicien
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'technicien') {
      return res.status(403).json({ error: 'Réservé aux techniciens' });
    }

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_interventions,
        COUNT(CASE WHEN t.status = 'resolu' THEN 1 END) as resolus,
        ROUND(AVG(i.duree_secondes) / 60.0, 1) as duree_moyenne_minutes
       FROM interventions i
       JOIN tickets t ON i.ticket_id = t.id
       WHERE t.technicien_id = $1`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Enregistrer le début d'une intervention
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { ticket_id, type } = req.body;

    const access = await pool.query(
      'SELECT 1 FROM tickets WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)',
      [ticket_id, req.user.id],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      `INSERT INTO interventions (ticket_id, type, date_debut) 
       VALUES ($1, $2, NOW()) 
       RETURNING *`,
      [ticket_id, type || 'chat']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Enregistrer la fin d'une intervention
router.post('/:id/end', authMiddleware, async (req, res) => {
  try {
    const access = await pool.query(
      `SELECT 1 FROM interventions i
       JOIN tickets t ON i.ticket_id = t.id
       WHERE i.id = $1 AND (t.client_id = $2 OR t.technicien_id = $2)`,
      [req.params.id, req.user.id],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      `UPDATE interventions SET date_fin = NOW(), 
       duree_secondes = EXTRACT(EPOCH FROM (NOW() - date_debut))
       WHERE id = $1 
       RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Intervention non trouvée' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
