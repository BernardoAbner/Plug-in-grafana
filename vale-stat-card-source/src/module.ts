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
              { value: 'bar', label: 'Barra'  },
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
        defaultValue: 'CPU UTILIZACAO',
        category: ['Cabeçalho'],
      })
      .addSelect({
        path: 'icon',
        name: 'Icone',
        defaultValue: 'cpu',
        category: ['Cabeçalho'],
        settings: {
          options: [
            // Infraestrutura
            { value: 'cpu',                  label: 'Infra - CPU'              },
            { value: 'server',               label: 'Infra - Servidor'         },
            { value: 'server-alt',           label: 'Infra - Servidor (alt)'   },
            { value: 'database',             label: 'Infra - Banco / Datastore' },
            { value: 'hdd',                  label: 'Infra - Disco (HDD)'      },
            { value: 'network-wired',        label: 'Infra - Rede cabeada'     },
            { value: 'temperature',          label: 'Infra - Temperatura'      },
            { value: 'wifi',                 label: 'Infra - Wi-Fi / Link'     },
            { value: 'bolt',                 label: 'Infra - Energia'          },
            // Status / NOC
            { value: 'check-circle',         label: 'Status - OK'              },
            { value: 'exclamation-triangle', label: 'Status - Alerta critico'  },
            { value: 'alert',                label: 'Status - Alerta'          },
            { value: 'bell-slash',           label: 'Status - Silenciado'      },
            { value: 'times-circle',         label: 'Status - Erro / Down'     },
            // Metricas
            { value: 'heartbeat',            label: 'Metricas - Saude / Pulso'     },
            { value: 'arrow-up',             label: 'Metricas - Tendencia subindo' },
            { value: 'arrow-down',           label: 'Metricas - Tendencia caindo'  },
            { value: 'chart-line',           label: 'Metricas - Grafico de linha'  },
            // Diversos
            { value: 'signal',  label: 'Diversos - Sinal'     },
            { value: 'clock',   label: 'Diversos - Relogio'   },
            { value: 'heart',   label: 'Diversos - Saude'     },
            { value: 'shield',  label: 'Diversos - Seguranca' },
            { value: 'apps',    label: 'Diversos - Generico'  },
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
