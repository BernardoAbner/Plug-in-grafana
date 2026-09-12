import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { MetricsEditor } from './components/MetricsEditor';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions, CustomFieldConfig>(SimplePanel)
  .setNoPadding()
  .useFieldConfig({
    // O painel fornece equivalentes próprios para estas opções.
    disableStandardOptions: [
      FieldConfigProperty.Min,
      FieldConfigProperty.Max,
      FieldConfigProperty.FieldMinMax,
      FieldConfigProperty.DisplayName,
      FieldConfigProperty.NoValue,
      FieldConfigProperty.Links,
      FieldConfigProperty.Actions,
      FieldConfigProperty.Color,
      FieldConfigProperty.Unit,
      FieldConfigProperty.Decimals,
    ],
    useCustomConfig: (builder) => {
      builder
        // --- Valor / Formatação ---

        .addUnitPicker({
          path: 'customUnit',
          name: 'Unidade',
          description: 'Substitui a unidade original. Escolha "none" para usar o padrão.',
          defaultValue: '',
          category: ['Grafico'],
        })
        .addNumberInput({
          path: 'customDecimals',
          name: 'Decimais',
          description: 'Define as casas decimais. Deixe em branco para automático.',
          defaultValue: 2,
          category: ['Grafico'],
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone Específico',
          description: 'Define um ícone específico para este campo (sobrescreve o ícone padrão do painel).',
          category: ['Ícone'],
          settings: {
            options: [
              { value: '', label: 'Padrão do Painel' },
              // Infraestrutura
              { value: 'cpu', label: 'Infra - CPU' },
              { value: 'server', label: 'Infra - Servidor' },
              { value: 'server-alt', label: 'Infra - Servidor (alt)' },
              { value: 'database', label: 'Infra - Banco / Datastore' },
              { value: 'hdd', label: 'Infra - Disco (HDD)' },
              { value: 'network-wired', label: 'Infra - Rede cabeada' },
              { value: 'temperature', label: 'Infra - Temperatura' },
              { value: 'wifi', label: 'Infra - Wi-Fi / Link' },
              { value: 'bolt', label: 'Infra - Energia' },
              // Status / NOC
              { value: 'check-circle', label: 'Status - OK' },
              { value: 'exclamation-triangle', label: 'Status - Alerta critico' },
              { value: 'alert', label: 'Status - Alerta' },
              { value: 'bell-slash', label: 'Status - Silenciado' },
              { value: 'times-circle', label: 'Status - Erro / Down' },
              // Metricas
              { value: 'heartbeat', label: 'Metricas - Saude / Pulso' },
              { value: 'arrow-up', label: 'Metricas - Tendencia subindo' },
              { value: 'arrow-down', label: 'Metricas - Tendencia caindo' },
              { value: 'chart-line', label: 'Metricas - Grafico de linha' },
              // Diversos
              { value: 'signal', label: 'Diversos - Sinal' },
              { value: 'clock', label: 'Diversos - Relogio' },
              { value: 'heart', label: 'Diversos - Saude' },
              { value: 'shield', label: 'Diversos - Seguranca' },
              { value: 'apps', label: 'Diversos - Generico' },
            ],
          },
        });
    },
  })
  .setPanelOptions((builder) => {
    return (
      builder
        .addRadio({
          path: 'metricMode',
          name: 'Seleção de métricas',
          defaultValue: 'auto',
          category: ['Métricas'],
          settings: {
            options: [
              { value: 'auto', label: 'Automática (primeira série)' },
              { value: 'configured', label: 'Configurável' },
            ],
          },
        })
        .addCustomEditor({
          id: 'metrics',
          path: 'metrics',
          name: 'Métricas e status',
          editor: MetricsEditor,
          defaultValue: [],
          category: ['Métricas'],
          showIf: (o) => o.metricMode === 'configured',
        })
        .addRadio({
          path: 'cardLayout',
          name: 'Agrupamento',
          defaultValue: 'separate',
          category: ['Layout'],
          settings: {
            options: [
              { value: 'separate', label: 'Um card por métrica' },
              { value: 'grouped', label: 'Métricas no mesmo card' },
            ],
          },
        })
        .addRadio({
          path: 'horizontalAlign',
          name: 'Alinhamento horizontal',
          defaultValue: 'left',
          category: ['Layout'],
          settings: {
            options: [
              { value: 'left', label: 'Esquerda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Direita' },
            ],
          },
        })
        .addRadio({
          path: 'verticalAlign',
          name: 'Alinhamento vertical',
          defaultValue: 'center',
          category: ['Layout'],
          settings: {
            options: [
              { value: 'top', label: 'Topo' },
              { value: 'center', label: 'Centro' },
              { value: 'bottom', label: 'Base' },
            ],
          },
        })
        .addNumberInput({
          path: 'gap',
          name: 'Espaçamento entre métricas (px)',
          defaultValue: 16,
          category: ['Layout'],
          settings: { min: 0, max: 100 },
        })
        .addNumberInput({
          path: 'cardPadding',
          name: 'Espaçamento interno (px)',
          defaultValue: 16,
          category: ['Layout'],
          settings: { min: 0, max: 100 },
        })
        .addNumberInput({
          path: 'borderRadius',
          name: 'Arredondamento (px)',
          defaultValue: 12,
          category: ['Layout'],
          settings: { min: 0, max: 100 },
        })
        .addNumberInput({
          path: 'minCardWidth',
          name: 'Largura mínima da métrica (px)',
          defaultValue: 250,
          category: ['Layout'],
          settings: { min: 80, max: 1000 },
        })
        // --- Layout e Aparência Geral ---
        .addRadio({
          path: 'layoutOrientation',
          name: 'Orientação do Layout',
          defaultValue: 'horizontal',
          category: ['Layout'],
          settings: {
            options: [
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'vertical', label: 'Vertical' },
            ],
          },
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone Padrão',
          defaultValue: 'cpu',
          category: ['Conteúdo'],
          settings: {
            options: [
              // Infraestrutura
              { value: 'cpu', label: 'Infra - CPU' },
              { value: 'server', label: 'Infra - Servidor' },
              { value: 'server-alt', label: 'Infra - Servidor (alt)' },
              { value: 'database', label: 'Infra - Banco / Datastore' },
              { value: 'hdd', label: 'Infra - Disco (HDD)' },
              { value: 'network-wired', label: 'Infra - Rede cabeada' },
              { value: 'temperature', label: 'Infra - Temperatura' },
              { value: 'wifi', label: 'Infra - Wi-Fi / Link' },
              { value: 'bolt', label: 'Infra - Energia' },
              // Status / NOC
              { value: 'check-circle', label: 'Status - OK' },
              { value: 'exclamation-triangle', label: 'Status - Alerta critico' },
              { value: 'alert', label: 'Status - Alerta' },
              { value: 'bell-slash', label: 'Status - Silenciado' },
              { value: 'times-circle', label: 'Status - Erro / Down' },
              // Metricas
              { value: 'heartbeat', label: 'Metricas - Saude / Pulso' },
              { value: 'arrow-up', label: 'Metricas - Tendencia subindo' },
              { value: 'arrow-down', label: 'Metricas - Tendencia caindo' },
              { value: 'chart-line', label: 'Metricas - Grafico de linha' },
              // Diversos
              { value: 'signal', label: 'Diversos - Sinal' },
              { value: 'clock', label: 'Diversos - Relogio' },
              { value: 'heart', label: 'Diversos - Saude' },
              { value: 'shield', label: 'Diversos - Seguranca' },
              { value: 'apps', label: 'Diversos - Generico' },
            ],
          },
        })
        .addBooleanSwitch({
          path: 'showIcon',
          name: 'Mostrar ícone',
          defaultValue: true,
          category: ['Conteúdo'],
        })
        .addBooleanSwitch({
          path: 'showLabel',
          name: 'Mostrar rótulo (nome do campo)',
          defaultValue: true,
          category: ['Conteúdo'],
        })
        .addBooleanSwitch({
          path: 'showValue',
          name: 'Mostrar valor',
          defaultValue: true,
          category: ['Conteúdo'],
        })
        .addNumberInput({
          path: 'valueFontSize',
          name: 'Tamanho da fonte do valor (px)',
          defaultValue: 26,
          settings: { min: 8, max: 120, step: 1 },
          category: ['Conteúdo'],
        })
        // --- Tema e Thresholds ---
        .addSelect({
          path: 'theme',
          name: 'Cor do tema',
          defaultValue: 'vale',
          category: ['Tema'],
          settings: {
            options: [
              { value: 'vale', label: 'Vale (#007E7A)' },
              { value: 'teal', label: 'Teal (verde-agua)' },
              { value: 'blue', label: 'Azul' },
              { value: 'purple', label: 'Roxo' },
              { value: 'orange', label: 'Laranja' },
              { value: 'red', label: 'Vermelho' },
              { value: 'green', label: 'Verde' },
            ],
          },
        })
        .addBooleanSwitch({
          path: 'useThreshold',
          name: 'Usar cor de threshold',
          description: 'Aplica as cores dos thresholds nativos.',
          defaultValue: false,
          category: ['Tema'],
        })
        .addRadio({
          path: 'colorMode',
          name: 'Modo de Cor do Threshold',
          defaultValue: 'text',
          category: ['Tema'],
          settings: {
            options: [
              { value: 'text', label: 'Apenas Texto' },
              { value: 'background', label: 'Fundo do Card' },
            ],
          },
          showIf: (o) => o.useThreshold,
        })
    );
  });
