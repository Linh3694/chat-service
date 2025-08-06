const express = require("express");
const cors = require("cors");
const { Server } = require('socket.io');
const http = require('http');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
require("dotenv").config({ path: './config.env' });

// Import configurations
const database = require('./config/database');
const redisClient = require('./config/redis');

const app = express();
const server = http.createServer(app);

// Ensure upload directory exists
const uploadPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Socket.IO setup with authentication
const io = new Server(server, {
  cors: { origin: "*" },
  allowRequest: (req, callback) => {
    const token = req._query?.token;
    if (!token) return callback("unauthorized", false);
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return callback("unauthorized", false);
      req.user = decoded;
      callback(null, true);
    });
  },
});

// Make io globally available for Redis pub/sub
global.io = io;

// Setup Redis adapter
(async () => {
  try {
    console.log('🔗 [Chat Service] Setting up Redis adapter...');
    await redisClient.connect();
    
    io.adapter(createAdapter(redisClient.getPubClient(), redisClient.getSubClient()));
    console.log('✅ [Chat Service] Redis adapter setup complete');
  } catch (error) {
    console.warn('⚠️ [Chat Service] Redis adapter setup failed:', error.message);
  }
})();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await database.connect();
  } catch (error) {
    console.error('❌ [Chat Service] Database connection failed:', error.message);
    process.exit(1);
  }
};

// Middleware
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use('/uploads', express.static(uploadPath));

// Add service info
app.use((req, res, next) => {
  res.setHeader('X-Service', 'chat-service');
  res.setHeader('X-Service-Version', '1.0.0');
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test MongoDB connection
    await database.db.admin().ping();
    
    // Test Redis connection
    await redisClient.client.ping();
    
    const onlineUsers = await redisClient.getOnlineUsersCount();
    const activeChats = await redisClient.getActiveChatsCount();
    
    res.status(200).json({ 
      status: 'ok', 
      service: 'chat-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'connected',
      redis: 'connected',
      online_users: onlineUsers,
      active_chats: activeChats
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'chat-service',
      error: error.message
    });
  }
});

// Import routes
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');

// Use routes
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/method", chatRoutes);
app.use("/api/resource", chatRoutes);

