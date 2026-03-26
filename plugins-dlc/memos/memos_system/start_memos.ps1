# MemOS v2.0 Startup Script
$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  MemOS Memory System v2.0" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

# Clean port and lock file
Write-Host "`n[1] Cleaning up..." -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Remove-Item "data\qdrant\.lock" -Force -ErrorAction SilentlyContinue

Write-Host "[2] Starting server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  API:  http://127.0.0.1:8003" -ForegroundColor Green
Write-Host "  Docs: http://127.0.0.1:8003/docs" -ForegroundColor Green
Write-Host ""
Write-Host "  Loading model... (15-20 seconds)" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

python api\memos_api_server_v2.py

Write-Host "`nServer stopped." -ForegroundColor Red
Read-Host "Press Enter to exit"
