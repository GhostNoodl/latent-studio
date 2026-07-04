' Latent — launch the studio with no visible console window.
' Double-click this (or point the desktop shortcut at it) to run Latent hidden.
' Stop it from inside the app (Console -> Quit), by closing the last tab, or Stop Latent.cmd.
'
' Pre-flight: Node.js is required. Because the real launch runs HIDDEN, a missing
' Node would fail silently ("nothing happens"), so we check for it here first and
' show a friendly message instead.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

' `node --version` exits non-zero (9009 "not recognized") when Node isn't installed.
If sh.Run("cmd /c node --version", 0, True) <> 0 Then
  msg = "Latent needs Node.js (version 20 or newer), which doesn't appear to be installed." & vbCrLf & vbCrLf & _
        "Click OK to open the download page. Install the LTS version, reopen, then run Latent again."
  If MsgBox(msg, vbOKCancel Or vbExclamation, "Latent - Node.js required") = vbOK Then
    sh.Run "https://nodejs.org/en/download"
  End If
  WScript.Quit
End If

' Node is present — launch the studio hidden (0 = no window, False = don't wait).
sh.Run "cmd /c node scripts\launch.mjs", 0, False
