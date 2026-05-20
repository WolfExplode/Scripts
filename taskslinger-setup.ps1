# ============================================
# TaskSlinger Setup Script
# run this script in powershell with 
# Set-ExecutionPolicy Bypass -Scope Process -Force
# .\taskslinger-setup.ps1              # prompts for Install / Check / Uninstall
# .\taskslinger-setup.ps1 -Check         # verify installation
# .\taskslinger-setup.ps1 -Install       # install
# .\taskslinger-setup.ps1 -Uninstall     # remove

# The purpose of this script is to allow users to launch TaskSlinger without Ctrl+shift+esc triggering windows UAC
# to change UAC, search "user account control settings" in windows settings
# ============================================

param(
    [switch]$Check,
    [switch]$Install,
    [switch]$Uninstall
)

$modeFlags = @($Check.IsPresent, $Install.IsPresent, $Uninstall.IsPresent) | Where-Object { $_ }
if ($modeFlags.Count -gt 1) {
    throw "Specify only one of -Check, -Install, or -Uninstall."
}

if ($modeFlags.Count -eq 0) {
    Write-Host "`nTaskSlinger Setup`n" -ForegroundColor Cyan
    Write-Host "  1 - Install"
    Write-Host "  2 - Check installation"
    Write-Host "  3 - Uninstall"
    Write-Host ""
    do {
        $choice = Read-Host "Enter choice (1-3)"
    } while ($choice -notin @("1", "2", "3"))

    switch ($choice) {
        "1" { $Install = $true }
        "2" { $Check = $true }
        "3" { $Uninstall = $true }
    }
}

if ($Check) { $Mode = "Check_install" }
elseif ($Uninstall) { $Mode = "Uninstall" }
else { $Mode = "Install" }

$ModeArgs = switch ($Mode) {
    "Check_install" { @("-Check") }
    "Uninstall"     { @("-Uninstall") }
    default         { @("-Install") }
}

# ---- Self-elevate if not running as Administrator (Install/Uninstall only) ----
if ($Mode -eq "Install" -or $Mode -eq "Uninstall") {
    $CurrentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $CurrentPrincipal = New-Object System.Security.Principal.WindowsPrincipal($CurrentIdentity)
    $IsAdmin = $CurrentPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $IsAdmin) {
        $PowerShellExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
        $ScriptPath = $PSCommandPath

        if (-not $ScriptPath) {
            throw "Please save this script as a .ps1 file first, then run it again."
        }

        $elevatedArgs = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$ScriptPath`""
        ) + $ModeArgs

        Start-Process `
            -FilePath $PowerShellExe `
            -ArgumentList $elevatedArgs `
            -Verb RunAs

        exit
    }
}

# ---- Resolve TaskSlinger path for the current user ----
$TaskSlingerExe = Join-Path $env:LOCALAPPDATA "taskslinger.exe"

# ---- Names and paths ----
$TaskName = "TaskSlingerElevated"
$LauncherDir = Join-Path $env:ProgramData "TaskSlinger"
$LauncherVbs = Join-Path $LauncherDir "LaunchTaskSlingerElevated.vbs"
$LauncherPs1 = Join-Path $LauncherDir "LaunchTaskSlingerElevated.ps1"
$LauncherCmd = Join-Path $LauncherDir "LaunchTaskSlingerElevated.cmd"
$LogFile = Join-Path $LauncherDir "launcher.log"
$IFEOKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\taskmgr.exe"

