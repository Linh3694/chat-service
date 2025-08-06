const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const frappeService = require('../services/frappeService');
const ticketService = require('../services/ticketService');
const notificationService = require('../services/notificationService');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

// Middleware để kiểm tra quyền admin
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.roles || !req.user.roles.includes('System Manager')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
      code: 'INSUFFICIENT_PRIVILEGES'
    });
  }
  next();
};

// Đồng bộ tất cả users từ Frappe
router.post('/sync/users', authenticate, requireAdmin, async (req, res) => {
  try {
    console.log('🔄 [Chat Service] Starting user sync...');
    const result = await frappeService.syncAllUsers();
    
    res.json({
      success: true,
      message: 'User sync completed',
      data: result
    });
  } catch (error) {
    console.error('❌ [Chat Service] User sync failed:', error.message);
    res.status(500).json({
      success: false,
      message: 'User sync failed',
      error: error.message
    });
  }
});

// Đồng bộ một user cụ thể
router.post('/sync/users/:frappeUserId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { frappeUserId } = req.params;
    const localUser = await frappeService.syncUser(frappeUserId);
    
    res.json({
      success: true,
      message: 'User synced successfully',
      data: localUser
    });
  } catch (error) {
    console.error('❌ [Chat Service] User sync failed:', error.message);
    res.status(500).json({
      success: false,
      message: 'User sync failed',
      error: error.message
    });
  }
});

// Lấy thống kê tổng quan
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = {
      users: {
        total: await User.countDocuments(),
        active: await User.countDocuments({ status: 'active' }),
        online: await User.countDocuments({ isOnline: true })
      },
      chats: {
        total: await Chat.countDocuments(),
        direct: await Chat.countDocuments({ isGroup: false }),
        groups: await Chat.countDocuments({ isGroup: true })
      },
      messages: {
        total: await Message.countDocuments(),
        today: await Message.countDocuments({
          sentAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }),
        thisWeek: await Message.countDocuments({
          sentAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        })
      }
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ [Chat Service] Stats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get stats',
      error: error.message
    });
  }
});

// Kiểm tra trạng thái các services
router.get('/services/health', authenticate, requireAdmin, async (req, res) => {
  try {
    const services = {
      frappe: await frappeService.healthCheck(),
      ticket: await ticketService.healthCheck(),
      notification: await notificationService.healthCheck()
    };

    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    console.error('❌ [Chat Service] Services health check error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Lấy danh sách users với phân trang
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const status = req.query.status;
    
    const query = {};
    
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      query.status = status;
    }

    const users = await User.find(query)
      .select('-metadata -__v')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('❌ [Chat Service] Get users error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message
    });
  }
});

// Lấy danh sách chats với phân trang
router.get('/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const isGroup = req.query.isGroup;
    
    const query = {};
    
    if (isGroup !== undefined) {
      query.isGroup = isGroup === 'true';
    }

    const chats = await Chat.find(query)
      .populate('participants', 'fullName email avatar')
      .populate('creator', 'fullName email avatar')
      .populate('lastMessage')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Chat.countDocuments(query);

    res.json({
      success: true,
      data: {
        chats,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('❌ [Chat Service] Get chats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get chats',
      error: error.message
    });
  }
});

// Xóa chat (soft delete)
router.delete('/chats/:chatId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Soft delete messages
    await Message.updateMany(
      { chat: chatId },
      { isDeleted: true, deletedAt: new Date() }
    );

    // Delete chat
    await Chat.findByIdAndDelete(chatId);

    res.json({
      success: true,
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    console.error('❌ [Chat Service] Delete chat error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete chat',
      error: error.message
    });
  }
});

// Cập nhật user status
router.patch('/users/:userId/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, inactive, or suspended'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { status, updatedAt: new Date() },
      { new: true }
    ).select('-metadata -__v');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User status updated',
      data: user
    });
  } catch (error) {
    console.error('❌ [Chat Service] Update user status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
});

// Webhook handler cho ticket events
router.post('/webhooks/ticket', async (req, res) => {
  try {
    const { eventType, data } = req.body;
    
    if (!eventType || !data) {
      return res.status(400).json({
        success: false,
        message: 'Missing eventType or data'
      });
    }

    console.log(`🎫 [Chat Service] Received ticket webhook: ${eventType}`);
    
    const result = await ticketService.handleTicketWebhook(eventType, data);
    
    // Xử lý tạo group chat cho ticket
    if (result && result.action === 'create_group_chat') {
      try {
        const chatData = result.data;
        const newChat = new Chat({
          name: chatData.name,
          description: chatData.description,
          isGroup: chatData.isGroup,
          creator: chatData.creator,
          participants: chatData.participants,
          settings: chatData.settings,
          metadata: chatData.metadata
        });

        const savedChat = await newChat.save();
        
        // Gửi notification cho participants
        try {
          await notificationService.sendGroupCreatedNotification(
            savedChat, 
            chatData.participants, 
            { _id: chatData.creator, fullName: 'System' }
          );
        } catch (notifError) {
          console.error('Failed to send group created notification:', notifError.message);
        }

        console.log(`✅ [Chat Service] Created group chat for ticket: ${savedChat._id}`);
        
        res.json({
          success: true,
          message: 'Group chat created successfully',
          data: {
            chatId: savedChat._id,
            ticketId: chatData.metadata?.ticketId
          }
        });
      } catch (chatError) {
        console.error('❌ [Chat Service] Error creating group chat:', chatError.message);
        res.status(500).json({
          success: false,
          message: 'Failed to create group chat',
          error: chatError.message
        });
      }
    } else {
      res.json({
        success: true,
        message: 'Webhook processed',
        data: result
      });
    }
  } catch (error) {
    console.error('❌ [Chat Service] Ticket webhook error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
      error: error.message
    });
  }
});

// API để tìm chat theo ticket ID
router.get('/chats/ticket/:ticketId', authenticate, async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    const chat = await Chat.findOne({ 
      'metadata.ticketId': ticketId 
    })
    .populate('participants', 'fullName email avatar')
    .populate('creator', 'fullName email avatar')
    .populate('lastMessage');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found for this ticket'
      });
    }

    res.json({
      success: true,
      data: chat
    });
  } catch (error) {
    console.error('❌ [Chat Service] Error finding chat by ticket ID:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to find chat',
      error: error.message
    });
  }
});

// API để search chats
router.get('/chats/search', authenticate, async (req, res) => {
  try {
    const { ticketId, ticketNumber, q } = req.query;
    const query = {};
    
    if (ticketId) {
      query['metadata.ticketId'] = ticketId;
    }
    
    if (ticketNumber) {
      query['metadata.ticketNumber'] = ticketNumber;
    }
    
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    const chats = await Chat.find(query)
      .populate('participants', 'fullName email avatar')
      .populate('creator', 'fullName email avatar')
      .populate('lastMessage')
      .sort({ updatedAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: chats
    });
  } catch (error) {
    console.error('❌ [Chat Service] Error searching chats:', error.message);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message
    });
  }
});

// Test notification
router.post('/test/notification', authenticate, requireAdmin, async (req, res) => {
  try {
    const { recipients, title, body } = req.body;
    
    await notificationService.sendBulkNotifications([{
      type: 'test',
      title: title || 'Test Notification',
      body: body || 'This is a test notification from Chat Service',
      recipients: recipients || [req.user._id],
      priority: 'normal'
    }]);

    res.json({
      success: true,
      message: 'Test notification sent'
    });
  } catch (error) {
    console.error('❌ [Chat Service] Test notification error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
});

module.exports = router;