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
  defaultColor?: string;

  // Sprint 3: Macro-Cards
  macroCardsCount: number;
  macroCardsLabel?: string;
  showParentHeader?: boolean;
  parentThresholdTarget?: 'none' | 'icon' | 'background' | 'both';
  childThresholdTarget?: 'none' | 'value' | 'background' | 'both';
  subMetricFontSize?: 'auto' | 'compact' | 'medium' | 'large';

  // Barra de Status - Bloco Principal (Esquerda)
  headerTitle?: string;
  headerDetailSource?: MetricSource;
  showIcon?: boolean;
  defaultIcon?: string;
  iconStyle?: 'contained' | 'clean';
  iconFollowThreshold?: boolean;
  indicator1Source?: MetricSource;
  indicator1Label?: string;
  indicator2Source?: MetricSource;
  indicator2Label?: string;
  badgesFollowThreshold?: boolean;
  statusBar_uptimeMetric?: MetricSource | string;
  statusBar_uptimeLabel?: string;

  // Barra de Status - Telemetria Secundária (Direita)
  metricsFollowThreshold?: boolean;
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

  // Compatibilidade e propriedades dinâmicas
  [key: string]: any;
}

export type SimpleOptions = DynamicCardOptions;
export type CardTheme = 'vale' | 'teal' | 'blue' | 'purple' | 'orange' | 'red' | 'green';
