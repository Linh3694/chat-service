const axios = require('axios');
const User = require('../models/User');
require('dotenv').config({ path: './config.env' });

class FrappeService {
  constructor() {
    this.baseURL = process.env.FRAPPE_API_URL || 'http://172.16.20.130:8000';
    this.apiKey = process.env.FRAPPE_API_KEY;
    this.apiSecret = process.env.FRAPPE_API_SECRET;
    this.enabled = process.env.ENABLE_FRAPPE_SYNC === 'true';
    this.authCache = new Map(); // token -> { user, exp }
    this.cacheTtlMs = parseInt(process.env.FRAPPE_AUTH_CACHE_TTL_MS || '60000', 10); // default 60s
    
    // Axios instance với cấu hình mặc định
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
    // Request interceptor để thêm auth headers
    this.api.interceptors.request.use(
      (config) => {
        // Chỉ gắn API Key nếu request KHÔNG đặt sẵn Authorization (ví dụ Bearer từ mobile)
        const headers = config.headers || {};
        const hasAuthHeader = !!(headers['Authorization'] || headers['authorization']);
        if (!hasAuthHeader && this.apiKey && this.apiSecret) {
          headers['Authorization'] = `token ${this.apiKey}:${this.apiSecret}`;
        }
        config.headers = headers;
        
        console.log(`🔗 [Frappe Service] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ [Frappe Service] Request error:', error.message);
        return Promise.reject(error);
      }
    );

    // Response interceptor để xử lý lỗi
    this.api.interceptors.response.use(
      (response) => {
        console.log(`✅ [Frappe Service] Response ${response.status} from ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error(`❌ [Frappe Service] Response error:`, {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Lấy thông tin user từ Frappe
  async getUser(userId) {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      const response = await this.api.get(`/api/resource/User/${userId}`);
      
      if (response.data && response.data.data) {
        return response.data.data;
      }
      
      throw new Error('Invalid response format from Frappe');
    } catch (error) {
      console.error(`❌ [Frappe Service] Failed to get user ${userId}:`, error.message);
      throw error;
    }
  }

  // Lấy danh sách tất cả users
  async getAllUsers(filters = {}, limit = 1000) {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      const params = {
        limit_page_length: limit,
        fields: JSON.stringify([
          'name', 'full_name', 'email', 'user_image', 
          'enabled', 'role', 'department', 'designation',
          'mobile_no', 'phone', 'creation', 'modified'
        ]),
        ...filters
      };

      const response = await this.api.get('/api/resource/User', { params });
      
      if (response.data && response.data.data) {
        return response.data.data;
      }
      
      return [];
    } catch (error) {
      console.error('❌ [Frappe Service] Failed to get all users:', error.message);
      throw error;
    }
  }

  // Xác thực user bằng token
  async authenticateUser(token) {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      // Token cache
      const cached = this._getCachedUser(token);
      if (cached) return cached;

      // Lấy thông tin user hiện tại bằng token
      const response = await this.api.get('/api/method/frappe.auth.get_logged_user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      });

      if (response.data && response.data.message) {
        const userId = response.data.message;
        
        // Lấy thông tin chi tiết của user
        const userResponse = await this.api.get(`/api/resource/User/${userId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Frappe-CSRF-Token': token
          }
        });

        if (userResponse.data && userResponse.data.data) {
          const user = userResponse.data.data;
          this._setCachedUser(token, user);
          return user;
        }
      }
      
      throw new Error('Authentication failed');
    } catch (error) {
      console.error('❌ [Frappe Service] Authentication failed:', error.message);
      throw error;
    }
  }

  // Xác thực token qua ERP custom endpoint (Bearer JWT)
  async validateERPToken(token) {
    try {
      // Token cache
      const cached = this._getCachedUser(token);
      if (cached) return cached;

      const response = await this.api.get('/api/method/erp.api.erp_common_user.auth.get_current_user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Frappe-CSRF-Token': token
        }
      });
      if (response.data && response.data.status === 'success' && response.data.user) {
        const user = response.data.user;
        this._setCachedUser(token, user);
        return user;
      }
      throw new Error('ERP token validation failed');
    } catch (error) {
      console.error('❌ [Frappe Service] ERP token validation failed:', error.message);
      throw error;
    }
  }

  _getCachedUser(token) {
    try {
      const entry = this.authCache.get(token);
      if (!entry) return null;
      if (Date.now() < entry.exp) return entry.user;
      this.authCache.delete(token);
      return null;
    } catch (_) {
      return null;
    }
  }

  _setCachedUser(token, user) {
    try {
      const ttl = Number.isFinite(this.cacheTtlMs) ? this.cacheTtlMs : 60000;
      this.authCache.set(token, { user, exp: Date.now() + ttl });
    } catch (_) {}
  }

  // Đồng bộ user từ Frappe vào local database
  async syncUser(frappeUserId) {
    try {
      const frappeUser = await this.getUser(frappeUserId);
      const localUser = await User.updateFromFrappe(frappeUser);
      
      console.log(`✅ [Frappe Service] Synced user: ${frappeUser.full_name}`);
      return localUser;
    } catch (error) {
      console.error(`❌ [Frappe Service] Failed to sync user ${frappeUserId}:`, error.message);
      throw error;
    }
  }

  // Đồng bộ tất cả users
  async syncAllUsers() {
    try {
      console.log('🔄 [Frappe Service] Starting full user sync...');
      
      const frappeUsers = await this.getAllUsers({
        filters: JSON.stringify([['enabled', '=', 1]]) // Chỉ lấy users đang active
      });

      const syncResults = [];
      let successCount = 0;
      let errorCount = 0;

      for (const frappeUser of frappeUsers) {
        try {
          const localUser = await User.updateFromFrappe(frappeUser);
          syncResults.push({ 
            success: true, 
            user: frappeUser.name,
            localId: localUser._id 
          });
          successCount++;
        } catch (error) {
          console.error(`❌ [Frappe Service] Failed to sync user ${frappeUser.name}:`, error.message);
          syncResults.push({ 
            success: false, 
            user: frappeUser.name, 
            error: error.message 
          });
          errorCount++;
        }
      }

      console.log(`✅ [Frappe Service] User sync completed: ${successCount} success, ${errorCount} errors`);
      
      return {
        totalUsers: frappeUsers.length,
        successCount,
        errorCount,
        results: syncResults
      };
    } catch (error) {
      console.error('❌ [Frappe Service] Full user sync failed:', error.message);
      throw error;
    }
  }

  // Tạo hoặc cập nhật document trong Frappe
  async createDocument(doctype, data) {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      const response = await this.api.post(`/api/resource/${doctype}`, data);
      
      if (response.data && response.data.data) {
        return response.data.data;
      }
      
      throw new Error('Failed to create document');
    } catch (error) {
      console.error(`❌ [Frappe Service] Failed to create ${doctype}:`, error.message);
      throw error;
    }
  }

  // Cập nhật document trong Frappe
  async updateDocument(doctype, name, data) {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      const response = await this.api.put(`/api/resource/${doctype}/${name}`, data);
      
      if (response.data && response.data.data) {
        return response.data.data;
      }
      
      throw new Error('Failed to update document');
    } catch (error) {
      console.error(`❌ [Frappe Service] Failed to update ${doctype} ${name}:`, error.message);
      throw error;
    }
  }

  // Kiểm tra kết nối đến Frappe
  async healthCheck() {
    try {
      if (!this.enabled) {
        return { status: 'disabled', message: 'Frappe sync is disabled' };
      }

      const response = await this.api.get('/api/method/ping');
      
      if (response.status === 200) {
        return { 
          status: 'connected', 
          message: 'Frappe API is reachable',
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

  // Lấy thông tin về Frappe site
  async getSiteInfo() {
    try {
      if (!this.enabled) {
        throw new Error('Frappe sync is disabled');
      }

      const response = await this.api.get('/api/method/frappe.utils.get_site_info');
      return response.data;
    } catch (error) {
      console.error('❌ [Frappe Service] Failed to get site info:', error.message);
      throw error;
    }
  }
}

module.exports = new FrappeService();