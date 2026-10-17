# Diretrizes Compartilhadas de Deploy e Servidor Grafana (VM Debian)

Este workspace agrupa os plugins de Grafana da Vale.
Sempre que for solicitado deploy ou gerenciamento de plugins na VM de teste/homologação, siga as instruções abaixo:

## 1. Conexão SSH & Deploy Automático (`deploy.ps1`)
- **Host padrão da VM**: `192.168.86.136`
- **Usuário padrão**: `bernardo`
- **Autenticação**: Baseada em chave SSH (`~/.ssh/id_ed25519`). Não deve solicitar senha de SSH nem de sudo.
- **Comando de deploy** (usar `-ExecutionPolicy Bypass` no Windows):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -VmUser bernardo -VmHost 192.168.86.136
  ```
- **Regra de Execução**: Após todas as mudanças no código do plugin, rodar o `deploy.ps1` para sincronizar e atualizar o ambiente de teste na VM.

### Etapas executadas pelo script de deploy:
1. **Cache-Busting**: Atualiza a versão do plugin no `package.json` (`1.0.<timestamp>`).
2. **Limpeza**: Remove a pasta `node_modules\.cache` para evitar builds com artefatos obsoletos do Webpack.
3. **Build**: Executa `npm run build` gerando os artefatos em `dist/`.
4. **Envio via SCP**: Cria pasta temporária `/tmp/<plugin-id>` na VM e copia o conteúdo de `dist/`.
5. **Instalação e Reinício**: Move os arquivos para `/var/lib/grafana/plugins/<plugin-id>`, ajusta permissões (`chown -R grafana:grafana`) e reinicia o serviço via `sudo systemctl restart grafana-server`.
6. **Pós-deploy**: O usuário deve realizar um Hard Refresh (`Ctrl + Shift + R`) no navegador para carregar o novo bundle.

## 2. Habilitação e Instalação de Plugins no Servidor Grafana
Quando uma demanda exigir instalar ou habilitar plugins adicionais no servidor:
- **Listar plugins instalados**:
  ```powershell
  ssh bernardo@192.168.86.136 "grafana-cli plugins ls"
  ```
- **Instalar plugin oficial**:
  ```powershell
  ssh bernardo@192.168.86.136 "sudo grafana-cli plugins install <plugin-id> && sudo systemctl restart grafana-server"
  ```
- **Habilitar plugins não-assinados (`allow_loading_unsigned_plugins`)**:
  Se um plugin customizado não carregar por assinatura, configurar em `/etc/grafana/grafana.ini`:
  ```ini
  [plugins]
  allow_loading_unsigned_plugins = vale-valestatcard-panel,vale-dynamic-cards,<novo-plugin-id>
  ```
  E reiniciar o serviço:
  ```powershell
  ssh bernardo@192.168.86.136 "sudo systemctl restart grafana-server"
  ```

## 3. Checklist Obrigatório para Criar / Duplicar um Plugin
Ao duplicar um plugin existente (ex: `vale-stat-card-source`) para criar um novo:

1. **Alterar Identificador no `src/plugin.json`**:
   - `id`: Deve ser único no Grafana (ex: `"vale-novo-card-panel"`). Não pode haver dois plugins com o mesmo ID.
   - `name`: Nome exibido no catálogo de painéis do Grafana.
2. **Alterar Nome no `package.json`**:
   - `"name"`: Atualizar para o nome do novo projeto.
3. **Atualizar `deploy.ps1` do novo projeto**:
   - Ajustar a variável `$PluginId = "<novo-plugin-id>"` para corresponder exatamente ao `id` em `src/plugin.json`.
4. **Liberar o novo plugin no Grafana (`/etc/grafana/grafana.ini`)**:
   - Adicionar o novo ID em `allow_loading_unsigned_plugins` separado por vírgula.
5. **Limpar pastas antigas/conflitantes na VM**:
   - Se houver diretórios com versões antigas ou renomeadas em `/var/lib/grafana/plugins/`, remova-os para evitar que o Grafana acuse colisão de IDs ou carregue artefatos legados.
6. **Deploy**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -VmUser bernardo -VmHost 192.168.86.136
   ```
7. **Verificação de Logs no Servidor (se o plugin não aparecer)**:
   ```powershell
   ssh bernardo@192.168.86.136 "journalctl -u grafana-server -n 50 --no-pager"
   ```
