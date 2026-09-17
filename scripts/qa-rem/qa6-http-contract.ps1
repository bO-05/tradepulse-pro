# QA-6 adversarial HTTP contract probe (read-only). Regenerates evidence under
# doc/tradepulse audits/outputs/evidence/remediation-qa6-http-contract.txt
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa6-http-contract.ps1
param(
  [string]$BaseUrl = "https://brainy-skunk-440.convex.site",
  [string]$EvidenceDir = "D:\Repo\ALL HACKATHONS\Convex\Convex all gas\doc\tradepulse audits\outputs\evidence"
)

$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$lines = New-Object System.Collections.Generic.List[string]
$tmp = Join-Path $env:TEMP ("qa6-" + [guid]::NewGuid().ToString("N"))

function Add-Line([string]$s) { $lines.Add($s) | Out-Null }

function Probe {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Url,
    [string]$Body = $null,
    [string[]]$ExtraHeaders = @(),
    [string]$ExpectStatus,
    [string]$ExpectTypeLike,
    [string]$ExpectBodyContains
  )
  $bodyFile = Join-Path $tmp ("body-" + [guid]::NewGuid().ToString("N") + ".bin")
  $hdrFile = Join-Path $tmp ("hdr-" + [guid]::NewGuid().ToString("N") + ".txt")
  $args = @("-sS", "-m", "45", "-o", $bodyFile, "-D", $hdrFile, "-w", "%{http_code}|%{content_type}|%{size_download}")
  if ($Method -ne "GET") { $args += @("-X", $Method) }
  if ($Body) { $args += @("-H", "Content-Type: application/json", "--data-binary", $Body) }
  foreach ($h in $ExtraHeaders) { $args += @("-H", $h) }
  $args += $Url
  $raw = & curl.exe @args 2>&1
  $status = $null; $ctype = $null; $size = $null
  if ($raw -match '^(\d+)\|([^|]*)\|(\d+)$') {
    $status = [int]$Matches[1]; $ctype = $Matches[2]; $size = [long]$Matches[3]
  }
  $bodyText = ""
  if (Test-Path -LiteralPath $bodyFile) {
    $bytes = [System.IO.File]::ReadAllBytes($bodyFile)
    if ($bytes.Length -gt 0) {
      $bodyText = [System.Text.Encoding]::UTF8.GetString($bytes)
    }
  }
  $headers = ""
  if (Test-Path -LiteralPath $hdrFile) { $headers = Get-Content -LiteralPath $hdrFile -Raw }
  $contentLengthHeader = ""
  if ($headers -match '(?im)^Content-Length:\s*(\d+)') { $contentLengthHeader = $Matches[1] }
  $cacheStatus = ""
  if ($headers -match '(?im)^cf-cache-status:\s*(\S+)') { $cacheStatus = $Matches[1] }

  $sha = ""
  if (Test-Path -LiteralPath $bodyFile) {
    $sha = (Get-FileHash -LiteralPath $bodyFile -Algorithm SHA256).Hash.ToLower()
  }

  $pass = $true
  $reasons = @()
  if ($ExpectStatus -and "$status" -ne "$ExpectStatus") { $pass = $false; $reasons += "status=$status expected=$ExpectStatus" }
  if ($ExpectTypeLike -and ($ctype -notlike "*$ExpectTypeLike*")) { $pass = $false; $reasons += "content-type='$ctype' expected~'$ExpectTypeLike'" }
  if ($ExpectBodyContains -and ($bodyText -notlike "*$ExpectBodyContains*")) { $pass = $false; $reasons += "body missing '$ExpectBodyContains'" }
  if ($null -eq $status) { $pass = $false; $reasons += "transport error: $raw" }

  $snippet = if ($bodyText) { $bodyText.Substring(0, [Math]::Min(240, $bodyText.Length)) -replace "`r?`n", " " } else { "" }
  $verdict = if ($pass) { "PASS" } else { "FAIL [" + ($reasons -join "; ") + "]" }
  Add-Line ("[{0}] {1,-6} {2}" -f $status, $Method, $Url)
  Add-Line ("        name={0}" -f $Name)
  Add-Line ("        content-type={0} | bytes={1} | header-content-length={2} | cf-cache={3}" -f $ctype, $size, $contentLengthHeader, $cacheStatus)
  Add-Line ("        sha256={0}" -f $sha)
  Add-Line ("        verdict={0}" -f $verdict)
  Add-Line ("        snippet={0}" -f $snippet)
  Add-Line ""
  # keep small raw bodies for JSON error shapes
  if ($Body -or $ExpectBodyContains -or $status -ge 400) {
    $safeName = ($Name -replace '[^A-Za-z0-9\-_]', '_')
    $dest = Join-Path $EvidenceDir ("remediation-qa6-raw-" + $safeName + ".txt")
    $rawDump = "URL: $Method $Url`nSTATUS: $status`nCONTENT-TYPE: $ctype`nSIZE: $size`nSHA256: $sha`nHEADERS:`n$headers`nBODY:`n$bodyText"
    [System.IO.File]::WriteAllText($dest, $rawDump, [System.Text.Encoding]::UTF8)
  }
  return [pscustomobject]@{
    Name = $Name; Method = $Method; Url = $Url; Status = $status; ContentType = $ctype
    Bytes = $size; ContentLengthHeader = $contentLengthHeader; Sha256 = $sha; Pass = $pass
  }
}

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

