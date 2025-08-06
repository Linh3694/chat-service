const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    content: {
      type: String,
      required: true
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file', 'audio', 'video', 'emoji', 'system'],
      default: 'text'
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    
    // File attachments
    attachments: [{
      filename: String,
      originalName: String,
      mimetype: String,
      size: Number,
      url: String
    }],
    
    // Emoji support
    isEmoji: {
      type: Boolean,
      default: false
    },
    emojiId: String,
    emojiType: String,
    emojiName: String,
    emojiUrl: String,
    
    // Message status
    deliveryStatus: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent'
    },
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    // Message moderation
    isEdited: {
      type: Boolean,
      default: false
    },
    editedAt: Date,
    originalContent: String,
    
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: Date,
    deletedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    
    isPinned: {
      type: Boolean,
      default: false
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    pinnedAt: Date,
    
    // Forwarding
    isForwarded: {
      type: Boolean,
      default: false
    },
    originalMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    originalSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    // Search and metadata
    searchKeywords: [String],
    metadata: mongoose.Schema.Types.Mixed,
    
    sentAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Indexes for performance
messageSchema.index({ chat: 1, sentAt: -1 }); // Messages in chat by time
messageSchema.index({ sender: 1 }); // Messages by sender
messageSchema.index({ replyTo: 1 }); // Reply messages
messageSchema.index({ deliveryStatus: 1 }); // Delivery status
messageSchema.index({ isDeleted: 1 }); // Non-deleted messages
messageSchema.index({ isPinned: 1 }); // Pinned messages
messageSchema.index({ sentAt: -1 }); // Recent messages
messageSchema.index({ chat: 1, messageType: 1 }); // Messages by type in chat

// Text search index
messageSchema.index({ content: 'text', searchKeywords: 'text' });

// Pre-save middleware
messageSchema.pre('save', function(next) {
  if (this.isNew && this.sender) {
    // Add sender to readBy automatically
    this.readBy.push({
      user: this.sender,
      readAt: this.sentAt || new Date()
    });
  }
  next();
});

module.exports = mongoose.model("Message", messageSchema);