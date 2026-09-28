$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$zip = Join-Path (Split-Path $root -Parent) 'EMPPAY-Desktop-Source.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $root '*') -DestinationPath $zip -Force
Write-Host "Created: $zip"
Write-Host "Start the app with: npm install; npm run dev"
