$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$folder = Join-Path $root 'qa/seem-source'
$public = Join-Path $root 'public/gaussians'
New-Item -ItemType Directory -Force $folder,$public | Out-Null
# Source author enables downloads under CC BY 4.0 at https://superspl.at/scene/e832997f.
# Lingyue's scene is embed-only; this script does not download or mirror its files.
$base = 'https://d28zzqy0iyovbz.cloudfront.net/e832997f/v1/'
Invoke-WebRequest -Uri ($base + 'meta.json') -OutFile (Join-Path $folder 'meta.json') -TimeoutSec 60
$meta = Get-Content -LiteralPath (Join-Path $folder 'meta.json') -Raw | ConvertFrom-Json
if ($meta.version -ne 2 -or $meta.count -ne 960991) { throw 'Source revision changed; review before updating assets.' }
$files = @($meta.means.files) + @($meta.scales.files) + @($meta.quats.files) + @($meta.sh0.files) + @($meta.shN.files)
foreach ($name in ($files | Select-Object -Unique)) {
  if ($name -notmatch '^[a-zA-Z0-9_]+\.webp$') { throw 'Unsupported source filename.' }
  Invoke-WebRequest -Uri ($base + $name) -OutFile (Join-Path $folder $name) -TimeoutSec 90
}
Invoke-WebRequest -Uri 'https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/e832997f/v1/xl.webp' -OutFile (Join-Path $public 'seem-church-preview.webp') -TimeoutSec 60
Write-Output 'CC BY 4.0 source downloaded; decode and package using docs/trained-gaussians.md.'
