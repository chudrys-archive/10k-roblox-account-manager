' Starts Isa's Roblox Account Manager without a console window.
' If it is already running, this just opens its window.
' Quit from the app (sidebar > Quit). Your Roblox clients keep running either way.
Option Explicit
Dim sh, fso, dir, args, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " " & WScript.Arguments(i)
Next
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js is not installed. Install the LTS version from https://nodejs.org and try again.", 16, "Roblox Account Manager"
  WScript.Quit 1
End If
sh.Run "node """ & dir & "\src\main.js""" & args, 0, False
