# Terminal 2 — Pipeline (RQ worker) — SÉPARÉ du backend
# Usage: depuis la racine du repo
#   powershell -File scripts/start-pipeline.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location "$Root\backend"
$env:PYTHONPATH = (Get-Location).Path
$env:RAG_PROCESS = "pipeline"

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  TERMINAL PIPELINE — indexation docs" -ForegroundColor Yellow
Write-Host "  Logs: réception job, étapes 1-6, succès" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

& .\.venv\Scripts\python.exe run_pipeline.py
