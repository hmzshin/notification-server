import dotenv from "dotenv";
import { createLogger, format, transports } from "winston";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const config = {
  env: process.env.NODE_ENV || "development",
  port: process.env.PORT || 3000,
  serverUrl: process.env.SERVER_URL,

  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key-for-development",
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  },

  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "notification_db",
    poolLimit: parseInt(process.env.DB_POOL_LIMIT) || 10,
    timezone: "Z",
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  rateLimiting: {
    socket: {
      // For our custom in-memory rate limiter
      points: parseInt(process.env.SOCKET_RATE_LIMIT_POINTS) || 10,
      duration: parseInt(process.env.SOCKET_RATE_LIMIT_DURATION) || 60, // seconds
    },
    http: {
      window: parseInt(process.env.HTTP_RATE_LIMIT_WINDOW) || 15, // minutes
      max: parseInt(process.env.HTTP_RATE_LIMIT_MAX) || 100,
    },
  },

  cors: {
    origins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:8080"],
  },

  logger: createLogger({
    level: isProduction ? "info" : "debug",
    format: format.combine(format.timestamp(), format.json()),
    transports: [
      new transports.Console({
        format: format.combine(format.colorize(), format.simple()),
      }),
      new transports.File({ filename: "logs/error.log", level: "error" }),
      new transports.File({ filename: "logs/combined.log" }),
    ],
  }),
};

// Validate critical configuration
if (isProduction) {
  if (
    !config.jwt.secret ||
    config.jwt.secret === "your-secret-key-for-development"
  ) {
    throw new Error("JWT_SECRET must be set in production environment");
  }

  if (!config.db.password) {
    throw new Error("DB_PASSWORD must be set in production environment");
  }
}

export default config;
