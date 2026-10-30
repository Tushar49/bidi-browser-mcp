<#
.SYNOPSIS
  Throwaway Zen instance for live browser testing (dev-only helper).

.DESCRIPTION
  Starts a separate Zen process (-no-remote) on a disposable profile and a
  Remote Agent (WebDriver BiDi) port, or stops that instance and removes its
  profile data. Never touches the user's real Zen instance or any other
  Zen process: Stop only kills the process whose command line carries this
  profile path.

.PARAMETER Start
  Launch the instance and wait until the BiDi port answers.

.PARAMETER Stop
  Stop the instance and, when the profile lives under the default root,
  remove the disposable profile data so testing leaves nothing behind.

.PARAMETER Path
  Profile directory override. Defaults to $DefaultProfilePath above.

.PARAMETER Port
  Remote Agent port. Defaults to 9444.

.EXAMPLE
  pwsh -File _archive/development/launch_zen.ps1 -Start
  pwsh -File _archive/development/launch_zen.ps1 -Stop

.EXAMPLE
  pwsh -File _archive/development/launch_zen.ps1 -Start -Path D:/dev/temp/foo -Port 9555
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Start,
  [switch]$Stop,
  [string]$Path,
  [int]$Port = 9444
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ── Defaults (contract: the default profile path lives here, at the top) ──
$DefaultProfileRoot = 'D:/development/temp/browser-data/Zen'
$DefaultProfilePath = Join-Path $DefaultProfileRoot 'live-profile'
$ZenExe = 'A:\Programs\Browsers\Zen Browser\zen.exe'
$StateFile = Join-Path $PSScriptRoot 'launch_zen.state.json'
$StartTimeoutSeconds = 45
$StopTimeoutSeconds = 15

function Get-State {
  if (Test-Path -LiteralPath $StateFile) {
    try {
      $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
      if ($state -and $state.profilePath) {
        return @{ ProfilePath = [string]$state.profilePath; Port = [int]$state.port }
      }
    } catch {
      # Corrupt state is not fatal: the defaults below still work.
    }
  }
  return @{ ProfilePath = $DefaultProfilePath; Port = $DefaultPort }
}

# Default port only applies when no state says otherwise.
$DefaultPort = $Port
$state = Get-State
$ProfilePath = if ([string]::IsNullOrWhiteSpace($Path)) { [string]$state.ProfilePath } else { $Path }
# Explicit -Port always wins; otherwise the remembered port (or the default).
$AgentPort = if ($PSBoundParameters.ContainsKey('Port')) {
  $Port
} elseif (-not [string]::IsNullOrWhiteSpace($Path)) {
  $Port
} elseif ($state.Port) {
  [int]$state.Port
} else {
  $DefaultPort
}

function Test-PortOpen([int]$PortToTest) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', $PortToTest)
      return $true
    } finally {
      $client.Dispose()
    }
  } catch {
    return $false
  }
}

function Get-TrackedProcesses([string]$ProfileToMatch) {
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" -ErrorAction SilentlyContinue
  if (-not $processes) { return @() }
  $matches = @()
  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    if ($commandLine -and $commandLine.Contains($ProfileToMatch, [System.StringComparison]::OrdinalIgnoreCase)) {
      $matches += $process
    }
  }
  return $matches
}

if (-not $Start -and -not $Stop) {
  throw 'Usage: launch_zen.ps1 -Start | -Stop [-Path <profile dir>] [-Port <port>]'
}

# Both switches given = close the instance (per the documented contract).
$action = 'Start'
if ($Stop -or ($Start -and $Stop)) { $action = 'Stop' }

if ($action -eq 'Start') {
  if (-not (Test-Path -LiteralPath $ZenExe)) {
    throw "Zen executable not found: $ZenExe"
  }

  $existing = Get-TrackedProcesses -ProfileToMatch $ProfilePath
  if ($existing) {
    Write-Host "Instance already running for $ProfilePath (pid $($existing[0].ProcessId))."
    if (Test-PortOpen -PortToTest $AgentPort) {
      Write-Host "Remote Agent ready: ws://127.0.0.1:$AgentPort/session"
    } else {
      Write-Host "WARNING: no listener on port $AgentPort."
    }
    exit 0
  }

  if (-not (Test-Path -LiteralPath $ProfilePath)) {
    New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null
  }

  $arguments = @('-no-remote', '--profile', $ProfilePath, "--remote-debugging-port=$AgentPort", '--headless', '--window-size=1400,900')
  # Headless on purpose: headed Zen in this environment opens a 0×0 content
  # window (layout renders, but elementFromPoint returns null and window
  # commands hang). Headless honors --window-size and paints a real viewport.
  Start-Process -FilePath $ZenExe -ArgumentList $arguments -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen -PortToTest $AgentPort) {
      @{ profilePath = $ProfilePath; port = $AgentPort } |
        ConvertTo-Json |
        Set-Content -LiteralPath $StateFile -Encoding ASCII
      Write-Host "started: ws://127.0.0.1:$AgentPort/session (profile $ProfilePath)"
      exit 0
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Remote Agent did not open on port $AgentPort within $StartTimeoutSeconds seconds."
}

if ($action -eq 'Stop') {
  $processes = Get-TrackedProcesses -ProfileToMatch $ProfilePath
  if (-not $processes) {
    Write-Host "nothing running for profile $ProfilePath."
  } else {
    foreach ($process in $processes) {
      $proc = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
      if ($proc -and $proc.MainWindowHandle -ne 0) {
        $null = $proc.CloseMainWindow()
      }
    }
    $deadline = (Get-Date).AddSeconds($StopTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      $alive = Get-TrackedProcesses -ProfileToMatch $ProfilePath
      if (-not $alive) { break }
      Start-Sleep -Milliseconds 500
    }
    foreach ($process in (Get-TrackedProcesses -ProfileToMatch $ProfilePath)) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
  }

  $isDefaultRoot = ([System.IO.Path]::GetFullPath($ProfilePath)).StartsWith(
    [System.IO.Path]::GetFullPath($DefaultProfileRoot),
    [System.StringComparison]::OrdinalIgnoreCase
  )
  if ($isDefaultRoot) {
    Remove-Item -LiteralPath $ProfilePath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
    Write-Host "stopped; disposable profile removed: $ProfilePath"
  } else {
    Write-Host "stopped; custom -Path kept (outside $DefaultProfileRoot): $ProfilePath"
  }
  exit 0
}
