# Terminal 1 — Backend API (Flask)
# Usage: depuis la racine du repo
#   powershell -File scripts/start-backend.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location "$Root\backend"
$env:PYTHONPATH = (Get-Location).Path
$env:RAG_PROCESS = "api"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TERMINAL BACKEND — API Flask :5000" -ForegroundColor Cyan
Write-Host "  Logs: upload, enqueue, RAG, callbacks" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

& .\.venv\Scripts\python.exe run.py
