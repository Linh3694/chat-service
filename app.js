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

// Socket.IO setup with enhanced Frappe authentication
const io = new Server(server, {
  cors: { origin: "*" },
  allowRequest: async (req, callback) => {
    const token = req._query?.token;
    if (!token) return callback("unauthorized", false);
    
    try {
      // Validate token with Frappe service
      const frappeUser = await frappeService.authenticateUser(token);
      
      if (frappeUser) {
        // Tạo hoặc cập nhật user trong local database
        const localUser = await User.updateFromFrappe(frappeUser);
        
        req.user = {
          _id: localUser._id,
          id: localUser._id,
          frappeUserId: localUser.frappeUserId,
          fullname: localUser.fullName,
          full_name: localUser.fullName,
          name: localUser.name,
          email: localUser.email,
          role: localUser.role,
          roles: localUser.roles,
          avatar: localUser.avatar
        };
        
        console.log(`🔐 [Chat Service] User authenticated: ${localUser.fullName} (${localUser.email})`);
        callback(null, true);
      } else {
        callback("invalid_token", false);
      }
    } catch (error) {
      console.error('❌ [Chat Service] Socket authentication error:', error.message);
      callback("authentication_failed", false);
    }
  },
});

// Make io globally available for Redis pub/sub
global.io = io;
// Group chat namespace
const groupNs = io.of('/groupchat');

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

// Import models
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const User = require('./models/User');

// Import services
const frappeService = require('./services/frappeService');
const ticketService = require('./services/ticketService');
const notificationService = require('./services/notificationService');

