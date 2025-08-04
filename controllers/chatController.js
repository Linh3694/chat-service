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
        const existingChats = await database.query(`
          SELECT * FROM \`tabERP Chat\`
          WHERE JSON_CONTAINS(participants, ?) 
          AND JSON_CONTAINS(participants, ?)
          AND is_group = 0
          AND archived = 0
          LIMIT 1
        `, [JSON.stringify(current_user_id), JSON.stringify(participant_id)]);

        if (existingChats.length > 0) {
          chat = existingChats[0];
        } else {
          // Create new direct chat
          const participants = [current_user_id, participant_id];
          const chatData = {
            name: `CHAT-${Date.now()}`,
            chat_name: null,
            participants: JSON.stringify(participants),
            chat_type: 'direct',
            is_group: 0,
            message_count: 0,
            creator: current_user_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            creation: new Date().toISOString(),
            modified: new Date().toISOString(),
            owner: current_user_id,
            modified_by: current_user_id
          };

          await database.insert('ERP Chat', chatData);
          chat = chatData;
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
        let sql = `
          SELECT c.*, 
                 cm.message as last_message_content,
                 cm.sent_at as last_message_time,
                 u.full_name as last_sender_name
          FROM \`tabERP Chat\` c
          LEFT JOIN \`tabERP Chat Message\` cm ON c.last_message = cm.name
          LEFT JOIN \`tabUser\` u ON cm.sender = u.name
          WHERE JSON_CONTAINS(c.participants, ?) 
          AND c.archived = 0
        `;
        const params = [JSON.stringify(user_id)];

        if (search) {
          sql += ` AND (c.chat_name LIKE ? OR cm.message LIKE ?)`;
          params.push(`%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY c.updated_at DESC LIMIT ?`;
        params.push(parseInt(limit));

        chats = await database.query(sql, params);

        // Parse participants for each chat
        chats = chats.map(chat => ({
          ...chat,
          participants: JSON.parse(chat.participants || '[]')
        }));

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
      const chat = await database.get('ERP Chat', chat_id);
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const participants = JSON.parse(chat.participants || '[]');
      if (!participants.includes(sender_id)) {
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
        attachments: attachments ? JSON.stringify(attachments) : null,
        sent_at: new Date().toISOString(),
        delivery_status: 'sent',
        read_by: JSON.stringify([sender_id]),
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: sender_id,
        modified_by: sender_id
      };

      await database.insert('ERP Chat Message', messageData);

      // Update chat's last message
      const messageCount = await database.query(
        'SELECT COUNT(*) as count FROM `tabERP Chat Message` WHERE chat = ?',
        [chat_id]
      );

      await database.update('ERP Chat', chat_id, {
        last_message: messageData.name,
        last_message_time: messageData.sent_at,
        message_count: messageCount[0].count,
        updated_at: new Date().toISOString(),
        modified: new Date().toISOString()
      });

      // Cache message if temp_id provided
      if (temp_id) {
        await redisClient.setTempMessage(temp_id, messageData);
      }

      // Invalidate related caches
      await redisClient.invalidateChatCaches(chat_id, participants);
      for (const participantId of participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }

      // Emit real-time message
      const io = req.app?.get('io');
      if (io) {
        // Send to chat room
        io.to(`chat:${chat_id}`).emit('new_message', {
          ...messageData,
          timestamp: messageData.sent_at
        });

        // Send chat update to participants
        participants.forEach(participantId => {
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
        let sql = `
          SELECT m.*, 
                 u.full_name as sender_name,
                 u.avatar_url as sender_avatar,
                 rm.message as reply_message,
                 ru.full_name as reply_sender_name
          FROM \`tabERP Chat Message\` m
          LEFT JOIN \`tabUser\` u ON m.sender = u.name
          LEFT JOIN \`tabERP Chat Message\` rm ON m.reply_to = rm.name
          LEFT JOIN \`tabUser\` ru ON rm.sender = ru.name
          WHERE m.chat = ?
        `;
        const params = [chat_id];

        if (before_message) {
          const beforeMsg = await database.get('ERP Chat Message', before_message);
          if (beforeMsg) {
            sql += ` AND m.sent_at < ?`;
            params.push(beforeMsg.sent_at);
          }
        }

        if (search) {
          sql += ` AND m.message LIKE ?`;
          params.push(`%${search}%`);
        }

        sql += ` ORDER BY m.sent_at DESC LIMIT ?`;
        params.push(parseInt(limit));

        messages = await database.query(sql, params);

        // Parse JSON fields
        messages = messages.map(msg => ({
          ...msg,
          read_by: JSON.parse(msg.read_by || '[]'),
          attachments: msg.attachments ? JSON.parse(msg.attachments) : null
        }));

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
          const message = await database.get('ERP Chat Message', messageId);
          if (message) {
            const readBy = JSON.parse(message.read_by || '[]');
            if (!readBy.includes(userId)) {
              readBy.push(userId);
              await database.update('ERP Chat Message', messageId, {
                read_by: JSON.stringify(readBy),
                delivery_status: 'read',
                modified: new Date().toISOString()
              });
              updatedCount++;
            }
          }
        }
      } else {
        // Mark all unread messages in chat as read
        const unreadMessages = await database.query(`
          SELECT name, read_by FROM \`tabERP Chat Message\`
          WHERE chat = ? AND JSON_SEARCH(read_by, 'one', ?) IS NULL
        `, [chat_id, userId]);

        for (const message of unreadMessages) {
          const readBy = JSON.parse(message.read_by || '[]');
          readBy.push(userId);
          await database.update('ERP Chat Message', message.name, {
            read_by: JSON.stringify(readBy),
            delivery_status: 'read',
            modified: new Date().toISOString()
          });
          updatedCount++;
        }
      }

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(chat_id);

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
      const originalMessage = await database.get('ERP Chat Message', reply_to_id);
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
      const originalMessage = await database.get('ERP Chat Message', message_id);
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
        sent_at: new Date().toISOString(),
        delivery_status: 'sent',
        read_by: JSON.stringify([sender_id]),
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: sender_id,
        modified_by: sender_id
      };

      await database.insert('ERP Chat Message', messageData);

      // Update target chat
      await database.update('ERP Chat', to_chat_id, {
        last_message: messageData.name,
        last_message_time: messageData.sent_at,
        updated_at: new Date().toISOString()
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

      const message = await database.get('ERP Chat Message', message_id);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (for_everyone && message.sender !== user_id) {
        return res.status(403).json({ error: 'Only sender can delete message for everyone' });
      }

      if (for_everyone) {
        // Delete for everyone
        await database.update('ERP Chat Message', message_id, {
          message: 'This message was deleted',
          is_deleted: 1,
          deleted_at: new Date().toISOString(),
          modified: new Date().toISOString()
        });
      } else {
        // Delete for self only - add to deleted_for array
        const deletedFor = JSON.parse(message.deleted_for || '[]');
        if (!deletedFor.includes(user_id)) {
          deletedFor.push(user_id);
          await database.update('ERP Chat Message', message_id, {
            deleted_for: JSON.stringify(deletedFor),
            modified: new Date().toISOString()
          });
        }
      }

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(message.chat);

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

      let sql = `
        SELECT m.*, c.chat_name, u.full_name as sender_name
        FROM \`tabERP Chat Message\` m
        JOIN \`tabERP Chat\` c ON m.chat = c.name
        JOIN \`tabUser\` u ON m.sender = u.name
        WHERE m.message LIKE ?
        AND JSON_CONTAINS(c.participants, ?)
        AND (m.deleted_for IS NULL OR JSON_SEARCH(m.deleted_for, 'one', ?) IS NULL)
      `;

      const params = [`%${query}%`, JSON.stringify(user_id), user_id];

      if (chat_id) {
        sql += ` AND m.chat = ?`;
        params.push(chat_id);
      }

      sql += ` ORDER BY m.sent_at DESC LIMIT ?`;
      params.push(parseInt(limit));

      const results = await database.query(sql, params);

      res.json({
        message: results,
        status: 'success',
        total: results.length,
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