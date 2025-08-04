const database = require('../config/database');
const redisClient = require('../config/redis');
const path = require('path');
const fs = require('fs');

class MessageController {
  // Get message details with full context
  async getMessage(req, res) {
    try {
      const { message_id } = req.params;
      const user_id = req.user?.id || req.query.user_id;

      const message = await database.query(`
        SELECT m.*, 
               u.full_name as sender_name,
               u.avatar_url as sender_avatar,
               c.chat_name,
               rm.message as reply_message,
               ru.full_name as reply_sender_name
        FROM \`tabERP Chat Message\` m
        LEFT JOIN \`tabUser\` u ON m.sender = u.name
        LEFT JOIN \`tabERP Chat\` c ON m.chat = c.name
        LEFT JOIN \`tabERP Chat Message\` rm ON m.reply_to = rm.name
        LEFT JOIN \`tabUser\` ru ON rm.sender = ru.name
        WHERE m.name = ?
      `, [message_id]);

      if (!message || message.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const msg = message[0];

      // Check if user has access to this message
      const chat = await database.get('ERP Chat', msg.chat);
      const participants = JSON.parse(chat.participants || '[]');
      
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // Check if message is deleted for this user
      const deletedFor = JSON.parse(msg.deleted_for || '[]');
      if (deletedFor.includes(user_id)) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Parse JSON fields
      msg.read_by = JSON.parse(msg.read_by || '[]');
      msg.attachments = msg.attachments ? JSON.parse(msg.attachments) : null;

      res.json({
        message: msg,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Upload file attachment
  async uploadAttachment(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { chat_id } = req.body;
      const user_id = req.user?.id || req.body.user_id;

      // Verify user has access to chat
      const chat = await database.get('ERP Chat', chat_id);
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const participants = JSON.parse(chat.participants || '[]');
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this chat' });
      }

      const file = req.file;
      const fileData = {
        name: `ATT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file_name: file.originalname,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        chat: chat_id,
        uploaded_by: user_id,
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: user_id,
        modified_by: user_id
      };

      await database.insert('ERP Chat Attachment', fileData);

      res.json({
        message: {
          attachment_id: fileData.name,
          file_name: fileData.file_name,
          file_size: fileData.file_size,
          mime_type: fileData.mime_type,
          url: `/uploads/${path.basename(file.path)}`
        },
        status: 'success'
      });

    } catch (error) {
      console.error('Error in uploadAttachment:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Download attachment
  async downloadAttachment(req, res) {
    try {
      const { attachment_id } = req.params;
      const user_id = req.user?.id || req.query.user_id;

      const attachment = await database.get('ERP Chat Attachment', attachment_id);
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Verify user has access to the chat
      const chat = await database.get('ERP Chat', attachment.chat);
      const participants = JSON.parse(chat.participants || '[]');
      
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this attachment' });
      }

      // Check if file exists
      if (!fs.existsSync(attachment.file_path)) {
        return res.status(404).json({ error: 'File not found on server' });
      }

      res.download(attachment.file_path, attachment.file_name);

    } catch (error) {
      console.error('Error in downloadAttachment:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get message reactions
  async getMessageReactions(req, res) {
    try {
      const { message_id } = req.params;

      const reactions = await database.query(`
        SELECT r.*, u.full_name, u.avatar_url
        FROM \`tabERP Message Reaction\` r
        LEFT JOIN \`tabUser\` u ON r.user = u.name
        WHERE r.message = ?
        ORDER BY r.creation ASC
      `, [message_id]);

      // Group by emoji
      const grouped = {};
      reactions.forEach(reaction => {
        if (!grouped[reaction.emoji]) {
          grouped[reaction.emoji] = {
            emoji: reaction.emoji,
            count: 0,
            users: []
          };
        }
        grouped[reaction.emoji].count++;
        grouped[reaction.emoji].users.push({
          user: reaction.user,
          full_name: reaction.full_name,
          avatar_url: reaction.avatar_url
        });
      });

      res.json({
        message: Object.values(grouped),
        status: 'success'
      });

    } catch (error) {
      console.error('Error in getMessageReactions:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Add reaction to message
  async addReaction(req, res) {
    try {
      const { message_id } = req.params;
      const { emoji } = req.body;
      const user_id = req.user?.id || req.body.user_id;

      if (!emoji) {
        return res.status(400).json({ error: 'Emoji is required' });
      }

      // Check if message exists and user has access
      const message = await database.get('ERP Chat Message', message_id);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const chat = await database.get('ERP Chat', message.chat);
      const participants = JSON.parse(chat.participants || '[]');
      
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // Check if user already reacted with this emoji
      const existing = await database.query(
        'SELECT name FROM `tabERP Message Reaction` WHERE message = ? AND user = ? AND emoji = ?',
        [message_id, user_id, emoji]
      );

      if (existing.length > 0) {
        // Remove existing reaction
        await database.delete('ERP Message Reaction', existing[0].name);
        
        res.json({
          message: 'Reaction removed',
          status: 'success',
          action: 'removed'
        });
      } else {
        // Add new reaction
        const reactionData = {
          name: `REACT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          message: message_id,
          user: user_id,
          emoji: emoji,
          creation: new Date().toISOString(),
          modified: new Date().toISOString(),
          owner: user_id,
          modified_by: user_id
        };

        await database.insert('ERP Message Reaction', reactionData);

        res.json({
          message: 'Reaction added',
          status: 'success',
          action: 'added'
        });
      }

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${message.chat}`).emit('message_reaction', {
          message_id,
          user_id,
          emoji,
          action: existing.length > 0 ? 'removed' : 'added',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Error in addReaction:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Pin/unpin message
  async togglePinMessage(req, res) {
    try {
      const { message_id } = req.params;
      const user_id = req.user?.id || req.body.user_id;

      const message = await database.get('ERP Chat Message', message_id);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Verify user has access and is admin of group (for group chats)
      const chat = await database.get('ERP Chat', message.chat);
      const participants = JSON.parse(chat.participants || '[]');
      
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // For group chats, only admins can pin messages
      if (chat.is_group && chat.creator !== user_id) {
        return res.status(403).json({ error: 'Only group admin can pin messages' });
      }

      const isPinned = message.is_pinned ? 0 : 1;
      await database.update('ERP Chat Message', message_id, {
        is_pinned: isPinned,
        pinned_by: isPinned ? user_id : null,
        pinned_at: isPinned ? new Date().toISOString() : null,
        modified: new Date().toISOString()
      });

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${message.chat}`).emit('message_pinned', {
          message_id,
          is_pinned: isPinned,
          pinned_by: user_id,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: isPinned ? 'Message pinned' : 'Message unpinned',
        status: 'success',
        is_pinned: isPinned
      });

    } catch (error) {
      console.error('Error in togglePinMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get pinned messages in chat
  async getPinnedMessages(req, res) {
    try {
      const { chat_id } = req.params;
      const user_id = req.user?.id || req.query.user_id;

      // Verify access to chat
      const chat = await database.get('ERP Chat', chat_id);
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const participants = JSON.parse(chat.participants || '[]');
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this chat' });
      }

      const pinnedMessages = await database.query(`
        SELECT m.*, 
               u.full_name as sender_name,
               u.avatar_url as sender_avatar,
               pu.full_name as pinned_by_name
        FROM \`tabERP Chat Message\` m
        LEFT JOIN \`tabUser\` u ON m.sender = u.name
        LEFT JOIN \`tabUser\` pu ON m.pinned_by = pu.name
        WHERE m.chat = ? AND m.is_pinned = 1
        ORDER BY m.pinned_at DESC
      `, [chat_id]);

      // Parse JSON fields
      const messages = pinnedMessages.map(msg => ({
        ...msg,
        read_by: JSON.parse(msg.read_by || '[]'),
        attachments: msg.attachments ? JSON.parse(msg.attachments) : null
      }));

      res.json({
        message: messages,
        status: 'success',
        total: messages.length
      });

    } catch (error) {
      console.error('Error in getPinnedMessages:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get message history/edits
  async getMessageHistory(req, res) {
    try {
      const { message_id } = req.params;
      const user_id = req.user?.id || req.query.user_id;

      const message = await database.get('ERP Chat Message', message_id);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Verify access
      const chat = await database.get('ERP Chat', message.chat);
      const participants = JSON.parse(chat.participants || '[]');
      
      if (!participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      const history = await database.query(`
        SELECT h.*, u.full_name as edited_by_name
        FROM \`tabERP Message History\` h
        LEFT JOIN \`tabUser\` u ON h.edited_by = u.name
        WHERE h.message = ?
        ORDER BY h.creation ASC
      `, [message_id]);

      res.json({
        message: history,
        status: 'success',
        total: history.length
      });

    } catch (error) {
      console.error('Error in getMessageHistory:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Edit message
  async editMessage(req, res) {
    try {
      const { message_id } = req.params;
      const { content } = req.body;
      const user_id = req.user?.id || req.body.user_id;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Content cannot be empty' });
      }

      const message = await database.get('ERP Chat Message', message_id);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Only sender can edit message
      if (message.sender !== user_id) {
        return res.status(403).json({ error: 'Only sender can edit message' });
      }

      // Check if message is too old to edit (24 hours)
      const messageTime = new Date(message.sent_at);
      const now = new Date();
      const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
      
      if (hoursDiff > 24) {
        return res.status(403).json({ error: 'Message too old to edit' });
      }

      // Save original content to history
      const historyData = {
        name: `HIST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        message: message_id,
        original_content: message.message,
        edited_by: user_id,
        edited_at: new Date().toISOString(),
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: user_id,
        modified_by: user_id
      };

      await database.insert('ERP Message History', historyData);

      // Update message
      await database.update('ERP Chat Message', message_id, {
        message: content.trim(),
        is_edited: 1,
        edited_at: new Date().toISOString(),
        modified: new Date().toISOString()
      });

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(message.chat);

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${message.chat}`).emit('message_edited', {
          message_id,
          new_content: content.trim(),
          edited_by: user_id,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        message: 'Message edited successfully',
        status: 'success'
      });

    } catch (error) {
      console.error('Error in editMessage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}

module.exports = new MessageController();