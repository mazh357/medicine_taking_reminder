Set-StrictMode -Version Latest

function Assert-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    $resolvedRoot = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    $resolvedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $resolvedPath.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the intended root: $resolvedPath"
    }
    return $resolvedPath
}

function Remove-VerifiedDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    $resolvedPath = Assert-PathInside -Path $Path -AllowedRoot $AllowedRoot
    if (-not (Test-Path -LiteralPath $resolvedPath)) {
        return
    }
    $item = Get-Item -LiteralPath $resolvedPath -Force
    if (-not $item.PSIsContainer) {
        throw "Expected a directory but found a file: $resolvedPath"
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to recursively remove a reparse point: $resolvedPath"
    }
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Test-JarContainsClass {
    param(
        [Parameter(Mandatory = $true)][string]$JarPath,
        [Parameter(Mandatory = $true)][string]$ClassPath
    )

    if (-not (Test-Path -LiteralPath $JarPath -PathType Leaf)) {
        return $false
    }
    $jarTool = Join-Path $env:JAVA_HOME "bin\jar.exe"
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $entries = & $jarTool tf $JarPath 2>$null
        $jarExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($jarExitCode -ne 0) {
        return $false
    }
    return $entries -contains $ClassPath
}

function Get-IncludedGradlePluginSpecs {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $devLauncherRoot = Join-Path $ProjectRoot "node_modules\expo-dev-launcher\expo-dev-launcher-gradle-plugin"
    $expoModulesRoot = Join-Path $ProjectRoot "node_modules\expo-modules-core\expo-module-gradle-plugin"
    return @(
        [pscustomobject]@{
            Name = "Expo Dev Launcher"
            Root = $devLauncherRoot
            Jar = Join-Path $devLauncherRoot "build\libs\expo-dev-launcher-gradle-plugin.jar"
            Class = "expo/modules/devlauncher/DevLauncherPlugin.class"
        },
        [pscustomobject]@{
            Name = "Expo Modules"
            Root = $expoModulesRoot
            Jar = Join-Path $expoModulesRoot "build\libs\expo-module-gradle-plugin.jar"
            Class = "expo/modules/plugin/ExpoModulesGradlePlugin.class"
        }
    )
}

function Reset-IncludedGradlePluginOutputs {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $workspaceRoot = Split-Path -Parent ([IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\'))
    $toolchainsRoot = Join-Path $workspaceRoot ".toolchains"
    $quarantineRoot = Join-Path $toolchainsRoot ("tmp\gradle-plugin-reset-{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $PID)
    Assert-PathInside -Path $quarantineRoot -AllowedRoot $toolchainsRoot | Out-Null
    New-Item -ItemType Directory -Path $quarantineRoot -Force | Out-Null

    foreach ($plugin in Get-IncludedGradlePluginSpecs -ProjectRoot $ProjectRoot) {
        if (-not (Test-Path -LiteralPath $plugin.Root -PathType Container)) {
            throw "$($plugin.Name) plugin source was not found: $($plugin.Root)"
        }
        $safeName = $plugin.Name.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
        foreach ($leaf in @("build", ".gradle")) {
            $source = Join-Path $plugin.Root $leaf
            if (-not (Test-Path -LiteralPath $source)) {
                continue
            }
            $resolvedSource = Assert-PathInside -Path $source -AllowedRoot $plugin.Root
            $item = Get-Item -LiteralPath $resolvedSource -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to move a plugin reparse point: $resolvedSource"
            }
            $destination = Join-Path $quarantineRoot "$safeName-$($leaf.TrimStart('.'))"
            Assert-PathInside -Path $destination -AllowedRoot $quarantineRoot | Out-Null
            # Directory.Move performs a same-volume atomic rename.  This avoids
            # PowerShell recursively reopening every generated class file, which
            # can fail on Windows even when the directory itself is movable.
            [IO.Directory]::Move($resolvedSource, $destination)
        }
    }
}

function Assert-IncludedGradlePluginJars {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    foreach ($plugin in Get-IncludedGradlePluginSpecs -ProjectRoot $ProjectRoot) {
        if (-not (Test-JarContainsClass -JarPath $plugin.Jar -ClassPath $plugin.Class)) {
            throw "$($plugin.Name) plugin JAR is incomplete: $($plugin.Jar)"
        }
    }
}
