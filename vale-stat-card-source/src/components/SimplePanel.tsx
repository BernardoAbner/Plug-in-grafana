import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import {
  PanelProps,
  Field,
  FieldType,
  formattedValueToString,
  getFieldDisplayName,
  GrafanaTheme2,
  getDisplayProcessor,
} from '@grafana/data';
import {
  SimpleOptions, CardTheme,
  NativeThresholdsConfig, ThresholdStep,
} from '../types';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';
import { UplotChart } from './UplotChart';

interface Props extends PanelProps<SimpleOptions> { }

const VALID_ICONS = new Set([
  'sitemap', 'wifi', 'signal', 'exchange', 'plug', 'link', 'code-branch', 'share-alt', 'shield', 'globe', 'sync', 'rss',
  'server', 'cube', 'cubes', 'layer-group', 'database', 'hdd', 'cloud', 'desktop', 'terminal',
  'bolt', 'battery-bolt', 'battery-full', 'battery-empty', 'thermometer', 'tachometer-fast', 'heartbeat', 'sliders-v-alt', 'chart-line', 'clock-nine', 'history',
  'exclamation-triangle', 'times-circle', 'check-circle', 'bell', 'wrench', 'cog', 'lock', 'key-skeleton-alt', 'info-circle', 'filter', 'eye', 'apps'
]);

function resolveIconName(icon: string): string {
  // Trata ícones legados para os novos correspondentes
  if (icon === 'processor' || icon === 'cpu') return 'tachometer-fast';
  if (icon === 'temperature') return 'thermometer';
  if (icon === 'save') return 'hdd';
  if (icon === 'times') return 'times-circle';
  
  if (icon && VALID_ICONS.has(icon)) {
    return icon;
  }
  
  return 'server';
}

// ─── Paleta de temas ───────────────────────────────────────────────────────
export const THEME_COLORS: Record<CardTheme, { accent: string; glow: string }> = {
  vale: { accent: '#007E7A', glow: 'rgba(0, 126, 122, 0.25)' },
  teal: { accent: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.25)' },
  blue: { accent: '#38bdf8', glow: 'rgba(56, 189, 248, 0.25)' },
  purple: { accent: '#a78bfa', glow: 'rgba(167, 139, 250, 0.25)' },
  orange: { accent: '#fb923c', glow: 'rgba(251, 146, 60, 0.25)' },
  red: { accent: '#f87171', glow: 'rgba(248, 113, 113, 0.28)' },
  green: { accent: '#4ade80', glow: 'rgba(74, 222, 128, 0.25)' },
};

const SERIES_PALETTE = ['#2dd4bf', '#38bdf8', '#a78bfa', '#fb923c', '#f87171', '#4ade80'];

// ─── Formatação nativa de valores ─────────────────────────────────────────

/**
 * Formata o valor respeitando a configuração escolhida no painel.
 */
function formatFieldValue(raw: unknown, field: Field, theme: GrafanaTheme2): { text: string; color?: string } {
  // Use Grafana's display logic natively. This handles standard Options like unit, decimals, min, max, thresholds implicitly!
  const displayProcessor = field.display || getDisplayProcessor({ field, theme });
  const display = displayProcessor(raw);
  return { text: display.text + (display.suffix ? display.suffix : ''), color: display.color };
}

/** Retorna o step de threshold ativo para um valor dado um NativeThresholdsConfig. */
function getActiveNativeThreshold(
  value: number,
  cfg: NativeThresholdsConfig | null | undefined
): ThresholdStep | null {
  if (!cfg?.steps?.length) { return null; }
  const steps = [...cfg.steps].sort((a, b) => {
    const av = a.value ?? -Infinity;
    const bv = b.value ?? -Infinity;
    return av - bv;
  });
  let active = steps[0];
  for (const s of steps) {
    const sv = s.value ?? -Infinity;
    if (value >= sv) { active = s; }
  }
  return active ?? null;
}


/** Usa o threshold nativo do Grafana e preserva a configuração legada do plugin. */
function getFieldThresholds(field: Field): NativeThresholdsConfig | undefined {
  const legacy = (field.config?.custom as any)?.nativeThresholds as NativeThresholdsConfig | undefined;
  if (legacy?.steps?.some((step) => step.value !== null)) {
    return legacy;
  }
  // Grafana native thresholds have value: -Infinity for the base step. Map it to value: null.
  const native = field.config?.thresholds as any;
  if (native?.steps) {
    return {
      mode: native.mode,
      steps: native.steps.map((s: any) => ({
        value: s.value === -Infinity ? null : s.value,
        color: s.color,
      }))
    };
  }
  return undefined;
}

