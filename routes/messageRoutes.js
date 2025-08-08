const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const messageController = require('../controllers/messageController');
const { authenticate } = require('../middleware/authMiddleware');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mp3|wav/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Message management routes (with auth)
router.get('/:message_id', authenticate, messageController.getMessage.bind(messageController));
router.post('/upload', authenticate, upload.single('file'), messageController.uploadAttachment.bind(messageController));
router.get('/attachment/:attachment_id/download', authenticate, messageController.downloadAttachment.bind(messageController));
router.get('/:message_id/reactions', authenticate, messageController.getMessageReactions.bind(messageController));
router.post('/:message_id/react', authenticate, messageController.addReaction.bind(messageController));
router.post('/:message_id/pin', authenticate, messageController.togglePinMessage.bind(messageController));
router.delete('/:message_id/pin', authenticate, messageController.togglePinMessage.bind(messageController));
router.get('/chat/:chat_id/pinned', authenticate, messageController.getPinnedMessages.bind(messageController));
router.get('/:message_id/history', authenticate, messageController.getMessageHistory.bind(messageController));
router.put('/:message_id/edit', authenticate, messageController.editMessage.bind(messageController));

// Aliases to match mobile legacy endpoints
// GET /api/chats/:chatId/pinned-messages
router.get('/:chatId/pinned-messages', authenticate, (req, res, next) => {
  req.params.chat_id = req.params.chatId;
  return messageController.getPinnedMessages(req, res, next);
});

// Frappe resource API for messages
router.get('/ERP%20Chat%20Message', async (req, res) => {
  try {
    const database = require('../config/database');
    const messages = await database.getAll('ERP Chat Message', {}, '*', 'sent_at DESC', 100);
    res.json({ message: messages, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

router.post('/ERP%20Chat%20Message', async (req, res) => {
  try {
    const database = require('../config/database');
    const data = req.body;
    data.name = data.name || `MSG-${Date.now()}`;
    data.creation = new Date().toISOString();
    data.modified = new Date().toISOString();
    data.owner = data.sender || 'Administrator';
    data.modified_by = data.sender || 'Administrator';

    await database.insert('ERP Chat Message', data);
    res.json({ message: data, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;