const express = require('express');
const router = express.Router();

const User = require('../models/User');
const redisClient = require('../config/redis');
const frappeService = require('../services/frappeService');
const { authenticate } = require('../middleware/authMiddleware');

// Helper: normalize user cho mobile. Fallback các trường cho core User mới
const normalizeUser = (u) => ({
  _id: u._id,
  fullname: u.fullname || u.fullName || u.full_name || u.name || '',
  email: u.email || u.user_id || '',
  avatarUrl: u.avatarUrl || u.userImage || u.user_image || u.avatar || '',
  // Các trường sau có thể không còn trong core → để rỗng nếu không có
  department: u.department || u?.metadata?.department || '',
  designation: u.designation || u?.metadata?.designation || '',
});

// GET /api/users → list users
router.get('/', authenticate, async (req, res) => {
  try {
    // Prefer local DB for performance
    const users = await User.find({}, {
      fullname: 1, fullName: 1, email: 1, avatarUrl: 1, department: 1, designation: 1,
    }).limit(2000).lean();

    // If empty and Frappe sync enabled, try to sync from Frappe
    if ((!users || users.length === 0) && frappeService.enabled) {
      try {
        const frappeUsers = await frappeService.getAllUsers({
          filters: JSON.stringify([["enabled", "=", 1]])
        }, 2000);
        const mapped = [];
        for (const fu of frappeUsers) {
          const local = await User.updateFromFrappe(fu);
          mapped.push(local);
        }
        return res.json(mapped.map(normalizeUser));
      } catch (e) {
        // fallthrough
      }
    }

    return res.json(users.map(normalizeUser));
  } catch (error) {
    res.status(500).json({ message: 'Không thể lấy danh sách người dùng', error: error.message });
  }
});

// GET /api/users/search?query=... → search users by name/email
router.get('/search', authenticate, async (req, res) => {
  try {
    const query = (req.query.query || '').toString().trim();
    if (!query) return res.json([]);
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({ $or: [{ fullname: regex }, { fullName: regex }, { email: regex }] }, {
      fullname: 1, fullName: 1, email: 1, avatarUrl: 1, department: 1, designation: 1,
    }).limit(200).lean();
    return res.json(users.map(normalizeUser));
  } catch (error) {
    res.status(500).json({ message: 'Không thể tìm kiếm người dùng', error: error.message });
  }
});

// GET /api/users/department/:department → list users by department
router.get('/department/:department', authenticate, async (req, res) => {
  try {
    const department = req.params.department;
    const users = await User.find({ department }, {
      fullname: 1, fullName: 1, email: 1, avatarUrl: 1, department: 1, designation: 1,
    }).limit(1000).lean();
    return res.json(users.map(normalizeUser));
  } catch (error) {
    res.status(500).json({ message: 'Không thể lấy người dùng theo phòng ban', error: error.message });
  }
});

// GET /api/users/:id → get user detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    return res.json(normalizeUser(user));
  } catch (error) {
    res.status(500).json({ message: 'Không thể lấy thông tin người dùng', error: error.message });
  }
});

// Online status cache endpoints (Redis-backed)
// GET /api/users/online-status/:userId
router.get('/online-status/:userId', authenticate, async (req, res) => {
  try {
    const status = await redisClient.getUserOnlineStatus(req.params.userId);
    return res.json({
      isOnline: status?.status === 'online',
      lastSeen: status?.lastSeen || null,
    });
  } catch (error) {
    res.status(500).json({ message: 'Không thể lấy trạng thái online', error: error.message });
  }
});

// POST /api/users/online-status/:userId
router.post('/online-status/:userId', authenticate, async (req, res) => {
  try {
    const { isOnline, lastSeen } = req.body || {};
    if (isOnline) {
      await redisClient.setUserOnline(req.params.userId, 'manual');
    } else {
      await redisClient.setUserOffline(req.params.userId);
    }
    if (lastSeen) {
      await redisClient.hSet(`user:online:${req.params.userId}`, 'lastSeen', lastSeen);
    }
    return res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Không thể cập nhật trạng thái online', error: error.message });
  }
});

module.exports = router;


