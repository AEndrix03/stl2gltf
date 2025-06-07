const logger = require("./logger");

/**
 * Validate required environment variables
 */
function validateEnv() {
  const required = [
    "MINIO_ENDPOINT",
    "MINIO_PORT",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "MINIO_BUCKET_STL",
    "MINIO_BUCKET_GLB",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error("Missing required environment variables", { missing });
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Validate numeric values
  const numericVars = {
    MINIO_PORT: process.env.MINIO_PORT,
    MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB,
    MAX_CONCURRENT_JOBS: process.env.MAX_CONCURRENT_JOBS,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS,
  };

  for (const [key, value] of Object.entries(numericVars)) {
    if (value && isNaN(parseInt(value))) {
      logger.error("Invalid numeric environment variable", { key, value });
      throw new Error(`Invalid numeric environment variable: ${key}=${value}`);
    }
  }

  // Validate boolean values
  const booleanVars = ["MINIO_USE_SSL", "CLEANUP_TEMP_FILES"];

  for (const key of booleanVars) {
    const value = process.env[key];
    if (value && !["true", "false"].includes(value.toLowerCase())) {
      logger.error("Invalid boolean environment variable", { key, value });
      throw new Error(`Invalid boolean environment variable: ${key}=${value}`);
    }
  }

  logger.info("Environment validation passed");
}

/**
 * Get configuration object
 */
function getConfig() {
  return {
    server: {
      port: parseInt(process.env.PORT) || 9002,
      environment: process.env.NODE_ENV || "development",
      logLevel: process.env.LOG_LEVEL || "info",
    },
    minio: {
      endpoint: process.env.MINIO_ENDPOINT,
      port: parseInt(process.env.MINIO_PORT),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      region: process.env.MINIO_REGION || "us-east-1",
      buckets: {
        stl: process.env.MINIO_BUCKET_STL,
        glb: process.env.MINIO_BUCKET_GLB,
      },
    },
    limits: {
      maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 50,
      maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 10,
      rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      },
    },
    paths: {
      tempDir: process.env.TEMP_DIR || "/tmp/stl2glb",
    },
    security: {
      corsOrigin: process.env.CORS_ORIGIN || "*",
      trustedProxies: process.env.TRUSTED_PROXIES || "127.0.0.1",
    },
    cleanup: {
      tempFiles: process.env.CLEANUP_TEMP_FILES !== "false",
      intervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 24,
    },
  };
}

module.exports = {
  validateEnv,
  getConfig,
};
