# Terminal 3 — Frontend (Next.js)
# Usage: depuis la racine du repo
#   powershell -File scripts/start-frontend.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location "$Root\frontend"

Write-Host "========================================" -ForegroundColor Green
Write-Host "  TERMINAL FRONTEND — Next.js :3000" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

npm run dev
