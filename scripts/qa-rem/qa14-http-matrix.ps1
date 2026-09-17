# QA-14 HTTP matrix via curl.exe. Raw bodies + headers saved to evidence dir.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa14-http-matrix.ps1
$ErrorActionPreference = "Stop"
$Site = "https://brainy-skunk-440.convex.site"
$Evidence = "D:\Repo\ALL HACKATHONS\Convex\Convex all gas\doc\tradepulse audits\outputs\evidence"
$RawDir = Join-Path $Evidence "remediation-qa14-http"
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
  @{ Name = "dashboard_get";     Method = "GET";  Url = "$Site/dashboard" },
  @{ Name = "spec_electrical_get"; Method = "GET"; Url = "$Site/specs/26_00_00_Electrical_Systems_Spec.pdf" },
  @{ Name = "spec_missing_get";  Method = "GET";  Url = "$Site/specs/missing.pdf" }
)

$lines = @()
$lines += "=== QA-14 HTTP MATRIX ==="
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
  $bodySnip = if ($bodyBytes -gt 0) { (Get-Content -LiteralPath $bodyFile -Raw).Substring(0, [Math]::Min(160, (Get-Content -LiteralPath $bodyFile -Raw).Length)) -replace "`r?`n", " " } else { "" }
  $line = "{0,-28} {1,-4} status={2} content_type={3} curl_bytes={4} body_bytes={5}" -f $c.Name, $c.Method, $status, $ctype, $bytes, $bodyBytes
  $lines += $line
  $lines += "  body: $bodySnip"
  $results += [pscustomobject]@{ name = $c.Name; method = $c.Method; url = $c.Url; status = [int]$status; contentType = $ctype; bodyBytes = $bodyBytes; curlBytes = [int]$bytes; bodySnip = $bodySnip }
}

$lines += ""
$lines += "=== RAW JSON SUMMARY ==="
$json = $results | ConvertTo-Json -Depth 4
$lines += $json

$summaryFile = Join-Path $Evidence "remediation-qa14-http-matrix.txt"
$lines -join "`n" | Set-Content -LiteralPath $summaryFile -Encoding UTF8
Write-Output "Wrote $summaryFile"
$results | Format-Table name, method, status, contentType, bodyBytes -AutoSize | Out-String | Write-Output