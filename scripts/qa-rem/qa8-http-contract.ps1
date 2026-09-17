# QA-8 (round 3) authoritative HTTP contract matrix (read-only).
# Charter: /api/health 200 JSON; /api/no-such GET+POST 404 JSON; /agentmail/no-such 404 JSON;
# /agentmail/webhook GET 200; POST no svix 401; /llms.txt 200; /dashboard 200 HTML;
# /specs/26_00_00_Electrical_Systems_Spec.pdf 200 PDF; /specs/missing.pdf 404 JSON.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa8-http-contract.ps1
param(
  [string]$BaseUrl = "https://brainy-skunk-440.convex.site",
  [string]$EvidenceDir = "D:\Repo\ALL HACKATHONS\Convex\Convex all gas\doc\tradepulse audits\outputs\evidence"
)

$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$lines = New-Object System.Collections.Generic.List[string]
$tmp = Join-Path $env:TEMP ("qa8-" + [guid]::NewGuid().ToString("N"))

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
  $args = @("-sS", "-m", "45", "-o", $bodyFile, "-D", $hdrFile, "-w", "%{http_code}|%{content_type}|%{size_download}|%{time_total}")
  if ($Method -ne "GET") { $args += @("-X", $Method) }
  if ($Body) { $args += @("-H", "Content-Type: application/json", "--data-binary", $Body) }
  foreach ($h in $ExtraHeaders) { $args += @("-H", $h) }
  $args += $Url
  $raw = & curl.exe @args 2>&1
  $status = $null; $ctype = $null; $size = $null; $timeTotal = $null
  if ($raw -match '^(\d+)\|([^|]*)\|(\d+)\|([\d\.]+)$') {
    $status = [int]$Matches[1]; $ctype = $Matches[2]; $size = [long]$Matches[3]; $timeTotal = $Matches[4]
  }
  $bodyText = ""
  if (Test-Path -LiteralPath $bodyFile) {
    $bytes = [System.IO.File]::ReadAllBytes($bodyFile)
    if ($bytes.Length -gt 0) { $bodyText = [System.Text.Encoding]::UTF8.GetString($bytes) }
  }
  $headers = ""
  if (Test-Path -LiteralPath $hdrFile) { $headers = Get-Content -LiteralPath $hdrFile -Raw }
  $contentLengthHeader = ""
  if ($headers -match '(?im)^Content-Length:\s*(\d+)') { $contentLengthHeader = $Matches[1] }
  $sha = ""
  if (Test-Path -LiteralPath $bodyFile) { $sha = (Get-FileHash -LiteralPath $bodyFile -Algorithm SHA256).Hash.ToLower() }
  $magic = ""
  if (Test-Path -LiteralPath $bodyFile -PathType Leaf) {
    $mb = [System.IO.File]::ReadAllBytes($bodyFile)
    if ($mb.Length -ge 4) { $magic = [System.Text.Encoding]::ASCII.GetString($mb[0..3]) -replace '[^\x20-\x7E]', '.' }
  }

  $pass = $true
  $reasons = @()
  if ($ExpectStatus -and "$status" -ne "$ExpectStatus") { $pass = $false; $reasons += "status=$status expected=$ExpectStatus" }
  if ($ExpectTypeLike -and ($ctype -notlike "*$ExpectTypeLike*")) { $pass = $false; $reasons += "content-type='$ctype' expected~'$ExpectTypeLike'" }
  if ($ExpectBodyContains -and ($bodyText -notlike "*$ExpectBodyContains*")) { $pass = $false; $reasons += "body missing '$ExpectBodyContains'" }
  if ($null -eq $status) { $pass = $false; $reasons += "transport error: $raw" }

  $snippet = if ($bodyText) { $bodyText.Substring(0, [Math]::Min(300, $bodyText.Length)) -replace "`r?`n", " " } else { "" }
  $verdict = if ($pass) { "PASS" } else { "FAIL [" + ($reasons -join "; ") + "]" }
  Add-Line ("[{0}] {1,-6} {2}" -f $status, $Method, $Url)
  Add-Line ("        name={0}" -f $Name)
  Add-Line ("        content-type={0} | bytes={1} | header-content-length={2} | time={3}s | magic={4}" -f $ctype, $size, $contentLengthHeader, $timeTotal, $magic)
  Add-Line ("        sha256={0}" -f $sha)
  Add-Line ("        verdict={0}" -f $verdict)
  Add-Line ("        snippet={0}" -f $snippet)
  Add-Line ""

  $reported = ($Name -eq "spec-26-00-00") -or ($status -ge 400) -or ($Body -ne $null) -or ($ExpectBodyContains -ne $null)
  if ($reported) {
    $safeName = ($Name -replace '[^A-Za-z0-9\-_]', '_')
    $dest = Join-Path $EvidenceDir ("remediation-qa8-raw-" + $safeName + ".txt")
    $rawDump = "URL: $Method $Url`nSTATUS: $status`nCONTENT-TYPE: $ctype`nSIZE: $size`nSHA256: $sha`nHEADERS:`n$headers`nBODY(first 4000 chars):`n" + $bodyText.Substring(0, [Math]::Min(4000, $bodyText.Length))
    [System.IO.File]::WriteAllText($dest, $rawDump, [System.Text.Encoding]::UTF8)
  }
  return [pscustomobject]@{
    Name = $Name; Method = $Method; Url = $Url; Status = $status; ContentType = $ctype
    Bytes = $size; ContentLengthHeader = $contentLengthHeader; Sha256 = $sha; Pass = $pass; Magic = $magic
  }
}

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

