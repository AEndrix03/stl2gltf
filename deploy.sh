#!/bin/bash

# STL2GLB Service Deployment Script
# Usage: ./deploy.sh [environment] [action]
# Example: ./deploy.sh production deploy

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="stl2glb-service"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
STL2GLB Service Deployment Script

Usage: $0 [environment] [action]

Environments:
  development  - Local development deployment
  staging      - Staging environment
  production   - Production environment

Actions:
  deploy       - Deploy the service
  update       - Update existing deployment
  stop         - Stop the service
  restart      - Restart the service
  logs         - Show service logs
  health       - Check service health
  cleanup      - Clean up old containers and images
  backup       - Backup MinIO data

Examples:
  $0 development deploy
  $0 production update
  $0 production logs
  $0 staging health

EOF
}

# Validate environment
validate_environment() {
    local env=$1
    
    case $env in
        development|staging|production)
            return 0
            ;;
        *)
            log_error "Invalid environment: $env"
            show_help
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check .env file
    if [[ ! -f .env ]]; then
        log_warning ".env file not found, copying from .env.example"
        cp .env.example .env
        log_warning "Please edit .env file with your configuration"
    fi
    
    log_success "Prerequisites check passed"
}

# Build images
build_images() {
    local env=$1
    
    log_info "Building Docker images for $env environment..."
    
    if [[ "$env" == "production" ]]; then
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
    else
        docker-compose build --no-cache
    fi
    
    log_success "Images built successfully"
}

# Deploy service
deploy_service() {
    local env=$1
    
    log_info "Deploying $PROJECT_NAME for $env environment..."
    
    # Load environment variables
    set -a
    source .env
    set +a
    
    # Stop existing containers
    log_info "Stopping existing containers..."
    docker-compose down --remove-orphans || true
    
    # Build and start services
    build_images "$env"
    
    log_info "Starting services..."
    if [[ "$env" == "production" ]]; then
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
    else
        docker-compose up -d
    fi
    
    # Wait for services to be ready
    log_info "Waiting for services to start..."
    sleep 30
    
    # Health check
    if check_health; then
        log_success "Deployment completed successfully!"
        show_service_info
    else
        log_error "Deployment failed - services are not healthy"
        show_logs
        exit 1
    fi
}

# Update service
update_service() {
    local env=$1
    
    log_info "Updating $PROJECT_NAME..."
    
    # Pull latest images
    log_info "Pulling latest images..."
    docker-compose pull
    
    # Rebuild if needed
    build_images "$env"
    
    # Rolling update
    log_info "Performing rolling update..."
    if [[ "$env" == "production" ]]; then
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps stl2glb-service
    else
        docker-compose up -d --no-deps stl2glb-service
    fi
    
    # Wait and check health
    sleep 15
    if check_health; then
        log_success "Update completed successfully!"
    else
        log_error "Update failed - service is not healthy"
        exit 1
    fi
}

# Stop service
stop_service() {
    log_info "Stopping $PROJECT_NAME..."
    docker-compose down
    log_success "Service stopped"
}

# Restart service
restart_service() {
    log_info "Restarting $PROJECT_NAME..."
    docker-compose restart
    sleep 15
    
    if check_health; then
        log_success "Service restarted successfully!"
    else
        log_error "Service restart failed"
        exit 1
    fi
}

# Show logs
show_logs() {
    log_info "Showing service logs..."
    docker-compose logs -f --tail=100
}

# Check health
check_health() {
    local max_attempts=30
    local attempt=1
    
    log_info "Checking service health..."
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s http://localhost:9002/health > /dev/null 2>&1; then
            log_success "Service is healthy!"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts - waiting for service..."
        sleep 2
        ((attempt++))
    done
    
    log_error "Service health check failed after $max_attempts attempts"
    return 1
}

# Show service information
show_service_info() {
    log_info "Service Information:"
    echo "  - API: http://localhost:9002"
    echo "  - Health: http://localhost:9002/health"
    echo "  - MinIO Console: http://localhost:9001"
    echo "  - Metrics: http://localhost:9002/health/metrics"
    
    # Show running containers
    echo ""
    log_info "Running containers:"
    docker-compose ps
}

# Cleanup old containers and images
cleanup() {
    log_info "Cleaning up old containers and images..."
    
    # Remove stopped containers
    docker container prune -f
    
    # Remove unused images
    docker image prune -f
    
    # Remove unused volumes
    docker volume prune -f
    
    # Remove unused networks
    docker network prune -f
    
    log_success "Cleanup completed"
}

# Backup MinIO data
backup_minio() {
    local backup_dir="./backups/$(date +%Y%m%d_%H%M%S)"
    
    log_info "Creating MinIO backup..."
    mkdir -p "$backup_dir"
    
    # Get MinIO container ID
    local minio_container=$(docker-compose ps -q minio)
    
    if [[ -z "$minio_container" ]]; then
        log_error "MinIO container not found or not running"
        exit 1
    fi
    
    # Create backup
    docker exec "$minio_container" tar -czf /tmp/backup.tar.gz /data
    docker cp "$minio_container:/tmp/backup.tar.gz" "$backup_dir/minio_data.tar.gz"
    docker exec "$minio_container" rm /tmp/backup.tar.gz
    
    log_success "Backup created: $backup_dir/minio_data.tar.gz"
}

# Main function
main() {
    local environment=${1:-development}
    local action=${2:-deploy}
    
    # Show help if requested
    if [[ "$1" == "-h" || "$1" == "--help" ]]; then
        show_help
        exit 0
    fi
    
    # Validate inputs
    validate_environment "$environment"
    
    # Change to script directory
    cd "$SCRIPT_DIR"
    
    # Check prerequisites
    check_prerequisites
    
    # Execute action
    case $action in
        deploy)
            deploy_service "$environment"
            ;;
        update)
            update_service "$environment"
            ;;
        stop)
            stop_service
            ;;
        restart)
            restart_service
            ;;
        logs)
            show_logs
            ;;
        health)
            check_health
            ;;
        cleanup)
            cleanup
            ;;
        backup)
            backup_minio
            ;;
        *)
            log_error "Invalid action: $action"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"