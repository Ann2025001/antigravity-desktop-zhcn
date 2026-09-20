[CmdletBinding()]
param(
    [ValidatePattern("^\d+\.\d+\.\d+$")]
    [string]$NodeVersion = "22.12.0",
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $ProjectRoot ".runtime\release"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$PackageName = "antigravity-desktop-zhcn-portable-win-x64"
$StagingRoot = Join-Path $OutputRoot $PackageName
$ArchivePath = Join-Path $OutputRoot "$PackageName.zip"
$ChecksumPath = "$ArchivePath.sha256"

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Child
    )
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $childFull = [System.IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作边界外路径：$childFull"
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $algorithm.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "")
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

Assert-ChildPath -Root $OutputRoot -Child $StagingRoot
Assert-ChildPath -Root $OutputRoot -Child $ArchivePath

$asarPackage = Join-Path $ProjectRoot "node_modules\@electron\asar\package.json"
if (-not (Test-Path -LiteralPath $asarPackage -PathType Leaf)) {
    throw "缺少生产依赖。请先在项目根目录运行 npm ci --ignore-scripts。"
}
$asarVersion = (Get-Content -Raw -LiteralPath $asarPackage -Encoding UTF8 | ConvertFrom-Json).version
if ($asarVersion -ne "4.2.1") {
    throw "ASAR 依赖版本不正确：$asarVersion；必须为 4.2.1。"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
}
Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ChecksumPath -Force -ErrorAction SilentlyContinue

$temporaryBase = [System.IO.Path]::GetTempPath()
$temporaryRoot = Join-Path $temporaryBase ("antigravity-zhcn-portable-" + [guid]::NewGuid().ToString("N"))
Assert-ChildPath -Root $temporaryBase -Child $temporaryRoot
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

try {
    $nodeArchiveName = "node-v$NodeVersion-win-x64.zip"
    $nodeArchivePath = Join-Path $temporaryRoot $nodeArchiveName
    $nodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeArchiveName"
    $nodeChecksumsUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
    Write-Host "下载官方 Node.js $NodeVersion 便携运行时..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $nodeDownloadUrl -OutFile $nodeArchivePath
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $nodeChecksumsUrl).Content
    $checksumPattern = "(?im)^([a-f0-9]{64})\s+\*?" + [regex]::Escape($nodeArchiveName) + "$"
    $checksumMatch = [regex]::Match($checksums, $checksumPattern)
    if (-not $checksumMatch.Success) {
        throw "官方 SHASUMS256.txt 中没有找到 $nodeArchiveName。"
    }
    $expectedNodeHash = $checksumMatch.Groups[1].Value.ToUpperInvariant()
    $actualNodeHash = Get-Sha256 -Path $nodeArchivePath
    if ($actualNodeHash -ne $expectedNodeHash) {
        throw "Node.js 下载文件 SHA-256 校验失败。"
    }
    Write-Host "Node.js 官方 SHA-256 校验通过。" -ForegroundColor DarkGray
    Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $temporaryRoot
    $nodeRoot = Join-Path $temporaryRoot "node-v$NodeVersion-win-x64"

    New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StagingRoot "runtime") | Out-Null

    foreach ($directory in @(
        "src",
        "config",
        "docs",
        "node_modules",
        "scripts",
        ".github"
    )) {
        Copy-Item -LiteralPath (Join-Path $ProjectRoot $directory) -Destination $StagingRoot -Recurse
    }
    foreach ($file in @(
        "一键汉化.bat",
        "一键检查兼容性.bat",
        "生成汉化预览.bat",
        "一键恢复英文.bat",
        "清理缓存.bat",
        "完全卸载.bat",
        "README.md",
        "LICENSE",
        "package.json",
        "package-lock.json"
    )) {
        Copy-Item -LiteralPath (Join-Path $ProjectRoot $file) -Destination $StagingRoot
    }
    Copy-Item -LiteralPath (Join-Path $nodeRoot "node.exe") -Destination (Join-Path $StagingRoot "runtime")
    Copy-Item -LiteralPath (Join-Path $nodeRoot "LICENSE") -Destination (Join-Path $StagingRoot "runtime\NODE_LICENSE")

    $buildInfo = @{
        package = $PackageName
        builtAt = (Get-Date).ToUniversalTime().ToString("o")
        nodeVersion = $NodeVersion
        asarVersion = $asarVersion
    } | ConvertTo-Json
    Set-Content -LiteralPath (Join-Path $StagingRoot "BUILD_INFO.json") -Value $buildInfo -Encoding UTF8

    Compress-Archive -LiteralPath $StagingRoot -DestinationPath $ArchivePath -CompressionLevel Optimal
    $archiveHash = Get-Sha256 -Path $ArchivePath
    Set-Content -LiteralPath $ChecksumPath -Value "$archiveHash  $PackageName.zip" -Encoding ASCII

    Write-Host "便携包构建完成：$ArchivePath" -ForegroundColor Green
    Write-Host "SHA256: $archiveHash" -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Assert-ChildPath -Root $temporaryBase -Child $temporaryRoot
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
