<#
  Publica una versión nueva de DropMusic para que todos la reciban como actualización.

  Uso (desde la carpeta del proyecto):
    powershell -ExecutionPolicy Bypass -File scripts\publicar-version.ps1 -Version 0.2.0 -Notas "Qué cambió"

  Qué hace:
    1. Pone el número de versión en package.json, tauri.conf.json y Cargo.toml.
    2. Compila el instalador firmado con tu clave privada (~\.tauri\dropmusic.key).
    3. Crea latest.json, el archivo que la app consulta para saber si hay una versión nueva.
    4. Sube todo a un release de GitHub (kirpulrbx-max/DropMusic). Las apps instaladas lo ven
       al abrirse o en Ajustes > Actualizaciones.

  La clave privada nunca se sube: si la pierdes, las apps ya instaladas no aceptarán versiones nuevas.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notas = "Mejoras y correcciones.",
  [string]$Repo = "kirpulrbx-max/DropMusic"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "La versión debe tener el formato 1.2.3" }
$keyPath = Join-Path $HOME ".tauri\dropmusic.key"
if (-not (Test-Path $keyPath)) { throw "No encuentro la clave de firma en $keyPath" }

function Set-FileText([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText((Join-Path $root $Path), $Text, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "1/4 Poniendo la versión $Version..." -ForegroundColor Cyan
$package = Get-Content package.json -Raw -Encoding UTF8
Set-FileText "package.json" ($package -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
$conf = Get-Content src-tauri\tauri.conf.json -Raw -Encoding UTF8
Set-FileText "src-tauri\tauri.conf.json" ($conf -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
$cargo = Get-Content src-tauri\Cargo.toml -Raw -Encoding UTF8
Set-FileText "src-tauri\Cargo.toml" ([regex]::new('(?m)^version = "[^"]+"').Replace($cargo, "version = `"$Version`"", 1))

Write-Host "2/4 Compilando el instalador firmado..." -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "La compilación falló." }

$bundle = Join-Path $root "src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $installer) { throw "No encontré el instalador de la versión $Version en $bundle" }
$signature = Get-Content "$($installer.FullName).sig" -Raw

Write-Host "3/4 Creando latest.json..." -ForegroundColor Cyan
$assetName = $installer.Name -replace ' ', '.'
$latest = [ordered]@{
  version   = $Version
  notes     = $Notas
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature.Trim()
      url       = "https://github.com/$Repo/releases/download/v$Version/$assetName"
    }
  }
}
$latestPath = Join-Path $bundle "latest.json"
Set-FileText ($latestPath.Substring($root.Length + 1)) ($latest | ConvertTo-Json -Depth 5)

Write-Host "4/4 Subiendo el release v$Version a GitHub..." -ForegroundColor Cyan
gh release create "v$Version" $installer.FullName "$($installer.FullName).sig" $latestPath --repo $Repo --title "DropMusic $Version" --notes $Notas
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el release en GitHub." }

Write-Host "Listo: DropMusic $Version publicado. Las apps instaladas lo verán al abrirse." -ForegroundColor Green
Write-Host "Recuerda hacer commit del cambio de versión." -ForegroundColor Yellow
