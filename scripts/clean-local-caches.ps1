[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
    [switch]$Execute,
    [switch]$Deep,
    [switch]$PruneEvidence
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $projectRoot)).TrimEnd('\')
$toolchainsRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot ".toolchains")).TrimEnd('\')
$androidRoot = Join-Path $projectRoot "android"
$nodeModulesRoot = Join-Path $projectRoot "node_modules"
$targets = [Collections.Generic.List[string]]::new()

function Add-CleanupTarget {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $targets.Add([IO.Path]::GetFullPath($LiteralPath).TrimEnd('\'))
}

function Assert-SafeCleanupTarget {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $fullPath = [IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    $insideProject = $fullPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    $insideToolchains = $fullPath.StartsWith($toolchainsRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    if (-not ($insideProject -or $insideToolchains)) {
        throw "Cleanup target is outside the approved workspace roots: $fullPath"
    }

    $forbiddenExact = @($workspaceRoot, $projectRoot, $toolchainsRoot, $androidRoot, $nodeModulesRoot)
    if ($forbiddenExact -contains $fullPath) {
        throw "Cleanup target is too broad: $fullPath"
    }

    $protectedTrees = @(
        (Join-Path $projectRoot "app"),
        (Join-Path $projectRoot "assets"),
        (Join-Path $projectRoot "dist"),
        (Join-Path $projectRoot "docs"),
        (Join-Path $projectRoot "scripts"),
        (Join-Path $projectRoot "src"),
        (Join-Path $projectRoot "tests"),
        (Join-Path $toolchainsRoot "android-avd"),
        (Join-Path $toolchainsRoot "android-sdk"),
        (Join-Path $toolchainsRoot "android-studio"),
        (Join-Path $toolchainsRoot "gradle-home"),
        (Join-Path $toolchainsRoot "jdk-17"),
        (Join-Path $toolchainsRoot "npm-cache")
    ) | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }

    foreach ($protected in $protectedTrees) {
        if ($fullPath -eq $protected -or $fullPath.StartsWith($protected + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Cleanup target is protected: $fullPath"
        }
    }

    if (Test-Path -LiteralPath $fullPath) {
        $item = Get-Item -LiteralPath $fullPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Cleanup refuses to traverse a reparse point: $fullPath"
        }
    }
    return $fullPath
}

@(
    (Join-Path $projectRoot ".expo"),
    (Join-Path $androidRoot ".gradle"),
    (Join-Path $androidRoot "app\build"),
    (Join-Path $androidRoot "build")
) | ForEach-Object { Add-CleanupTarget $_ }

Get-ChildItem -LiteralPath (Join-Path $projectRoot "modules") -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Add-CleanupTarget (Join-Path $_.FullName "android\build") }

$projectCaches = Join-Path $toolchainsRoot "project-caches"
if (Test-Path -LiteralPath $projectCaches) {
    Get-ChildItem -LiteralPath $projectCaches -Force | ForEach-Object { Add-CleanupTarget $_.FullName }
}

$tempRoot = Join-Path $toolchainsRoot "tmp"
if (Test-Path -LiteralPath $tempRoot) {
    Get-ChildItem -LiteralPath $tempRoot -Force | ForEach-Object { Add-CleanupTarget $_.FullName }
}

if ($Deep -and (Test-Path -LiteralPath $nodeModulesRoot)) {
    Get-ChildItem -LiteralPath $nodeModulesRoot -Directory -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\android\\(build|\.cxx)$' } |
        ForEach-Object { Add-CleanupTarget $_.FullName }

    @(
        (Join-Path $nodeModulesRoot "@react-native\gradle-plugin\.gradle"),
        (Join-Path $nodeModulesRoot "@react-native\gradle-plugin\react-native-gradle-plugin\build"),
        (Join-Path $nodeModulesRoot "@react-native\gradle-plugin\settings-plugin\build"),
        (Join-Path $nodeModulesRoot "@react-native\gradle-plugin\shared\build"),
        (Join-Path $nodeModulesRoot "expo-dev-launcher\expo-dev-launcher-gradle-plugin\.gradle"),
        (Join-Path $nodeModulesRoot "expo-dev-launcher\expo-dev-launcher-gradle-plugin\build"),
        (Join-Path $nodeModulesRoot "expo-modules-core\expo-module-gradle-plugin\.gradle"),
        (Join-Path $nodeModulesRoot "expo-modules-core\expo-module-gradle-plugin\build")
    ) | ForEach-Object { Add-CleanupTarget $_ }
}

if ($PruneEvidence) {
    $evidenceRoot = Join-Path $toolchainsRoot "build-evidence"
    $classified = Get-ChildItem -LiteralPath $evidenceRoot -Directory -Filter "release-*" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $result = Join-Path $_.FullName "release-build-result.txt"
            $status = if (Test-Path -LiteralPath $result) {
                (Get-Content -LiteralPath $result | Where-Object { $_ -match '^status=' } | Select-Object -First 1) -replace '^status=', ''
            } else {
                "unknown"
            }
            [pscustomobject]@{ Directory = $_; Status = $status }
        }
    $keep = @(
        $classified | Where-Object Status -eq "success" | Sort-Object { $_.Directory.LastWriteTime } -Descending | Select-Object -First 1
        $classified | Where-Object Status -eq "failed" | Sort-Object { $_.Directory.LastWriteTime } -Descending | Select-Object -First 1
    ).Directory.FullName
    $classified | Where-Object {
        $_.Status -in @("success", "failed") -and $_.Directory.FullName -notin $keep
    } | ForEach-Object { Add-CleanupTarget $_.Directory.FullName }
}

$verifiedTargets = @(
    $targets | Sort-Object -Unique | ForEach-Object {
        $safeTarget = Assert-SafeCleanupTarget $_
        if (Test-Path -LiteralPath $safeTarget) {
            $safeTarget
        }
    }
)
if (-not $Execute) {
    Write-Host "Preview only. Nothing will be deleted. Re-run with -Execute to apply." -ForegroundColor Yellow
}
Write-Host "Verified cleanup targets: $($verifiedTargets.Count)"

if ($Execute -and $verifiedTargets.Count -gt 0 -and $PSVersionTable.PSVersion.Major -lt 7) {
    throw "Cache deletion requires PowerShell 7 or newer so Windows long paths are handled before any target is removed. Preview remains available in Windows PowerShell 5."
}

foreach ($target in $verifiedTargets) {
    if ($Execute -and $PSCmdlet.ShouldProcess($target, "Remove rebuildable cache")) {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Host "Removed: $target"
    } else {
        Write-Host "Would remove: $target"
    }
}