interface AlertDuration { value: number; color: string; durationMs: number; }

function getAlertDurations(
  values: number[], times: number[], thresholds: NativeThresholdsConfig | undefined, tStart: number, tEnd: number
): AlertDuration[] {
  if (!thresholds?.steps.some((step) => step.value !== null)) { return []; }
  const durations = new Map<number, AlertDuration>();
  values.forEach((value, index) => {
    const step = getActiveNativeThreshold(value, thresholds);
    if (!step || step.value === null) { return; }
    const from = Math.max(times[index] ?? tStart, tStart);
    const to = Math.min(times[index + 1] ?? tEnd, tEnd);
    if (to <= from) { return; }
    const current = durations.get(step.value) ?? { value: step.value, color: step.color, durationMs: 0 };
    current.durationMs += to - from;
    durations.set(step.value, current);
  });
  return [...durations.values()].sort((a, b) => a.value - b.value);
}

function humanDuration(ms: number, _unit: 'ms'): string {
  if (ms < 1000) { return `${Math.round(ms)} ms`; }
  const s = ms / 1000;
  if (s < 60) { return `${parseFloat(s.toFixed(1))} s`; }
  const m = s / 60;
  if (m < 60) { return `${Math.floor(m)}m ${Math.round(s % 60)}s`; }
  const h = m / 60;
  if (h < 24) { return `${Math.floor(h)}h ${Math.round(m % 60)}m`; }
  const d = h / 24;
  return `${Math.floor(d)}d ${Math.round(h % 24)}h`;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatTooltipTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

// ─── Estado de interação ───────────────────────────────────────────────────
interface HoverState {
  px: number;
  py: number;
  points: Array<{ name: string; value: string; color: string; rawVal?: number }>;
  ts: number;
}

export interface SeriesInfo {
  name: string;
  field: Field;
  fieldConfig: Record<string, any>;
  values: number[];
  timeValues: number[];
  color: string;
}

// ─── Estilos ───────────────────────────────────────────────────────────────
const getStyles = (theme: GrafanaTheme2, accent: string, valueFontSize: number) => {
  const baseBg = theme.isDark ? '#0c101b' : theme.colors.background.primary;
  const themeGrad = `linear-gradient(180deg, ${accent}12 0%, ${accent}02 100%)`;
  const borderColor = theme.isDark ? 'rgba(255,255,255,0.06)' : theme.colors.border.weak;
  const labelColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const valueTextColor = theme.isDark ? '#f4f6fb' : theme.colors.text.primary;
  const legendColor = theme.isDark ? 'rgba(255,255,255,0.6)' : theme.colors.text.secondary;
  const tooltipBg = theme.isDark ? 'rgba(17,24,39,0.96)' : 'rgba(255,255,255,0.97)';
  const tooltipBorder = theme.isDark ? 'rgba(255,255,255,0.12)' : theme.colors.border.weak;
  const tooltipText = theme.isDark ? '#e2e8f0' : theme.colors.text.primary;
  const tooltipSub = theme.isDark ? 'rgba(255,255,255,0.5)' : theme.colors.text.secondary;

  return {
    card: css`
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      border-radius: 12px;
      background-color: ${baseBg};
      background-image: ${themeGrad};
      border: 1px solid ${borderColor};
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};
      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%);
        pointer-events: none;
        border-radius: 11px;
        z-index: 2;
      }
    `,
    header: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1.5)} ${theme.spacing(2)} ${theme.spacing(0.5)};
      z-index: 3;
      flex-shrink: 0;
    `,
    iconWrap: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: ${accent}33;
      color: ${accent};
      flex-shrink: 0;
      svg { width: 14px; height: 14px; }
    `,
    iconClean: css`
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${accent};
      flex-shrink: 0;
      svg { width: 18px; height: 18px; }
    `,
    titleInfo: css`
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: ${theme.spacing(0.5)} ${theme.spacing(1.5)};
      flex: 1;
      min-width: 0;
    `,
    label: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${labelColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      font-weight: ${theme.typography.fontWeightMedium};
    `,
    value: css`
      font-size: ${valueFontSize}px;
      font-weight: ${theme.typography.fontWeightBold};
      color: ${valueTextColor};
      line-height: 1;
      margin-left: ${theme.spacing(1)};
      flex-shrink: 0;
      letter-spacing: -0.02em;
    `,
    periodSummary: css`
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: ${theme.spacing(0.5)} ${theme.spacing(1.5)};
      font-size: 11px;
      color: ${tooltipSub};
    `,
    periodStat: css`
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    `,
    chartWrap: css`
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      z-index: 1;
      margin-top: ${theme.spacing(0.25)};
    `,
    chartArea: css`
      position: relative;
      flex: 1;
      min-height: 0;
      user-select: none;
      -webkit-user-select: none;

      /* uPlot drag selection box — só visível quando o usuário arrasta.
         IMPORTANTE: NÃO usar border aqui! Com width:0 height:0 (estado
         inicial/repouso), uma border de 1px ainda renderiza um ponto
         visível no canto (0,0). Usar outline em vez de border resolve
         isso porque outline não afeta elementos com dimensão zero. */
      .u-select {
        background: rgba(128, 128, 128, 0.2);
        outline: 1px solid rgba(128, 128, 128, 0.4);
        outline-offset: -1px;
        position: absolute;
        pointer-events: none;
        z-index: 10;
      }

      /* Suprimir o ponto nativo do uPlot (u-cursor-pt).
         Usamos nosso próprio marker div customizado, então
         este elemento nunca deve ser visível. */
      .u-cursor-pt {
        display: none !important;
      }
    `,
    chartSvg: css`
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    `,
    legend: css`
      display: flex;
      flex-wrap: wrap;
      gap: ${theme.spacing(1.5)};
      padding: ${theme.spacing(0.5)} ${theme.spacing(2)} ${theme.spacing(1)};
      flex-shrink: 0;
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${legendColor};
    `,
    legendItem: css`
      display: inline-flex;
      align-items: center;
      gap: ${theme.spacing(0.75)};
      white-space: nowrap;
    `,
    legendDot: css`
      width: 8px; height: 8px;
      border-radius: 2px;
      flex-shrink: 0;
    `,
    tooltip: css`
      position: absolute;
      pointer-events: none;
      z-index: 100;
      background: ${tooltipBg};
      border: 1px solid ${tooltipBorder};
      border-radius: 6px;
      padding: 8px 12px;
      min-width: 140px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.35);
      backdrop-filter: blur(8px);
    `,
    tooltipTime: css`
      font-size: 11px;
      color: ${tooltipSub};
      margin-bottom: 6px;
      font-family: ${theme.typography.fontFamilyMonospace};
    `,
    tooltipRow: css`
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: ${tooltipText};
      margin-top: 3px;
    `,
    tooltipDot: css`
      width: 7px; height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    `,
    tooltipName: css`
      flex: 1;
      color: ${tooltipSub};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100px;
    `,
    tooltipVal: css`
      font-weight: 600;
      font-family: ${theme.typography.fontFamilyMonospace};
      flex-shrink: 0;
    `,
    // ─── Multi-Métrica: Grade de KPI Cards ───────────────────────────────────
    multiGrid: css`
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: ${theme.spacing(0.75)};
      padding: ${theme.spacing(1)} ${theme.spacing(1.5)} ${theme.spacing(0.5)};
      z-index: 3;
      flex-shrink: 0;
    `,
    multiCard: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      background: ${theme.isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)'};
      border: 1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)'};
      cursor: pointer;
      transition: opacity 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      &:hover {
        background: ${theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)'};
        border-color: ${theme.isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.14)'};
      }
    `,
    multiCardSelected: css`
      box-shadow: 0 0 8px ${theme.isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)'};
    `,
    multiCardLeft: css`
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    `,
    multiCardIcon: css`
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    `,
    multiCardTextCol: css`
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    `,
    multiCardLabel: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: #9CA3AF;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,
    multiCardValue: css`
      font-size: 16px;
      font-weight: 700;
      color: #FFFFFF;
      white-space: nowrap;
      flex-shrink: 0;
    `,
    multiCardSummary: css`
      font-size: 10px;
      color: #6B7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    `,
  };
};

