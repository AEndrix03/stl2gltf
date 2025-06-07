const express = require("express");
const { Client } = require("minio");
const { exec } = require("child_process");
const { promisify } = require("util");

const logger = require("../utils/logger");

const router = express.Router();
const execAsync = promisify(exec);

// Initialize MinIO client for health checks
const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

/**
 * GET /health
 * Basic health check endpoint
 */
router.get("/", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require("../../package.json").version,
    environment: process.env.NODE_ENV,
  });
});

/**
 * GET /health/detailed
 * Detailed health check including dependencies
 */
router.get("/detailed", async (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require("../../package.json").version,
    environment: process.env.NODE_ENV,
    checks: {},
  };

  let overallHealthy = true;

  // Check MinIO connection
  try {
    await minioClient.listBuckets();
    health.checks.minio = {
      status: "healthy",
      message: "MinIO connection successful",
    };
  } catch (error) {
    overallHealthy = false;
    health.checks.minio = {
      status: "unhealthy",
      message: `MinIO connection failed: ${error.message}`,
    };
  }

  // Check MinIO buckets
  try {
    const stlBucketExists = await minioClient.bucketExists(
      process.env.MINIO_BUCKET_STL
    );
    const glbBucketExists = await minioClient.bucketExists(
      process.env.MINIO_BUCKET_GLB
    );

    if (stlBucketExists && glbBucketExists) {
      health.checks.buckets = {
        status: "healthy",
        message: "All required buckets exist",
      };
    } else {
      health.checks.buckets = {
        status: "warning",
        message: `Missing buckets - STL: ${stlBucketExists}, GLB: ${glbBucketExists}`,
      };
    }
  } catch (error) {
    health.checks.buckets = {
      status: "unhealthy",
      message: `Bucket check failed: ${error.message}`,
    };
  }

  // Check C++ converter
  try {
    const { stdout } = await execAsync("./stl2glb_native --version");
    health.checks.converter = {
      status: "healthy",
      message: "C++ converter available",
      version: stdout.trim(),
    };
  } catch (error) {
    overallHealthy = false;
    health.checks.converter = {
      status: "unhealthy",
      message: `C++ converter not available: ${error.message}`,
    };
  }

  // Check disk space in temp directory
  try {
    const { stdout } = await execAsync(
      `df -h ${process.env.TEMP_DIR || "/tmp"}`
    );
    const lines = stdout.split("\n");
    const tempLine =
      lines.find((line) => line.includes(process.env.TEMP_DIR || "/tmp")) ||
      lines[1];
    const usage = tempLine.split(/\s+/)[4]; // Usage percentage

    health.checks.diskSpace = {
      status: parseInt(usage) > 90 ? "warning" : "healthy",
      message: `Temp directory usage: ${usage}`,
      usage,
    };
  } catch (error) {
    health.checks.diskSpace = {
      status: "warning",
      message: `Could not check disk space: ${error.message}`,
    };
  }

  // Memory usage
  const memUsage = process.memoryUsage();
  health.checks.memory = {
    status: memUsage.heapUsed > 500 * 1024 * 1024 ? "warning" : "healthy", // 500MB threshold
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
  };

  // Set overall status
  if (!overallHealthy) {
    health.status = "unhealthy";
  } else if (
    Object.values(health.checks).some((check) => check.status === "warning")
  ) {
    health.status = "degraded";
  }

  const statusCode =
    health.status === "healthy"
      ? 200
      : health.status === "degraded"
      ? 200
      : 503;

  res.status(statusCode).json(health);
});

/**
 * GET /health/metrics
 * Prometheus-style metrics endpoint
 */
router.get("/metrics", (req, res) => {
  const memUsage = process.memoryUsage();

  const metrics = [
    `# HELP stl2glb_uptime_seconds Total uptime in seconds`,
    `# TYPE stl2glb_uptime_seconds counter`,
    `stl2glb_uptime_seconds ${process.uptime()}`,
    "",
    `# HELP stl2glb_memory_heap_used_bytes Heap memory used in bytes`,
    `# TYPE stl2glb_memory_heap_used_bytes gauge`,
    `stl2glb_memory_heap_used_bytes ${memUsage.heapUsed}`,
    "",
    `# HELP stl2glb_memory_heap_total_bytes Total heap memory in bytes`,
    `# TYPE stl2glb_memory_heap_total_bytes gauge`,
    `stl2glb_memory_heap_total_bytes ${memUsage.heapTotal}`,
    "",
    `# HELP stl2glb_version_info Version information`,
    `# TYPE stl2glb_version_info gauge`,
    `stl2glb_version_info{version="${
      require("../../package.json").version
    }",environment="${process.env.NODE_ENV}"} 1`,
  ].join("\n");

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metrics);
});

module.exports = router;
