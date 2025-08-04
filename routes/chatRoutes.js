const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const database = require('../config/database');

// Chat management routes
router.post('/create-or-get', chatController.createOrGetChat.bind(chatController));
router.get('/user/:user_id', chatController.getUserChats.bind(chatController));
router.post('/send-message', chatController.sendMessage.bind(chatController));
router.get('/:chat_id/messages', chatController.getChatMessages.bind(chatController));
router.post('/:chat_id/read', chatController.markMessagesRead.bind(chatController));
router.post('/reply', chatController.replyToMessage.bind(chatController));
router.post('/forward', chatController.forwardMessage.bind(chatController));
router.delete('/message/:message_id', chatController.deleteMessage.bind(chatController));
router.get('/search', chatController.searchMessages.bind(chatController));

// Legacy create chat endpoint
router.post('/create', async (req, res) => {
  try {
    const { chat_name, participants, chat_type = 'direct', description = null } = req.body;

    const chatData = {
      name: `CHAT-${Date.now()}`,
      chat_name,
      participants: JSON.stringify(participants),
      chat_type,
      description,
      creator: req.user?.name || 'Administrator',
      is_group: participants.length > 2 ? 1 : 0,
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      creation: new Date().toISOString(),
      modified: new Date().toISOString(),
      owner: req.user?.name || 'Administrator',
      modified_by: req.user?.name || 'Administrator'
    };

    await database.insert('ERP Chat', chatData);

    res.json({
      message: chatData,
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Frappe resource API
router.get('/ERP%20Chat', async (req, res) => {
  try {
    const chats = await database.getAll('ERP Chat');
    res.json({ message: chats, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

router.post('/ERP%20Chat', async (req, res) => {
  try {
    const data = req.body;
    data.name = data.name || `CHAT-${Date.now()}`;
    data.creation = new Date().toISOString();
    data.modified = new Date().toISOString();
    data.owner = 'Administrator';
    data.modified_by = 'Administrator';

    await database.insert('ERP Chat', data);
    res.json({ message: data, status: 'success' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;