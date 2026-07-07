<#
.SYNOPSIS
  Verify that REVIEW.md and CHANGELOG.md describe the webpack bundle
  budget that webpack.config.js actually enforces.

.DESCRIPTION
  webpack.config.js is the single source of truth for the production
  performance budget (maxEntrypointSize / maxAssetSize). The reviewer
  docs (REVIEW.md, CHANGELOG.md) used to drift: they cited `2 500 000`
  / `2.5 MiB` after the source-of-truth had already been tightened to
  `1 600 000` / `1.6 MiB`.

  This script:
    1. Reads `maxEntrypointSize` from webpack.config.js.
    2. Computes the matching decimal (e.g. 1600000) and human-readable
       forms (e.g. `1 600 000` with thin-space, `1.6 MiB`).
    3. Greps REVIEW.md and CHANGELOG.md for both the current value and
       the stale `2 500 000` / `2.5 MiB` forms.
    4. Exits 0 if the docs match the config, exits 1 with a diff list
       if they do not.

  Run as part of CI / npm run preflight:demo to prevent the next drift.

.PARAMETER WebpackConfig
  Path to webpack.config.js. Defaults to the repo root.

.PARAMETER ReviewDoc
  Path to REVIEW.md. Defaults to the repo root.

.PARAMETER ChangelogDoc
  Path to CHANGELOG.md. Defaults to the repo root.

.EXAMPLE
  pwsh scripts/check-bundle-budget-sync.ps1

.EXAMPLE
  pwsh scripts/check-bundle-budget-sync.ps1 -Verbose
#>

[CmdletBinding()]
param(
  [string]$WebpackConfig,
  [string]$ReviewDoc,
  [string]$ChangelogDoc
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is empty inside parameter defaults (it is evaluated at
# parameter binding time, which happens before the script body runs),
# so we resolve the repo root lazily here.
if (-not $WebpackConfig) { $WebpackConfig = (Join-Path $PSScriptRoot '..\webpack.config.js') }
if (-not $ReviewDoc)     { $ReviewDoc     = (Join-Path $PSScriptRoot '..\REVIEW.md') }
if (-not $ChangelogDoc)  { $ChangelogDoc  = (Join-Path $PSScriptRoot '..\CHANGELOG.md') }

function Format-ThinSpace([int]$value) {
  # Match the human-readable form used in REVIEW.md / CHANGELOG.md,
  # e.g. 1600000 -> "1 600 000" (regular space, thousands grouping).
  # Both webpack.config.js comments and the reviewer docs use the same
  # ASCII space convention, so we do not switch to U+2009 here.
  $s = $value.ToString('N0', [System.Globalization.CultureInfo]::InvariantCulture)
  return $s -replace ',', ' '
}

function Format-MiB([int]$bytes) {
  # Use [math]::Pow so the script works on both PowerShell 5.1 (no `1MiB`
  # literal) and PowerShell 7+ (where `1MiB` exists).
  $mib = [math]::Pow(1024, 2)
  return ('{0:N1} MiB' -f ($bytes / $mib))
}

if (-not (Test-Path $WebpackConfig)) {
  Write-Error "webpack.config.js not found at $WebpackConfig"
  exit 2
}
if (-not (Test-Path $ReviewDoc)) {
  Write-Error "REVIEW.md not found at $ReviewDoc"
  exit 2
}
if (-not (Test-Path $ChangelogDoc)) {
  Write-Error "CHANGELOG.md not found at $ChangelogDoc"
  exit 2
}

# Read maxEntrypointSize from webpack.config.js. We accept any whitespace
# between the key and the colon so future formatting tweaks still parse.
$webpackContent = Get-Content -LiteralPath $WebpackConfig -Raw
$entryPattern   = '(?m)^\s*maxEntrypointSize\s*:\s*(\d+)\s*,'
$entryMatch     = [regex]::Match($webpackContent, $entryPattern)
if (-not $entryMatch.Success) {
  Write-Error "maxEntrypointSize not found in $WebpackConfig"
  exit 2
}
$entryBytes = [int]$entryMatch.Groups[1].Value
$entryDecimal   = $entryBytes.ToString()
$entryThinSpace = Format-ThinSpace $entryBytes
$entryMiB       = Format-MiB   $entryBytes

Write-Verbose "webpack maxEntrypointSize = $entryBytes bytes ($entryThinSpace / $entryMiB)"

# Known stale values from the audit (2026-07-07 Track D §1.3). If the
# source-of-truth moves away from these we should update the list.
$staleThinSpace = '2 500 000'
$staleMiB       = '2.5 MiB'
$staleCompact   = '2500000'

$errors = @()

function Test-Doc([string]$path, [string]$label) {
  $content = Get-Content -LiteralPath $path -Raw

  foreach ($stale in @($staleThinSpace, $staleMiB, $staleCompact)) {
    if ($content.Contains($stale)) {
      $script:errors += "[$label] contains stale value '$stale' (webpack source-of-truth is $entryThinSpace bytes)"
    }
  }

  # The docs must mention the current value at least once, otherwise the
  # previous grep would silently pass on an empty file. We accept both
  # the byte form ($entryDecimal) and the human-readable thin-space form
  # ($entryThinSpace) — the MiB unit form is presentation only and is
  # not gated by this script.
  $hasDecimal   = $content.Contains($entryDecimal)
  $hasThinSpace = $content.Contains($entryThinSpace)
  if (-not ($hasDecimal -or $hasThinSpace)) {
    $script:errors += "[$label] does not reference the current value '$entryThinSpace' (or decimal $entryDecimal) at all"
  } else {
    Write-Verbose "[$label] references current value (decimal=$hasDecimal, thin=$hasThinSpace)"
  }
}

Test-Doc -path $ReviewDoc    -label 'REVIEW.md'
Test-Doc -path $ChangelogDoc -label 'CHANGELOG.md'

if ($errors.Count -gt 0) {
  Write-Host 'Bundle budget docs are out of sync with webpack.config.js:' -ForegroundColor Red
  foreach ($e in $errors) { Write-Host "  - $e" -ForegroundColor Red }
  Write-Host ''
  Write-Host "webpack.config.js maxEntrypointSize = $entryBytes bytes" -ForegroundColor Yellow
  Write-Host "Expected in REVIEW.md / CHANGELOG.md: '$entryThinSpace' (or decimal $entryDecimal)" -ForegroundColor Yellow
  Write-Host "Forbidden (stale from 2026-06-06 round): '$staleThinSpace' or '$staleMiB' or '$staleCompact'" -ForegroundColor Yellow
  exit 1
}

# The MiB form is a presentation choice (binary 1.5 MiB vs decimal 1.6
# MB). Both refer to the same byte budget; the script does not gate on
# MiB form, only on the unambiguous byte form.
Write-Host 'Bundle budget docs are in sync with webpack.config.js' -ForegroundColor Green
Write-Host "  maxEntrypointSize = $entryThinSpace bytes ($entryBytes decimal, ~$entryMiB binary)" -ForegroundColor Green
exit 0