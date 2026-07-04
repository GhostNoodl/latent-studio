@echo off
REM Launches Latent with NO persistent console window (runs hidden via Latent.vbs).
REM This window may flash for a split second — that's expected; the app runs hidden.
REM View all logs in the app: sidebar -> Console.  (To watch raw startup logs for
REM troubleshooting, run:  node scripts\launch.mjs  in a terminal instead.)
cd /d "%~dp0"
start "" wscript.exe "%~dp0Latent.vbs"
