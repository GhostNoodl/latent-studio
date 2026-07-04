@echo off
REM Dev (hot-reload) launch with NO persistent console window (via Latent (Dev).vbs).
REM This window may flash briefly — the app runs hidden. Logs: sidebar -> Console.
cd /d "%~dp0"
start "" wscript.exe "%~dp0Latent (Dev).vbs"
