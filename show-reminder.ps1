param(
  [ValidateSet("check-in", "check-out", "catch-up")]
  [string]$Kind,
  [string]$CheckInTime,
  [string]$CheckOutTime
)

$ErrorActionPreference = "Stop"
$stateDirectory = Join-Path $env:LOCALAPPDATA "TeamAttendance\reminders"
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$today = Get-Date -Format "yyyy-MM-dd"

function Show-Reminder([string]$ReminderKind) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $notification = New-Object System.Windows.Forms.NotifyIcon
  $notification.Icon = [System.Drawing.SystemIcons]::Information
  $notification.BalloonTipTitle = if ($ReminderKind -eq "check-in") { "Time to check in" } else { "Time to check out" }
  $notification.BalloonTipText = if ($ReminderKind -eq "check-in") {
    "Please check in to Team Attendance."
  } else {
    "Please check out of Team Attendance."
  }
  $notification.Visible = $true
  $notification.ShowBalloonTip(10000)
  Start-Sleep -Seconds 12
  $notification.Dispose()
}

function Send-ReminderOnce([string]$ReminderKind, [string]$ScheduledTime) {
  $timeKey = $ScheduledTime.Replace(":", "")
  $markerPath = Join-Path $stateDirectory "$today-$ReminderKind-$timeKey"
  if (Test-Path $markerPath) {
    return
  }

  Show-Reminder $ReminderKind
  Set-Content -Path $markerPath -Value (Get-Date -Format o) -Encoding UTF8
}

if ($Kind -eq "catch-up") {
  $now = Get-Date
  if ($now.TimeOfDay -ge [TimeSpan]::ParseExact($CheckInTime, "hh\:mm", $null)) {
    Send-ReminderOnce "check-in" $CheckInTime
  }
  if ($now.TimeOfDay -ge [TimeSpan]::ParseExact($CheckOutTime, "hh\:mm", $null)) {
    Send-ReminderOnce "check-out" $CheckOutTime
  }
} else {
  $scheduledTime = if ($Kind -eq "check-in") { $CheckInTime } else { $CheckOutTime }
  Send-ReminderOnce $Kind $scheduledTime
}
