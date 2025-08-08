const frappeService = require('../services/frappeService');
const User = require('../models/User');

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
      // Thử xác thực qua ERP endpoint trước (Bearer JWT)
      let frappeUser = null;
      try {
        frappeUser = await frappeService.validateERPToken(token);
      } catch (e) {
        // Fallback sang Frappe auth nếu ERP không hợp lệ
        frappeUser = await frappeService.authenticateUser(token);
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
        
        console.log(`🔐 [Chat Service] User authenticated: ${localUser.fullName} (${localUser.email})`);
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