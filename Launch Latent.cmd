@echo off
REM Launches Latent in its own console window (via Latent.vbs). This launcher
REM window flashes for a split second, then a persistent "Latent" console opens
REM with all startup + backend + ComfyUI logs. Close that window (or Ctrl+C) to
REM stop everything. Logs are also viewable in-app: sidebar -> Console.
cd /d "%~dp0"
start "" wscript.exe "%~dp0Latent.vbs"
