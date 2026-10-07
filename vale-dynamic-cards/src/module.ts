import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { SimpleOptions, CustomFieldConfig } from './types';
import { MetricSelectorEditor } from './components/MetricSelectorEditor';
import { SimplePanel } from './components/SimplePanel';

// Catálogo de ícones industriais agrupado por categoria
// (compartilhado entre o override de campo e a opção global)
const ICON_OPTIONS = [
  {
    label: 'Infra & TI',
    options: [
      { label: 'Servidor (Server)', value: 'server' },
      { label: 'Banco de Dados (Database)', value: 'database' },
      { label: 'Nuvem (Cloud)', value: 'cloud' },
      { label: 'Wi-Fi', value: 'wifi' },
      { label: 'Rádio (Radio)', value: 'radio' },
      { label: 'Escudo (Shield)', value: 'shield' },
      { label: 'Cadeado (Lock)', value: 'lock' },
    ],
  },
  {
    label: 'Automação & Indústria',
    options: [
      { label: 'Energia (Bolt)', value: 'bolt' },
      { label: 'Conector (Plug)', value: 'plug' },
      { label: 'Ligado/Desligado (Power)', value: 'power' },
      { label: 'Engrenagem (Cog)', value: 'cog' },
      { label: 'Painel (Dashboard)', value: 'dashboard' },
      { label: 'Ajustes (Sliders)', value: 'sliders-v-alt' },
    ],
  },
  {
    label: 'Status & Alertas',
    options: [
      { label: 'Sucesso (Check)', value: 'check-circle' },
      { label: 'Alerta (Triangle)', value: 'exclamation-triangle' },
      { label: 'Erro (Times)', value: 'times-circle' },
      { label: 'Informação (Info)', value: 'info-circle' },
      { label: 'Sino (Bell)', value: 'bell' },
    ],
  },
  {
    label: 'Componentes',
    options: [
      { label: 'Cubo (Cube)', value: 'cube' },
      { label: 'Camadas (Layer Group)', value: 'layer-group' },
      { label: 'Rede (Sitemap)', value: 'sitemap' },
      { label: 'Disco (HDD)', value: 'hdd' },
    ],
  },
];

