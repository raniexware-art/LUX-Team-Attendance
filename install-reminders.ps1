$ErrorActionPreference = "Stop"

$appRoot = $PSScriptRoot
$appScript = Join-Path $appRoot "app.js"
$notificationScript = Join-Path $PSScriptRoot "show-reminder.ps1"
if (!(Test-Path $appScript) -or !(Test-Path $notificationScript)) {
  throw "The reminder scripts or app.js could not be found."
}

$appSource = Get-Content -Path $appScript -Raw
$scheduleMatch = [regex]::Match(
  $appSource,
  'const EMPLOYEE_REMINDER_TIMES\s*=\s*\{\s*morning:\s*"(\d{2}:\d{2})",\s*evening:\s*"(\d{2}:\d{2})"\s*\};'
)
if (!$scheduleMatch.Success) {
  throw "Could not read the check-in and check-out times from app.js."
}

$checkInTime = $scheduleMatch.Groups[1].Value
$checkOutTime = $scheduleMatch.Groups[2].Value
foreach ($time in @($checkInTime, $checkOutTime)) {
  $parsedTime = [datetime]::MinValue
  if (![datetime]::TryParseExact(
      $time,
      "HH:mm",
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None,
      [ref]$parsedTime
    )) {
    throw "Invalid reminder time in app.js: $time"
  }
}

$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

function Register-ReminderTask([string]$name, $trigger, [string]$kind) {
  $arguments = "-NoProfile -WindowStyle Hidden -File `"$notificationScript`" -Kind $kind -CheckInTime $checkInTime -CheckOutTime $checkOutTime"
  $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments
  Register-ScheduledTask `
    -TaskName $name `
    -Description "Team Attendance $kind reminder" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
}

$checkInDate = [datetime]::Today.AddHours([int]$checkInTime.Substring(0, 2)).AddMinutes([int]$checkInTime.Substring(3, 2))
$checkOutDate = [datetime]::Today.AddHours([int]$checkOutTime.Substring(0, 2)).AddMinutes([int]$checkOutTime.Substring(3, 2))
$checkInTrigger = New-ScheduledTaskTrigger -Daily -At $checkInDate
$checkOutTrigger = New-ScheduledTaskTrigger -Daily -At $checkOutDate
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

Register-ReminderTask "TeamAttendance-CheckIn-Reminder" $checkInTrigger "check-in"
Register-ReminderTask "TeamAttendance-CheckOut-Reminder" $checkOutTrigger "check-out"
Register-ReminderTask "TeamAttendance-Reminder-CatchUp" $logonTrigger "catch-up"

& $notificationScript -Kind "catch-up" -CheckInTime $checkInTime -CheckOutTime $checkOutTime

Write-Output "Windows reminders installed for $checkInTime (check-in) and $checkOutTime (check-out)."
Write-Output "If Windows is signed out at a reminder time, a missed reminder can appear after you sign in later that day."
