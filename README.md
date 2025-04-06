# Socket.IO Notification Server

A secure, scalable notification server built with Socket.IO, Express.js, MySQL, and Redis.

## Overview

This project implements a real-time notification system with the following features:

- **Real-time notifications** via Socket.IO
- **Persistent storage** of notifications in MySQL
- **Horizontal scaling** capability through Redis adapter
- **Authentication** using JWT tokens
- **Rate limiting** for both HTTP and Socket.IO connections
- **Security enhancements** with helmet, CORS, and input validation

## Prerequisites

- Node.js ≥ 18.0.0
- MySQL database
- Redis server (optional, for scaling)

## Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/notification-server.git
cd notification-server
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
# Server
NODE_ENV=development
PORT=3000
SERVER_URL=http://localhost:3000

# Authentication
JWT_SECRET=your-secure-jwt-secret
JWT_EXPIRES_IN=30d

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=yourusername
DB_PASSWORD=yourpassword
DB_NAME=notification_db
DB_POOL_LIMIT=10

# Redis (optional, for scaling)
REDIS_URL=redis://localhost:6379

# Rate Limiting
HTTP_RATE_LIMIT_WINDOW=15
HTTP_RATE_LIMIT_MAX=100
SOCKET_RATE_LIMIT_POINTS=10
SOCKET_RATE_LIMIT_DURATION=60

# CORS
ALLOWED_ORIGINS=http://localhost:8080,https://yourapp.com

# Webhook
WEBHOOK_API_KEY=your-secure-api-key
```

4. Run database migrations
```bash
npm run migrate
```

## Usage

### Starting the server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### Client connection example

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: {
    token: "your-jwt-token"
  }
});

// Listen for new notifications
socket.on("new_notification", (notification) => {
  console.log("New notification:", notification);
});

// Send a notification
socket.emit("send_notification", {
  recipientId: "user-123",
  message: "Hello, this is a test notification!"
}, (response) => {
  if (response.success) {
    console.log("Notification sent successfully");
  } else {
    console.error("Failed to send notification:", response.error);
  }
});
```

### Server-to-server notifications

You can send notifications from other servers using the webhook endpoint:

```bash
curl -X POST http://localhost:3000/webhook/notify \
  -H "Content-Type: application/json" \
  -d '{
    "recipientId": "user-123",
    "message": "System notification",
    "apiKey": "your-webhook-api-key"
  }'
```

## Architecture

- **Express.js** - HTTP server and API endpoints
- **Socket.IO** - Real-time bidirectional event-based communication
- **MySQL** - Persistent storage for notifications and connection logs
- **Redis** - Adapter for Socket.IO to enable horizontal scaling
- **JWT** - Authentication for both HTTP and WebSocket connections
- **Custom rate limiting** - Protection against abuse for both HTTP and WebSocket connections

## API Endpoints

- `POST /webhook/notify` - Send notifications from server to clients
- `GET /health` - Health check endpoint

## Security Features

- JWT authentication for Socket.IO connections
- Rate limiting for both HTTP and Socket.IO connections
- Helmet middleware for HTTP security headers
- CORS configuration for controlled origin access
- Input validation for all data entry points
- Secure environment configuration validation

## Testing

Run tests with:
```bash
npm test
```

## Database Schema

The database includes the following main tables:

- `notifications` - Stores all notifications with delivery status
- `connection_logs` - Tracks socket connections and disconnections

## License

Apache License 2.0

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request