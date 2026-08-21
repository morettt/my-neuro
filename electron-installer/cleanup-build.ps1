$ErrorActionPreference = 'Stop'

$buildRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$targets = @(
    [System.IO.Path]::Combine($buildRoot, 'dist'),
    [System.IO.Path]::Combine($buildRoot, 'node_modules')
)

function Remove-ValidatedTree {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath)) {
        return
    }

    $item = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
        return
    }

    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) {
            Remove-ValidatedTree -LiteralPath $child.FullName
        }
    }
    Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
}

foreach ($target in $targets) {
    $fullTarget = [System.IO.Path]::GetFullPath($target)
    $parent = [System.IO.Path]::GetDirectoryName($fullTarget).TrimEnd('\')
    $leaf = [System.IO.Path]::GetFileName($fullTarget)
    if ($parent -ne $buildRoot -or $leaf -notin @('dist', 'node_modules')) {
        throw "Refusing unexpected cleanup target: $fullTarget"
    }
    Remove-ValidatedTree -LiteralPath $fullTarget
}
