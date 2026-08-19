<#
.SYNOPSIS
  Runs a command against the production Turso database, using credentials from
  .env.prod. Defaults to `npm run migrate`.

.DESCRIPTION
  The server does NOT migrate on boot -- src/db/migrate.ts is a standalone
  script that process.exit()s -- so schema changes have to be pushed from a
  workstation. This wrapper exists because the sh syntax in DEPLOYMENT.md
  (`DATABASE_URL=... npm run migrate`) does nothing in PowerShell: there is no
  inline env-var prefix, so the command would silently run against local.db
  instead, and appear to succeed.

  Credentials are set for this process only and cleared in `finally`, so an
  interrupted run cannot leave the shell pointed at production.

.EXAMPLE
  .\scripts\migrate-prod.ps1
  .\scripts\migrate-prod.ps1 -Command 'npm run simulate'
#>
[CmdletBinding()]
param(
  [string]$Command = 'npm run migrate',
  [string]$EnvFile = '.env.prod'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }

if (-not (Test-Path $envPath)) {
  throw "Env file not found: $envPath"
}

$vars = @{}
foreach ($line in Get-Content $envPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
  $i = $trimmed.IndexOf('=')
  if ($i -lt 1) { continue }
  $vars[$trimmed.Substring(0, $i).Trim()] = $trimmed.Substring($i + 1).Trim()
}

foreach ($required in @('DATABASE_URL', 'DATABASE_AUTH_TOKEN')) {
  if (-not $vars.ContainsKey($required) -or -not $vars[$required]) {
    throw "$required is missing or empty in $envPath"
  }
}

# Guard against pointing the "prod" script at a local file: DATABASE_AUTH_TOKEN
# is meaningless for file: mode, so this almost certainly means a wrong file.
if ($vars['DATABASE_URL'] -like 'file:*') {
  throw "DATABASE_URL in $envPath is a local file URL. Refusing to run as prod."
}

# Host only -- never print the token.
$dbHost = ([uri]($vars['DATABASE_URL'] -replace '^libsql://', 'https://')).Host
Write-Host "Target : $dbHost" -ForegroundColor Cyan
Write-Host "Command: $Command" -ForegroundColor Cyan

Push-Location $repoRoot
try {
  $env:DATABASE_URL = $vars['DATABASE_URL']
  $env:DATABASE_AUTH_TOKEN = $vars['DATABASE_AUTH_TOKEN']
  & cmd /c $Command
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "Command failed with exit code $code" }
}
finally {
  # Always cleared, including on Ctrl-C, so the shell cannot be left aimed at
  # production for a subsequent `npm run dev`.
  $env:DATABASE_URL = $null
  $env:DATABASE_AUTH_TOKEN = $null
  Pop-Location
}
