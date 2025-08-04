const jwt = require('jsonwebtoken');
const database = require('../config/database');

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ 
          error: 'Invalid token',
          message: 'The provided token is invalid or expired'
        });
      }

      // Verify user exists in database
      try {
        const user = await database.get('User', decoded.id || decoded._id || decoded.name);
        
        if (!user || user.enabled !== 1) {
          return res.status(403).json({ 
            error: 'User not found or disabled',
            message: 'The user associated with this token is not active'
          });
        }

        req.user = {
          id: user.name,
          name: user.name,
          full_name: user.full_name,
          email: user.email,
          ...decoded
        };
        
        next();
      } catch (dbError) {
        console.error('Database error during authentication:', dbError);
        return res.status(500).json({ 
          error: 'Authentication error',
          message: 'Failed to verify user credentials'
        });
      }
    });

  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Authentication process failed'
    });
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return next(); // Continue without authentication
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (!err && decoded) {
        try {
          const user = await database.get('User', decoded.id || decoded._id || decoded.name);
          if (user && user.enabled === 1) {
            req.user = {
              id: user.name,
              name: user.name,
              full_name: user.full_name,
              email: user.email,
              ...decoded
            };
          }
        } catch (dbError) {
          console.error('Database error during optional authentication:', dbError);
        }
      }
      
      next();
    });

  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue without authentication
  }
};

// Check if user has specific role
const requireRole = (roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Authentication required',
          message: 'Please authenticate to access this resource'
        });
      }

      const userRoles = await database.getAll('Has Role', 
        { parent: req.user.id, parenttype: 'User' },
        ['role']
      );

      const userRoleNames = userRoles.map(r => r.role);
      const hasRequiredRole = roles.some(role => userRoleNames.includes(role));

      if (!hasRequiredRole) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: `Required roles: ${roles.join(', ')}`
        });
      }

      req.user.roles = userRoleNames;
      next();

    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to verify user roles'
      });
    }
  };
};

// Rate limiting middleware
const rateLimiter = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    if (requests.has(key)) {
      const userRequests = requests.get(key).filter(time => time > windowStart);
      requests.set(key, userRequests);
    }

    const userRequests = requests.get(key) || [];
    
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit: ${maxRequests} per ${windowMs / 1000} seconds`,
        retryAfter: Math.ceil((userRequests[0] - windowStart) / 1000)
      });
    }

    userRequests.push(now);
    requests.set(key, userRequests);
    
    next();
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  rateLimiter
};