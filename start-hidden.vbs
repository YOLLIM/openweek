' openweek: run the weekly-report server hidden (supervisor.js restarts it if it stops)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "node """ & dir & "\supervisor.js""", 0, False
