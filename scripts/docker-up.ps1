# Realyx — Docker Compose launcher
# Usage:
#   .\scripts\docker-up.ps1             # minimal (backend + frontend)
#   .\scripts\docker-up.ps1 -Full       # full stack (postgres, redis, monitoring)
#
# Prerequisites: Docker Desktop must be running

param(
    [switch]$Full,
    [switch]$Down
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

Push-Location $rootDir
try {
    if ($Full) {
        $composeFile = "docker-compose.yml"
    } else {
        $composeFile = "docker-compose.minimal.yml"
    }

    if ($Down) {
        Write-Host "Stopping containers ($composeFile)..." -ForegroundColor Yellow
        docker compose -f $composeFile down
        exit 0
    }

    Write-Host "Building and starting containers ($composeFile)..." -ForegroundColor Cyan
    docker compose -f $composeFile up -d --build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host ""
    if ($Full) {
        Write-Host "Realyx full stack is running:" -ForegroundColor Green
        Write-Host "  Frontend:    http://localhost:3000"
        Write-Host "  Backend:     http://localhost:3001"
        Write-Host "  WebSocket:   ws://localhost:3002"
        Write-Host "  Prometheus:  http://localhost:9090"
        Write-Host "  Grafana:     http://localhost:3003"
    } else {
        Write-Host "Realyx is running:" -ForegroundColor Green
        Write-Host "  Frontend:  http://localhost:3010"
        Write-Host "  Backend:   http://localhost:3011"
        Write-Host "  WebSocket: ws://localhost:3012"
    }
    Write-Host ""
    Write-Host "Logs: docker compose -f $composeFile logs -f" -ForegroundColor DarkGray
    Write-Host "Stop: .\scripts\docker-up.ps1 $(if ($Full) {'-Full'}) -Down" -ForegroundColor DarkGray
} finally {
    Pop-Location
}
