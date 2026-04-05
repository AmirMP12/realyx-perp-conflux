# Run Realyx via Docker (minimal: backend + frontend)
# Prerequisite: Docker Desktop must be running

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

Push-Location $rootDir
try {
    Write-Host "Building and starting containers..." -ForegroundColor Cyan
    docker compose -f docker-compose.minimal.yml up -d --build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host ""
    Write-Host "Realyx is running:" -ForegroundColor Green
    Write-Host "  Frontend:  http://localhost:3010"
    Write-Host "  Backend:   http://localhost:3011"
    Write-Host "  WebSocket: ws://localhost:3012"
    Write-Host ""
    Write-Host "Logs: docker compose -f docker-compose.minimal.yml logs -f"
    Write-Host "Stop: docker compose -f docker-compose.minimal.yml down"
} finally {
    Pop-Location
}
