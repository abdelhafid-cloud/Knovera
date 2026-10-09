# Terminal PIPELINE — indexation (dossier pipeline/, séparé du backend)
# Usage: depuis la racine du repo
#   powershell -File scripts/start-pipeline.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:RAG_PROCESS = "pipeline"
$env:PYTHONPATH = $Root

# Venv pipeline (Mistral OCR = API, plus besoin de Python 3.12 obligatoire)
$VenvPython = Join-Path $Root "pipeline\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    $VenvPython = Join-Path $Root "pipeline\.venv312\Scripts\python.exe"
}
if (-not (Test-Path $VenvPython)) {
    $VenvPython = Join-Path $Root "backend\.venv\Scripts\python.exe"
}
if (-not (Test-Path $VenvPython)) {
    $VenvPython = "python"
}

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  TERMINAL PIPELINE — dossier pipeline/" -ForegroundColor Yellow
Write-Host "  Logs: job, extract, OCR, embed, Qdrant" -ForegroundColor Yellow
Write-Host "  Python: $VenvPython" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

& $VenvPython -m pipeline.run
