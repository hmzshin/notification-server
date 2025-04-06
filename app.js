import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import mysql from "mysql2/promise";
import helmet from "helmet";
import cors from "cors";
// Remove this import
// import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import config from "./config.js";

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.cors.origins,
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

// Custom HTTP rate limiter implementation (instead of express-rate-limit)
const httpLimits = new Map();

const httpRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const windowMs = config.rateLimiting.http.window * 60 * 1000;
  const maxRequests = config.rateLimiting.http.max;
  const now = Date.now();

  if (!httpLimits.has(ip)) {
    httpLimits.set(ip, {
      count: 1,
      resetTime: now + windowMs,
    });
    return next();
  }

  const userLimit = httpLimits.get(ip);

  // Reset counter if time window has passed
  if (now > userLimit.resetTime) {
    userLimit.count = 1;
    userLimit.resetTime = now + windowMs;
    return next();
  }

  // Check if over limit
  if (userLimit.count >= maxRequests) {
    return res.status(429).json({
      error: "Too many requests, please try again later",
      retryAfter: Math.ceil((userLimit.resetTime - now) / 1000),
    });
  }

  // Increment counter and continue
  userLimit.count++;
  next();
};

// Apply custom HTTP rate limiter to API routes
app.use("/api/", httpRateLimiter);

// Create MySQL connection pool
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.poolLimit,
  queueLimit: 0,
  namedPlaceholders: true,
});

// Initialize Socket.IO with Redis adapter
const io = new Server(server, {
  cors: {
    origin: config.cors.origins,
    methods: ["GET", "POST"],
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// Redis setup for scaling
if (config.redis.url) {
  const pubClient = createClient({ url: config.redis.url });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      config.logger.info("Redis adapter connected");
    })
    .catch((err) => {
      config.logger.error("Redis connection error:", err);
    });
}

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (err) return next(new Error("Authentication failed"));
    socket.user = decoded;
    next();
  });
});

// Simple in-memory rate limiter for Socket.IO
const socketRateLimits = new Map();

// Custom Socket.IO rate limiting middleware
io.use((socket, next) => {
  const userId = socket.handshake.auth?.userId || socket.id;

  if (!socketRateLimits.has(userId)) {
    socketRateLimits.set(userId, {
      timestamp: Date.now(),
      count: 1,
    });
    return next();
  }

  const currentTime = Date.now();
  const userLimit = socketRateLimits.get(userId);
  const timeWindow = config.rateLimiting.socket.duration * 1000; // Convert to milliseconds
  const limit = config.rateLimiting.socket.points;

  // Reset if outside time window
  if (currentTime - userLimit.timestamp > timeWindow) {
    socketRateLimits.set(userId, {
      timestamp: currentTime,
      count: 1,
    });
    return next();
  }

  // Check if over limit
  if (userLimit.count >= limit) {
    return next(new Error("Too many requests, please try again later"));
  }

  // Increment count
  userLimit.count += 1;
  next();
});

// Socket.IO connection handler
io.on("connection", async (socket) => {
  config.logger.info(`User ${socket.user.id} connected`);
  socket.join(`user_${socket.user.id}`);

  // Deliver undelivered notifications
  try {
    const [undelivered] = await pool.query(
      `SELECT * FROM notifications 
       WHERE recipient_id = ? AND delivered_at IS NULL`,
      [socket.user.id]
    );

    undelivered.forEach((notification) => {
      socket.emit("new_notification", notification);
      pool.query(
        `UPDATE notifications SET delivered_at = NOW() 
         WHERE id = ?`,
        [notification.id]
      );
    });
  } catch (err) {
    config.logger.error("Notification delivery error:", err);
  }

  // Notification event
  socket.on("send_notification", async (data, callback) => {
    try {
      const { recipientId, message } = data;

      // Validate input
      if (!recipientId || !message) {
        return callback({ error: "Missing required fields" });
      }

      // Emit to recipient
      io.to(`user_${recipientId}`).emit("new_notification", {
        message,
        senderId: socket.user.id,
        timestamp: new Date(),
      });

      // Store in database
      await pool.query(
        `INSERT INTO notifications 
         (sender_id, recipient_id, message, socket_id) 
         VALUES (?, ?, ?, ?)`,
        [socket.user.id, recipientId, message, socket.id]
      );

      callback({ success: true });
    } catch (err) {
      config.logger.error("Notification error:", err);
      callback({ error: "Internal server error" });
    }
  });

  // Disconnect handler
  socket.on("disconnect", async () => {
    config.logger.info(`User ${socket.user.id} disconnected`);
    try {
      await pool.query(
        `UPDATE connection_logs 
         SET disconnected_at = NOW() 
         WHERE socket_id = ?`,
        [socket.id]
      );

      // Clean up rate limit data
      socketRateLimits.delete(socket.user.id);
    } catch (err) {
      config.logger.error("Disconnection logging error:", err);
    }
  });
});

// Webhook endpoint for server-to-server notifications
app.post(
  "/webhook/notify",
  [
    body("recipientId").isAlphanumeric().isLength({ min: 8, max: 64 }),
    body("message").isString().trim().isLength({ max: 500 }),
    body("apiKey").equals(process.env.WEBHOOK_API_KEY),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { recipientId, message } = req.body;

      io.to(`user_${recipientId}`).emit("new_notification", {
        message,
        senderId: "system",
        timestamp: new Date(),
      });

      await pool.query(
        `INSERT INTO notifications 
       (sender_id, recipient_id, message) 
       VALUES (?, ?, ?)`,
        ["system", recipientId, message]
      );

      res.status(200).json({ success: true });
    } catch (err) {
      config.logger.error("Webhook error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  config.logger.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
server.listen(config.port, () => {
  config.logger.info(
    `Server running in ${config.env} mode on port ${config.port}`
  );
});

// Handle shutdown gracefully
process.on("SIGTERM", async () => {
  config.logger.info("SIGTERM received. Shutting down gracefully");
  server.close(async () => {
    await pool.end();
    config.logger.info("Server closed");
    process.exit(0);
  });
});
