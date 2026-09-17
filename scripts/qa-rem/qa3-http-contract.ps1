# QA-3 remediation verification: HTTP contract + regression surface (read-only).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa3-http-contract.ps1
param(
  [string]$BaseUrl = "https://brainy-skunk-440.convex.site"
)

$ErrorActionPreference = "Continue"
$results = @()

function Invoke-Probe {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [string]$Body = $null,
    [string]$ExpectedStatus,
    [string]$ExpectContentTypeLike,
    [string]$ExpectBodyContains
  )
  $status = $null; $ctype = $null; $bodyText = $null; $errorMsg = $null
  try {
    $params = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 45; MaximumRedirection = 0 }
    if ($Headers.Count -gt 0) { $params["Headers"] = $Headers }
    if ($Body) { $params["Body"] = $Body; $params["ContentType"] = "application/json" }
    $resp = Invoke-WebRequest @params
    $status = [int]$resp.StatusCode
    $ctype = [string]$resp.Headers["Content-Type"]
    $bodyText = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  } catch {
    $webResp = $_.Exception.Response
    if ($webResp -ne $null) {
      $status = [int]$webResp.StatusCode
      try { $ctype = [string]$webResp.Headers["Content-Type"] } catch { $ctype = "<unreadable>" }
      try {
        $stream = $webResp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
      } catch { $bodyText = "<unreadable>" }
    } else {
      $errorMsg = $_.Exception.Message
    }
  }
  $snippet = if ($bodyText) { $bodyText.Substring(0, [Math]::Min(200, $bodyText.Length)) -replace "`r?`n", " " } else { "" }
  $pass = $true
  $reasons = @()
  if ($ExpectedStatus -and "$status" -ne "$ExpectedStatus") { $pass = $false; $reasons += "status=$status expected=$ExpectedStatus" }
  if ($ExpectContentTypeLike -and ($ctype -notlike "*$ExpectContentTypeLike*")) { $pass = $false; $reasons += "content-type='$ctype' expected~'$ExpectContentTypeLike'" }
  if ($ExpectBodyContains -and ($bodyText -notlike "*$ExpectBodyContains*")) { $pass = $false; $reasons += "body missing '$ExpectBodyContains'" }
  if ($errorMsg) { $pass = $false; $reasons += "transport error: $errorMsg" }
  [pscustomobject]@{
    Name = $Name; Method = $Method; Url = $Url; Status = $status; ContentType = $ctype
    Pass = $pass; Reasons = ($reasons -join "; "); Snippet = $snippet
  } | Out-Null
  $script:results += [pscustomobject]@{
    Name = $Name; Method = $Method; Url = $Url; Status = $status; ContentType = $ctype
    Pass = $pass; Reasons = ($reasons -join "; "); Snippet = $snippet
  }
}

Write-Output "=== QA-3 HTTP CONTRACT PROBE ==="
Write-Output "BaseUrl: $BaseUrl"
Write-Output "UTC: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
Write-Output ""

Invoke-Probe -Name "health (expect 200 JSON)" -Method "GET" -Url "$BaseUrl/api/health" -ExpectedStatus 200 -ExpectContentTypeLike "application/json" -ExpectBodyContains '"status"'
Invoke-Probe -Name "api unknown GET (expect 404 JSON)" -Method "GET" -Url "$BaseUrl/api/no-such-qa3-path" -ExpectedStatus 404 -ExpectContentTypeLike "application/json" -ExpectBodyContains '"error"'
Invoke-Probe -Name "api unknown POST (expect 404 JSON)" -Method "POST" -Url "$BaseUrl/api/no-such-qa3-path" -Body '{"probe":true}' -ExpectedStatus 404 -ExpectContentTypeLike "application/json" -ExpectBodyContains '"error"'
Invoke-Probe -Name "agentmail unknown (expect 404 JSON)" -Method "GET" -Url "$BaseUrl/agentmail/no-such-qa3-path" -ExpectedStatus 404 -ExpectContentTypeLike "application/json" -ExpectBodyContains '"error"'
Invoke-Probe -Name "agentmail webhook GET (expect 200 JSON)" -Method "GET" -Url "$BaseUrl/agentmail/webhook" -ExpectedStatus 200 -ExpectContentTypeLike "application/json" -ExpectBodyContains 'svixVerification'
Invoke-Probe -Name "agentmail webhook POST no svix (expect 401)" -Method "POST" -Url "$BaseUrl/agentmail/webhook" -Body '{"probe":true}' -ExpectedStatus 401 -ExpectContentTypeLike "application/json"
Invoke-Probe -Name "llms.txt (expect 200 text)" -Method "GET" -Url "$BaseUrl/llms.txt" -ExpectedStatus 200 -ExpectContentTypeLike "text/plain" -ExpectBodyContains "TradePulse"
Invoke-Probe -Name "dashboard SPA fallback (expect 200 HTML)" -Method "GET" -Url "$BaseUrl/dashboard" -ExpectedStatus 200 -ExpectContentTypeLike "text/html"
Invoke-Probe -Name "specs known PDF (expect 200 PDF)" -Method "GET" -Url "$BaseUrl/specs/26_00_00_Electrical_Systems_Spec.pdf" -ExpectedStatus 200 -ExpectContentTypeLike "application/pdf"
Invoke-Probe -Name "specs missing PDF (expect 404 JSON)" -Method "GET" -Url "$BaseUrl/specs/missing-qa3.pdf" -ExpectedStatus 404 -ExpectContentTypeLike "application/json" -ExpectBodyContains '"error"'

Write-Output ("{0,-46} {1,-5} {2,-6} {3,-28} {4}" -f "CHECK", "METH", "STATUS", "CONTENT-TYPE", "RESULT")
foreach ($r in $results) {
  $verdict = if ($r.Pass) { "PASS" } else { "FAIL [$($r.Reasons)]" }
  Write-Output ("{0,-46} {1,-5} {2,-6} {3,-28} {4}" -f $r.Name, $r.Method, $r.Status, $r.ContentType, $verdict)
}
$failed = @($results | Where-Object { -not $_.Pass })
Write-Output ""
Write-Output "SUMMARY: $($results.Count - $failed.Count)/$($results.Count) passed"
Write-Output ""
Write-Output "--- BODY SNIPPETS ---"
foreach ($r in $results) {
  Write-Output "[$($r.Status)] $($r.Method) $($r.Url)"
  Write-Output "    $($r.Snippet)"
}
exit $failed.Count