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

      const message = await database.get('messages', { name: message_id });
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Check if user has access to this message
      const chat = await database.get('chats', { name: message.chat });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // Check if message is deleted for this user
      if (message.deleted_for && message.deleted_for.includes(user_id)) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Get sender information
      const sender = await database.get('users', { name: message.sender });
      if (sender) {
        message.sender_name = sender.full_name;
        message.sender_avatar = sender.avatar_url;
      }

      // Get chat information
      message.chat_name = chat.chat_name;

      // Get reply message info if exists
      if (message.reply_to) {
        const replyMsg = await database.get('messages', { name: message.reply_to });
        if (replyMsg) {
          message.reply_message = replyMsg.message;
          const replySender = await database.get('users', { name: replyMsg.sender });
          message.reply_sender_name = replySender?.full_name;
        }
      }

      res.json({
        message: message,
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
      const chat = await database.get('chats', { name: chat_id });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
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
        created_at: new Date(),
        updated_at: new Date()
      };

      await database.insert('attachments', fileData);

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

      const attachment = await database.get('attachments', { name: attachment_id });
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Verify user has access to the chat
      const chat = await database.get('chats', { name: attachment.chat });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
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

      const reactions = await database.getAll('reactions', { message: message_id }, {
        sort: { created_at: 1 }
      });

      // Get user information for each reaction
      for (let reaction of reactions) {
        const user = await database.get('users', { name: reaction.user });
        if (user) {
          reaction.full_name = user.full_name;
          reaction.avatar_url = user.avatar_url;
        }
      }

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
      const message = await database.get('messages', { name: message_id });
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const chat = await database.get('chats', { name: message.chat });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // Check if user already reacted with this emoji
      const existing = await database.get('reactions', {
        message: message_id,
        user: user_id,
        emoji: emoji
      });

      if (existing) {
        // Remove existing reaction
        await database.delete('reactions', { name: existing.name });
        
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
          created_at: new Date(),
          updated_at: new Date()
        };

        await database.insert('reactions', reactionData);

        res.json({
          message: 'Reaction added',
          status: 'success',
          action: 'added'
        });
      }

      // Publish reaction event
      await redisClient.publishChatEvent('message_reaction', {
        message_id,
        user_id,
        emoji,
        action: existing ? 'removed' : 'added',
        chat_id: message.chat
      });

      // Emit real-time update
      const io = req.app?.get('io');
      if (io) {
        io.to(`chat:${message.chat}`).emit('message_reaction', {
          message_id,
          user_id,
          emoji,
          action: existing ? 'removed' : 'added',
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

      const message = await database.get('messages', { name: message_id });
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Verify user has access and is admin of group (for group chats)
      const chat = await database.get('chats', { name: message.chat });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      // For group chats, only admins can pin messages
      if (chat.is_group && chat.creator !== user_id) {
        return res.status(403).json({ error: 'Only group admin can pin messages' });
      }

      const isPinned = message.is_pinned ? 0 : 1;
      await database.update('messages', { name: message_id }, {
        is_pinned: isPinned,
        pinned_by: isPinned ? user_id : null,
        pinned_at: isPinned ? new Date() : null,
        updated_at: new Date()
      });

      // Publish pin event
      await redisClient.publishChatEvent('message_pinned', {
        message_id,
        chat_id: message.chat,
        is_pinned: isPinned,
        pinned_by: user_id
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
      const chat = await database.get('chats', { name: chat_id });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this chat' });
      }

      const pinnedMessages = await database.getAll('messages', {
        chat: chat_id,
        is_pinned: 1
      }, {
        sort: { pinned_at: -1 }
      });

      // Get additional information for each message
      for (let msg of pinnedMessages) {
        const sender = await database.get('users', { name: msg.sender });
        const pinnedBy = await database.get('users', { name: msg.pinned_by });
        
        if (sender) {
          msg.sender_name = sender.full_name;
          msg.sender_avatar = sender.avatar_url;
        }
        
        if (pinnedBy) {
          msg.pinned_by_name = pinnedBy.full_name;
        }
      }

      res.json({
        message: pinnedMessages,
        status: 'success',
        total: pinnedMessages.length
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

      const message = await database.get('messages', { name: message_id });
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Verify access
      const chat = await database.get('chats', { name: message.chat });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      if (!chat.participants.includes(user_id)) {
        return res.status(403).json({ error: 'No access to this message' });
      }

      const history = await database.getAll('message_history', { message: message_id }, {
        sort: { created_at: 1 }
      });

      // Get editor information for each history entry
      for (let entry of history) {
        const editor = await database.get('users', { name: entry.edited_by });
        if (editor) {
          entry.edited_by_name = editor.full_name;
        }
      }

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

      const message = await database.get('messages', { name: message_id });
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
        edited_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      };

      await database.insert('message_history', historyData);

      // Update message
      await database.update('messages', { name: message_id }, {
        message: content.trim(),
        is_edited: 1,
        edited_at: new Date(),
        updated_at: new Date()
      });

      // Invalidate caches
      await redisClient.invalidateChatMessagesCache(message.chat);

      // Publish edit event
      await redisClient.publishChatEvent('message_edited', {
        message_id,
        chat_id: message.chat,
        edited_by: user_id,
        new_content: content.trim()
      });

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