Add-Line "=== QA-6 HTTP CONTRACT PROBE (adversarial regression re-check) ==="
Add-Line "BaseUrl : $BaseUrl"
Add-Line "UTC     : $stamp"
Add-Line "Tool    : curl.exe $((curl.exe --version | Select-Object -First 1))"
Add-Line ""

$results = @()
$results += Probe -Name "health-1" -Method GET -Url "$BaseUrl/api/health" -ExpectStatus 200 -ExpectTypeLike "application/json" -ExpectBodyContains '"status"'
$results += Probe -Name "health-2-freshness" -Method GET -Url "$BaseUrl/api/health" -ExpectStatus 200 -ExpectTypeLike "application/json" -ExpectBodyContains '"timestamp"'
$results += Probe -Name "api-unknown-get" -Method GET -Url "$BaseUrl/api/no-such-qa6-path" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "api-unknown-post" -Method POST -Url "$BaseUrl/api/no-such-qa6-path" -Body '{"probe":true}' -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "agentmail-unknown-get" -Method GET -Url "$BaseUrl/agentmail/no-such-qa6-path" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "agentmail-unknown-post" -Method POST -Url "$BaseUrl/agentmail/no-such-qa6-path" -Body '{"probe":true}' -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "webhook-get" -Method GET -Url "$BaseUrl/agentmail/webhook" -ExpectStatus 200 -ExpectTypeLike "application/json" -ExpectBodyContains "svixVerification"
$results += Probe -Name "webhook-post-no-svix" -Method POST -Url "$BaseUrl/agentmail/webhook" -Body '{"probe":true}' -ExpectStatus 401 -ExpectTypeLike "application/json"
$results += Probe -Name "webhook-post-bogus-svix" -Method POST -Url "$BaseUrl/agentmail/webhook" -Body '{"probe":true}' -ExtraHeaders @("svix-id: msg_qa6", "svix-timestamp: 1700000000", "svix-signature: v1,Ym9ndXM=") -ExpectStatus 401 -ExpectTypeLike "application/json"
$results += Probe -Name "llms-txt" -Method GET -Url "$BaseUrl/llms.txt" -ExpectStatus 200 -ExpectTypeLike "text/plain" -ExpectBodyContains "TradePulse"
$results += Probe -Name "spa-dashboard" -Method GET -Url "$BaseUrl/dashboard" -ExpectStatus 200 -ExpectTypeLike "text/html"
$results += Probe -Name "spa-deep-route" -Method GET -Url "$BaseUrl/project/no-such-qa6" -ExpectStatus 200 -ExpectTypeLike "text/html"
$results += Probe -Name "spec-26-00-00" -Method GET -Url "$BaseUrl/specs/26_00_00_Electrical_Systems_Spec.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "spec-22-00-00" -Method GET -Url "$BaseUrl/specs/22_00_00_Plumbing_Systems_Spec.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "spec-23-00-00" -Method GET -Url "$BaseUrl/specs/23_00_00_HVAC_Systems_Spec.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "spec-01-00-00" -Method GET -Url "$BaseUrl/specs/01_00_00_General_Requirements.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "quote-rosendin" -Method GET -Url "$BaseUrl/quotes/Rosendin_Electric_Proposal_AIA.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "drawing-e101" -Method GET -Url "$BaseUrl/drawings/E-101_Main_Switchgear_Penthouse_Plan.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "insurance-rosendin-coi" -Method GET -Url "$BaseUrl/insurance/Rosendin_Electric_ACORD25_COI.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "spec-missing" -Method GET -Url "$BaseUrl/specs/missing-qa6.pdf" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "api-files-universal" -Method GET -Url "$BaseUrl/api/files/26_00_00_Electrical_Systems_Spec.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "static-root-spec26" -Method GET -Url "$BaseUrl/26_00_00_Electrical_Systems_Spec.pdf" -ExpectStatus 200
$results += Probe -Name "firecrawl-unknown" -Method GET -Url "$BaseUrl/firecrawl/no-such-qa6-path"
$results += Probe -Name "api-traversal" -Method GET -Url "$BaseUrl/api/../specs/26_00_00_Electrical_Systems_Spec.pdf"
$results += Probe -Name "spec-encoded-traversal" -Method GET -Url "$BaseUrl/specs/%2e%2e%2f26_00_00_Electrical_Systems_Spec.pdf"

