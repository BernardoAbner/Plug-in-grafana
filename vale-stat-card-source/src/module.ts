import { PanelPlugin, FieldConfigProperty } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions, CustomFieldConfig>(SimplePanel)
  .setNoPadding()
  .useFieldConfig({
    standardOptions: {
      [FieldConfigProperty.Unit]: {},
      [FieldConfigProperty.Decimals]: {},
      [FieldConfigProperty.Thresholds]: {},
    },
    useCustomConfig: (builder) => {
      builder
        // --- Tipo e estilo do grafico ---
        .addSelect({
          path: 'chartType',
          name: 'Tipo de grafico',
          description: 'Estilo de desenho da serie',
          defaultValue: 'area',
          category: ['Gráfico'],
          settings: {
            options: [
              { value: 'line', label: 'Linha' },
              { value: 'area', label: 'Area'  },
              { value: 'points', label: 'Pontos'  },
            ],
          },
        })
        .addSelect({
          path: 'lineInterpolation',
          name: 'Traçado da linha',
          defaultValue: 'smooth',
          category: ['Gráfico'],
          settings: {
            options: [
              { value: 'straight', label: 'Reto' },
              { value: 'smooth', label: 'Suave / arredondado' },
              { value: 'stepBefore', label: 'Degraus (antes)' },
              { value: 'stepAfter', label: 'Degraus (depois)' },
            ],
          },
        })
        .addSelect({
          path: 'linePattern',
          name: 'Estilo da linha',
          defaultValue: 'solid',
          category: ['Gráfico'],
          settings: { options: [{ value: 'solid', label: 'Sólida' }, { value: 'dashed', label: 'Tracejada' }] },
        })
        .addNumberInput({
          path: 'lineWidth',
          name: 'Espessura da linha',
          defaultValue: 2,
          category: ['Gráfico'],
          settings: { min: 1, max: 10, step: 1 },
        })
        .addNumberInput({
          path: 'areaOpacity',
          name: 'Opacidade da area (%)',
          description: '0 = transparente, 100 = opaco',
          defaultValue: 35,
          category: ['Gráfico'],
          settings: { min: 0, max: 100, step: 5 },
        })
        .addBooleanSwitch({
          path: 'showPoints',
          name: 'Mostrar pontos',
          defaultValue: false,
          category: ['Gráfico'],
        })
        .addNumberInput({
          path: 'pointSize',
          name: 'Tamanho dos pontos',
          defaultValue: 5,
          category: ['Gráfico'],
          settings: { min: 1, max: 10, step: 1 },
          showIf: (cfg) => cfg.showPoints === true,
        })        // --- Cabeçalho (Overrides) ---
        .addTextInput({
          path: 'label',
          name: 'Rótulo Customizado',
          description: 'Substitui o nome da query se preenchido',
          defaultValue: '',
          category: ['Cabeçalho'],
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone do Dispositivo',
          description: 'Selecione o ativo correspondente',
          defaultValue: 'server',
          category: ['Cabeçalho'],
          settings: {
            options: [
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
            ],
          },
        })
        .addRadio({
          path: 'iconStyle',
          name: 'Estilo do Ícone (Override)',
          category: ['Cabeçalho'],
          settings: {
            options: [
              { value: 'contained', label: 'Com Fundo' },
              { value: 'clean', label: 'Livre' },
            ],
          },
        })
        .addBooleanSwitch({
          path: 'colorIconByThreshold',
          name: 'Usar cor do threshold no Ícone',
          defaultValue: false,
          category: ['Cabeçalho'],
        })
        .addBooleanSwitch({
          path: 'colorLabelByThreshold',
          name: 'Usar cor do threshold no Rótulo',
          defaultValue: false,
          category: ['Cabeçalho'],
        })
        .addBooleanSwitch({
          path: 'colorValueByThreshold',
          name: 'Usar cor do threshold na Métrica (Valor)',
          defaultValue: false,
          category: ['Cabeçalho'],
        })
        .addBooleanSwitch({
          path: 'colorSummaryByThreshold',
          name: 'Usar cor do threshold no Resumo (Mín/Méd/Máx)',
          defaultValue: false,
          category: ['Cabeçalho'],
        });
    },
  })
  .setPanelOptions((builder) => {
    return builder
      // --- Cabecalho ---
      // --- Cabecalho ---
      .addBooleanSwitch({
        path: 'showIcon',
        name: 'Mostrar Ícone',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showLabel',
        name: 'Mostrar Rótulo',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showCurrentValue',
        name: 'Mostrar Valor Atual',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showSummary',
        name: 'Mostrar Resumo do Período',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addRadio({
        path: 'iconStyle',
        name: 'Estilo do Ícone (Global)',
        defaultValue: 'contained',
        category: ['Cabeçalho'],
        settings: {
          options: [
            { value: 'contained', label: 'Com Fundo' },
            { value: 'clean', label: 'Livre' },
          ],
        },
      })
      .addSelect({
        path: 'valueFontSize',
        name: 'Tamanho da Fonte do Valor',
        defaultValue: '18px',
        category: ['Cabeçalho'],
        settings: { options: [
          { label: 'Pequeno (14px)', value: '14px' },
          { label: 'Médio (16px)', value: '16px' },
          { label: 'Padrão (18px)', value: '18px' },
          { label: 'Grande (22px)', value: '22px' },
          { label: 'Extra Grande (26px)', value: '26px' },
        ]}
      })
      // --- Aparencia ---
      .addSelect({
        path: 'theme',
        name: 'Cor do tema',
        defaultValue: 'vale',
        category: ['Aparencia'],
        settings: {
          options: [
            { value: 'vale',   label: 'Vale (#007E7A)'   },
            { value: 'teal',   label: 'Teal (verde-agua)' },
            { value: 'blue',   label: 'Azul'             },
            { value: 'purple', label: 'Roxo'             },
            { value: 'orange', label: 'Laranja'          },
            { value: 'red',    label: 'Vermelho'         },
            { value: 'green',  label: 'Verde'            },
          ],
        },
      })
      .addBooleanSwitch({
        path: 'useThreshold',
        name: 'Usar cor de threshold',
        description: 'Aplica as cores dos thresholds nativos ao valor/linha.',
        defaultValue: false,
        category: ['Aparencia'],
      })
      .addBooleanSwitch({
        path: 'showThresholdLine',
        name: 'Mostrar linha de threshold',
        description: 'Desenha uma linha tracejada no gráfico indicando o limite.',
        defaultValue: true,
        category: ['Aparencia'],
      })
      .addBooleanSwitch({
        path: 'valueFollowsThreshold',
        name: 'Valor acompanha cor de threshold',
        description: 'A cor do valor grande segue a cor do threshold ativo.',
        defaultValue: false,
        category: ['Aparencia'],
        showIf: (o) => o.useThreshold === true,
      })
      .addRadio({
        path: 'thresholdMode',
        name: 'Modo de threshold',
        defaultValue: 'line',
        category: ['Aparencia'],
        settings: {
          options: [
            { value: 'line', label: 'Linha sólida' },
            { value: 'schema', label: 'Por faixas (schema)' },
          ],
        },
        showIf: (o) => o.useThreshold === true,
      })
      // --- Grafico (panel-level) ---
      .addBooleanSwitch({
        path: 'showSparkline',
        name: 'Mostrar grafico',
        defaultValue: true,
        category: ['Gráfico'],
      })
      .addBooleanSwitch({
        path: 'showLegend',
        name: 'Mostrar legenda',
        defaultValue: false,
        category: ['Gráfico'],
        showIf: (o) => o.showSparkline,
      })
      .addBooleanSwitch({
        path: 'showGrid',
        name: 'Mostrar grade',
        defaultValue: false,
        category: ['Gráfico'],
        showIf: (o) => o.showSparkline,
      })
      .addBooleanSwitch({
        path: 'showXAxis',
        name: 'Mostrar eixo X',
        defaultValue: false,
        category: ['Gráfico'],
        showIf: (o) => o.showSparkline,
      })
      .addBooleanSwitch({
        path: 'showYAxis',
        name: 'Mostrar eixo Y',
        defaultValue: false,
        category: ['Gráfico'],
        showIf: (o) => o.showSparkline,
      })
      .addBooleanSwitch({
        path: 'showPeriodPeak',
        name: 'Mostrar pico',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showSummary === true,
      })
      .addBooleanSwitch({
        path: 'showPeriodMin',
        name: 'Mostrar mínimo',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showSummary === true,
      })
      .addBooleanSwitch({
        path: 'showPeriodAverage',
        name: 'Mostrar média',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showSummary === true,
      })
      .addBooleanSwitch({
        path: 'showTimeInAlert',
        name: 'Mostrar tempo em alerta',
        description: 'Mostra há quanto tempo a métrica viola um threshold.',
        defaultValue: false,
        category: ['Cabeçalho'],
        showIf: (o) => o.showSummary === true,
      });
  });
