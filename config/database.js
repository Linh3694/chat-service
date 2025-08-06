const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      // Sử dụng MongoDB local cho chat service
      const uri = process.env.MONGODB_URI || 
        `mongodb://${process.env.MONGODB_HOST || 'localhost'}:${process.env.MONGODB_PORT || 27017}/${process.env.MONGODB_DATABASE || 'wellspring_chat'}`;

      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // Tối ưu cho local development
        bufferMaxEntries: 0,
        connectTimeoutMS: 10000,
      };

      // Add authentication if credentials are provided
      if (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD) {
        options.auth = {
          username: process.env.MONGODB_USER,
          password: process.env.MONGODB_PASSWORD,
        };
      }

      console.log(`🔗 [Chat Service] Connecting to MongoDB: ${uri}`);
      this.connection = await mongoose.connect(uri, options);
      
      console.log('✅ [Chat Service] MongoDB local connection established successfully');
      console.log(`📊 [Chat Service] Database: ${mongoose.connection.name}`);
      
      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error('❌ [Chat Service] MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ [Chat Service] MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 [Chat Service] MongoDB reconnected');
      });

      // Tạo indexes nếu chưa có
      await this.createIndexes();

    } catch (error) {
      console.error('❌ [Chat Service] MongoDB local connection failed:', error.message);
      throw error;
    }
  }

  async createIndexes() {
    try {
      const db = mongoose.connection.db;
      
      // Tạo collections nếu chưa có
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      
      if (!collectionNames.includes('users')) {
        await db.createCollection('users');
        console.log('📋 [Chat Service] Created users collection');
      }
      
      if (!collectionNames.includes('chats')) {
        await db.createCollection('chats');
        console.log('📋 [Chat Service] Created chats collection');
      }
      
      if (!collectionNames.includes('messages')) {
        await db.createCollection('messages');
        console.log('📋 [Chat Service] Created messages collection');
      }
      
      console.log('✅ [Chat Service] Database indexes and collections ready');
    } catch (error) {
      console.warn('⚠️ [Chat Service] Failed to create indexes:', error.message);
    }
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      console.log('🔌 [Chat Service] MongoDB disconnected');
    }
  }

  getConnection() {
    return mongoose.connection;
  }

  // Helper method to check if connected
  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  // Health check
  async healthCheck() {
    try {
      if (!this.isConnected()) {
        throw new Error('Database not connected');
      }
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

module.exports = new Database();