// Health check với kiểm tra tất cả services
app.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'ok',
      service: 'chat-service',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    };

    // Kiểm tra database
    try {
      await database.healthCheck();
      healthStatus.database = 'connected';
    } catch (error) {
      healthStatus.database = 'error';
      healthStatus.database_error = error.message;
    }

    // Kiểm tra Redis
    try {
      await redisClient.client.ping();
      healthStatus.redis = 'connected';
    } catch (error) {
      healthStatus.redis = 'error';
      healthStatus.redis_error = error.message;
    }

    // Kiểm tra Frappe service
    const frappeHealth = await frappeService.healthCheck();
    healthStatus.frappe = frappeHealth.status;
    if (frappeHealth.status === 'error') {
      healthStatus.frappe_error = frappeHealth.message;
    }

    // Kiểm tra Ticket service
    const ticketHealth = await ticketService.healthCheck();
    healthStatus.ticket_service = ticketHealth.status;
    if (ticketHealth.status === 'error') {
      healthStatus.ticket_error = ticketHealth.message;
    }

    // Kiểm tra Notification service
    const notificationHealth = await notificationService.healthCheck();
    healthStatus.notification_service = notificationHealth.status;
    if (notificationHealth.status === 'error') {
      healthStatus.notification_error = notificationHealth.message;
    }

    // Xác định status tổng thể
    const criticalServices = ['database', 'redis'];
    const hasCriticalError = criticalServices.some(service => 
      healthStatus[service] === 'error'
    );

    if (hasCriticalError) {
      healthStatus.status = 'degraded';
      res.status(503).json(healthStatus);
    } else {
      res.status(200).json(healthStatus);
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'chat-service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Import routes
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

// Use routes
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);
// Backward-compatible aliases to support legacy mobile paths  
app.use("/api/chats", chatRoutes);
// Note: messageRoutes chỉ mount tại /api/messages để tránh conflict với chatRoutes
app.use("/api/method", chatRoutes);
app.use("/api/resource", chatRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes); // Users API cho mobile

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
    
    // Broadcast user online status (both snake_case and camelCase for compatibility)
    const onlinePayload = { 
      userId, 
      timestamp: new Date().toISOString(),
      socketId: socket.id 
    };
    socket.broadcast.emit('user_online', onlinePayload);
    socket.broadcast.emit('userOnline', onlinePayload);
    
    console.log(`👤 [Chat Service] User ${userId} connected with socket ${socket.id}`);
  }
  
  // Join chat room with validation
  const handleJoinChat = async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) {
        return socket.emit('error', { message: 'Chat ID is required' });
      }
      
      // Verify user has access to this chat using Mongoose
      const chat = await Chat.findById(chatId).populate('participants', 'fullname email');
      if (chat) {
        if (chat.participants.some(p => p._id.toString() === userId.toString())) {
          socket.join(`chat:${chatId}`);
          // Also join plain room id for legacy clients
          socket.join(chatId.toString());
          
          // Mark user as active in this chat
          await redisClient.setUserActiveInChat(userId, chatId);
          
          // Send chat info
          socket.emit('chat_joined', {
            chatId,
            chatName: chat.name || `Chat with ${chat.participants.length} members`,
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
  };
  socket.on('join_chat', handleJoinChat);
  socket.on('joinChat', handleJoinChat);
  
  // Leave chat room
  socket.on('leave_chat', async (data) => {
    try {
      const { chatId } = data;
      socket.leave(`chat:${chatId}`);
      socket.leave(chatId?.toString());
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
      
      // Verify user has access to chat using Mongoose
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return socket.emit('error', { message: 'Chat not found' });
      }
      
      if (!chat.participants.includes(userId)) {
        return socket.emit('error', { message: 'No access to this chat' });
      }
      
      // Sanitize message content (simple sanitization for now)
      const sanitizedMessage = message?.trim();
      
      if (!sanitizedMessage && messageType === 'text') {
        return socket.emit('error', { message: 'Message cannot be empty' });
      }
      
      // Create message using Mongoose
      const newMessage = new Message({
        chat: chatId,
        sender: userId,
        content: sanitizedMessage,
        messageType: messageType,
        attachments: attachments || [],
        replyTo: replyTo || null,
        sentAt: new Date(),
        deliveryStatus: 'sent'
      });
      
      // Save message to database
      await newMessage.save();
      
      // Update chat last message
      chat.lastMessage = newMessage._id;
      chat.updatedAt = new Date();
      await chat.save();
      
      // Cache the message
      await redisClient.cacheMessage(newMessage._id.toString(), newMessage);
      
      // Invalidate relevant caches
      await redisClient.invalidateChatMessagesCache(chatId);
      for (const participantId of chat.participants) {
        await redisClient.invalidateUserChatsCache(participantId);
      }
      
      // Publish message event to other services
      await redisClient.publishChatEvent('message_sent', {
        chat_id: chatId,
        message_id: newMessage._id.toString(),
        sender_id: userId,
        message_preview: sanitizedMessage?.substring(0, 100),
        message_type: messageType,
        timestamp: newMessage.sentAt
      });
      
      // Broadcast to chat room
      const messageData = {
        _id: newMessage._id,
        chat: newMessage.chat,
        sender: newMessage.sender,
        content: newMessage.content,
        messageType: newMessage.messageType,
        attachments: newMessage.attachments,
        sentAt: newMessage.sentAt,
        deliveryStatus: newMessage.deliveryStatus,
        sender_name: socket.user?.full_name || 'Unknown User',
        timestamp: new Date().toISOString()
      };
      
      io.to(`chat:${chatId}`).emit('new_message', messageData);
      // Legacy compatibility: emit receiveMessage to plain room and group namespace
      io.to(chatId.toString()).emit('receiveMessage', messageData);
      groupNs.to(chatId.toString()).emit('receiveMessage', messageData);
      
      // Send delivery confirmation
      socket.emit('message_sent', { 
        messageId: newMessage._id.toString(), 
        tempId,
        status: 'sent',
        timestamp: newMessage.sentAt
      });

      // Gửi notification cho participants (trừ sender)
      try {
        const offlineParticipants = chat.participants.filter(p => p.toString() !== userId.toString());
        if (offlineParticipants.length > 0) {
          await notificationService.sendNewMessageNotification({
            ...messageData,
            isGroup: chat.isGroup,
            groupName: chat.name
          }, offlineParticipants);
        }
      } catch (notifError) {
        console.error('Failed to send notification:', notifError.message);
      }
      
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
  const handleTypingStart = async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) return;
      
      await redisClient.setUserTyping(userId, chatId);
      const payload = { 
        userId, 
        chatId, 
        userName: socket.user?.full_name || 'Unknown User',
        timestamp: new Date().toISOString() 
      };
      socket.to(`chat:${chatId}`).emit('user_typing', payload);
      socket.to(chatId.toString()).emit('userTyping', payload);
      groupNs.to(chatId.toString()).emit('userTypingInGroup', payload);
      
      // Auto-stop typing after timeout
      setTimeout(async () => {
        await redisClient.removeUserTyping(userId, chatId);
        socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
        socket.to(chatId.toString()).emit('userStopTyping', { userId, chatId });
        groupNs.to(chatId.toString()).emit('userStopTypingInGroup', { userId, chatId });
      }, chatHelpers.getTypingTimeout());
      
    } catch (error) {
      console.error('Error handling typing start:', error);
    }
  };
  socket.on('typing_start', handleTypingStart);
  socket.on('typing', handleTypingStart);
  
  socket.on('typing_stop', async (data) => {
    try {
      const { chatId } = data;
      
      if (!chatId) return;
      
      await redisClient.removeUserTyping(userId, chatId);
      const payload = { userId, chatId, timestamp: new Date().toISOString() };
      socket.to(`chat:${chatId}`).emit('user_stopped_typing', payload);
      socket.to(chatId.toString()).emit('userStopTyping', payload);
      groupNs.to(chatId.toString()).emit('userStopTypingInGroup', payload);
    } catch (error) {
      console.error('Error handling typing stop:', error);
    }
  });
  socket.on('stopTyping', async (data) => {
    try {
      const { chatId } = data || {};
      if (!chatId) return;
      const payload = { userId, chatId, timestamp: new Date().toISOString() };
      socket.to(`chat:${chatId}`).emit('user_stopped_typing', payload);
      socket.to(chatId.toString()).emit('userStopTyping', payload);
      groupNs.to(chatId.toString()).emit('userStopTypingInGroup', payload);
    } catch {}
  });
  
  // Enhanced message read receipts
  const handleMarkRead = async (data) => {
    try {
      const { chatId, messageIds = [] } = data;
      
      if (!chatId) return;
      
      let updatedCount = 0;
      
      if (messageIds.length > 0) {
        // Mark specific messages as read using Mongoose
        for (const messageId of messageIds) {
          const message = await Message.findById(messageId);
          if (message && !message.readBy.some(r => r.user.toString() === userId.toString())) {
            message.readBy.push({
              user: userId,
              readAt: new Date()
            });
            message.deliveryStatus = 'read';
            await message.save();
            updatedCount++;
          }
        }
      } else {
        // Mark all unread messages in chat as read
        const unreadMessages = await Message.find({
          chat: chatId,
          sender: { $ne: userId },
          'readBy.user': { $ne: userId },
          isDeleted: { $ne: true }
        });
        
        for (const message of unreadMessages) {
          message.readBy.push({
            user: userId,
            readAt: new Date()
          });
          message.deliveryStatus = 'read';
          await message.save();
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
        const payload = {
          userId,
          userName: socket.user?.full_name || 'Unknown User',
          chatId,
          messageIds: messageIds.length > 0 ? messageIds : 'all',
          count: updatedCount,
          timestamp: new Date().toISOString()
        };
        socket.to(`chat:${chatId}`).emit('messages_read', payload);
        socket.to(chatId.toString()).emit('messageRead', payload);
        groupNs.to(chatId.toString()).emit('messageRead', payload);
      }
      
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };
  socket.on('mark_messages_read', handleMarkRead);
  socket.on('messageRead', handleMarkRead);
  
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
      
      // Broadcast user offline status (both styles)
      const offlinePayload = { userId, timestamp: new Date().toISOString() };
      socket.broadcast.emit('user_offline', offlinePayload);
      socket.broadcast.emit('userOffline', offlinePayload);
      
      console.log(`👤 [Chat Service] User ${userId} disconnected`);
    }
  });
  
  // Handle errors
  socket.on('error', (error) => {
    console.error('🔌 [Chat Service] Socket error:', error);
  });
});

