param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$node = (Get-Command node.exe -CommandType Application -TotalCount 1 -ErrorAction Stop).Source
$nodeVersion = & $node --version
$nodeArch = & $node -p 'process.arch'
if ($nodeVersion -notmatch '^v(\d+)\.\d+\.\d+$' -or [int]$Matches[1] -lt 22 -or $nodeArch -ne 'x64') {
    throw 'The Windows x64 build requires a 64-bit Node.js 22 or newer.'
}

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'The Windows .NET Framework compiler was not found.'
}

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$output = [System.IO.Directory]::CreateDirectory($output).FullName
$stage = Join-Path $output ('.iram-build-' + [Guid]::NewGuid().ToString('N'))
$stage = [System.IO.Directory]::CreateDirectory($stage).FullName
try {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $payload = Join-Path $stage 'app.zip'
    $license = Join-Path $stage 'NODE-LICENSE.txt'
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -UseBasicParsing -OutFile $license

    $archive = [System.IO.Compression.ZipFile]::Open($payload, 'Create')
    try {
        $inputs = @(
            @{ Path = $node; Entry = 'node.exe' }
            @{ Path = $license; Entry = 'NODE-LICENSE.txt' }
            @{ Path = (Join-Path $root 'assets\icon.ico'); Entry = 'assets/icon.ico' }
        )
        $sourceFiles = Get-ChildItem -LiteralPath (Join-Path $root 'src') -File |
            Where-Object Extension -In '.js', '.ps1'
        $publicFiles = Get-ChildItem -LiteralPath (Join-Path $root 'public') -File |
            Where-Object Extension -In '.html', '.css', '.js', '.png'
        $inputs += $sourceFiles | ForEach-Object { @{ Path = $_.FullName; Entry = "src/$($_.Name)" } }
        $inputs += $publicFiles | ForEach-Object { @{ Path = $_.FullName; Entry = "public/$($_.Name)" } }
        foreach ($inputFile in $inputs) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $inputFile.Path, $inputFile.Entry, 'Optimal') | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }

    $name = "Isa-Roblox-Account-Manager-$($package.version)-win-x64.exe"
    $executable = Join-Path $stage $name
    $versionSource = Join-Path $stage 'Version.cs'
    $version = [version]$package.version
    Set-Content -LiteralPath $versionSource -Encoding Ascii -Value @"
using System.Reflection;
[assembly: AssemblyVersion("$version")]
[assembly: AssemblyFileVersion("$version")]
"@
    $icon = Join-Path $root 'assets\icon.ico'
    $launcher = Join-Path $PSScriptRoot 'WindowsLauncher.cs'
    $compilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+'
        "/out:$executable", "/win32icon:$icon", "/resource:$payload,app.zip"
        '/reference:System.Windows.Forms.dll', '/reference:System.IO.Compression.dll'
        '/reference:System.IO.Compression.FileSystem.dll', $launcher, $versionSource
    )
    & $compiler @compilerArgs
    if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed ($LASTEXITCODE)." }

    $final = Join-Path $output $name
    Move-Item -LiteralPath $executable -Destination $final -Force
    Get-Item -LiteralPath $final
}
finally {
    if ((Split-Path -Parent $stage).TrimEnd('\') -eq $output.TrimEnd('\') -and
        (Split-Path -Leaf $stage) -match '^\.iram-build-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
