/**
 * Custom Application Error Class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation Error Class
 */
class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400);
    this.name = "ValidationError";
    this.details = details;
  }
}

/**
 * File Processing Error Class
 */
class FileProcessingError extends AppError {
  constructor(message, filename = null) {
    super(message, 422);
    this.name = "FileProcessingError";
    this.filename = filename;
  }
}

/**
 * Storage Error Class
 */
class StorageError extends AppError {
  constructor(message, operation = null) {
    super(message, 503);
    this.name = "StorageError";
    this.operation = operation;
  }
}

/**
 * Rate Limit Error Class
 */
class RateLimitError extends AppError {
  constructor(message = "Too many requests", retryAfter = null) {
    super(message, 429);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

module.exports = {
  AppError,
  ValidationError,
  FileProcessingError,
  StorageError,
  RateLimitError,
};
