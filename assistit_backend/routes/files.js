const express = require('express');
const multer = require('multer');
const Minio = require('minio');
const { Pool } = require('pg');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// MinIO client
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const BUCKET = 'assistit-files';
const MINIO_PUBLIC_BASE = (
  process.env.MINIO_PUBLIC_URL ||
  `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || 9000}`
).replace(/\/+$/, '');

// Certains sélecteurs de fichiers renvoient le nom déjà encodé ("New%20cours.pdf").
function decodeName(name) {
  try {
    return decodeURIComponent(name);
  } catch (err) {
    return name;
  }
}

// URL d'objet correctement encodée (espaces -> %20) : utilisable par Linking.openURL
// et résolue telle quelle par MinIO (décodage serveur = clé stockée).
const objectUrl = (key) => `${MINIO_PUBLIC_BASE}/${BUCKET}/${encodeURIComponent(key)}`;

// Multer pour upload en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// Initialiser le bucket au démarrage
async function initBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      // Politique de lecture publique
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET}/*`],
          },
        ],
      };
      await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
      console.log(`Bucket "${BUCKET}" créé`);
    }
  } catch (err) {
    console.error('Erreur init MinIO:', err.message);
  }
}
initBucket();

// Upload un fichier
router.post('/upload/:ticketId', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier' });
    }

    const access = await pool.query(
      'SELECT 1 FROM tickets WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)',
      [req.params.ticketId, req.user.id],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const timestamp = Date.now();
    const originalName = decodeName(req.file.originalname) || 'fichier';
    const fileName = `${timestamp}-${originalName}`;

    await minioClient.putObject(BUCKET, fileName, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype,
    });

    const fileUrl = objectUrl(fileName);

    // Enregistrer en base
    const result = await pool.query(
      `INSERT INTO fichiers (ticket_id, uploader_id, cle_objet_minio, nom_original, taille_octets)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.ticketId, req.user.id, fileName, originalName, req.file.size]
    );

    // Notifier via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket-${req.params.ticketId}`).emit('file-shared', {
        ...result.rows[0],
        url: fileUrl,
        uploader_nom: req.user.nom,
      });
    }

    res.status(201).json({
      ...result.rows[0],
      url: fileUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur upload' });
  }
});

// Lister les fichiers d'un ticket
router.get('/:ticketId', authMiddleware, async (req, res) => {
  try {
    const access = await pool.query(
      'SELECT 1 FROM tickets WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)',
      [req.params.ticketId, req.user.id],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const result = await pool.query(
      `SELECT f.*, u.nom as uploader_nom
       FROM fichiers f
       JOIN users u ON f.uploader_id = u.id
       WHERE f.ticket_id = $1
       ORDER BY f.created_at DESC`,
      [req.params.ticketId]
    );

    // Ajouter l'URL complète
    const files = result.rows.map((f) => ({
      ...f,
      url: objectUrl(f.cle_objet_minio),
    }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer un fichier
router.delete('/:fileId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM fichiers WHERE id = $1',
      [req.params.fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    const file = result.rows[0];

    const access = await pool.query(
      'SELECT 1 FROM tickets WHERE id = $1 AND (client_id = $2 OR technicien_id = $2)',
      [file.ticket_id, req.user.id],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Supprimer de MinIO
    await minioClient.removeObject(BUCKET, file.cle_objet_minio);

    // Supprimer de la base
    await pool.query('DELETE FROM fichiers WHERE id = $1', [req.params.fileId]);

    res.json({ message: 'Fichier supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
