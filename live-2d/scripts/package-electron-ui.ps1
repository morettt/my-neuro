$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir 'node_modules\electron\dist'
$buildDir = Join-Path $projectDir 'build\electron-ui'
$appDir = Join-Path $buildDir 'app'
$outputDir = Join-Path $buildDir 'dist'
$toolsDir = Join-Path $PSScriptRoot 'electron-ui-package'
$utf8 = New-Object System.Text.UTF8Encoding($false)
# ASCII source also works with Windows PowerShell's default file encoding.
$exeName = ([string][char]0x80A5) + ([string][char]0x725B) + '.exe'

foreach ($relative in @('node_modules\electron\dist\electron.exe', 'control-main.js', 'control-preload.js', 'control-renderer.js', 'control.html', 'config.json', 'go.bat', 'fake_neuro.ico')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir $relative) -PathType Leaf)) {
        throw "Missing required file: $relative. Restore the project files / run npm install first."
    }
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js is required to build the UI.' }

Write-Host '[1/3] Preparing the portable control-panel entry point...'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
$manifest = @{ name = 'feiniu-control'; version = '1.0.0'; main = 'main.js'; private = $true; description = 'Feiniu Electron control panel'; author = 'My-Neuro' } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $appDir 'package.json'), $manifest, $utf8)
$bootstrap = @'
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// NSIS portable sets this to the original EXE directory, not its temp folder.
const projectDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
const entry = path.join(projectDir, 'control-main.js');
if (!fs.existsSync(entry)) {
  dialog.showErrorBox('Feiniu', 'Please put this EXE in the live-2d project directory. Missing: ' + entry);
  app.exit(1);
} else {
  process.chdir(projectDir);
  app.setAppPath(projectDir);
  app.setName('Feiniu');
  require(entry);
}
'@
[IO.File]::WriteAllText((Join-Path $appDir 'main.js'), $bootstrap, $utf8)
$config = @{
    appId = 'com.myneuro.control'
    productName = 'Feiniu'
    artifactName = 'Feiniu.exe'
    asar = $true
    npmRebuild = $false
    electronVersion = ([IO.File]::ReadAllText((Join-Path $runtimeDir 'version'))).Trim()
    electronDist = $runtimeDir
    directories = @{ app = $appDir; output = $outputDir }
    files = @('main.js', 'package.json')
    win = @{ target = @(@{ target = 'portable'; arch = @('x64') }); icon = (Join-Path $projectDir 'fake_neuro.ico') }
} | ConvertTo-Json -Depth 8
$configPath = Join-Path $buildDir 'electron-builder.json'
[IO.File]::WriteAllText($configPath, $config, $utf8)

Write-Host '[2/3] Building a single portable EXE (first build may download build tools)...'
# Reuse the existing installer's builder if available, otherwise install locally.
$builderCli = Join-Path (Split-Path -Parent $projectDir) 'electron-installer\node_modules\electron-builder\cli.js'
if (-not (Test-Path -LiteralPath $builderCli)) {
    $builderCli = Join-Path $toolsDir 'node_modules\electron-builder\cli.js'
    if (-not (Test-Path -LiteralPath $builderCli)) {
        & npm.cmd install --prefix $toolsDir --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Failed to install electron-builder.' }
    }
}
& node.exe $builderCli --projectDir $toolsDir --config $configPath --win portable --x64
if ($LASTEXITCODE -ne 0) { throw 'Portable build failed. See the error above.' }

$artifact = Join-Path $outputDir 'Feiniu.exe'
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw 'Builder did not produce Feiniu.exe.' }
Copy-Item -LiteralPath $artifact -Destination (Join-Path $projectDir $exeName) -Force
Write-Host "[3/3] Done: $projectDir\$exeName"
Write-Host 'Only the final EXE is needed from the build output. Keep it in live-2d.'
Write-Host 'Existing project files and environments are still required.'
