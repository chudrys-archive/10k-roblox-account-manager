# Builds the native manager window (bin\window\10k-window.exe) with the .NET Framework compiler that ships with Windows.
# The manager runs this by itself the first time it needs the window, so you normally never call it by hand.
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\bin\window')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The Windows .NET Framework compiler was not found.' }

$wv2 = Join-Path $PSScriptRoot 'webview2'
$core = Join-Path $wv2 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $wv2 'Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $wv2 'WebView2Loader.dll'
$icon = Join-Path $root 'assets\icon.ico'
$manifest = Join-Path $PSScriptRoot 'app-window.manifest'
$source = Join-Path $PSScriptRoot 'AppWindow.cs'
$loginSource = Join-Path $PSScriptRoot 'LoginWindow.cs'
foreach ($f in @($core, $forms, $loader, $icon, $manifest, $source, $loginSource)) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "Missing build input: $f" }
}

$out = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $out | Out-Null
$exe = Join-Path $out '10k-window.exe'
$tmp = Join-Path $out '10k-window.exe.new'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }

& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$tmp" "/win32icon:$icon" "/win32manifest:$manifest" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll "/r:$core" "/r:$forms" $source $loginSource
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

foreach ($f in @($core, $forms, $loader)) { Copy-Item -LiteralPath $f -Destination $out -Force }
Move-Item -LiteralPath $tmp -Destination $exe -Force
Write-Output "built $exe"
