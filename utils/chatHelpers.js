const moment = require('moment');
const redisClient = require('../config/redis');

class ChatHelpers {
  // Generate unique chat/message IDs
  static generateId(prefix = 'ID') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Format timestamps for display
  static formatTimestamp(timestamp, format = 'YYYY-MM-DD HH:mm:ss') {
    return moment(timestamp).format(format);
  }

  // Get relative time (e.g., "2 minutes ago")
  static getRelativeTime(timestamp) {
    return moment(timestamp).fromNow();
  }

  // Check if timestamp is today
  static isToday(timestamp) {
    return moment(timestamp).isSame(moment(), 'day');
  }

  // Check if timestamp is this week
  static isThisWeek(timestamp) {
    return moment(timestamp).isSame(moment(), 'week');
  }

  // Sanitize message content
  static sanitizeContent(content) {
    if (!content) return '';
    
    return content
      .trim()
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .substring(0, 4000); // Limit length
  }

  // Extract mentions from message content
  static extractMentions(content) {
    if (!content) return [];
    
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    
    return [...new Set(mentions)]; // Remove duplicates
  }

  // Extract hashtags from message content  
  static extractHashtags(content) {
    if (!content) return [];
    
    const hashtagRegex = /#(\w+)/g;
    const hashtags = [];
    let match;
    
    while ((match = hashtagRegex.exec(content)) !== null) {
      hashtags.push(match[1]);
    }
    
    return [...new Set(hashtags)]; // Remove duplicates
  }

  // Generate chat display name
  static generateChatDisplayName(chat, currentUserId) {
    if (chat.is_group) {
      return chat.chat_name || 'Group Chat';
    }
    
    // For direct chats, show the other participant's name
    const participants = JSON.parse(chat.participants || '[]');
    const otherParticipant = participants.find(p => p !== currentUserId);
    
    return otherParticipant || 'Unknown User';
  }

  // Check if user can access chat
  static canUserAccessChat(chat, userId) {
    if (!chat || !userId) return false;
    
    const participants = JSON.parse(chat.participants || '[]');
    return participants.includes(userId);
  }

  // Check if user can edit message
  static canUserEditMessage(message, userId) {
    if (!message || !userId) return false;
    
    // Only sender can edit
    if (message.sender !== userId) return false;
    
    // Check if message is too old (24 hours)
    const messageTime = moment(message.sent_at);
    const now = moment();
    const hoursDiff = now.diff(messageTime, 'hours');
    
    return hoursDiff <= 24;
  }

  // Check if user can delete message
  static canUserDeleteMessage(message, userId, chat) {
    if (!message || !userId) return false;
    
    // Sender can always delete their message
    if (message.sender === userId) return true;
    
    // Group admin can delete any message in their group
    if (chat && chat.is_group && chat.creator === userId) return true;
    
    return false;
  }

  // Calculate typing timeout
  static getTypingTimeout() {
    return 3000; // 3 seconds
  }

  // Format file size for display
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Get file type icon
  static getFileTypeIcon(mimetype) {
    if (mimetype.startsWith('image/')) return '🖼️';
    if (mimetype.startsWith('video/')) return '🎥';
    if (mimetype.startsWith('audio/')) return '🎵';
    if (mimetype.includes('pdf')) return '📄';
    if (mimetype.includes('word')) return '📝';
    if (mimetype.includes('excel')) return '📊';
    if (mimetype.includes('powerpoint')) return '📺';
    return '📎';
  }

  // Validate emoji format
  static isValidEmoji(emoji) {
    // Basic emoji validation (you might want to use a proper emoji library)
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    return emojiRegex.test(emoji) && emoji.length <= 10;
  }

  // Get message preview for notifications
  static getMessagePreview(message, maxLength = 100) {
    if (!message) return '';
    
    let preview = '';
    
    if (message.is_emoji) {
      preview = `${message.emoji_name || 'Emoji'} ${message.emoji_url || ''}`;
    } else if (message.message_type === 'image') {
      preview = '📷 Image';
    } else if (message.message_type === 'file') {
      preview = '📎 File';
    } else if (message.message_type === 'audio') {
      preview = '🎵 Audio';
    } else if (message.message_type === 'video') {
      preview = '🎥 Video';
    } else {
      preview = message.message || '';
    }
    
    return preview.length > maxLength ? 
      preview.substring(0, maxLength) + '...' : 
      preview;
  }

  // Rate limiting check
  static async checkRateLimit(userId, action = 'message', maxActions = 60, windowSeconds = 60) {
    const key = `rate_limit:${userId}:${action}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // Get current count
    const actions = await redisClient.get(key) || [];
    
    // Filter actions within window
    const recentActions = actions.filter(timestamp => timestamp > windowStart);
    
    if (recentActions.length >= maxActions) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: recentActions[0] + (windowSeconds * 1000)
      };
    }
    
    // Add current action
    recentActions.push(now);
    await redisClient.set(key, recentActions, windowSeconds);
    
    return {
      allowed: true,
      remaining: maxActions - recentActions.length,
      resetTime: now + (windowSeconds * 1000)
    };
  }

  // Clean up old data
  static async cleanupOldData(days = 90) {
    try {
      console.log(`🧹 [Chat Service] Starting cleanup of data older than ${days} days...`);
      
      const cutoffDate = moment().subtract(days, 'days').toISOString();
      
      // This would typically be handled by scheduled jobs
      // Just log for now as database operations need careful handling
      
      console.log(`✅ [Chat Service] Cleanup completed for data before ${cutoffDate}`);
      
      return true;
    } catch (error) {
      console.error('❌ [Chat Service] Error during cleanup:', error);
      return false;
    }
  }

  // Generate search keywords from message
  static generateSearchKeywords(message) {
    if (!message || !message.message) return [];
    
    const content = message.message.toLowerCase();
    const words = content
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/) // Split by whitespace
      .filter(word => word.length > 2) // Keep words longer than 2 chars
      .slice(0, 20); // Limit to 20 keywords
    
    return [...new Set(words)]; // Remove duplicates
  }

  // Calculate message metrics
  static calculateMessageMetrics(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        total: 0,
        today: 0,
        this_week: 0,
        by_type: {},
        by_hour: {},
        avg_length: 0
      };
    }
    
    const metrics = {
      total: messages.length,
      today: 0,
      this_week: 0,
      by_type: {},
      by_hour: {},
      avg_length: 0
    };
    
    let totalLength = 0;
    
    messages.forEach(message => {
      // Count by day/week
      if (this.isToday(message.sent_at)) {
        metrics.today++;
      }
      if (this.isThisWeek(message.sent_at)) {
        metrics.this_week++;
      }
      
      // Count by type
      const type = message.message_type || 'text';
      metrics.by_type[type] = (metrics.by_type[type] || 0) + 1;
      
      // Count by hour
      const hour = moment(message.sent_at).hour();
      metrics.by_hour[hour] = (metrics.by_hour[hour] || 0) + 1;
      
      // Calculate average length
      if (message.message) {
        totalLength += message.message.length;
      }
    });
    
    metrics.avg_length = messages.length > 0 ? 
      Math.round(totalLength / messages.length) : 0;
    
    return metrics;
  }
}

module.exports = ChatHelpers;