// ─── Componente principal ──────────────────────────────────────────────────
// IMPORTANTE: todos os hooks devem ser chamados antes de qualquer early return.
// A ordem de chamada deve ser idêntica em todo render (Rules of Hooks).
export const SimplePanel: React.FC<Props> = ({
  options, data, width, height, fieldConfig, id, onChangeTimeRange,
}) => {
  const theme = useTheme2();
  const { accent } = THEME_COLORS[options.theme] ?? THEME_COLORS.vale;
  const styles = useStyles2((t) => getStyles(t, accent, options.valueFontSize ?? 26));

  // ── Refs e estado de UI ────────────────────────────────────────────────────
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(52);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [selectedSeriesIndex, setSelectedSeriesIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (headerRef.current) { setHeaderH(headerRef.current.offsetHeight); }
  }, [options.valueFontSize, options.label, options.icon, options.showIcon, options.showLabel, options.showValue, width]);

  const toggleSeries = useCallback((idx: number) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const handleCardClick = useCallback((idx: number) => {
    setSelectedSeriesIndex((prev) => (prev === idx ? null : idx));
  }, []);

  // ── Processamento de dados ─────────────────────────────────────────────────
  // (useMemo #1 — deve vir antes de qualquer return condicional)
  const { displayValue, hasMultipleSeries, allSeriesInfos, visibleSeriesInfos } = useMemo(() => {
    const infos: SeriesInfo[] = [];
    data.series.forEach((s) => {
      const timeField = s.fields.find((f) => f.type === FieldType.time);
      const timeValues: number[] = timeField
        ? Array.isArray(timeField.values)
          ? (timeField.values as number[])
          : (Array.from(timeField.values as any) as number[])
        : [];
      s.fields.filter((field) => field.type === FieldType.number).forEach((numericField) => {
        const values: number[] = Array.isArray(numericField.values)
          ? numericField.values : Array.from(numericField.values as any);
        const seriesIndex = infos.length;
        const color = numericField.config?.color?.fixedColor || SERIES_PALETTE[seriesIndex % SERIES_PALETTE.length] || accent;
        infos.push({
          name: getFieldDisplayName(numericField, s),
          field: numericField,
          fieldConfig: numericField.config as Record<string, any>,
          values, timeValues, color,
        });
      });
    });

    const visibleInfos = infos.filter((_, idx) => !hiddenSeries.has(idx));

    let displayValue: string | null = null;
    if (visibleInfos.length === 1) {
      const s = visibleInfos[0];
      const last = s.values.length ? s.values[s.values.length - 1] : null;
      if (last !== null) {
        displayValue = formatFieldValue(last, s.field, theme).text;
      }
    }
    return { displayValue, hasMultipleSeries: visibleInfos.length > 1, allSeriesInfos: infos, visibleSeriesInfos: visibleInfos };
  }, [data, accent, hiddenSeries]);

  // Use visibleSeriesInfos for chart rendering calculations
  const seriesInfos = visibleSeriesInfos;

  // ── Configuração do gráfico (depende de seriesInfos, mas é só cálculo normal) ─
  const firstField = seriesInfos[0]?.field ?? allSeriesInfos[0]?.field;
  const customCfg = (firstField?.config?.custom ?? {}) as Record<string, any>;
  const chartType = customCfg.chartType ?? 'area';
  const showGrid = customCfg.showGrid ?? false;
  const showYAxis = customCfg.showYAxis ?? false;
  const showXAxis = customCfg.showXAxis ?? false;
  const lineInterpolation = customCfg.lineInterpolation ?? 'straight';
  const linePattern = customCfg.linePattern ?? 'solid';
  const lineWidth = customCfg.lineWidth ?? 2;
  const showPoints = customCfg.showPoints ?? false;
  const pointSize = customCfg.pointSize ?? 3;
  const baseColor = customCfg.lineColor || accent;
  const effectiveAreaOpacity = (customCfg.areaOpacity ?? 35) / 100;

  let singleEffectiveColor = baseColor;
  let chartThresholdValue: number | undefined;
  let chartThresholdColor: string | undefined;

  if (visibleSeriesInfos.length === 1) {
    const s = visibleSeriesInfos[0];
    const nativeThr = getFieldThresholds(s.field);

    if (options.showThresholdLine && nativeThr?.steps && nativeThr.steps.length > 1) {
      const step = nativeThr.steps.find(st => st.value !== null);
      if (step) {
        chartThresholdValue = step.value as number;
        chartThresholdColor = step.color;
      }
    }

    if (options.useThreshold && !customCfg.lineColor) {
      const last = s.values.length ? s.values[s.values.length - 1] : null;
      if (last !== null) {
        const step = getActiveNativeThreshold(last, nativeThr);
        if (step?.color) { singleEffectiveColor = step.color; }
      }
    }
  }

  const getSeriesColor = useCallback((s: SeriesInfo) => {
    if (!options.useThreshold) return s.color;
    if (!hasMultipleSeries && visibleSeriesInfos.includes(s)) return singleEffectiveColor;
    const last = s.values.length ? s.values[s.values.length - 1] : null;
    if (last === null) return s.color;
    const thr = getFieldThresholds(s.field);
    const step = getActiveNativeThreshold(last, thr);
    return step?.color ?? s.color;
  }, [options.useThreshold, hasMultipleSeries, singleEffectiveColor, visibleSeriesInfos]);

  // ── Dimensões (cálculo normal, sem hooks) ──────────────────────────────────
  const Y_AXIS_W = showYAxis ? 52 : 0;
  const LEGEND_H = options.showLegend ? 28 : 0;
  const PAD_LEFT = 8;
  const PAD_RIGHT = 8;
  const PAD_TOP = 2;

  const periodSummaryInfos = options.showPeriodSummary ? (seriesInfos.length === 1 ? seriesInfos : (allSeriesInfos.length === 1 ? allSeriesInfos : [])) : [];
  const summaryValues = periodSummaryInfos.length > 0 ? periodSummaryInfos[0].values.filter((v) => v !== null && !isNaN(v)) : [];

  const totalHeaderH = Math.max(headerH, 40);
  const svgW = width;
  const svgH = Math.max(height - totalHeaderH - LEGEND_H - 2, 30);
  const plotX = Y_AXIS_W + PAD_LEFT;
  const plotW = Math.max(svgW - plotX - PAD_RIGHT, 10);
  const plotY = PAD_TOP;

  const tStart = data.timeRange.from.valueOf();
  const tEnd = data.timeRange.to.valueOf();

  const periodPeak = summaryValues.length ? Math.max(...summaryValues) : null;
  const periodMin = summaryValues.length ? Math.min(...summaryValues) : null;
  const periodAverage = summaryValues.length
    ? summaryValues.reduce((a, b) => a + b, 0) / summaryValues.length
    : null;

  const alertDurations = useMemo(() => {
    const customCfg = (periodSummaryInfos[0]?.field?.config?.custom ?? {}) as Record<string, any>;
    if (!customCfg.showTimeInAlert || periodSummaryInfos.length !== 1) return [];
    return getAlertDurations(
      periodSummaryInfos[0].values,
      periodSummaryInfos[0].timeValues,
      getFieldThresholds(periodSummaryInfos[0].field),
      tStart,
      tEnd
    );
  }, [periodSummaryInfos, tStart, tEnd]);

  // ── Auto min/max ────────────────────────────────────────────────────────
  const autoMin = customCfg.axisConfig?.autoMin ?? true;
  const autoMax = customCfg.axisConfig?.autoMax ?? true;
  const fallbackInfos = seriesInfos.length > 0 ? seriesInfos : allSeriesInfos;

  const { dataMinEff, dataMaxEff } = useMemo(() => {
    const allVals = fallbackInfos.flatMap((s) => s.values).filter(v => v !== null && v !== undefined && !isNaN(v));
    const rawDataMin = allVals.length ? Math.min(...allVals) : 0;
    const rawDataMax = allVals.length ? Math.max(...allVals) : 1;
    const delta = rawDataMax - rawDataMin || 1;
    
    // Add 10% vertical padding so data doesn't clip at the edges when auto is on
    const min = autoMin ? (chartType === 'bar' ? Math.min(rawDataMin, 0) : rawDataMin - (delta * 0.1)) : (customCfg.axisConfig?.min ?? 0);
    const max = autoMax ? (chartType === 'bar' ? Math.max(rawDataMax, 0) : rawDataMax + (delta * 0.1)) : (customCfg.axisConfig?.max ?? 100);
    return { dataMinEff: min, dataMaxEff: max };
  }, [fallbackInfos, autoMin, autoMax, chartType, customCfg.axisConfig]);

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />;
  }

  const tooltipStyle: React.CSSProperties = hover ? { display: 'block', left: (plotX + hover.px + 14), top: (plotY + hover.py + 10), maxWidth: 172 } : { display: 'none' };
  const axisTextColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const axisLineColor = theme.isDark ? 'rgba(255,255,255,0.08)' : theme.colors.border.weak;
  const gridLineColor = theme.isDark ? 'rgba(255,255,255,0.07)' : theme.colors.border.weak;
  const displayValueColor = options.valueFollowsThreshold && options.useThreshold && singleEffectiveColor !== baseColor ? singleEffectiveColor : undefined;

  return (
    <div className={cx(styles.card, css`width: ${width}px; height: ${height}px;`)}>
      {/* ── HEADER: Modo single-série (layout original) ── */}
      {allSeriesInfos.length <= 1 && (
        <div ref={headerRef} className={styles.header}>
          {options.showIcon !== false && (
            <div 
              className={options.iconStyle === 'clean' ? styles.iconClean : styles.iconWrap} 
              style={
                displayValueColor 
                  ? { color: displayValueColor, backgroundColor: options.iconStyle === 'clean' ? 'transparent' : `${displayValueColor}33` } 
                  : undefined
              }
            >
              <Icon name={resolveIconName(options.icon) as any} size={options.iconStyle === 'clean' ? 'lg' : 'sm'} />
            </div>
          )}
          <div className={styles.titleInfo}>
            {options.showLabel !== false && (
              <div className={styles.label} style={displayValueColor ? { color: displayValueColor } : undefined}>
                {options.label || (seriesInfos.length > 0 ? seriesInfos[0].name : '')}
              </div>
            )}
            {options.showPeriodSummary && periodSummaryInfos.length === 1 && (
              <div className={styles.periodSummary}>
                {options.showPeriodMin && periodMin !== null && <span className={styles.periodStat}>Mínimo {formatFieldValue(periodMin, periodSummaryInfos[0].field, theme).text}</span>}
                {options.showPeriodAverage && periodAverage !== null && <span className={styles.periodStat}>Média {formatFieldValue(periodAverage, periodSummaryInfos[0].field, theme).text}</span>}
                {options.showPeriodPeak && periodPeak !== null && <span className={styles.periodStat}>Pico {formatFieldValue(periodPeak, periodSummaryInfos[0].field, theme).text}</span>}
                {alertDurations.map((alert) => (
                  <span key={alert.value} className={styles.periodStat} style={{ color: alert.color }}>
                    ≥ {formatFieldValue(alert.value, periodSummaryInfos[0].field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!hasMultipleSeries && options.showValue !== false && (
            <span className={styles.value} style={displayValueColor ? { color: displayValueColor } : undefined}>
              {displayValue ?? '—'}
            </span>
          )}
        </div>
      )}

      {/* ── HEADER: Modo multi-métrica (grade de KPI Cards) ── */}
      {allSeriesInfos.length >= 2 && (
        <div ref={headerRef} className={styles.multiGrid}>
          {allSeriesInfos.map((s, idx) => {
            const isSelected = selectedSeriesIndex === idx;
            const isDimmed = selectedSeriesIndex !== null && !isSelected;
            const lastVal = s.values.length ? s.values[s.values.length - 1] : null;
            const formattedVal = lastVal !== null ? formatFieldValue(lastVal, s.field, theme).text : '—';
            const seriesColor = getSeriesColor(s);

            // Resumo do período para este card
            const validVals = s.values.filter((v) => v !== null && !isNaN(v));
            const cardMin = validVals.length ? Math.min(...validVals) : null;
            const cardAvg = validVals.length ? validVals.reduce((a, b) => a + b, 0) / validVals.length : null;
            const cardMax = validVals.length ? Math.max(...validVals) : null;

            // Montar texto de resumo compacto
            const summaryParts: string[] = [];
            if (options.showPeriodSummary) {
              if (options.showPeriodMin && cardMin !== null) {
                summaryParts.push(`Min ${formatFieldValue(cardMin, s.field, theme).text}`);
              }
              if (options.showPeriodAverage && cardAvg !== null) {
                summaryParts.push(`Méd ${formatFieldValue(cardAvg, s.field, theme).text}`);
              }
              if (options.showPeriodPeak && cardMax !== null) {
                summaryParts.push(`Max ${formatFieldValue(cardMax, s.field, theme).text}`);
              }
            }

            return (
              <div
                key={s.name}
                className={cx(styles.multiCard, isSelected && styles.multiCardSelected)}
                style={{ 
                  opacity: isDimmed ? 0.35 : 1,
                  ...(isSelected ? { borderColor: seriesColor } : {})
                }}
                onClick={() => handleCardClick(idx)}
              >
                <div className={styles.multiCardLeft}>
                  <div className={styles.multiCardIcon} style={{ color: seriesColor }}>
                    <Icon name={resolveIconName(options.icon) as any} size="lg" />
                  </div>
                  <div className={styles.multiCardTextCol}>
                    <span className={styles.multiCardLabel}>{s.name}</span>
                    {summaryParts.length > 0 && (
                      <span className={styles.multiCardSummary}>
                        {summaryParts.join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.multiCardValue}>
                  {formattedVal}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {options.showSparkline && (
        <div className={styles.chartWrap}>
          <div className={styles.chartArea}>
            <div className={styles.tooltip} style={tooltipStyle}>
              {hover && (
                <>
                  <div className={styles.tooltipTime}>{formatTooltipTime(hover.ts)}</div>
                  {hover.points.map((pt) => (
                    <div key={pt.name} className={styles.tooltipRow}>
                      <span className={styles.tooltipDot} style={{ backgroundColor: pt.color }} />
                      <span className={styles.tooltipName}>{pt.name}</span>
                      <span className={styles.tooltipVal}>{pt.value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <UplotChart
              width={plotW + PAD_LEFT + PAD_RIGHT + Y_AXIS_W}
              height={svgH}
              seriesInfos={allSeriesInfos}
              times={allSeriesInfos[0]?.timeValues || []}
              timeRange={{ from: tStart, to: tEnd }}
              chartType={chartType}
              lineInterpolation={lineInterpolation}
              linePattern={linePattern}
              lineWidth={lineWidth}
              areaOpacity={effectiveAreaOpacity}
              showPoints={showPoints}
              pointSize={pointSize}
              showGrid={showGrid}
              showYAxis={showYAxis}
              showXAxis={showXAxis}
              yLo={dataMinEff}
              yHi={dataMaxEff}
              theme={theme}
              thresholdMode={options.thresholdMode || 'line'}
              useThreshold={options.useThreshold || false}
              thresholdValue={chartThresholdValue}
              thresholdColor={chartThresholdColor}
              getSeriesColor={getSeriesColor}
              axisTextColor={axisTextColor}
              axisLineColor={axisLineColor}
              gridLineColor={gridLineColor}
              selectedSeriesIndex={selectedSeriesIndex}
              onHover={(ts, points, px, py) => {
                if (!ts || !points) {
                  setHover(null);
                } else {
                  setHover({
                    ts,
                    px,
                    py,
                    points: points.map(p => ({
                      name: p.name,
                      value: formatFieldValue(p.rawVal, allSeriesInfos.find(s => s.name === p.name)!.field, theme).text,
                      color: p.color
                    }))
                  });
                }
              }}
              onClickTimeRange={(from, to) => {
                onChangeTimeRange({ from, to });
              }}
              onDoubleClick={() => {
                // Emite range nulo para permitir reset (no Grafana, isso não recua nativamente o zoom global, 
                // mas a ação principal de Zoom do Grafana é gerida pela topbar. Aqui apenas providenciamos
                // um handler visual se for evoluído depois).
              }}
            />
          </div>

          {/* Legenda */}
          {options.showLegend && (
            <div className={styles.legend}>
              {allSeriesInfos.map((s, idx) => (
                <span
                  key={s.name}
                  className={styles.legendItem}
                  onClick={() => toggleSeries(idx)}
                  style={{ cursor: 'pointer', opacity: hiddenSeries.has(idx) ? 0.4 : 1 }}
                >
                  <span className={styles.legendDot} style={{ backgroundColor: getSeriesColor(s) }} />
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
