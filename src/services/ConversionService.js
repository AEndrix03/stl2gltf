const { Client } = require("minio");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const os = require("os");
const { pipeline } = require("stream");
const pipe = promisify(pipeline);

const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

const execAsync = promisify(exec);

class ConversionService {
  constructor() {
    this.minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: parseInt(process.env.MINIO_PORT),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      region: process.env.MINIO_REGION || "us-east-1",
    });

    this.stlBucket = process.env.MINIO_BUCKET_STL;
    this.glbBucket = process.env.MINIO_BUCKET_GLB;
    this.tempDir = process.env.TEMP_DIR || "/tmp/stl2glb";
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS) || 10;
    this.activeJobs = 0;

    this.initializeBuckets();
    this.ensureTempDir();
  }

  async initializeBuckets() {
    try {
      // Create STL bucket if it doesn't exist
      const stlExists = await this.minioClient.bucketExists(this.stlBucket);
      if (!stlExists) {
        await this.minioClient.makeBucket(this.stlBucket);
        logger.info(`Created STL bucket: ${this.stlBucket}`);
      }

      // Create GLB bucket if it doesn't exist
      const glbExists = await this.minioClient.bucketExists(this.glbBucket);
      if (!glbExists) {
        await this.minioClient.makeBucket(this.glbBucket);
        logger.info(`Created GLB bucket: ${this.glbBucket}`);
      }

      // Set bucket policies for public read access to GLB files
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${this.glbBucket}/*`],
          },
        ],
      };

      try {
        await this.minioClient.setBucketPolicy(
          this.glbBucket,
          JSON.stringify(policy)
        );
        logger.info(`Set public read policy for GLB bucket: ${this.glbBucket}`);
      } catch (error) {
        logger.warn(`Could not set bucket policy: ${error.message}`);
      }
    } catch (error) {
      logger.error("Failed to initialize MinIO buckets", {
        error: error.message,
      });
      throw new AppError("Storage initialization failed", 500);
    }
  }

  async ensureTempDir() {
    try {
      await fsp.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create temp directory", {
        tempDir: this.tempDir,
        error: error.message,
      });
      throw new AppError("Temp directory creation failed", 500);
    }
  }

  calculateFileHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  async convertSTL(fileBuffer, originalName, options = {}) {
    // Check concurrent job limit
    if (this.activeJobs >= this.maxConcurrentJobs) {
      throw new AppError("Service is busy, please try again later", 503);
    }

    this.activeJobs++;

    try {
      const fileHash = this.calculateFileHash(fileBuffer);
      const glbObjectName = `${fileHash}`;

      // Check if GLB already exists (deduplication)
      try {
        const stats = await this.minioClient.statObject(
          this.glbBucket,
          glbObjectName
        );
        logger.info("Found existing GLB file", {
          hash: fileHash,
          size: stats.size,
        });

        return {
          filename: glbObjectName,
          hash: fileHash,
          size: stats.size,
          downloadUrl: await this.getDownloadUrl(fileHash),
          cached: true,
        };
      } catch (error) {
        // File doesn't exist, proceed with conversion
        logger.debug("GLB file not found, proceeding with conversion", {
          hash: fileHash,
        });
      }

      // Create unique temp directory for this conversion
      const jobTempDir = path.join(
        this.tempDir,
        `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      );
      await fsp.mkdir(jobTempDir, { recursive: true });

      try {
        // Save STL file to temp directory
        const stlPath = path.join(jobTempDir, "input.stl");
        const glbPath = path.join(jobTempDir, "output.glb");

        await fsp.writeFile(stlPath, fileBuffer);

        // Store original STL in MinIO for potential future use
        const stlObjectName = `${fileHash}`;
        await this.minioClient.putObject(
          this.stlBucket,
          stlObjectName,
          fileBuffer,
          fileBuffer.length,
          {
            "Content-Type": "application/octet-stream",
            "X-Original-Name": originalName,
            "X-File-Hash": fileHash,
          }
        );

        // Execute C++ converter
        await this.executeConverter(stlPath, glbPath, options);

        // Read converted GLB file
        const glbBuffer = await fsp.readFile(glbPath);

        // Upload GLB to MinIO
        await this.minioClient.putObject(
          this.glbBucket,
          glbObjectName,
          glbBuffer,
          glbBuffer.length,
          {
            "Content-Type": "model/gltf-binary",
            "X-Original-Name": originalName.replace(".stl", ".glb"),
            "X-File-Hash": fileHash,
            "X-Conversion-Options": JSON.stringify(options),
            "Cache-Control": "public, max-age=86400",
          }
        );

        logger.info("Successfully converted and uploaded GLB", {
          hash: fileHash,
          originalSize: fileBuffer.length,
          convertedSize: glbBuffer.length,
          originalName,
        });

        return {
          filename: glbObjectName,
          hash: fileHash,
          size: glbBuffer.length,
          downloadUrl: await this.getDownloadUrl(fileHash),
          cached: false,
        };
      } finally {
        // Clean up temp directory
        if (process.env.CLEANUP_TEMP_FILES !== "false") {
          try {
            await fsp.rm(jobTempDir, { recursive: true, force: true });
          } catch (error) {
            logger.warn("Failed to clean up temp directory", {
              jobTempDir,
              error: error.message,
            });
          }
        }
      }
    } finally {
      this.activeJobs--;
    }
  }

  async executeConverter(inputPath, outputPath, options) {
    const args = [`"${inputPath}"`, `"${outputPath}"`];

    // Add color option
    if (
      options.color &&
      Array.isArray(options.color) &&
      options.color.length === 3
    ) {
      args.push(`--color ${options.color.join(",")}`);
    }

    // Add metallic option
    if (typeof options.metallic === "number") {
      args.push(`--metallic ${options.metallic}`);
    }

    // Add roughness option
    if (typeof options.roughness === "number") {
      args.push(`--roughness ${options.roughness}`);
    }

    // Add normals option
    if (options.generateNormals) {
      args.push("--normals");
    }

    const command = `./stl2glb_native ${args.join(" ")}`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      if (stderr) {
        logger.warn("Converter warnings", { stderr });
      }

      logger.debug("Converter output", { stdout: stdout.trim() });

      // Verify output file exists
      try {
        await fsp.access(outputPath);
      } catch (error) {
        throw new AppError("Conversion failed: output file not created", 500);
      }
    } catch (error) {
      logger.error("Converter execution failed", {
        command,
        error: error.message,
        code: error.code,
        signal: error.signal,
      });

      if (error.code === "ENOENT") {
        throw new AppError(
          "Converter not found: stl2glb_native not available",
          500
        );
      } else if (error.signal === "SIGTERM") {
        throw new AppError(
          "Conversion timeout: file too large or complex",
          408
        );
      } else {
        throw new AppError(`Conversion failed: ${error.message}`, 500);
      }
    }
  }

  async downloadGLB(hash) {
    try {
      const objectName = hash;
      const stream = await this.minioClient.getObject(
        this.glbBucket,
        objectName
      );
      return stream;
    } catch (error) {
      if (error.code === "NoSuchKey") {
        return null;
      }
      logger.error("Failed to download GLB", { hash, error: error.message });
      throw new AppError("Download failed", 500);
    }
  }

  async getDownloadUrl(hash) {
    try {
      const objectName = hash;
      // Generate presigned URL valid for 24 hours
      const url = await this.minioClient.presignedGetObject(
        this.glbBucket,
        objectName,
        24 * 60 * 60 // 24 hours
      );
      return url;
    } catch (error) {
      logger.error("Failed to generate download URL", {
        hash,
        error: error.message,
      });
      return `/api/convert/download/${hash}`;
    }
  }

  // Utility method to check service health
  async healthCheck() {
    try {
      await this.minioClient.listBuckets();
      return { status: "healthy", activeJobs: this.activeJobs };
    } catch (error) {
      return { status: "unhealthy", error: error.message };
    }
  }

  // Clean up old files (can be called periodically)
  async cleanup(maxAgeHours = 24) {
    const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    try {
      // Clean up old STL files
      const stlObjects = this.minioClient.listObjects(this.stlBucket, "", true);
      for await (const obj of stlObjects) {
        if (obj.lastModified < cutoffDate) {
          await this.minioClient.removeObject(this.stlBucket, obj.name);
          logger.debug("Cleaned up old STL file", { name: obj.name });
        }
      }

      // Note: We keep GLB files longer as they might be accessed more frequently
      // GLB cleanup can be implemented separately if needed
    } catch (error) {
      logger.error("Cleanup failed", { error: error.message });
    }
  }

  // Conversione STL->GLB in streaming tra MinIO e MinIO (con file temporanei)
  async convertSTLStream(stl_hash, options = {}) {
    logger.info("[DEBUG] Inizio convertSTLStream", { stl_hash });

    const stlObjectName = stl_hash;
    // (glbObjectName verrà definito dopo il calcolo dell'hash)

    // Verifica se il GLB esiste già
    try {
      await this.minioClient.statObject(this.glbBucket, stlObjectName);
      return { glb_hash: stl_hash };
    } catch (e) {
      // Non esiste, prosegui
    }

    // File temporanei
    const tmpdir = os.tmpdir();
    const stlPath = path.join(tmpdir, `stl2glb_${stl_hash}.stl`);
    const glbPath = path.join(tmpdir, `stl2glb_${stl_hash}.glb`);

    // Scarica STL da MinIO su file temporaneo
    const stlStream = await this.minioClient.getObject(
      this.stlBucket,
      stlObjectName
    );
    logger.info("[DEBUG] Ottenuto stream STL da MinIO");

    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(stlPath);
      stlStream.pipe(fileStream);
      stlStream.on("error", (err) => {
        logger.error("[DEBUG] Errore stlStream", { err });
        reject(err);
      });
      fileStream.on("finish", () => {
        logger.info("[DEBUG] STL scritto su file");
        resolve();
      });
      fileStream.on("error", (err) => {
        logger.error("[DEBUG] Errore fileStream", { err });
        reject(err);
      });
    });

    // Prepara i parametri per il binario nativo
    const args = [stlPath, glbPath];
    if (
      options.color &&
      Array.isArray(options.color) &&
      options.color.length === 3
    ) {
      args.push("--color", options.color.join(","));
    }
    if (typeof options.metallic === "number") {
      args.push("--metallic", options.metallic);
    }
    if (typeof options.roughness === "number") {
      args.push("--roughness", options.roughness);
    }
    if (options.generateNormals) {
      args.push("--normals");
    }

    logger.info("[DEBUG] Avvio converter", { args });
    const { spawn } = require("child_process");
    await new Promise((resolve, reject) => {
      const converter = spawn("./stl2glb_native", args);
      logger.info("[DEBUG] Converter spawnato");
      converter.on("error", (err) => {
        logger.error("[DEBUG] Converter error", { err });
        reject(err);
      });
      converter.on("close", (code) => {
        logger.info("[DEBUG] Converter chiuso", { code });
        if (code === 0) resolve();
        else reject(new Error(`Converter exited with code ${code}`));
      });
      converter.stderr.on("data", (data) => {
        logger.warn("Converter stderr", { data: data.toString() });
      });
    });
    logger.info("[DEBUG] Converter terminato");

    // Streamma GLB su MinIO e calcola hash
    logger.info("[DEBUG] Inizio pipeline hash+scrittura temporanea");
    const hash = require("crypto").createHash("sha256");
    const { Transform } = require("stream");
    class HashStream extends Transform {
      constructor(hash) {
        super();
        this.hash = hash;
      }
      _transform(chunk, encoding, callback) {
        this.hash.update(chunk);
        this.push(chunk);
        callback();
      }
    }
    const glbReadStream = fs.createReadStream(glbPath);
    const tmpGlbPath = glbPath + ".upload";
    const tmpGlbWrite = fs.createWriteStream(tmpGlbPath);
    await pipe(glbReadStream, new HashStream(hash), tmpGlbWrite);
    logger.info("[DEBUG] Fine pipeline hash+scrittura temporanea");

    // Log dimensione file temporaneo
    const stats = fs.statSync(tmpGlbPath);
    logger.info("[DEBUG] Dimensione file tmpGlbPath", { size: stats.size });

    const glb_hash_result = hash.digest("hex");
    const glbObjectName = glb_hash_result;
    logger.info("[DEBUG] Hash GLB calcolato", { glb_hash_result });

    // Ora carica su MinIO
    logger.info("[DEBUG] Inizio upload su MinIO", { glbObjectName });
    const uploadStream = fs.createReadStream(tmpGlbPath);
    uploadStream.on("open", () => logger.info("[DEBUG] uploadStream open"));
    uploadStream.on("close", () => logger.info("[DEBUG] uploadStream close"));
    uploadStream.on("error", (err) =>
      logger.error("[DEBUG] uploadStream error", { err })
    );
    setTimeout(
      () => logger.warn("[DEBUG] Upload ancora in corso dopo 30s"),
      30000
    );
    await this.minioClient.putObject(
      this.glbBucket,
      glbObjectName,
      uploadStream,
      undefined,
      {
        "Content-Type": "model/gltf-binary",
        "X-Original-Hash": stl_hash,
        "X-Conversion-Options": JSON.stringify(options),
        "Cache-Control": "public, max-age=86400",
      }
    );
    logger.info("[DEBUG] Upload su MinIO completato");

    // Cancella file temporanei
    try {
      fs.unlinkSync(stlPath);
      logger.info("[DEBUG] File STL temporaneo cancellato");
    } catch (e) {
      logger.warn("[DEBUG] Errore cancellazione STL", { e });
    }
    try {
      fs.unlinkSync(glbPath);
      logger.info("[DEBUG] File GLB temporaneo cancellato");
    } catch (e) {
      logger.warn("[DEBUG] Errore cancellazione GLB", { e });
    }
    try {
      fs.unlinkSync(tmpGlbPath);
      logger.info("[DEBUG] File GLB upload temporaneo cancellato");
    } catch (e) {
      logger.warn("[DEBUG] Errore cancellazione GLB upload", { e });
    }

    logger.info("[DEBUG] Fine convertSTLStream", { glb_hash_result });
    return { glb_hash: glb_hash_result };
  }
}

module.exports = ConversionService;
