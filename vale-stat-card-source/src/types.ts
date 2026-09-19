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
export type LineGradient = 'none' | 'opacity' | 'fade';

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

export interface CustomFieldConfig {
  // Thresholds nativos
  nativeThresholds: NativeThresholdsConfig;
  // Mapeamentos de valor (sistema completo)
  valueMappings: AnyMapping[];
  // Gráfico
  chartType: ChartType;
  lineColor: string;
  areaOpacity: number;            // 0–100, convertido para 0–1 na renderização
  showYAxis: boolean;
  lineInterpolation: LineInterpolation;
  linePattern: LinePattern;
  lineGradient: LineGradient;
  lineWidth: number;
  showPoints: boolean;
  pointSize: number;
  showGrid: boolean;
  showXAxis: boolean;
  barWidth: number;
  barMode: BarMode;
  showThresholdBands: boolean;
  showTimeInAlert: boolean;
}

/** Opções de painel — aparecem na seção "Panel options" da sidebar */
export interface SimpleOptions {
  label: string;
  icon: CardIcon;
  theme: CardTheme;
  showSparkline: boolean;
  showLegend: boolean;
  valueFontSize: number;
  useThreshold: boolean;
  thresholdMode: ThresholdMode;
  // Toggles de visibilidade do cabeçalho
  showIcon: boolean;
  showLabel: boolean;
  showValue: boolean;
  // Cor do valor acompanha threshold
  valueFollowsThreshold: boolean;
  showPeriodSummary: boolean;
  showPeriodPeak: boolean;
  showPeriodMin: boolean;
  showPeriodAverage: boolean;
}
