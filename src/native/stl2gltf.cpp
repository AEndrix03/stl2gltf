#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <cstring>
#include <algorithm>
#include <unordered_map>
#include <sstream>
#include <iomanip>
#include <cmath>
#include <array>
#include <chrono>
#include <memory>

// Vertex structure with hash support for better performance
struct Vertex {
    float x, y, z;
    
    Vertex() : x(0), y(0), z(0) {}
    Vertex(float x, float y, float z) : x(x), y(y), z(z) {}
    
    bool operator==(const Vertex& other) const {
        const float epsilon = 1e-6f;
        return std::abs(x - other.x) < epsilon && 
               std::abs(y - other.y) < epsilon && 
               std::abs(z - other.z) < epsilon;
    }
    
    // Custom hash function for unordered_map
    struct Hash {
        std::size_t operator()(const Vertex& v) const {
            const int precision = 100000; // 5 decimal places
            int ix = static_cast<int>(v.x * precision);
            int iy = static_cast<int>(v.y * precision);
            int iz = static_cast<int>(v.z * precision);
            
            // Combine hashes using prime numbers
            std::size_t h1 = std::hash<int>{}(ix);
            std::size_t h2 = std::hash<int>{}(iy);
            std::size_t h3 = std::hash<int>{}(iz);
            
            return h1 ^ (h2 << 1) ^ (h3 << 2);
        }
    };
    
    // Vector operations
    Vertex operator+(const Vertex& other) const {
        return Vertex(x + other.x, y + other.y, z + other.z);
    }
    
    Vertex operator-(const Vertex& other) const {
        return Vertex(x - other.x, y - other.y, z - other.z);
    }
    
    Vertex operator*(float scalar) const {
        return Vertex(x * scalar, y * scalar, z * scalar);
    }
    
    float dot(const Vertex& other) const {
        return x * other.x + y * other.y + z * other.z;
    }
    
    Vertex cross(const Vertex& other) const {
        return Vertex(
            y * other.z - z * other.y,
            z * other.x - x * other.z,
            x * other.y - y * other.x
        );
    }
    
    float length() const {
        return std::sqrt(x * x + y * y + z * z);
    }
    
    Vertex normalize() const {
        float len = length();
        if (len > 1e-6f) {
            return *this * (1.0f / len);
        }
        return Vertex(0, 0, 1); // Default normal
    }
};

struct Triangle {
    Vertex normal;
    std::array<Vertex, 3> vertices;
    
    // Calculate triangle normal from vertices
    Vertex calculateNormal() const {
        Vertex edge1 = vertices[1] - vertices[0];
        Vertex edge2 = vertices[2] - vertices[0];
        return edge1.cross(edge2).normalize();
    }
    
    float area() const {
        Vertex edge1 = vertices[1] - vertices[0];
        Vertex edge2 = vertices[2] - vertices[0];
        return edge1.cross(edge2).length() * 0.5f;
    }
};

struct ConversionOptions {
    std::array<float, 3> color = {0.5f, 0.5f, 0.5f};
    float metallic = 0.0f;
    float roughness = 0.5f;
    bool generateNormals = false;
    bool verbose = false;
    std::string generator = "STL2GLB-Service-v1.0";
};

struct ConversionStats {
    size_t inputTriangles = 0;
    size_t outputTriangles = 0;
    size_t uniqueVertices = 0;
    size_t totalIndices = 0;
    float compressionRatio = 0.0f;
    std::chrono::milliseconds processingTime{0};
    size_t outputFileSize = 0;
};

