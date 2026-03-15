#!/usr/bin/env pwsh
# ── MedVision — Local Development Startup ────────────────────────────────────
# Starts the FastAPI backend (port 8082) and Vite frontend (port 3000)
# in separate terminal windows.
#
# Prerequisites:
#   - Python installed with google-genai, fastapi, uvicorn (pip install -r backend/requirements.txt)
#   - Node.js installed (npm install run inside frontend/)
#   - backend/.env contains your GEMINI_API_KEY
#
# Usage:
#   .\start-dev.ps1
# ---------------------------------------------------------------------------

$Root = Split-Path $MyInvocation.MyCommand.Path

$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"

# ── Validate .env exists and has an API key ──────────────────────────────────
$envFile = Join-Path $BackendDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile not found." -ForegroundColor Red
    Write-Host "Create it from backend/.env.example and set GEMINI_API_KEY." -ForegroundColor Yellow
    exit 1
}
if (-not (Select-String -Path $envFile -Pattern "GEMINI_API_KEY=.+" -Quiet)) {
    Write-Host "WARNING: GEMINI_API_KEY appears empty in $envFile" -ForegroundColor Yellow
}

# ── Free port 8082 if something is already holding it ────────────────────────
$existing = Get-NetTCPConnection -LocalPort 8082 -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Freeing port 8082..." -ForegroundColor Cyan
    $existing | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

# ── Start backend ─────────────────────────────────────────────────────────────
Write-Host "Starting backend on http://localhost:8082 ..." -ForegroundColor Green
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$BackendDir'; python -m uvicorn main:app --host 0.0.0.0 --port 8082 --reload --log-level info"
)

Start-Sleep -Seconds 2

# ── Start frontend ────────────────────────────────────────────────────────────
Write-Host "Starting frontend on http://localhost:3000 ..." -ForegroundColor Green
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$FrontendDir'; npm run dev"
)

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  MedVision dev servers starting..."     -ForegroundColor Cyan
Write-Host "  Backend : http://localhost:8082"       -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000"       -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
