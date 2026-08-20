<#
.SYNOPSIS
  Deploys the API to Cloud Run, reading DATABASE_URL from .env.prod.

.DESCRIPTION
  Exists so the deploy command is copy-pasteable without the production
  database hostname being committed to the repo, and so the full flag block is
  passed every time. `gcloud run deploy` REPLACES the configuration it is given:
  omitting --set-secrets on a later deploy silently strips the secrets from the
  service, and the container then refuses to boot because SESSION_SECRET is
  mandatory when NODE_ENV=production.

.EXAMPLE
  .\scripts\deploy-api.ps1
  .\scripts\deploy-api.ps1 -WhatIf     # print the command, deploy nothing
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Project = '<gcp-project-id>',
  [string]$Region  = 'europe-west1',
  [string]$Service = 'pab-api',
  [string]$BasePath = '/battler',
  [string]$EnvFile = '.env.prod'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }

if (-not (Test-Path $envPath)) { throw "Env file not found: $envPath" }

$dbUrl = $null
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $dbUrl = $Matches[1] }
}
# A UTF-8 BOM is not whitespace, so `\s*` above will not have eaten one -- and a
# BOM is exactly what Windows PowerShell prepends when a string is piped into a
# native command, which is how one gets into a GitHub secret in the first place.
$dbUrl = $dbUrl -replace '^﻿', ''

if (-not $dbUrl)            { throw "DATABASE_URL missing from $envPath" }
if ($dbUrl -like 'file:*')  { throw "DATABASE_URL in $envPath is a local file URL. Refusing to deploy that to Cloud Run." }

# Only the token is secret; the URL is passed to Cloud Run as a plain env var by
# design (see DEPLOYMENT.md §6). Printing the host is a useful confirmation that
# the right database is about to be wired up.
$dbHost = ([uri]($dbUrl -replace '^libsql://', 'https://')).Host

# An unparseable URL yields an empty host rather than an error, and Cloud Run
# will happily accept the garbage, build for 90 seconds, and only then fail the
# health check with URL_INVALID. Catch it here instead. The value is not printed:
# it is a production credential, and a mangled copy will not match the CI log
# mask. See RELEASING.md §7.
if (-not $dbHost) {
  throw "DATABASE_URL in $envPath has no parseable host. A UTF-8 BOM or stray leading whitespace is the usual cause."
}
Write-Host "Service : $Service ($Region, project $Project)" -ForegroundColor Cyan
Write-Host "Database: $dbHost"                              -ForegroundColor Cyan
Write-Host "BasePath: $BasePath"                             -ForegroundColor Cyan

$deployArgs = @(
  'run', 'deploy', $Service,
  '--source', '.',
  '--region', $Region,
  '--project', $Project,
  '--allow-unauthenticated',
  '--min-instances=0', '--max-instances=3', '--concurrency=10',
  '--cpu=1', '--memory=1Gi', '--cpu-boost', '--timeout=60',
  '--set-env-vars', "BASE_PATH=$BasePath,NODE_ENV=production,DATABASE_URL=$dbUrl",
  '--set-secrets', 'SESSION_SECRET=SESSION_SECRET:latest,DATABASE_AUTH_TOKEN=DATABASE_AUTH_TOKEN:latest'
)

if (-not $PSCmdlet.ShouldProcess("$Service in $Region", 'gcloud run deploy')) {
  Write-Host "would run: gcloud $($deployArgs -join ' ')"
  return
}

Push-Location $repoRoot
try {
  & gcloud @deployArgs
  if ($LASTEXITCODE -ne 0) { throw "gcloud run deploy failed with exit code $LASTEXITCODE" }
  Write-Host "`nDeployed. Verify with the checks in RELEASING.md section 5." -ForegroundColor Green
}
finally { Pop-Location }
