const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
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

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();

      console.log('✅ [Chat Service] Redis connected successfully');
    } catch (error) {
      console.error('❌ [Chat Service] Redis connection failed:', error.message);
      throw error;
    }
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
  }
}

module.exports = new RedisClient();