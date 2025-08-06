const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    // Thêm các field cho group chat
    name: {
      type: String,
      trim: true,
      maxlength: 100
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500
    },
    isGroup: {
      type: Boolean,
      default: false
    },
    avatar: {
      type: String,
      trim: true
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function() {
        return this.isGroup === true;
      }
    },
    admins: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    pinnedMessages: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    }],
    
    // Group settings
    settings: {
      allowMembersToAdd: {
        type: Boolean,
        default: true
      },
      allowMembersToEdit: {
        type: Boolean,
        default: false
      },
      muteNotifications: {
        type: Boolean,
        default: false
      }
    },
    
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

chatSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  
  // Tự động thêm creator vào admins nếu là group chat
  if (this.isGroup && this.creator && !this.admins.includes(this.creator)) {
    this.admins.push(this.creator);
  }
  
  next();
});

// Thêm indexes để tối ưu performance
chatSchema.index({ participants: 1 }); // Tìm chat theo participants
chatSchema.index({ participants: 1, lastMessage: 1 }); // Lấy chat có tin nhắn
chatSchema.index({ updatedAt: -1 }); // Sắp xếp theo thời gian cập nhật
chatSchema.index({ "participants": 1, "updatedAt": -1 }); // Compound index cho getUserChats
chatSchema.index({ isGroup: 1 }); // Lọc theo loại chat
chatSchema.index({ creator: 1 }); // Tìm group theo creator
chatSchema.index({ admins: 1 }); // Tìm group theo admin
chatSchema.index({ name: 'text' }); // Text search cho tên group

module.exports = mongoose.model("Chat", chatSchema);