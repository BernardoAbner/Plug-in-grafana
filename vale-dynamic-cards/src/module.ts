import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { MetricsEditor } from './components/MetricsEditor';
import { MetricSelectorEditor } from './components/MetricSelectorEditor';
import { StatusBadgesEditor } from './components/StatusBadgesEditor';
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
        // --- Conteúdo por campo ---

        .addUnitPicker({
          path: 'customUnit',
          name: 'Unidade',
          description: 'Substitui a unidade original. Escolha "none" para usar o padrão.',
          defaultValue: '',
          category: ['Configurações'],
        })
        .addNumberInput({
          path: 'customDecimals',
          name: 'Decimais',
          description: 'Define as casas decimais. Deixe em branco para automático.',
          defaultValue: 2,
          category: ['Configurações'],
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone Específico',
          description: 'Define um ícone específico para este campo (sobrescreve o ícone padrão do painel).',
          category: ['Configurações'],
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
        })
        .addBooleanSwitch({
          path: 'showIcon',
          name: 'Mostrar ícone (Override)',
          description: 'Se ativo, mostra o ícone para esta métrica específica (sobrepõe a opção global).',
          defaultValue: true,
          category: ['Configurações'],
        })
        .addBooleanSwitch({
          path: 'useThreshold',
          name: 'Usar cor de threshold',
          description: 'Aplica as cores dos thresholds nativos.',
          defaultValue: false,
          category: ['Configurações'],
        })
        .addRadio({
          path: 'colorMode',
          name: 'Modo de Cor do Threshold',
          defaultValue: 'text',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'text', label: 'Apenas Texto' },
              { value: 'background', label: 'Fundo do Card' },
            ],
          },
          showIf: (o) => o.useThreshold,
        });
    },
  })
  .setPanelOptions((builder) => {
    return (
      builder
        .addRadio({
          path: 'displayMode',
          name: 'Modo de exibição',
          defaultValue: 'cards',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'cards', label: 'Cards' },
              { value: 'statusBar', label: 'Barra de status' },
            ],
          },
        })
        .addTextInput({
          path: 'headerTitle',
          name: 'Hostname',
          description: 'Aceita variáveis do dashboard, por exemplo: ${hostname}.',
          defaultValue: '${hostname}',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'headerDetailSource',
          path: 'headerDetailSource',
          name: 'Métrica abaixo do hostname',
          description: 'Selecione um campo de texto ou número para aparecer abaixo do hostname.',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'indicator1Source',
          path: 'indicator1Source',
          name: 'Indicador 1 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'indicator1Label',
          name: 'Indicador 1 (Rótulo)',
          description: 'Deixe em branco para usar o nome do campo.',
          defaultValue: '',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'indicator2Source',
          path: 'indicator2Source',
          name: 'Indicador 2 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'indicator2Label',
          name: 'Indicador 2 (Rótulo)',
          description: 'Deixe em branco para usar o nome do campo.',
          defaultValue: '',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'statusBarMetric1Source',
          path: 'statusBarMetric1Source',
          name: 'Métrica 1 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'statusBarMetric1Label',
          name: 'Métrica 1 (Rótulo)',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'statusBarMetric2Source',
          path: 'statusBarMetric2Source',
          name: 'Métrica 2 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'statusBarMetric2Label',
          name: 'Métrica 2 (Rótulo)',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'statusBarMetric3Source',
          path: 'statusBarMetric3Source',
          name: 'Métrica 3 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'statusBarMetric3Label',
          name: 'Métrica 3 (Rótulo)',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'statusBarMetric4Source',
          path: 'statusBarMetric4Source',
          name: 'Métrica 4 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'statusBarMetric4Label',
          name: 'Métrica 4 (Rótulo)',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addCustomEditor({
          id: 'statusBarMetric5Source',
          path: 'statusBarMetric5Source',
          name: 'Métrica 5 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addTextInput({
          path: 'statusBarMetric5Label',
          name: 'Métrica 5 (Rótulo)',
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'statusBar',
        })
        .addRadio({
          path: 'metricMode',
          name: 'Seleção de métricas',
          defaultValue: 'auto',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'auto', label: 'Automática (primeira série)' },
              { value: 'configured', label: 'Configurável' },
            ],
          },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addCustomEditor({
          id: 'metrics',
          path: 'metrics',
          name: 'Métricas e status',
          editor: MetricsEditor,
          defaultValue: [],
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'cards' && o.metricMode === 'configured',
        })
        .addRadio({
          path: 'cardLayout',
          name: 'Agrupamento',
          defaultValue: 'separate',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'separate', label: 'Um card por métrica' },
              { value: 'grouped', label: 'Métricas no mesmo card' },
            ],
          },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addRadio({
          path: 'horizontalAlign',
          name: 'Alinhamento horizontal',
          defaultValue: 'left',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'left', label: 'Esquerda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Direita' },
            ],
          },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addRadio({
          path: 'verticalAlign',
          name: 'Alinhamento vertical',
          defaultValue: 'center',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'top', label: 'Topo' },
              { value: 'center', label: 'Centro' },
              { value: 'bottom', label: 'Base' },
            ],
          },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addNumberInput({
          path: 'gap',
          name: 'Espaçamento entre métricas (px)',
          defaultValue: 16,
          category: ['Configurações'],
          settings: { min: 0, max: 100 },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addNumberInput({
          path: 'cardPadding',
          name: 'Espaçamento interno (px)',
          defaultValue: 16,
          category: ['Configurações'],
          settings: { min: 0, max: 100 },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addNumberInput({
          path: 'borderRadius',
          name: 'Arredondamento (px)',
          defaultValue: 12,
          category: ['Configurações'],
          settings: { min: 0, max: 100 },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addNumberInput({
          path: 'minCardWidth',
          name: 'Largura mínima da métrica (px)',
          defaultValue: 250,
          category: ['Configurações'],
          settings: { min: 80, max: 1000 },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addRadio({
          path: 'layoutOrientation',
          name: 'Orientação do Layout',
          defaultValue: 'horizontal',
          category: ['Configurações'],
          settings: {
            options: [
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'vertical', label: 'Vertical' },
            ],
          },
          showIf: (o) => o.displayMode === 'cards',
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone Padrão',
          defaultValue: 'cpu',
          category: ['Configurações'],
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
          showIf: (o) => o.displayMode === 'cards',
        })
        .addBooleanSwitch({
          path: 'showIcon',
          name: 'Mostrar ícone',
          defaultValue: true,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'cards',
        })
        .addBooleanSwitch({
          path: 'showLabel',
          name: 'Mostrar rótulo (nome do campo)',
          defaultValue: true,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'cards',
        })
        .addBooleanSwitch({
          path: 'showValue',
          name: 'Mostrar valor',
          defaultValue: true,
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'cards',
        })
        .addNumberInput({
          path: 'valueFontSize',
          name: 'Tamanho da fonte do valor (px)',
          defaultValue: 26,
          settings: { min: 8, max: 120, step: 1 },
          category: ['Configurações'],
          showIf: (o) => o.displayMode === 'cards',
        })
        .addSelect({
          path: 'theme',
          name: 'Cor do tema',
          defaultValue: 'vale',
          category: ['Configurações'],
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
          showIf: (o) => o.displayMode === 'cards',
        })
    );
  });
