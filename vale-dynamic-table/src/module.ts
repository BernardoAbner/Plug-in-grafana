import { PanelPlugin, FieldConfigProperty, identityOverrideProcessor } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { TablePanel, currentActivePanelMode } from './components/TablePanel';
import {
  TimeSeriesOverrideEditor,
  BadgeOverrideEditor,
  ProgressOverrideEditor,
  TextOverrideEditor,
  DeltaOverrideEditor,
  AlertOverrideEditor,
} from './components/OverrideEditors';

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

export function isSingleHostActive(context?: any): boolean {
  if (context?.options?.panelMode === 'singleHost' || context?.panelOptions?.panelMode === 'singleHost') {
    return true;
  }
  if (typeof window !== 'undefined' && (window as any).__VALE_PANEL_MODE__ === 'singleHost') {
    return true;
  }
  if (currentActivePanelMode === 'singleHost') {
    return true;
  }
  return false;
}

export function isTableDynamicActive(context?: any): boolean {
  return !isHeatmapActive(context) && !isSingleHostActive(context);
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
      const isDynamicTableOnly = (_c: CustomFieldConfig, context?: any) => isTableDynamicActive(context);

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
          showIf: isDynamicTableOnly,
        })

        // ── 2. Abas Completas por Tipo de Visualização de Célula [Apenas em Override Properties] ──
        .addCustomEditor({
          id: 'timeSeriesConfig',
          path: 'timeSeriesConfig',
          name: 'Aba Completa: Gráfico (Time Series)',
          description: 'Traz todas as opções do gráfico (linha, área, altura, cores e thresholds) reunidas em uma única aba.',
          editor: TimeSeriesOverrideEditor,
          override: TimeSeriesOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Gráfico (Time Series)'],
          showIf: isTableActive,
        })
        .addCustomEditor({
          id: 'badgeConfig',
          path: 'badgeConfig',
          name: 'Aba Completa: Badge / Status',
          description: 'Traz todas as opções de Badge (tamanho, estilo visual e cores de threshold) reunidas em uma única aba.',
          editor: BadgeOverrideEditor,
          override: BadgeOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Badge / Status'],
          showIf: isTableActive,
        })
        .addCustomEditor({
          id: 'progressConfig',
          path: 'progressConfig',
          name: 'Aba Completa: Barras e VU Industrial',
          description: 'Traz todas as opções de Barra de Progresso e VU Industrial (escala, altura, cor e valor) reunidas em uma única aba.',
          editor: ProgressOverrideEditor,
          override: ProgressOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Barras e VU'],
          showIf: isTableActive,
        })
        .addCustomEditor({
          id: 'textConfig',
          path: 'textConfig',
          name: 'Aba Completa: Texto e Tipografia',
          description: 'Traz todas as opções de Texto (tamanho da fonte, peso e cor por threshold) reunidas em uma única aba.',
          editor: TextOverrideEditor,
          override: TextOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Texto'],
          showIf: isTableActive,
        })
        .addCustomEditor({
          id: 'deltaConfig',
          path: 'deltaConfig',
          name: 'Aba Completa: Tendência Delta',
          description: 'Traz todas as opções de Tendência Delta (exibição da diferença e modo de cor) reunidas em uma única aba.',
          editor: DeltaOverrideEditor,
          override: DeltaOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Tendência Delta'],
          showIf: isTableActive,
        })

        // ── 3. Propriedades de Field Override para Calibração de Tendência / Delta ──
        .addRadio({
          path: 'deltaComparisonDirection',
          name: 'Direção Crítica do Alarme',
          description: 'Define qual sentido da variação representa agravamento e aproximação de risco operacional.',
          defaultValue: 'gte',
          category: ['Tendência Delta'],
          settings: {
            options: [
              { value: 'gte', label: 'Quanto Maior, Pior (>=)' },
              { value: 'lte', label: 'Quanto Menor, Pior (<=)' },
            ],
          },
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })
        .addSelect({
          path: 'deltaReferenceMode',
          name: 'Cálculo de Referência (Base)',
          description: 'Define a leitura base para medir a taxa de variação (delta).',
          defaultValue: 'mean',
          category: ['Tendência Delta'],
          settings: {
            options: [
              { value: 'mean', label: 'Média da Janela' },
              { value: 'first', label: 'Primeiro Valor' },
              { value: 'prev', label: 'Leitura Anterior' },
            ],
          },
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })
        .addSelect({
          path: 'deltaValueFormat',
          name: 'Formato do Valor da Tendência',
          description: 'Escolha se a variação é exibida em percentual, valor absoluto ou ambos.',
          defaultValue: 'percent',
          category: ['Tendência Delta'],
          settings: {
            options: [
              { value: 'percent', label: 'Percentual (%)' },
              { value: 'absolute', label: 'Absoluto' },
              { value: 'both', label: 'Ambos' },
            ],
          },
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })
        .addSliderInput({
          path: 'deltaProximityPct',
          name: 'Zona de Proximidade (%)',
          description: 'Margem percentual antes do limiar onde o alerta preventivo é acionado.',
          defaultValue: 20,
          category: ['Tendência Delta'],
          settings: {
            min: 5,
            max: 50,
            step: 1,
          },
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })
        .addSliderInput({
          path: 'deltaDeadbandPct',
          name: 'Zona Morta (%)',
          description: 'Variações percentuais abaixo deste limite são tratadas como estáveis (●).',
          defaultValue: 1,
          category: ['Tendência Delta'],
          settings: {
            min: 0,
            max: 10,
            step: 0.5,
          },
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })
        .addBooleanSwitch({
          path: 'deltaHighlightRelief',
          name: 'Pintar Badge de Verde ao Recuar',
          description: 'Sinaliza em verde suave quando a métrica recua ou se afasta do limiar de perigo.',
          defaultValue: true,
          category: ['Tendência Delta'],
          showIf: (cfg) => cfg.cellDisplayMode === 'deltaTrend',
        })

        // ── 3. Overrides de Rótulo da Coluna / Métrica (Exclusivo em Overrides) ──
        .addTextInput({
          path: 'label',
          name: 'Rótulo Customizado',
          description: 'Substitui o nome da métrica/coluna se preenchido.',
          defaultValue: '',
          hideFromDefaults: true,
          category: ['Exibição da Célula'],
          showIf: isTableActive,
        })

        // ── 4. Aba Completa de Alerta e Threshold (Exclusivo para Overrides via hideFromDefaults) ──
        .addCustomEditor({
          id: 'alertConfig',
          path: 'alertConfig',
          name: 'Aba Completa: Alerta e Pop-up (!)',
          description: 'Traz todas as opções de threshold, modo de comparação, cores e pop-up (!) desta coluna reunidas em uma única aba.',
          editor: AlertOverrideEditor,
          override: AlertOverrideEditor,
          process: identityOverrideProcessor,
          shouldApply: () => true,
          hideFromDefaults: true,
          category: ['Alerta e Pop-up (!)'],
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
        description: 'Alterna entre os três modos de visualização disponíveis no plugin.',
        defaultValue: 'table',
        category: ['Modo do Painel'],
        settings: {
          options: [
            { value: 'table', label: 'Tabela Dinâmica' },
            { value: 'singleHost', label: 'Tabela de Host Único' },
            { value: 'heatmap', label: 'Mapa de Calor (ISA-101)' },
          ],
        },
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 2. Categoria "Layout e Estilo" (Tabela Dinâmica)
      // ═══════════════════════════════════════════════════════════════════════
      .addBooleanSwitch({
        path: 'showHeader',
        name: 'Exibir Cabeçalho da Tabela',
        description: 'Exibe ou oculta a linha de cabeçalho com os nomes das colunas.',
        defaultValue: true,
        category: ['Layout e Estilo'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addNumberInput({
        path: 'rowHeight',
        name: 'Altura da Linha (px)',
        description: 'Altura em pixels de cada linha da tabela (padrão: 34px).',
        defaultValue: 34,
        category: ['Layout e Estilo'],
        settings: { min: 20, max: 250, step: 2 },
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

      // ═══════════════════════════════════════════════════════════════════════
      // 3. Categoria "Coluna de Host e Ícones" (Tabela Dinâmica)
      // ═══════════════════════════════════════════════════════════════════════
      .addBooleanSwitch({
        path: 'showHostIcon',
        name: 'Mostrar Ícone do Host',
        description: 'Exibe o ícone do ativo na primeira coluna da tabela.',
        defaultValue: true,
        category: ['Coluna de Host e Ícones'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
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
        showIf: (c) => (c.panelMode ?? 'table') === 'table' && c.showHostIcon !== false,
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
        showIf: (c) => (c.panelMode ?? 'table') === 'table' && c.showHostIcon !== false,
      })
      .addBooleanSwitch({
        path: 'enableHostFilter',
        name: 'Habilitar Filtro no Host',
        description: 'Exibe ícone de filtro no cabeçalho do Host para busca instantânea.',
        defaultValue: false,
        category: ['Coluna de Host e Ícones'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' && c.showHostIcon !== false,
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 4. Categorias para Tabela de Host Único (panelMode === 'singleHost')
      // ═══════════════════════════════════════════════════════════════════════
      .addNumberInput({
        path: 'singleHostRowHeight',
        name: 'Altura da Linha de Métrica (px)',
        description: 'Altura em pixels de cada linha de métrica no modo Host Único (padrão: 34px).',
        defaultValue: 34,
        category: ['Layout e Estilo'],
        settings: { min: 20, max: 250, step: 2 },
        showIf: (c) => c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'singleHostEnableZebra',
        name: 'Zebrado Corporativo',
        description: 'Aplica gradiente sutil micro-luminoso nas linhas pares para facilitar a leitura.',
        defaultValue: true,
        category: ['Layout e Estilo'],
        showIf: (c) => c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'singleHostShowMetricIcon',
        name: 'Exibir Ícone das Métricas',
        description: 'Exibe ícone ao lado do nome de cada métrica no modo de Host Único.',
        defaultValue: true,
        category: ['Ícone do Host Único'],
        showIf: (c) => c.panelMode === 'singleHost',
      })
      .addSelect({
        path: 'singleHostMetricIcon',
        name: 'Ícone Padrão das Métricas',
        description: 'Ícone padrão exibido para as métricas no modo de Host Único.',
        defaultValue: 'server',
        category: ['Ícone do Host Único'],
        settings: {
          options: INDUSTRIAL_ICON_SELECT_OPTIONS,
        },
        showIf: (c) => c.panelMode === 'singleHost' && c.singleHostShowMetricIcon !== false,
      })
      .addRadio({
        path: 'singleHostMetricIconBgMode',
        name: 'Estilo do Ícone da Métrica',
        description: 'Formato visual do ícone da métrica no modo Host Único: vitrificado ou livre.',
        defaultValue: 'contained',
        category: ['Ícone do Host Único'],
        settings: {
          options: [
            { value: 'contained', label: 'Com Fundo Vitrificado (Contained)' },
            { value: 'clean', label: 'Livre (Clean)' },
          ],
        },
        showIf: (c) => c.panelMode === 'singleHost' && c.singleHostShowMetricIcon !== false,
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 5. Categoria "Alerta e Pop-up (!)" (Tabela Dinâmica e Host Único)
      // ═══════════════════════════════════════════════════════════════════════
      .addSelect({
        path: 'thresholdComparisonMode',
        name: 'Modo de Comparação do Threshold',
        description: 'Define como os limites de threshold são avaliados globalmente: Maior ou Igual (>=), Exatamente Igual (==) ou Menor ou Igual (<=).',
        defaultValue: 'gte',
        category: ['Alerta e Pop-up (!)'],
        settings: {
          options: [
            { value: 'gte', label: 'Maior ou Igual (>=) [Padrão]' },
            { value: 'eq', label: 'Exatamente Igual (==) [Binário / Status]' },
            { value: 'lte', label: 'Menor ou Igual (<=)' },
          ],
        },
        showIf: (c) => (c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'useThresholdColors',
        name: 'Colorir Métrica pelo Threshold',
        description: 'Aplica cores de threshold no texto e status de todas as métricas que não tiverem override.',
        defaultValue: false,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'colorHostIconByThreshold',
        name: 'Colorir Ícone pelo Threshold',
        description: 'Quando ativado, o ícone do host assume a cor do threshold ativo da linha.',
        defaultValue: false,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table',
      })
      .addBooleanSwitch({
        path: 'singleHostColorMetricIconByThreshold',
        name: 'Colorir Ícone pelo Threshold',
        description: 'Quando ativado, os ícones das métricas assumem a cor do threshold ativo.',
        defaultValue: false,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'sparklineFollowThreshold',
        name: 'Colorir Linha pelo Threshold',
        description: 'Aplica a cor do threshold ativo à linha e área do gráfico (global para colunas em modo gráfico).',
        defaultValue: false,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'binaryStepHighlight',
        name: 'Colorir Cada Parte da Linha pelo Threshold',
        description: 'Destaca no gráfico cada período/trecho em que houve violação de threshold com a respectiva cor de alerta.',
        defaultValue: false,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost',
      })
      .addBooleanSwitch({
        path: 'enableAlertPopup',
        name: 'Habilitar Botão / Pop-up de Alerta (!)',
        description: 'Exibe o botão interativo de alerta com histórico de episódios ao lado do host / métrica quando houver violação.',
        defaultValue: true,
        category: ['Alerta e Pop-up (!)'],
        showIf: (c) => (c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost' || c.panelMode === 'heatmap',
      })
      .addSelect({
        path: 'alertPopupDisplayMode',
        name: 'Modo de Exibição do Botão (!)',
        description: 'Define quando exibir o botão (!): Em qualquer alerta (ativo ou histórico na janela) ou apenas quando em alerta ativo no momento.',
        defaultValue: 'always',
        category: ['Alerta e Pop-up (!)'],
        settings: {
          options: [
            { value: 'always', label: 'Em qualquer alerta (Ativo ou Histórico na Janela)' },
            { value: 'alertOnly', label: 'Apenas quando em alerta ativo' },
          ],
        },
        showIf: (c) => ((c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost' || c.panelMode === 'heatmap') && c.enableAlertPopup !== false,
      })
      .addSelect({
        path: 'disconnectThreshold',
        name: 'Limite de Desconexão / Lacuna no Pop-up',
        description: 'Tempo de inatividade sem dados antes de interromper episódios no histórico do pop-up.',
        defaultValue: 'auto',
        category: ['Alerta e Pop-up (!)'],
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
        showIf: (c) => ((c.panelMode ?? 'table') === 'table' || c.panelMode === 'singleHost' || c.panelMode === 'heatmap') && c.enableAlertPopup !== false,
      })

      // ═══════════════════════════════════════════════════════════════════════
      // 4. Categoria "Mapa de Calor"  (showIf: c => c.panelMode === 'heatmap')
      // ═══════════════════════════════════════════════════════════════════════
      .addBooleanSwitch({
        path: 'showHeatmapHeader',
        name: 'Exibir Rótulo Superior',
        description: 'Exibe ou oculta o rótulo superior do Mapa de Calor.',
        defaultValue: true,
        category: ['Mapa de Calor'],
        showIf: (c) => c.panelMode === 'heatmap',
      })
      .addTextInput({
        path: 'heatmapCustomLabel',
        name: 'Rótulo do Cabeçalho (Heatmap)',
        description: 'Texto customizado para o rótulo superior do Mapa de Calor. Deixe em branco para usar o nome da métrica.',
        defaultValue: '',
        category: ['Mapa de Calor'],
        settings: {
          placeholder: 'Nome da Métrica (Padrão)',
        },
        showIf: (c) => c.panelMode === 'heatmap',
      })
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
      });
  });