# ============================================
# CHECK INSTALL MODE
# ============================================
if ($Mode -eq "Check_install") {
    Write-Host "`n=== TaskSlinger Installation Check ===`n" -ForegroundColor Cyan

    $allOk = $true

    # Check 1: TaskSlinger.exe exists
    if (Test-Path $TaskSlingerExe) {
        Write-Host "[OK]   TaskSlinger.exe found at: $TaskSlingerExe" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] TaskSlinger.exe NOT found at: $TaskSlingerExe" -ForegroundColor Red
        $allOk = $false
    }

    # Check 2: Launcher directory
    if (Test-Path $LauncherDir) {
        Write-Host "[OK]   Launcher directory exists: $LauncherDir" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] Launcher directory NOT found: $LauncherDir" -ForegroundColor Red
        $allOk = $false
    }

    # Check 3: VBScript launcher
    if (Test-Path $LauncherVbs) {
        Write-Host "[OK]   VBScript launcher exists: $LauncherVbs" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] VBScript launcher NOT found: $LauncherVbs" -ForegroundColor Red
        $allOk = $false
    }

    # Check 4: Scheduled task
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "[OK]   Scheduled task '$TaskName' exists" -ForegroundColor Green
        Write-Host "       State: $($task.State)" -ForegroundColor Gray
        Write-Host "       Task Path: $($task.TaskPath)" -ForegroundColor Gray
    } else {
        Write-Host "[MISSING] Scheduled task '$TaskName' NOT found" -ForegroundColor Red
        $allOk = $false
    }

    # Check 5: IFEO registry key
    $ifeo = Get-ItemProperty -Path $IFEOKey -Name "Debugger" -ErrorAction SilentlyContinue
    if ($ifeo -and $ifeo.Debugger -like "*wscript.exe*$LauncherVbs*") {
        Write-Host "[OK]   IFEO redirect is active" -ForegroundColor Green
        Write-Host "       Debugger: $($ifeo.Debugger)" -ForegroundColor Gray
    } else {
        Write-Host "[MISSING] IFEO redirect NOT configured or points elsewhere" -ForegroundColor Red
        $allOk = $false
    }

    # Check 6: Log file (optional, just info)
    if (Test-Path $LogFile) {
        Write-Host "[INFO] Log file exists: $LogFile" -ForegroundColor Yellow
        $lastLines = Get-Content $LogFile -Tail 3 -ErrorAction SilentlyContinue
        if ($lastLines) {
            Write-Host "       Last 3 log entries:" -ForegroundColor DarkGray
            $lastLines | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
        }
    } else {
        Write-Host "[INFO] No log file yet (normal if never launched)" -ForegroundColor Yellow
    }

    # Summary
    Write-Host "`n----------------------------------------" -ForegroundColor Cyan
    if ($allOk) {
        Write-Host "RESULT: FULLY INSTALLED" -ForegroundColor Green
        Write-Host "Press Ctrl+Shift+Esc to launch TaskSlinger." -ForegroundColor Green
    } else {
        Write-Host "RESULT: NOT FULLY INSTALLED" -ForegroundColor Red
        Write-Host "Run with -Install to fix missing components." -ForegroundColor Yellow
    }
    Write-Host "----------------------------------------`n" -ForegroundColor Cyan

    exit
}

# ============================================
# UNINSTALL MODE
# ============================================
if ($Mode -eq "Uninstall") {
    Write-Host "`n=== TaskSlinger Uninstall ===`n" -ForegroundColor Cyan

    # Remove scheduled task
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[REMOVED] Scheduled task '$TaskName'" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] Scheduled task '$TaskName' not found" -ForegroundColor Yellow
    }

    # Remove IFEO registry key
    if (Test-Path $IFEOKey) {
        Remove-Item -Path $IFEOKey -Recurse -Force
        Write-Host "[REMOVED] IFEO registry key for taskmgr.exe" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] IFEO registry key not found" -ForegroundColor Yellow
    }

    # Remove launcher files
    if (Test-Path $LauncherVbs) {
        Remove-Item -Path $LauncherVbs -Force
        Write-Host "[REMOVED] VBScript launcher" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] VBScript launcher not found" -ForegroundColor Yellow
    }

    if (Test-Path $LauncherPs1) {
        Remove-Item -Path $LauncherPs1 -Force
        Write-Host "[REMOVED] Old PS1 launcher" -ForegroundColor Green
    }

    if (Test-Path $LauncherCmd) {
        Remove-Item -Path $LauncherCmd -Force
        Write-Host "[REMOVED] Old CMD launcher" -ForegroundColor Green
    }

    if (Test-Path $LogFile) {
        Remove-Item -Path $LogFile -Force
        Write-Host "[REMOVED] Log file" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] Log file not found" -ForegroundColor Yellow
    }

    # Remove launcher directory if empty
    if (Test-Path $LauncherDir) {
        $remaining = Get-ChildItem -Path $LauncherDir -Force
        if (-not $remaining) {
            Remove-Item -Path $LauncherDir -Force
            Write-Host "[REMOVED] Empty launcher directory" -ForegroundColor Green
        } else {
            Write-Host "[INFO] Launcher directory not empty, keeping: $LauncherDir" -ForegroundColor Yellow
        }
    }

    # Note: We do NOT remove TaskSlinger.exe from LOCALAPPDATA
    # That's the user's application, not our launcher infrastructure
    if (Test-Path $TaskSlingerExe) {
        Write-Host "[INFO] TaskSlinger.exe left in place at: $TaskSlingerExe" -ForegroundColor Yellow
        Write-Host "       (Delete manually if desired)" -ForegroundColor DarkGray
    }

    Write-Host "`n----------------------------------------" -ForegroundColor Cyan
    Write-Host "UNINSTALL COMPLETE" -ForegroundColor Green
    Write-Host "Task Manager (taskmgr.exe) should work normally now." -ForegroundColor Green
    Write-Host "----------------------------------------`n" -ForegroundColor Cyan

    exit
}

