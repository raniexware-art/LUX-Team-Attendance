$ErrorActionPreference = "Stop"

$taskNames = @(
  "TeamAttendance-CheckIn-Reminder",
  "TeamAttendance-CheckOut-Reminder",
  "TeamAttendance-Reminder-CatchUp"
)

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}

Write-Output "Windows Team Attendance reminders removed."
