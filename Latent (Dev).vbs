' Latent (dev) — hot-reload launch with no visible console window.
' Same as Latent.vbs but runs the dev servers (Vite HMR). Logs are in the in-app Console.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
' 0 = hidden window, False = don't wait for it to finish.
sh.Run "cmd /c node scripts\launch.mjs --dev", 0, False
