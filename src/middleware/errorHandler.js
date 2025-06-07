const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  let error = { ...err };
  error.message = err.message;

  // Log error details
  logger.error("Error occurred", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    body: req.method === "POST" ? sanitizeBody(req.body) : undefined,
  });

  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    const message = "Invalid resource ID";
    error = new AppError(message, 400);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = "Duplicate field value entered";
    error = new AppError(message, 400);
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((val) => val.message);
    error = new AppError(message, 400);
  }

  // MulterError (file upload errors)
  if (err.name === "MulterError") {
    let message = "File upload error";
    let statusCode = 400;

    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        message = `File too large. Maximum size is ${
          process.env.MAX_FILE_SIZE_MB || 50
        }MB`;
        break;
      case "LIMIT_FILE_COUNT":
        message = "Too many files uploaded";
        break;
      case "LIMIT_UNEXPECTED_FILE":
        message = "Unexpected file field";
        break;
      case "LIMIT_PART_COUNT":
        message = "Too many parts";
        break;
      case "LIMIT_FIELD_KEY":
        message = "Field name too long";
        break;
      case "LIMIT_FIELD_VALUE":
        message = "Field value too long";
        break;
      case "LIMIT_FIELD_COUNT":
        message = "Too many fields";
        break;
      default:
        message = err.message || "File upload error";
    }

    error = new AppError(message, statusCode);
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    const message = "Invalid token";
    error = new AppError(message, 401);
  }

  if (err.name === "TokenExpiredError") {
    const message = "Token expired";
    error = new AppError(message, 401);
  }

  // MinIO/S3 errors
  if (err.code === "NoSuchBucket") {
    const message = "Storage bucket not found";
    error = new AppError(message, 503);
  }

  if (err.code === "AccessDenied") {
    const message = "Storage access denied";
    error = new AppError(message, 503);
  }

  // System errors
  if (err.code === "ENOENT") {
    const message = "Required system component not found";
    error = new AppError(message, 503);
  }

  if (err.code === "ENOSPC") {
    const message = "Insufficient storage space";
    error = new AppError(message, 507);
  }

  // Network timeout errors
  if (err.code === "ETIMEDOUT" || err.code === "ECONNRESET") {
    const message = "Request timeout";
    error = new AppError(message, 408);
  }

  // Default to 500 server error
  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal Server Error";

  // Prepare error response
  const errorResponse = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };

  // Add additional info in development
  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
    errorResponse.details = error.details || undefined;
  }

  // Add request ID if available
  if (req.id) {
    errorResponse.requestId = req.id;
  }

  // Add validation details if available
  if (error.details && Array.isArray(error.details)) {
    errorResponse.validationErrors = error.details;
  }

  // Add retry information for rate limiting
  if (error.retryAfter) {
    res.setHeader("Retry-After", error.retryAfter);
    errorResponse.retryAfter = error.retryAfter;
  }

  // Set appropriate status code and send response
  res.status(statusCode).json(errorResponse);
}

/**
 * Sanitize request body for logging (remove sensitive data)
 */
function sanitizeBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sensitiveFields = ["password", "token", "secret", "key", "auth"];
  const sanitized = { ...body };

  Object.keys(sanitized).forEach((key) => {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      sanitized[key] = "[REDACTED]";
    }
  });

  return sanitized;
}

/**
 * Handle 404 errors
 */
function notFound(req, res, next) {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
}

/**
 * Handle uncaught exceptions
 */
function handleUncaughtException() {
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception! Shutting down...", {
      error: err.message,
      stack: err.stack,
    });

    process.exit(1);
  });
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection() {
  process.on("unhandledRejection", (err, promise) => {
    logger.error("Unhandled Rejection! Shutting down...", {
      error: err.message,
      stack: err.stack,
    });

    process.exit(1);
  });
}

module.exports = {
  errorHandler,
  notFound,
  handleUncaughtException,
  handleUnhandledRejection,
};
