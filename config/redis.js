const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
    this.publishers = new Map();
    this.subscribers = new Map();
  }

  async connect() {
    try {
      // Main Redis client
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      // Pub/Sub clients for Socket.IO
      this.pubClient = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      this.subClient = this.pubClient.duplicate();

      // Service-specific publishers
      this.publishers.set('chat', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.publishers.set('notification', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.publishers.set('user', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      // Service-specific subscribers
      this.subscribers.set('chat', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.subscribers.set('notification', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.subscribers.set('user', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();

      // Connect all publishers and subscribers
      for (const [name, client] of this.publishers) {
        await client.connect();
      }

      for (const [name, client] of this.subscribers) {
        await client.connect();
      }

      console.log('✅ [Chat Service] Redis connected successfully');
      
      // Setup service subscriptions
      await this.setupServiceSubscriptions();

    } catch (error) {
      console.error('❌ [Chat Service] Redis connection failed:', error.message);
      throw error;
    }
  }

  async setupServiceSubscriptions() {
    try {
      // Subscribe to notification events
      await this.subscribers.get('notification').subscribe(process.env.REDIS_NOTIFICATION_CHANNEL, (message) => {
        this.handleNotificationEvent(message);
      });

      // Subscribe to user events
      await this.subscribers.get('user').subscribe(process.env.REDIS_USER_CHANNEL, (message) => {
        this.handleUserEvent(message);
      });

      console.log('✅ [Chat Service] Service subscriptions setup complete');
    } catch (error) {
      console.error('❌ [Chat Service] Failed to setup service subscriptions:', error);
    }
  }

  async handleNotificationEvent(message) {
    try {
      const data = JSON.parse(message);
      console.log('📢 [Chat Service] Received notification event:', data);

      // Handle different notification types
      switch (data.type) {
        case 'user_online':
          await this.handleUserOnlineNotification(data);
          break;
        case 'user_offline':
          await this.handleUserOfflineNotification(data);
          break;
        case 'message_notification':
          await this.handleMessageNotification(data);
          break;
        default:
          console.log('📢 [Chat Service] Unknown notification type:', data.type);
      }
    } catch (error) {
      console.error('❌ [Chat Service] Error handling notification event:', error);
    }
  }

  async handleUserEvent(message) {
    try {
      const data = JSON.parse(message);
      console.log('👤 [Chat Service] Received user event:', data);

      // Handle different user event types
      switch (data.type) {
        case 'user_created':
          await this.handleUserCreated(data);
          break;
        case 'user_updated':
          await this.handleUserUpdated(data);
          break;
        case 'user_deleted':
          await this.handleUserDeleted(data);
          break;
        default:
          console.log('👤 [Chat Service] Unknown user event type:', data.type);
      }
    } catch (error) {
      console.error('❌ [Chat Service] Error handling user event:', error);
    }
  }

  async handleUserOnlineNotification(data) {
    // Update user online status in chat service
    await this.setUserOnline(data.user_id, data.socket_id);
    
    // Broadcast to connected clients
    const io = global.io; // Access global io instance
    if (io) {
      io.emit('user_online', {
        userId: data.user_id,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleUserOfflineNotification(data) {
    // Update user offline status in chat service
    await this.setUserOffline(data.user_id);
    
    // Broadcast to connected clients
    const io = global.io;
    if (io) {
      io.emit('user_offline', {
        userId: data.user_id,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleMessageNotification(data) {
    // Handle message notifications from other services
    const io = global.io;
    if (io) {
      io.to(`user:${data.recipient_id}`).emit('new_notification', {
        type: 'message',
        sender: data.sender_id,
        chat_id: data.chat_id,
        message_preview: data.message_preview,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleUserCreated(data) {
    // Handle user creation event
    console.log('👤 [Chat Service] User created:', data.user_id);
  }

  async handleUserUpdated(data) {
    // Handle user update event
    console.log('👤 [Chat Service] User updated:', data.user_id);
  }

  async handleUserDeleted(data) {
    // Handle user deletion event
    console.log('👤 [Chat Service] User deleted:', data.user_id);
  }

  // Publish events to other services
  async publishToService(service, eventType, data) {
    try {
      const publisher = this.publishers.get(service);
      if (!publisher) {
        throw new Error(`Publisher not found for service: ${service}`);
      }

      const message = {
        service: 'chat-service',
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
      };

      const channel = this.getChannelForService(service);
      await publisher.publish(channel, JSON.stringify(message));
      
      console.log(`📤 [Chat Service] Published ${eventType} to ${service}`);
    } catch (error) {
      console.error(`❌ [Chat Service] Failed to publish to ${service}:`, error);
    }
  }

  getChannelForService(service) {
    const channels = {
      'notification': process.env.REDIS_NOTIFICATION_CHANNEL,
      'user': process.env.REDIS_USER_CHANNEL,
      'chat': process.env.REDIS_CHAT_CHANNEL
    };
    return channels[service] || process.env.REDIS_CHAT_CHANNEL;
  }

  // Enhanced chat event publishing
  async publishChatEvent(eventType, data) {
    await this.publishToService('notification', eventType, {
      ...data,
      source: 'chat-service'
    });
  }

  async publishUserEvent(eventType, data) {
    await this.publishToService('user', eventType, {
      ...data,
      source: 'chat-service'
    });
  }

  async set(key, value, ttl = null) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    if (ttl) {
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get(key) {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async del(key) {
    await this.client.del(key);
  }

  async exists(key) {
    return await this.client.exists(key);
  }

  async hSet(key, field, value) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    await this.client.hSet(key, field, stringValue);
  }

  async hGet(key, field) {
    const value = await this.client.hGet(key, field);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async hGetAll(key) {
    const hash = await this.client.hGetAll(key);
    const result = {};
    for (const [field, value] of Object.entries(hash)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value;
      }
    }
    return result;
  }

  async hDel(key, field) {
    await this.client.hDel(key, field);
  }

  async publish(channel, message) {
    const stringMessage = typeof message === 'object' ? JSON.stringify(message) : message;
    await this.pubClient.publish(channel, stringMessage);
  }

  // Chat-specific methods
  async setChatData(chatId, chatData, ttl = 3600) {
    const key = `chat:${chatId}`;
    await this.set(key, chatData, ttl);
  }

  async getChatData(chatId) {
    const key = `chat:${chatId}`;
    return await this.get(key);
  }

  async setUserChats(userId, chats, ttl = 1800) {
    const key = `user_chats:${userId}`;
    await this.set(key, chats, ttl);
  }

  async getUserChats(userId) {
    const key = `user_chats:${userId}`;
    return await this.get(key);
  }

  async setChatMessages(chatId, messages, ttl = 900) {
    const key = `chat_messages:${chatId}`;
    await this.set(key, messages, ttl);
  }

  async getChatMessages(chatId) {
    const key = `chat_messages:${chatId}`;
    return await this.get(key);
  }

  async setTempMessage(tempId, messageData, ttl = 300) {
    const key = `temp_msg:${tempId}`;
    await this.set(key, messageData, ttl);
  }

  async getTempMessage(tempId) {
    const key = `temp_msg:${tempId}`;
    return await this.get(key);
  }

  async cacheMessage(messageId, messageData, ttl = 3600) {
    const key = `message:${messageId}`;
    await this.set(key, messageData, ttl);
  }

  async getCachedMessage(messageId) {
    const key = `message:${messageId}`;
    return await this.get(key);
  }

  // User online status methods
  async setUserOnline(userId, socketId, ttl = 300) {
    const key = `user:online:${userId}`;
    await this.set(key, { 
      status: 'online', 
      socketId, 
      lastSeen: new Date().toISOString() 
    }, ttl);
  }

  async setUserOffline(userId) {
    const key = `user:online:${userId}`;
    await this.set(key, { 
      status: 'offline', 
      lastSeen: new Date().toISOString() 
    }, 600);
  }

  async getUserOnlineStatus(userId) {
    const key = `user:online:${userId}`;
    return await this.get(key);
  }

  async setUserActiveInChat(userId, chatId, ttl = 1800) {
    const key = `user:active_chat:${userId}`;
    await this.set(key, { chatId, timestamp: new Date().toISOString() }, ttl);
  }

  async removeUserFromActiveChat(userId, chatId) {
    const key = `user:active_chat:${userId}`;
    const activeChat = await this.get(key);
    if (activeChat && activeChat.chatId === chatId) {
      await this.del(key);
    }
  }

  // Cache invalidation methods
  async invalidateChatCaches(chatId, participantIds = []) {
    const keys = [
      `chat:${chatId}`,
      `chat_messages:${chatId}`,
      `chat:messages:${chatId}*`
    ];

    // Add user-specific cache keys
    participantIds.forEach(userId => {
      keys.push(`user_chats:${userId}*`);
    });

    // Delete all matching keys
    for (const key of keys) {
      if (key.includes('*')) {
        const matchingKeys = await this.client.keys(key);
        if (matchingKeys.length > 0) {
          await this.client.del(matchingKeys);
        }
      } else {
        await this.del(key);
      }
    }
  }

  async invalidateUserChatsCache(userId) {
    const pattern = `user_chats:${userId}*`;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  async invalidateChatMessagesCache(chatId) {
    const pattern = `chat_messages:${chatId}*`;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  // Statistics methods
  async getOnlineUsersCount() {
    const pattern = 'user:online:*';
    const keys = await this.client.keys(pattern);
    
    let onlineCount = 0;
    for (const key of keys) {
      const status = await this.get(key);
      if (status && status.status === 'online') {
        onlineCount++;
      }
    }
    return onlineCount;
  }

  async getActiveChatsCount() {
    const pattern = 'chat:*';
    const keys = await this.client.keys(pattern);
    return keys.length;
  }

  // Typing indicators
  async setUserTyping(userId, chatId, ttl = 10) {
    const key = `typing:${chatId}:${userId}`;
    await this.set(key, { timestamp: new Date().toISOString() }, ttl);
  }

  async removeUserTyping(userId, chatId) {
    const key = `typing:${chatId}:${userId}`;
    await this.del(key);
  }

  async getChatTypingUsers(chatId) {
    const pattern = `typing:${chatId}:*`;
    const keys = await this.client.keys(pattern);
    return keys.map(key => key.split(':').pop());
  }

  // Message delivery tracking
  async trackMessageDelivery(messageId, recipientId, status = 'delivered') {
    const key = `delivery:${messageId}:${recipientId}`;
    await this.set(key, { 
      status, 
      timestamp: new Date().toISOString() 
    }, 86400); // 24 hours
  }

  async getMessageDeliveryStatus(messageId) {
    const pattern = `delivery:${messageId}:*`;
    const keys = await this.client.keys(pattern);
    
    const deliveryStatus = {};
    for (const key of keys) {
      const recipientId = key.split(':').pop();
      const status = await this.get(key);
      deliveryStatus[recipientId] = status;
    }
    return deliveryStatus;
  }

  getPubClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }

  async disconnect() {
    if (this.client) await this.client.disconnect();
    if (this.pubClient) await this.pubClient.disconnect();
    if (this.subClient) await this.subClient.disconnect();
    
    // Disconnect all publishers and subscribers
    for (const [name, client] of this.publishers) {
      await client.disconnect();
    }
    
    for (const [name, client] of this.subscribers) {
      await client.disconnect();
    }
  }
}

module.exports = new RedisClient();