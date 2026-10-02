import React, { useMemo, useRef, useState, useLayoutEffect, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import { useStyles2, Icon, useTheme2, Tooltip } from '@grafana/ui';
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

function getThresholdAlert(val: number, field: Field, theme: GrafanaTheme2): { isAlert: boolean; color: string } {
  const displayProcessor = field.display || getDisplayProcessor({ field, theme });
  const display = displayProcessor(val);
  const thresholds = field.config.thresholds?.steps;
  
  if (!display || !thresholds || thresholds.length <= 1) {
    return { isAlert: false, color: '#9CA3AF' };
  }

  const baseColor = thresholds[0].color;
  const isViolated = display.color !== baseColor && display.color !== undefined;

  return {
    isAlert: isViolated,
    color: display.color || '#9CA3AF',
  };
}

const badgeAlertStyle = (color: string): React.CSSProperties => ({
  color: color,
  fontWeight: 600,
});

const normalStatStyle: React.CSSProperties = { color: '#9CA3AF' };

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

// ─── Lógica de Episódios de Alerta e Badge ─────────────────────────────────

export interface AlertEpisode {
  startTs: number;
  endTs: number;
  durationMs: number;
  color: string;
  /** Estatísticas dos valores reais durante o episódio */
  avgValue: number;
  minValue: number;
  maxValue: number;
  /** Campos internos para cálculo incremental */
  _sum: number;
  _count: number;
}

/**
 * Varre o array de valores e agrupa violações consecutivas do mesmo threshold
 * em "episódios" de alerta, contendo início, fim e duração total.
 */
function getAlertEpisodes(
  values: number[], 
  times: number[], 
  thresholds: NativeThresholdsConfig | undefined, 
  tStart: number, 
  tEnd: number
): AlertEpisode[] {
  if (!thresholds?.steps?.some((step) => step.value !== null)) { return []; }
  
  const episodes: AlertEpisode[] = [];
  let currentEpisode: AlertEpisode | null = null;
  let currentStepValue: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const time = times[i];
    const nextTime = times[i+1] ?? time;

    // Se valor inválido/inexistente, quebra a continuidade do episódio
    if (value === null || value === undefined || isNaN(value)) {
       if (currentEpisode) {
         episodes.push(currentEpisode);
         currentEpisode = null;
         currentStepValue = null;
       }
       continue;
    }

    const step = getActiveNativeThreshold(value, thresholds);
    const isAlert = step && step.value !== null;
    
    // Limitar os timestamps pelo espaço de tempo visível no gráfico
    const from = Math.max(time, tStart);
    const to = Math.min(nextTime, tEnd);
    if (to <= from) continue;

    if (isAlert && step) {
      if (currentEpisode && currentStepValue === step.value) {
        // Continua no mesmo episódio de violação
        currentEpisode.endTs = to;
        currentEpisode.durationMs += (to - from);
        currentEpisode._sum += value;
        currentEpisode._count += 1;
        currentEpisode.avgValue = currentEpisode._sum / currentEpisode._count;
        if (value < currentEpisode.minValue) currentEpisode.minValue = value;
        if (value > currentEpisode.maxValue) currentEpisode.maxValue = value;
      } else {
        // Inicia novo episódio (mudou a cor do threshold ou voltou do normal)
        if (currentEpisode) { episodes.push(currentEpisode); }
        currentEpisode = {
          startTs: from,
          endTs: to,
          durationMs: to - from,
          color: step.color,
          avgValue: value,
          minValue: value,
          maxValue: value,
          _sum: value,
          _count: 1,
        };
        currentStepValue = step.value;
      }
    } else {
      // Retornou ao normal, fecha o episódio se houvesse algum ativo
      if (currentEpisode) {
        episodes.push(currentEpisode);
        currentEpisode = null;
        currentStepValue = null;
      }
    }
  }

  // Finaliza o último episódio se a série terminou em violação
  if (currentEpisode) {
    episodes.push(currentEpisode);
  }

  return episodes;
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
  theme: GrafanaTheme2,
): BadgeInfo {
  if (!thresholds?.steps?.some((s) => s.value !== null)) {
    return { state: 'normal', color: '', episodes: [] };
  }

  const episodes = getAlertEpisodes(allValues, timeValues, thresholds, tStart, tEnd);

  // Estado ATIVO: O valor atual (lastVal) viola o threshold
  if (lastVal !== null) {
    const currentStep = getActiveNativeThreshold(lastVal, thresholds);
    if (currentStep && currentStep.value !== null) {
      // Cor base para estado Ativo Crítico: Vermelho Grafana
      return { state: 'active', color: '#E24D42', episodes };
    }
  }

  // Estado HISTÓRICO: O valor atual está normal, mas há episódios registrados (maxValue violou)
  if (episodes.length > 0) {
    // Cor base para estado Histórico de Aviso: Amarelo Grafana
    return { state: 'historical', color: '#E5A325', episodes };
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
const getStyles = (theme: GrafanaTheme2, accent: string, valueFontSize: string | number) => {
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
    `,
    label: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
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
      padding: ${theme.spacing(1)} ${theme.spacing(2)} ${theme.spacing(0.5)};
      z-index: 3;
      flex-shrink: 0;
    `,
    multiCard: css`
      position: relative;
      overflow: visible;
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
    `,
    multiCardLabel: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
function formatShortTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

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
}> = ({ badge, tStart, tEnd, triggerRect, isPinned, onClose, formatValue }) => {
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

  // Nota: sem handler de click-outside — múltiplos popups podem ficar
  // pinados ao mesmo tempo. Cada um fecha pelo próprio X, Escape ou
  // segundo clique no seu botão de exclamação.

  let content: React.ReactNode = null;

  if (badge.episodes.length === 1) {
    const ep = badge.episodes[0];
    if (badge.state === 'active') {
      content = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: badge.color, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="exclamation-triangle" size="sm" style={{ color: badge.color, flexShrink: 0 }} />
            Threshold excedido
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.9 }}>
            <div><strong>Início:</strong> {formatShortTime(ep.startTs)}</div>
            <div><strong>Duração:</strong> {humanDuration(ep.durationMs, 'ms')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pico</span>
              <span style={{ fontWeight: 700, color: badge.color }}>{formatValue(ep.maxValue)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Média</span>
              <span style={{ fontWeight: 600 }}>{formatValue(ep.avgValue)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mínimo</span>
              <span style={{ fontWeight: 600, opacity: 0.8 }}>{formatValue(ep.minValue)}</span>
            </div>
          </div>
        </div>
      );
    } else {
      content = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: badge.color, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="exclamation-triangle" size="sm" style={{ color: badge.color, flexShrink: 0 }} />
            Alerta normalizado
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.9 }}>
            <div><strong>Janela de amostra:</strong> {formatShortTime(ep.startTs)} até {formatShortTime(ep.endTs)}</div>
            <div><strong>Duração em alerta:</strong> {humanDuration(ep.durationMs, 'ms')} no gráfico</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pico</span>
              <span style={{ fontWeight: 700, color: badge.color }}>{formatValue(ep.maxValue)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Média</span>
              <span style={{ fontWeight: 600 }}>{formatValue(ep.avgValue)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mínimo</span>
              <span style={{ fontWeight: 600, opacity: 0.8 }}>{formatValue(ep.minValue)}</span>
            </div>
          </div>
        </div>
      );
    }
  } else if (badge.episodes.length > 1) {
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: badge.color, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="exclamation-triangle" size="sm" style={{ color: badge.color, flexShrink: 0 }} />
          {badge.state === 'active' ? 'Threshold excedido' : 'Alerta normalizado'}
        </div>
        <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 4 }}>Janela de amostra do gráfico: {formatShortTime(tStart)} – {formatShortTime(tEnd)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {badge.episodes.map((ep, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              paddingBottom: 10, marginBottom: 10,
              borderBottom: i < badge.episodes.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none'
            }}>
              <div style={{ fontWeight: 600, opacity: 0.7, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Caso {i + 1}</div>
              <div><strong>Início:</strong> {formatShortTime(ep.startTs)}</div>
              <div><strong>Fim:</strong> {formatShortTime(ep.endTs)}</div>
              <div><strong>Duração:</strong> {humanDuration(ep.durationMs, 'ms')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 4, padding: '5px 6px', borderRadius: 5, background: 'rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pico</span>
                  <span style={{ fontWeight: 700, fontSize: 11, color: badge.color }}>{formatValue(ep.maxValue)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Média</span>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>{formatValue(ep.avgValue)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mínimo</span>
                  <span style={{ fontWeight: 600, fontSize: 11, opacity: 0.8 }}>{formatValue(ep.minValue)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {(() => {
          const totalWeightedSum = badge.episodes.reduce((acc, ep) => acc + ep.avgValue * ep.durationMs, 0);
          const totalDurationMs = badge.episodes.reduce((acc, ep) => acc + ep.durationMs, 0);
          const overallAvg = totalDurationMs > 0 ? totalWeightedSum / totalDurationMs : 0;
          const overallMax = Math.max(...badge.episodes.map(ep => ep.maxValue));
          const overallMin = Math.min(...badge.episodes.map(ep => ep.minValue));
          return (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>Total em alerta: {humanDuration(totalMs, 'ms')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pico geral</span>
                  <span style={{ fontWeight: 700, color: badge.color }}>{formatValue(overallMax)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Média geral</span>
                  <span style={{ fontWeight: 600 }}>{formatValue(overallAvg)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mín. geral</span>
                  <span style={{ fontWeight: 600, opacity: 0.8 }}>{formatValue(overallMin)}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

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
        border: `1px solid color-mix(in srgb, ${badge.color} 30%, rgba(255,255,255,0.08))`,
        boxShadow: `0 12px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), 0 0 20px color-mix(in srgb, ${badge.color} 12%, transparent)`,
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

const AlertBadgePopover: React.FC<{ badge: BadgeInfo, tStart: number, tEnd: number, styles: any, field: Field }> = ({ badge, tStart, tEnd, styles, field }) => {
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
      // Já pinado: clique na exclamação fecha
      setIsPinned(false);
      setIsHovered(false);
    } else {
      // Abrir e pinar
      setIsPinned(true);
    }
  };

  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(badge.color);
  const hexToRgba = (hex: string, alpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  const badgeBg = isValidHex ? hexToRgba(badge.color, 0.15) : `color-mix(in srgb, ${badge.color} 15%, transparent)`;
  const badgeBorder = isValidHex ? hexToRgba(badge.color, 0.45) : `color-mix(in srgb, ${badge.color} 45%, transparent)`;

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: 10 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Botão de exclamação */}
      <div
        ref={triggerRef}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'bold', fontSize: 13,
          color: badge.color,
          backgroundColor: isPinned
            ? (isValidHex ? hexToRgba(badge.color, 0.3) : `color-mix(in srgb, ${badge.color} 30%, transparent)`)
            : badgeBg,
          border: `1.5px solid ${badgeBorder}`,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
          boxShadow: isPinned
            ? `0 0 10px ${badgeBorder}`
            : `0 0 6px ${badgeBorder}`,
          transform: isPinned ? 'scale(1.1)' : 'scale(1)',
        }}
        onClick={handleClick}
        title={isPinned ? 'Clique para fechar' : 'Clique para fixar'}
      >
        !
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
  const { displayValue, displayColor, hasMultipleSeries, allSeriesInfos, visibleSeriesInfos } = useMemo(() => {
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
    let displayColor: string | undefined = undefined;
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
        displayColor = formatted.color;
      }
    }
    return { displayValue, displayColor, hasMultipleSeries: visibleInfos.length > 1, allSeriesInfos: infos, visibleSeriesInfos: visibleInfos };
  }, [data, accent, hiddenSeries]);

  // Use visibleSeriesInfos for chart rendering calculations
  const seriesInfos = visibleSeriesInfos;

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

  const thresholdLines: Array<{ value: number; color: string }> = [];

  if (options.showThresholdLine) {
    visibleSeriesInfos.forEach(s => {
      const nativeThr = getFieldThresholds(s.field);
      if (nativeThr?.steps && nativeThr.steps.length > 1) {
        nativeThr.steps.forEach(st => {
          if (st.value !== null) {
            if (!thresholdLines.some(l => l.value === st.value && l.color === st.color)) {
              thresholdLines.push({ value: st.value as number, color: st.color });
            }
          }
        });
      }
    });
  }

  let singleEffectiveColor = baseColor;
  if (visibleSeriesInfos.length === 1) {
    const s = visibleSeriesInfos[0];
    const nativeThr = getFieldThresholds(s.field);
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
    if (!options.showTimeInAlert || periodSummaryInfos.length !== 1) return [];
    return getAlertDurations(
      periodSummaryInfos[0].values,
      periodSummaryInfos[0].timeValues,
      getFieldThresholds(periodSummaryInfos[0].field),
      tStart,
      tEnd
    );
  }, [options.showTimeInAlert, periodSummaryInfos, tStart, tEnd]);

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
  const tooltipStyle: React.CSSProperties = (() => {
    if (!hover) return { display: 'none' };
    const rawTop = plotY + hover.py + 10;
    const flipTop = plotY + hover.py - TOOLTIP_EST_HEIGHT - 6;
    const useFlip = hover.py > tooltipThreshold;
    const top = Math.max(4, useFlip ? flipTop : rawTop);
    // Garante que o tooltip não ultrapasse o fundo (eixo X)
    const maxTop = svgH - XAXIS_RESERVE - TOOLTIP_EST_HEIGHT;
    return { display: 'block', left: plotX + hover.px + 14, top: Math.min(top, Math.max(4, maxTop)), maxWidth: 172 };
  })();
  const axisTextColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const axisLineColor = theme.isDark ? 'rgba(255,255,255,0.08)' : theme.colors.border.weak;
  const gridLineColor = theme.isDark ? 'rgba(255,255,255,0.07)' : theme.colors.border.weak;
  
  // ── Cor de threshold para o single-view ──────────────────────────────────
  // Calcula a cor do threshold ativo independente do toggle global 'useThreshold',
  // para que os toggles individuais (colorIconByThreshold, etc.) funcionem
  // mesmo quando o global estiver desabilitado.
  let activeSingleThresholdColor: string | null = null; // null = sem violão, manter cor original
  if (allSeriesInfos.length <= 1 && allSeriesInfos[0]) {
    const singleSeries = allSeriesInfos[0];
    const singleLast = singleSeries.values.length ? singleSeries.values[singleSeries.values.length - 1] : null;
    if (singleLast !== null) {
      const singleThr = getFieldThresholds(singleSeries.field);
      const singleStep = getActiveNativeThreshold(singleLast, singleThr);
      // Só ativa a cor do threshold quando o step ativo é um threshold violado (value !== null).
      // O step base (value === null) significa estado normal — mantém a cor original.
      if (singleStep && singleStep.value !== null && singleStep.color) {
        activeSingleThresholdColor = singleStep.color;
      }
    }
  }

  // Cor final de cada elemento:
  //   toggle OFF → cor original (accent do tema)
  //   toggle ON + sem violação (step base) → cor original (accent do tema)
  //   toggle ON + threshold violado → cor do threshold ativo
  const iconColor = (colorIconByThreshold && activeSingleThresholdColor) ? activeSingleThresholdColor : accent;
  const labelColor = (colorLabelByThreshold && activeSingleThresholdColor) ? activeSingleThresholdColor : accent;
  const valueColor = (colorValueByThreshold && activeSingleThresholdColor) ? activeSingleThresholdColor : '#FFFFFF';
  // O resumo (min/méd/pico) sempre acompanha a cor do valor da métrica
  const summaryColor = valueColor;

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
              <div className={styles.label} style={{ color: labelColor }}>
                {singleLabel}
              </div>
            )}
            {singleShowSummary && periodSummaryInfos.length === 1 && (
              <div className={styles.periodSummary} style={{ color: summaryColor }}>
                {(() => {
                   const nodes: React.ReactNode[] = [];
                   if (options.showPeriodMin && periodMin !== null) {
                     nodes.push(
                       <span key="min" className={styles.periodStat} style={{ opacity: 0.8 }}>
                         Mínimo {formatFieldValue(periodMin, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   if (options.showPeriodAverage && periodAverage !== null) {
                     nodes.push(
                       <span key="avg" className={styles.periodStat} style={{ opacity: 0.8 }}>
                         Média {formatFieldValue(periodAverage, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   if (options.showPeriodPeak && periodPeak !== null) {
                     nodes.push(
                       <span key="max" className={styles.periodStat} style={{ opacity: 0.8 }}>
                         Pico {formatFieldValue(periodPeak, periodSummaryInfos[0].field, theme).text}
                       </span>
                     );
                   }
                   return nodes;
                })()}
                {alertDurations.map((alert) => (
                  <span key={alert.value} className={styles.periodStat} style={{ color: alert.color, opacity: 0.8 }}>
                    ≥ {formatFieldValue(alert.value, periodSummaryInfos[0].field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
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
            const singleThr = singleS ? getFieldThresholds(singleS.field) : undefined;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span className={styles.value} style={{ color: valueColor }}>
                  {displayValue ?? '—'}
                </span>
                {singleS && singleLastVal !== null && (
                  <AlertBadgePopover
                    badge={getBadgeState(singleLastVal, singleS.values, singleS.timeValues, singleThr, tStart, tEnd, theme)}
                    tStart={tStart}
                    tEnd={tEnd}
                    styles={styles}
                    field={singleS.field}
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
            const formattedValObj = lastVal !== null ? formatFieldValue(lastVal, s.field, theme) : null;
            const formattedVal = formattedValObj ? formattedValObj.text : '—';
            
            // Calculate active threshold color
            // Resolve the series base color (from fixedColor or series palette) — used as fallback
            const seriesBaseColor = s.color;
            const thr = getFieldThresholds(s.field);
            const step = getActiveNativeThreshold(lastVal ?? -Infinity, thr);
            // Só ativa a cor do threshold quando o step ativo é um threshold violado (value !== null).
            // O step base (value === null) significa estado normal — mantém a cor original da série.
            const activeViolationColor: string | null = (step && step.value !== null) ? (step.color ?? null) : null;

            // Cor final de cada elemento:
            //   toggle OFF → cor da série (distinta por card)
            //   toggle ON + sem violação (step base) → cor da série (distinta por card)
            //   toggle ON + threshold violado → cor do threshold ativo
            const multiIconColor = (colorIconByThreshold && activeViolationColor) ? activeViolationColor : seriesBaseColor;
            const multiLabelColor = (colorLabelByThreshold && activeViolationColor) ? activeViolationColor : seriesBaseColor;
            const multiValueColor = (colorValueByThreshold && activeViolationColor) ? activeViolationColor : '#FFFFFF';
            // O resumo (min/méd/pico) sempre acompanha a cor do valor da métrica
            const multiSummaryColor = multiValueColor;

            // Resumo do período para este card
            const validVals = s.values.filter((v) => v !== null && !isNaN(v));
            const cardMin = validVals.length ? Math.min(...validVals) : null;
            const cardAvg = validVals.length ? validVals.reduce((a, b) => a + b, 0) / validVals.length : null;
            const cardMax = validVals.length ? Math.max(...validVals) : null;

            const minAlert = cardMin !== null ? getThresholdAlert(cardMin, s.field, theme) : null;
            const avgAlert = cardAvg !== null ? getThresholdAlert(cardAvg, s.field, theme) : null;
            const maxAlert = cardMax !== null ? getThresholdAlert(cardMax, s.field, theme) : null;

            const minFormatted = cardMin !== null ? formatFieldValue(cardMin, s.field, theme).text : '';
            const avgFormatted = cardAvg !== null ? formatFieldValue(cardAvg, s.field, theme).text : '';
            const maxFormatted = cardMax !== null ? formatFieldValue(cardMax, s.field, theme).text : '';

            const cardAlertDurations = (isSummaryVisible && options.showTimeInAlert) ? getAlertDurations(s.values, s.timeValues, getFieldThresholds(s.field), tStart, tEnd) : [];

            // Montar nós de resumo compactos com badge condicional
            const summaryNodes: React.ReactNode[] = [];
            if (isSummaryVisible) {
              if (options.showPeriodMin && cardMin !== null) {
                summaryNodes.push(
                  <span key="min" style={{ color: multiSummaryColor, opacity: 0.8 }}>
                    Min {minFormatted}
                  </span>
                );
              }
              if (options.showPeriodAverage && cardAvg !== null) {
                summaryNodes.push(
                  <span key="avg" style={{ color: multiSummaryColor, opacity: 0.8 }}>
                    Méd {avgFormatted}
                  </span>
                );
              }
              if (options.showPeriodPeak && cardMax !== null) {
                summaryNodes.push(
                  <span key="max" style={{ color: multiSummaryColor, opacity: 0.8 }}>
                    Max {maxFormatted}
                  </span>
                );
              }
              if (options.showTimeInAlert && cardAlertDurations.length > 0) {
                cardAlertDurations.forEach(alert => {
                  summaryNodes.push(
                    <span key={`alert-${alert.value}`} style={{ color: alert.color, fontWeight: 600, opacity: 0.8 }}>
                      ≥ {formatFieldValue(alert.value, s.field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
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
                      <span className={styles.multiCardLabel} style={{ color: multiLabelColor }}>{serieLabel}</span>
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
                       badge={getBadgeState(lastVal, s.values, s.timeValues, thr, tStart, tEnd, theme)}
                       tStart={tStart}
                       tEnd={tEnd}
                       styles={styles}
                       field={s.field}
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
              thresholdLines={thresholdLines}
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
