import React, { useMemo, useRef, useState, useLayoutEffect, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  PanelProps,
  Field,
  FieldType,
  FieldConfigSource,
  getFieldDisplayName,
  GrafanaTheme2,
  getDisplayProcessor,
} from '@grafana/data';
import {
  SimpleOptions, CardTheme,
  NativeThresholdsConfig, ThresholdStep, CustomFieldConfig,
} from '../types';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';
import { UplotChart, parseColorToRgba } from './UplotChart';

interface Props extends PanelProps<SimpleOptions> { }

export const HistoryAlertIcon: React.FC<{ size?: number; color?: string; style?: React.CSSProperties }> = ({
  size = 12,
  color = '#EAB839',
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
  >
    {/* Arco/círculo de histórico com seta */}
    <path
      d="M8 1.75a6.25 6.25 0 1 0 5.6 3.47"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M14.5 2.2v3.3h-3.3"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Ponto de exclamação */}
    <path
      d="M8 5.2v3.2"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <circle cx="8" cy="11.2" r="0.9" fill={color} />
  </svg>
);

function getAdaptiveTitleStyle(label: string, defaultFontSize?: string): React.CSSProperties {
  const len = (label || '').length;
  if (len <= 16) {
    return defaultFontSize ? { fontSize: defaultFontSize } : {};
  }
  if (len <= 26) {
    return {
      fontSize: '10.5px',
      letterSpacing: '0.02em',
    };
  }
  return {
    fontSize: '9.5px',
    letterSpacing: '0.01em',
  };
}

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
  vale: { accent: '#00B59B', glow: 'rgba(0, 181, 155, 0.25)' },
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
  cfg: NativeThresholdsConfig | null | undefined,
  exactMatch = false
): ThresholdStep | null {
  if (!cfg?.steps?.length) { return null; }
  const steps = [...cfg.steps].sort((a, b) => {
    const av = a.value !== null && a.value !== undefined ? Number(a.value) : -Infinity;
    const bv = b.value !== null && b.value !== undefined ? Number(b.value) : -Infinity;
    if (av === bv) return 0;
    return av - bv;
  });

  if (exactMatch) {
    const match = steps.find((s) => s.value !== null && s.value !== undefined && Math.abs(value - Number(s.value)) < 1e-6);
    return match ?? steps[0];
  }

  let active = steps[0];
  for (const s of steps) {
    const sv = s.value !== null && s.value !== undefined ? Number(s.value) : -Infinity;
    if (value >= sv) { active = s; }
  }
  return active ?? null;
}


/** Usa o threshold nativo do Grafana e preserva a configuração legada do plugin. */
function getFieldThresholds(
  field: Field,
  theme?: GrafanaTheme2,
  panelFieldConfig?: FieldConfigSource
): NativeThresholdsConfig | undefined {
  // 1. Overrides específicos do campo no panelFieldConfig (se houver)
  let overrideThresholds: any = undefined;
  if (panelFieldConfig?.overrides) {
    for (const override of panelFieldConfig.overrides) {
      const matches =
        !override.matcher ||
        (override.matcher.id === 'byName' && override.matcher.options === field.name) ||
        (override.matcher.id === 'byType' && override.matcher.options === field.type);
      if (matches) {
        const prop = override.properties.find((p) => p.id === 'thresholds');
        if (prop?.value) {
          overrideThresholds = prop.value;
          break;
        }
      }
    }
  }

  // 2. Prioriza: override > field.config.thresholds > panelFieldConfig.defaults.thresholds > (field as any).thresholds
  const native = (
    overrideThresholds ??
    field.config?.thresholds ??
    panelFieldConfig?.defaults?.thresholds ??
    (field as any)?.thresholds
  ) as any;

  if (native?.steps && native.steps.length > 0) {
    return {
      mode: native.mode,
      steps: native.steps.map((s: any) => {
        const rawColor = s.color || '';
        const color = theme ? theme.visualization.getColorByName(rawColor) : rawColor;
        const isBase = s.value === -Infinity || s.value === null || s.value === undefined || s.value === '';
        const numVal = isBase ? null : Number(s.value);
        return {
          value: isNaN(numVal as number) ? null : numVal,
          color,
        };
      })
    };
  }

  // 3. Fallback para configuração legada do plugin
  const legacy = (field.config?.custom as any)?.nativeThresholds as NativeThresholdsConfig | undefined;
  if (legacy?.steps?.some((step) => step.value !== null)) {
    return {
      ...legacy,
      steps: legacy.steps.map((s) => {
        const isBase = s.value === -Infinity || s.value === null || s.value === undefined || (s.value as any) === '';
        const numVal = isBase ? null : Number(s.value);
        return {
          ...s,
          value: isNaN(numVal as number) ? null : numVal,
          color: theme ? theme.visualization.getColorByName(s.color) : s.color,
        };
      })
    };
  }
  return undefined;
}

/**
 * Retorna a cor do threshold violado para um valor isolado (ex.: mínimo, média, pico).
 * Retorna null quando o valor está no step base (sem violação) — mantém a cor natural.
 */
function getViolationColor(
  value: number | null,
  field: Field,
  exactMatch = false,
  theme?: GrafanaTheme2,
  panelFieldConfig?: FieldConfigSource
): string | null {
  if (value === null || isNaN(value)) { return null; }
  const step = getActiveNativeThreshold(value, getFieldThresholds(field, theme, panelFieldConfig), exactMatch);
  return step && step.value !== null && step.color ? step.color : null;
}

interface AlertDuration { value: number; color: string; durationMs: number; }

