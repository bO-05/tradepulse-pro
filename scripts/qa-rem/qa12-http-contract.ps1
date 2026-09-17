# QA-12 HTTP contract matrix (curl authoritative). 11 checks.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/qa-rem/qa12-http-contract.ps1
$ErrorActionPreference = "Continue"
$BASE = "https://brainy-skunk-440.convex.site"
$OUT = "D:\Repo\ALL HACKATHONS\Convex\Convex all gas\doc\tradepulse audits\outputs\evidence"
$RAW = Join-Path $OUT "remediation-qa12-raw"
New-Item -ItemType Directory -Force -Path $RAW | Out-Null
$LOG = Join-Path $OUT "remediation-qa12-http-contract.txt"
$lines = @()
$lines += "=== QA-12 HTTP CONTRACT MATRIX (curl.exe) ==="
$lines += "UTC: $(Get-Date -Format o)"
$lines += "Base: $BASE"
$lines += ""

$checks = @(
  @{ n = 1;  method = "GET";  path = "/api/health";                                    expect = 200; desc = "health" },
  @{ n = 2;  method = "GET";  path = "/api/no-such";                                   expect = 404; desc = "unknown api GET" },
  @{ n = 3;  method = "POST"; path = "/api/no-such";                                   expect = 404; desc = "unknown api POST" },
  @{ n = 4;  method = "GET";  path = "/agentmail/no-such";                             expect = 404; desc = "unknown agentmail GET" },
  @{ n = 5;  method = "POST"; path = "/agentmail/no-such";                             expect = 404; desc = "unknown agentmail POST" },
  @{ n = 6;  method = "GET";  path = "/agentmail/webhook";                             expect = 200; desc = "webhook GET" },
  @{ n = 7;  method = "POST"; path = "/agentmail/webhook";                             expect = 401; desc = "webhook POST no-svix" },
  @{ n = 8;  method = "GET";  path = "/llms.txt";                                      expect = 200; desc = "llms.txt" },
  @{ n = 9;  method = "GET";  path = "/dashboard";                                     expect = 200; desc = "SPA shell" },
  @{ n = 10; method = "GET";  path = "/specs/26_00_00_Electrical_Systems_Spec.pdf";     expect = 200; desc = "spec PDF" },
  @{ n = 11; method = "GET";  path = "/specs/missing.pdf";                             expect = 404; desc = "missing PDF" }
)

foreach ($c in $checks) {
  $slug = "{0:d2}" -f $c.n
  $bodyFile = Join-Path $RAW "qa12-$slug-body.out"
  $hdrFile = Join-Path $RAW "qa12-$slug-headers.txt"
  $args = @("-s", "-o", $bodyFile, "-D", $hdrFile, "-w", "%{http_code}|%{content_type}|%{size_download}", "-X", $c.method)
  if ($c.method -eq "POST") { $args += @("-H", "Content-Type: application/json", "--data", "{}") }
  $args += "$BASE$($c.path)"
  $res = & curl.exe @args 2>&1
  $parts = "$res".Split("|")
  $status = $parts[0]; $ctype = $parts[1]; $size = $parts[2]
  $headers = Get-Content -LiteralPath $hdrFile -Raw
  $server = if ($headers -match "(?im)^server:\s*(.+)$") { $Matches[1].Trim() } else { "" }
  $bodyHead = (Get-Content -LiteralPath $bodyFile -Raw -ErrorAction SilentlyContinue)
  if ($null -eq $bodyHead) { $bodyHead = "" }
  $bodyPreview = ($bodyHead -replace "\s+", " ").Trim()
  if ($bodyPreview.Length -gt 220) { $bodyPreview = $bodyPreview.Substring(0, 220) + "...[truncated]" }
  $ok = ("$status" -eq "$($c.expect)")
  $lines += ("[{0}] {1} {2} -> {3} (expect {4}) : {5}" -f $c.n, $c.method, $c.path, $status, $c.expect, $(if ($ok) { "PASS" } else { "FAIL" }))
  $lines += ("     content-type={0} bytes={1} server={2}" -f $ctype, $size, $server)
  $lines += ("     body: {0}" -f $bodyPreview)
  $lines += ""
}

# PDF sanity: magic bytes + sha256
$pdfFile = Join-Path $RAW "qa12-10-body.out"
$pdfBytes = [System.IO.File]::ReadAllBytes($pdfFile)
$magic = [System.Text.Encoding]::ASCII.GetString($pdfBytes[0..([Math]::Min(4, $pdfBytes.Length - 1))])
$sha = (Get-FileHash -LiteralPath $pdfFile -Algorithm SHA256).Hash.ToLower()
$lines += "PDF magic: '$magic' (expect %PDF-); sha256=$sha; bytes=$($pdfBytes.Length)"
$lines += ""

# SPA shell sanity
$spaFile = Join-Path $RAW "qa12-09-body.out"
$spa = Get-Content -LiteralPath $spaFile -Raw
$hasRoot = $spa -match 'id="root"'
$asset = if ($spa -match 'src="([^"]+\.js)"') { $Matches[1] } else { "(none)" }
$lines += "SPA shell: hasRoot=$hasRoot; bundle=$asset"
$lines += ""

$lines += "=== raw dumps in remediation-qa12-raw/ ==="
$lines -join "`n" | Set-Content -LiteralPath $LOG -Encoding UTF8
Write-Output ($lines -join "`n")