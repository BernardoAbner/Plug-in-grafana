// ─── Tipos de ícone ────────────────────────────────────────────────────────
// Subset dos ícones do Grafana (@grafana/ui <Icon>) verificados no registry.
// Para infraestrutura/NOC, mapeados para nomes que existem no pacote.
export type CardIcon =
  | 'cpu'
  | 'database'
  | 'server'
  | 'hdd'
  | 'server-alt'
  | 'temperature'
  | 'wifi'
  | 'bolt'
  | 'apps'
  | 'signal'
  | 'check-circle'
  | 'exclamation-triangle'
  | 'network-wired'
  | 'alert'
  | 'bell-slash'
  | 'times-circle'
  | 'heartbeat'
  | 'arrow-up'
  | 'arrow-down'
  | 'chart-line'
  | 'clock'
  | 'heart'
  | 'shield';

export type CardTheme = 'vale' | 'teal' | 'blue' | 'purple' | 'orange' | 'red' | 'green';

export type ChartType = 'line' | 'area' | 'bar' | 'points';
export type ThresholdMode = 'line' | 'schema';
export type LineInterpolation = 'straight' | 'smooth' | 'stepBefore' | 'stepAfter';
export type LinePattern = 'solid' | 'dashed';
export type BarMode = 'grouped' | 'stacked';
export type ColumnDisplayType = 'text' | 'badge' | 'progressBar' | 'colorByThreshold';
export type StatusDisplayType = 'badge' | 'progressBar' | 'segmentedBar' | 'deltaTrend';
export type LineGradient = 'none' | 'opacity' | 'fade';
export type TimeSeriesValueMode = 'badge' | 'text' | 'hidden';
export type BadgeSize = 'sm' | 'md' | 'lg';
export type BadgeVisual = 'subtle' | 'solid' | 'outline';
export type ProgressHeight = '6px' | '8px' | '12px';
export type ProgressColorMode = 'gradient' | 'threshold';
/** Cor base do rótulo: 'neutral' = cinza (igual Mín/Méd/Máx), 'accent' = cor do tema/série */
export type LabelColorMode = 'neutral' | 'accent';
/** Limite explícito de tempo sem dados antes de interromper a linha do gráfico e episódios */
export type DisconnectThresholdMode = 'auto' | '1m' | '2m' | '5m' | '15m' | '30m' | '1h' | 'never';

export interface AxisConfig {
  autoMin: boolean;
  autoMax: boolean;
  min: number;
  max: number;
}

// ─── Unidades nativas ──────────────────────────────────────────────────────
export type NativeUnit =
  | 'auto'        // usa a unidade que vem da fonte de dados (ex: Zabbix)
  | 'none'
  | 'percent'
  | 'percentunit'
  | 'ms'
  | 's'
  | 'm'
  | 'h'
  | 'd'
  | 'dtdurationms'
  | 'dtdurations'
  | 'bytes'
  | 'kbytes'
  | 'mbytes'
  | 'gbytes'
  | 'tbytes'
  | 'bits'
  | 'kbits'
  | 'mbits'
  | 'gbits'
  | 'Bps'
  | 'KBs'
  | 'MBs'
  | 'GBs'
  | 'bps'
  | 'Kbits'
  | 'Mbits'
  | 'Gbits'
  | 'ops'
  | 'reqps'
  | 'rps'
  | 'wps'
  | 'iops'
  | 'celsius'
  | 'fahrenheit'
  | 'kelvin'
  | 'hertz'
  | 'kilohertz'
  | 'megahertz'
  | 'gigahertz'
  | 'volt'
  | 'amp'
  | 'watt'
  | 'kilowatt'
  | 'kwatth'
  | 'currencyUSD'
  | 'currencyBRL'
  | 'currencyEUR'
  | 'lengthm'
  | 'lengthkm'
  | 'velocityms'
  | 'velocitykmh'
  | 'short'
  | 'number';

// ─── Thresholds nativos ────────────────────────────────────────────────────

export type ThresholdsModeNative = 'absolute' | 'percentage';
export type ThresholdComparisonMode = 'gte' | 'eq' | 'lte';
export type MetricProfile = 'state_or_binary' | 'continuous_lte' | 'continuous_gte';

export interface ThresholdStep {
  /** Valor a partir do qual este step entra em vigor.
   *  O primeiro step (base) tem value = null (equivale a -Infinity). */
  value: number | null;
  color: string;
}

export interface NativeThresholdsConfig {
  mode: ThresholdsModeNative;
  steps: ThresholdStep[];
}

// ─── Mapeamentos de valor (sistema completo) ───────────────────────────────
export type SpecialValueMatch =
  | 'null'
  | 'nan'
  | 'null+nan'
  | 'true'
  | 'false'
  | 'empty';

export interface MappingResult {
  text?: string;
  color?: string;
  index?: number;
}

/** Mapeamento de valor exato: chave = string do valor, resultado = texto + cor */
export interface ValueMapping {
  type: 'value';
  options: Record<string, MappingResult>;
}

