' Latent (dev) — hot-reload launch with no visible console window.
' Same as Latent.vbs but runs the dev servers (Vite HMR). Logs are in the in-app Console.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

' Node.js pre-flight (the hidden launch would fail silently without it).
If sh.Run("cmd /c node --version", 0, True) <> 0 Then
  msg = "Latent needs Node.js (version 20 or newer), which doesn't appear to be installed." & vbCrLf & vbCrLf & _
        "Click OK to open the download page. Install the LTS version, reopen, then run Latent again."
  If MsgBox(msg, vbOKCancel Or vbExclamation, "Latent - Node.js required") = vbOK Then
    sh.Run "https://nodejs.org/en/download"
  End If
  WScript.Quit
End If

' 0 = hidden window, False = don't wait for it to finish.
sh.Run "cmd /c node scripts\launch.mjs --dev", 0, False
