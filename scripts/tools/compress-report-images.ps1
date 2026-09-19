# Root-purpose tool: keep curated, self-contained audit reports small enough to
# ship in the repo while remaining fully offline-openable for judges.
#
# Modes:
#   -Mode embedded  -InPath report.html -OutPath slim.html
#       Re-encodes every base64 PNG data URI (resized + JPEG) in place.
#   -Mode folder    -SourceDir in\images -OutputDir out\images
#       Re-encodes standalone PNG files to same-named .jpg (callers rewrite refs).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/tools/compress-report-images.ps1 ...
param(
  [Parameter(Mandatory = $true)][ValidateSet("embedded", "folder")][string]$Mode,
  [string]$InPath,
  [string]$OutPath,
  [string]$SourceDir,
  [string]$OutputDir,
  [int]$MaxWidth = 1000,
  [int]$Quality = 72
)

Add-Type -AssemblyName System.Drawing

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
if (-not $jpegCodec) { throw "No JPEG encoder available" }

function Convert-BitmapToJpegBytes {
  param([System.Drawing.Image]$Image, [int]$MaxWidth, [int]$Quality, [System.Drawing.Imaging.ImageCodecInfo]$Codec)
  $w = $Image.Width; $h = $Image.Height
  if ($w -gt $MaxWidth) { $h = [int]($h * $MaxWidth / $w); $w = $MaxWidth }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($Image, 0, 0, $w, $h)
    $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $Codec, $params)
    return $ms.ToArray()
  } finally {
    $g.Dispose(); $bmp.Dispose()
  }
}

if ($Mode -eq "embedded") {
  if (-not $InPath -or -not $OutPath) { throw "-InPath and -OutPath are required for embedded mode" }
  $html = [System.IO.File]::ReadAllText($InPath)
  $script:count = 0; $script:before = 0; $script:after = 0
  $rx = [regex]"data:image/png;base64,([A-Za-z0-9+/=]+)"
  $result = $rx.Replace($html, {
      param($m)
      $bytes = [Convert]::FromBase64String($m.Groups[1].Value)
      $ms = New-Object System.IO.MemoryStream(, $bytes)
      $img = [System.Drawing.Image]::FromStream($ms)
      try {
        $out = Convert-BitmapToJpegBytes -Image $img -MaxWidth $MaxWidth -Quality $Quality -Codec $jpegCodec
      } finally {
        $img.Dispose(); $ms.Dispose()
      }
      $script:before += $bytes.Length; $script:after += $out.Length; $script:count++
      return "data:image/jpeg;base64," + [Convert]::ToBase64String($out)
    })
  [System.IO.File]::WriteAllText($OutPath, $result, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "$(Split-Path $OutPath -Leaf): $script:count embedded PNGs -> JPEG; $([math]::Round($script:before/1MB,2)) MB -> $([math]::Round($script:after/1MB,2)) MB"
  exit 0
}

if ($Mode -eq "folder") {
  if (-not $SourceDir -or -not $OutputDir) { throw "-SourceDir and -OutputDir are required for folder mode" }
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $script:files = 0; $script:before = 0; $script:after = 0
  Get-ChildItem -LiteralPath $SourceDir -File | Where-Object { $_.Extension -match "^\.(png|jpg|jpeg)$" } | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    try {
      $out = Convert-BitmapToJpegBytes -Image $img -MaxWidth $MaxWidth -Quality $Quality -Codec $jpegCodec
    } finally {
      $img.Dispose()
    }
    $target = Join-Path $OutputDir ([System.IO.Path]::GetFileNameWithoutExtension($_.Name) + ".jpg")
    [System.IO.File]::WriteAllBytes($target, $out)
    $script:files++; $script:before += $_.Length; $script:after += $out.Length
  }
  Write-Output "folder: $script:files images -> JPG; $([math]::Round($script:before/1MB,2)) MB -> $([math]::Round($script:after/1MB,2)) MB"
  exit 0
}