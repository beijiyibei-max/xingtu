$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Set-Location -LiteralPath $PSScriptRoot
$javaExecutable = (Get-Command java -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath 'service.env')) {
    & $javaExecutable -jar xingtu-server.jar --init-config $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { throw '创建本地配置失败' }
}
foreach ($line in Get-Content -LiteralPath 'service.env' -Encoding UTF8) {
    if ($line -match '^(XT_[A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
if (-not $env:XT_DATA_DIR) { $env:XT_DATA_DIR = Join-Path $PSScriptRoot 'data' }
$displayPort = if ($env:XT_PORT) { $env:XT_PORT } else { '22648' }
Write-Host "浏览器地址：http://127.0.0.1:$displayPort/"
Write-Host '访问密钥请查看本目录 service.env 中的 XT_ACCESS_TOKEN。保持此窗口运行。'
& $javaExecutable "-Djdk.net.unixdomain.tmpdir=$PSScriptRoot" '-Dfile.encoding=UTF-8' -jar xingtu-server.jar
if ($LASTEXITCODE -ne 0) { throw '星图启动失败，请检查 Java 版本和配置' }
