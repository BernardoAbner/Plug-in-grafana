import { PanelPlugin, FieldConfigProperty } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { TablePanel, currentActivePanelMode } from './components/TablePanel';

export const INDUSTRIAL_ICON_SELECT_OPTIONS = [
  {
    label: 'Redes Industriais & Telecom',
    options: [
      { label: 'Switch / Topologia', value: 'sitemap' },
      { label: 'Rádio Wireless', value: 'wifi' },
      { label: 'Sinal / RSSI', value: 'signal' },
      { label: 'Tráfego / Roteamento', value: 'exchange' },
      { label: 'Porta / Conector RJ45', value: 'plug' },
      { label: 'Link / Enlace Ativo', value: 'link' },
      { label: 'Trunk / Spanning Tree', value: 'code-branch' },
      { label: 'Interconexão / Distribuição', value: 'share-alt' },
      { label: 'Firewall / Borda', value: 'shield' },
      { label: 'Gateway / WAN', value: 'globe' },
      { label: 'Sincronismo / NTP', value: 'sync' },
      { label: 'Transmissão RF', value: 'rss' },
    ],
  },
  {
    label: 'Virtualização & Servidores',
    options: [
      { label: 'Host Físico / Bare-metal', value: 'server' },
      { label: 'Máquina Virtual (VM)', value: 'cube' },
      { label: 'Cluster / Múltiplos Nós', value: 'cubes' },
      { label: 'Storage / Pool de Recursos', value: 'layer-group' },
      { label: 'Banco de Dados', value: 'database' },
      { label: 'Disco / LUN SAN', value: 'hdd' },
      { label: 'Nuvem Privada / Cloud', value: 'cloud' },
      { label: 'Estação SCADA / IHM', value: 'desktop' },
      { label: 'Console / SSH / Terminal', value: 'terminal' },
    ],
  },
  {
    label: 'Telemetria, Elétrica & Sensores',
    options: [
      { label: 'Alimentação / Tensão AC', value: 'bolt' },
      { label: 'UPS / No-break Carregando', value: 'battery-bolt' },
      { label: 'Banco de Baterias Normal', value: 'battery-full' },
      { label: 'Bateria Crítica', value: 'battery-empty' },
      { label: 'Temperatura / Sensor Térmico', value: 'thermometer' },
      { label: 'Processador / CPU Load', value: 'tachometer-fast' },
      { label: 'Disponibilidade ICMP (Ping)', value: 'heartbeat' },
      { label: 'Parâmetro / Ajuste de Campo', value: 'sliders-v-alt' },
      { label: 'Série Temporal / Métrica', value: 'chart-line' },
      { label: 'Latência / Jitter / Uptime', value: 'clock-nine' },
      { label: 'Histórico / Retenção', value: 'history' },
    ],
  },
  {
    label: 'Operação, Alarmes & Segurança',
    options: [
      { label: 'Alerta / Atenção (Warning)', value: 'exclamation-triangle' },
      { label: 'Falha Crítica (Disaster)', value: 'times-circle' },
      { label: 'Operacional / Saudável', value: 'check-circle' },
      { label: 'Alarme Sonoro / Notificação', value: 'bell' },
      { label: 'Manutenção / Ferramenta', value: 'wrench' },
      { label: 'Serviço / Daemon Rodando', value: 'cog' },
      { label: 'Painel Trancado / Físico', value: 'lock' },
      { label: 'Autenticação / SNMP Key', value: 'key-skeleton-alt' },
      { label: 'Informativo', value: 'info-circle' },
      { label: 'Filtro / Regra de Bloqueio', value: 'filter' },
      { label: 'Supervisão Ativa', value: 'eye' },
      { label: 'Visão Geral / Todos', value: 'apps' },
    ],
  },
];

export function isHeatmapActive(context?: any): boolean {
  if (context?.options?.panelMode === 'heatmap' || context?.panelOptions?.panelMode === 'heatmap') {
    return true;
  }
  if (typeof window !== 'undefined' && (window as any).__VALE_PANEL_MODE__ === 'heatmap') {
    return true;
  }
  if (currentActivePanelMode === 'heatmap') {
    return true;
  }
  return false;
}

