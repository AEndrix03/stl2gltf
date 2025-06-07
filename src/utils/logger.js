const winston = require("winston");

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}] ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    return log;
  })
);

// Define log level based on environment
const logLevel =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

// Create logger
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: {
    service: "stl2glb-service",
    version: require("../../package.json").version,
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === "production") {
  // Main log file
  logger.add(
    new winston.transports.File({
      filename: "/var/log/stl2glb/app.log",
      format: winston.format.json(),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );

  // Error log file
  logger.add(
    new winston.transports.File({
      filename: "/var/log/stl2glb/error.log",
      level: "error",
      format: winston.format.json(),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );
}

// Create a stream for HTTP request logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = logger;
