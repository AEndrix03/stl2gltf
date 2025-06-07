const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");

const logger = require("./utils/logger.js");
const { validateEnv } = require("./utils/config.js");
const conversionRoutes = require("./routes/conversion.js");
const healthRoutes = require("./routes/health.js");
const { errorHandler } = require("./middleware/errorHandler.js");

// Load environment variables
dotenv.config();

// Validate environment
validateEnv();

const app = express();
const PORT = process.env.PORT || 9002;

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable for API-only service
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400, // 24 hours
  })
);

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: process.env.TRUSTED_PROXIES || false,
});

app.use("/api/", limiter);

// Body parsing middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Request logging
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info(
      `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`,
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get("User-Agent"),
        ip: req.ip,
      }
    );
  });

  next();
});

// Routes
app.use("/api/convert", conversionRoutes);
app.use("/health", healthRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist.`,
    availableEndpoints: [
      "POST /api/convert - Convert STL to GLB",
      "GET /health - Service health check",
    ],
  });
});

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`🚀 STL2GLB Service running on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV,
    version: require("../package.json").version,
  });
});

module.exports = app;
