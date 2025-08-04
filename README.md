# Chat Service

Microservice quản lý chat và messaging tương thích với Frappe Framework.

## Tính năng

- ✅ Tương thích hoàn toàn với Frappe API
- ✅ Kết nối MariaDB (production database)
- ✅ Redis caching và real-time updates
- ✅ Socket.IO cho real-time messaging
- ✅ JWT Authentication
- ✅ File upload và attachments
- ✅ Message reactions và emoji
- ✅ Message editing và deletion
- ✅ Message forwarding và replies
- ✅ Typing indicators
- ✅ Read receipts
- ✅ Message search và filtering
- ✅ Rate limiting và spam protection
- ✅ Message retention và cleanup

## Cài đặt

```bash
cd chat-service
npm install
```

## Cấu hình

Sao chép và chỉnh sửa file `config.env`:

```bash
cp config.env.example config.env
```

Cấu hình các thông số:

- Database: MariaDB connection
- Redis: Valkey connection
- JWT Secret
- CORS origins
- File upload settings

## Chạy service

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Chat Management

- `POST /api/chats/create-or-get` - Tạo hoặc lấy chat giữa users
- `GET /api/chats/user/:user_id` - Lấy danh sách chat của user
- `GET /api/chats/:chat_id` - Lấy thông tin chat
- `PUT /api/chats/:chat_id` - Cập nhật thông tin chat
- `DELETE /api/chats/:chat_id` - Xóa chat

### Message Management

- `POST /api/messages/send` - Gửi tin nhắn
- `GET /api/messages/chat/:chat_id` - Lấy tin nhắn trong chat
- `PUT /api/messages/:message_id` - Chỉnh sửa tin nhắn
- `DELETE /api/messages/:message_id` - Xóa tin nhắn
- `POST /api/messages/:message_id/reply` - Trả lời tin nhắn
- `POST /api/messages/:message_id/forward` - Chuyển tiếp tin nhắn

### Message Actions

- `POST /api/messages/:message_id/reactions` - Thêm/xóa reaction
- `GET /api/messages/:message_id/reactions` - Lấy reactions
- `POST /api/messages/:message_id/pin` - Ghim/bỏ ghim tin nhắn
- `GET /api/messages/chat/:chat_id/pinned` - Lấy tin nhắn đã ghim

### File Upload

- `POST /api/messages/upload` - Upload file attachment
- `GET /api/messages/attachments/:attachment_id/download` - Download file

### Search

- `GET /api/messages/search` - Tìm kiếm tin nhắn
- `GET /api/chats/search` - Tìm kiếm chat

### Frappe Compatible API

- `POST /api/method/erp.chat.doctype.erp_chat.erp_chat.create_or_get_chat`
- `GET /api/resource/ERP%20Chat` - Lấy danh sách chats
- `GET /api/resource/ERP%20Chat/:name` - Lấy chat cụ thể
- `POST /api/resource/ERP%20Chat` - Tạo chat mới
- `PUT /api/resource/ERP%20Chat/:name` - Cập nhật chat
- `DELETE /api/resource/ERP%20Chat/:name` - Xóa chat

## Socket.IO Events

### Client to Server

- `join_chat` - Tham gia chat room
- `leave_chat` - Rời chat room
- `send_message` - Gửi tin nhắn
- `typing_start` - Bắt đầu gõ
- `typing_stop` - Dừng gõ
- `mark_messages_read` - Đánh dấu đã đọc

### Server to Client

- `chat_joined` - Đã tham gia chat
- `chat_left` - Đã rời chat
- `new_message` - Tin nhắn mới
- `message_sent` - Xác nhận gửi tin nhắn
- `message_edited` - Tin nhắn đã chỉnh sửa
- `message_deleted` - Tin nhắn đã xóa
- `message_reaction` - Reaction cho tin nhắn
- `message_pinned` - Tin nhắn đã ghim
- `user_typing` - User đang gõ
- `user_stopped_typing` - User dừng gõ
- `messages_read` - Tin nhắn đã đọc
- `user_online` - User online
- `user_offline` - User offline

## Cấu trúc Database

Service sử dụng các DocTypes:

### ERP Chat
- `name` - ID chat (required)
- `chat_name` - Tên chat
- `participants` - Danh sách participants (JSON)
- `chat_type` - Loại chat (direct/group)
- `is_group` - Có phải group chat không
- `creator` - Người tạo chat
- `last_message` - Tin nhắn cuối cùng
- `message_count` - Số lượng tin nhắn
- `archived` - Trạng thái archived

### ERP Chat Message
- `name` - ID tin nhắn (required)
- `chat` - ID chat (required)
- `sender` - ID người gửi (required)
- `message` - Nội dung tin nhắn
- `message_type` - Loại tin nhắn (text/image/file/audio/video/emoji)
- `reply_to` - ID tin nhắn trả lời
- `attachments` - File attachments (JSON)
- `sent_at` - Thời gian gửi
- `read_by` - Danh sách đã đọc (JSON)
- `is_edited` - Đã chỉnh sửa chưa
- `is_deleted` - Đã xóa chưa
- `is_pinned` - Đã ghim chưa

### ERP Chat Attachment
- `name` - ID attachment
- `chat` - ID chat
- `message` - ID tin nhắn
- `file_name` - Tên file
- `file_path` - Đường dẫn file
- `file_size` - Kích thước file
- `mime_type` - Loại file
- `uploaded_by` - Người upload

### ERP Message Reaction
- `name` - ID reaction
- `message` - ID tin nhắn
- `user` - ID user
- `emoji` - Emoji reaction

## Caching Strategy

- Redis cache cho chat data (TTL: 1 hour)
- Redis cache cho user chats (TTL: 30 minutes)
- Redis cache cho chat messages (TTL: 15 minutes)
- Real-time user status tracking
- Typing indicators với timeout
- Message delivery tracking

## Security Features

- JWT Authentication
- Rate limiting (100 requests/15 minutes)
- Content filtering và spam protection
- File upload validation
- Message sanitization
- Access control cho chat và messages

## Health Check

```bash
curl http://localhost:5005/health
```

## Logs

Service ghi logs chi tiết cho:

- Database connections
- Redis operations
- Socket.IO events
- Message processing
- File uploads
- Authentication
- Errors và warnings

## Docker Support (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 5005
CMD ["npm", "start"]
``` 