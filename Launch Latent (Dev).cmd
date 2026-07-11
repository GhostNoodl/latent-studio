@echo off
REM Dev (hot-reload) launch in its own console window (via Latent (Dev).vbs).
REM This launcher window flashes briefly, then a persistent "Latent (dev)" console
REM opens with all logs. Close it (or Ctrl+C) to stop. Logs also: sidebar -> Console.
cd /d "%~dp0"
start "" wscript.exe "%~dp0Latent (Dev).vbs"
