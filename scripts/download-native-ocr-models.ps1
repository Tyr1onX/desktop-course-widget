param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot '../src-tauri/resources/ocr-native')
)

$ErrorActionPreference = 'Stop'
$commit = '705052d551ac254f4b2925075f5a9695910305e9'
$base = "https://raw.githubusercontent.com/zibo-chen/rust-paddle-ocr/$commit/models"
$files = @{
  'PP-OCRv5_mobile_det_fp16.mnn' = '617b5228b101275594f96ebb6ae7662fd1618bcf8e84b0ffde1cf3b48e754951'
  'PP-OCRv5_mobile_rec_fp16.mnn' = 'ff03e4204260325eabe9f4eae0ec8cc6b79b8a97a8e38a5292ba69cf02a689fc'
  'ppocr_keys_v5.txt' = 'f2ed6bb20a850ce4767fa9b4622d9b282985ab7f0ea8f8c11abd790ca6d2ff94'
}

$resolved = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $resolved | Out-Null
foreach ($entry in $files.GetEnumerator()) {
  $destination = Join-Path $resolved $entry.Key
  if ((Test-Path -LiteralPath $destination -PathType Leaf) -and
      ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $entry.Value)) {
    continue
  }
  $temporary = "$destination.download"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -Uri "$base/$($entry.Key)" -OutFile $temporary
  $actual = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.Value) {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    throw "Native OCR model hash mismatch for $($entry.Key): $actual"
  }
  Move-Item -LiteralPath $temporary -Destination $destination -Force
}

@{
  modelCommit = $commit
  files = @($files.GetEnumerator() | Sort-Object Key | ForEach-Object {
    @{
      name = $_.Key
      sha256 = $_.Value
      bytes = (Get-Item -LiteralPath (Join-Path $resolved $_.Key)).Length
    }
  })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $resolved 'manifest.json') -Encoding utf8

Write-Host "Native OCR models ready at $resolved"
