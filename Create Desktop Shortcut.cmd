@echo off
REM Creates a "Latent" shortcut on your Desktop that launches the app.
setlocal
set "ICON=%~dp0frontend\dist\favicon.ico"
if not exist "%ICON%" set "ICON=%SystemRoot%\System32\shell32.dll,43"
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Latent.lnk');" ^
  "$lnk.TargetPath = '%~dp0Latent.vbs';" ^
  "$lnk.WorkingDirectory = '%~dp0';" ^
  "$lnk.IconLocation = '%ICON%';" ^
  "$lnk.Description = 'Launch Latent — ComfyUI Studio';" ^
  "$lnk.Save()"
echo Done. A "Latent" shortcut is on your Desktop.
echo (If the icon looks generic, run Launch Latent once to build it, then re-run this.)
pause
