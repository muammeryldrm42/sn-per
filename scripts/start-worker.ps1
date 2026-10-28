# Runs the Talons worker on this Windows PC and opens a free Cloudflare quick tunnel to it.
# Usage (PowerShell, in the project folder):  powershell -ExecutionPolicy Bypass -File scripts\start-worker.ps1
# Keep both windows open. The https URL printed by cloudflared goes into NEXT_PUBLIC_WORKER_URL on Vercel.
# Quick tunnel URLs change every time the tunnel restarts; for a fixed URL use a VM (see README).

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 22 is needed: https://nodejs.org" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing packages..."
  npm ci --no-audit --no-fund
}

$data = Join-Path (Get-Location) "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null
Write-Host "Starting the worker on http://localhost:8787 (data in $data)" -ForegroundColor Green
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "set PORT=8787&& set DATA_DIR=$data&& npm run worker" -WorkingDirectory (Get-Location)

Start-Sleep -Seconds 8
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "cloudflared is not installed. Install it with:  winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
  Write-Host "Then run this script again. The worker keeps running at http://localhost:8787 meanwhile."
  exit 0
}
Write-Host "Opening the tunnel. Copy the https://....trycloudflare.com URL below into Vercel (NEXT_PUBLIC_WORKER_URL)." -ForegroundColor Green
cloudflared tunnel --no-autoupdate --url http://localhost:8787
