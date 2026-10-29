$ErrorActionPreference='Stop'
$revision='0a15cffbf0c0ab505b4844f88bdbbfcc494e17d9'
$dataset='heig-vd-geo/ImagesAndPointCloudsCulturalHeritageDataset'
$root=Join-Path $PSScriptRoot '../qa/local-training/cb/raw'
New-Item -ItemType Directory -Path "$root/labels" -Force|Out-Null
$root=(Resolve-Path -LiteralPath $root).Path
$tree=Invoke-RestMethod -Uri "https://huggingface.co/api/datasets/$dataset/tree/$revision/5_CB/1_Images/2_labels?limit=1000"
$records=$tree|Where-Object{$_.type -eq 'file' -and $_.path -match '/5_CB_\d{3}\.png$'}|ForEach-Object -ThrottleLimit 6 -Parallel {
  $ProgressPreference='SilentlyContinue';$entry=$_
  $target=Join-Path $using:root ('labels/'+[IO.Path]::GetFileName($entry.path))
  $url="https://huggingface.co/datasets/$using:dataset/resolve/$using:revision/$($entry.path)"
  if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $entry.lfs.oid) {
    for($attempt=0;$attempt -lt 5;$attempt++) {
      try {
        Invoke-WebRequest -Uri $url -OutFile "$target.part" -TimeoutSec 120 -ErrorAction Stop
        if ((Get-FileHash -LiteralPath "$target.part" -Algorithm SHA256).Hash.ToLower() -ne $entry.lfs.oid) {throw 'Annotation checksum mismatch'}
        Move-Item -LiteralPath "$target.part" -Destination $target -Force
        break
      }catch{if($attempt -eq 4){throw}}
    }
  }
  [PSCustomObject]@{name=[IO.Path]::GetFileName($entry.path);bytes=$entry.size;sha256=$entry.lfs.oid;url=$url}
}
if ($records.Count -ne 166) {throw 'Annotation inventory incomplete'}
@{revision=$revision;source='https://zenodo.org/records/14626611';license='CC BY 4.0';labels=@($records|Sort-Object name)}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath "$root/labels-source.json" -Encoding utf8
Write-Host 'Verified 166 architectural annotation maps.'
