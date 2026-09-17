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

// ─── Unidades nativas ──────────────────────────────────────────────────────
export type NativeUnit =
  | 'auto' // usa a unidade que vem da fonte de dados (ex: Zabbix)
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
export type SpecialValueMatch = 'null' | 'nan' | 'null+nan' | 'true' | 'false' | 'empty';

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

/** Configuração por campo — aparece na seção "Field" (defaults + overrides) do Grafana */
export interface CustomFieldConfig {
  // Formatação de valor
  unit: NativeUnit;
  customUnit?: string;
  customDecimals?: number;
  decimals: number; // -1 = automático
  // Thresholds nativos
  nativeThresholds: NativeThresholdsConfig;
  // Mapeamentos de valor (sistema completo)
  valueMappings: AnyMapping[];
  // Ícone por campo
  icon?: CardIcon;
  showIcon?: boolean;
  useThreshold?: boolean;
  colorMode?: 'text' | 'background';
}

/** Opções de painel — aparecem na seção "Panel options" da sidebar */
export interface SimpleOptions {
  displayMode?: 'cards' | 'statusBar';
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

  statusBadges?: StatusBadgeConfig[];
  /** Legacy status settings kept so existing dashboards continue to render. */
  statusSource?: MetricSource;
  statusLabel?: string;
  agentSource?: MetricSource;
  agentLabel?: string;
  metricMode?: 'auto' | 'configured';
  metrics?: MetricConfig[];
  cardLayout?: 'separate' | 'grouped';
  horizontalAlign?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  gap?: number;
  cardPadding?: number;
  borderRadius?: number;
  minCardWidth?: number;
  layoutOrientation: 'horizontal' | 'vertical';
  theme: CardTheme;
  valueFontSize: number;

  // Ícone padrão do painel (pode ser sobrescrito pelo custom config)
  icon: CardIcon;
  // Toggles de visibilidade global
  showIcon: boolean;
  showLabel: boolean;
  showValue: boolean;
}

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'center' | 'bottom';

// Compatibility types still consumed by the existing TableView component.
export type ValueAlignment = HorizontalAlign;
export type ColumnDisplayType = 'text' | 'badge' | 'progressBar' | 'colorByThreshold';

/** Stable field selector: frame identity plus occurrence for duplicate frames/fields. */
export interface MetricSource {
  refId?: string;
  frameName?: string;
  frameOccurrence: number;
  fieldName: string;
  fieldOccurrence: number;
}

export interface MetricConfig {
  id: string;
  source?: MetricSource;
  label?: string;
  showIcon?: boolean;
  icon?: CardIcon;
  horizontalAlign?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  badgeMode?: 'none' | 'text' | 'value';
  badgeText?: string;
}

export interface StatusBadgeConfig {
  id: string;
  source?: MetricSource;
  label?: string;
}
