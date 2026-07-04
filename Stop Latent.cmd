@echo off
REM Stops Latent (and the ComfyUI it manages) via the in-app shutdown endpoint.
setlocal
set "PORT=4000"
if exist "%~dp0.env" for /f "usebackq tokens=1,2 delims==" %%A in ("%~dp0.env") do if /I "%%A"=="PORT" set "PORT=%%B"

echo Stopping Latent on port %PORT% ...
powershell -NoProfile -Command ^
  "try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:%PORT%/api/shutdown') -TimeoutSec 5 | Out-Null; Write-Host 'Shutdown requested.' } catch { Write-Host 'Latent did not respond; killing node processes...'; taskkill /F /IM node.exe /T 2>$null | Out-Null }"

echo Done.
timeout /t 2 >nul
