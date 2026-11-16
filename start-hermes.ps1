param(
    [string]$HermesHome = (Join-Path $env:USERPROFILE 'AppData\Local\hermes')
)
$ErrorActionPreference = 'Stop'
$hermesInstall = Join-Path $HermesHome 'hermes-agent'
$hermesPython = Join-Path $hermesInstall 'venv\Scripts\python.exe'
$profilePath = Join-Path $PSScriptRoot 'runlogs\hermes-advice'
if (-not (Test-Path -LiteralPath $hermesPython)) { throw '找不到 Hermes 自带 Python，请通过 -HermesHome 指定安装目录。' }
$listener = Get-NetTCPConnection -State Listen -LocalPort 8643 -ErrorAction SilentlyContinue
if (-not $listener) {
    & $hermesPython "$PSScriptRoot\deployment\connect_hermes_local.py" --home $HermesHome --destination $profilePath
    if ($LASTEXITCODE -ne 0) { throw '独立问答配置准备失败' }
    $previousProfile = $env:HERMES_HOME
    try {
        $env:HERMES_HOME = $profilePath
        Start-Process -FilePath $hermesPython -ArgumentList @('-m','hermes_cli.main','gateway') -WorkingDirectory $hermesInstall -WindowStyle Hidden -RedirectStandardOutput "$profilePath\gateway.stdout.log" -RedirectStandardError "$profilePath\gateway.stderr.log"
    } finally { $env:HERMES_HOME = $previousProfile }
}
$keyPath = Join-Path $profilePath 'api-key.txt'
if (-not (Test-Path -LiteralPath $keyPath)) { throw '8643 被其他实例占用，不能确认此服务身份。' }
$headers = @{ Authorization = 'Bearer ' + (Get-Content -LiteralPath $keyPath -Raw).Trim() }
$ready = $false
for ($attempt=0; $attempt -lt 30; $attempt++) {
    try {
        $toolsets = Invoke-RestMethod -Uri 'http://127.0.0.1:8643/v1/toolsets' -Headers $headers -TimeoutSec 3
        if ($null -eq $toolsets.data) { throw '接口缺少工具状态' }
        $unexpected = @($toolsets.data | Where-Object { $_.enabled -ne $false })
        if ($unexpected.Count -gt 0) { throw '问答实例仍有工具启用，停止连接' }
        $ready=$true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw '独立问答接口未就绪或工具状态不合规，请查看 runlogs\hermes-advice 中的本机日志。' }
Write-Host 'Hermes 问答接口已就绪，工具均关闭。'
Write-Host '星图配置：XT_HERMES_URL=http://127.0.0.1:8643'
Write-Host "密钥文件位置：$keyPath（不要把文件内容发到聊天或提交 Git）"
