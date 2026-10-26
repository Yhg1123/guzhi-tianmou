param([switch]$PrimaryOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'site-archive-sources.json') | ConvertFrom-Json
$output = Join-Path $root 'public/site-archives'
New-Item -ItemType Directory -Force $output | Out-Null
$photos = @($config | ForEach-Object { $_.photos })
$titles = ($photos.file | Select-Object -Unique) -join '|'
$url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size|sha1|mime&titles=' + [uri]::EscapeDataString($titles)
$response = Invoke-RestMethod -Uri $url -TimeoutSec 60 -Headers @{'User-Agent'='HeritageAtlas/1.0 (open heritage archive preparation)'}
$catalog = @()
foreach ($entry in $config) {
  $records = @()
  foreach ($photo in $entry.photos) {
    if ($PrimaryOnly -and $photo -ne $entry.photos[0] -and -not (Test-Path -LiteralPath (Join-Path $output ($photo.id + '.jpg')))) { continue }
    $page = $response.query.pages.psobject.Properties.Value | Where-Object { $_.title.Replace('_',' ') -eq $photo.file.Replace('_',' ') } | Select-Object -First 1
    if (-not $page.imageinfo) { throw ('Missing source metadata: ' + $photo.file) }
    $info = $page.imageinfo[0]
    $meta = $info.extmetadata
    $license = $meta.LicenseShortName.value
    if ($license -notmatch '^(Public domain|CC0|CC BY [0-9.]|CC BY-SA [0-9.])' -or $info.mime -ne 'image/jpeg') { throw ('Unsupported license or media: ' + $photo.file) }
    $relative = if ($photo.existingPath) { $photo.existingPath } else { '/site-archives/' + $photo.id + '.jpg' }
    $target = Join-Path (Join-Path $root 'public') $relative.TrimStart('/')
    if (-not (Test-Path -LiteralPath $target)) {
      for ($attempt=0; $attempt -lt 5; $attempt++) {
        try { Invoke-WebRequest -Uri $info.url -OutFile ($target + '.download') -TimeoutSec 90 -Headers @{'User-Agent'='HeritageAtlas/1.0'}; Move-Item -LiteralPath ($target + '.download') -Destination $target; break }
        catch {
          $status = [int]$_.Exception.Response.StatusCode
          if ($status -ne 429 -or $attempt -eq 4) { throw ('Image request failed, HTTP ' + $status + ': ' + $photo.id) }
          $retry = $_.Exception.Response.Headers.RetryAfter.Delta.TotalSeconds
          $delay = [Math]::Max(30, [int]$retry)
          Write-Output ('Source rate limit; waiting ' + $delay + ' seconds before retrying ' + $photo.id)
          while ($delay -gt 0) { $pause = [Math]::Min(30,$delay); Start-Sleep -Seconds $pause; $delay -= $pause }
        }
      }
      Start-Sleep -Seconds 3
    }
    if ((Get-Item -LiteralPath $target).Length -ne $info.size) { throw ('Incomplete original image: ' + $photo.id) }
    if ($info.sha1 -match '^[a-fA-F0-9]{40}$' -and (Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash -ne $info.sha1) { throw ('Source checksum mismatch: ' + $photo.id) }
    $records += [ordered]@{ id=$photo.id; title=$photo.title; url=$relative; sourceUrl=$info.descriptionurl; originalUrl=$info.url; author=[System.Net.WebUtility]::HtmlDecode(($meta.Artist.value -replace '<[^>]+>','')); license=$license; licenseUrl=$meta.LicenseUrl.value; capturedOn=[System.Net.WebUtility]::HtmlDecode(($meta.DateTimeOriginal.value -replace '<[^>]+>','')); width=$info.width; height=$info.height; bytes=$info.size; sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower(); originalUnmodified=$true }
    Write-Output ('Fetched ' + $photo.id + ' / ' + $license)
  }
  $catalog += [ordered]@{ id=$entry.id; site=[ordered]@{id=$entry.siteId;name=$entry.siteName;lng=$entry.lng;lat=$entry.lat}; subject=$entry.subject; subjectType=$entry.subjectType; photos=$records; processing=$entry.processing }
}
$catalog | ConvertTo-Json -Depth 15 | Set-Content -Encoding utf8 (Join-Path $output 'sources.json')
