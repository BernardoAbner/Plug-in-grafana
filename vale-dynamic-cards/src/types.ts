export type ViewMode = 'status_bar' | 'card' | 'macro_cards';

export interface MetricSource {
  refId?: string;
  frameName?: string;
  frameOccurrence: number;
  fieldName: string;
  fieldOccurrence: number;
}

export interface CustomFieldConfig {
  icon?: string;
  iconStyle?: 'contained' | 'clean';
  iconFollowThreshold?: boolean | 'auto';
  label?: string;
  [key: string]: any;
}

export interface DynamicCardOptions {
  viewMode: ViewMode;

  // Opções globais
  defaultIcon?: string;
  iconStyle?: 'contained' | 'clean';
  iconFollowThreshold?: boolean;
  defaultColor?: string;

  // Sprint 3: Macro-Cards
  macroCardsCount: number;
  macroCardsLabel?: string;
  parentThresholdTarget?: 'none' | 'icon' | 'background' | 'both';
  childThresholdTarget?: 'none' | 'value' | 'background' | 'both';

  // Opções de exibição do Card
  showIcon?: boolean;
  showLabel?: boolean;
  showValue?: boolean;
  valueFontSize?: string;

  // Barra de status
  badgesFollowThreshold?: boolean;
  metricsFollowThreshold?: boolean;
  headerTitle?: string;
  headerDetailSource?: MetricSource;
  indicator1Source?: MetricSource;
  indicator1Label?: string;
  indicator2Source?: MetricSource;
  indicator2Label?: string;
  statusBarMetric1Source?: MetricSource;
  statusBarMetric1Label?: string;
  statusBarMetric2Source?: MetricSource;
  statusBarMetric2Label?: string;
  statusBarMetric3Source?: MetricSource;
  statusBarMetric3Label?: string;
  statusBarMetric4Source?: MetricSource;
  statusBarMetric4Label?: string;
  statusBarMetric5Source?: MetricSource;
  statusBarMetric5Label?: string;

  // Permitir compilação do SimplePanel.tsx antigo durante a transição
  [key: string]: any;
}

export type SimpleOptions = DynamicCardOptions;
export type CardTheme = 'vale' | 'teal' | 'blue' | 'purple' | 'orange' | 'red' | 'green';
