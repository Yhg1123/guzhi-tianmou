param([ValidateRange(16,166)][int]$MaxImages = 166)
$ErrorActionPreference = 'Stop'
$revision = '0a15cffbf0c0ab505b4844f88bdbbfcc494e17d9'
$dataset = 'heig-vd-geo/ImagesAndPointCloudsCulturalHeritageDataset'
$root = Join-Path $PSScriptRoot '../qa/local-training/cb/raw'
New-Item -ItemType Directory -Path "$root/images" -Force | Out-Null
$root = (Resolve-Path -LiteralPath $root).Path
$tree = Invoke-RestMethod -Uri "https://huggingface.co/api/datasets/$dataset/tree/$revision/5_CB/1_Images/1_RGB?limit=1000"
$tree = @($tree | Where-Object { $_.type -eq 'file' -and $_.path -match '^5_CB/1_Images/1_RGB/5_CB_\d{3}\.png$' } | Sort-Object path)
if ($tree.Count -ne 166) { throw 'Unexpected source photograph inventory' }
$selection = @(0..($MaxImages-1) | ForEach-Object { $tree[[int][math]::Round($_*($tree.Count-1)/($MaxImages-1))] })
$records = $selection | ForEach-Object -ThrottleLimit 4 -Parallel {
  $entry = $_
  $ProgressPreference='SilentlyContinue'
  $target = Join-Path $using:root ('images/' + [IO.Path]::GetFileName($entry.path))
  $url = "https://huggingface.co/datasets/$using:dataset/resolve/$using:revision/$($entry.path)"
  $valid = (Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -eq $entry.size -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -eq $entry.lfs.oid
  if (!$valid) {
    for ($attempt=0; $attempt -lt 3; $attempt++) {
      try {
        Invoke-WebRequest -Uri $url -OutFile "$target.part" -TimeoutSec 240 -ErrorAction Stop
        if ((Get-Item -LiteralPath "$target.part").Length -ne $entry.size -or (Get-FileHash -LiteralPath "$target.part" -Algorithm SHA256).Hash.ToLower() -ne $entry.lfs.oid) { throw 'Photograph checksum mismatch' }
        Move-Item -LiteralPath "$target.part" -Destination $target -Force
        break
      } catch { if ($attempt -eq 2) { throw } }
    }
  }
  Write-Host "Verified $([IO.Path]::GetFileName($entry.path))"
  [PSCustomObject]@{ name=[IO.Path]::GetFileName($entry.path);url=$url;bytes=$entry.size;sha256=$entry.lfs.oid }
}
foreach ($file in @('1_interior_parameters.txt','2_exterior_parameters.txt')) {
  Invoke-WebRequest -Uri "https://huggingface.co/datasets/$dataset/resolve/$revision/5_CB/1_Images/3_camera_info/$file" -OutFile (Join-Path $root $file)
}
Invoke-WebRequest -Uri "https://huggingface.co/datasets/$dataset/resolve/$revision/5_CB/2_PointCloud/2_transformation_matrix.txt" -OutFile (Join-Path $root '2_transformation_matrix.txt')
$manifest = [ordered]@{ schema=1; scene='5_CB'; source='https://zenodo.org/records/14626611'; mirror="https://huggingface.co/datasets/$dataset"; revision=$revision;license='CC BY 4.0';creators=@('Eugenio Pellis','Andrea Masiero','Michele Betti','Grazia Tucci','Pierre Grussenmeyer');selection='Evenly spaced photographs from all 166 source frames';photos=@($records|Sort-Object name);fetchedAt=[DateTime]::UtcNow.ToString('o') }
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'source.json') -Encoding utf8
Write-Host "Verified $($records.Count) original photographs."