Add-Line ""
Add-Line ("SUMMARY: {0}/{1} expected-behavior checks passed" -f (($results | Where-Object { $_.Pass }).Count), $results.Count)
Add-Line ""
Add-Line "=== TABLE ==="
Add-Line ("{0,-26} {1,-5} {2,-6} {3,-32} {4}" -f "CHECK", "METH", "STATUS", "CONTENT-TYPE", "BYTES")
foreach ($r in $results) {
  Add-Line ("{0,-26} {1,-5} {2,-6} {3,-32} {4}" -f $r.Name, $r.Method, $r.Status, $r.ContentType, $r.Bytes)
}

Add-Line ""
Add-Line "=== DOC BYTE-CLAIM RECONCILIATION (hackathon.md claims) ==="
$claims = @(
  @{ File = "26_00_00_Electrical_Systems_Spec.pdf"; Route = "spec-26-00-00"; Claim = 931307 },
  @{ File = "22_00_00_Plumbing_Systems_Spec.pdf"; Route = "spec-22-00-00"; Claim = 4391422 },
  @{ File = "23_00_00_HVAC_Systems_Spec.pdf"; Route = "spec-23-00-00"; Claim = 165362 },
  @{ File = "01_00_00_General_Requirements.pdf"; Route = "spec-01-00-00"; Claim = 774760 },
  @{ File = "Rosendin_Electric_Proposal_AIA.pdf"; Route = "quote-rosendin"; Claim = 6066 },
  @{ File = "E-101_Main_Switchgear_Penthouse_Plan.pdf"; Route = "drawing-e101"; Claim = 4094 },
  @{ File = "Rosendin_Electric_ACORD25_COI.pdf"; Route = "insurance-rosendin-coi"; Claim = 4160 }
)
foreach ($c in $claims) {
  $r = $results | Where-Object { $_.Name -eq $c.Route }
  $delta = if ($r) { [long]$r.Bytes - [long]$c.Claim } else { $null }
  Add-Line ("{0,-44} served={1,-9} claimed={2,-9} delta={3}" -f $c.File, $r.Bytes, $c.Claim, $delta)
}

$dest = Join-Path $EvidenceDir "remediation-qa6-http-contract.txt"
[System.IO.File]::WriteAllLines($dest, $lines, [System.Text.Encoding]::UTF8)
Write-Output ""
Write-Output "Wrote $dest"

Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
$failed = @($results | Where-Object { -not $_.Pass })
exit $failed.Count