class STLConverter {
private:
    std::vector<Triangle> triangles;
    std::vector<Vertex> uniqueVertices;
    std::vector<Vertex> vertexNormals; // For smooth normals
    std::vector<uint32_t> indices;
    Vertex minBounds = {999999.0f, 999999.0f, 999999.0f};
    Vertex maxBounds = {-999999.0f, -999999.0f, -999999.0f};
    ConversionStats stats;

public:
    bool loadSTL(const std::string& filepath, bool verbose = false) {
        auto startTime = std::chrono::high_resolution_clock::now();
        
        if (verbose) {
            std::cout << "Loading STL file: " << filepath << std::endl;
        }
        
        std::ifstream file(filepath);
        if (!file.is_open()) {
            std::cerr << "Error: Cannot open file " << filepath << std::endl;
            return false;
        }
        
        // Detect file format
        std::string line;
        std::getline(file, line);
        
        bool isBinary = true;
        if (line.rfind("solid ", 0) == 0) {
            // Check if it's really ASCII by reading next line
            std::streampos pos = file.tellg();
            std::getline(file, line);
            line = trim(line);
            if (line.rfind("facet", 0) == 0) {
                isBinary = false;
            }
            file.seekg(pos); // Reset position
        }
        file.close();
        
        bool success;
        if (isBinary) {
            if (verbose) std::cout << "Detected binary STL format" << std::endl;
            success = loadBinarySTL(filepath);
        } else {
            if (verbose) std::cout << "Detected ASCII STL format" << std::endl;
            success = loadASCIISTL(filepath);
        }
        
        if (success) {
            stats.inputTriangles = triangles.size();
            auto endTime = std::chrono::high_resolution_clock::now();
            auto loadTime = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime);
            
            if (verbose) {
                std::cout << "Loaded " << triangles.size() << " triangles in " 
                          << loadTime.count() << "ms" << std::endl;
            }
        }
        
        return success;
    }

private:
    std::string trim(const std::string& str) {
        size_t first = str.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) return "";
        size_t last = str.find_last_not_of(" \t\r\n");
        return str.substr(first, (last - first + 1));
    }
    
    bool loadBinarySTL(const std::string& filepath) {
        std::ifstream file(filepath, std::ios::binary);
        if (!file.is_open()) return false;
        
        // Skip 80-byte header
        file.seekg(80);
        
        uint32_t numTriangles;
        file.read(reinterpret_cast<char*>(&numTriangles), 4);
        
        if (numTriangles == 0) {
            std::cerr << "Error: No triangles found in STL file" << std::endl;
            return false;
        }
        
        triangles.reserve(numTriangles);
        
        for (uint32_t i = 0; i < numTriangles; i++) {
            Triangle tri;
            
            // Read normal vector
            file.read(reinterpret_cast<char*>(&tri.normal), 12);
            
            // Read three vertices
            for (int j = 0; j < 3; j++) {
                file.read(reinterpret_cast<char*>(&tri.vertices[j]), 12);
                updateBounds(tri.vertices[j]);
            }
            
            // Skip attribute byte count (2 bytes)
            uint16_t attributeCount;
            file.read(reinterpret_cast<char*>(&attributeCount), 2);
            
            // Validate triangle (skip degenerate triangles)
            if (isValidTriangle(tri)) {
                triangles.push_back(tri);
            }
        }
        
        file.close();
        return true;
    }
    
    bool loadASCIISTL(const std::string& filepath) {
        std::ifstream file(filepath);
        if (!file.is_open()) return false;
        
        std::string line;
        Triangle currentTri;
        int vertexIndex = 0;
        bool inFacet = false;
        
        while (std::getline(file, line)) {
            line = trim(line);
            
            if (line.empty()) continue;
            
            if (line.rfind("facet normal", 0) == 0) {
                std::istringstream iss(line.substr(12));
                iss >> currentTri.normal.x >> currentTri.normal.y >> currentTri.normal.z;
                vertexIndex = 0;
                inFacet = true;
            }
            else if (line.rfind("vertex", 0) == 0 && inFacet) {
                if (vertexIndex < 3) {
                    std::istringstream iss(line.substr(6));
                    Vertex& v = currentTri.vertices[vertexIndex++];
                    iss >> v.x >> v.y >> v.z;
                    updateBounds(v);
                }
            }
            else if (line == "endfacet" && inFacet) {
                if (vertexIndex == 3 && isValidTriangle(currentTri)) {
                    triangles.push_back(currentTri);
                }
                inFacet = false;
                vertexIndex = 0;
            }
        }
        
        file.close();
        return !triangles.empty();
    }
    
    bool isValidTriangle(const Triangle& tri) {
        // Check for degenerate triangles
        const float minArea = 1e-10f;
        
        Vertex edge1 = tri.vertices[1] - tri.vertices[0];
        Vertex edge2 = tri.vertices[2] - tri.vertices[0];
        Vertex cross = edge1.cross(edge2);
        
        return cross.length() > minArea;
    }
    
    void updateBounds(const Vertex& v) {
        minBounds.x = std::min(minBounds.x, v.x);
        minBounds.y = std::min(minBounds.y, v.y);
        minBounds.z = std::min(minBounds.z, v.z);
        maxBounds.x = std::max(maxBounds.x, v.x);
        maxBounds.y = std::max(maxBounds.y, v.y);
        maxBounds.z = std::max(maxBounds.z, v.z);
    }

