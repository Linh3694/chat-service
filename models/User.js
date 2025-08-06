const mongoose = require('mongoose');

// User model cho chat service - chỉ lưu thông tin cần thiết từ Frappe
const userSchema = new mongoose.Schema({
  // ID từ Frappe hoặc backend chính
  frappeUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Thông tin cơ bản
  name: {
    type: String,
    required: true,
    trim: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  
  // Thông tin hiển thị
  avatar: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  
  // Role từ Frappe
  role: {
    type: String,
    default: 'user'
  },
  roles: [String],
  
  // Chat settings
  chatSettings: {
    allowDirectMessages: {
      type: Boolean,
      default: true
    },
    readReceipts: {
      type: Boolean,
      default: true
    },
    onlineStatus: {
      type: Boolean,
      default: true
    },
    soundNotifications: {
      type: Boolean,
      default: true
    }
  },
  
  // Thông tin online
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketId: String,
  
  // Thông tin đồng bộ
  lastSyncedAt: {
    type: Date,
    default: Date.now
  },
  syncVersion: {
    type: Number,
    default: 1
  },
  
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
userSchema.index({ frappeUserId: 1 }, { unique: true });
userSchema.index({ email: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ status: 1 });

// Static methods
userSchema.statics.findByFrappeId = function(frappeUserId) {
  return this.findOne({ frappeUserId });
};

userSchema.statics.findOnlineUsers = function() {
  return this.find({ isOnline: true, status: 'active' });
};

userSchema.statics.updateFromFrappe = function(frappeUserData) {
  const frappeUserId = frappeUserData.name || frappeUserData.id;
  
  return this.findOneAndUpdate(
    { frappeUserId },
    {
      name: frappeUserData.name,
      fullName: frappeUserData.full_name || frappeUserData.fullName,
      email: frappeUserData.email,
      avatar: frappeUserData.user_image || frappeUserData.avatar,
      role: frappeUserData.role,
      roles: frappeUserData.roles || [],
      status: frappeUserData.enabled === 0 ? 'inactive' : 'active',
      lastSyncedAt: new Date(),
      metadata: {
        department: frappeUserData.department,
        designation: frappeUserData.designation,
        mobile_no: frappeUserData.mobile_no,
        phone: frappeUserData.phone
      }
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

// Instance methods
userSchema.methods.setOnline = function(socketId = null) {
  this.isOnline = true;
  this.lastSeen = new Date();
  if (socketId) this.socketId = socketId;
  return this.save();
};

userSchema.methods.setOffline = function() {
  this.isOnline = false;
  this.lastSeen = new Date();
  this.socketId = null;
  return this.save();
};

userSchema.methods.canChatWith = function(otherUserId) {
  // Logic kiểm tra quyền chat
  if (this.status !== 'active') return false;
  if (!this.chatSettings.allowDirectMessages) return false;
  return true;
};

module.exports = mongoose.model('User', userSchema);