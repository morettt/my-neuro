Option Explicit

' Keep the host injectable so error-window routing can be checked without UI.
Function LaunchTutorial(shell, fso, scriptPath)
    Dim projectDir, taskEnv, logDir, exitCode, failureCode
    projectDir = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(scriptPath)))
    shell.CurrentDirectory = projectDir
    Set taskEnv = shell.Environment("PROCESS")
    taskEnv.Item("MY_NEURO_DOCS_LOG_DIR") = ""
    taskEnv.Item("MY_NEURO_DOCS_BOOTSTRAP_ERROR") = ""
    exitCode = 1

    On Error Resume Next
    logDir = fso.BuildPath(fso.GetSpecialFolder(2), "my-neuro-docs-" & fso.GetTempName)
    fso.CreateFolder logDir
    If Err.Number = 0 Then
        taskEnv.Item("MY_NEURO_DOCS_LOG_DIR") = logDir
        exitCode = shell.Run("""%ComSpec%"" /d /c docs\scripts\open-tutorial.cmd <nul", 0, True)
    End If
    failureCode = Err.Number
    Err.Clear
    On Error GoTo 0

    If failureCode <> 0 Then
        taskEnv.Item("MY_NEURO_DOCS_BOOTSTRAP_ERROR") = CStr(failureCode)
    End If

    If exitCode <> 0 Or failureCode <> 0 Then
        shell.Run """%ComSpec%"" /d /k docs\scripts\open-tutorial.cmd --error", 1, False
        LaunchTutorial = 1
    Else
        LaunchTutorial = 0
    End If
End Function

WScript.Quit LaunchTutorial(CreateObject("WScript.Shell"), CreateObject("Scripting.FileSystemObject"), WScript.ScriptFullName)