public:
    void processVertices(const ConversionOptions& options) {
        auto startTime = std::chrono::high_resolution_clock::now();
        
        // Use unordered_map for O(1) average lookup time
        std::unordered_map<Vertex, uint32_t, Vertex::Hash> vertexMap;
        vertexMap.reserve(triangles.size() * 3 / 2); // Estimate unique vertices
        
        indices.reserve(triangles.size() * 3);
        
        // Process each triangle
        for (const auto& tri : triangles) {
            for (const auto& vertex : tri.vertices) {
                auto it = vertexMap.find(vertex);
                if (it == vertexMap.end()) {
                    uint32_t index = uniqueVertices.size();
                    uniqueVertices.push_back(vertex);
                    vertexMap[vertex] = index;
                    indices.push_back(index);
                    
                    // Initialize normal accumulator for smooth normals
                    if (options.generateNormals) {
                        vertexNormals.push_back(Vertex(0, 0, 0));
                    }
                } else {
                    indices.push_back(it->second);
                }
            }
        }
        
        // Generate smooth normals if requested
        if (options.generateNormals) {
            generateSmoothNormals();
        }
        
        // Update stats
        stats.uniqueVertices = uniqueVertices.size();
        stats.totalIndices = indices.size();
        stats.outputTriangles = indices.size() / 3;
        stats.compressionRatio = static_cast<float>(stats.inputTriangles * 3) / stats.uniqueVertices;
        
        auto endTime = std::chrono::high_resolution_clock::now();
        auto processTime = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime);
        
        if (options.verbose) {
            std::cout << "Vertex processing completed in " << processTime.count() << "ms" << std::endl;
            std::cout << "  Unique vertices: " << uniqueVertices.size() << std::endl;
            std::cout << "  Total indices: " << indices.size() << std::endl;
            std::cout << "  Compression ratio: " << std::fixed << std::setprecision(2) 
                      << stats.compressionRatio << ":1" << std::endl;
        }
    }
    
private:
    void generateSmoothNormals() {
        // Accumulate normals for each vertex
        for (size_t i = 0; i < triangles.size(); i++) {
            const Triangle& tri = triangles[i];
            Vertex faceNormal = tri.calculateNormal();
            float area = tri.area();
            
            // Weight normal by triangle area
            Vertex weightedNormal = faceNormal * area;
            
            // Add to each vertex normal
            for (int j = 0; j < 3; j++) {
                uint32_t vertexIndex = indices[i * 3 + j];
                vertexNormals[vertexIndex] = vertexNormals[vertexIndex] + weightedNormal;
            }
        }
        
        // Normalize all vertex normals
        for (auto& normal : vertexNormals) {
            normal = normal.normalize();
        }
    }

