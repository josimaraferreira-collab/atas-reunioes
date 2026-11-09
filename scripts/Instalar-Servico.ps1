<#
  Solven Atas — instala o serviço Windows "SolvenAtasNode" no servidor SOLTOTVS.
  Executar no PowerShell COMO ADMINISTRADOR:
    & 'C:\inetpub\wwwroot\solven-atas\scripts\Instalar-Servico.ps1'
#>
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$exe = Join-Path $raiz 'service\SolvenAtasNode.exe'
$xml = Join-Path $raiz 'service\SolvenAtasNode.xml'
$arqEnv = Join-Path $raiz '.env.producao'
$saude = 'http://127.0.0.1:3001/solven-atas/health'
$hashWinSW = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

$adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $adm) { throw 'Abra o PowerShell com "Executar como administrador".' }
foreach ($f in @($node, $exe, $xml, $arqEnv, (Join-Path $raiz 'server\index.js'))) { if (-not (Test-Path -LiteralPath $f)) { throw "Arquivo não encontrado: $f" } }
if (-not (Test-Path -LiteralPath (Join-Path $raiz 'node_modules'))) { throw 'Rode antes: npm install --omit=dev (na pasta do aplicativo).' }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $hashWinSW) { throw 'O executável WinSW difere do pacote verificado.' }
if (Get-Service -Name 'SolvenAtasNode' -ErrorAction SilentlyContinue) { throw 'O serviço SolvenAtasNode já existe. Para atualizar, use: Restart-Service SolvenAtasNode' }
$porta = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($porta) { throw 'A porta 3001 já está em uso por outro programa. Ajuste PORT no .env.producao e a regra do web.config.' }

# pastas de trabalho e permissões mínimas para a conta LOCAL SERVICE (S-1-5-19)
foreach ($p in @('data', 'data\tmp', 'data\navegador', 'logs', 'logs\winsw')) { New-Item -ItemType Directory -Force -Path (Join-Path $raiz $p) | Out-Null }
& icacls.exe $raiz /grant:r '*S-1-5-19:(OI)(CI)RX' | Out-Null
& icacls.exe $arqEnv /grant:r '*S-1-5-19:R' | Out-Null
& icacls.exe (Join-Path $raiz 'data') /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null
& icacls.exe (Join-Path $raiz 'logs') /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null

& $exe install $xml
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o serviço.' }
Start-Service -Name 'SolvenAtasNode'

$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $ok = [bool](Invoke-RestMethod -Uri $saude -TimeoutSec 2).ok } catch { $ok = $false }
}
if (-not $ok) {
  Write-Host 'O serviço foi instalado, mas não respondeu. Veja os logs em:' (Join-Path $raiz 'logs\winsw') -ForegroundColor Yellow
  exit 1
}
Write-Host 'SUCESSO: Solven Atas rodando como serviço Windows (SolvenAtasNode).' -ForegroundColor Green
Write-Host "Teste no navegador: https://portal.solven.com.br:4443/solven-atas/"