// Group chat namespace events (minimal for compatibility)
groupNs.on('connection', (socket) => {
  const userId = socket.handshake?.auth?.userId || socket.user?._id;
  console.log('🔌 [/groupchat] Client connected:', socket.id);

  socket.on('joinGroupChat', ({ chatId }) => {
    if (!chatId) return;
    socket.join(chatId.toString());
    socket.emit('roomJoinConfirmed', { chatId, roomSize: groupNs.adapter.rooms.get(chatId.toString())?.size || 1 });
  });

  socket.on('groupTyping', ({ chatId, userId: typingUserId, isTyping }) => {
    if (!chatId || !typingUserId) return;
    if (isTyping) {
      groupNs.to(chatId.toString()).emit('userTypingInGroup', { userId: typingUserId, chatId });
    } else {
      groupNs.to(chatId.toString()).emit('userStopTypingInGroup', { userId: typingUserId, chatId });
    }
  });

  socket.on('leaveGroupChat', ({ chatId }) => {
    socket.leave(chatId?.toString());
  });

  socket.on('disconnect', () => {
    // no-op
  });
});

// Cleanup old messages every day at 3 AM
cron.schedule('0 3 * * *', async () => {
  try {
    console.log('🧹 [Chat Service] Cleaning up old messages...');
    
    const retentionDays = parseInt(process.env.MESSAGE_RETENTION_DAYS || 90);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const result = await Message.deleteMany({
      sentAt: { $lt: cutoffDate },
      isPinned: { $ne: true }
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