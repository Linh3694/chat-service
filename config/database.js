const mysql = require('mysql2/promise');
const { ChatDatabase } = require('../models/chatModels');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.pool = null;
    this.chatDb = null;
  }

  async connect() {
    try {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
        charset: 'utf8mb4'
      });

      // Test connection
      const connection = await this.pool.getConnection();
      console.log('✅ [Chat Service] MariaDB connected successfully');
      connection.release();

      // Initialize chat database helper
      this.chatDb = new ChatDatabase(this);

      // Auto-initialize tables in development
      if (process.env.NODE_ENV !== 'production') {
        await this.chatDb.initializeTables();
        await this.chatDb.createSampleData();
      }

    } catch (error) {
      console.error('❌ [Chat Service] MariaDB connection failed:', error.message);
      throw error;
    }
  }

  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('Database query error:', error);
      console.error('SQL:', sql);
      console.error('Params:', params);
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Frappe-style methods with enhanced features
  async insert(doctype, doc) {
    const fields = Object.keys(doc);
    const values = Object.values(doc);
    const placeholders = fields.map(() => '?').join(',');
    
    const sql = `INSERT INTO \`tab${doctype}\` (${fields.map(f => '`' + f + '`').join(',')}) VALUES (${placeholders})`;
    const result = await this.query(sql, values);
    return result.insertId;
  }

  async update(doctype, name, doc) {
    const fields = Object.keys(doc);
    const values = Object.values(doc);
    const setClause = fields.map(f => '`' + f + '` = ?').join(',');
    
    const sql = `UPDATE \`tab${doctype}\` SET ${setClause} WHERE name = ?`;
    await this.query(sql, [...values, name]);
    return true;
  }

  async get(doctype, name, fields = '*') {
    const fieldList = Array.isArray(fields) ? fields.map(f => '`' + f + '`').join(',') : fields;
    const sql = `SELECT ${fieldList} FROM \`tab${doctype}\` WHERE name = ?`;
    const rows = await this.query(sql, [name]);
    return rows[0] || null;
  }

  async getAll(doctype, filters = {}, fields = '*', orderBy = 'modified DESC', limit = null) {
    const fieldList = Array.isArray(fields) ? fields.map(f => '`' + f + '`').join(',') : fields;
    let sql = `SELECT ${fieldList} FROM \`tab${doctype}\``;
    const params = [];

    // Build WHERE clause
    if (Object.keys(filters).length > 0) {
      const conditions = [];
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value) && value[0] === 'between') {
          conditions.push(`\`${key}\` BETWEEN ? AND ?`);
          params.push(value[1], value[2]);
        } else if (Array.isArray(value) && value[0] === 'in') {
          const placeholders = value[1].map(() => '?').join(',');
          conditions.push(`\`${key}\` IN (${placeholders})`);
          params.push(...value[1]);
        } else if (Array.isArray(value) && value[0] === 'like') {
          conditions.push(`\`${key}\` LIKE ?`);
          params.push(value[1]);
        } else if (Array.isArray(value) && value[0] === 'not_null') {
          conditions.push(`\`${key}\` IS NOT NULL`);
        } else if (Array.isArray(value) && value[0] === 'null') {
          conditions.push(`\`${key}\` IS NULL`);
        } else {
          conditions.push(`\`${key}\` = ?`);
          params.push(value);
        }
      }
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Add ORDER BY
    if (orderBy) {
      sql += ` ORDER BY ${orderBy}`;
    }

    // Add LIMIT
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    return await this.query(sql, params);
  }

  async delete(doctype, name) {
    const sql = `DELETE FROM \`tab${doctype}\` WHERE name = ?`;
    await this.query(sql, [name]);
    return true;
  }

  async exists(doctype, filters) {
    const conditions = [];
    const params = [];
    
    for (const [key, value] of Object.entries(filters)) {
      conditions.push(`\`${key}\` = ?`);
      params.push(value);
    }
    
    const sql = `SELECT COUNT(*) as count FROM \`tab${doctype}\` WHERE ${conditions.join(' AND ')}`;
    const result = await this.query(sql, params);
    return result[0].count > 0;
  }

  // Enhanced search methods for chat
  async searchChats(userId, query, limit = 20) {
    const sql = `
      SELECT c.*, 
             MATCH(c.chat_name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance
      FROM \`tabERP Chat\` c
      WHERE JSON_CONTAINS(c.participants, ?) 
      AND c.archived = 0
      AND (
        MATCH(c.chat_name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE)
        OR c.chat_name LIKE ?
      )
      ORDER BY relevance DESC, c.updated_at DESC
      LIMIT ?
    `;
    
    const searchTerm = `%${query}%`;
    return await this.query(sql, [query, JSON.stringify(userId), query, searchTerm, limit]);
  }

  async searchMessages(userId, query, chatId = null, limit = 50) {
    let sql = `
      SELECT m.*, c.chat_name,
             MATCH(m.message) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance
      FROM \`tabERP Chat Message\` m
      JOIN \`tabERP Chat\` c ON m.chat = c.name
      WHERE JSON_CONTAINS(c.participants, ?)
      AND m.is_deleted = 0
      AND (m.deleted_for IS NULL OR JSON_SEARCH(m.deleted_for, 'one', ?) IS NULL)
      AND MATCH(m.message) AGAINST(? IN NATURAL LANGUAGE MODE)
    `;
    
    const params = [query, JSON.stringify(userId), userId, query];
    
    if (chatId) {
      sql += ` AND m.chat = ?`;
      params.push(chatId);
    }
    
    sql += ` ORDER BY relevance DESC, m.sent_at DESC LIMIT ?`;
    params.push(limit);
    
    return await this.query(sql, params);
  }

  // Chat-specific helper methods
  async getChatParticipants(chatId) {
    const sql = `
      SELECT u.name, u.full_name, u.email, u.avatar_url, u.enabled
      FROM \`tabUser\` u
      JOIN \`tabERP Chat\` c ON JSON_CONTAINS(c.participants, JSON_QUOTE(u.name))
      WHERE c.name = ? AND u.enabled = 1
    `;
    
    return await this.query(sql, [chatId]);
  }

  async getUnreadMessageCount(userId, chatId = null) {
    let sql = `
      SELECT COUNT(*) as count
      FROM \`tabERP Chat Message\` m
      JOIN \`tabERP Chat\` c ON m.chat = c.name
      WHERE JSON_CONTAINS(c.participants, ?)
      AND m.sender != ?
      AND (m.read_by IS NULL OR JSON_SEARCH(m.read_by, 'one', ?) IS NULL)
      AND m.is_deleted = 0
      AND (m.deleted_for IS NULL OR JSON_SEARCH(m.deleted_for, 'one', ?) IS NULL)
    `;
    
    const params = [JSON.stringify(userId), userId, userId, userId];
    
    if (chatId) {
      sql += ` AND m.chat = ?`;
      params.push(chatId);
    }
    
    const result = await this.query(sql, params);
    return result[0].count;
  }

  async getRecentContacts(userId, limit = 20) {
    const sql = `
      SELECT DISTINCT u.name, u.full_name, u.email, u.avatar_url, 
             MAX(m.sent_at) as last_message_time
      FROM \`tabUser\` u
      JOIN \`tabERP Chat Message\` m ON (m.sender = u.name OR m.sender = ?)
      JOIN \`tabERP Chat\` c ON m.chat = c.name
      WHERE JSON_CONTAINS(c.participants, ?)
      AND u.name != ?
      AND u.enabled = 1
      GROUP BY u.name, u.full_name, u.email, u.avatar_url
      ORDER BY last_message_time DESC
      LIMIT ?
    `;
    
    return await this.query(sql, [userId, JSON.stringify(userId), userId, limit]);
  }

  // Analytics methods
  async getChatAnalytics(chatId, days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const sql = `
      SELECT 
        DATE(sent_at) as date,
        COUNT(*) as message_count,
        COUNT(DISTINCT sender) as active_users,
        AVG(CHAR_LENGTH(message)) as avg_message_length
      FROM \`tabERP Chat Message\`
      WHERE chat = ? 
      AND sent_at >= ?
      AND is_deleted = 0
      GROUP BY DATE(sent_at)
      ORDER BY date DESC
    `;
    
    return await this.query(sql, [chatId, cutoffDate.toISOString()]);
  }

  async getUserChatStats(userId, days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const sql = `
      SELECT 
        COUNT(DISTINCT m.chat) as active_chats,
        COUNT(*) as messages_sent,
        AVG(CHAR_LENGTH(m.message)) as avg_message_length,
        COUNT(DISTINCT DATE(m.sent_at)) as active_days
      FROM \`tabERP Chat Message\` m
      JOIN \`tabERP Chat\` c ON m.chat = c.name
      WHERE m.sender = ?
      AND m.sent_at >= ?
      AND JSON_CONTAINS(c.participants, ?)
      AND m.is_deleted = 0
    `;
    
    const result = await this.query(sql, [userId, cutoffDate.toISOString(), JSON.stringify(userId)]);
    return result[0] || {};
  }

  // Database maintenance
  async cleanupOldMessages(days = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    // Delete old messages (but keep last message in each chat)
    const sql = `
      DELETE m FROM \`tabERP Chat Message\` m
      LEFT JOIN \`tabERP Chat\` c ON c.last_message = m.name
      WHERE m.sent_at < ?
      AND c.last_message IS NULL
      AND m.is_pinned = 0
    `;
    
    const result = await this.query(sql, [cutoffDate.toISOString()]);
    return result.affectedRows;
  }

  async optimizeTables() {
    const tables = ['ERP Chat', 'ERP Chat Message', 'ERP Chat Attachment', 'ERP Message Reaction'];
    
    for (const table of tables) {
      try {
        await this.query(`OPTIMIZE TABLE \`tab${table}\``);
        console.log(`✅ [Chat Service] Optimized table ${table}`);
      } catch (error) {
        console.warn(`⚠️ [Chat Service] Failed to optimize table ${table}:`, error.message);
      }
    }
  }

  // Get database status
  async getStatus() {
    try {
      const status = {
        connected: !!this.pool,
        tables: await this.chatDb?.verifyTables() || {},
        pool_status: this.pool ? {
          total_connections: this.pool.pool._allConnections.length,
          free_connections: this.pool.pool._freeConnections.length,
          queue_length: this.pool.pool._connectionQueue.length
        } : null
      };

      return status;
    } catch (error) {
      console.error('Error getting database status:', error);
      return { connected: false, error: error.message };
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('📡 [Chat Service] Database disconnected');
    }
  }
}

module.exports = new Database();