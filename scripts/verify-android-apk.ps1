[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][ValidateSet('x86_64', 'arm64-v8a')][string]$Architecture
)

# Read-only artifact inspection. This does not install, unpack, or delete anything.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path (Split-Path -Parent $projectRoot) 'android-dev-shell.ps1') -SkipChecks
$utf8 = [Text.UTF8Encoding]::new($false)
$packageMetadata = [IO.File]::ReadAllText((Join-Path $projectRoot 'package.json'), $utf8) | ConvertFrom-Json
$appConfig = [IO.File]::ReadAllText((Join-Path $projectRoot 'app.json'), $utf8) | ConvertFrom-Json
$expectedVersionName = [string]$packageMetadata.version
$expectedVersionCode = [string]$appConfig.expo.android.versionCode
$expectedPackageName = [string]$appConfig.expo.android.package
if ([string]$appConfig.expo.version -ne $expectedVersionName) {
    throw 'package.json and app.json version values do not match.'
}
$apk = (Resolve-Path -LiteralPath $ApkPath).Path
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
$aapt = Join-Path $buildTools 'aapt.exe'
$signer = Join-Path $buildTools 'apksigner.bat'
$badging = & $aapt dump badging $apk
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect APK metadata.' }
$packageLine = [string]($badging | Select-String '^package:' | Select-Object -First 1).Line
if ($packageLine -notmatch "name='$([regex]::Escape($expectedPackageName))'") {
    throw "Unexpected APK package name; expected $expectedPackageName."
}
if ($packageLine -notmatch "versionCode='$([regex]::Escape($expectedVersionCode))'") {
    throw "Unexpected APK versionCode; expected $expectedVersionCode."
}
if ($packageLine -notmatch "versionName='$([regex]::Escape($expectedVersionName))'") {
    throw "Unexpected APK versionName; expected $expectedVersionName."
}
$permissions = & $aapt dump permissions $apk
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect APK permissions.' }
$manifest = (& $aapt dump xmltree $apk AndroidManifest.xml) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect APK manifest.' }
$signature = & $signer verify --verbose --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

foreach ($name in @('INTERNET','SYSTEM_ALERT_WINDOW','READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_MEDIA_AUDIO')) {
    if (($permissions -join "`n") -match "android\.permission\.$name'") { throw "Forbidden permission: $name" }
}
if (($badging -join "`n") -match 'application-debuggable') { throw 'APK must not be debuggable.' }
foreach ($attribute in @('allowBackup','usesCleartextTraffic')) {
    if ($manifest -notmatch "android:$attribute\(.*?\)=\(type 0x12\)0x0") { throw "$attribute must explicitly be false." }
}
if ($manifest -notmatch '(?s)expo\.modules\.updates\.ENABLED[^\n]*\n\s+A: android:value\(.*?\)=\(type 0x12\)0x0') { throw 'Expo Updates must be disabled.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    $abis = @($zip.Entries | ForEach-Object { if ($_.FullName -match '^lib/([^/]+)/') { $Matches[1] } } | Sort-Object -Unique)
    if ($abis.Count -ne 1 -or $abis[0] -ne $Architecture) { throw "Unexpected ABI set: $($abis -join ',')" }
    $bundle = $zip.GetEntry('assets/index.android.bundle')
    if (-not $bundle -or $bundle.Length -lt 100000) { throw 'Offline JavaScript bundle missing.' }
    $entry = $zip.GetEntry('assets/medication_vision/model-manifest.json')
    if (-not $entry) { throw 'Model manifest missing.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $modelManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($modelManifest.approvedForClosedSetUse -ne $false -or $modelManifest.thresholdsApproved -ne $false) { throw 'Unapproved visual comparison must stay disabled.' }
    $model = $zip.GetEntry('assets/medication_vision/mobilenet_v3_small.tflite')
    if (-not $model) { throw 'Bundled model missing.' }
    $stream = $model.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $modelHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($modelHash -ne $modelManifest.sha256) { throw 'Bundled model hash mismatch.' }
    if (-not $zip.GetEntry('assets/medication_vision/LICENSE-MODEL.txt')) { throw 'Model license missing.' }
    Write-Output "bundleBytes=$($bundle.Length)"
    Write-Output "modelSha256=$modelHash"
} finally { $zip.Dispose() }
$item = Get-Item -LiteralPath $apk
Write-Output 'status=passed'
Write-Output "apk=$apk"
Write-Output "architecture=$Architecture"
Write-Output "bytes=$($item.Length)"
Write-Output "lastWriteTime=$($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
Write-Output "sha256=$((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash)"
Write-Output 'appearance=count_only; remote=disabled'
$badging | Select-String '^package:|^sdkVersion:|^targetSdkVersion:|^native-code:' | ForEach-Object { $_.Line }
$permissions
$signature
