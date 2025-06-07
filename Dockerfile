# Multi-stage build for optimized production image
FROM node:18-bullseye-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy C++ source and build files
COPY src/native/ src/native/
COPY CMakeLists.txt .

# Build native converter
RUN mkdir -p build && cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release .. && \
    make -j$(nproc) && \
    cp bin/stl2glb_native /build/

# Verify native binary
RUN ./stl2glb_native --version

# Production stage
FROM node:18-bullseye-slim AS production

# Create app user
RUN groupadd -r stl2glb && useradd -r -g stl2glb stl2glb

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies (production only)
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=stl2glb:stl2glb src/ src/
COPY --chown=stl2glb:stl2glb .env .

# Copy native binary from builder stage
COPY --from=builder /build/stl2glb_native ./

# Create necessary directories
RUN mkdir -p /tmp/stl2glb /var/log/stl2glb && \
    chown -R stl2glb:stl2glb /tmp/stl2glb /var/log/stl2glb

# Verify everything is working
RUN ./stl2glb_native --version && \
    node -e "console.log('Node.js dependencies installed successfully')"

# Switch to non-root user
USER stl2glb

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:9002/health || exit 1

# Expose port
EXPOSE 9002

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start the application
CMD ["node", "src/server.js"]

# Labels for metadata
LABEL org.opencontainers.image.title="STL2GLB Conversion Service"
LABEL org.opencontainers.image.description="High-performance STL to GLB conversion service with MinIO storage"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="Your Organization"
LABEL org.opencontainers.image.source="https://github.com/your-org/stl2glb-service"