public:
    std::string generateGLTFJSON(const ConversionOptions& options) {
        const uint32_t indicesBytes = indices.size() * sizeof(uint32_t);
        const uint32_t verticesBytes = uniqueVertices.size() * 3 * sizeof(float);
        const uint32_t normalsBytes = options.generateNormals ? (uniqueVertices.size() * 3 * sizeof(float)) : 0;
        const uint32_t totalBytes = indicesBytes + verticesBytes + normalsBytes;
        
        std::ostringstream json;
        json << std::fixed << std::setprecision(6);
        
        json << "{\n";
        json << "  \"asset\": {\n";
        json << "    \"version\": \"2.0\",\n";
        json << "    \"generator\": \"" << options.generator << "\"\n";
        json << "  },\n";
        
        json << "  \"scenes\": [{\n";
        json << "    \"nodes\": [0]\n";
        json << "  }],\n";
        
        json << "  \"nodes\": [{\n";
        json << "    \"mesh\": 0,\n";
        json << "    \"rotation\": [-0.70710678119, 0.0, 0.0, 0.70710678119]\n";
        json << "  }],\n";
        
        json << "  \"meshes\": [{\n";
        json << "    \"primitives\": [{\n";
        json << "      \"attributes\": {\n";
        json << "        \"POSITION\": 1";
        if (options.generateNormals) {
            json << ",\n        \"NORMAL\": 2";
        }
        json << "\n      },\n";
        json << "      \"indices\": 0,\n";
        json << "      \"material\": 0\n";
        json << "    }]\n";
        json << "  }],\n";
        
        json << "  \"buffers\": [{\n";
        json << "    \"byteLength\": " << totalBytes << "\n";
        json << "  }],\n";
        
        // Buffer views
        json << "  \"bufferViews\": [\n";
        json << "    {\n";
        json << "      \"buffer\": 0,\n";
        json << "      \"byteOffset\": 0,\n";
        json << "      \"byteLength\": " << indicesBytes << ",\n";
        json << "      \"target\": 34963\n";
        json << "    },\n";
        json << "    {\n";
        json << "      \"buffer\": 0,\n";
        json << "      \"byteOffset\": " << indicesBytes << ",\n";
        json << "      \"byteLength\": " << verticesBytes << ",\n";
        json << "      \"target\": 34962\n";
        json << "    }";
        
        if (options.generateNormals) {
            json << ",\n    {\n";
            json << "      \"buffer\": 0,\n";
            json << "      \"byteOffset\": " << (indicesBytes + verticesBytes) << ",\n";
            json << "      \"byteLength\": " << normalsBytes << ",\n";
            json << "      \"target\": 34962\n";
            json << "    }";
        }
        
        json << "\n  ],\n";
        
        // Accessors
        json << "  \"accessors\": [\n";
        json << "    {\n";
        json << "      \"bufferView\": 0,\n";
        json << "      \"byteOffset\": 0,\n";
        json << "      \"componentType\": 5125,\n";
        json << "      \"count\": " << indices.size() << ",\n";
        json << "      \"type\": \"SCALAR\",\n";
        json << "      \"min\": [0],\n";
        json << "      \"max\": [" << (uniqueVertices.size() - 1) << "]\n";
        json << "    },\n";
        json << "    {\n";
        json << "      \"bufferView\": 1,\n";
        json << "      \"byteOffset\": 0,\n";
        json << "      \"componentType\": 5126,\n";
        json << "      \"count\": " << uniqueVertices.size() << ",\n";
        json << "      \"type\": \"VEC3\",\n";
        json << "      \"min\": [" << minBounds.x << ", " << minBounds.y << ", " << minBounds.z << "],\n";
        json << "      \"max\": [" << maxBounds.x << ", " << maxBounds.y << ", " << maxBounds.z << "]\n";
        json << "    }";
        
        if (options.generateNormals) {
            json << ",\n    {\n";
            json << "      \"bufferView\": 2,\n";
            json << "      \"byteOffset\": 0,\n";
            json << "      \"componentType\": 5126,\n";
            json << "      \"count\": " << uniqueVertices.size() << ",\n";
            json << "      \"type\": \"VEC3\"\n";
            json << "    }";
        }
        
        json << "\n  ],\n";
        
        // Materials
        json << "  \"materials\": [{\n";
        json << "    \"name\": \"STLMaterial\",\n";
        json << "    \"pbrMetallicRoughness\": {\n";
        json << "      \"baseColorFactor\": [" << options.color[0] << ", " << options.color[1] 
             << ", " << options.color[2] << ", 1.0],\n";
        json << "      \"metallicFactor\": " << options.metallic << ",\n";
        json << "      \"roughnessFactor\": " << options.roughness << "\n";
        json << "    }\n";
        json << "  }]\n";
        json << "}";
        
        return json.str();
    }
    
    bool saveGLB(const std::string& filepath, const ConversionOptions& options) {
        auto startTime = std::chrono::high_resolution_clock::now();
        
        std::string jsonStr = generateGLTFJSON(options);
        
        // Pad JSON to 4-byte boundary
        while (jsonStr.length() % 4 != 0) {
            jsonStr += " ";
        }
        
        const uint32_t jsonLength = jsonStr.length();
        const uint32_t indicesBytes = indices.size() * sizeof(uint32_t);
        const uint32_t verticesBytes = uniqueVertices.size() * 3 * sizeof(float);
        const uint32_t normalsBytes = options.generateNormals ? (uniqueVertices.size() * 3 * sizeof(float)) : 0;
        const uint32_t binaryLength = indicesBytes + verticesBytes + normalsBytes;
        const uint32_t totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
        
        std::ofstream file(filepath, std::ios::binary);
        if (!file.is_open()) {
            std::cerr << "Error: Cannot create output file " << filepath << std::endl;
            return false;
        }
        
        // GLB Header (12 bytes)
        file.write("glTF", 4);                                    // Magic
        uint32_t version = 2;
        file.write(reinterpret_cast<const char*>(&version), 4);   // Version
        file.write(reinterpret_cast<const char*>(&totalLength), 4); // Total length
        
        // JSON Chunk Header (8 bytes)
        file.write(reinterpret_cast<const char*>(&jsonLength), 4); // Chunk length
        file.write("JSON", 4);                                    // Chunk type
        
        // JSON Chunk Data
        file.write(jsonStr.c_str(), jsonLength);
        
        // Binary Chunk Header (8 bytes)
        file.write(reinterpret_cast<const char*>(&binaryLength), 4); // Chunk length
        file.write("BIN\0", 4);                                    // Chunk type
        
        // Binary Chunk Data
        
        // 1. Write indices
        file.write(reinterpret_cast<const char*>(indices.data()), indicesBytes);
        
        // 2. Write vertices (positions)
        for (const auto& vertex : uniqueVertices) {
            file.write(reinterpret_cast<const char*>(&vertex.x), sizeof(float));
            file.write(reinterpret_cast<const char*>(&vertex.y), sizeof(float)); 
            file.write(reinterpret_cast<const char*>(&vertex.z), sizeof(float));
        }
        
        // 3. Write normals (if generated)
        if (options.generateNormals) {
            for (const auto& normal : vertexNormals) {
                file.write(reinterpret_cast<const char*>(&normal.x), sizeof(float));
                file.write(reinterpret_cast<const char*>(&normal.y), sizeof(float)); 
                file.write(reinterpret_cast<const char*>(&normal.z), sizeof(float));
            }
        }
        
        file.close();
        
        // Update stats
        stats.outputFileSize = totalLength;
        auto endTime = std::chrono::high_resolution_clock::now();
        auto saveTime = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime);
        
        if (options.verbose) {
            std::cout << "\nGLB Export Summary:" << std::endl;
            std::cout << "  Output file: " << filepath << std::endl;
            std::cout << "  File size: " << formatBytes(totalLength) << std::endl;
            std::cout << "  Save time: " << saveTime.count() << "ms" << std::endl;
            std::cout << "  Triangles: " << stats.outputTriangles << std::endl;
            std::cout << "  Vertices: " << stats.uniqueVertices << std::endl;
            std::cout << "  Bounding box: [" << std::fixed << std::setprecision(3)
                      << minBounds.x << ", " << minBounds.y << ", " << minBounds.z 
                      << "] to [" << maxBounds.x << ", " << maxBounds.y << ", " << maxBounds.z << "]" << std::endl;
            
            if (options.generateNormals) {
                std::cout << "  Smooth normals: Generated" << std::endl;
            }
        }
        
        return true;
    }
    
    const ConversionStats& getStats() const {
        return stats;
    }

