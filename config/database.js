const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Connect to MongoDB
      this.client = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      await this.client.connect();
      this.db = this.client.db(process.env.MONGODB_DB_NAME);
      this.isConnected = true;

      console.log('✅ [Chat Service] MongoDB connected successfully');

      // Initialize collections
      await this.initializeCollections();

      // Auto-initialize sample data in development
      if (process.env.NODE_ENV !== 'production') {
        await this.createSampleData();
      }

    } catch (error) {
      console.error('❌ [Chat Service] MongoDB connection failed:', error.message);
      throw error;
    }
  }

  async initializeCollections() {
    try {
      // Create collections if they don't exist
      const collections = [
        'chats',
        'messages', 
        'attachments',
        'reactions',
        'users',
        'message_history'
      ];

      for (const collectionName of collections) {
        await this.db.createCollection(collectionName);
      }

      // Create indexes for better performance
      await this.createIndexes();

      console.log('✅ [Chat Service] Collections initialized');
    } catch (error) {
      console.error('❌ [Chat Service] Failed to initialize collections:', error);
    }
  }

  async createIndexes() {
    try {
      // Chat indexes
      await this.db.collection('chats').createIndex({ participants: 1 });
      await this.db.collection('chats').createIndex({ updated_at: -1 });
      await this.db.collection('chats').createIndex({ archived: 1 });

      // Message indexes
      await this.db.collection('messages').createIndex({ chat: 1, sent_at: -1 });
      await this.db.collection('messages').createIndex({ sender: 1 });
      await this.db.collection('messages').createIndex({ is_deleted: 1 });
      await this.db.collection('messages').createIndex({ message: 'text' });

      // User indexes
      await this.db.collection('users').createIndex({ name: 1 }, { unique: true });
      await this.db.collection('users').createIndex({ email: 1 });

      // Reaction indexes
      await this.db.collection('reactions').createIndex({ message: 1, user: 1 });

      console.log('✅ [Chat Service] Indexes created');
    } catch (error) {
      console.error('❌ [Chat Service] Failed to create indexes:', error);
    }
  }

  async createSampleData() {
    try {
      // Check if sample data already exists
      const chatCount = await this.db.collection('chats').countDocuments();
      if (chatCount > 0) {
        console.log('📝 [Chat Service] Sample data already exists, skipping...');
        return;
      }

      // Create sample users
      const sampleUsers = [
        {
          name: 'admin',
          full_name: 'Administrator',
          email: 'admin@wellspring.edu.vn',
          enabled: 1,
          avatar_url: null,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          name: 'teacher1',
          full_name: 'Teacher One',
          email: 'teacher1@wellspring.edu.vn',
          enabled: 1,
          avatar_url: null,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          name: 'student1',
          full_name: 'Student One',
          email: 'student1@wellspring.edu.vn',
          enabled: 1,
          avatar_url: null,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      await this.db.collection('users').insertMany(sampleUsers);

      // Create sample chat
      const sampleChat = {
        name: 'CHAT-SAMPLE-001',
        chat_name: 'Sample Chat',
        participants: ['admin', 'teacher1'],
        chat_type: 'direct',
        is_group: 0,
        message_count: 0,
        creator: 'admin',
        archived: 0,
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.db.collection('chats').insertOne(sampleChat);

      console.log('✅ [Chat Service] Sample data created');
    } catch (error) {
      console.error('❌ [Chat Service] Failed to create sample data:', error);
    }
  }

  // Generic CRUD operations
  async insert(collection, doc) {
    try {
      const result = await this.db.collection(collection).insertOne(doc);
      return result.insertedId;
    } catch (error) {
      console.error(`Database insert error in ${collection}:`, error);
      throw error;
    }
  }

  async update(collection, filter, update) {
    try {
      const result = await this.db.collection(collection).updateOne(filter, { $set: update });
      return result.modifiedCount > 0;
    } catch (error) {
      console.error(`Database update error in ${collection}:`, error);
      throw error;
    }
  }

  async get(collection, filter) {
    try {
      return await this.db.collection(collection).findOne(filter);
    } catch (error) {
      console.error(`Database get error in ${collection}:`, error);
      throw error;
    }
  }

  async getAll(collection, filter = {}, options = {}) {
    try {
      const { sort = { updated_at: -1 }, limit = null, skip = 0 } = options;
      let query = this.db.collection(collection).find(filter);

      if (sort) query = query.sort(sort);
      if (skip) query = query.skip(skip);
      if (limit) query = query.limit(limit);

      return await query.toArray();
    } catch (error) {
      console.error(`Database getAll error in ${collection}:`, error);
      throw error;
    }
  }

  async delete(collection, filter) {
    try {
      const result = await this.db.collection(collection).deleteOne(filter);
      return result.deletedCount > 0;
    } catch (error) {
      console.error(`Database delete error in ${collection}:`, error);
      throw error;
    }
  }

  async exists(collection, filter) {
    try {
      const count = await this.db.collection(collection).countDocuments(filter);
      return count > 0;
    } catch (error) {
      console.error(`Database exists error in ${collection}:`, error);
      throw error;
    }
  }

  // Chat-specific methods
  async getChatParticipants(chatId) {
    try {
      const chat = await this.get('chats', { name: chatId });
      if (!chat) return [];

      const participants = await this.getAll('users', {
        name: { $in: chat.participants }
      });

      return participants;
    } catch (error) {
      console.error('Error getting chat participants:', error);
      return [];
    }
  }

  async getUnreadMessageCount(userId, chatId = null) {
    try {
      let filter = {
        sender: { $ne: userId },
        'read_by': { $ne: userId },
        is_deleted: { $ne: 1 }
      };

      if (chatId) {
        filter.chat = chatId;
      } else {
        // Get all chats where user is participant
        const userChats = await this.getAll('chats', {
          participants: userId,
          archived: { $ne: 1 }
        });
        filter.chat = { $in: userChats.map(c => c.name) };
      }

      const count = await this.db.collection('messages').countDocuments(filter);
      return count;
    } catch (error) {
      console.error('Error getting unread message count:', error);
      return 0;
    }
  }

  async searchChats(userId, query, limit = 20) {
    try {
      const chats = await this.getAll('chats', {
        participants: userId,
        archived: { $ne: 1 },
        $or: [
          { chat_name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      }, { limit });

      return chats;
    } catch (error) {
      console.error('Error searching chats:', error);
      return [];
    }
  }

  async searchMessages(userId, query, chatId = null, limit = 50) {
    try {
      let filter = {
        message: { $regex: query, $options: 'i' },
        is_deleted: { $ne: 1 }
      };

      if (chatId) {
        filter.chat = chatId;
      }

      const messages = await this.getAll('messages', filter, {
        sort: { sent_at: -1 },
        limit
      });

      return messages;
    } catch (error) {
      console.error('Error searching messages:', error);
      return [];
    }
  }

  // Analytics methods
  async getChatAnalytics(chatId, days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const pipeline = [
        {
          $match: {
            chat: chatId,
            sent_at: { $gte: cutoffDate },
            is_deleted: { $ne: 1 }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$sent_at" } },
            message_count: { $sum: 1 },
            active_users: { $addToSet: "$sender" },
            avg_message_length: { $avg: { $strLenCP: "$message" } }
          }
        },
        {
          $project: {
            date: "$_id",
            message_count: 1,
            active_users: { $size: "$active_users" },
            avg_message_length: { $round: ["$avg_message_length", 2] }
          }
        },
        { $sort: { date: -1 } }
      ];

      return await this.db.collection('messages').aggregate(pipeline).toArray();
    } catch (error) {
      console.error('Error getting chat analytics:', error);
      return [];
    }
  }

  // Database maintenance
  async cleanupOldMessages(days = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await this.db.collection('messages').deleteMany({
        sent_at: { $lt: cutoffDate },
        is_pinned: { $ne: 1 }
      });

      console.log(`🧹 [Chat Service] Cleaned up ${result.deletedCount} old messages`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning up old messages:', error);
      return 0;
    }
  }

  // Get database status
  async getStatus() {
    try {
      const status = {
        connected: this.isConnected,
        database: process.env.MONGODB_DB_NAME,
        collections: await this.db.listCollections().toArray(),
        stats: await this.db.stats()
      };

      return status;
    } catch (error) {
      console.error('Error getting database status:', error);
      return { connected: false, error: error.message };
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('📡 [Chat Service] MongoDB disconnected');
    }
  }
}

module.exports = new Database();