export const plugin = new PanelPlugin<SimpleOptions, CustomFieldConfig>(TablePanel)
  .setNoPadding()
  .useFieldConfig({
    standardOptions: {
      [FieldConfigProperty.DisplayName]: {},
      [FieldConfigProperty.Unit]: {},
      [FieldConfigProperty.Decimals]: {},
      [FieldConfigProperty.Thresholds]: {},
      [FieldConfigProperty.Mappings]: {},
    },
    useCustomConfig: (builder) => {
      const isTableActive = (_c: CustomFieldConfig, context?: any) => !isHeatmapActive(context);

      builder
        // ── 1. Seletor Principal e Opções Gerais de Célula ──
        .addSelect({
          path: 'cellDisplayMode',
          name: 'Modo de Exibição da Célula',
          description: 'Selecione como os dados desta coluna/métrica serão renderizados.',
          defaultValue: 'text',
          category: ['Exibição da Célula'],
          settings: {
            options: [
                            { value: 'text', label: 'Texto / Valor Numérico' },
              { value: 'badge', label: 'Badge / Pílula de Status' },
              { value: 'progressBar', label: 'Barra de Progresso Contínua' },
              { value: 'segmentedBar', label: 'VU Industrial (10 Barras)' },
              { value: 'deltaTrend', label: 'Tendência Delta (vs Média)' },
              { value: 'sparkline', label: 'Time Series / Sparkline' },
            ],
          },
          showIf: isTableActive,
        })
        .addBooleanSwitch({
          path: 'enableColumnFilter',
          name: 'Habilitar Filtro nesta Coluna',
          description: 'Exibe ícone de filtro no cabeçalho desta coluna para busca e filtragem instantânea.',
          defaultValue: false,
          category: ['Exibição da Célula'],
          showIf: isTableActive,
        })
        .addBooleanSwitch({
          path: 'useThresholdColors',
          name: 'Personalizar Cores pelo Threshold',
          description: 'Aplica cores de threshold no texto e elementos visuais da célula.',
          defaultValue: false,
          category: ['Exibição da Célula'],
          showIf: isTableActive,
        })
        .addBooleanSwitch({
          path: 'enableAlertPopup',
          name: 'Habilitar Botão / Pop-up de Alerta (!)',
          description: 'Exibe o botão interativo de alerta com histórico de episódios ao lado do nome do host / valor quando houver violação.',
          defaultValue: true,
          category: ['Alerta e Pop-up (!)'],
        })

        // ── 2. Propriedades Condicionais: Gráfico (Time Series / Sparkline) ──
        .addSelect({
          path: 'timeSeriesValueMode',
          name: 'Exibição do Valor no Gráfico',
          description: 'Define como o valor atual será exibido: Texto, Badge ou Oculto.',
          defaultValue: 'text',
          category: ['Gráfico (Time Series)'],
          settings: {
            options: [
              { value: 'text', label: 'Texto / Valor Numérico' },
              { value: 'badge', label: 'Badge / Pílula de Status' },
              { value: 'hidden', label: 'Ocultar Valor' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'sparkline',
        })
        .addNumberInput({
          path: 'lineWidth',
          name: 'Espessura da Linha (px)',
          defaultValue: 1.5,
          category: ['Gráfico (Time Series)'],
          settings: { min: 1, max: 6, step: 0.5 },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'sparkline',
        })
        .addNumberInput({
          path: 'areaOpacity',
          name: 'Preenchimento / Opacidade da Área (%)',
          description: '0 = transparente, 100 = opaco.',
          defaultValue: 25,
          category: ['Gráfico (Time Series)'],
          settings: { min: 0, max: 100, step: 5 },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'sparkline',
        })
        .addColorPicker({
          path: 'lineColor',
          name: 'Cor da Linha do Gráfico',
          description: 'Cor padrão da linha quando não sobreposta por threshold.',
          defaultValue: '#00B59B',
          category: ['Gráfico (Time Series)'],
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'sparkline',
        })
        .addSelect({
          path: 'lineInterpolation',
          name: 'Traçado da Linha',
          defaultValue: 'smooth',
          category: ['Gráfico (Time Series)'],
          settings: {
            options: [
              { value: 'smooth', label: 'Suave / Arredondado' },
              { value: 'straight', label: 'Reto' },
              { value: 'stepBefore', label: 'Degraus (Antes)' },
              { value: 'stepAfter', label: 'Degraus (Depois)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'sparkline',
        })

        // ── 3. Propriedades Condicionais: Barras de Progresso e VU Industrial ──
        .addNumberInput({
          path: 'progressMin',
          name: 'Mínimo da Escala',
          description: 'Valor mínimo da escala para cálculo da porcentagem ou barras acesas (padrão: 0).',
          defaultValue: 0,
          category: ['Barras e VU'],
          showIf: (c, ctx) => isTableActive(c, ctx) && (c?.cellDisplayMode === 'progressBar' || c?.cellDisplayMode === 'segmentedBar'),
        })
        .addNumberInput({
          path: 'progressMax',
          name: 'Máximo da Escala',
          description: 'Valor máximo da escala para cálculo da porcentagem ou barras acesas (padrão: 100).',
          defaultValue: 100,
          category: ['Barras e VU'],
          showIf: (c, ctx) => isTableActive(c, ctx) && (c?.cellDisplayMode === 'progressBar' || c?.cellDisplayMode === 'segmentedBar'),
        })
        .addSelect({
          path: 'progressHeight',
          name: 'Altura da Barra de Progresso',
          description: 'Espessura da barra contínua de progresso.',
          defaultValue: '6px',
          category: ['Barras e VU'],
          settings: {
            options: [
              { value: '6px', label: 'Fina (6px)' },
              { value: '8px', label: 'Média (8px)' },
              { value: '12px', label: 'Alta (12px)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'progressBar',
        })
        .addBooleanSwitch({
          path: 'showProgressValue',
          name: 'Exibir Valor Numérico',
          description: 'Mostra o valor formatado ao lado da barra ou VU.',
          defaultValue: true,
          category: ['Barras e VU'],
          showIf: (c, ctx) => isTableActive(c, ctx) && (c?.cellDisplayMode === 'progressBar' || c?.cellDisplayMode === 'segmentedBar'),
        })

        // ── 4. Propriedades Condicionais: Badge / Status ──
        .addSelect({
          path: 'badgeSize',
          name: 'Tamanho do Badge',
          description: 'Dimensão do badge na célula.',
          defaultValue: 'sm',
          category: ['Badge / Status'],
          settings: {
            options: [
              { value: 'sm', label: 'Pequeno (sm)' },
              { value: 'md', label: 'Médio (md)' },
              { value: 'lg', label: 'Grande (lg)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'badge',
        })
        .addSelect({
          path: 'badgeStyle',
          name: 'Estilo Visual do Badge',
          description: 'Aparência do preenchimento e bordas do badge.',
          defaultValue: 'subtle',
          category: ['Badge / Status'],
          settings: {
            options: [
              { value: 'subtle', label: 'Sutil (Fundo translúcido)' },
              { value: 'solid', label: 'Sólido (Fundo preenchido)' },
              { value: 'outline', label: 'Contorno (Apenas borda)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'badge',
        })

        // ── 5. Propriedades Condicionais: Texto e Tipografia ──
        .addSelect({
          path: 'textFontSize',
          name: 'Tamanho da Fonte',
          defaultValue: '11.5px',
          category: ['Texto'],
          settings: {
            options: [
              { value: '10px', label: 'Pequeno (10px)' },
              { value: '11.5px', label: 'Padrão (11.5px)' },
              { value: '13px', label: 'Médio (13px)' },
              { value: '15px', label: 'Grande (15px)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'text',
        })
        .addSelect({
          path: 'textWeight',
          name: 'Peso da Fonte',
          defaultValue: '500',
          category: ['Texto'],
          settings: {
            options: [
              { value: '400', label: 'Normal (400)' },
              { value: '500', label: 'Médio (500)' },
              { value: '600', label: 'Semi-Negrito (600)' },
              { value: '700', label: 'Negrito (700)' },
            ],
          },
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'text',
        })

        // ── 6. Propriedades Condicionais: Tendência Delta ──
        .addBooleanSwitch({
          path: 'showDeltaValue',
          name: 'Exibir Valor do Delta (Diferença)',
          description: 'Mostra a diferença absoluta formatada em relação à média do período.',
          defaultValue: true,
          category: ['Tendência Delta'],
          showIf: (c, ctx) => isTableActive(c, ctx) && c?.cellDisplayMode === 'deltaTrend',
        })

        // ── 7. Overrides de Cabeçalho da Coluna ──
        .addTextInput({
          path: 'label',
          name: 'Rótulo Customizado',
          description: 'Substitui o nome da query se preenchido',
          defaultValue: '',
          category: ['Cabeçalho'],
          showIf: isTableActive,
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone da Métrica / Coluna',
          description: 'Selecione o ícone para o cabeçalho desta coluna',
          defaultValue: '',
          category: ['Cabeçalho'],
          settings: {
            options: INDUSTRIAL_ICON_SELECT_OPTIONS,
          },
          showIf: isTableActive,
        });
    },
  })
  .setPanelOptions((builder) => {
    return builder
      // ═══════════════════════════════════════════════════════════════════════
      // 1. Categoria "Modo do Painel"
      // ═══════════════════════════════════════════════════════════════════════
      .addRadio({
        path: 'panelMode',
        name: 'Modo do Painel',
        description: 'Alterna entre a Tabela Dinâmica Multi-Colunas e o Mapa de Calor Temporal independente (ISA-101).',
        defaultValue: 'table',
        category: ['Modo do Painel'],
        settings: {
          options: [
            { value: 'table', label: 'Tabela Dinâmica' },
            { value: 'heatmap', label: 'Mapa de Calor (ISA-101)' },
          ],
        },
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 2. Categoria "Cabeçalho"
      // ═══════════════════════════════════════════════════════════════════════
      .addBooleanSwitch({
        path: 'showHeatmapHeader',
        name: 'Exibir Rótulo Superior',
        description: 'Exibe ou oculta o rótulo superior do Mapa de Calor.',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addTextInput({
        path: 'heatmapCustomLabel',
        name: 'Rótulo do Cabeçalho (Heatmap)',
        description: 'Texto customizado para o rótulo superior do Mapa de Calor. Deixe em branco para usar o nome da métrica.',
        defaultValue: '',
        category: ['Cabeçalho'],
        settings: {
          placeholder: 'Nome da Métrica (Padrão)',
        },
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addTextInput({
        path: 'heatmapCustomSubtitle',
        name: 'Subtexto do Cabeçalho (Heatmap)',
        description: 'Texto secundário opcional exibido abaixo do rótulo do Mapa de Calor.',
        defaultValue: '',
        category: ['Cabeçalho'],
        settings: {
          placeholder: 'Subtexto opcional...',
        },
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addBooleanSwitch({
        path: 'showHeader',
        name: 'Exibir Cabeçalho da Tabela',
        description: 'Exibe ou oculta a linha de cabeçalho com os nomes das colunas.',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addTextInput({
        path: 'singleHostCustomLabel',
        name: 'Rótulo do Host Único',
        description: 'Texto do título no topo da visualização de host único. Deixe em branco para usar o nome do host por padrão.',
        defaultValue: '',
        category: ['Cabeçalho'],
        settings: {
          placeholder: 'Nome do Host (Padrão)',
        },
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addTextInput({
        path: 'singleHostCustomStatusText',
        name: 'Subtexto do Host Único',
        description: 'Subtexto exibido abaixo do título do host único. Deixe em branco para usar o status automático (Operacional / Em Alerta).',
        defaultValue: '',
        category: ['Cabeçalho'],
        settings: {
          placeholder: 'Operacional / Em Alerta (Padrão)',
        },
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Categoria "Layout e Estilo" (showIf: c => c.panelMode === 'table')
      // ═══════════════════════════════════════════════════════════════════════
      .addNumberInput({
        path: 'rowHeight',
        name: 'Altura da Linha (px)',
        description: 'Altura em pixels de cada linha da tabela (padrão: 34px).',
        defaultValue: 34,
        category: ['Layout e Estilo'],
        settings: { min: 24, max: 80, step: 2 },
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addBooleanSwitch({
        path: 'enableZebra',
        name: 'Zebrado Corporativo',
        description: 'Aplica gradiente sutil micro-luminoso nas linhas pares para facilitar a leitura.',
        defaultValue: true,
        category: ['Layout e Estilo'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addBooleanSwitch({
        path: 'showWindowDiagnosisColumn',
        name: 'Coluna de Diagnóstico na Janela',
        description: 'Exibe o tempo no estado atual e resumo de oscilações calculados sobre a janela de tempo.',
        defaultValue: true,
        category: ['Layout e Estilo'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Categoria "Coluna de Host e Ícones"
      // ═══════════════════════════════════════════════════════════════════════
      .addBooleanSwitch({
        path: 'showHostIcon',
        name: 'Mostrar Ícone do Host',
        description: 'Exibe o ícone do ativo na primeira coluna da tabela.',
        defaultValue: true,
        category: ['Coluna de Host e Ícones'],
      })
      .addSelect({
        path: 'hostIconName',
        name: 'Ícone Padrão do Host',
        description: 'Ícone padrão do host na primeira coluna.',
        defaultValue: 'server',
        category: ['Coluna de Host e Ícones'],
        settings: {
          options: INDUSTRIAL_ICON_SELECT_OPTIONS,
        },
        showIf: (c) => c.showHostIcon !== false,
      })
      .addRadio({
        path: 'hostIconBgMode',
        name: 'Estilo do Ícone do Host',
        description: 'Formato visual do ícone: com fundo industrial vitrificado (contained) ou livre (clean).',
        defaultValue: 'contained',
        category: ['Coluna de Host e Ícones'],
        settings: {
          options: [
            { value: 'contained', label: 'Com Fundo Vitrificado (Contained)' },
            { value: 'clean', label: 'Livre (Clean)' },
          ],
        },
        showIf: (c) => c.showHostIcon !== false,
      })
      .addBooleanSwitch({
        path: 'enableHostFilter',
        name: 'Habilitar Filtro no Host',
        description: 'Exibe ícone de filtro no cabeçalho do Host para busca instantânea.',
        defaultValue: false,
        category: ['Coluna de Host e Ícones'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' && c.showHostIcon !== false,
      })
      .addBooleanSwitch({
        path: 'colorHostIconByThreshold',
        name: 'Colorir Ícone pelo Threshold',
        description: 'Quando ativado, o ícone do host assume a cor do threshold ou alerta ativo. Desativado, mantém a cor padrão neutra (cinza/branco).',
        defaultValue: false,
        category: ['Coluna de Host e Ícones'],
        showIf: (c) => c.showHostIcon !== false,
      })

      // ═══════════════════════════════════════════════════════════════════════
      // Categoria "Visualização de Host Único" (showIf: c => c.panelMode === 'table')
      // ═══════════════════════════════════════════════════════════════════════
      .addSelect({
        path: 'singleHostLayout',
        name: 'Modo de Ativação',
        description: 'Define quando ativar a visualização em lista chave-valor para host único.',
        defaultValue: 'auto',
        category: ['Visualização de Host Único'],
        settings: {
          options: [
            { value: 'auto', label: 'Automático (Ativa se houver 1 Host)' },
            { value: 'keyvalue', label: 'Sempre Ativo (Forçar Host Único)' },
            { value: 'table', label: 'Desativado (Manter Sempre Tabela)' },
          ],
        },
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 4. Categoria "Mapa de Calor" (showIf: c => c.panelMode === 'heatmap')
      // ═══════════════════════════════════════════════════════════════════════
      .addNumberInput({
        path: 'heatmapBuckets',
        name: 'Quantidade de Blocos (N)',
        description: 'Número de subdivisões temporais do Mapa de Calor (padrão: 40).',
        defaultValue: 40,
        category: ['Mapa de Calor'],
        settings: { min: 10, max: 120, step: 5 },
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addColorPicker({
        path: 'heatmapBaseColor',
        name: 'Cor Base Saudável',
        description: 'Cor base para a escala progressiva de 5 tons normais do Mapa de Calor (padrão: Verde Esmeralda #10b981).',
        defaultValue: '#10b981',
        category: ['Mapa de Calor'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addBooleanSwitch({
        path: 'showHeatmapLegend',
        name: 'Mostrar Legenda Lateral',
        description: 'Exibe a coluna lateral direita (~155px) com as legendas explicativas (Normal, Alerta e Lacuna).',
        defaultValue: true,
        category: ['Mapa de Calor'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addBooleanSwitch({
        path: 'heatmapUseThresholds',
        name: 'Colorir Violações por Threshold',
        description: 'Aplica cores do threshold configurado nos blocos que ultrapassarem os limites.',
        defaultValue: true,
        category: ['Mapa de Calor'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addNumberInput({
        path: 'heatmapHostWidth',
        name: 'Largura da Coluna de Host (px)',
        description: 'Largura da coluna de hosts no Mapa de Calor (padrão: 180px). Também pode ser redimensionada arrastando a barra divisória.',
        defaultValue: 180,
        category: ['Mapa de Calor'],
        settings: { min: 80, max: 400, step: 10 },
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addBooleanSwitch({
        path: 'enableAlertPopup',
        name: 'Habilitar Botão / Pop-up de Alerta (!)',
        description: 'Exibe o botão interativo de alerta (!) com histórico de episódios ao lado do nome do host no mapa de calor quando houver violação.',
        defaultValue: true,
        category: ['Mapa de Calor'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addSelect({
        path: 'disconnectThreshold',
        name: 'Limite de Desconexão / Lacuna no Pop-up',
        description: 'Tempo de inatividade sem dados antes de interromper episódios no histórico do pop-up.',
        defaultValue: 'auto',
        category: ['Mapa de Calor'],
        settings: {
          options: [
            { value: 'auto', label: 'Automático (3x intervalo da série)' },
            { value: '1m', label: '1 minuto' },
            { value: '2m', label: '2 minutos' },
            { value: '5m', label: '5 minutos' },
            { value: '15m', label: '15 minutos' },
            { value: '30m', label: '30 minutos' },
            { value: '1h', label: '1 hora' },
            { value: 'never', label: 'Nunca desconectar' },
          ],
        },
        showIf: (c) => c.panelMode === 'heatmap',
      });
  });
