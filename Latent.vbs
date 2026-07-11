' Latent — launch the studio in a visible console window.
' Double-click this (or point the desktop shortcut at it) to run Latent.
' Stop it from inside the app (Console -> Quit), by closing the last tab, by
' closing this console window (or Ctrl+C in it), or with Stop Latent.cmd.
'
' Pre-flight: a missing prerequisite would otherwise fail before the console is
' useful, so we check the essentials here and show a message.
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

' Prerequisites OK — launch the studio in a visible console window that stays open
' for the app's whole life (1 = show window, False = don't wait for it to finish).
' Close this window (or Ctrl+C) to stop Latent.
sh.Run "cmd /c title Latent && node scripts\launch.mjs", 1, False