/** Mapeamento de intervalo numérico */
export interface RangeMapping {
  type: 'range';
  options: {
    from: number | null;
    to: number | null;
    result: MappingResult;
  };
}

/** Mapeamento por expressão regular (aplicado ao valor já convertido em string) */
export interface RegexMapping {
  type: 'regex';
  options: {
    pattern: string;
    result: MappingResult;
  };
}

/** Mapeamento de valor especial (null, NaN, string vazia, booleanos) */
export interface SpecialMapping {
  type: 'special';
  options: {
    match: SpecialValueMatch;
    result: MappingResult;
  };
}

export type AnyMapping = ValueMapping | RangeMapping | RegexMapping | SpecialMapping;

export type CellDisplayMode =
  | 'auto'
  | 'text'
  | 'badge'
  | 'progressBar'
  | 'segmentedBar'
  | 'deltaTrend'
  | 'sparkline'
  | 'timeseries'
  | 'heatmap';

// ─── Pacotes Compostos de Override Properties (Aba Inteira por Modo) ───────

export interface TimeSeriesOverrideConfig {
  timeSeriesValueMode?: TimeSeriesValueMode;
  lineInterpolation?: LineInterpolation;
  lineWidth?: number;
  sparklineLineOpacity?: number;
  areaOpacity?: number;
  sparklineHeight?: number;
  lineColor?: string;
  sparklineFollowThreshold?: boolean;
  binaryStepHighlight?: boolean;
}

export interface BadgeOverrideConfig {
  badgeSize?: BadgeSize;
  badgeStyle?: BadgeVisual;
  useThresholdColors?: boolean;
}

export interface ProgressOverrideConfig {
  barType?: 'progressBar' | 'segmentedBar';
  progressMin?: number;
  progressMax?: number;
  progressHeight?: ProgressHeight;
  progressColorMode?: ProgressColorMode;
  showProgressValue?: boolean;
  colorValueByThreshold?: boolean;
  lineColor?: string;
  useThresholdColors?: boolean;
}

export interface TextOverrideConfig {
  textFontSize?: string;
  textWeight?: string;
  useThresholdColors?: boolean;
}

export type DeltaValueFormat = 'percent' | 'absolute' | 'both';

export interface DeltaOverrideConfig {
  showDeltaValue?: boolean;
  deltaTrendColorMode?: 'proximity' | 'direction' | 'threshold' | 'neutral';
  deltaProximityMargin?: number;
  deltaReferenceMode?: 'mean' | 'first' | 'prev';
  deltaValueFormat?: DeltaValueFormat;
  deltaDeadbandPct?: number;
  deltaProximityPct?: number;
  deltaComparisonDirection?: ThresholdComparisonMode;
  deltaHighlightRelief?: boolean;
  useThresholdColors?: boolean;
}

export interface AlertOverrideConfig {
  thresholdComparisonMode?: ThresholdComparisonMode;
  useThresholdColors?: boolean;
  colorIconByThreshold?: boolean;
  enableAlertPopup?: boolean;
  alertPopupDisplayMode?: 'always' | 'alertOnly';
}

export interface CustomFieldConfig {
  // Pacotes compostos de Override (Opção 1)
  timeSeriesConfig?: TimeSeriesOverrideConfig;
  badgeConfig?: BadgeOverrideConfig;
  progressConfig?: ProgressOverrideConfig;
  textConfig?: TextOverrideConfig;
  deltaConfig?: DeltaOverrideConfig;
  alertConfig?: AlertOverrideConfig;
  // Thresholds nativos
  nativeThresholds?: NativeThresholdsConfig;
  // Mapeamentos de valor (sistema completo)
  valueMappings?: AnyMapping[];
  // Modo de exibição da célula (Overrides de Coluna)
  cellDisplayMode?: CellDisplayMode;
  displayMode?: string;
  statusDisplayMode?: StatusDisplayType;
  // Propriedades gerais
  useThresholdColors?: boolean;
  thresholdComparisonMode?: ThresholdComparisonMode;
  enableAlertPopup?: boolean;
  alertPopupDisplayMode?: 'always' | 'alertOnly';
  enableColumnFilter?: boolean;
  // Propriedades de texto
  textFontSize?: string;
  textWeight?: string;
  // Propriedades de badge
  badgeSize?: BadgeSize;
  badgeStyle?: BadgeVisual;
  // Propriedades de progressBar e segmentedBar
  progressMin?: number;
  progressMax?: number;
  showProgressValue?: boolean;
  progressHeight?: ProgressHeight;
  progressColorMode?: ProgressColorMode;
  // Propriedades de deltaTrend
  showDeltaValue?: boolean;
  deltaTrendColorMode?: 'proximity' | 'direction' | 'threshold' | 'neutral';
  deltaProximityMargin?: number;
  deltaReferenceMode?: 'mean' | 'first' | 'prev';
  deltaValueFormat?: DeltaValueFormat;
  deltaDeadbandPct?: number;
  deltaProximityPct?: number;
  deltaComparisonDirection?: ThresholdComparisonMode;
  deltaHighlightRelief?: boolean;
  // Propriedades de sparkline (Time Series)
  timeSeriesValueMode?: TimeSeriesValueMode;
  sparklineFollowThreshold?: boolean;
  sparklineLineOpacity?: number;   // 10–100 (%)
  sparklineFillOpacity?: number;   // 0–100 (%)
  binaryStepHighlight?: boolean;
  lineWidth?: number;
  areaOpacity?: number;            // 0–100, convertido para 0–1 na renderização
  lineColor?: string;
  lineInterpolation?: LineInterpolation;
  chartType?: ChartType;
  linePattern?: LinePattern;
  lineGradient?: LineGradient;
  showPoints?: boolean;
  pointSize?: number;
  barWidth?: number;
  barMode?: BarMode;
  showThresholdBands?: boolean;
  disconnectThreshold?: DisconnectThresholdMode;
  showXAxis?: boolean;
  sparklineHeight?: number;
  // Específicos do cabeçalho e ícones
  icon?: string;
  label?: string;
  iconStyle?: 'contained' | 'clean';
  showIcon?: boolean;
  showLabel?: boolean;
  showCurrentValue?: boolean;
  showSummary?: boolean;
  valueFontSize?: string;
  colorIconByThreshold?: boolean;
  colorLabelByThreshold?: boolean;
  colorValueByThreshold?: boolean;
  colorSummaryByThreshold?: boolean;
  exactThresholdMatch?: boolean;
  labelColorMode?: LabelColorMode;
}

