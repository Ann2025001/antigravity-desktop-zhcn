[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Check", "Preview", "Install", "Restore", "Cleanup", "Purge")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Antigravity Desktop 中文汉化工具" -ForegroundColor Cyan
Write-Host " 操作: $Action" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$bundledNodePath = Join-Path $ProjectRoot "runtime\node.exe"
$usingBundledNode = Test-Path -LiteralPath $bundledNodePath -PathType Leaf
if ($usingBundledNode) {
    $nodePath = $bundledNodePath
    Write-Host "运行环境: 便携版内置 Node.js" -ForegroundColor DarkGray
} else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Stop-WithMessage "未检测到 Node.js。请下载项目的 portable 发布包，或安装 Node.js 22.12 及更高版本。"
    }
    $nodePath = $node.Path
    Write-Host "运行环境: 系统 Node.js" -ForegroundColor DarkGray
}

$nodeVersionText = (& $nodePath --version).TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"22.12.0") {
    Stop-WithMessage "Node.js 版本过低：$nodeVersionText；需要 22.12.0 或更高版本。"
}

if ($Action -eq "Install") {
    $asarPackage = Join-Path $ProjectRoot "node_modules\@electron\asar\package.json"
    $asarReady = $false
    if (Test-Path -LiteralPath $asarPackage) {
        try {
            $asarVersion = (Get-Content -Raw -LiteralPath $asarPackage -Encoding UTF8 | ConvertFrom-Json).version
            $asarReady = $asarVersion -eq "4.2.1"
        } catch {
            $asarReady = $false
        }
    }

    if (-not $asarReady) {
        if ($usingBundledNode) {
            Stop-WithMessage "便携发布包缺少锁定的 ASAR 依赖，请重新下载完整 ZIP。"
        }
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npm) {
            Stop-WithMessage "安装补丁需要 npm，但当前环境没有检测到 npm。"
        }

        Write-Host "首次安装：正在下载锁定版本的 ASAR 工具依赖..." -ForegroundColor Yellow
        Push-Location $ProjectRoot
        try {
            & $npm.Path ci --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                Stop-WithMessage "依赖安装失败，请检查网络后重试。"
            }
        } finally {
            Pop-Location
        }
    }
}

$cliAction = $Action.ToLowerInvariant()
& $nodePath (Join-Path $ProjectRoot "src\cli.mjs") $cliAction
exit $LASTEXITCODE