// Socket.IO events for real-time chat with enhanced features
io.on('connection', (socket) => {
  console.log('🔌 [Chat Service] Client connected:', socket.id);
  
  const userId = socket.user?.id || socket.user?._id;
  const chatHelpers = require('./utils/chatHelpers');
  
  // User joins their personal room
  if (userId) {
    socket.join(`user:${userId}`);
    redisClient.setUserOnline(userId, socket.id);
    
    // Publish user online event to other services
    redisClient.publishUserEvent('user_online', {
      user_id: userId,
      socket_id: socket.id,
      timestamp: new Date().toISOString()
    });
    
    // Broadcast user online status
    socket.broadcast.emit('user_online', { 
      userId, 
      timestamp: new Date().toISOString(),
      socketId: socket.id 
    });
    
    console.log(`👤 [Chat Service] User ${userId} connected with socket ${socket.id}`);
  }
  
  // Join chat room with validation
  socket.on('join_chat', async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) {
        return socket.emit('error', { message: 'Chat ID is required' });
      }
      
      // Verify user has access to this chat
      const chat = await database.get('chats', { name: chatId });
      if (chat) {
        if (chat.participants.includes(userId)) {
          socket.join(`chat:${chatId}`);
          
          // Mark user as active in this chat
          await redisClient.setUserActiveInChat(userId, chatId);
          
          // Send chat info
          socket.emit('chat_joined', {
            chatId,
            chatName: chatHelpers.generateChatDisplayName(chat, userId),
            participantCount: chat.participants.length,
            timestamp: new Date().toISOString()
          });
          
          console.log(`👥 [Chat Service] User ${userId} joined chat ${chatId}`);
        } else {
          socket.emit('error', { message: 'No access to this chat' });
        }
      } else {
        socket.emit('error', { message: 'Chat not found' });
      }
    } catch (error) {
      console.error('Error joining chat:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });
  
  // Leave chat room
  socket.on('leave_chat', async (data) => {
    try {
      const { chatId } = data;
      socket.leave(`chat:${chatId}`);
      await redisClient.removeUserFromActiveChat(userId, chatId);
      await redisClient.removeUserTyping(userId, chatId);
      
      socket.emit('chat_left', { chatId, timestamp: new Date().toISOString() });
      console.log(`👥 [Chat Service] User ${userId} left chat ${chatId}`);
    } catch (error) {
      console.error('Error leaving chat:', error);
    }
  });
  
  // Send message with rate limiting
  socket.on('send_message', async (data) => {
    try {
      // Rate limiting check
      const rateLimit = await chatHelpers.checkRateLimit(userId, 'message', 30, 60);
      if (!rateLimit.allowed) {
        return socket.emit('rate_limit_exceeded', {
          message: 'Too many messages sent. Please slow down.',
          resetTime: rateLimit.resetTime
        });
      }
      
      const { 
        chatId, 
        message, 
        messageType = 'text', 
        attachments = null, 
        replyTo = null,
        tempId = null 
      } = data;
      
      if (!chatId) {
        return socket.emit('error', { message: 'Chat ID is required' });
      }
      
      // Verify user has access to chat
      const chat = await database.get('chats', { name: chatId });
      if (!chat) {
        return socket.emit('error', { message: 'Chat not found' });
      }
      
      if (!chat.participants.includes(userId)) {
        return socket.emit('error', { message: 'No access to this chat' });
      }
      
      // Sanitize message content
      const sanitizedMessage = chatHelpers.sanitizeContent(message);
      
      if (!sanitizedMessage && messageType === 'text') {
        return socket.emit('error', { message: 'Message cannot be empty' });
      }
      
      // Create message record
      const messageData = {
        name: `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        chat: chatId,
        sender: userId,
        message: sanitizedMessage,
        message_type: messageType,
        attachments: attachments || null,
        reply_to: replyTo,
        sent_at: new Date(),
        delivery_status: 'sent',
        read_by: [userId],
        is_deleted: 0,
        is_edited: 0,
        is_pinned: 0
      };
      
      // Save to database
      await database.insert('messages', messageData);
      
      // Update chat last message
      const messageCount = await database.db.collection('messages').countDocuments({
        chat: chatId,
        is_deleted: { $ne: 1 }
      });
      
      await database.update('chats', { name: chatId }, {
        last_message: messageData.name,
        last_message_time: messageData.sent_at,
        message_count: messageCount,
        updated_at: new Date()
      });
      
      // Cache the message
      await redisClient.cacheMessage(messageData.name, messageData);
      
      // Invalidate relevant caches
      await redisClient.invalidateChatMessagesCache(chatId);
      for (const participantId of chat.participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }
      
      // Publish message event to other services
      await redisClient.publishChatEvent('message_sent', {
        chat_id: chatId,
        message_id: messageData.name,
        sender_id: userId,
        message_preview: sanitizedMessage?.substring(0, 100),
        message_type: messageType,
        timestamp: messageData.sent_at
      });
      
      // Broadcast to chat room
      io.to(`chat:${chatId}`).emit('new_message', {
        ...messageData,
        sender_name: socket.user?.full_name || 'Unknown User',
        timestamp: new Date().toISOString()
      });
      
      // Send delivery confirmation
      socket.emit('message_sent', { 
        messageId: messageData.name, 
        tempId,
        status: 'sent',
        timestamp: messageData.sent_at
      });
      
      // Stop typing indicator
      await redisClient.removeUserTyping(userId, chatId);
      socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
      
      console.log(`💬 [Chat Service] Message sent in chat ${chatId} by user ${userId}`);
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Enhanced typing indicators with timeout
  socket.on('typing_start', async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) return;
      
      await redisClient.setUserTyping(userId, chatId);
      socket.to(`chat:${chatId}`).emit('user_typing', { 
        userId, 
        chatId, 
        userName: socket.user?.full_name || 'Unknown User',
        timestamp: new Date().toISOString() 
      });
      
      // Auto-stop typing after timeout
      setTimeout(async () => {
        await redisClient.removeUserTyping(userId, chatId);
        socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
      }, chatHelpers.getTypingTimeout());
      
    } catch (error) {
      console.error('Error handling typing start:', error);
    }
  });
  
  socket.on('typing_stop', async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) return;
      
      await redisClient.removeUserTyping(userId, chatId);
      socket.to(`chat:${chatId}`).emit('user_stopped_typing', { 
        userId, 
        chatId, 
        timestamp: new Date().toISOString() 
      });
    } catch (error) {
      console.error('Error handling typing stop:', error);
    }
  });
  
  // Enhanced message read receipts
  socket.on('mark_messages_read', async (data) => {
    try {
      const { chatId, messageIds = [] } = data;
      
      if (!chatId) return;
      
      let updatedCount = 0;
      
      if (messageIds.length > 0) {
        // Mark specific messages as read
        for (const messageId of messageIds) {
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
          chat: chatId,
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
      
      if (updatedCount > 0) {
        // Invalidate cache
        await redisClient.invalidateChatMessagesCache(chatId);
        
        // Publish read event
        await redisClient.publishChatEvent('messages_read', {
          chat_id: chatId,
          user_id: userId,
          message_ids: messageIds.length > 0 ? messageIds : 'all',
          count: updatedCount
        });
        
        // Broadcast read receipts
        socket.to(`chat:${chatId}`).emit('messages_read', {
          userId,
          userName: socket.user?.full_name || 'Unknown User',
          chatId,
          messageIds: messageIds.length > 0 ? messageIds : 'all',
          count: updatedCount,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log('🔌 [Chat Service] Client disconnected:', socket.id);
    
    if (userId) {
      await redisClient.setUserOffline(userId);
      
      // Publish user offline event to other services
      redisClient.publishUserEvent('user_offline', {
        user_id: userId,
        timestamp: new Date().toISOString()
      });
      
      // Clean up typing indicators
      const pattern = `typing:*:${userId}`;
      const typingKeys = await redisClient.client.keys(pattern);
      for (const key of typingKeys) {
        await redisClient.client.del(key);
        const chatId = key.split(':')[1];
        socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
      }
      
      // Broadcast user offline status
      socket.broadcast.emit('user_offline', { 
        userId, 
        timestamp: new Date().toISOString() 
      });
      
      console.log(`👤 [Chat Service] User ${userId} disconnected`);
    }
  });
  
  // Handle errors
  socket.on('error', (error) => {
    console.error('🔌 [Chat Service] Socket error:', error);
  });
});

// Cleanup old messages every day at 3 AM
cron.schedule('0 3 * * *', async () => {
  try {
    console.log('🧹 [Chat Service] Cleaning up old messages...');
    
    const retentionDays = parseInt(process.env.MESSAGE_RETENTION_DAYS || 90);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const result = await database.db.collection('messages').deleteMany({
      sent_at: { $lt: cutoffDate },
      is_pinned: { $ne: 1 }
    });
    
    console.log(`✅ [Chat Service] Cleaned up ${result.deletedCount} old messages`);
  } catch (error) {
    console.error('❌ [Chat Service] Error cleaning up messages:', error);
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ [Chat Service] Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    service: 'chat-service'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'chat-service',
    path: req.originalUrl
  });
});

// Start server
const PORT = process.env.PORT || 5005;
server.listen(PORT, () => {
  console.log(`🚀 [Chat Service] Server running on port ${PORT}`);
});

connectDB();

module.exports = { app, io, server };