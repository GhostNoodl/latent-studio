' Latent (dev) — hot-reload launch in a visible console window.
' Same as Latent.vbs but runs the dev servers (Vite HMR). Logs stream to this
' console (and to the in-app Console). Close the window or Ctrl+C to stop.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

' Prerequisite pre-flight (the hidden launch would fail silently without these).
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
        "Click OK to open the git download page. Latent will keep starting."
  If MsgBox(msg, vbOKCancel Or vbInformation, "Latent - git recommended") = vbOK Then
    sh.Run "https://git-scm.com/download/win"
  End If
End If

' 1 = show a console window (stays open for the app's life), False = don't wait.
sh.Run "cmd /c title Latent dev && node scripts\launch.mjs --dev", 1, False