private:
    std::string formatBytes(size_t bytes) const {
        const char* units[] = {"B", "KB", "MB", "GB"};
        int unit = 0;
        double size = static_cast<double>(bytes);
        
        while (size >= 1024.0 && unit < 3) {
            size /= 1024.0;
            unit++;
        }
        
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(1) << size << " " << units[unit];
        return oss.str();
    }
};

void printUsage(const char* programName);

// Argument parsing
ConversionOptions parseArguments(int argc, char* argv[]) {
    ConversionOptions options;
    
    for (int i = 3; i < argc; i++) {
        std::string arg = argv[i];
        
        if (arg == "--color" && i + 1 < argc) {
            std::string colorStr = argv[++i];
            std::replace(colorStr.begin(), colorStr.end(), ',', ' ');
            std::istringstream iss(colorStr);
            iss >> options.color[0] >> options.color[1] >> options.color[2];
            
            // Clamp values to [0,1] range
            for (auto& c : options.color) {
                c = std::max(0.0f, std::min(1.0f, c));
            }
        }
        else if (arg == "--metallic" && i + 1 < argc) {
            options.metallic = std::max(0.0f, std::min(1.0f, std::stof(argv[++i])));
        }
        else if (arg == "--roughness" && i + 1 < argc) {
            options.roughness = std::max(0.0f, std::min(1.0f, std::stof(argv[++i])));
        }
        else if (arg == "--normals") {
            options.generateNormals = true;
        }
        else if (arg == "--verbose" || arg == "-v") {
            options.verbose = true;
        }
        else if (arg == "--version") {
            std::cout << "STL2GLB Converter v1.0.0" << std::endl;
            std::cout << "High-performance STL to GLB conversion tool" << std::endl;
            exit(0);
        }
        else if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            exit(0);
        }
    }
    
    return options;
}

