const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const uri = process.env.MONGODB_URI || 
        `mongodb://${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_DATABASE}`;

      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      };

      // Add authentication if credentials are provided
      if (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD) {
        options.auth = {
          username: process.env.MONGODB_USER,
          password: process.env.MONGODB_PASSWORD,
        };
      }

      this.connection = await mongoose.connect(uri, options);
      
      console.log('✅ [Chat Service] MongoDB connected successfully');
      
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

    } catch (error) {
      console.error('❌ [Chat Service] MongoDB connection failed:', error.message);
      throw error;
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