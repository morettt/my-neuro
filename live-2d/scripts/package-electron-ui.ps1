$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir 'node_modules\electron\dist'
$buildDir = Join-Path $projectDir 'build\electron-ui'
# ASCII source also works with Windows PowerShell's default file encoding.
$exeName = ([string][char]0x80A5) + ([string][char]0x725B) + '.exe'

foreach ($relative in @('control-main.js', 'control-preload.js', 'control-renderer.js', 'control.html', 'config.json', 'go.bat', 'fake_neuro.ico')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir $relative) -PathType Leaf)) {
        throw "Missing required file: $relative. Restore the project files / run npm install first."
    }
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js is required to build the UI.' }

# Recent Electron versions download the runtime on first launch, not npm install.
# Packaging uses the runtime directly, so explicitly install it when missing.
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'electron.exe') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $runtimeDir 'version') -PathType Leaf)) {
    $electronInstaller = Join-Path $projectDir 'node_modules\electron\install.js'
    if (-not (Test-Path -LiteralPath $electronInstaller -PathType Leaf)) {
        throw 'Electron npm package is missing. Run npm install in the project directory, then retry.'
    }
    Write-Host 'Downloading the Electron runtime (first build only)...'
    & node.exe $electronInstaller
    if ($LASTEXITCODE -ne 0) { throw 'Failed to download the Electron runtime. Check the download error above and retry.' }
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'electron.exe') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $runtimeDir 'version') -PathType Leaf)) {
        throw 'Electron runtime installation did not produce electron.exe and version. Check the installation and retry.'
    }
}

# Windows includes the .NET Framework C# compiler; no builder download needed.
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'The Windows .NET Framework C# compiler is missing.'
}
Write-Host 'Building a small launcher using the project Electron runtime...'
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$artifact = Join-Path $buildDir 'Feiniu-launcher.exe'
$launcherSource = Join-Path $PSScriptRoot 'electron-ui-launcher.cs'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$(Join-Path $projectDir 'fake_neuro.ico')" "/out:$artifact" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed. See the error above.' }
Copy-Item -LiteralPath $artifact -Destination (Join-Path $projectDir $exeName) -Force
Write-Host "Done: $projectDir\$exeName"
Write-Host 'Keep the EXE in live-2d. It uses node_modules\electron\dist\electron.exe directly.'