void printUsage(const char* programName) {
    std::cout << "STL2GLB - High Performance STL to GLB Converter\n\n";
    std::cout << "Usage: " << programName << " input.stl output.glb [options]\n\n";
    std::cout << "Options:\n";
    std::cout << "  --color r,g,b     Set material color (0-1 range, default: 0.5,0.5,0.5)\n";
    std::cout << "  --metallic value  Set metallic factor (0-1, default: 0.0)\n"; 
    std::cout << "  --roughness value Set roughness factor (0-1, default: 0.5)\n";
    std::cout << "  --normals         Generate smooth vertex normals\n";
    std::cout << "  --verbose, -v     Enable verbose output\n";
    std::cout << "  --version         Show version information\n";
    std::cout << "  --help, -h        Show this help message\n\n";
    std::cout << "Examples:\n";
    std::cout << "  " << programName << " model.stl model.glb\n";
    std::cout << "  " << programName << " model.stl model.glb --color 1.0,0.0,0.0 --metallic 0.8 --normals\n";
    std::cout << "  " << programName << " model.stl model.glb --verbose\n\n";
}

int main(int argc, char* argv[]) {
    // Gestione --help e --version anche senza argomenti obbligatori
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return 0;
        }
        if (arg == "--version") {
            std::cout << "STL2GLB Converter v1.0.0" << std::endl;
            std::cout << "High-performance STL to GLB conversion tool" << std::endl;
            return 0;
        }
    }

    if (argc < 3) {
        printUsage(argv[0]);
        return 1;
    }
    
    std::string inputPath = argv[1];
    std::string outputPath = argv[2];
    ConversionOptions options = parseArguments(argc, argv);
    
    if (options.verbose) {
        std::cout << "STL to GLB Converter - High Performance Edition" << std::endl;
        std::cout << "=============================================" << std::endl;
        std::cout << "Input:  " << inputPath << std::endl;
        std::cout << "Output: " << outputPath << std::endl;
        std::cout << "Color:  [" << options.color[0] << ", " << options.color[1] << ", " << options.color[2] << "]" << std::endl;
        std::cout << "Metallic: " << options.metallic << std::endl;
        std::cout << "Roughness: " << options.roughness << std::endl;
        std::cout << "Generate normals: " << (options.generateNormals ? "Yes" : "No") << std::endl;
        std::cout << std::endl;
    }
    
    try {
        STLConverter converter;
        auto totalStartTime = std::chrono::high_resolution_clock::now();
        
        // Load STL file
        if (!converter.loadSTL(inputPath, options.verbose)) {
            std::cerr << "Error: Failed to load STL file: " << inputPath << std::endl;
            return 1;
        }
        
        // Process vertices and generate geometry
        converter.processVertices(options);
        
        // Save GLB file
        if (!converter.saveGLB(outputPath, options)) {
            std::cerr << "Error: Failed to save GLB file: " << outputPath << std::endl;
            return 1;
        }
        
        auto totalEndTime = std::chrono::high_resolution_clock::now();
        auto totalTime = std::chrono::duration_cast<std::chrono::milliseconds>(totalEndTime - totalStartTime);
        
        if (options.verbose) {
            std::cout << "\nTotal conversion time: " << totalTime.count() << "ms" << std::endl;
        } else {
            // Minimal output for service integration
            const auto& stats = converter.getStats();
            std::cout << "Conversion completed: " << stats.outputTriangles << " triangles, " 
                      << stats.uniqueVertices << " vertices, " << totalTime.count() << "ms" << std::endl;
        }
        
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "Error: Unknown exception occurred" << std::endl;
        return 1;
    }
}