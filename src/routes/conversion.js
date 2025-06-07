const express = require("express");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const crypto = require("crypto");

const ConversionService = require("../services/ConversionService");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".stl")) {
      return cb(new AppError("Only STL files are allowed", 400));
    }
    cb(null, true);
  },
});

// Validation middleware
const validateConversion = [
  body("color")
    .optional()
    .isArray({ min: 3, max: 3 })
    .withMessage("Color must be an array of 3 numbers")
    .custom((value) => {
      if (
        value &&
        !value.every((v) => typeof v === "number" && v >= 0 && v <= 1)
      ) {
        throw new Error("Color values must be numbers between 0 and 1");
      }
      return true;
    }),
  body("metallic")
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage("Metallic must be a number between 0 and 1"),
  body("roughness")
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage("Roughness must be a number between 0 and 1"),
  body("generateNormals")
    .optional()
    .isBoolean()
    .withMessage("generateNormals must be a boolean"),
];

// Initialize conversion service
const conversionService = new ConversionService();

/**
 * POST /api/convert
 * Convert STL file to GLB format
 *
 * @body {File} stl - STL file to convert
 * @body {Array<number>} [color] - RGB color array [r, g, b] (0-1 range)
 * @body {number} [metallic] - Metallic factor (0-1)
 * @body {number} [roughness] - Roughness factor (0-1)
 * @body {boolean} [generateNormals] - Generate vertex normals
 *
 * @returns {Object} Conversion result with download URL or job ID
 */
router.post(
  "/file",
  upload.single("stl"),
  validateConversion,
  async (req, res, next) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No STL file provided",
          message: "Please upload an STL file",
        });
      }

      // Parse options
      const options = {
        color: req.body.color ? req.body.color.map(Number) : [0.5, 0.5, 0.5],
        metallic: req.body.metallic ? parseFloat(req.body.metallic) : 0.0,
        roughness: req.body.roughness ? parseFloat(req.body.roughness) : 0.5,
        generateNormals:
          req.body.generateNormals === "true" ||
          req.body.generateNormals === true,
      };

      const startTime = Date.now();

      logger.info("Starting STL conversion", {
        filename: req.file.originalname,
        size: req.file.size,
        options,
      });

      // Process conversion
      const result = await conversionService.convertSTL(
        req.file.buffer,
        req.file.originalname,
        options
      );

      const duration = Date.now() - startTime;

      logger.info("Conversion completed", {
        filename: req.file.originalname,
        duration,
        outputSize: result.size,
        cached: result.cached,
      });

      // Return success response
      res.json({
        success: true,
        message: result.cached
          ? "File converted (cached)"
          : "File converted successfully",
        data: {
          filename: result.filename,
          originalName: req.file.originalname,
          size: result.size,
          downloadUrl: result.downloadUrl,
          hash: result.hash,
          cached: result.cached,
          processingTime: duration,
        },
      });
    } catch (error) {
      logger.error("Conversion failed", {
        filename: req.file?.originalname,
        error: error.message,
        stack: error.stack,
      });

      next(error);
    }
  }
);

/**
 * GET /api/convert/download/:hash
 * Download converted GLB file by hash
 *
 * @param {string} hash - File hash
 * @returns {Stream} GLB file stream
 */
router.get("/download/:hash", async (req, res, next) => {
  try {
    const { hash } = req.params;

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return res.status(400).json({
        error: "Invalid hash format",
        message: "Hash must be a 64-character hexadecimal string",
      });
    }

    const stream = await conversionService.downloadGLB(hash);

    if (!stream) {
      return res.status(404).json({
        error: "File not found",
        message: "The requested GLB file does not exist or has expired",
      });
    }

    // Set appropriate headers
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Content-Disposition", `attachment; filename="${hash}.glb"`);
    res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hours

    // Pipe the stream to response
    stream.pipe(res);

    // Handle stream errors
    stream.on("error", (error) => {
      logger.error("Stream error during download", {
        hash,
        error: error.message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    });
  } catch (error) {
    logger.error("Download failed", {
      hash: req.params.hash,
      error: error.message,
    });

    next(error);
  }
});

// Nuova route: conversione via hash STL
router.post(
  "/",
  [
    body("stl_hash")
      .isString()
      .isLength({ min: 64, max: 64 })
      .withMessage("stl_hash must be a 64-character string"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ error: "Validation failed", details: errors.array() });
      }
      const { stl_hash } = req.body;
      // Opzioni di conversione opzionali
      const options = {
        color: req.body.color ? req.body.color.map(Number) : [0.5, 0.5, 0.5],
        metallic: req.body.metallic ? parseFloat(req.body.metallic) : 0.0,
        roughness: req.body.roughness ? parseFloat(req.body.roughness) : 0.5,
        generateNormals:
          req.body.generateNormals === "true" ||
          req.body.generateNormals === true,
      };
      const result = await conversionService.convertSTLStream(
        stl_hash,
        options
      );
      res.json({ glb_hash: result.glb_hash });
    } catch (error) {
      logger.error("Conversion failed", {
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }
);

module.exports = router;
