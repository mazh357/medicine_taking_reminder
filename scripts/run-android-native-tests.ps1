[CmdletBinding()]
param(
    [ValidateSet("x86_64", "arm64-v8a")]
    [string]$Architecture = "x86_64"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$androidRoot = Join-Path $projectRoot "android"
$devShell = Join-Path $workspaceRoot "android-dev-shell.ps1"
$gradlew = Join-Path $androidRoot "gradlew.bat"
$common = Join-Path $PSScriptRoot "android-gradle-common.ps1"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$projectCacheRoot = Join-Path $workspaceRoot ".toolchains\project-caches"
$projectCache = Join-Path $projectCacheRoot "native-tests-$timestamp"

. $devShell -SkipChecks
. $common

Assert-PathInside -Path $projectCache -AllowedRoot (Join-Path $workspaceRoot ".toolchains") | Out-Null
New-Item -ItemType Directory -Path $projectCache -Force | Out-Null

$exitCode = -1
Push-Location $androidRoot
try {
    & $gradlew --stop | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle daemon stop failed with exit code $LASTEXITCODE"
    }
    Reset-IncludedGradlePluginOutputs -ProjectRoot $projectRoot
    $gradleArgs = @(
        "-Dorg.gradle.parallel=false",
        "--no-daemon",
        "--max-workers=1",
        "--no-build-cache",
        "--no-problems-report",
        "--project-cache-dir", $projectCache,
        ":local-data-crypto:testDebugUnitTest",
        ":demo-pill-counter:testDebugUnitTest",
        ":local-data-crypto:connectedDebugAndroidTest",
        "-PreactNativeArchitectures=$Architecture"
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $gradlew @gradleArgs 2>&1 | Out-Host
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
} finally {
    Pop-Location
    Remove-VerifiedDirectory -Path $projectCache -AllowedRoot $projectCacheRoot
}

if ($exitCode -ne 0) {
    throw "Android native tests failed with exit code $exitCode"
}
Assert-IncludedGradlePluginJars -ProjectRoot $projectRoot
Write-Host "Android native and instrumentation tests passed." -ForegroundColor Green