Add-Line "=== QA-8 HTTP CONTRACT MATRIX (independent round-3 re-check) ==="
Add-Line "BaseUrl : $BaseUrl"
Add-Line "UTC     : $stamp"
Add-Line "curl    : $((curl.exe --version | Select-Object -First 1))"
Add-Line ""

$results = @()
$results += Probe -Name "health" -Method GET -Url "$BaseUrl/api/health" -ExpectStatus 200 -ExpectTypeLike "application/json" -ExpectBodyContains '"status"'
$results += Probe -Name "api-no-such-get" -Method GET -Url "$BaseUrl/api/no-such" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "api-no-such-post" -Method POST -Url "$BaseUrl/api/no-such" -Body '{"probe":"qa8"}' -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "agentmail-no-such-get" -Method GET -Url "$BaseUrl/agentmail/no-such" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "agentmail-no-such-post" -Method POST -Url "$BaseUrl/agentmail/no-such" -Body '{"probe":"qa8"}' -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'
$results += Probe -Name "webhook-get" -Method GET -Url "$BaseUrl/agentmail/webhook" -ExpectStatus 200
$results += Probe -Name "webhook-post-no-svix" -Method POST -Url "$BaseUrl/agentmail/webhook" -Body '{"probe":"qa8"}' -ExpectStatus 401
$results += Probe -Name "llms-txt" -Method GET -Url "$BaseUrl/llms.txt" -ExpectStatus 200
$results += Probe -Name "dashboard" -Method GET -Url "$BaseUrl/dashboard" -ExpectStatus 200 -ExpectTypeLike "text/html"
$results += Probe -Name "spec-26-00-00" -Method GET -Url "$BaseUrl/specs/26_00_00_Electrical_Systems_Spec.pdf" -ExpectStatus 200 -ExpectTypeLike "application/pdf"
$results += Probe -Name "spec-missing" -Method GET -Url "$BaseUrl/specs/missing.pdf" -ExpectStatus 404 -ExpectTypeLike "application/json" -ExpectBodyContains '"error"'

Add-Line ""
Add-Line ("SUMMARY: {0}/{1} expected-behavior checks passed" -f (($results | Where-Object { $_.Pass }).Count), $results.Count)
Add-Line ""
Add-Line "=== TABLE ==="
Add-Line ("{0,-24} {1,-5} {2,-7} {3,-30} {4,-9} {5}" -f "CHECK", "METH", "STATUS", "CONTENT-TYPE", "BYTES", "VERDICT")
foreach ($r in $results) {
  Add-Line ("{0,-24} {1,-5} {2,-7} {3,-30} {4,-9} {5}" -f $r.Name, $r.Method, $r.Status, $r.ContentType, $r.Bytes, $(if ($r.Pass) { "PASS" } else { "FAIL" }))
}

$dest = Join-Path $EvidenceDir "remediation-qa8-http-contract.txt"
[System.IO.File]::WriteAllLines($dest, $lines, [System.Text.Encoding]::UTF8)
Write-Output "Wrote $dest"
Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
$failed = @($results | Where-Object { -not $_.Pass })
exit $failed.Count