const { body, param, query, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Request data is invalid',
      details: errors.array()
    });
  }
  next();
};

// Chat validation rules
const validateCreateChat = [
  body('participant_id')
    .notEmpty()
    .withMessage('Participant ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Participant ID must be between 1-100 characters'),
  
  body('current_user_id')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('User ID must be between 1-100 characters'),
    
  body('chat_name')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Chat name must be between 1-200 characters')
    .trim(),
    
  handleValidationErrors
];

// Message validation rules
const validateSendMessage = [
  body('chat_id')
    .notEmpty()
    .withMessage('Chat ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Chat ID must be between 1-100 characters'),
    
  body('content')
    .optional()
    .isLength({ max: 4000 })
    .withMessage('Message content must not exceed 4000 characters')
    .trim(),
    
  body('message_type')
    .optional()
    .isIn(['text', 'image', 'file', 'audio', 'video', 'emoji'])
    .withMessage('Invalid message type'),
    
  body('is_emoji')
    .optional()
    .isBoolean()
    .withMessage('is_emoji must be a boolean'),
    
  body('reply_to')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Reply to ID must be between 1-100 characters'),
    
  // Custom validation: content required for non-emoji messages
  body().custom((value, { req }) => {
    if (!req.body.is_emoji && (!req.body.content || !req.body.content.trim())) {
      throw new Error('Content is required for non-emoji messages');
    }
    return true;
  }),
    
  handleValidationErrors
];

// File upload validation
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded',
      message: 'Please select a file to upload'
    });
  }

  // Check file size (50MB limit)
  const maxSize = 50 * 1024 * 1024;
  if (req.file.size > maxSize) {
    return res.status(400).json({
      error: 'File too large',
      message: 'File size must not exceed 50MB'
    });
  }

  // Check file type
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'video/mp4', 'audio/mpeg', 'audio/wav'
  ];

  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'File type not allowed. Supported types: images, PDF, Word documents, text files, video, audio'
    });
  }

  next();
};

// Content filtering
const contentFilter = (req, res, next) => {
  if (req.body.content) {
    const content = req.body.content.trim();
    
    // Check for spam patterns
    const spamPatterns = [
      /(.)\1{10,}/gi, // Repeated characters
      /https?:\/\/[^\s]+/gi, // URLs (basic check)
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(content)) {
        return res.status(400).json({
          error: 'Content blocked',
          message: 'Message content contains prohibited patterns'
        });
      }
    }

    // Clean content
    req.body.content = content
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .trim();
  }
  
  next();
};

// Pagination validation
const validatePagination = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1-100')
    .toInt(),
    
  query('before_message')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Before message ID must be between 1-100 characters'),
    
  query('search')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2-100 characters')
    .trim(),
    
  handleValidationErrors
];

// Parameter validation
const validateChatId = [
  param('chat_id')
    .notEmpty()
    .withMessage('Chat ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Chat ID must be between 1-100 characters'),
    
  handleValidationErrors
];

const validateMessageId = [
  param('message_id')
    .notEmpty()
    .withMessage('Message ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Message ID must be between 1-100 characters'),
    
  handleValidationErrors
];

const validateUserId = [
  param('user_id')
    .notEmpty()
    .withMessage('User ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('User ID must be between 1-100 characters'),
    
  handleValidationErrors
];

// Message action validation
const validateMessageActions = [
  body('message_ids')
    .optional()
    .isArray()
    .withMessage('Message IDs must be an array'),
    
  body('message_ids.*')
    .isLength({ min: 1, max: 100 })
    .withMessage('Each message ID must be between 1-100 characters'),
    
  body('user_id')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('User ID must be between 1-100 characters'),
    
  handleValidationErrors
];

// Reaction validation
const validateReaction = [
  body('emoji')
    .notEmpty()
    .withMessage('Emoji is required')
    .isLength({ min: 1, max: 10 })
    .withMessage('Emoji must be between 1-10 characters')
    .trim(),
    
  handleValidationErrors
];

// Forward message validation
const validateForwardMessage = [
  body('message_id')
    .notEmpty()
    .withMessage('Message ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Message ID must be between 1-100 characters'),
    
  body('to_chat_id')
    .notEmpty()
    .withMessage('Target chat ID is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Target chat ID must be between 1-100 characters'),
    
  handleValidationErrors
];

// Edit message validation
const validateEditMessage = [
  body('content')
    .notEmpty()
    .withMessage('Content is required')
    .isLength({ min: 1, max: 4000 })
    .withMessage('Content must be between 1-4000 characters')
    .trim(),
    
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateCreateChat,
  validateSendMessage,
  validateFileUpload,
  contentFilter,
  validatePagination,
  validateChatId,
  validateMessageId,
  validateUserId,
  validateMessageActions,
  validateReaction,
  validateForwardMessage,
  validateEditMessage
};