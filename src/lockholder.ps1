# Multi-instance lock holder for 10k's Account Manager.
#
# Roblox clients keep polling the ROBLOX_singletonMutex. Whoever owns it is "the" client and the
# others get told to close. This process owns the mutex so no client ever can. It runs detached
# from the manager on purpose: if the manager restarts or crashes, the lock stays held and your
# clients keep running.
#
# Exits (releasing the lock) when:
#   - <DataDir>\lockholder.stop exists (manager turned multi-instance off), or
#   - the manager is not running AND no Roblox client is left.
# Status is written to <DataDir>\lockholder.json every few seconds.

param([Parameter(Mandatory = $true)][string]$DataDir)

$ErrorActionPreference = 'Continue'
$logFile = Join-Path $DataDir 'logs\lockholder.log'
function Write-HolderLog([string]$m) { try { Add-Content -Path $logFile -Value ("{0} [{1}] {2}" -f [DateTime]::UtcNow.ToString('o'), $PID, $m) } catch { } }
trap { Write-HolderLog ("fatal: " + $_.Exception.Message); break }
$statusFile = Join-Path $DataDir 'lockholder.json'
$stopFile = Join-Path $DataDir 'lockholder.stop'
$lockFile = Join-Path $DataDir 'manager.lock'
Remove-Item $stopFile -ErrorAction SilentlyContinue

# Single instance of the holder itself
$self = New-Object System.Threading.Mutex($false, 'Local\IRAM_lockholder')
$mine = $false
try { $mine = $self.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mine = $true }
if (-not $mine) { Write-HolderLog 'another holder is already running; exiting'; exit 0 }
Write-HolderLog 'started'

$mutex = New-Object System.Threading.Mutex($false, 'ROBLOX_singletonMutex')
$owned = $false
$evt = $null
try { $evt = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, 'ROBLOX_singletonEvent') } catch { }

function Test-Alive([int]$id) { try { $null = Get-Process -Id $id -ErrorAction Stop; return $true } catch { return $false } }

$idleChecks = 0
while ($true) {
  if (-not $owned) {
    try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  }
  $state = if ($owned) { 'held' } else { 'owned by a running Roblox client' }
  $json = @{ pid = $PID; mutex = $state; event = $(if ($evt) { 'held' } else { 'unavailable' }); at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress
  try { [System.IO.File]::WriteAllText($statusFile, $json) } catch { }

  if ($owned -and -not $script:loggedOwn) { Write-HolderLog 'mutex owned'; $script:loggedOwn = $true }
  if (Test-Path $stopFile) { Write-HolderLog 'stop requested'; break }

  $managerAlive = $false
  try { $lock = Get-Content $lockFile -Raw -ErrorAction Stop | ConvertFrom-Json; $managerAlive = Test-Alive ([int]$lock.pid) } catch { }
  $roblox = @(Get-Process -Name RobloxPlayerBeta -ErrorAction SilentlyContinue).Count
  if (-not $managerAlive -and $roblox -eq 0) { $idleChecks++ } else { $idleChecks = 0 }
  if ($idleChecks -ge 3) { Write-HolderLog 'manager gone and no Roblox clients left; exiting'; break }

  Start-Sleep -Seconds 3
}

if ($owned) { try { $mutex.ReleaseMutex() } catch { } }
$mutex.Dispose()
if ($evt) { $evt.Dispose() }
Remove-Item $statusFile -ErrorAction SilentlyContinue
Remove-Item $stopFile -ErrorAction SilentlyContinue
