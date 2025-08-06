const axios = require('axios');
require('dotenv').config({ path: './config.env' });

class NotificationService {
  constructor() {
    this.baseURL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5004';
    this.apiKey = process.env.NOTIFICATION_SERVICE_API_KEY;
    this.enabled = process.env.ENABLE_NOTIFICATION_INTEGRATION === 'true';
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    this.setupInterceptors();
    
    // Notification types
    this.NOTIFICATION_TYPES = {
      NEW_MESSAGE: 'new_message',
      MENTION: 'mention',
      GROUP_INVITE: 'group_invite',
      GROUP_ADDED: 'group_added',
      MESSAGE_REACTION: 'message_reaction',
      CHAT_CREATED: 'chat_created',
      GROUP_UPDATED: 'group_updated'
    };
  }

  setupInterceptors() {
    this.api.interceptors.request.use(
      (config) => {
        if (this.apiKey) {
          config.headers['X-API-Key'] = this.apiKey;
        }
        
        console.log(`📢 [Notification Service] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ [Notification Service] Request error:', error.message);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        console.log(`✅ [Notification Service] Response ${response.status} from ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error(`❌ [Notification Service] Response error:`, {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Gửi notification cho tin nhắn mới
  async sendNewMessageNotification(messageData, recipients) {
    try {
      if (!this.enabled || !recipients.length) {
        return;
      }

      const notificationData = {
        type: this.NOTIFICATION_TYPES.NEW_MESSAGE,
        title: this.getNotificationTitle(messageData),
        body: this.getNotificationBody(messageData),
        recipients: recipients.filter(id => id !== messageData.sender), // Không gửi cho người gửi
        data: {
          chatId: messageData.chat,
          messageId: messageData._id,
          senderId: messageData.sender,
          senderName: messageData.sender_name,
          messageType: messageData.messageType
        },
        priority: 'normal',
        sound: 'default',
        badge: 1
      };

      await this.api.post('/api/notifications/send', notificationData);
      console.log(`📨 [Notification Service] Sent new message notification to ${recipients.length} recipients`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send new message notification:', error.message);
      // Không throw error để không ảnh hưởng đến chat flow
    }
  }

  // Gửi notification cho mention
  async sendMentionNotification(messageData, mentionedUsers) {
    try {
      if (!this.enabled || !mentionedUsers.length) {
        return;
      }

      const notificationData = {
        type: this.NOTIFICATION_TYPES.MENTION,
        title: `${messageData.sender_name} mentioned you`,
        body: this.getNotificationBody(messageData),
        recipients: mentionedUsers.filter(id => id !== messageData.sender),
        data: {
          chatId: messageData.chat,
          messageId: messageData._id,
          senderId: messageData.sender,
          senderName: messageData.sender_name,
          messageType: messageData.messageType
        },
        priority: 'high',
        sound: 'mention',
        badge: 1
      };

      await this.api.post('/api/notifications/send', notificationData);
      console.log(`📨 [Notification Service] Sent mention notification to ${mentionedUsers.length} users`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send mention notification:', error.message);
    }
  }

  // Gửi notification khi được thêm vào group
  async sendGroupInviteNotification(groupData, invitedUsers, invitedBy) {
    try {
      if (!this.enabled || !invitedUsers.length) {
        return;
      }

      const notificationData = {
        type: this.NOTIFICATION_TYPES.GROUP_ADDED,
        title: 'Added to group',
        body: `${invitedBy.fullName} added you to "${groupData.name}"`,
        recipients: invitedUsers,
        data: {
          chatId: groupData._id,
          groupName: groupData.name,
          invitedBy: invitedBy._id,
          invitedByName: invitedBy.fullName
        },
        priority: 'normal',
        sound: 'default',
        badge: 1
      };

      await this.api.post('/api/notifications/send', notificationData);
      console.log(`📨 [Notification Service] Sent group invite notification to ${invitedUsers.length} users`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send group invite notification:', error.message);
    }
  }

  // Gửi notification cho reaction
  async sendReactionNotification(messageData, reactionData, reactedBy) {
    try {
      if (!this.enabled || messageData.sender === reactedBy._id) {
        return; // Không gửi notification nếu react message của chính mình
      }

      const notificationData = {
        type: this.NOTIFICATION_TYPES.MESSAGE_REACTION,
        title: 'Message reaction',
        body: `${reactedBy.fullName} reacted ${reactionData.emoji} to your message`,
        recipients: [messageData.sender],
        data: {
          chatId: messageData.chat,
          messageId: messageData._id,
          reactedBy: reactedBy._id,
          reactedByName: reactedBy.fullName,
          emoji: reactionData.emoji
        },
        priority: 'low',
        sound: 'none',
        badge: 0
      };

      await this.api.post('/api/notifications/send', notificationData);
      console.log(`📨 [Notification Service] Sent reaction notification`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send reaction notification:', error.message);
    }
  }

  // Gửi notification khi tạo group chat
  async sendGroupCreatedNotification(groupData, participants, creator) {
    try {
      if (!this.enabled || !participants.length) {
        return;
      }

      const notificationData = {
        type: this.NOTIFICATION_TYPES.CHAT_CREATED,
        title: 'New group chat',
        body: `${creator.fullName} created "${groupData.name}"`,
        recipients: participants.filter(id => id !== creator._id),
        data: {
          chatId: groupData._id,
          groupName: groupData.name,
          createdBy: creator._id,
          createdByName: creator.fullName
        },
        priority: 'normal',
        sound: 'default',
        badge: 1
      };

      await this.api.post('/api/notifications/send', notificationData);
      console.log(`📨 [Notification Service] Sent group created notification to ${participants.length} participants`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send group created notification:', error.message);
    }
  }

  // Gửi bulk notifications
  async sendBulkNotifications(notifications) {
    try {
      if (!this.enabled || !notifications.length) {
        return;
      }

      await this.api.post('/api/notifications/send-bulk', { notifications });
      console.log(`📨 [Notification Service] Sent ${notifications.length} bulk notifications`);
    } catch (error) {
      console.error('❌ [Notification Service] Failed to send bulk notifications:', error.message);
    }
  }

  // Lấy notification settings của user
  async getUserNotificationSettings(userId) {
    try {
      if (!this.enabled) {
        return this.getDefaultNotificationSettings();
      }

      const response = await this.api.get(`/api/notifications/settings/${userId}`);
      return response.data || this.getDefaultNotificationSettings();
    } catch (error) {
      console.error('❌ [Notification Service] Failed to get user notification settings:', error.message);
      return this.getDefaultNotificationSettings();
    }
  }

  // Cập nhật notification settings
  async updateUserNotificationSettings(userId, settings) {
    try {
      if (!this.enabled) {
        return false;
      }

      await this.api.put(`/api/notifications/settings/${userId}`, settings);
      console.log(`✅ [Notification Service] Updated notification settings for user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [Notification Service] Failed to update notification settings:', error.message);
      return false;
    }
  }

  // Đăng ký push token
  async registerPushToken(userId, token, platform = 'mobile') {
    try {
      if (!this.enabled) {
        return false;
      }

      await this.api.post('/api/notifications/push-tokens', {
        userId,
        token,
        platform
      });
      
      console.log(`✅ [Notification Service] Registered push token for user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [Notification Service] Failed to register push token:', error.message);
      return false;
    }
  }

  // Hủy đăng ký push token
  async unregisterPushToken(userId, token) {
    try {
      if (!this.enabled) {
        return false;
      }

      await this.api.delete('/api/notifications/push-tokens', {
        data: { userId, token }
      });
      
      console.log(`✅ [Notification Service] Unregistered push token for user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [Notification Service] Failed to unregister push token:', error.message);
      return false;
    }
  }

  // Helper methods
  getNotificationTitle(messageData) {
    if (messageData.isGroup) {
      return `${messageData.sender_name} in ${messageData.groupName || 'Group Chat'}`;
    }
    return messageData.sender_name || 'New Message';
  }

  getNotificationBody(messageData) {
    switch (messageData.messageType) {
      case 'image':
        return '📷 Photo';
      case 'file':
        return '📎 File';
      case 'audio':
        return '🎵 Audio';
      case 'video':
        return '🎥 Video';
      case 'emoji':
        return messageData.content || '😊 Emoji';
      default:
        return this.truncateMessage(messageData.content, 100);
    }
  }

  truncateMessage(content, maxLength = 100) {
    if (!content) return 'New message';
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  getDefaultNotificationSettings() {
    return {
      newMessages: true,
      mentions: true,
      groupInvites: true,
      reactions: false,
      sounds: true,
      vibration: true,
      led: true,
      quietHours: {
        enabled: false,
        startTime: '22:00',
        endTime: '08:00'
      }
    };
  }

  // Kiểm tra kết nối
  async healthCheck() {
    try {
      if (!this.enabled) {
        return { status: 'disabled', message: 'Notification integration is disabled' };
      }

      const response = await this.api.get('/health');
      
      if (response.status === 200) {
        return { 
          status: 'connected', 
          message: 'Notification Service is reachable',
          url: this.baseURL
        };
      }
      
      return { 
        status: 'error', 
        message: `Unexpected response: ${response.status}` 
      };
    } catch (error) {
      return { 
        status: 'error', 
        message: error.message,
        url: this.baseURL 
      };
    }
  }
}

module.exports = new NotificationService();