/** Opções de painel — configuradas na aba de opções do Grafana */
export interface SimpleOptions {
  // ── Modo do Painel ──
  panelMode?: 'table' | 'singleHost' | 'heatmap';

  // ── Layout e Estilo (Tabela) ──
  rowHeight?: number;
  showHeader?: boolean;
  showFilterBar?: boolean;
  enableZebra?: boolean;
  showWindowDiagnosisColumn?: boolean;
  singleHostCustomLabel?: string;
  singleHostCustomStatusText?: string;
  enableHostFilter?: boolean;

  // ── Coluna de Host e Ícones (Tabela Comum) ──
  showHostIcon?: boolean;
  hostIconName?: string;
  hostIconBgMode?: 'contained' | 'clean';
  colorHostIconByThreshold?: boolean;

  // ── Modo Tabela Host Único ──
  singleHostShowMetricIcon?: boolean;
  singleHostMetricIcon?: string;
  singleHostMetricIconBgMode?: 'contained' | 'clean';
  singleHostColorMetricIconByThreshold?: boolean;
  singleHostRowHeight?: number;
  singleHostEnableZebra?: boolean;

  // ── Modo Mapa de Calor (Ícones) ──
  heatmapShowHostIcon?: boolean;
  heatmapHostIconName?: string;
  heatmapHostIconBgMode?: 'contained' | 'clean';
  heatmapColorHostIconByThreshold?: boolean;

  // ── Mapa de Calor ──
  heatmapBuckets?: number;
  heatmapBaseColor?: string;
  heatmapHealthyColor?: string;
  showHeatmapLegend?: boolean;
  heatmapUseThresholds?: boolean;
  heatmapHostWidth?: number;
  heatmapNowWidth?: number;
  showHeatmapHeader?: boolean;
  heatmapCustomLabel?: string;
  heatmapCustomSubtitle?: string;
  heatmapHostLabel?: string;

  // ── Configurações padrão de célula (fallback) ──
  cellDisplayMode?: CellDisplayMode;
  displayMode?: string;
  statusDisplayMode?: StatusDisplayType;
  useThresholdColors?: boolean;
  thresholdComparisonMode?: ThresholdComparisonMode;
  progressColorMode?: ProgressColorMode;
  colorValueByThreshold?: boolean;
  enableAlertPopup?: boolean;
  alertPopupDisplayMode?: 'always' | 'alertOnly';
  timeSeriesValueMode?: TimeSeriesValueMode;
  sparklineFollowThreshold?: boolean;
  sparklineLineOpacity?: number;
  sparklineFillOpacity?: number;
  binaryStepHighlight?: boolean;
  disconnectThreshold?: DisconnectThresholdMode;

  // ── Campos legados mantidos para compatibilidade de schema ──
  iconStyle?: 'contained' | 'clean';
  theme?: CardTheme;
  showSparkline?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  valueFontSize?: string;
  useThreshold?: boolean;
  showThresholdLine?: boolean;
  thresholdMode?: ThresholdMode;
  exactThresholdMatch?: boolean;
  labelColorMode?: LabelColorMode;
  showIcon?: boolean;
  showLabel?: boolean;
  showCurrentValue?: boolean;
  showSummary?: boolean;
  showTimeInAlert?: boolean;
  valueFollowsThreshold?: boolean;
  showPeriodPeak?: boolean;
  showPeriodMin?: boolean;
  showPeriodAverage?: boolean;
  showHeatmapColumn?: boolean;
  [key: string]: any;
}

