const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatControllerNew');
const { authenticate } = require('../middleware/authMiddleware');

// Chat management routes (with authentication)
router.post('/create-or-get', authenticate, chatController.createOrGetChat.bind(chatController));
router.get('/user/:user_id', authenticate, chatController.getUserChats.bind(chatController));
router.get('/:chat_id/messages', authenticate, chatController.getChatMessages.bind(chatController));
router.post('/group', authenticate, chatController.createGroupChat.bind(chatController));
router.post('/:chat_id/add-user', authenticate, chatController.addUserToGroupChat.bind(chatController));
router.get('/:chat_id/stats', authenticate, chatController.getChatStats.bind(chatController));

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