function getAlertDurations(
  values: number[],
  times: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  exactMatch = false
): AlertDuration[] {
  if (!thresholds?.steps.some((step) => step.value !== null)) { return []; }
  const durations = new Map<number, AlertDuration>();
  values.forEach((value, index) => {
    const step = getActiveNativeThreshold(value, thresholds, exactMatch);
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

// ─── Lógica de Episódios de Alerta e Badge ─────────────────────────────────

export interface AlertEpisode {
  /** Valor do step de threshold violado (identifica a sessão/severidade) */
  stepValue: number;
  startTs: number;
  endTs: number;
  durationMs: number;
  /** Cor do threshold violado neste episódio */
  color: string;
  /** Estatísticas dos valores reais durante o episódio */
  avgValue: number;
  minValue: number;
  maxValue: number;
  /** true quando o episódio ainda está em andamento (último valor válido pertence a ele) */
  isActiveNow?: boolean;
  /** Campos internos para cálculo incremental */
  _sum: number;
  _count: number;
  _lastIndex: number;
}

/**
 * Varre o array de valores e agrupa violações consecutivas do mesmo threshold
 * em "episódios" (ocorrências) de alerta, contendo início, fim e duração.
 * Cada ocorrência carrega o step violado para depois ser agrupada em sessões
 * por severidade no popup.
 */
function getAlertEpisodes(
  values: number[],
  times: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  exactMatch = false
): AlertEpisode[] {
  if (!thresholds?.steps?.some((step) => step.value !== null)) { return []; }

  const episodes: AlertEpisode[] = [];
  let current: AlertEpisode | null = null;
  let lastValidIndex = -1;

  const close = () => {
    if (current) { episodes.push(current); current = null; }
  };

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    // Valor inválido/inexistente quebra a continuidade do episódio
    if (value === null || value === undefined || isNaN(value)) {
      close();
      continue;
    }
    lastValidIndex = i;

    const step = getActiveNativeThreshold(value, thresholds, exactMatch);
    if (!step || step.value === null) {
      // Retornou ao normal
      close();
      continue;
    }

    // Limitar os timestamps pelo espaço de tempo visível no gráfico
    const from = Math.max(times[i], tStart);
    const to = Math.min(times[i + 1] ?? tEnd, tEnd);
    if (to < from) { continue; }

    const cur = current as AlertEpisode | null;
    if (cur && cur.stepValue === step.value) {
      // Continua no mesmo episódio
      cur.endTs = to;
      cur.durationMs += to - from;
      cur._sum += value;
      cur._count += 1;
      cur._lastIndex = i;
      cur.avgValue = cur._sum / cur._count;
      if (value < cur.minValue) { cur.minValue = value; }
      if (value > cur.maxValue) { cur.maxValue = value; }
    } else {
      // Mudou de severidade ou começou um novo episódio
      close();
      current = {
        stepValue: step.value,
        startTs: from,
        endTs: to,
        durationMs: to - from,
        color: step.color,
        avgValue: value,
        minValue: value,
        maxValue: value,
        _sum: value,
        _count: 1,
        _lastIndex: i,
      };
    }
  }
  close();

  episodes.forEach((ep) => {
    ep.isActiveNow = ep._lastIndex === lastValidIndex;
  });

  return episodes;
}

/**
 * Resolve a cor de um Value Mapping nativo do Grafana para o valor dado.
 * Retorna undefined quando nenhum mapeamento com cor corresponde.
 */
function getMappedColor(value: number | null, field: Field | undefined, theme: GrafanaTheme2): string | undefined {
  const mappings = (field?.config?.mappings ?? []) as any[];
  if (!mappings.length) { return undefined; }
  for (const m of mappings) {
    let result: { color?: string } | undefined;
    const opts = m?.options ?? {};
    switch (m?.type) {
      case 'value':
        if (value !== null) { result = opts[String(value)]; }
        break;
      case 'range': {
        const from = opts.from ?? null;
        const to = opts.to ?? null;
        if (value !== null && (from === null || value >= from) && (to === null || value <= to)) {
          result = opts.result;
        }
        break;
      }
      case 'special': {
        const isNull = value === null || value === undefined;
        const isNan = value !== null && isNaN(value as number);
        if (
          (opts.match === 'null' && isNull) ||
          (opts.match === 'nan' && isNan) ||
          (opts.match === 'null+nan' && (isNull || isNan))
        ) {
          result = opts.result;
        }
        break;
      }
      case 'regex':
        try {
          if (value !== null && opts.pattern && new RegExp(opts.pattern).test(String(value))) {
            result = opts.result;
          }
        } catch { /* regex inválida — ignora */ }
        break;
    }
    if (result) {
      return result.color ? theme.visualization.getColorByName(result.color) : undefined;
    }
  }
  return undefined;
}

type BadgeState = 'active' | 'historical' | 'normal';

export interface BadgeInfo {
  state: BadgeState;
  /** Cor de fundo base do badge resolvida em Hexadecimal */
  color: string;
  /** Episódios de violação para renderizar volumetria no Popover */
  episodes: AlertEpisode[];
}

/**
 * Calcula o estado unificado do badge para uma série com base nos episódios processados.
 */
function getBadgeState(
  lastVal: number | null,
  allValues: number[],
  timeValues: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  _theme: GrafanaTheme2,
  activeThresholdColor?: string | null,
  exactMatch = false
): BadgeInfo {
  if (!thresholds?.steps?.some((s) => s.value !== null)) {
    return { state: 'normal', color: '', episodes: [] };
  }

  const episodes = getAlertEpisodes(allValues, timeValues, thresholds, tStart, tEnd, exactMatch);

  // Estado A — isCurrentlyActive: O valor atual (lastVal) viola o threshold agora
  if (lastVal !== null) {
    const currentStep = getActiveNativeThreshold(lastVal, thresholds, exactMatch);
    if (currentStep && currentStep.value !== null) {
      // Herda exatamente a mesma cor do threshold ativo no momento
      const color = activeThresholdColor || currentStep.color || '#E24D42';
      return { state: 'active', color, episodes };
    }
  }

  // Estado B — wasActiveInWindow: O valor atual normalizou, mas houve episódios passados na janela
  if (episodes.length > 0) {
    // Cor exclusiva de histórico: âmbar suave
    return { state: 'historical', color: '#EAB839', episodes };
  }

  return { state: 'normal', color: '', episodes: [] };
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
const getStyles = (theme: GrafanaTheme2, _accent: string, valueFontSize: string | number) => {
  const baseBg = theme.isDark ? '#0c141d' : theme.colors.background.primary;
  const cardGradient = theme.isDark
    ? 'linear-gradient(180deg, #0e1922 0%, #0c141d 50%, #0b111a 85%, #111217 100%)'
    : 'none';
  const borderColor = theme.isDark ? 'rgba(255,255,255,0.06)' : theme.colors.border.weak;
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
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};
    `,
    header: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1.5)} ${theme.spacing(2)} ${theme.spacing(0.5)} ${theme.spacing(2)};
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
      flex-shrink: 0;
      svg { width: 14px; height: 14px; }
    `,
    iconClean: css`
      display: flex;
      align-items: center;
      justify-content: center;
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
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
    `,
    label: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      font-weight: ${theme.typography.fontWeightMedium};
    `,
    value: css`
      font-size: ${typeof valueFontSize === 'number' ? valueFontSize + 'px' : valueFontSize};
      font-weight: ${theme.typography.fontWeightBold};
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
      z-index: 4;
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
      z-index: 200;
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
      padding: ${theme.spacing(1)} ${theme.spacing(2)} ${theme.spacing(0.5)} ${theme.spacing(2)};
      z-index: 3;
      flex-shrink: 0;
    `,
    multiCard: css`
      position: relative;
      overflow: hidden;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: none;
      cursor: pointer;
      transition: opacity 0.2s ease, border-color 0.2s ease, background 0.2s ease;
      &:hover {
        border-color: rgba(255, 255, 255, 0.16);
      }
    `,
    multiCardSelected: css`
      border: 1px solid var(--card-color) !important;
      box-shadow: none !important;
    `,
    multiCardLeft: css`
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
      flex: 1;
    `,
    multiCardIcon: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 6px;
      flex-shrink: 0;
      svg { width: 14px; height: 14px; }
    `,
    multiCardIconClean: css`
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      svg { width: 18px; height: 18px; }
    `,
    multiCardTextCol: css`
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
      flex: 1;
    `,
    multiCardLabel: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    `,
    multiCardValue: css`
      font-size: 18px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
      max-width: 90px;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-right: 4px;
    `,
    multiCardSummary: css`
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    `,
    // ─── Alert Badge (glassmorphism) ──────────────────────────────────────────
    // Cor de fundo/borda/texto aplicadas via inline style (varía por série).
    alertBadge: css`
      position: absolute;
      top: -7px;
      right: -7px;
      width: 16px;
      height: 16px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      font-size: 9px;
      font-weight: 800;
      line-height: 1;
      cursor: default;
      flex-shrink: 0;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      transition: transform 0.15s ease;
      &:hover {
        transform: scale(1.15);
      }
    `,
  };
};

// ─── Controlled Popover (Badge Component) ──────────────────────────────────
function formatTimeDisplay(ts: number, showDate = false): string {
  const d = new Date(ts);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  if (showDate) {
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${time}`;
  }
  return time;
}
const formatShortTime = formatTimeDisplay;

/**
 * Portal do popup: renderiza diretamente em document.body via createPortal,
 * escapando do overflow:hidden do painel Grafana. A posição é calculada
 * com getBoundingClientRect() do botão de trigger.
 */
const AlertPopupPortal: React.FC<{
  badge: BadgeInfo;
  tStart: number;
  tEnd: number;
  triggerRect: DOMRect;
  isPinned: boolean;
  onClose: () => void;
  formatValue: (v: number) => string;
  exactMatch?: boolean;
  field: Field;
  theme: GrafanaTheme2;
  fieldConfig?: FieldConfigSource;
}> = ({ badge, tStart, tEnd, triggerRect, isPinned, onClose, formatValue, exactMatch = false, field, theme, fieldConfig }) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, opacity: 0 });

  const totalMs = badge.episodes.reduce((acc, ep) => acc + ep.durationMs, 0);

  // Calcular posição real na tela após montar (para saber largura/altura real do popup)
  useEffect(() => {
    if (!popupRef.current) return;
    const popup = popupRef.current;
    const popupW = popup.offsetWidth;
    const popupH = popup.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Preferência: aparecer ACIMA e alinhado à direita do botão
    let top = triggerRect.top - popupH - 8;
    let left = triggerRect.right - popupW;

    // Se cortar no topo, aparecer abaixo
    if (top < 8) {
      top = triggerRect.bottom + 8;
    }
    // Se cortar na direita, alinhar à esquerda do botão
    if (left + popupW > vw - 8) {
      left = vw - popupW - 8;
    }
    // Se cortar na esquerda, travar na borda
    if (left < 8) {
      left = 8;
    }
    // Se cortar embaixo, subir
    if (top + popupH > vh - 8) {
      top = vh - popupH - 8;
    }

    setPos({ top, left, opacity: 1 });
  }, [triggerRect]);

  // Fechar com Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Thresholds dinâmicos atuais do campo para manter as cores do popup 100% atualizadas
  const liveThresholds = getFieldThresholds(field, theme, fieldConfig);

  // ── Agrupamento em sessões por severidade ────────────────────────────────
  // Cada sessão = um step de threshold. Dentro dela, as ocorrências individuais
  // ordenadas com o evento "em andamento" no topo, seguido pelas mais recentes.
  interface AlertSection {
    stepValue: number;
    color: string;
    episodes: AlertEpisode[];
    isActiveNow: boolean;
    totalMs: number;
  }
  const sectionMap = new Map<number, AlertSection>();
  badge.episodes.forEach((ep) => {
    const numStepVal = Number(ep.stepValue);
    // Resolução dinâmica de cor do threshold para esta severidade
    const matchingStep = liveThresholds?.steps.find(
      (s) => s.value !== null && s.value !== undefined && Math.abs(Number(s.value) - numStepVal) < 1e-6
    );
    const resolvedColor = matchingStep?.color || ep.color || badge.color;

    let sec = sectionMap.get(numStepVal);
    if (!sec) {
      sec = { stepValue: numStepVal, color: resolvedColor, episodes: [], isActiveNow: false, totalMs: 0 };
      sectionMap.set(numStepVal, sec);
    } else {
      sec.color = resolvedColor;
    }
    ep.color = resolvedColor;
    sec.episodes.push(ep);
    sec.totalMs += ep.durationMs;
    if (ep.isActiveNow) { sec.isActiveNow = true; }
  });

  const sections = [...sectionMap.values()].sort((a, b) => {
    if (a.isActiveNow !== b.isActiveNow) { return a.isActiveNow ? -1 : 1; }
    return b.stepValue - a.stepValue;
  });

  // Ocorrência ativa em andamento (isActiveNow) SEMPRE primeiro; as demais em ordem decrescente (mais recente primeiro)
  sections.forEach((s) =>
    s.episodes.sort((a, b) => {
      if (a.isActiveNow !== b.isActiveNow) {
        return a.isActiveNow ? -1 : 1;
      }
      return b.startTs - a.startTs;
    })
  );

  const spansDays = new Date(tStart).toDateString() !== new Date(tEnd).toDateString();

  const statCell = (label: string, value: string, extra: React.CSSProperties = {}, valueStyle: React.CSSProperties = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...extra }}>
      <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 11, ...valueStyle }}>{value}</span>
    </div>
  );

  const renderOccurrence = (ep: AlertEpisode, idx: number, isLast: boolean, color: string) => (
    <div
      key={`${ep.stepValue}-${ep.startTs}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 3,
        paddingBottom: isLast ? 0 : 8, marginBottom: isLast ? 0 : 8,
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, opacity: 0.8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Caso {idx + 1}
          </span>
        </div>
        {ep.isActiveNow ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color,
              backgroundColor: parseColorToRgba(color, 0.15),
              border: `1px solid ${parseColorToRgba(color, 0.35)}`,
              padding: '1px 5px',
              borderRadius: 3,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            ● Em andamento
          </span>
        ) : (
          <span
            style={{
              fontSize: 9,
              opacity: 0.6,
              backgroundColor: 'rgba(255,255,255,0.05)',
              padding: '1px 5px',
              borderRadius: 3,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Encerrado
          </span>
        )}
      </div>
      <div><strong>Início:</strong> {formatTimeDisplay(ep.startTs, spansDays)}</div>
      <div>
        <strong>Encerramento:</strong>{' '}
        {ep.isActiveNow ? (
          <span style={{ color, fontWeight: 700 }}>Em andamento (ativo agora)</span>
        ) : (
          <span style={{ fontWeight: 600 }}>{formatTimeDisplay(ep.endTs, spansDays)}</span>
        )}
      </div>
      <div><strong>Duração:</strong> {humanDuration(ep.durationMs, 'ms')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 3, padding: '5px 6px', borderRadius: 5, background: 'rgba(255,255,255,0.04)' }}>
        {statCell('Pico', formatValue(ep.maxValue), {}, { fontWeight: 700, color })}
        {statCell('Média', formatValue(ep.avgValue), { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' })}
        {statCell('Mínimo', formatValue(ep.minValue), {}, { opacity: 0.8 })}
      </div>
    </div>
  );

  const renderSection = (sec: AlertSection) => (
    <div
      key={sec.stepValue}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '8px 10px',
        borderRadius: 6,
        background: sec.isActiveNow ? parseColorToRgba(sec.color, 0.08) : 'rgba(255,255,255,0.025)',
        border: `1px solid color-mix(in srgb, ${sec.color} ${sec.isActiveNow ? 45 : 25}%, rgba(255,255,255,0.06))`,
        borderLeft: `4px solid ${sec.color}`,
      }}
    >
      {/* Cabeçalho da sessão */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 11, color: sec.color, whiteSpace: 'nowrap' }}>
            Threshold {exactMatch ? '=' : '≥'} {formatValue(sec.stepValue)}
          </span>
          <span style={{ fontSize: 10, opacity: 0.6, whiteSpace: 'nowrap' }}>
            {sec.episodes.length} {sec.episodes.length === 1 ? 'ocorrência' : 'ocorrências'} · {humanDuration(sec.totalMs, 'ms')}
          </span>
        </div>
        {sec.isActiveNow ? (
          <span
            style={{
              fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: sec.color,
              background: parseColorToRgba(sec.color, 0.18),
              border: `1px solid ${parseColorToRgba(sec.color, 0.4)}`,
              padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
            }}
          >
            Ativo agora
          </span>
        ) : (
          <span style={{ fontSize: 9, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
            Registrado
          </span>
        )}
      </div>
      {/* Ocorrências detalhadas */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sec.episodes.map((ep, i) => renderOccurrence(ep, i, i === sec.episodes.length - 1, sec.color))}
      </div>
    </div>
  );

  let content: React.ReactNode = null;

  if (badge.episodes.length > 0) {
    const totalWeightedSum = badge.episodes.reduce((acc, ep) => acc + ep.avgValue * ep.durationMs, 0);
    const overallAvg = totalMs > 0 ? totalWeightedSum / totalMs : 0;
    const peakEpisode = badge.episodes.reduce((prev, curr) => (curr.maxValue > prev.maxValue ? curr : prev), badge.episodes[0]);
    const overallMax = peakEpisode.maxValue;
    const overallMin = Math.min(...badge.episodes.map((ep) => ep.minValue));
    const peakColor = peakEpisode.color || badge.color;
    const showOverall = badge.episodes.length > 1;
    const headerColor = badge.state === 'active'
      ? (sections.find((s) => s.isActiveNow)?.color || badge.color)
      : '#EAB839';

    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ color: headerColor, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          {badge.state === 'active' ? (
            <Icon name="exclamation-triangle" size="sm" style={{ color: headerColor, flexShrink: 0 }} />
          ) : (
            <HistoryAlertIcon size={15} color={headerColor} />
          )}
          {badge.state === 'active'
            ? (sections.length > 1 ? 'Thresholds excedidos' : 'Threshold excedido')
            : 'Excursão registrada na janela (Normalizado)'}
        </div>
        {showOverall && (
          <div style={{ opacity: 0.6, fontSize: 11 }}>
            Janela de amostra do gráfico: {formatShortTime(tStart, spansDays)} – {formatShortTime(tEnd, spansDays)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sections.map(renderSection)}
        </div>
        {showOverall && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>Total em alerta: {humanDuration(totalMs, 'ms')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
              {statCell('Pico geral', formatValue(overallMax), {}, { fontWeight: 700, color: peakColor })}
              {statCell('Média geral', formatValue(overallAvg), { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' })}
              {statCell('Mín. geral', formatValue(overallMin), {}, { opacity: 0.8 })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const containerGlowColor = badge.state === 'active'
    ? (sections.find((s) => s.isActiveNow)?.color || badge.color)
    : '#EAB839';

  return createPortal(
    <div
      ref={popupRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        opacity: pos.opacity,
        transition: 'opacity 0.15s ease',
        zIndex: 99999,
        minWidth: 250,
        maxWidth: 400,
        backgroundColor: 'rgba(11, 16, 21, 0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '8px',
        border: `1px solid color-mix(in srgb, ${containerGlowColor} 30%, rgba(255,255,255,0.08))`,
        boxShadow: `0 12px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), 0 0 20px color-mix(in srgb, ${containerGlowColor} 12%, transparent)`,
        padding: '14px 14px 12px',
        color: '#e2e8f0',
        fontSize: '12px',
        maxHeight: 320,
        overflowY: 'auto',
        lineHeight: 1.5,
        pointerEvents: 'all',
      }}
    >
      {/* Botão X — visível apenas quando pinado */}
      {isPinned && (
        <div
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Fechar (Esc)"
          style={{
            position: 'absolute', top: 8, right: 8,
            cursor: 'pointer',
            width: 20, height: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.07)',
            opacity: 0.7,
            transition: 'opacity 0.15s, background-color 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.15)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.07)'; }}
        >
          <Icon name="times" size="sm" />
        </div>
      )}
      {content}
    </div>,
    document.body
  );
};

const AlertBadgePopover: React.FC<{
  badge: BadgeInfo;
  tStart: number;
  tEnd: number;
  styles: any;
  field: Field;
  exactMatch?: boolean;
  fieldConfig?: FieldConfigSource;
}> = ({ badge, tStart, tEnd, field, exactMatch, fieldConfig }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const theme = useTheme2();
  const formatValue = useCallback((v: number) => formatFieldValue(v, field, theme).text, [field, theme]);

  const handleClose = useCallback(() => {
    setIsPinned(false);
    setIsHovered(false);
  }, []);

  if (badge.state === 'normal') return null;

  const isOpen = isHovered || isPinned;

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (!isPinned) setIsHovered(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    if (isPinned) {
      setIsPinned(false);
      setIsHovered(false);
    } else {
      setIsPinned(true);
    }
  };

  const isHistory = badge.state === 'historical';
  const liveThresholds = getFieldThresholds(field, theme, fieldConfig);
  const activeEpisode = badge.episodes.find((e) => e.isActiveNow);
  const activeStep = (badge.state === 'active' && activeEpisode)
    ? (liveThresholds?.steps.find((s) => s.value !== null && Math.abs(Number(s.value) - Number(activeEpisode.stepValue)) < 1e-6)
       || getActiveNativeThreshold(activeEpisode.maxValue, liveThresholds, exactMatch))
    : null;
  const resolvedColor = activeStep?.color || badge.color;
  const badgeColor = isHistory ? '#EAB839' : resolvedColor;
  const bgAlpha = isPinned ? (isHistory ? 0.18 : 0.28) : (isHistory ? 0.08 : 0.16);
  const borderAlpha = isPinned ? 0.75 : 0.55;

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: 10 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Botão de alerta (Estado A) ou Histórico de Excursão (Estado B) */}
      <div
        ref={triggerRef}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'bold', fontSize: 13,
          color: badgeColor,
          backgroundColor: parseColorToRgba(badgeColor, bgAlpha),
          border: isHistory
            ? `1px dashed ${parseColorToRgba(badgeColor, borderAlpha)}`
            : `1px solid ${parseColorToRgba(badgeColor, borderAlpha)}`,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
          boxShadow: isPinned
            ? `0 0 10px ${parseColorToRgba(badgeColor, 0.4)}`
            : `0 0 6px ${parseColorToRgba(badgeColor, 0.25)}`,
          transform: isPinned ? 'scale(1.1)' : 'scale(1)',
        }}
        onClick={handleClick}
        title={
          isHistory
            ? (isPinned ? 'Clique para fechar' : 'Excursão registrada na janela — clique para detalhes')
            : (isPinned ? 'Clique para fechar' : 'Threshold ativo neste momento — clique para detalhes')
        }
      >
        {isHistory ? <HistoryAlertIcon size={12} color="#EAB839" /> : '!'}
      </div>

      {/* Portal: renderizado fora do DOM do painel, direto no body */}
      {isOpen && triggerRect && (
        <AlertPopupPortal
          badge={badge}
          tStart={tStart}
          tEnd={tEnd}
          triggerRect={triggerRect}
          isPinned={isPinned}
          onClose={handleClose}
          formatValue={formatValue}
          exactMatch={exactMatch}
          field={field}
          theme={theme}
          fieldConfig={fieldConfig}
        />
      )}
    </div>
  );
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
  const [pinnedHover, setPinnedHover] = useState<HoverState | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [selectedSeriesIndex, setSelectedSeriesIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (headerRef.current) { setHeaderH(headerRef.current.offsetHeight); }
  }, [options.valueFontSize, options.showIcon, options.showLabel, options.showCurrentValue, width]);

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
  const { displayValue, displayValueColor, hasMultipleSeries, allSeriesInfos, visibleSeriesInfos } = useMemo(() => {
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
    let displayValueColor: string | undefined = undefined;
    if (visibleInfos.length === 1) {
      const s = visibleInfos[0];
      // Escaneia de trás pra frente para encontrar o último valor válido conhecido,
      // evitando mostrar "—" quando os dados mais recentes são nulos.
      let last: number | null = null;
      for (let i = s.values.length - 1; i >= 0; i--) {
        const v = s.values[i];
        if (v !== null && v !== undefined && !isNaN(v as number)) {
          last = v as number;
          break;
        }
      }
      if (last !== null) {
        const formatted = formatFieldValue(last, s.field, theme);
        displayValue = formatted.text;
        displayValueColor = getMappedColor(last, s.field, theme);
      }
    }
    return {
      displayValue,
      displayValueColor,
      hasMultipleSeries: visibleInfos.length > 1,
      allSeriesInfos: infos,
      visibleSeriesInfos: visibleInfos,
    };
  }, [data, accent, hiddenSeries, theme]);

  // Use visibleSeriesInfos for chart rendering calculations
  const seriesInfos = visibleSeriesInfos;

  // Séries ativas para exibição gráfica e cálculo de eixos/thresholds
  const activeChartSeries = useMemo(() => {
    if (selectedSeriesIndex !== null && allSeriesInfos[selectedSeriesIndex]) {
      return [allSeriesInfos[selectedSeriesIndex]];
    }
    return visibleSeriesInfos;
  }, [selectedSeriesIndex, allSeriesInfos, visibleSeriesInfos]);

  // ── Configuração do gráfico (depende de seriesInfos, mas é só cálculo normal) ─
  const firstField = seriesInfos[0]?.field ?? allSeriesInfos[0]?.field;
  const customCfg = (firstField?.config?.custom ?? {}) as Record<string, any>;
  const chartType = customCfg.chartType ?? 'area';
  const showGrid = options.showGrid ?? false;
  const showYAxis = options.showYAxis ?? false;
  const showXAxis = options.showXAxis ?? false;
  const lineInterpolation = customCfg.lineInterpolation ?? 'straight';
  const linePattern = customCfg.linePattern ?? 'solid';
  const lineWidth = customCfg.lineWidth ?? 2;
  const showPoints = customCfg.showPoints ?? false;
  const pointSize = customCfg.pointSize ?? 3;
  
  // Use the color of the first visible series, which includes native fixedColor overrides
  const firstSeriesColor = visibleSeriesInfos.length > 0 ? visibleSeriesInfos[0].color : accent;
  const baseColor = customCfg.lineColor || firstSeriesColor;
  
  const effectiveAreaOpacity = (customCfg.areaOpacity ?? 35) / 100;

  // Linhas de threshold calculadas APENAS a partir das séries ativas/selecionadas
  const thresholdLines: Array<{ value: number; color: string }> = useMemo(() => {
    if (!options.showThresholdLine) return [];
    const lines: Array<{ value: number; color: string }> = [];
    activeChartSeries.forEach((s) => {
      const nativeThr = getFieldThresholds(s.field, theme, fieldConfig);
      if (nativeThr?.steps && nativeThr.steps.length > 1) {
        nativeThr.steps.forEach((st) => {
          if (st.value !== null && typeof st.value === 'number') {
            if (!lines.some((l) => l.value === st.value && l.color === st.color)) {
              lines.push({ value: st.value, color: st.color });
            }
          }
        });
      }
    });
    return lines;
  }, [options.showThresholdLine, activeChartSeries, theme, fieldConfig]);

  // Cor da linha segue a mesma regra de ícone/rótulo/métrica:
  //   1) threshold violado (respeitando "valor exato") → cor do threshold
  //   2) Value Mapping com cor para o valor atual → cor do mapeamento
  //   3) modo exato → cor da série; modo ≥ → cor do step base (comportamento anterior)
  const resolveLineColor = useCallback((s: SeriesInfo, fallback: string): string => {
    let last: number | null = null;
    for (let i = s.values.length - 1; i >= 0; i--) {
      const v = s.values[i];
      if (v !== null && v !== undefined && !isNaN(v as number)) { last = v as number; break; }
    }
    if (last === null) { return fallback; }
    const isExact = (s.field.config.custom as CustomFieldConfig)?.exactThresholdMatch ?? options.exactThresholdMatch ?? false;
    const step = getActiveNativeThreshold(last, getFieldThresholds(s.field, theme, fieldConfig), isExact);
    if (step && step.value !== null && step.color) { return step.color; }
    const mapped = getMappedColor(last, s.field, theme);
    if (mapped) { return mapped; }
    if (isExact) { return fallback; }
    return step?.color ?? fallback;
  }, [options.exactThresholdMatch, theme, fieldConfig]);

  let singleEffectiveColor = baseColor;
  if (visibleSeriesInfos.length === 1 && options.useThreshold && !customCfg.lineColor) {
    singleEffectiveColor = resolveLineColor(visibleSeriesInfos[0], baseColor);
  }

  const getSeriesColor = useCallback((s: SeriesInfo) => {
    if (!options.useThreshold) return s.color;
    if (!hasMultipleSeries && visibleSeriesInfos.includes(s)) return singleEffectiveColor;
    return resolveLineColor(s, s.color);
  }, [options.useThreshold, hasMultipleSeries, singleEffectiveColor, visibleSeriesInfos, resolveLineColor]);

  // ── Dimensões (cálculo normal, sem hooks) ──────────────────────────────────
  const Y_AXIS_W = showYAxis ? 52 : 0;
  const LEGEND_H = options.showLegend ? 28 : 0;
  const PAD_LEFT = 8;
  const PAD_RIGHT = 8;
  const PAD_TOP = 2;

  const periodSummaryInfos = options.showSummary ? (seriesInfos.length === 1 ? seriesInfos : (allSeriesInfos.length === 1 ? allSeriesInfos : [])) : [];
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
    if (!options.showTimeInAlert || periodSummaryInfos.length !== 1) return [];
    const isExact = (periodSummaryInfos[0].field.config.custom as CustomFieldConfig)?.exactThresholdMatch ?? options.exactThresholdMatch ?? false;
    return getAlertDurations(
      periodSummaryInfos[0].values,
      periodSummaryInfos[0].timeValues,
      getFieldThresholds(periodSummaryInfos[0].field, theme),
      tStart,
      tEnd,
      isExact
    );
  }, [options.showTimeInAlert, options.exactThresholdMatch, periodSummaryInfos, tStart, tEnd, theme]);

  // ── Auto min/max com cálculo dinâmico sobre séries ativas/selecionadas ─────
  const autoMin = customCfg.axisConfig?.autoMin ?? true;
  const autoMax = customCfg.axisConfig?.autoMax ?? true;

  const { dataMinEff, dataMaxEff } = useMemo(() => {
    const allVals = activeChartSeries
      .flatMap((s) => s.values)
      .filter((v) => v !== null && v !== undefined && !isNaN(v));

    const rawDataMin = allVals.length ? Math.min(...allVals) : 0;
    const rawDataMax = allVals.length ? Math.max(...allVals) : 1;

    const fieldMin = activeChartSeries.map((s) => s.field.config?.min).find((v) => v !== undefined && v !== null);
    const fieldMax = activeChartSeries.map((s) => s.field.config?.max).find((v) => v !== undefined && v !== null);

    // Verificar se há thresholds das séries ativas/selecionadas próximos da faixa de dados
    // (ex: até 3x o valor máximo da série), garantindo ampliação de curvas pequenas
    const relevantThresholdVals: number[] = [];
    activeChartSeries.forEach((s) => {
      const thr = getFieldThresholds(s.field, theme);
      if (thr?.steps) {
        thr.steps.forEach((st) => {
          if (st.value !== null && typeof st.value === 'number') {
            if (rawDataMax > 0) {
              if (st.value <= rawDataMax * 3 && st.value >= rawDataMin) {
                relevantThresholdVals.push(st.value);
              }
            } else if (rawDataMax === 0) {
              if (st.value > 0 && st.value <= 10) {
                relevantThresholdVals.push(st.value);
              }
            } else {
              if (st.value <= Math.abs(rawDataMax) * 3) {
                relevantThresholdVals.push(st.value);
              }
            }
          }
        });
      }
    });

    const peakVal = relevantThresholdVals.length > 0
      ? Math.max(rawDataMax, ...relevantThresholdVals)
      : rawDataMax;

    // Detecção de métricas booleanas / status / ICMP ping (valores entre 0 e 1)
    const isBinaryOrStatus = rawDataMin >= 0 && rawDataMax <= 1;

    let min: number;
    if (!autoMin && customCfg.axisConfig?.min !== undefined) {
      min = customCfg.axisConfig.min;
    } else if (fieldMin !== undefined) {
      min = fieldMin;
    } else if (isBinaryOrStatus) {
      // Para métricas 0/1 (como ICMP Ping up/down), 0 fica rente à base com respiro de ~5%
      min = -0.05;
    } else {
      const delta = (peakVal - rawDataMin) || (peakVal !== 0 ? Math.abs(peakVal) * 0.12 : 1);
      min = chartType === 'bar' ? Math.min(rawDataMin, 0) : rawDataMin - (delta * 0.08);
    }

    let max: number;
    if (!autoMax && customCfg.axisConfig?.max !== undefined) {
      max = customCfg.axisConfig.max;
    } else if (fieldMax !== undefined) {
      max = fieldMax;
    } else if (isBinaryOrStatus) {
      // 1 fica próximo do topo com respiro de ~5%
      max = peakVal > 1 ? peakVal * 1.05 : 1.05;
    } else {
      const delta = (peakVal - rawDataMin) || (peakVal !== 0 ? Math.abs(peakVal) * 0.12 : 1);
      max = chartType === 'bar' ? Math.max(peakVal, 0) + (delta * 0.12) : peakVal + (delta * 0.12);
    }

    return { dataMinEff: min, dataMaxEff: max > min ? max : min + 1 };
  }, [activeChartSeries, autoMin, autoMax, chartType, customCfg.axisConfig, theme]);

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />;
  }

  // --- Resolução de Configurações Cascata (Single Serie) ---
  let singleIcon = 'server';
  let singleLabel = '';
  let singleIconStyle = options.iconStyle ?? 'contained';
  let singleShowIcon = options.showIcon ?? true;
  let singleShowLabel = options.showLabel ?? true;
  let singleShowValue = options.showCurrentValue ?? true;
  let singleShowSummary = options.showSummary ?? true;

  // Novos Toggles Independentes
  let colorIconByThreshold = false;
  let colorLabelByThreshold = false;
  let colorValueByThreshold = false;
  let colorSummaryByThreshold = false;

  if (allSeriesInfos.length <= 1) {
    const s = allSeriesInfos[0];
    if (s) {
      const custom = (s.field.config.custom as CustomFieldConfig) || {};
      singleIcon = custom.icon || 'server';
      singleLabel = custom.label || s.name;
      singleIconStyle = custom.iconStyle ?? options.iconStyle ?? 'contained';
      singleShowIcon = custom.showIcon ?? options.showIcon ?? true;
      singleShowLabel = custom.showLabel ?? options.showLabel ?? true;
      singleShowValue = custom.showCurrentValue ?? options.showCurrentValue ?? true;
      singleShowSummary = custom.showSummary ?? options.showSummary ?? true;

      colorIconByThreshold = custom.colorIconByThreshold ?? false;
      colorLabelByThreshold = custom.colorLabelByThreshold ?? false;
      colorValueByThreshold = custom.colorValueByThreshold ?? false;
      colorSummaryByThreshold = custom.colorSummaryByThreshold ?? false;
    }
  }

  // Tooltip smart positioning: mantém dentro dos limites do chartArea.
  // - Se o cursor está no terço inferior do gráfico, o tooltip aparece ACIMA do cursor
  //   (evita cobrir o eixo X e vazar para baixo do chart).
  // - O top é clampado a um mínimo de 4px para nunca vazar para cima (e ser coberto pelos KPI cards).
  const TOOLTIP_EST_HEIGHT = 90; // altura estimada do tooltip (px)
  const XAXIS_RESERVE = 22;     // espaço reservado para o eixo X no fundo
  const tooltipThreshold = svgH * 0.55; // abaixo desse py, tooltip inverte para cima
  // Tooltip ativo: pinnedHover tem prioridade sobre liveHover
  const activeHover = pinnedHover ?? hover;
  const tooltipStyle: React.CSSProperties = (() => {
    if (!activeHover) return { display: 'none' };
    const rawTop = plotY + activeHover.py + 10;
    const flipTop = plotY + activeHover.py - TOOLTIP_EST_HEIGHT - 6;
    const useFlip = activeHover.py > tooltipThreshold;
    const top = Math.max(4, useFlip ? flipTop : rawTop);
    // Garante que o tooltip não ultrapasse o fundo (eixo X)
    const maxTop = svgH - XAXIS_RESERVE - TOOLTIP_EST_HEIGHT;
    return { display: 'block', left: plotX + activeHover.px + 14, top: Math.min(top, Math.max(4, maxTop)), maxWidth: 172 };
  })();
  const axisTextColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const axisLineColor = theme.isDark ? 'rgba(255,255,255,0.08)' : theme.colors.border.weak;
  const gridLineColor = theme.isDark ? 'rgba(255,255,255,0.07)' : theme.colors.border.weak;
  // Cinza neutro do rótulo — mesmo tom visual do resumo Mín/Méd/Máx (#FFF a 80%)
  const neutralLabelColor = theme.isDark ? 'rgba(255,255,255,0.8)' : theme.colors.text.secondary;
  
  // ── Cor de threshold para o single-view ──────────────────────────────────
  // Calcula a cor do threshold ativo independente do toggle global 'useThreshold',
  // para que os toggles individuais (colorIconByThreshold, etc.) funcionem
  // mesmo quando o global estiver desabilitado.
  let activeSingleThresholdColor: string | null = null; // null = sem violação, manter cor original
  let singleStepColor: string | null = null;
  let singleExactMatch = false;
  if (allSeriesInfos.length <= 1 && allSeriesInfos[0]) {
    const singleSeries = allSeriesInfos[0];
    singleExactMatch = (singleSeries.field.config.custom as CustomFieldConfig)?.exactThresholdMatch ?? options.exactThresholdMatch ?? false;
    let singleLast: number | null = null;
    for (let i = singleSeries.values.length - 1; i >= 0; i--) {
      const v = singleSeries.values[i];
      if (v !== null && v !== undefined && !isNaN(v as number)) {
        singleLast = v as number;
        break;
      }
    }
    if (singleLast !== null) {
      const singleThr = getFieldThresholds(singleSeries.field, theme, fieldConfig);
      const singleStep = getActiveNativeThreshold(singleLast, singleThr, singleExactMatch);
      if (singleStep?.color) {
        singleStepColor = singleStep.color;
      }
      // Só ativa a cor de violação quando o step ativo é um threshold violado (value !== null).
      // O step base (value === null) significa estado normal — mantém a cor original.
      if (singleStep && singleStep.value !== null && singleStep.color) {
        activeSingleThresholdColor = singleStep.color;
      }
    }
  }

  // Cor final de cada elemento:
  //   Se houver violação de threshold e toggle ativado -> cor do threshold ativo
  //   Senão, se houver cor definida por mapeamento de valor (Value Map) -> cor do mapeamento
  //   Senão -> cor original / tema
  const iconColor = (colorIconByThreshold && activeSingleThresholdColor)
    ? activeSingleThresholdColor
    : (colorIconByThreshold && displayValueColor ? displayValueColor : accent);

  const singleLabelMode = (allSeriesInfos[0]?.field.config.custom as CustomFieldConfig)?.labelColorMode
    ?? options.labelColorMode ?? 'neutral';
  const labelBaseColor = singleLabelMode === 'accent' ? accent : neutralLabelColor;
  const labelColor = (colorLabelByThreshold && activeSingleThresholdColor)
    ? activeSingleThresholdColor
    : (colorLabelByThreshold && displayValueColor ? displayValueColor : labelBaseColor);

  // Métrica (Valor): segue o toggle 'useThreshold' (ou legados valueFollowsThreshold / colorValueByThreshold)
  const isSingleValueThreshold = options.useThreshold ?? options.valueFollowsThreshold ?? colorValueByThreshold ?? false;
  let valueColor = '#FFFFFF';
  if (isSingleValueThreshold) {
    if (activeSingleThresholdColor) {
      valueColor = activeSingleThresholdColor;
    } else if (displayValueColor) {
      valueColor = displayValueColor;
    } else if (singleExactMatch) {
      valueColor = '#FFFFFF';
    } else {
      valueColor = singleStepColor ?? '#FFFFFF';
    }
  } else {
    valueColor = displayValueColor || '#FFFFFF';
  }
  // O resumo (min/méd/pico) é avaliado individualmente: cada estatística só assume
  // a cor do threshold se ELA PRÓPRIA violar um step; caso contrário mantém a cor natural.
  const summaryByThreshold = colorSummaryByThreshold;
  const summaryColor = '#FFFFFF';
  const summaryField = periodSummaryInfos[0]?.field;
  const statColor = (v: number | null): string =>
    (summaryByThreshold && summaryField && getViolationColor(v, summaryField, singleExactMatch, theme, fieldConfig)) || summaryColor;

  return (
    <div className={cx(styles.card, css`width: ${width}px; height: ${height}px;`)}>
      {/* ── HEADER: Modo single-série (layout original) ── */}
      {allSeriesInfos.length <= 1 && (
        <div ref={headerRef} className={styles.header}>
          {singleShowIcon && (
            <div 
              className={singleIconStyle === 'clean' ? styles.iconClean : styles.iconWrap} 
              style={{ 
                color: iconColor, 
                backgroundColor: singleIconStyle === 'clean' ? 'transparent' : `color-mix(in srgb, ${iconColor} 20%, transparent)`,
                border: singleIconStyle === 'clean' ? 'none' : `1px solid color-mix(in srgb, ${iconColor} 30%, transparent)`
              }}
            >
              <Icon name={resolveIconName(singleIcon) as any} size={singleIconStyle === 'clean' ? 'lg' : 'sm'} />
            </div>
          )}
          <div className={styles.titleInfo}>
            {singleShowLabel && (
              <div
                className={styles.label}
                style={{
                  color: labelColor,
                  ...getAdaptiveTitleStyle(singleLabel, theme.typography.bodySmall.fontSize),
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                }}
                title={singleLabel}
              >
                {singleLabel}
              </div>
            )}
            {singleShowSummary && periodSummaryInfos.length === 1 && (
              <div className={styles.periodSummary} style={{ color: summaryColor }}>
                {(() => {
                   const nodes: React.ReactNode[] = [];
                   if (options.showPeriodMin && periodMin !== null) {
                     nodes.push(
                       <span key="min" className={styles.periodStat} style={{ color: statColor(periodMin), opacity: 0.8 }}>
                         Mínimo {formatFieldValue(periodMin, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   if (options.showPeriodAverage && periodAverage !== null) {
                     nodes.push(
                       <span key="avg" className={styles.periodStat} style={{ color: statColor(periodAverage), opacity: 0.8 }}>
                         Média {formatFieldValue(periodAverage, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   if (options.showPeriodPeak && periodPeak !== null) {
                     nodes.push(
                       <span key="max" className={styles.periodStat} style={{ color: statColor(periodPeak), opacity: 0.8 }}>
                         Pico {formatFieldValue(periodPeak, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   return nodes;
                })()}
                {alertDurations.map((alert) => (
                  <span key={alert.value} className={styles.periodStat} style={{ color: alert.color, opacity: 0.8 }}>
                    {singleExactMatch ? '= ' : '≥ '}{formatFieldValue(alert.value, periodSummaryInfos[0].field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!hasMultipleSeries && singleShowValue && (() => {
            const singleS = allSeriesInfos[0];
            const singleLastVal = singleS
              ? (singleS.values.reduceRight((found: number | null, v) => found !== null ? found : (v !== null && !isNaN(v) ? v : null), null))
              : null;
            const singleThr = singleS ? getFieldThresholds(singleS.field, theme, fieldConfig) : undefined;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span className={styles.value} style={{ color: valueColor }}>
                  {displayValue ?? '—'}
                </span>
                {singleS && singleLastVal !== null && (
                  <AlertBadgePopover
                    badge={getBadgeState(singleLastVal, singleS.values, singleS.timeValues, singleThr, tStart, tEnd, theme, activeSingleThresholdColor, singleExactMatch)}
                    tStart={tStart}
                    tEnd={tEnd}
                    styles={styles}
                    field={singleS.field}
                    exactMatch={singleExactMatch}
                    fieldConfig={fieldConfig}
                  />
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── HEADER: Modo multi-métrica (grade de KPI Cards) ── */}
      {allSeriesInfos.length >= 2 && (
        <div ref={headerRef} className={styles.multiGrid}>
          {allSeriesInfos.map((s, idx) => {
            const custom = (s.field.config.custom as CustomFieldConfig) || {};
            
            // Conteúdo
            const serieIcon = custom.icon || 'server';
            const serieLabel = custom.label || s.name;
            
            // Estilo e Visibilidade em Cascata
            const isIconVisible = custom.showIcon ?? options.showIcon ?? true;
            const isLabelVisible = custom.showLabel ?? options.showLabel ?? true;
            const isValueVisible = custom.showCurrentValue ?? options.showCurrentValue ?? true;
            const isSummaryVisible = custom.showSummary ?? options.showSummary ?? true;
            const currentIconStyle = custom.iconStyle ?? options.iconStyle ?? 'contained';
            const currentFontSize = custom.valueFontSize || options.valueFontSize || '18px';

            const colorIconByThreshold = custom.colorIconByThreshold ?? false;
            const colorLabelByThreshold = custom.colorLabelByThreshold ?? false;
            const colorValueByThreshold = custom.colorValueByThreshold ?? false;
            const colorSummaryByThreshold = custom.colorSummaryByThreshold ?? false;

            const isSelected = selectedSeriesIndex === idx;
            const isDimmed = selectedSeriesIndex !== null && !isSelected;
            // Escaneia de trás pra frente para encontrar o último valor válido conhecido,
            // evitando mostrar "—" quando os dados mais recentes são nulos.
            let lastVal: number | null = null;
            for (let i = s.values.length - 1; i >= 0; i--) {
              const v = s.values[i];
              if (v !== null && v !== undefined && !isNaN(v as number)) {
                lastVal = v as number;
                break;
              }
            }
            const sExactMatch = custom.exactThresholdMatch ?? options.exactThresholdMatch ?? false;
            const formattedValObj = lastVal !== null ? formatFieldValue(lastVal, s.field, theme) : null;
            const formattedVal = formattedValObj ? formattedValObj.text : '—';
            const mappedValColor = getMappedColor(lastVal, s.field, theme);
            
            // Calculate active threshold color
            // Resolve the series base color (from fixedColor or series palette) — used as fallback
            const seriesBaseColor = s.color;
            const thr = getFieldThresholds(s.field, theme, fieldConfig);
            const step = getActiveNativeThreshold(lastVal ?? -Infinity, thr, sExactMatch);
            // Só ativa a cor do threshold quando o step ativo é um threshold violado (value !== null).
            // O step base (value === null) significa estado normal — mantém a cor original da série.
            const activeViolationColor: string | null = (step && step.value !== null) ? (step.color ?? null) : null;

            // Cor final de cada elemento:
            //   toggle OFF → cor da série (distinta por card)
            //   toggle ON + sem violação (step base) → cor da série ou value mapping
            //   toggle ON + threshold violado → cor do threshold ativo
            const multiIconColor = (colorIconByThreshold && activeViolationColor)
              ? activeViolationColor
              : (colorIconByThreshold && mappedValColor ? mappedValColor : seriesBaseColor);
            const multiLabelBase = (custom.labelColorMode ?? options.labelColorMode ?? 'neutral') === 'accent'
              ? seriesBaseColor
              : neutralLabelColor;
            const multiLabelColor = (colorLabelByThreshold && activeViolationColor)
              ? activeViolationColor
              : (colorLabelByThreshold && mappedValColor ? mappedValColor : multiLabelBase);
            const isMultiValueThreshold = options.useThreshold ?? options.valueFollowsThreshold ?? colorValueByThreshold ?? false;
            let multiValueColor = '#FFFFFF';
            if (isMultiValueThreshold) {
              if (activeViolationColor) {
                multiValueColor = activeViolationColor;
              } else if (mappedValColor) {
                multiValueColor = mappedValColor;
              } else if (sExactMatch) {
                multiValueColor = '#FFFFFF';
              } else {
                multiValueColor = step?.color ?? '#FFFFFF';
              }
            } else {
              multiValueColor = mappedValColor || '#FFFFFF';
            }
            // Cor natural do resumo (separadores e estatísticas sem violação)
            const multiSummaryColor = '#FFFFFF';
            const multiSummaryByThreshold = colorSummaryByThreshold;

            // Resumo do período para este card
            const validVals = s.values.filter((v) => v !== null && !isNaN(v));
            const cardMin = validVals.length ? Math.min(...validVals) : null;
            const cardAvg = validVals.length ? validVals.reduce((a, b) => a + b, 0) / validVals.length : null;
            const cardMax = validVals.length ? Math.max(...validVals) : null;

            // Cada estatística é avaliada individualmente contra os thresholds
            const minColor = (multiSummaryByThreshold && getViolationColor(cardMin, s.field, sExactMatch, theme, fieldConfig)) || multiSummaryColor;
            const avgColor = (multiSummaryByThreshold && getViolationColor(cardAvg, s.field, sExactMatch, theme, fieldConfig)) || multiSummaryColor;
            const maxColor = (multiSummaryByThreshold && getViolationColor(cardMax, s.field, sExactMatch, theme, fieldConfig)) || multiSummaryColor;

            const minFormatted = cardMin !== null ? formatFieldValue(cardMin, s.field, theme).text : '';
            const avgFormatted = cardAvg !== null ? formatFieldValue(cardAvg, s.field, theme).text : '';
            const maxFormatted = cardMax !== null ? formatFieldValue(cardMax, s.field, theme).text : '';

            const cardAlertDurations = (isSummaryVisible && options.showTimeInAlert)
              ? getAlertDurations(s.values, s.timeValues, getFieldThresholds(s.field, theme, fieldConfig), tStart, tEnd, sExactMatch)
              : [];

            // Montar nós de resumo compactos com badge condicional
            const summaryNodes: React.ReactNode[] = [];
            if (isSummaryVisible) {
              if (options.showPeriodMin && cardMin !== null) {
                summaryNodes.push(
                  <span key="min" style={{ color: minColor, opacity: 0.8 }}>
                    Min {minFormatted}
                  </span>
                );
              }
              if (options.showPeriodAverage && cardAvg !== null) {
                summaryNodes.push(
                  <span key="avg" style={{ color: avgColor, opacity: 0.8 }}>
                    Méd {avgFormatted}
                  </span>
                );
              }
              if (options.showPeriodPeak && cardMax !== null) {
                summaryNodes.push(
                  <span key="max" style={{ color: maxColor, opacity: 0.8 }}>
                    Max {maxFormatted}
                  </span>
                );
              }
              if (options.showTimeInAlert && cardAlertDurations.length > 0) {
                cardAlertDurations.forEach(alert => {
                  summaryNodes.push(
                    <span key={`alert-${alert.value}`} style={{ color: alert.color, fontWeight: 600, opacity: 0.8 }}>
                      {sExactMatch ? '= ' : '≥ '}{formatFieldValue(alert.value, s.field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
                    </span>
                  );
                });
              }
            }

            return (
              <div
                key={s.name}
                className={cx(styles.multiCard, isSelected && styles.multiCardSelected)}
                style={{ 
                  opacity: isDimmed ? 0.35 : 1,
                } as React.CSSProperties}
                onClick={() => handleCardClick(idx)}
              >
                {/* Badge movido para ao lado do valor — removido daqui */}

                <div className={styles.multiCardLeft}>
                  {isIconVisible && (
                    <div 
                      className={currentIconStyle === 'clean' ? styles.multiCardIconClean : styles.multiCardIcon}
                      style={{ 
                        color: multiIconColor, 
                        backgroundColor: currentIconStyle === 'clean' ? 'transparent' : `color-mix(in srgb, ${multiIconColor} 20%, transparent)`,
                        border: currentIconStyle === 'clean' ? 'none' : `1px solid color-mix(in srgb, ${multiIconColor} 30%, transparent)`
                      }}
                    >
                      <Icon name={resolveIconName(serieIcon) as any} size={currentIconStyle === 'clean' ? 'lg' : 'sm'} />
                    </div>
                  )}
                  <div className={styles.multiCardTextCol}>
                    {isLabelVisible && (
                      <span
                        className={styles.multiCardLabel}
                        style={{
                          color: multiLabelColor,
                          ...getAdaptiveTitleStyle(serieLabel, '11px'),
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                        }}
                        title={serieLabel}
                      >
                        {serieLabel}
                      </span>
                    )}
                    {summaryNodes.length > 0 && (
                      <div className={styles.multiCardSummary} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                        {summaryNodes.map((node, i) => (
                          <React.Fragment key={i}>
                            {node}
                            {i < summaryNodes.length - 1 && <span style={{ color: multiSummaryColor, opacity: 0.5 }}>·</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {isValueVisible && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div className={styles.multiCardValue} style={{ fontSize: currentFontSize, color: multiValueColor }}>
                      {formattedVal}
                    </div>
                    {/* Badge de alerta ao lado do valor */}
                    <AlertBadgePopover
                       badge={getBadgeState(lastVal, s.values, s.timeValues, thr, tStart, tEnd, theme, activeViolationColor, sExactMatch)}
                       tStart={tStart}
                       tEnd={tEnd}
                       styles={styles}
                       field={s.field}
                       exactMatch={sExactMatch}
                       fieldConfig={fieldConfig}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {options.showSparkline && (
        <div className={styles.chartWrap}>
          <div className={styles.chartArea}>
            <div className={styles.tooltip} style={tooltipStyle}>
              {activeHover && (
                <>
                  {/* Header do tooltip: horário + botão de fechar quando pinado */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div className={styles.tooltipTime}>{formatTooltipTime(activeHover.ts)}</div>
                    {pinnedHover && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPinnedHover(null); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 6px',
                          color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1, flexShrink: 0,
                        }}
                        title="Fechar"
                      >×</button>
                    )}
                  </div>
                  {/* Indicador visual de pinado */}
                  {pinnedHover && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                      📌 Clique no gráfico para soltar
                    </div>
                  )}
                  {activeHover.points.map((pt) => (
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
              thresholdLines={thresholdLines}
              getSeriesColor={getSeriesColor}
              axisTextColor={axisTextColor}
              axisLineColor={axisLineColor}
              gridLineColor={gridLineColor}
              selectedSeriesIndex={selectedSeriesIndex}
              onHover={(ts, points, px, py) => {
                if (pinnedHover) return; // Não atualiza hover se há um pinado
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
              onChartClick={(ts, _points, px, py) => {
                if (pinnedHover) {
                  // Segundo clique: desfixa
                  setPinnedHover(null);
                  return;
                }
                // Primeiro clique: fixa o hover atual
                if (hover) {
                  setPinnedHover({ ...hover, px, py });
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
