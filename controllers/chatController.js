const database = require('../config/database');
const redisClient = require('../config/redis');

class ChatController {
  // Create or get existing chat between users
  async createOrGetChat(req, res) {
    try {
      const { participant_id } = req.body;
      const current_user_id = req.user?.id || req.body.current_user_id;

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
        const existingChats = await database.getAll('chats', {
          participants: { $all: [current_user_id, participant_id] },
          is_group: 0,
          archived: { $ne: 1 }
        });

        if (existingChats.length > 0) {
          chat = existingChats[0];
        } else {
          // Create new direct chat
          const participants = [current_user_id, participant_id];
          const chatData = {
            name: `CHAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            chat_name: null,
            participants: participants,
            chat_type: 'direct',
            is_group: 0,
            message_count: 0,
            creator: current_user_id,
            archived: 0,
            created_at: new Date(),
            updated_at: new Date()
          };

          await database.insert('chats', chatData);
          chat = chatData;

          // Publish chat creation event
          await redisClient.publishChatEvent('chat_created', {
            chat_id: chat.name,
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
          participants: user_id,
          archived: { $ne: 1 }
        };

        if (search) {
          filter.$or = [
            { chat_name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ];
        }

        chats = await database.getAll('chats', filter, {
          sort: { updated_at: -1 },
          limit: parseInt(limit)
        });

        // Get last message for each chat
        for (let chat of chats) {
          const lastMessage = await database.get('messages', {
            chat: chat.name,
            is_deleted: { $ne: 1 }
          }, { sort: { sent_at: -1 } });

          if (lastMessage) {
            chat.last_message_content = lastMessage.message;
            chat.last_message_time = lastMessage.sent_at;
            chat.last_sender_name = lastMessage.sender;
          }
        }

        // Cache the results
        await redisClient.setUserChats(cacheKey, chats);
      }

      res.json({
        message: chats,
        status: 'success',
        total: chats.length
      });

    } catch (error) {
      console.error('Error in getUserChats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Send message with advanced features
  async sendMessage(req, res) {
    try {
      const {
        chat_id,
        content,
        message_type = 'text',
        reply_to = null,
        is_emoji = false,
        emoji_id = null,
        emoji_type = null,
        emoji_name = null,
        emoji_url = null,
        temp_id = null,
        attachments = null
      } = req.body;

      const sender_id = req.user?.id || req.body.sender_id;

      if (!chat_id || !sender_id) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'chat_id and sender_id are required'
        });
      }

      // Validate content for non-emoji messages
      if ((!content || !content.trim()) && !is_emoji) {
        return res.status(400).json({
          error: 'Content cannot be empty for text messages'
        });
      }

      // Check if chat exists and user has permission
      const chat = await database.get('chats', { name: chat_id });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(sender_id)) {
        return res.status(403).json({
          error: 'No permission to send message to this chat'
        });
      }

      // Check for duplicate message by temp_id
      if (temp_id) {
        const existing = await redisClient.getTempMessage(temp_id);
        if (existing) {
          return res.json(existing);
        }
      }

      // Create message record
      const messageData = {
        name: `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        chat: chat_id,
        sender: sender_id,
        message: content ? content.trim().substring(0, 4000) : '',
        message_type,
        is_emoji: is_emoji ? 1 : 0,
        emoji_id,
        emoji_type,
        emoji_name,
        emoji_url,
        reply_to,
        attachments: attachments || null,
        sent_at: new Date(),
        delivery_status: 'sent',
        read_by: [sender_id],
        is_deleted: 0,
        is_edited: 0,
        is_pinned: 0
      };

      await database.insert('messages', messageData);

      // Update chat's last message
      const messageCount = await database.db.collection('messages').countDocuments({
        chat: chat_id,
        is_deleted: { $ne: 1 }
      });

      await database.update('chats', { name: chat_id }, {
        last_message: messageData.name,
        last_message_time: messageData.sent_at,
        message_count: messageCount,
        updated_at: new Date()
      });

      // Cache message if temp_id provided
      if (temp_id) {
        await redisClient.setTempMessage(temp_id, messageData);
      }

      // Invalidate related caches
      await redisClient.invalidateChatCaches(chat_id, chat.participants);
      for (const participantId of chat.participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }

      // Publish message event to other services
      await redisClient.publishChatEvent('message_sent', {
        chat_id,
        message_id: messageData.name,
        sender_id,
        message_preview: content?.substring(0, 100),
        message_type,
        timestamp: messageData.sent_at
      });

      // Emit real-time message
      const io = req.app?.get('io');
      if (io) {
        // Send to chat room
        io.to(`chat:${chat_id}`).emit('new_message', {
          ...messageData,
          timestamp: messageData.sent_at
        });

        // Send chat update to participants
        chat.participants.forEach(participantId => {
          if (participantId !== sender_id) {
            io.to(`user:${participantId}`).emit('chat_updated', {
              chat_id,
              last_message: content?.substring(0, 100),
              last_message_time: messageData.sent_at,
              sender_id
            });
          }
        });
      }

      res.json({
        message: messageData,
        status: 'success',
        temp_id
      });

    } catch (error) {
      console.error('Error in sendMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get chat messages with pagination
  async getChatMessages(req, res) {
    try {
      const { chat_id } = req.params;
      const { limit = 50, before_message = null, search = null } = req.query;

      // Check cache first
      const cacheKey = `chat_messages:${chat_id}:${limit}:${before_message || 'latest'}:${search || 'all'}`;
      let messages = await redisClient.getChatMessages(cacheKey);

      if (!messages) {
        let filter = {
          chat: chat_id,
          is_deleted: { $ne: 1 }
        };

        if (before_message) {
          const beforeMsg = await database.get('messages', { name: before_message });
          if (beforeMsg) {
            filter.sent_at = { $lt: beforeMsg.sent_at };
          }
        }

        if (search) {
          filter.message = { $regex: search, $options: 'i' };
        }

        messages = await database.getAll('messages', filter, {
          sort: { sent_at: -1 },
          limit: parseInt(limit)
        });

        // Get sender information for each message
        for (let msg of messages) {
          const sender = await database.get('users', { name: msg.sender });
          if (sender) {
            msg.sender_name = sender.full_name;
            msg.sender_avatar = sender.avatar_url;
          }

          // Get reply message info if exists
          if (msg.reply_to) {
            const replyMsg = await database.get('messages', { name: msg.reply_to });
            if (replyMsg) {
              msg.reply_message = replyMsg.message;
              const replySender = await database.get('users', { name: replyMsg.sender });
              msg.reply_sender_name = replySender?.full_name;
            }
          }
        }

        // Cache the results
        await redisClient.setChatMessages(cacheKey, messages);
      }

      res.json({
        message: messages.reverse(), // Show oldest first
        status: 'success',
        total: messages.length
      });

    } catch (error) {
      console.error('Error in getChatMessages:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Mark messages as read
  async markMessagesRead(req, res) {
    try {
      const { chat_id } = req.params;
      const { message_ids = [], user_id } = req.body;

      const userId = user_id || req.user?.id;
      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      let updatedCount = 0;

      if (message_ids.length > 0) {
        // Mark specific messages as read
        for (const messageId of message_ids) {
          const message = await database.get('messages', { name: messageId });
          if (message && !message.read_by.includes(userId)) {
            message.read_by.push(userId);
            await database.update('messages', { name: messageId }, {
              read_by: message.read_by,
              delivery_status: 'read',
              updated_at: new Date()
            });
            updatedCount++;
          }
        }
      } else {
        // Mark all unread messages in chat as read
        const unreadMessages = await database.getAll('messages', {
          chat: chat_id,
          sender: { $ne: userId },
          read_by: { $ne: userId },
          is_deleted: { $ne: 1 }
        });

        for (const message of unreadMessages) {
          message.read_by.push(userId);
          await database.update('messages', { name: message.name }, {
            read_by: message.read_by,
            delivery_status: 'read',
            updated_at: new Date()
          });
          updatedCount++;
        }
      }

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(chat_id);

      // Publish read event
      await redisClient.publishChatEvent('messages_read', {
        chat_id,
        user_id: userId,
        message_ids: message_ids.length > 0 ? message_ids : 'all',
        count: updatedCount
      });

      // Emit read receipt
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${chat_id}`).emit('messages_read', {
          user_id: userId,
          chat_id,
          message_ids: message_ids.length > 0 ? message_ids : 'all',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: `${updatedCount} messages marked as read`,
        status: 'success',
        updated_count: updatedCount
      });

    } catch (error) {
      console.error('Error in markMessagesRead:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Reply to message
  async replyToMessage(req, res) {
    try {
      const { chat_id, content, reply_to_id, message_type = 'text' } = req.body;
      const sender_id = req.user?.id || req.body.sender_id;

      // Check if original message exists
      const originalMessage = await database.get('messages', { name: reply_to_id });
      if (!originalMessage) {
        return res.status(404).json({ error: 'Original message not found' });
      }

      // Use sendMessage with reply_to parameter
      req.body = {
        ...req.body,
        reply_to: reply_to_id
      };

      return await this.sendMessage(req, res);

    } catch (error) {
      console.error('Error in replyToMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Forward message
  async forwardMessage(req, res) {
    try {
      const { message_id, to_chat_id } = req.body;
      const sender_id = req.user?.id || req.body.sender_id;

      // Get original message
      const originalMessage = await database.get('messages', { name: message_id });
      if (!originalMessage) {
        return res.status(404).json({ error: 'Original message not found' });
      }

      // Create forwarded message
      const messageData = {
        name: `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        chat: to_chat_id,
        sender: sender_id,
        message: originalMessage.message,
        message_type: originalMessage.message_type,
        is_forwarded: 1,
        original_message: message_id,
        original_sender: originalMessage.sender,
        attachments: originalMessage.attachments,
        sent_at: new Date(),
        delivery_status: 'sent',
        read_by: [sender_id],
        is_deleted: 0
      };

      await database.insert('messages', messageData);

      // Update target chat
      await database.update('chats', { name: to_chat_id }, {
        last_message: messageData.name,
        last_message_time: messageData.sent_at,
        updated_at: new Date()
      });

      // Publish forward event
      await redisClient.publishChatEvent('message_forwarded', {
        original_message_id: message_id,
        new_message_id: messageData.name,
        from_chat_id: originalMessage.chat,
        to_chat_id,
        sender_id
      });

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${to_chat_id}`).emit('new_message', messageData);
      }

      res.json({
        message: messageData,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in forwardMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Delete message
  async deleteMessage(req, res) {
    try {
      const { message_id } = req.params;
      const { for_everyone = false } = req.body;
      const user_id = req.user?.id || req.body.user_id;

      const message = await database.get('messages', { name: message_id });
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (for_everyone && message.sender !== user_id) {
        return res.status(403).json({ error: 'Only sender can delete message for everyone' });
      }

      if (for_everyone) {
        // Delete for everyone
        await database.update('messages', { name: message_id }, {
          message: 'This message was deleted',
          is_deleted: 1,
          deleted_at: new Date(),
          updated_at: new Date()
        });
      } else {
        // Delete for self only - add to deleted_for array
        if (!message.deleted_for) message.deleted_for = [];
        if (!message.deleted_for.includes(user_id)) {
          message.deleted_for.push(user_id);
          await database.update('messages', { name: message_id }, {
            deleted_for: message.deleted_for,
            updated_at: new Date()
          });
        }
      }

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(message.chat);

      // Publish delete event
      await redisClient.publishChatEvent('message_deleted', {
        message_id,
        chat_id: message.chat,
        deleted_by: user_id,
        for_everyone
      });

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${message.chat}`).emit('message_deleted', {
          message_id,
          for_everyone,
          deleted_by: user_id,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: 'Message deleted successfully',
        status: 'success'
      });

    } catch (error) {
      console.error('Error in deleteMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Search messages across chats
  async searchMessages(req, res) {
    try {
      const { query, user_id, chat_id = null, limit = 50 } = req.query;

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          error: 'Search query must be at least 2 characters'
        });
      }

      let filter = {
        message: { $regex: query, $options: 'i' },
        is_deleted: { $ne: 1 }
      };

      if (chat_id) {
        filter.chat = chat_id;
      } else {
        // Get all chats where user is participant
        const userChats = await database.getAll('chats', {
          participants: user_id,
          archived: { $ne: 1 }
        });
        filter.chat = { $in: userChats.map(c => c.name) };
      }

      const messages = await database.getAll('messages', filter, {
        sort: { sent_at: -1 },
        limit: parseInt(limit)
      });

      // Get additional info for each message
      for (let msg of messages) {
        const chat = await database.get('chats', { name: msg.chat });
        const sender = await database.get('users', { name: msg.sender });
        
        msg.chat_name = chat?.chat_name;
        msg.sender_name = sender?.full_name;
      }

      res.json({
        message: messages,
        status: 'success',
        total: messages.length,
        query
      });

    } catch (error) {
      console.error('Error in searchMessages:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}

module.exports = new ChatController();