# 작업 스케줄러에 "KAIST daily sync" 등록 (매일 07:00, 놓치면 로그온/부팅 뒤 바로 실행, 로그온 상태에서만).
# 다시 실행하면 덮어쓴다. 삭제: Unregister-ScheduledTask -TaskName 'KAIST daily sync' -Confirm:$false
param([string]$At = '07:00')
$script = Join-Path $PSScriptRoot 'daily-sync.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'KAIST daily sync' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'kaist sync --no-login (KAISTBOT)' -Force | Out-Null
Get-ScheduledTask -TaskName 'KAIST daily sync' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
