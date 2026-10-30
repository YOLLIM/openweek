# 서버의 최신 백업을 이 PC 로 내려받는다. 작업 스케줄러가 매일 실행한다.
#   powershell -ExecutionPolicy Bypass -File pull-backup.ps1
param(
  [string]$Server = '35.239.228.66',
  [string]$Dir = 'D:\ANTI\openweek-backup',
  [int]$Keep = 30,
  [int]$WarnDays = 3,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

$key = "$env:USERPROFILE\.ssh\openweek_backup"
$known = "$env:USERPROFILE\.ssh\openweek_known_hosts"
$log = Join-Path $Dir 'pull-backup.log'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

function Write-Log($msg) {
  Add-Content -Encoding UTF8 -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg)
}

# 출력이 바이너리라 PowerShell 파이프 · 리다이렉트를 거치지 않고 스트림으로 직접 받는다
function Invoke-Remote($cmd, [IO.Stream]$out) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = "$env:SystemRoot\System32\OpenSSH\ssh.exe"
  $psi.Arguments = "-i `"$key`" -o BatchMode=yes -o ConnectTimeout=30 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=`"$known`" owbackup@$Server $cmd"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.StandardOutput.BaseStream.CopyTo($out)
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "ssh $cmd 실패 ($($p.ExitCode)): $($errTask.Result.Trim())" }
}

try {
  $mem = New-Object IO.MemoryStream
  Invoke-Remote 'name' $mem
  $name = [Text.Encoding]::ASCII.GetString($mem.ToArray()).Trim()
  if ($name -notmatch '^data-\d{8}\.tgz$') { throw "이상한 백업 파일 이름: $name" }

  $dest = Join-Path $Dir $name
  if (Test-Path $dest) {
    Write-Log "이미 있음: $name"
  } else {
    $tmp = "$dest.tmp"
    $fs = [IO.File]::Create($tmp)
    try { Invoke-Remote 'get' $fs } finally { $fs.Close() }

    # 받은 파일이 온전한 압축 파일이고 핵심 데이터가 들어 있어야 저장한다
    $list = & "$env:SystemRoot\System32\tar.exe" -tzf $tmp
    if ($LASTEXITCODE -ne 0 -or $list -notcontains 'data/db.json') {
      [IO.File]::Delete($tmp)
      throw "손상된 백업 파일: $name"
    }
    [IO.File]::Move($tmp, $dest)
    Write-Log "저장: $name ($((Get-Item $dest).Length) bytes)"
  }

  Get-ChildItem $Dir -Filter 'data-*.tgz' | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object {
    [IO.File]::Delete($_.FullName)
    Write-Log "오래된 백업 삭제: $($_.Name)"
  }
} catch {
  Write-Log "실패: $_"
  if ($Quiet) { throw }
}

# 내려받기가 며칠째 안 되면 조용히 지나가지 않게 알린다
$newest = Get-ChildItem $Dir -Filter 'data-*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Quiet -and (-not $newest -or $newest.LastWriteTime -lt (Get-Date).AddDays(-$WarnDays))) {
  $msg = "주간업무보고 서버 백업을 $WarnDays 일 넘게 내려받지 못했습니다.`n로그: $log"
  (New-Object -ComObject WScript.Shell).Popup($msg, 0, '주간업무보고 백업', 48) | Out-Null
}
