# 매일 자동 sync (작업 스케줄러 "KAIST daily sync"가 실행). 등록: scripts\register-daily-sync.ps1
# - 로그인 창을 띄우지 않는다(--no-login). 세션이 만료되면 Windows 알림으로 알린다.
# - 로그에는 요약 숫자만 남긴다(상태, 변경 수, 경고 수, 종료 코드). 제목·본문·개인정보는 남기지 않는다.
# 네이티브 명령의 stderr(진행 메시지)를 오류로 보지 않도록 Continue
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'kaist-cli\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ('daily-' + (Get-Date -Format 'yyyyMM') + '.log')

function Notify([string]$title, [string]$body) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $t = $xml.GetElementsByTagName('text')
    $t.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null
    $t.Item(1).AppendChild($xml.CreateTextNode($body)) | Out-Null
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  } catch { }
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Add-Content $log "$(Get-Date -Format s) node 없음"; Notify 'KAIST sync 실패' 'node를 찾지 못했습니다.'; exit 1 }

# node 출력(UTF-8)을 그대로 읽는다. 기본 콘솔 코드페이지로 읽으면 한글이 깨져 JSON 해석이 실패한다
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = & $node (Join-Path $repo 'dist\cli.js') sync --no-login --json 2>$null
$code = $LASTEXITCODE
$status = '?'; $changes = 0; $warnings = 0; $candidates = 0
try {
  $j = ($out -join "`n") | ConvertFrom-Json
  $status = $j.status
  $changes = @($j.changes).Count
  $warnings = @($j.warnings).Count
  if ($j.candidates) { $candidates = $j.candidates.newCandidates }
} catch { $status = 'parse-error' }
Add-Content $log "$(Get-Date -Format s) exit=$code status=$status changes=$changes warnings=$warnings newCandidates=$candidates"

if ($code -eq 2) { Notify 'KAIST sync: 로그인 필요' 'KLMS 세션이 만료됐습니다. PC에서 kaist login (폰 승인 1회) 후 kaist sync.' }
elseif ($code -ne 0) { Notify 'KAIST sync 실패' "종료 코드 $code. PC에서 kaist sync로 확인해 주세요." }
elseif ($changes -gt 0 -or $candidates -gt 0) { Notify 'KAIST sync 완료' "새 변경 $changes건, 학사 일정 후보 $candidates건. kaist changes로 확인." }
exit $code
