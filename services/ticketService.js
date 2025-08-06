const axios = require('axios');
require('dotenv').config({ path: './config.env' });

class TicketService {
  constructor() {
    this.baseURL = process.env.TICKET_SERVICE_URL || 'http://localhost:5003';
    this.apiKey = process.env.TICKET_SERVICE_API_KEY;
    this.enabled = process.env.ENABLE_TICKET_INTEGRATION === 'true';
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    this.setupInterceptors();
  }

  setupInterceptors() {
    this.api.interceptors.request.use(
      (config) => {
        if (this.apiKey) {
          config.headers['X-API-Key'] = this.apiKey;
        }
        
        console.log(`🎫 [Ticket Service] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ [Ticket Service] Request error:', error.message);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        console.log(`✅ [Ticket Service] Response ${response.status} from ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error(`❌ [Ticket Service] Response error:`, {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Lấy thông tin ticket
  async getTicket(ticketId) {
    try {
      if (!this.enabled) {
        throw new Error('Ticket integration is disabled');
      }

      const response = await this.api.get(`/api/tickets/${ticketId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ [Ticket Service] Failed to get ticket ${ticketId}:`, error.message);
      throw error;
    }
  }

  // Lấy danh sách tickets của user
  async getUserTickets(userId, filters = {}) {
    try {
      if (!this.enabled) {
        throw new Error('Ticket integration is disabled');
      }

      const params = { 
        userId,
        ...filters 
      };
      
      const response = await this.api.get('/api/tickets', { params });
      return response.data;
    } catch (error) {
      console.error(`❌ [Ticket Service] Failed to get user tickets:`, error.message);
      throw error;
    }
  }

  // Tạo group chat cho ticket
  async createTicketGroupChat(ticketData) {
    try {
      if (!this.enabled) {
        return null;
      }

      const chatData = {
        name: `Ticket #${ticketData.ticketNumber} - ${ticketData.title}`,
        description: `Group chat for ticket: ${ticketData.title}`,
        isGroup: true,
        ticketId: ticketData._id,
        ticketNumber: ticketData.ticketNumber,
        creator: ticketData.createdBy,
        participants: this.getTicketParticipants(ticketData),
        settings: {
          allowMembersToAdd: false, // Chỉ admin/support team có thể thêm member
          allowMembersToEdit: false,
          muteNotifications: false
        },
        metadata: {
          ticketId: ticketData._id,
          ticketNumber: ticketData.ticketNumber,
          ticketStatus: ticketData.status,
          ticketPriority: ticketData.priority,
          department: ticketData.department
        }
      };

      return chatData;
    } catch (error) {
      console.error('❌ [Ticket Service] Failed to create ticket group chat:', error.message);
      throw error;
    }
  }

  // Lấy danh sách participants cho ticket
  getTicketParticipants(ticketData) {
    const participants = new Set();
    
    // Thêm người tạo ticket
    if (ticketData.createdBy) {
      participants.add(ticketData.createdBy);
    }
    
    // Thêm assignee
    if (ticketData.assignedTo) {
      participants.add(ticketData.assignedTo);
    }
    
    // Thêm support team members
    if (ticketData.supportTeam && Array.isArray(ticketData.supportTeam)) {
      ticketData.supportTeam.forEach(member => {
        participants.add(member);
      });
    }
    
    // Thêm followers/watchers
    if (ticketData.followers && Array.isArray(ticketData.followers)) {
      ticketData.followers.forEach(follower => {
        participants.add(follower);
      });
    }

    return Array.from(participants);
  }

  // Cập nhật participants khi ticket thay đổi
  async updateTicketChatParticipants(ticketId, updatedTicketData) {
    try {
      if (!this.enabled) {
        return null;
      }

      const newParticipants = this.getTicketParticipants(updatedTicketData);
      
      return {
        ticketId,
        participants: newParticipants,
        metadata: {
          ticketStatus: updatedTicketData.status,
          ticketPriority: updatedTicketData.priority,
          assignedTo: updatedTicketData.assignedTo
        }
      };
    } catch (error) {
      console.error('❌ [Ticket Service] Failed to update ticket chat participants:', error.message);
      throw error;
    }
  }

  // Gửi thông báo chat message tới ticket service
  async notifyTicketMessage(ticketId, messageData) {
    try {
      if (!this.enabled) {
        return;
      }

      const notificationData = {
        ticketId,
        type: 'chat_message',
        senderId: messageData.sender,
        message: messageData.content,
        timestamp: messageData.sentAt,
        chatId: messageData.chat
      };

      await this.api.post(`/api/tickets/${ticketId}/chat-notification`, notificationData);
      console.log(`📨 [Ticket Service] Notified ticket ${ticketId} about new chat message`);
    } catch (error) {
      console.error('❌ [Ticket Service] Failed to notify ticket about chat message:', error.message);
      // Không throw error để không ảnh hưởng đến chat flow
    }
  }

  // Lấy chat history từ ticket service
  async getTicketChatHistory(ticketId) {
    try {
      if (!this.enabled) {
        return [];
      }

      const response = await this.api.get(`/api/tickets/${ticketId}/chat-history`);
      return response.data || [];
    } catch (error) {
      console.error(`❌ [Ticket Service] Failed to get ticket chat history:`, error.message);
      return [];
    }
  }

  // Kiểm tra user có quyền truy cập ticket không
  async checkTicketAccess(ticketId, userId) {
    try {
      if (!this.enabled) {
        return false;
      }

      const response = await this.api.get(`/api/tickets/${ticketId}/access`, {
        params: { userId }
      });
      
      return response.data?.hasAccess || false;
    } catch (error) {
      console.error('❌ [Ticket Service] Failed to check ticket access:', error.message);
      return false;
    }
  }

  // Lấy department/team info
  async getDepartmentInfo(departmentId) {
    try {
      if (!this.enabled) {
        return null;
      }

      const response = await this.api.get(`/api/departments/${departmentId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ [Ticket Service] Failed to get department info:`, error.message);
      return null;
    }
  }

  // Lấy support team members
  async getSupportTeamMembers(departmentId = null) {
    try {
      if (!this.enabled) {
        return [];
      }

      const params = departmentId ? { department: departmentId } : {};
      const response = await this.api.get('/api/support-team', { params });
      return response.data || [];
    } catch (error) {
      console.error('❌ [Ticket Service] Failed to get support team members:', error.message);
      return [];
    }
  }

  // Webhook handler cho ticket events
  async handleTicketWebhook(eventType, ticketData) {
    try {
      console.log(`🎫 [Ticket Service] Received webhook: ${eventType}`);
      
      switch (eventType) {
        case 'ticket.created':
          return await this.onTicketCreated(ticketData);
          
        case 'ticket.updated':
          return await this.onTicketUpdated(ticketData);
          
        case 'ticket.assigned':
          return await this.onTicketAssigned(ticketData);
          
        case 'ticket.closed':
          return await this.onTicketClosed(ticketData);
          
        default:
          console.log(`🎫 [Ticket Service] Unhandled event type: ${eventType}`);
          return null;
      }
    } catch (error) {
      console.error('❌ [Ticket Service] Webhook handler error:', error.message);
      throw error;
    }
  }

  async onTicketCreated(ticketData) {
    // Tạo group chat cho ticket mới
    const chatData = await this.createTicketGroupChat(ticketData);
    return { action: 'create_group_chat', data: chatData };
  }

  async onTicketUpdated(ticketData) {
    // Cập nhật participants nếu có thay đổi
    const updateData = await this.updateTicketChatParticipants(ticketData._id, ticketData);
    return { action: 'update_participants', data: updateData };
  }

  async onTicketAssigned(ticketData) {
    // Thêm assignee vào group chat
    const updateData = await this.updateTicketChatParticipants(ticketData._id, ticketData);
    return { action: 'add_participant', data: updateData };
  }

  async onTicketClosed(ticketData) {
    // Có thể archive group chat hoặc thông báo
    return { 
      action: 'archive_chat', 
      data: { 
        ticketId: ticketData._id,
        reason: 'Ticket closed' 
      }
    };
  }

  // Kiểm tra kết nối
  async healthCheck() {
    try {
      if (!this.enabled) {
        return { status: 'disabled', message: 'Ticket integration is disabled' };
      }

      const response = await this.api.get('/health');
      
      if (response.status === 200) {
        return { 
          status: 'connected', 
          message: 'Ticket Service is reachable',
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

module.exports = new TicketService();