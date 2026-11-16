param([switch]$WithAssistant)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$previewDir = Join-Path $PSScriptRoot 'runlogs\project-preview'
$javaPath = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'D:\Java\Java-install\bin\java.exe' }
if (-not (Test-Path -LiteralPath $javaPath)) { $javaPath = (Get-Command java -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath "$PSScriptRoot\dist\xingtu-server.jar")) { throw '请先在源码目录运行 node build.mjs。' }
if (Get-NetTCPConnection -State Listen -LocalPort 22649 -ErrorAction SilentlyContinue) { throw '22649 已被占用，请先确认是否已经启动本机预览。' }
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
if (-not (Test-Path -LiteralPath "$previewDir\service.env")) {
    & $javaPath -jar "$PSScriptRoot\dist\xingtu-server.jar" --init-config $previewDir
    if ($LASTEXITCODE -ne 0) { throw '预览登录配置初始化失败' }
}
foreach ($line in Get-Content -LiteralPath "$previewDir\service.env" -Encoding UTF8) {
    if ($line -match '^(XT_[A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
$env:XT_BIND = '127.0.0.1'
$env:XT_PORT = '22649'
$env:XT_DATA_DIR = Join-Path $previewDir 'data'
$env:XT_CONTRACT_DIR = Join-Path $PSScriptRoot 'deployment'
$env:XT_CONTRACT_PYTHON = (Get-Command python -ErrorAction Stop).Source
$dependencies = Join-Path (Split-Path $PSScriptRoot -Parent) '.codex-work\deployment-contract-py'
if (Test-Path -LiteralPath $dependencies) { $env:PYTHONPATH = $dependencies }
$env:XT_HERMES_ENABLED = 'false'
if ($WithAssistant) {
    & "$PSScriptRoot\start-hermes.ps1"
    $env:XT_HERMES_ENABLED = 'true'
    $env:XT_HERMES_URL = 'http://127.0.0.1:8643'
    $env:XT_HERMES_KEY_FILE = Join-Path $PSScriptRoot 'runlogs\hermes-advice\api-key.txt'
    $env:XT_HERMES_CONSENT_UNTIL = [DateTime]::UtcNow.AddHours(8).ToString('yyyy-MM-ddTHH:mm:ssZ')
}
$previewProcess = Start-Process -FilePath $javaPath -ArgumentList @(
    "-Djdk.net.unixdomain.tmpdir=$PSScriptRoot",'-Dfile.encoding=UTF-8','-jar',"$PSScriptRoot\dist\xingtu-server.jar"
) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput "$previewDir\server.stdout.log" -RedirectStandardError "$previewDir\server.stderr.log"
$previewProcess.Id | Set-Content -LiteralPath "$previewDir\server.pid"
for ($attempt=0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:22649/healthz' -TimeoutSec 2
        if ($health.ok) {
            Write-Host "本机预览已就绪：http://127.0.0.1:22649/deployment （V$($health.version)）"
            Write-Host "登录密钥在 $previewDir\service.env 的 XT_ACCESS_TOKEN 行。"
            return
        }
    } catch {}
    if ($previewProcess.HasExited) { throw 'Java 服务启动失败，请查看 runlogs\project-preview\server.stderr.log。' }
    Start-Sleep -Seconds 1
}
throw '预览未就绪，请检查本机服务日志。'
