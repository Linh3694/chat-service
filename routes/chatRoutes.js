const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatControllerNew');
const { authenticate, authenticateServiceOrUser } = require('../middleware/authMiddleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Message = require('../models/Message');
const Chat = require('../models/Chat');

// Chat management routes (with authentication)
router.post('/create-or-get', authenticate, chatController.createOrGetChat.bind(chatController));
router.get('/user/:user_id', authenticate, chatController.getUserChats.bind(chatController));
router.get('/:chat_id/messages', authenticate, chatController.getChatMessages.bind(chatController));
// Group create (alias)
router.post('/group', authenticateServiceOrUser, chatController.createGroupChat.bind(chatController));
router.post('/group/create', authenticateServiceOrUser, chatController.createGroupChat.bind(chatController));
router.post('/:chat_id/add-user', authenticateServiceOrUser, chatController.addUserToGroupChat.bind(chatController));
router.get('/:chat_id/stats', authenticate, chatController.getChatStats.bind(chatController));

// ===== Aliases to support legacy mobile app endpoints =====
// GET /api/chats/list → return array of chats
router.get('/list', authenticate, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search;

    const filter = { participants: userId };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const chats = await Chat.find(filter)
      .select('name description avatar isGroup creator admins participants lastMessage settings createdAt updatedAt')
      .populate('participants', 'fullname avatarUrl email')
      .populate('creator', 'fullname avatarUrl email')
      .populate('admins', 'fullname avatarUrl email')
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'fullname avatarUrl email' } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    return res.json(chats || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// GET /api/chats/messages/:chatId with pagination shape { success, messages, pagination }
router.get('/messages/:chatId', authenticate, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const chat = await Chat.findById(chatId).select('_id participants');
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    const userId = (req.user?._id || req.user?.id)?.toString();
    if (!chat.participants.some(p => p.toString() === userId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const messages = await Message.find({ chat: chatId })
      .populate('sender', 'fullname avatarUrl email')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'fullname avatarUrl email' } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const reversed = [...messages].reverse();
    let hasMore = false;
    if (messages.length === limit) {
      const countNext = await Message.find({ chat: chatId }).sort({ createdAt: -1 }).skip(skip + limit).limit(1).countDocuments();
      hasMore = countNext > 0;
    }

    return res.json({ success: true, messages: reversed, pagination: { page, limit, hasMore } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/chats/message → send message (map legacy body fields)
router.post('/message', authenticate, (req, res, next) => {
  // Map legacy body fields to controller's expected fields
  const body = req.body || {};
  req.body = {
    chat_id: body.chatId || body.chat_id,
    content: body.content,
    message_type: body.type || body.message_type || 'text',
    reply_to: body.replyTo || body.reply_to || body.replyToId || null,
    is_emoji: body.isEmoji || body.is_emoji || false,
    emoji_id: body.emojiId || body.emoji_id || null,
    emoji_type: body.emojiType || body.emoji_type || null,
    emoji_name: body.emojiName || body.emoji_name || null,
    emoji_url: body.emojiUrl || body.emoji_url || null,
    temp_id: body.tempId || body.temp_id || null,
    attachments: body.attachments || null,
    sender_id: req.user?.id || req.user?._id
  };
  return chatController.sendMessage(req, res, next);
});

// POST /api/chats/message/reply → reply to message (map legacy body)
router.post('/message/reply', authenticate, (req, res, next) => {
  const body = req.body || {};
  req.body = {
    chat_id: body.chatId || body.chat_id,
    content: body.content,
    reply_to_id: body.replyTo || body.reply_to || body.replyToId,
    message_type: body.type || body.message_type || 'text',
    sender_id: req.user?.id || req.user?._id
  };
  return chatController.replyToMessage(req, res, next);
});

// POST /api/chats/messages/:chatId/read → mark as read
router.post('/messages/:chatId/read', authenticate, (req, res, next) => {
  req.params.chat_id = req.params.chatId;
  return chatController.markMessagesRead(req, res, next);
});

// PUT /api/chats/read-all/:chatId → mark all as read
router.put('/read-all/:chatId', authenticate, (req, res, next) => {
  req.params.chat_id = req.params.chatId;
  return chatController.markMessagesRead(req, res, next);
});

// POST /api/chats/message/forward → support toUserId or targetChatId
router.post('/message/forward', authenticate, async (req, res, next) => {
  try {
    const body = req.body || {};
    let toChatId = body.to_chat_id || body.targetChatId;
    const toUserId = body.toUserId || body.to_user_id;
    const currentUserId = req.user?.id || req.user?._id;

    // If forwarding to a user, find or create 1-1 chat
    if (!toChatId && toUserId && currentUserId) {
      let chat = await Chat.findOne({
        participants: { $all: [currentUserId, toUserId], $size: 2 },
        isGroup: { $ne: true }
      });
      if (!chat) {
        chat = await Chat.create({ participants: [currentUserId, toUserId], isGroup: false, creator: currentUserId });
      }
      toChatId = chat._id.toString();
    }

    req.body = {
      message_id: body.messageId || body.message_id,
      to_chat_id: toChatId,
      sender_id: currentUserId
    };
    return chatController.forwardMessage(req, res, next);
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Backward-compatible alias: POST /api/messages/forward
router.post('/messages/forward', authenticate, (req, res, next) => {
  return router.handle({ ...req, url: '/message/forward', method: 'POST' }, res, next);
});

// POST alias for createOrGet (camelCase) → return chat doc directly
router.post('/createOrGet', authenticate, async (req, res) => {
  try {
    const participantId = req.body.participantId || req.body.participant_id;
    const currentUserId = req.user?._id || req.user?.id;
    if (!participantId || !currentUserId) return res.status(400).json({ message: 'Missing participantId' });

    let chat = await Chat.findOne({
      participants: { $all: [currentUserId, participantId], $size: 2 },
      isGroup: { $ne: true }
    })
      .populate('participants', 'fullname avatarUrl email');

    if (!chat) {
      chat = await Chat.create({ participants: [currentUserId, participantId], isGroup: false, creator: currentUserId });
      chat = await Chat.findById(chat._id).populate('participants', 'fullname avatarUrl email');
    }

    return res.json(chat);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// GET chat detail /api/chats/:chatId
router.get('/:chatId', authenticate, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId)
      .populate('participants', 'fullname avatarUrl email')
      .populate('creator', 'fullname avatarUrl email')
      .populate('admins', 'fullname avatarUrl email')
      .populate('lastMessage');
    if (!chat) {
      return res.status(404).json({ message: 'Không tìm thấy chat' });
    }
    const userId = (req.user?._id || req.user?.id)?.toString();
    const isParticipant = chat.participants.some(p => p._id.toString() === userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập chat này' });
    }
    return res.status(200).json(chat);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ===== Pin/Unpin and pinned messages (Mongoose-based, match mobile) =====
// POST /api/chats/message/:messageId/pin
router.post('/message/:messageId/pin', authenticate, async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user?._id || req.user?.id;
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: 'Không tìm thấy tin nhắn' });
    const chat = await Chat.findById(message.chat);
    if (!chat) return res.status(404).json({ message: 'Không tìm thấy chat' });
    if (!chat.participants.some(p => p.toString() === userId.toString())) {
      return res.status(403).json({ message: 'Bạn không có quyền ghim tin nhắn trong chat này' });
    }
    // Optional: limit to 3 pinned
    if (Array.isArray(chat.pinnedMessages) && chat.pinnedMessages.length >= 3 && !message.isPinned) {
      return res.status(400).json({ message: 'Đã đạt giới hạn tin ghim (tối đa 3 tin nhắn)', pinnedCount: chat.pinnedMessages.length });
    }
    message.isPinned = true;
    message.pinnedBy = userId;
    message.pinnedAt = new Date();
    await message.save();
    if (!Array.isArray(chat.pinnedMessages)) chat.pinnedMessages = [];
    if (!chat.pinnedMessages.some(id => id.toString() === messageId.toString())) {
      chat.pinnedMessages.push(message._id);
      await chat.save();
    }
    const populated = await Message.findById(messageId)
      .populate('sender', 'fullname avatarUrl email')
      .populate('pinnedBy', 'fullname avatarUrl email');
    return res.json(populated);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// DELETE /api/chats/message/:messageId/pin
router.delete('/message/:messageId/pin', authenticate, async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user?._id || req.user?.id;
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: 'Không tìm thấy tin nhắn' });
    const chat = await Chat.findById(message.chat);
    if (!chat) return res.status(404).json({ message: 'Không tìm thấy chat' });
    if (!chat.participants.some(p => p.toString() === userId.toString())) {
      return res.status(403).json({ message: 'Bạn không có quyền thao tác ghim tin nhắn trong chat này' });
    }
    message.isPinned = false;
    message.pinnedBy = undefined;
    message.pinnedAt = undefined;
    await message.save();
    if (Array.isArray(chat.pinnedMessages)) {
      chat.pinnedMessages = chat.pinnedMessages.filter(id => id.toString() !== messageId.toString());
      await chat.save();
    }
    return res.json({ message: 'Đã bỏ ghim tin nhắn' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// GET /api/chats/:chatId/pinned-messages
router.get('/:chatId/pinned-messages', authenticate, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user?._id || req.user?.id;
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Không tìm thấy chat' });
    if (!chat.participants.some(p => p.toString() === userId.toString())) {
      return res.status(403).json({ message: 'Bạn không có quyền xem tin nhắn ghim trong chat này' });
    }
    const pinned = await Message.find({ _id: { $in: chat.pinnedMessages || [] } })
      .populate('sender', 'fullname avatarUrl email')
      .populate('pinnedBy', 'fullname avatarUrl email')
      .sort({ pinnedAt: -1 });
    return res.json(pinned);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ===== File upload endpoints (legacy compatibility) =====
// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'Chat');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// POST /api/chats/upload-attachment
router.post('/upload-attachment', authenticate, upload.single('file'), async (req, res) => {
  try {
    const chatId = req.body.chatId || req.body.chat_id;
    const senderId = req.user?._id || req.user?.id;
    if (!chatId || !senderId || !req.file) return res.status(400).json({ message: 'Invalid request' });

    const fileUrl = `/uploads/Chat/${req.file.filename}`;
    const type = req.file.mimetype.startsWith('image/') ? 'image' : 'file';

    const message = await Message.create({
      chat: chatId,
      sender: senderId,
      content: req.file.originalname,
      messageType: type,
      attachments: [{
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl
      }]
    });

    const populated = await Message.findById(message._id).populate('sender', 'fullname avatarUrl email');
    const io = req.app?.get('io');
    if (io) io.to(chatId.toString()).emit('receiveMessage', populated);
    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// POST /api/chats/upload-multiple
router.post('/upload-multiple', authenticate, upload.array('files', 6), async (req, res) => {
  try {
    const chatId = req.body.chatId || req.body.chat_id;
    const senderId = req.user?._id || req.user?.id;
    if (!chatId || !senderId || !req.files || req.files.length === 0) return res.status(400).json({ message: 'Invalid request' });

    const fileUrls = req.files.map(f => `/uploads/Chat/${f.filename}`);
    const message = await Message.create({
      chat: chatId,
      sender: senderId,
      content: `${req.files.length} files`,
      messageType: 'multiple-images',
      attachments: req.files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        url: `/uploads/Chat/${f.filename}`
      }))
    });

    const populated = await Message.findById(message._id).populate('sender', 'fullname avatarUrl email');
    const io = req.app?.get('io');
    if (io) io.to(chatId.toString()).emit('receiveMessage', populated);
    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Recent users for forwarding
router.get('/recent-users', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const recentChats = await Chat.find({ participants: currentUserId, lastMessage: { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate('participants', 'fullname avatarUrl email');
    const usersMap = new Map();
    recentChats.forEach(chat => {
      chat.participants.forEach(p => {
        if (p && p._id && p._id.toString() !== currentUserId.toString()) {
          usersMap.set(p._id.toString(), p);
        }
      });
    });
    return res.json({ users: Array.from(usersMap.values()) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

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