// Frappe-compatible schema definitions for Chat Service
// These represent the database structure that should exist in MariaDB

const chatSchemas = {
  // Main chat table
  'ERP Chat': {
    name: 'VARCHAR(140) PRIMARY KEY',
    chat_name: 'VARCHAR(200)',
    participants: 'JSON', // Array of user IDs
    chat_type: 'VARCHAR(20) DEFAULT "direct"', // direct, group
    is_group: 'TINYINT(1) DEFAULT 0',
    description: 'TEXT',
    creator: 'VARCHAR(140)',
    admin_users: 'JSON', // Array of admin user IDs for groups
    last_message: 'VARCHAR(140)', // Reference to last message
    last_message_time: 'DATETIME',
    message_count: 'INT DEFAULT 0',
    archived: 'TINYINT(1) DEFAULT 0',
    muted_by: 'JSON', // Array of user IDs who muted this chat
    pinned_by: 'JSON', // Array of user IDs who pinned this chat
    settings: 'JSON', // Chat-specific settings
    created_at: 'DATETIME',
    updated_at: 'DATETIME',
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_participants (participants(100))',
      'INDEX idx_last_message_time (last_message_time)',
      'INDEX idx_creator (creator)',
      'INDEX idx_chat_type (chat_type)',
      'INDEX idx_is_group (is_group)'
    ]
  },

  // Chat messages table
  'ERP Chat Message': {
    name: 'VARCHAR(140) PRIMARY KEY',
    chat: 'VARCHAR(140) NOT NULL', // Foreign key to ERP Chat
    sender: 'VARCHAR(140) NOT NULL', // User ID
    message: 'TEXT',
    message_type: 'VARCHAR(20) DEFAULT "text"', // text, image, file, audio, video, emoji
    reply_to: 'VARCHAR(140)', // Reference to another message
    is_emoji: 'TINYINT(1) DEFAULT 0',
    emoji_id: 'VARCHAR(100)',
    emoji_type: 'VARCHAR(50)',
    emoji_name: 'VARCHAR(100)',
    emoji_url: 'VARCHAR(500)',
    attachments: 'JSON', // Array of attachment info
    sent_at: 'DATETIME',
    delivery_status: 'VARCHAR(20) DEFAULT "sent"', // sent, delivered, read
    read_by: 'JSON', // Array of user IDs who read this message
    is_edited: 'TINYINT(1) DEFAULT 0',
    edited_at: 'DATETIME',
    is_deleted: 'TINYINT(1) DEFAULT 0',
    deleted_at: 'DATETIME',
    deleted_for: 'JSON', // Array of user IDs who deleted this message for themselves
    is_pinned: 'TINYINT(1) DEFAULT 0',
    pinned_by: 'VARCHAR(140)',
    pinned_at: 'DATETIME',
    is_forwarded: 'TINYINT(1) DEFAULT 0',
    original_message: 'VARCHAR(140)', // Reference to original message if forwarded
    original_sender: 'VARCHAR(140)', // Original sender if forwarded
    metadata: 'JSON', // Additional message metadata
    search_keywords: 'JSON', // Keywords for search indexing
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_chat (chat)',
      'INDEX idx_sender (sender)',
      'INDEX idx_sent_at (sent_at)',
      'INDEX idx_message_type (message_type)',
      'INDEX idx_reply_to (reply_to)',
      'INDEX idx_delivery_status (delivery_status)',
      'FULLTEXT idx_message_search (message)',
      'INDEX idx_chat_sent_at (chat, sent_at)',
      'INDEX idx_is_deleted (is_deleted)',
      'INDEX idx_is_pinned (is_pinned)'
    ],
    // Foreign keys
    foreign_keys: [
      'FOREIGN KEY (chat) REFERENCES `tabERP Chat` (name) ON DELETE CASCADE',
      'FOREIGN KEY (reply_to) REFERENCES `tabERP Chat Message` (name) ON DELETE SET NULL',
      'FOREIGN KEY (original_message) REFERENCES `tabERP Chat Message` (name) ON DELETE SET NULL'
    ]
  },

  // Chat attachments table
  'ERP Chat Attachment': {
    name: 'VARCHAR(140) PRIMARY KEY',
    chat: 'VARCHAR(140) NOT NULL',
    message: 'VARCHAR(140)', // Reference to message (optional)
    file_name: 'VARCHAR(255)',
    file_path: 'VARCHAR(500)',
    file_size: 'BIGINT',
    mime_type: 'VARCHAR(100)',
    file_url: 'VARCHAR(500)', // Public URL if stored externally  
    thumbnail_path: 'VARCHAR(500)', // For images/videos
    uploaded_by: 'VARCHAR(140)',
    upload_date: 'DATETIME',
    is_deleted: 'TINYINT(1) DEFAULT 0',
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_chat (chat)',
      'INDEX idx_message (message)',
      'INDEX idx_uploaded_by (uploaded_by)',
      'INDEX idx_upload_date (upload_date)',
      'INDEX idx_mime_type (mime_type)',
      'INDEX idx_file_size (file_size)'
    ],
    // Foreign keys
    foreign_keys: [
      'FOREIGN KEY (chat) REFERENCES `tabERP Chat` (name) ON DELETE CASCADE',
      'FOREIGN KEY (message) REFERENCES `tabERP Chat Message` (name) ON DELETE CASCADE'
    ]
  },

  // Message reactions table
  'ERP Message Reaction': {
    name: 'VARCHAR(140) PRIMARY KEY',
    message: 'VARCHAR(140) NOT NULL',
    user: 'VARCHAR(140) NOT NULL',
    emoji: 'VARCHAR(10)',
    reaction_type: 'VARCHAR(50)', // like, love, laugh, etc.
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_message (message)',
      'INDEX idx_user (user)',
      'INDEX idx_emoji (emoji)',
      'UNIQUE KEY unique_user_message_emoji (message, user, emoji)'
    ],
    // Foreign keys
    foreign_keys: [
      'FOREIGN KEY (message) REFERENCES `tabERP Chat Message` (name) ON DELETE CASCADE'
    ]
  },

  // Message edit history table
  'ERP Message History': {
    name: 'VARCHAR(140) PRIMARY KEY',
    message: 'VARCHAR(140) NOT NULL',
    original_content: 'TEXT',
    edited_content: 'TEXT',
    edited_by: 'VARCHAR(140)',
    edited_at: 'DATETIME',
    edit_reason: 'VARCHAR(200)',
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_message (message)',
      'INDEX idx_edited_by (edited_by)',
      'INDEX idx_edited_at (edited_at)'
    ],
    // Foreign keys
    foreign_keys: [
      'FOREIGN KEY (message) REFERENCES `tabERP Chat Message` (name) ON DELETE CASCADE'
    ]
  },

  // Chat participants table (for better querying)
  'ERP Chat Participant': {
    name: 'VARCHAR(140) PRIMARY KEY',
    chat: 'VARCHAR(140) NOT NULL',
    user: 'VARCHAR(140) NOT NULL',
    role: 'VARCHAR(20) DEFAULT "member"', // admin, member
    joined_at: 'DATETIME',
    left_at: 'DATETIME',
    is_active: 'TINYINT(1) DEFAULT 1',
    notifications_enabled: 'TINYINT(1) DEFAULT 1',
    last_read_message: 'VARCHAR(140)', // Last message user has read
    last_read_at: 'DATETIME',
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_chat (chat)',
      'INDEX idx_user (user)',
      'INDEX idx_is_active (is_active)',
      'UNIQUE KEY unique_chat_user (chat, user)',
      'INDEX idx_last_read_at (last_read_at)'
    ],
    // Foreign keys
    foreign_keys: [
      'FOREIGN KEY (chat) REFERENCES `tabERP Chat` (name) ON DELETE CASCADE',
      'FOREIGN KEY (last_read_message) REFERENCES `tabERP Chat Message` (name) ON DELETE SET NULL'
    ]
  },

  // Custom emoji table
  'ERP Custom Emoji': {
    name: 'VARCHAR(140) PRIMARY KEY',
    emoji_name: 'VARCHAR(100) UNIQUE',
    emoji_code: 'VARCHAR(50)', // :custom_emoji:
    file_path: 'VARCHAR(500)',
    file_url: 'VARCHAR(500)',
    created_by: 'VARCHAR(140)',
    is_active: 'TINYINT(1) DEFAULT 1',
    usage_count: 'INT DEFAULT 0',
    // Frappe standard fields
    creation: 'DATETIME',
    modified: 'DATETIME',
    modified_by: 'VARCHAR(140)',
    owner: 'VARCHAR(140)',
    docstatus: 'INT DEFAULT 0',
    idx: 'INT DEFAULT 0',
    // Indexes
    indexes: [
      'INDEX idx_emoji_name (emoji_name)',
      'INDEX idx_emoji_code (emoji_code)',
      'INDEX idx_created_by (created_by)',
      'INDEX idx_is_active (is_active)',
      'INDEX idx_usage_count (usage_count)'
    ]
  }
};

