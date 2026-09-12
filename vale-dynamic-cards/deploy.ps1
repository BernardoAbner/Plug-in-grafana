# deploy.ps1
# Builda o plugin e envia automaticamente para o Grafana rodando na VM Debian.
# Uso:
#   .\deploy.ps1 -VmUser bernardo -VmHost 192.168.86.136
#
# Rode esse script de dentro da pasta do projeto (vale-valestatcard-panel).

param(
    [string]$VmUser = "bernardo",
    [string]$VmHost = "192.168.86.136"
)

$PluginId = "vale-valestatcard-panel"
$RemoteTmp = "/tmp/$PluginId"
$RemoteDest = "/var/lib/grafana/plugins/$PluginId"

Write-Host "==> Atualizando versão do plugin (cache-busting no navegador)..." -ForegroundColor Cyan
$buildNumber = [int][double]::Parse((Get-Date -UFormat %s))
npm pkg set version="1.0.$buildNumber" | Out-Null
Write-Host "    Nova versão: 1.0.$buildNumber" -ForegroundColor DarkGray

Write-Host "==> Limpando cache do webpack (evita builds desatualizados)..." -ForegroundColor Cyan
Remove-Item -Recurse -Force node_modules\.cache -ErrorAction SilentlyContinue

Write-Host "==> Buildando o plugin..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build falhou. Corrija os erros acima antes de continuar." -ForegroundColor Red
    exit 1
}

Write-Host "==> Criando pasta temporária na VM..." -ForegroundColor Cyan
ssh "$VmUser@$VmHost" "rm -rf $RemoteTmp && mkdir -p $RemoteTmp"

Write-Host "==> Copiando arquivos buildados (dist/) para a VM..." -ForegroundColor Cyan
scp -r dist/* "${VmUser}@${VmHost}:${RemoteTmp}/"

Write-Host "==> Instalando no diretório de plugins do Grafana e reiniciando o serviço..." -ForegroundColor Cyan
# -t força alocação de terminal, necessário para o sudo pedir senha se for o caso
ssh -t "$VmUser@$VmHost" "sudo rm -rf $RemoteDest && sudo mv $RemoteTmp $RemoteDest && sudo chown -R grafana:grafana $RemoteDest && sudo systemctl restart grafana-server"

Write-Host ""
Write-Host "==> Deploy concluído!" -ForegroundColor Green
Write-Host "    Volte no navegador e dê um hard refresh (Ctrl+Shift+R) na página do Grafana," -ForegroundColor Green
Write-Host "    pois o navegador costuma cachear o JS antigo do plugin." -ForegroundColor Green