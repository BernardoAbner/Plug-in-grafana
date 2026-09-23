import { PanelPlugin, FieldConfigProperty } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions, CustomFieldConfig>(SimplePanel)
  .setNoPadding()
  .useFieldConfig({
    standardOptions: {
      [FieldConfigProperty.Unit]: {},
      [FieldConfigProperty.Decimals]: {},
      [FieldConfigProperty.Min]: {},
      [FieldConfigProperty.Max]: {},
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
          category: ['Grafico'],
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
          category: ['Grafico'],
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
          category: ['Grafico'],
          settings: { options: [{ value: 'solid', label: 'Sólida' }, { value: 'dashed', label: 'Tracejada' }] },
        })
        .addNumberInput({
          path: 'lineWidth',
          name: 'Espessura da linha',
          defaultValue: 2,
          category: ['Grafico'],
          settings: { min: 1, max: 10, step: 1 },
        })
        .addNumberInput({
          path: 'areaOpacity',
          name: 'Opacidade da area (%)',
          description: '0 = transparente, 100 = opaco',
          defaultValue: 35,
          category: ['Grafico'],
          settings: { min: 0, max: 100, step: 5 },
        })
        .addBooleanSwitch({
          path: 'showPoints',
          name: 'Mostrar pontos',
          defaultValue: false,
          category: ['Grafico'],
        })
        .addNumberInput({
          path: 'pointSize',
          name: 'Tamanho dos pontos',
          defaultValue: 5,
          category: ['Grafico'],
          settings: { min: 1, max: 10, step: 1 },
          showIf: (cfg) => cfg.showPoints === true,
        })
        // --- Eixos ---
        .addBooleanSwitch({
          path: 'showGrid',
          name: 'Mostrar grade',
          defaultValue: false,
          category: ['Eixos'],
        })
        .addBooleanSwitch({
          path: 'showXAxis',
          name: 'Mostrar eixo X',
          defaultValue: false,
          category: ['Eixos'],
        })
        .addBooleanSwitch({
          path: 'showYAxis',
          name: 'Mostrar eixo Y',
          defaultValue: false,
          category: ['Eixos'],
        })
        // --- Resumo do período ---
        .addBooleanSwitch({
          path: 'showTimeInAlert',
          name: 'Mostrar tempo em alerta',
          description: 'Mostra a duração em cada faixa de threshold dentro do período do Grafana.',
          defaultValue: false,
          category: ['Resumo do período'],
          showIf: (cfg) => {
            const thresholds = (cfg as any).thresholds ?? cfg.nativeThresholds;
            return thresholds?.steps?.some((step: any) => step.value !== null) ?? false;
          },
        });
    },
  })
  .setPanelOptions((builder) => {
    return builder
      // --- Cabecalho ---
      .addTextInput({
        path: 'label',
        name: 'Rotulo',
        description: 'Texto exibido no cabecalho do card',
        defaultValue: '',
        category: ['Cabeçalho'],
      })
      .addRadio({
        path: 'iconStyle',
        name: 'Estilo do Ícone',
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
        path: 'icon',
        name: 'Ícone do Painel',
        description: 'Selecione o ícone que representa este equipamento/métrica',
        defaultValue: 'server',
        category: ['Cabeçalho'],
        settings: {
          options: [
            { label: 'Infraestrutura e Virtualização', options: [
              { label: 'Servidor / Host', value: 'server' },
              { label: 'Banco de Dados', value: 'database' },
              { label: 'Nuvem / Cloud', value: 'cloud' },
              { label: 'Computador / Desktop', value: 'desktop' },
            ]},
            { label: 'Redes e Conectividade', options: [
              { label: 'Switch / Topologia', value: 'sitemap' },
              { label: 'Rádio / Wireless', value: 'wifi' },
              { label: 'Tráfego / Rotas', value: 'exchange' },
              { label: 'Segurança / Firewall', value: 'shield' },
            ]},
            { label: 'Métricas e Status', options: [
              { label: 'Energia / Tensão', value: 'bolt' },
              { label: 'Desempenho / Gráfico', value: 'chart-line' },
              { label: 'Alerta / Atenção', value: 'exclamation-triangle' },
              { label: 'Informação', value: 'info-circle' },
            ]}
          ],
        },
      })
      .addBooleanSwitch({
        path: 'showIcon',
        name: 'Mostrar icone',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showLabel',
        name: 'Mostrar rotulo',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showValue',
        name: 'Mostrar valor atual',
        defaultValue: true,
        category: ['Cabeçalho'],
      })
      .addNumberInput({
        path: 'valueFontSize',
        name: 'Tamanho da fonte do valor (px)',
        defaultValue: 26,
        settings: { min: 8, max: 120, step: 1 },
        category: ['Cabeçalho'],
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
        category: ['Grafico'],
      })
      .addBooleanSwitch({
        path: 'showLegend',
        name: 'Mostrar legenda',
        defaultValue: false,
        category: ['Grafico'],
        showIf: (o) => o.showSparkline,
      })
      .addBooleanSwitch({
        path: 'showPeriodSummary',
        name: 'Mostrar resumo do período',
        description: 'Resume os dados da janela de tempo selecionada no Grafana.',
        defaultValue: false,
        category: ['Cabeçalho'],
      })
      .addBooleanSwitch({
        path: 'showPeriodPeak',
        name: 'Mostrar pico',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showPeriodSummary === true,
      })
      .addBooleanSwitch({
        path: 'showPeriodMin',
        name: 'Mostrar mínimo',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showPeriodSummary === true,
      })
      .addBooleanSwitch({
        path: 'showPeriodAverage',
        name: 'Mostrar média',
        defaultValue: true,
        category: ['Cabeçalho'],
        showIf: (o) => o.showPeriodSummary === true,
      });
  });
