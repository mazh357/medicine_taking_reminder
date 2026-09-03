[CmdletBinding()]
param(
    [ValidateSet("x86_64", "arm64-v8a")]
    [string]$Architecture = "x86_64",
    [switch]$Minify,
    [switch]$PreserveCachesAndEvidence,
    [switch]$SkipPluginOutputReset
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$androidRoot = Join-Path $projectRoot "android"
$devShell = Join-Path $workspaceRoot "android-dev-shell.ps1"
$gradlew = Join-Path $androidRoot "gradlew.bat"
$common = Join-Path $PSScriptRoot "android-gradle-common.ps1"
$pluginRoot = Join-Path $projectRoot "node_modules\expo-dev-launcher\expo-dev-launcher-gradle-plugin"
$pluginJar = Join-Path $pluginRoot "build\libs\expo-dev-launcher-gradle-plugin.jar"
$expoModulePluginRoot = Join-Path $projectRoot "node_modules\expo-modules-core\expo-module-gradle-plugin"
$expoModulePluginJar = Join-Path $expoModulePluginRoot "build\libs\expo-module-gradle-plugin.jar"
$apk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
$oldCandidateHash = "AAD669ECD417A371933E9ABC49BFF3395E5ABCF5C19F8C0C7D1A5B5BFE803C59"
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$appVersion = [string]$packageJson.version
if ($appVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$') {
    throw "package.json contains an unsafe version string: $appVersion"
}
$artifactRoot = Join-Path $projectRoot "dist\android"
$artifactName = "long-term-medication-assistant-v$appVersion-$Architecture-internal.apk"
$architectureArtifact = Join-Path $artifactRoot $artifactName
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceRoot = Join-Path $workspaceRoot ".toolchains\build-evidence\release-$timestamp"
$projectCacheRoot = Join-Path $workspaceRoot ".toolchains\project-caches"
$projectCache = Join-Path $projectCacheRoot "release-$Architecture-$timestamp"
$buildLog = Join-Path $evidenceRoot "assemble-release.log"
$resultFile = Join-Path $evidenceRoot "release-build-result.txt"

. $common

function Get-Sha256Hash {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $stream = [IO.File]::OpenRead($LiteralPath)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Prune-ReleaseEvidence {
    param([Parameter(Mandatory = $true)][string]$CurrentEvidence)

    $evidenceParent = Join-Path $workspaceRoot ".toolchains\build-evidence"
    $records = Get-ChildItem -LiteralPath $evidenceParent -Directory -Filter "release-*" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $candidateResult = Join-Path $_.FullName "release-build-result.txt"
            $status = if (Test-Path -LiteralPath $candidateResult) {
                (Get-Content -LiteralPath $candidateResult | Where-Object { $_ -match '^status=' } | Select-Object -First 1) -replace '^status=', ''
            } else {
                "unknown"
            }
            [pscustomobject]@{ Directory = $_; Status = $status }
        }
    $keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $keep.Add([IO.Path]::GetFullPath($CurrentEvidence).TrimEnd('\')) | Out-Null
    foreach ($status in @("success", "failed")) {
        $latest = $records | Where-Object Status -eq $status | Sort-Object { $_.Directory.LastWriteTime } -Descending | Select-Object -First 1
        if ($latest) {
            $keep.Add([IO.Path]::GetFullPath($latest.Directory.FullName).TrimEnd('\')) | Out-Null
        }
    }
    foreach ($record in $records) {
        $fullPath = [IO.Path]::GetFullPath($record.Directory.FullName).TrimEnd('\')
        if ($record.Status -in @("success", "failed") -and -not $keep.Contains($fullPath)) {
            Remove-VerifiedDirectory -Path $fullPath -AllowedRoot $evidenceParent
        }
    }
}

if (-not (Test-Path -LiteralPath $devShell -PathType Leaf)) {
    throw "Android development environment script was not found: $devShell"
}
if (-not (Test-Path -LiteralPath $gradlew -PathType Leaf)) {
    throw "Gradle wrapper was not found: $gradlew"
}
if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "Expo Dev Launcher Gradle plugin source was not found: $pluginRoot"
}
if (-not (Test-Path -LiteralPath $expoModulePluginRoot -PathType Container)) {
    throw "Expo Modules Gradle plugin source was not found: $expoModulePluginRoot"
}

. $devShell -SkipChecks

Assert-PathInside -Path $projectCache -AllowedRoot (Join-Path $workspaceRoot ".toolchains") | Out-Null
Assert-PathInside -Path $evidenceRoot -AllowedRoot (Join-Path $workspaceRoot ".toolchains") | Out-Null
Assert-PathInside -Path $architectureArtifact -AllowedRoot $projectRoot | Out-Null

New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
New-Item -ItemType Directory -Path $projectCache -Force | Out-Null
$cacheWriteProbe = Join-Path $projectCache ".write-probe"
Set-Content -LiteralPath $cacheWriteProbe -Value "ok" -Encoding ASCII
if ((Get-Content -LiteralPath $cacheWriteProbe -Raw).Trim() -ne "ok") {
    throw "The isolated Gradle project cache is not writable: $projectCache"
}
Remove-Item -LiteralPath $cacheWriteProbe

$previousApkHash = $null
if (Test-Path -LiteralPath $apk -PathType Leaf) {
    $previousApkHash = Get-Sha256Hash -LiteralPath $apk
}
$previousArchitectureArtifactHash = $null
if (Test-Path -LiteralPath $architectureArtifact -PathType Leaf) {
    $previousArchitectureArtifactHash = Get-Sha256Hash -LiteralPath $architectureArtifact
}

Push-Location $androidRoot
try {
    & $gradlew --stop | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle daemon stop failed with exit code $LASTEXITCODE"
    }
    $daemonStatus = & $gradlew --status 2>&1
    $daemonStatus | Set-Content -LiteralPath (Join-Path $evidenceRoot "gradle-daemon-status-after-stop.txt") -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle daemon status check failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

if ($SkipPluginOutputReset) {
    Assert-IncludedGradlePluginJars -ProjectRoot $projectRoot
} else {
    Reset-IncludedGradlePluginOutputs -ProjectRoot $projectRoot
}

$buildStartedAt = Get-Date
$buildExitCode = -1
$gradleArgs = @(
    "-Dorg.gradle.parallel=false",
    "--no-daemon",
    "--max-workers=1",
    "--no-build-cache",
    "--rerun-tasks",
    "--no-problems-report",
    "--project-cache-dir", $projectCache,
    ":app:assembleRelease",
    "-PreactNativeArchitectures=$Architecture"
)
if ($Minify) { $gradleArgs += "-Pandroid.enableMinifyInReleaseBuilds=true" }

Push-Location $androidRoot
try {
    # Windows PowerShell wraps native stderr as ErrorRecord objects. Gradle
    # writes ordinary progress messages there, so keep streaming both channels
    # and decide success exclusively from the native process exit code.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $gradlew @gradleArgs 2>&1 | Tee-Object -FilePath $buildLog | Out-Host
        $buildExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
} finally {
    Pop-Location
    if (-not $PreserveCachesAndEvidence) {
        Remove-VerifiedDirectory -Path $projectCache -AllowedRoot $projectCacheRoot
    }
}

if ($buildExitCode -ne 0) {
    $pluginStatus = if (Test-JarContainsClass -JarPath $pluginJar -ClassPath "expo/modules/devlauncher/DevLauncherPlugin.class") { "present" } else { "missing" }
    $expoModulePluginStatus = if (Test-JarContainsClass -JarPath $expoModulePluginJar -ClassPath "expo/modules/plugin/ExpoModulesGradlePlugin.class") { "present" } else { "missing" }
    @(
        "status=failed",
        "exitCode=$buildExitCode",
        "architecture=$Architecture",
        "pluginImplementationClass=$pluginStatus",
        "expoModulePluginImplementationClass=$expoModulePluginStatus",
        "projectCache=$projectCache",
        "buildLog=$buildLog",
        "previousApkHash=$previousApkHash"
    ) | Set-Content -LiteralPath $resultFile -Encoding UTF8
    if (-not $PreserveCachesAndEvidence) {
        Prune-ReleaseEvidence -CurrentEvidence $evidenceRoot
    }
    throw "Release build failed. Evidence: $resultFile"
}

Assert-IncludedGradlePluginJars -ProjectRoot $projectRoot
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
    throw "Gradle reported success but no Release APK was generated. Evidence: $evidenceRoot"
}

$apkItem = Get-Item -LiteralPath $apk
if ($apkItem.LastWriteTime -lt $buildStartedAt) {
    throw "The Release APK predates this build and cannot be accepted. Evidence: $evidenceRoot"
}

$apkHash = Get-Sha256Hash -LiteralPath $apk
if ($apkHash -eq $oldCandidateHash) {
    throw "The Release APK hash matches the pre-fix package and cannot be accepted. Evidence: $evidenceRoot"
}

$jarTool = Join-Path $env:JAVA_HOME "bin\jar.exe"
$apkEntries = & $jarTool tf $apk
if ($LASTEXITCODE -ne 0) {
    throw "The generated APK could not be inspected. Evidence: $evidenceRoot"
}
$apkArchitectures = @(
    $apkEntries |
      ForEach-Object {
          if ($_ -match '^lib/([^/]+)/') { $Matches[1] }
      } |
      Sort-Object -Unique
)
if ($apkArchitectures.Count -ne 1 -or $apkArchitectures[0] -ne $Architecture) {
    throw "The generated APK ABI set '$($apkArchitectures -join ',')' does not match '$Architecture'. Evidence: $evidenceRoot"
}

Copy-Item -LiteralPath $apk -Destination $architectureArtifact -Force
$artifactItem = Get-Item -LiteralPath $architectureArtifact
$artifactHash = Get-Sha256Hash -LiteralPath $architectureArtifact
if ($artifactHash -ne $apkHash) {
    throw "The architecture-specific APK copy failed integrity verification. Evidence: $evidenceRoot"
}

@(
    "status=success",
    "architecture=$Architecture",
    "apk=$apk",
    "length=$($apkItem.Length)",
    "lastWriteTime=$($apkItem.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz'))",
    "sha256=$apkHash",
    "artifact=$architectureArtifact",
    "artifactLength=$($artifactItem.Length)",
    "artifactSha256=$artifactHash",
    "apkArchitectures=$($apkArchitectures -join ',')",
    "pluginImplementationClass=present",
    "expoModulePluginImplementationClass=present",
    "projectCache=$projectCache",
    "buildLog=$buildLog",
    "previousApkHash=$previousApkHash",
    "previousArchitectureArtifactHash=$previousArchitectureArtifactHash"
) | Set-Content -LiteralPath $resultFile -Encoding UTF8

if (-not $PreserveCachesAndEvidence) {
    Prune-ReleaseEvidence -CurrentEvidence $evidenceRoot
}

Write-Host "Verified Release build generated:" -ForegroundColor Green
Get-Content -LiteralPath $resultFile | Out-Host
