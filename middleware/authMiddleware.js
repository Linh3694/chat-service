const frappeService = require('../services/frappeService');
const User = require('../models/User');
const lastAuthLogByUser = new Map(); // userId/email -> timestamp
const AUTH_LOG_INTERVAL_MS = parseInt(process.env.AUTH_LOG_INTERVAL_MS || '60000', 10);

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('X-Frappe-CSRF-Token');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.',
        code: 'MISSING_TOKEN'
      });
    }

    try {
      // Ưu tiên xác thực chuẩn qua Frappe trước (Bearer token do client gửi)
      let frappeUser = null;
      try {
        frappeUser = await frappeService.authenticateUser(token);
      } catch (e1) {
        // Fallback: thử ERP custom endpoint
        try {
          frappeUser = await frappeService.validateERPToken(token);
        } catch (e2) {
          frappeUser = null;
        }
      }
      
      if (frappeUser) {
        // Tạo hoặc cập nhật user trong local database
        const localUser = await User.updateFromFrappe(frappeUser);
        
        // Map user data for request
        req.user = {
          _id: localUser._id,
          id: localUser._id,
          frappeUserId: localUser.frappeUserId,
          name: localUser.name,
          fullname: localUser.fullName,
          full_name: localUser.fullName,
          email: localUser.email,
          role: localUser.role,
          roles: localUser.roles,
          status: localUser.status,
          avatar: localUser.avatar,
          avatarUrl: localUser.avatar || '',
          department: localUser.metadata?.department || '',
          designation: localUser.metadata?.designation || '',
          phone: localUser.metadata?.phone || '',
          mobile_no: localUser.metadata?.mobile_no || '',
          isActive: localUser.status === 'active',
          token: token
        };
        
        // Throttle auth log to avoid spam
        try {
          const key = localUser.email || localUser._id?.toString() || 'unknown';
          const now = Date.now();
          const last = lastAuthLogByUser.get(key) || 0;
          if (process.env.AUTH_VERBOSE === 'true' || now - last > AUTH_LOG_INTERVAL_MS) {
            console.log(`🔐 [Chat Service] User authenticated: ${localUser.fullName} (${localUser.email})`);
            lastAuthLogByUser.set(key, now);
          }
        } catch (_) {}
        next();
      } else {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid token or user not found.',
          code: 'INVALID_TOKEN'
        });
      }
      
    } catch (frappeError) {
      console.error('❌ [Chat Service] Authentication error:', frappeError.message);
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication failed.',
        code: 'AUTHENTICATION_FAILED',
        details: frappeError.message
      });
    }

  } catch (error) {
    console.error('❌ [Chat Service] Authentication middleware error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error during authentication.',
      code: 'AUTH_INTERNAL_ERROR'
    });
  }
};

// Alternative authentication using API key
const authenticateWithAPIKey = async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    const apiSecret = req.header('X-API-Secret');
    
    if (!apiKey || !apiSecret) {
      return res.status(401).json({ 
        success: false, 
        message: 'API key and secret required.' 
      });
    }

    // Validate API key with Frappe
    const response = await axios.post(`${FRAPPE_API_URL}/api/method/frappe.auth.validate_api_key_secret`, {
      api_key: apiKey,
      api_secret: apiSecret
    });

    if (response.data && response.data.message) {
      req.user = {
        _id: response.data.message.user,
        id: response.data.message.user,
        fullname: response.data.message.full_name || response.data.message.user,
        full_name: response.data.message.full_name || response.data.message.user,
        email: response.data.message.email,
        role: response.data.message.role || 'user',
        avatarUrl: response.data.message.user_image || '',
        department: response.data.message.department || '',
        phone: response.data.message.phone || '',
        isActive: true
      };
      
      next();
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid API credentials.' 
      });
    }
  } catch (error) {
    console.error('API key authentication error:', error.response?.data || error.message);
    res.status(401).json({ 
      success: false, 
      message: 'API authentication failed.' 
    });
  }
};

module.exports = { authenticate, authenticateWithAPIKey };

// Service-to-service auth or user auth (prefer user if Authorization is present)
const authenticateServiceOrUser = async (req, res, next) => {
  try {
    // If client provides a user Authorization token, prefer authenticating the real user.
    // This ensures created chats include the correct participant (current user) IDs
    // so mobile ChatScreen can see newly created groups.
    const hasUserAuth = !!(req.header('Authorization') || req.header('X-Frappe-CSRF-Token'));
    if (hasUserAuth) {
      return authenticate(req, res, next);
    }

    // Otherwise accept trusted service-to-service calls
    const svcToken = req.header('X-Service-Token') || req.header('X-Internal-Token');
    const expected = process.env.CHAT_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (svcToken && expected && svcToken === expected) {
      const impersonateId = req.header('X-Impersonate-User');
      req.user = {
        _id: impersonateId || 'system',
        id: impersonateId || 'system',
        fullname: 'ticket-service',
        email: 'system@ticket-service',
        role: 'system',
        roles: ['system'],
        isService: true,
      };
      return next();
    }

    return res.status(401).json({ success: false, message: 'Authentication required' });
  } catch (error) {
    console.error('❌ [Chat Service] Service auth error:', error.message);
    return res.status(401).json({ success: false, message: 'Service authentication failed' });
  }
};

module.exports.authenticateServiceOrUser = authenticateServiceOrUser;