export const plugin = new PanelPlugin<SimpleOptions, CustomFieldConfig>(SimplePanel)
  .setNoPadding()
  .useFieldConfig({
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
        .addTextInput({
          path: 'label',
          name: 'Label personalizado',
          category: ['Cabeçalho'],
        })
        .addSelect({
          path: 'icon',
          name: 'Ícone da Métrica',
          category: ['Cabeçalho'],
          settings: { options: ICON_OPTIONS },
        })
        .addRadio({
          path: 'iconStyle',
          name: 'Estilo do Ícone',
          category: ['Cabeçalho'],
          settings: {
            options: [
              { value: 'contained', label: 'Contido (Fundo Escuro)' },
              { value: 'clean', label: 'Livre (Sem Fundo)' },
            ],
          },
        })
        .addRadio({
          path: 'iconFollowThreshold',
          name: 'Ícone segue cor do limite (Threshold)',
          category: ['Cabeçalho'],
          defaultValue: 'auto',
          settings: {
            options: [
              { value: 'auto', label: 'Usar global' },
              { value: true, label: 'Sim' },
              { value: false, label: 'Não' },
            ],
          },
        });
    },
  })
  .setPanelOptions((builder) => {
    builder
      .addRadio({
          path: 'viewMode',
          name: 'Modo de exibição',
          defaultValue: 'status_bar',
          category: ['Exibição'],
          settings: {
            options: [
              { value: 'status_bar', label: 'Barra de status' },
              { value: 'card', label: 'Card' },
              { value: 'macro_cards', label: 'Macro-Cards (NOC)' },
            ],
          },
        })
        .addSelect({
          path: 'defaultIcon',
          name: 'Ícone padrão',
          defaultValue: 'server',
          category: ['Exibição'],
          settings: { options: ICON_OPTIONS },
        })
        .addRadio({
          path: 'iconStyle',
          name: 'Estilo de ícone padrão',
          defaultValue: 'contained',
          category: ['Exibição'],
          settings: {
            options: [
              { value: 'contained', label: 'Contido (Fundo Escuro)' },
              { value: 'clean', label: 'Livre (Sem Fundo)' },
            ],
          },
        })
        .addTextInput({
          path: 'macroCardsLabel',
          name: 'Rótulo do Agrupamento',
          description: 'Texto exibido no fundo do painel inteiro',
          defaultValue: 'VISÃO GERAL NOC',
          category: ['Macro-Cards'],
          showIf: (o) => o.viewMode === 'macro_cards',
        })
        .addNumberInput({
          path: 'macroCardsCount',
          name: 'Quantidade de Cards Pais',
          description: 'Define quantos Cards Pais serão exibidos (1 a 4)',
          defaultValue: 1,
          category: ['Macro-Cards'],
          settings: { min: 1, max: 4, integer: true },
          showIf: (o) => o.viewMode === 'macro_cards',
        })
        .addRadio({
          path: 'parentThresholdTarget',
          name: 'Alerta no Card Pai',
          description: 'O que deve mudar de cor ao entrar em alerta?',
          category: ['Macro-Cards'],
          defaultValue: 'both',
          settings: {
            options: [
              { value: 'none', label: 'Nenhum' },
              { value: 'icon', label: 'Ícone' },
              { value: 'background', label: 'Fundo' },
              { value: 'both', label: 'Ambos' },
            ],
          },
          showIf: (o) => o.viewMode === 'macro_cards',
        })
        .addRadio({
          path: 'childThresholdTarget',
          name: 'Alerta no Card Filho',
          description: 'O que deve mudar de cor ao entrar em alerta?',
          category: ['Macro-Cards'],
          defaultValue: 'value',
          settings: {
            options: [
              { value: 'none', label: 'Nenhum' },
              { value: 'value', label: 'Valor' },
              { value: 'background', label: 'Fundo' },
              { value: 'both', label: 'Ambos' },
            ],
          },
          showIf: (o) => o.viewMode === 'macro_cards',
        })
        .addBooleanSwitch({
          path: 'iconFollowThreshold',
          name: 'Ícones seguem threshold globalmente',
          defaultValue: false,
          category: ['Exibição'],
        })
        .addBooleanSwitch({
          path: 'useThreshold',
          name: 'Card segue cor do Threshold',
          category: ['Exibição'],
          defaultValue: false,
          showIf: (o) => o.viewMode === 'card',
        })
        .addRadio({
          path: 'colorMode',
          name: 'Modo de Cor do Threshold',
          defaultValue: 'text',
          category: ['Exibição'],
          settings: {
            options: [
              { value: 'text', label: 'Apenas Texto' },
              { value: 'background', label: 'Fundo do Card' },
            ],
          },
          showIf: (o) => o.viewMode === 'card' && o.useThreshold === true,
        })
        .addBooleanSwitch({
          path: 'badgesFollowThreshold',
          name: 'Badges seguem Threshold',
          description: 'Aplica a cor do threshold aos badges (status) na Barra de status',
          category: ['Exibição'],
          defaultValue: false,
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addBooleanSwitch({
          path: 'metricsFollowThreshold',
          name: 'Métricas laterais seguem Threshold',
          description: 'Aplica a cor do threshold às 5 métricas da lateral direita na Barra de status',
          category: ['Exibição'],
          defaultValue: false,
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addColorPicker({
          path: 'defaultColor',
          name: 'Cor Padrão',
          category: ['Exibição'],
        })
        .addTextInput({
          path: 'headerTitle',
          name: 'Hostname',
          description: 'Aceita variáveis do dashboard, por exemplo: ${hostname}.',
          defaultValue: '${hostname}',
          category: ['Cabeçalho'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'headerDetailSource',
          path: 'headerDetailSource',
          name: 'Métrica abaixo do hostname',
          description: 'Selecione um campo de texto ou número para aparecer abaixo do hostname.',
          editor: MetricSelectorEditor,
          category: ['Cabeçalho'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'indicator1Source',
          path: 'indicator1Source',
          name: 'Indicador 1 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'indicator1Label',
          name: 'Indicador 1 (Rótulo)',
          defaultValue: '',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'indicator2Source',
          path: 'indicator2Source',
          name: 'Indicador 2 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'indicator2Label',
          name: 'Indicador 2 (Rótulo)',
          defaultValue: '',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'statusBarMetric1Source',
          path: 'statusBarMetric1Source',
          name: 'Métrica 1 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'statusBarMetric1Label',
          name: 'Métrica 1 (Rótulo)',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'statusBarMetric2Source',
          path: 'statusBarMetric2Source',
          name: 'Métrica 2 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'statusBarMetric2Label',
          name: 'Métrica 2 (Rótulo)',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'statusBarMetric3Source',
          path: 'statusBarMetric3Source',
          name: 'Métrica 3 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'statusBarMetric3Label',
          name: 'Métrica 3 (Rótulo)',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'statusBarMetric4Source',
          path: 'statusBarMetric4Source',
          name: 'Métrica 4 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'statusBarMetric4Label',
          name: 'Métrica 4 (Rótulo)',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addCustomEditor({
          id: 'statusBarMetric5Source',
          path: 'statusBarMetric5Source',
          name: 'Métrica 5 (Campo)',
          editor: MetricSelectorEditor,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addTextInput({
          path: 'statusBarMetric5Label',
          name: 'Métrica 5 (Rótulo)',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'status_bar',
        })
        .addBooleanSwitch({
          path: 'showIcon',
          name: 'Mostrar ícone',
          defaultValue: true,
          category: ['Exibição'],
        })
        .addBooleanSwitch({
          path: 'showLabel',
          name: 'Mostrar rótulo (nome do campo)',
          defaultValue: true,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'card',
        })
        .addBooleanSwitch({
          path: 'showValue',
          name: 'Mostrar valor',
          defaultValue: true,
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'card',
        })
        .addTextInput({
          path: 'valueFontSize',
          name: 'Tamanho da fonte do valor',
          defaultValue: '26px',
          category: ['Exibição'],
          showIf: (o) => o.viewMode === 'card',
        });

    const MAX_MACRO_CARDS = 4;
    for (let i = 1; i <= MAX_MACRO_CARDS; i++) {
      builder
        .addTextInput({
          path: `mc${i}_title`,
          name: `Card Pai ${i} - Título`,
          category: [`Card Pai ${i}`],
          showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i,
        })
        .addTextInput({
          path: `mc${i}_subtitle`,
          name: `Card Pai ${i} - Subtítulo`,
          category: [`Card Pai ${i}`],
          showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i,
        })
        .addSelect({
          path: `mc${i}_icon`,
          name: `Card Pai ${i} - Ícone Principal`,
          defaultValue: 'server',
          category: [`Card Pai ${i}`],
          settings: { options: ICON_OPTIONS },
          showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i,
        })
        .addCustomEditor({
          id: `mc${i}_statusSource`,
          path: `mc${i}_statusSource`,
          name: `Card Pai ${i} - Métrica de Status Global`,
          description: 'Métrica usada para determinar a cor do card.',
          editor: MetricSelectorEditor,
          category: [`Card Pai ${i}`],
          showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i,
        })
        .addBooleanSwitch({
          path: `mc${i}_showThirdRow`,
          name: `Mostrar 3ª linha (Métricas 6, 7 e 8)`,
          category: [`Card Pai ${i} - Métricas`],
          defaultValue: true,
          showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i,
        });

      for (let j = 1; j <= 8; j++) {
        builder
          .addTextInput({
            path: `mc${i}_child${j}_label`,
            name: `Filho ${j} - Rótulo`,
            category: [`Card Pai ${i} - Métricas`],
            showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i && (j <= 5 || o[`mc${i}_showThirdRow`] !== false),
          })
          .addCustomEditor({
            id: `mc${i}_child${j}_source`,
            path: `mc${i}_child${j}_source`,
            name: `Filho ${j} - Métrica`,
            editor: MetricSelectorEditor,
            category: [`Card Pai ${i} - Métricas`],
            showIf: (o) => o.viewMode === 'macro_cards' && (o.macroCardsCount ?? 1) >= i && (j <= 5 || o[`mc${i}_showThirdRow`] !== false),
          });
      }
    }

    return builder;
  });
