cmake_minimum_required(VERSION 3.16)
project(STL2GLB_Service VERSION 1.0.0 LANGUAGES CXX)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Set build type if not specified
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Compiler flags
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -Wall -Wextra -pedantic")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -march=native")

# Platform-specific optimizations
if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64")
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -msse4.2")
endif()

# Source files
set(SOURCES
    src/native/stl2gltf.cpp
)

# Create executable
add_executable(stl2glb_native ${SOURCES})

# Set output directory
set_target_properties(stl2glb_native PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
)

# Install target
install(TARGETS stl2glb_native
    RUNTIME DESTINATION bin
)

# Add custom target for building and copying to project root
add_custom_target(install_native
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target stl2glb_native
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_BINARY_DIR}/bin/stl2glb_native ${CMAKE_SOURCE_DIR}/stl2glb_native
    COMMENT "Building and installing native converter"
)

# Print build information
message(STATUS "STL2GLB Service Configuration:")
message(STATUS "  Version: ${PROJECT_VERSION}")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "  Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  System: ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_PROCESSOR}")

# Add tests if requested
option(BUILD_TESTS "Build test programs" OFF)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# Add benchmarks if requested
option(BUILD_BENCHMARKS "Build benchmark programs" OFF)
if(BUILD_BENCHMARKS)
    add_subdirectory(benchmarks)
endif()