// Database initialization helper
class ChatDatabase {
  constructor(database) {
    this.db = database;
  }

  // Create all chat-related tables
  async initializeTables() {
    try {
      console.log('🔧 [Chat Service] Initializing database tables...');

      for (const [tableName, schema] of Object.entries(chatSchemas)) {
        await this.createTable(tableName, schema);
      }

      console.log('✅ [Chat Service] Database tables initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ [Chat Service] Error initializing database tables:', error);
      return false;
    }
  }

  // Create individual table
  async createTable(tableName, schema) {
    try {
      const tableSafeName = `\`tab${tableName}\``;
      
      // Build column definitions
      const columns = [];
      const indexes = [];
      const foreignKeys = [];

      for (const [columnName, definition] of Object.entries(schema)) {
        if (columnName === 'indexes') {
          indexes.push(...definition);
        } else if (columnName === 'foreign_keys') {
          foreignKeys.push(...definition);
        } else {
          columns.push(`\`${columnName}\` ${definition}`);
        }
      }

      // Create table SQL
      let createSQL = `CREATE TABLE IF NOT EXISTS ${tableSafeName} (
        ${columns.join(',\n        ')}
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

      await this.db.query(createSQL);
      
      // Add indexes
      for (const index of indexes) {
        try {
          await this.db.query(`ALTER TABLE ${tableSafeName} ADD ${index}`);
        } catch (indexError) {
          // Index might already exist, ignore error
          if (!indexError.message.includes('Duplicate key name')) {
            console.warn(`Warning creating index for ${tableName}:`, indexError.message);
          }
        }
      }

      // Add foreign keys
      for (const fk of foreignKeys) {
        try {
          await this.db.query(`ALTER TABLE ${tableSafeName} ADD ${fk}`);
        } catch (fkError) {
          // Foreign key might already exist, ignore error
          if (!fkError.message.includes('Duplicate foreign key constraint name')) {
            console.warn(`Warning creating foreign key for ${tableName}:`, fkError.message);
          }
        }
      }

      console.log(`✅ [Chat Service] Table ${tableName} created/verified`);
      
    } catch (error) {
      console.error(`❌ [Chat Service] Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  // Verify table structure
  async verifyTables() {
    try {
      const results = {};
      
      for (const tableName of Object.keys(chatSchemas)) {
        const tableSafeName = `tab${tableName}`;
        const result = await this.db.query(`SHOW TABLES LIKE ?`, [tableSafeName]);
        results[tableName] = result.length > 0;
      }

      return results;
    } catch (error) {
      console.error('Error verifying tables:', error);
      return {};
    }
  }

  // Create sample data for testing
  async createSampleData() {
    try {
      console.log('🔧 [Chat Service] Creating sample data...');

      // Create sample custom emoji
      const sampleEmoji = {
        name: 'EMOJI-sample-thumbs-up',
        emoji_name: 'thumbs_up_custom',
        emoji_code: ':thumbs_up_custom:',
        file_path: '/uploads/emoji/thumbs_up.png',
        file_url: '/uploads/emoji/thumbs_up.png',
        created_by: 'Administrator',
        is_active: 1,
        usage_count: 0,
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        modified_by: 'Administrator',
        owner: 'Administrator',
        docstatus: 0,
        idx: 0
      };

      // Insert sample data (check if exists first)
      const existingEmoji = await this.db.get('ERP Custom Emoji', sampleEmoji.name);
      if (!existingEmoji) {
        await this.db.insert('ERP Custom Emoji', sampleEmoji);
        console.log('✅ [Chat Service] Sample emoji created');
      }

      console.log('✅ [Chat Service] Sample data creation completed');
      return true;
    } catch (error) {
      console.error('❌ [Chat Service] Error creating sample data:', error);
      return false;
    }
  }
}

module.exports = {
  chatSchemas,
  ChatDatabase
};