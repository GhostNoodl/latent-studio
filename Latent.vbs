' Latent — launch the studio with no visible console window.
' Double-click this (or point the desktop shortcut at it) to run Latent hidden.
' Stop it from inside the app (Console -> Quit), by closing the last tab, or Stop Latent.cmd.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
' 0 = hidden window, False = don't wait for it to finish.
sh.Run "cmd /c node scripts\launch.mjs", 0, False