# ============================================
# INSTALL MODE
# ============================================
if ($Mode -eq "Install") {
    Write-Host "`n=== TaskSlinger Install ===`n" -ForegroundColor Cyan

    # ---- Validate TaskSlinger path ----
    if (-not (Test-Path $TaskSlingerExe)) {
        throw "TaskSlinger.exe not found at: $TaskSlingerExe"
    }
    Write-Host "[OK] TaskSlinger.exe found" -ForegroundColor Green

    # ---- Create launcher folder ----
    New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null
    Write-Host "[OK] Launcher directory ready: $LauncherDir" -ForegroundColor Green

    # ---- Remove old launchers that may cause a visible flash ----
    Remove-Item -Path $LauncherPs1 -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $LauncherCmd -Force -ErrorAction SilentlyContinue

    # ---- Create invisible VBScript launcher ----
    # If taskslinger.exe is missing, launch a renamed copy of Taskmgr.exe
    # (IFEO only hooks the image name "taskmgr.exe", so a different name bypasses it).
    @"
Option Explicit

Dim shell
Dim fso
Dim logFile
Dim command
Dim result
Dim taskSlingerExe
Dim windir
Dim tmFallback

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

logFile = "$($LogFile.Replace('\', '\\'))"
windir = shell.ExpandEnvironmentStrings("%WINDIR%")
taskSlingerExe = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\taskslinger.exe"

On Error Resume Next

Dim log
Set log = fso.OpenTextFile(logFile, 8, True)
log.WriteLine Now & " - Launcher started"

If fso.FileExists(taskSlingerExe) Then
    command = """" & windir & "\System32\schtasks.exe"" /run /tn ""$TaskName"""
    log.WriteLine Now & " - TaskSlinger found, running scheduled task"
    log.WriteLine Now & " - Command: " & command
    result = shell.Run(command, 0, False)
    log.WriteLine Now & " - Shell.Run result: " & result
Else
    log.WriteLine Now & " - TaskSlinger NOT found, falling back to Task Manager"
    tmFallback = fso.BuildPath(shell.ExpandEnvironmentStrings("%TEMP%"), "TaskSlingerFallback_taskmgr.exe")
    fso.CopyFile windir & "\System32\Taskmgr.exe", tmFallback, True
    result = shell.Run("""" & tmFallback & """", 1, False)
    log.WriteLine Now & " - Fallback Task Manager launched, result: " & result
End If

log.Close
"@ | Set-Content -Path $LauncherVbs -Encoding ASCII

    Write-Host "[OK] VBScript launcher created" -ForegroundColor Green

    # ---- Remove old scheduled task if it exists ----
    Unregister-ScheduledTask `
        -TaskName $TaskName `
        -Confirm:$false `
        -ErrorAction SilentlyContinue

    # ---- Create elevated scheduled task that starts TaskSlinger directly ----
    $TaskSlingerDir = Split-Path $TaskSlingerExe

    $Action = New-ScheduledTaskAction `
        -Execute $TaskSlingerExe `
        -WorkingDirectory $TaskSlingerDir

    $Principal = New-ScheduledTaskPrincipal `
        -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive `
        -RunLevel Highest

    $Settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0)

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Principal $Principal `
        -Settings $Settings `
        -Force | Out-Null

    Write-Host "[OK] Scheduled task '$TaskName' created with highest privileges" -ForegroundColor Green

    # ---- Redirect taskmgr.exe launches to wscript.exe ----
    $WScriptExe = "$env:WINDIR\System32\wscript.exe"

    New-Item -Path $IFEOKey -Force | Out-Null

    Set-ItemProperty `
        -Path $IFEOKey `
        -Name "Debugger" `
        -Value "`"$WScriptExe`" `"$LauncherVbs`""

    Write-Host "[OK] IFEO redirect configured for taskmgr.exe" -ForegroundColor Green

    # ---- Test scheduled task directly ----
    schtasks /run /tn "$TaskName"

    Write-Host "`n----------------------------------------" -ForegroundColor Cyan
    Write-Host "INSTALL COMPLETE" -ForegroundColor Green
    Write-Host "Press Ctrl+Shift+Esc to test TaskSlinger." -ForegroundColor Green
    Write-Host "Log file: $LogFile" -ForegroundColor Gray
    Write-Host "----------------------------------------`n" -ForegroundColor Cyan

    exit
}

# If we get here, the mode was invalid
Write-Error "Invalid mode: '$Mode'. Use -Check, -Install, or -Uninstall."
exit 1