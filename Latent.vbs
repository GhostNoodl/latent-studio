' Latent — launch the studio with no visible console window.
' Double-click this (or point the desktop shortcut at it) to run Latent hidden.
' Stop it from inside the app (Console -> Quit), by closing the last tab, or Stop Latent.cmd.
'
' Pre-flight: the real launch runs HIDDEN, so a missing prerequisite would fail
' silently ("nothing happens"). We check the essentials here and show a message.
'   Node.js  — required to start at all (fatal).
'   git      — required to set up ComfyUI's custom nodes (warn, but keep going).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

' `<tool> --version` exits non-zero (9009 "not recognized") when the tool is missing.
nodeOk = (sh.Run("cmd /c node --version", 0, True) = 0)
gitOk  = (sh.Run("cmd /c git --version", 0, True) = 0)

If Not nodeOk Then
  msg = "Latent needs Node.js (version 20 or newer), which doesn't appear to be installed." & vbCrLf
  If Not gitOk Then msg = msg & "It also needs git (for ComfyUI setup)." & vbCrLf
  msg = msg & vbCrLf & "Click OK to open the download page(s). Install the tool(s), then run Latent again."
  If MsgBox(msg, vbOKCancel Or vbExclamation, "Latent - missing requirements") = vbOK Then
    sh.Run "https://nodejs.org/en/download"
    If Not gitOk Then sh.Run "https://git-scm.com/download/win"
  End If
  WScript.Quit
End If

If Not gitOk Then
  msg = "Heads up: git isn't installed. Latent needs it to set up ComfyUI's custom nodes." & vbCrLf & vbCrLf & _
        "Click OK to open the git download page (install it before finishing ComfyUI setup). Latent will keep starting."
  If MsgBox(msg, vbOKCancel Or vbInformation, "Latent - git recommended") = vbOK Then
    sh.Run "https://git-scm.com/download/win"
  End If
End If

' Prerequisites OK — launch the studio hidden (0 = no window, False = don't wait).
sh.Run "cmd /c node scripts\launch.mjs", 0, False
