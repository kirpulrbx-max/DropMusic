<#
  Compila el APK firmado de DropMusic para Android.

  Uso (desde la carpeta del proyecto):
    powershell -ExecutionPolicy Bypass -File scripts\compilar-android.ps1 -Variante tv
    powershell -ExecutionPolicy Bypass -File scripts\compilar-android.ps1 -Variante movil

  - tv:    Android TV / Google TV. El modo TV viene activado (letra grande y control remoto).
  - movil: celulares y tabletas Android.

  Tauri enlaza las librerías con enlaces simbólicos, que Windows solo permite con el
  "Modo de desarrollador". Este script copia las librerías y empaqueta con Gradle, así que
  funciona sin activarlo. El APK queda en src-tauri\target\android\.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("tv", "movil")][string]$Variante
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$env:ANDROID_HOME = $sdk
$env:NDK_HOME = Join-Path $sdk "ndk\27.0.12077973"
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Java\jdk-22" }
$env:VITE_DEVICE = if ($Variante -eq "tv") { "tv" } else { "" }

$version = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$parts = $version.Split('.') | ForEach-Object { [int]$_ }
$versionCode = $parts[0] * 1000000 + $parts[1] * 1000 + $parts[2]
$targets = @(
  @{ Rust = "aarch64"; Triple = "aarch64-linux-android"; Abi = "arm64-v8a" },
  @{ Rust = "armv7"; Triple = "armv7-linux-androideabi"; Abi = "armeabi-v7a" }
)
$app = Join-Path $root "src-tauri\gen\android\app"

foreach ($target in $targets) {
  Write-Host "Compilando DropMusic ($Variante) para $($target.Abi)..." -ForegroundColor Cyan
  $lib = Join-Path $root "src-tauri\target\$($target.Triple)\release\libdropmusic_lib.so"
  $before = if (Test-Path $lib) { (Get-Item $lib).LastWriteTime } else { [datetime]::MinValue }
  # Falla al final por el enlace simbólico; lo que importa es que la librería quede compilada.
  # Por cmd: PowerShell 5 trataría los avisos de Tauri (que van a stderr) como errores.
  cmd /c "npx tauri android build --apk --target $($target.Rust) 2>&1" | Where-Object { $_ -match "Finished|error\[" } | Out-Host
  if (-not (Test-Path $lib) -or (Get-Item $lib).LastWriteTime -le $before) { throw "No se pudo compilar la librería para $($target.Abi)." }
  $jni = Join-Path $app "src\main\jniLibs\$($target.Abi)"
  New-Item -ItemType Directory -Force $jni | Out-Null
  Copy-Item $lib (Join-Path $jni "libdropmusic_lib.so") -Force
}

New-Item -ItemType Directory -Force (Join-Path $app "src\main\assets") | Out-Null
Copy-Item src-tauri\tauri.conf.json (Join-Path $app "src\main\assets\tauri.conf.json") -Force
Set-Content (Join-Path $app "tauri.properties") -Encoding ascii -Value @("tauri.android.versionName=$version", "tauri.android.versionCode=$versionCode")

Write-Host "Empaquetando y firmando el APK..." -ForegroundColor Cyan
Push-Location (Join-Path $root "src-tauri\gen\android")
.\gradlew.bat assembleUniversalRelease "-PabiList=arm64-v8a,armeabi-v7a" "-ParchList=arm64,arm" "-PtargetList=aarch64,armv7" -x rustBuildUniversalRelease -x rustBuildArm64Release -x rustBuildArmRelease --console=plain -q
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "Gradle no pudo empaquetar el APK." }

$name = if ($Variante -eq "tv") { "DropMusic_${version}_android-tv.apk" } else { "DropMusic_${version}_android.apk" }
$out = Join-Path $root "src-tauri\target\android"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $app "build\outputs\apk\universal\release\app-universal-release.apk") (Join-Path $out $name) -Force
Write-Host "Listo: $(Join-Path $out $name)" -ForegroundColor Green
