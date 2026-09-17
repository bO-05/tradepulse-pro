# QA-15 HTTP matrix via curl.exe. Raw bodies + headers saved to evidence dir.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa15-http-matrix.ps1
$ErrorActionPreference = "Stop"
$Site = "https://brainy-skunk-440.convex.site"
$Evidence = "D:\Repo\ALL HACKATHONS\Convex\Convex all gas\doc\tradepulse audits\outputs\evidence"
$RawDir = Join-Path $Evidence "remediation-qa15-http"
New-Item -ItemType Directory -Force -Path $RawDir | Out-Null

$cases = @(
  @{ Name = "health_get";        Method = "GET";  Url = "$Site/api/health" },
  @{ Name = "api_nosuch_get";    Method = "GET";  Url = "$Site/api/no-such" },
  @{ Name = "api_nosuch_post";   Method = "POST"; Url = "$Site/api/no-such" },
  @{ Name = "agentmail_nosuch_get";  Method = "GET";  Url = "$Site/agentmail/no-such" },
  @{ Name = "agentmail_nosuch_post"; Method = "POST"; Url = "$Site/agentmail/no-such" },
  @{ Name = "agentmail_webhook_get"; Method = "GET";  Url = "$Site/agentmail/webhook" },
  @{ Name = "agentmail_webhook_post_nosvix"; Method = "POST"; Url = "$Site/agentmail/webhook" },
  @{ Name = "llms_txt_get";      Method = "GET";  Url = "$Site/llms.txt" },
  @{ Name = "spa_root_get";      Method = "GET";  Url = "$Site/" },
  @{ Name = "spa_route_get";     Method = "GET";  Url = "$Site/dashboard" },
  @{ Name = "spec_electrical_get"; Method = "GET"; Url = "$Site/specs/26_00_00_Electrical_Systems_Spec.pdf" },
  @{ Name = "spec_missing_get";  Method = "GET";  Url = "$Site/specs/missing.pdf" },
  @{ Name = "drawing_get";       Method = "GET";  Url = "$Site/drawings/E-101_Main_Switchgear_Penthouse_Plan.pdf" },
  @{ Name = "files_missing_get"; Method = "GET";  Url = "$Site/files/does-not-exist.pdf" }
)

$lines = @()
$lines += "=== QA-15 HTTP MATRIX ==="
$lines += "Site: $Site"
$lines += "UTC : $(Get-Date -Format o)"
$lines += ""

$results = @()
foreach ($c in $cases) {
  $bodyFile = Join-Path $RawDir "$($c.Name).body"
  $headFile = Join-Path $RawDir "$($c.Name).headers"
  $args = @("-sS", "--max-time", "30", "-o", $bodyFile, "-D", $headFile,
             "-w", "%{http_code}|%{content_type}|%{size_download}", "-X", $c.Method, $c.Url)
  $out = & curl.exe @args 2>&1
  $parts = ($out | Out-String).Trim() -split "\|"
  $status = $parts[0]; $ctype = $parts[1]; $bytes = $parts[2]
  $bodyBytes = if (Test-Path -LiteralPath $bodyFile) { (Get-Item -LiteralPath $bodyFile).Length } else { 0 }
  $bodyRaw = if ($bodyBytes -gt 0) { Get-Content -LiteralPath $bodyFile -Raw } else { "" }
  $bodySnip = if ($bodyRaw.Length -gt 0) { $bodyRaw.Substring(0, [Math]::Min(200, $bodyRaw.Length)) -replace "`r?`n", " " } else { "" }
  $line = "{0,-28} {1,-4} status={2} content_type={3} body_bytes={4}" -f $c.Name, $c.Method, $status, $ctype, $bodyBytes
  $lines += $line
  $lines += "  body: $bodySnip"
  $results += [pscustomobject]@{ name = $c.Name; method = $c.Method; url = $c.Url; status = [int]$status; contentType = $ctype; bodyBytes = $bodyBytes; bodySnip = $bodySnip }
}

$lines += ""
$lines += "=== RAW JSON SUMMARY ==="
$json = $results | ConvertTo-Json -Depth 4
$lines += $json

$summaryFile = Join-Path $Evidence "remediation-qa15-http-matrix.txt"
$lines -join "`n" | Set-Content -LiteralPath $summaryFile -Encoding UTF8
Write-Output "Wrote $summaryFile"
$results | Format-Table name, method, status, contentType, bodyBytes -AutoSize | Out-String | Write-Output