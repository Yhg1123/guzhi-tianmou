$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '../qa/training-tools'
New-Item -ItemType Directory -Path $root -Force|Out-Null
$zip=Join-Path $root 'brush-v0.3.0.zip'
$expected='b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6'
if (!(Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $expected) {
  Invoke-WebRequest -Uri 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip' -OutFile "$zip.part"
  if ((Get-FileHash -LiteralPath "$zip.part" -Algorithm SHA256).Hash.ToLower() -ne $expected) {throw 'Official trainer archive checksum mismatch'}
  Move-Item -LiteralPath "$zip.part" -Destination $zip -Force
}
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $root 'brush-v0.3.0') -Force
Write-Output 'Verified Brush 0.3.0 native Windows trainer. No finished scene models are downloaded.'
