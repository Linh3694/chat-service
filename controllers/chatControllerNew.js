const Chat = require('../models/Chat');
const Message = require('../models/Message');
const redisClient = require('../config/redis');
const axios = require('axios');

// Frappe API configuration
const FRAPPE_API_URL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';

// Helper function to get user from Frappe
async function getFrappeUser(userId, token) {
  try {
    const response = await axios.get(`${FRAPPE_API_URL}/api/resource/User/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Frappe-CSRF-Token': token
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('Error getting user from Frappe:', error);
    return null;
  }
}

class ChatController {
  // Create or get existing chat between users
  async createOrGetChat(req, res) {
    try {
      const { participant_id } = req.body;
      const current_user_id = req.user?._id;

      if (!participant_id || !current_user_id) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'participant_id and current_user_id are required'
        });
      }

      // Check cache first
      const cacheKey = `chat:${current_user_id}_${participant_id}`;
      let chat = await redisClient.getChatData(cacheKey);

      if (!chat) {
        // Search for existing direct chat (not group)
        const existingChats = await Chat.find({
          participants: { $all: [current_user_id, participant_id] },
          isGroup: false
        });

        if (existingChats.length > 0) {
          chat = existingChats[0];
        } else {
          // Create new direct chat
          const participants = [current_user_id, participant_id];
          chat = new Chat({
            participants: participants,
            isGroup: false,
            creator: current_user_id
          });

          await chat.save();

          // Publish chat creation event
          await redisClient.publishChatEvent('chat_created', {
            chat_id: chat._id.toString(),
            creator: current_user_id,
            participants: participants
          });
        }

        // Cache the chat
        await redisClient.setChatData(cacheKey, chat);
      }

      res.json({
        message: chat,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in createOrGetChat:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Send message (Mongoose-based)
  async sendMessage(req, res) {
    try {
      const body = req.body || {};
      const chatId = body.chat_id || body.chatId;
      const senderId = req.user?._id || req.user?.id;
      const content = (body.content || '').trim();
      const messageType = body.message_type || body.type || 'text';
      const replyTo = body.reply_to || body.replyTo || null;

      if (!chatId || !senderId) {
        return res.status(400).json({ error: 'chat_id and sender are required' });
      }

      // Verify chat & permission
      const chat = await Chat.findById(chatId);
      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      if (!chat.participants.some(p => p.toString() === senderId.toString())) {
        return res.status(403).json({ error: 'No access to this chat' });
      }

      if (!content && !(body.is_emoji || body.isEmoji)) {
        return res.status(400).json({ error: 'Content cannot be empty' });
      }

      // Create message
      const message = await Message.create({
        chat: chatId,
        sender: senderId,
        content,
        messageType,
        replyTo: replyTo || undefined,
        attachments: body.attachments || [],
        isEmoji: !!(body.is_emoji || body.isEmoji),
        emojiId: body.emoji_id || body.emojiId,
        emojiType: body.emoji_type || body.emojiType,
        emojiName: body.emoji_name || body.emojiName,
        emojiUrl: body.emoji_url || body.emojiUrl,
      });

      // Update chat lastMessage
      chat.lastMessage = message._id;
      chat.updatedAt = new Date();
      await chat.save();

      const populatedMessage = await Message.findById(message._id)
        .populate('sender', 'fullname avatarUrl email')
        .populate({ path: 'replyTo', populate: { path: 'sender', select: 'fullname avatarUrl email' } });

      // Emit compatibility event for legacy mobile (if io exists)
      const io = req.app?.get('io');
      if (io) {
        io.to(chatId.toString()).emit('receiveMessage', populatedMessage);
      }

      return res.status(201).json(populatedMessage);
    } catch (error) {
      console.error('Error in sendMessage (new):', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }

  // Mark messages as read for a chat
  async markMessagesRead(req, res) {
    try {
      const chatId = req.params.chat_id || req.params.chatId;
      const userId = req.user?._id || req.user?.id;
      if (!chatId || !userId) return res.status(400).json({ error: 'chatId and user required' });

      const chat = await Chat.findById(chatId);
      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      if (!chat.participants.some(p => p.toString() === userId.toString())) {
        return res.status(403).json({ error: 'No access to this chat' });
      }

      await Message.updateMany(
        { chat: chatId, sender: { $ne: userId }, 'readBy.user': { $ne: userId } },
        { $push: { readBy: { user: userId, readAt: new Date() } }, $set: { deliveryStatus: 'read' } }
      );

      return res.json({ success: true });
    } catch (error) {
      console.error('Error in markMessagesRead (new):', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }

  // Reply to message (Mongoose-based)
  async replyToMessage(req, res) {
    try {
      const body = req.body || {};
      req.body = { ...body, message_type: body.message_type || body.type || 'text' };
      return this.sendMessage(req, res);
    } catch (error) {
      console.error('Error in replyToMessage (new):', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }

  // Forward message (Mongoose-based)
  async forwardMessage(req, res) {
    try {
      const body = req.body || {};
      const originalId = body.message_id || body.messageId;
      const toChatId = body.to_chat_id || body.toChatId;
      const senderId = req.user?._id || req.user?.id;

      const originalMessage = await Message.findById(originalId);
      if (!originalMessage) return res.status(404).json({ error: 'Original message not found' });

      const chat = await Chat.findById(toChatId);
      if (!chat) return res.status(404).json({ error: 'Target chat not found' });
      if (!chat.participants.some(p => p.toString() === senderId.toString())) {
        return res.status(403).json({ error: 'No access to target chat' });
      }

      const forwarded = await Message.create({
        chat: toChatId,
        sender: senderId,
        content: originalMessage.content,
        messageType: originalMessage.messageType,
        isForwarded: true,
        originalMessage: originalMessage._id,
        originalSender: originalMessage.sender,
        attachments: originalMessage.attachments,
      });

      await Chat.findByIdAndUpdate(toChatId, { lastMessage: forwarded._id, updatedAt: new Date() });

      const populatedMessage = await Message.findById(forwarded._id)
        .populate('sender', 'fullname avatarUrl email')
        .populate('originalSender', 'fullname avatarUrl email');

      const io = req.app?.get('io');
      if (io) {
        io.to(toChatId.toString()).emit('receiveMessage', populatedMessage);
      }

      return res.status(201).json(populatedMessage);
    } catch (error) {
      console.error('Error in forwardMessage (new):', error);
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }

  // Get user's chats with pagination
  async getUserChats(req, res) {
    try {
      const { user_id } = req.params;
      const { limit = 50, search = null } = req.query;

      // Check cache first
      const cacheKey = `user_chats:${user_id}:${limit}:${search || 'all'}`;
      let chats = await redisClient.getUserChats(cacheKey);

      if (!chats) {
        let filter = {
          participants: user_id
        };

        if (search) {
          filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ];
        }

        chats = await Chat.find(filter)
          .populate('participants', 'fullname email avatarUrl')
          .populate('lastMessage')
          .sort({ updatedAt: -1 })
          .limit(parseInt(limit));

        // Cache the results
        await redisClient.setUserChats(cacheKey, chats, 300);
      }

      // Format response to match expected structure
      const formattedChats = chats.map(chat => ({
        _id: chat._id,
        name: chat.name,
        description: chat.description,
        isGroup: chat.isGroup,
        participants: chat.participants,
        lastMessage: chat.lastMessage,
        updatedAt: chat.updatedAt,
        createdAt: chat.createdAt
      }));

      res.json({
        message: formattedChats,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getUserChats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get messages for a chat
  async getChatMessages(req, res) {
    try {
      const { chat_id } = req.params;
      const { limit = 50, before = null } = req.query;

      // Verify user has access to this chat
      const chat = await Chat.findById(chat_id);
      if (!chat) {
        return res.status(404).json({
          error: 'Chat not found'
        });
      }

      if (!chat.participants.includes(req.user._id)) {
        return res.status(403).json({
          error: 'No access to this chat'
        });
      }

      // Build message query
      let messageQuery = { 
        chat: chat_id, 
        isDeleted: { $ne: true } 
      };

      if (before) {
        messageQuery.sentAt = { $lt: new Date(before) };
      }

      const messages = await Message.find(messageQuery)
        .populate('sender', 'fullname email avatarUrl')
        .populate('replyTo')
        .sort({ sentAt: -1 })
        .limit(parseInt(limit));

      res.json({
        message: messages.reverse(), // Reverse to show oldest first
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getChatMessages:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Create group chat
  async createGroupChat(req, res) {
    try {
      const { name, description, participant_ids } = req.body;
      const creator_id = req.user._id;

      if (!name || !participant_ids || participant_ids.length < 2) {
        return res.status(400).json({
          error: 'Group name and at least 2 participants required'
        });
      }

      // Include creator in participants
      const participants = [...new Set([creator_id, ...participant_ids])];

      const groupChat = new Chat({
        name: name,
        description: description || '',
        isGroup: true,
        creator: creator_id,
        participants: participants,
        admins: [creator_id]
      });

      await groupChat.save();

      // Populate for response
      const populatedChat = await Chat.findById(groupChat._id)
        .populate('participants', 'fullname email avatarUrl')
        .populate('creator', 'fullname email')
        .populate('admins', 'fullname email');

      // Publish group chat creation event
      await redisClient.publishChatEvent('group_chat_created', {
        chat_id: groupChat._id.toString(),
        creator: creator_id,
        participants: participants,
        name: name
      });

      // Invalidate user chats cache for all participants
      for (const participantId of participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }

      res.status(201).json({
        message: populatedChat,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in createGroupChat:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Add user to group chat
  async addUserToGroupChat(req, res) {
    try {
      const { chat_id } = req.params;
      const { user_id } = req.body;
      const current_user_id = req.user._id;

      const chat = await Chat.findById(chat_id);
      if (!chat) {
        return res.status(404).json({
          error: 'Chat not found'
        });
      }

      if (!chat.isGroup) {
        return res.status(400).json({
          error: 'Not a group chat'
        });
      }

      // Check permissions
      if (!chat.admins.includes(current_user_id) && chat.creator.toString() !== current_user_id.toString()) {
        return res.status(403).json({
          error: 'Only admins can add users'
        });
      }

      // Check if user is already in the chat
      if (chat.participants.includes(user_id)) {
        return res.status(400).json({
          error: 'User already in the chat'
        });
      }

      // Add user to participants
      chat.participants.push(user_id);
      chat.updatedAt = new Date();
      await chat.save();

      // Create system message
      const systemMessage = new Message({
        chat: chat_id,
        sender: current_user_id,
        content: `${req.user.fullname} added a new user to the group`,
        messageType: 'system'
      });
      await systemMessage.save();

      // Invalidate caches
      await redisClient.invalidateUserChatsCache(user_id);
      for (const participantId of chat.participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }

      res.json({
        message: 'User added successfully',
        status: 'success'
      });

    } catch (error) {
      console.error('Error in addUserToGroupChat:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get chat statistics
  async getChatStats(req, res) {
    try {
      const { chat_id } = req.params;
      const { days = 30 } = req.query;

      const chat = await Chat.findById(chat_id);
      if (!chat) {
        return res.status(404).json({
          error: 'Chat not found'
        });
      }

      // Check permissions
      if (!chat.participants.includes(req.user._id)) {
        return res.status(403).json({
          error: 'No access to this chat'
        });
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

      // Get message statistics
      const messageStats = await Message.aggregate([
        {
          $match: {
            chat: chat._id,
            sentAt: { $gte: cutoffDate },
            isDeleted: { $ne: true }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } },
            messageCount: { $sum: 1 },
            activeUsers: { $addToSet: "$sender" }
          }
        },
        {
          $project: {
            date: "$_id",
            messageCount: 1,
            activeUsersCount: { $size: "$activeUsers" }
          }
        },
        { $sort: { date: -1 } }
      ]);

      res.json({
        message: {
          chatId: chat_id,
          period: `${days} days`,
          stats: messageStats
        },
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getChatStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}

module.exports = new ChatController();