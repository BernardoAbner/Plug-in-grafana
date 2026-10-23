import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import 'uplot/dist/uPlot.min.css';
import {
  PanelProps,
  Field,
  FieldType,
  getFieldDisplayName,
  GrafanaTheme2,
} from '@grafana/data';
import { SimpleOptions, NativeThresholdsConfig, ThresholdComparisonMode, LineInterpolation } from '../types';
import { FilterBadgePopover, ColumnFilterConfig } from './ColumnFilterModal';
import { css } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import {
  HistoryAlertIcon,
  AlertEpisode,
  getAlertEpisodes,
  formatFieldValue,
  resolveColumnThreshold,
  getFieldExactMatch,
  getFieldThresholds,
  getFieldOverrideProperty,
  getEffectiveCustomConfig,
  resolveAlertHexColor,
  resolveIconName,
  AlertBadgePopover,
  getBadgeState,
  BadgeInfo,
} from './SimplePanel';
import {
  BadgeRenderer,
  ProgressBarRenderer,
  SegmentedBarRenderer,
  DeltaTrendRenderer,
  HeatmapStrip,
  PanelInteractionContext,
  PanelInteractionContextValue,
  getHealthyToneSteps,
} from './CellRenderers';
import { TableSparklineCell, SparklineSeries } from './TableSparklineCell';

export {
  BadgeRenderer,
  ProgressBarRenderer,
  SegmentedBarRenderer,
  DeltaTrendRenderer,
  HeatmapStrip,
  PanelInteractionContext,
  getHealthyToneSteps,
} from './CellRenderers';

interface Props extends PanelProps<SimpleOptions> {}

export interface MetricCellData {
  id: string;
  hostName: string;
  metricName: string;
  field: Field;
  values: any[];
  timeValues: number[];
  lastVal: number | string | null;
  formattedLastVal: { text: string; color?: string };
  isActiveNow: boolean;
  corDoThreshold: string;
  hasHistoricalAlert: boolean;
  isHealthy: boolean;
  episodes: AlertEpisode[];
  badge: BadgeInfo;
  minVal: number | null;
  maxVal: number | null;
  avgVal: number | null;
  iconName: string;
  activeStepValue?: number;
  lastEpisodeStart?: number;
  tStart: number;
  tEnd: number;
  thresholds?: NativeThresholdsConfig;
  exactMatch: boolean;
  comparisonMode: ThresholdComparisonMode;
  displayMode: string;
}

export interface HostRowData {
  hostName: string;
  iconName: string;
  isActiveNow: boolean;
  corDoThreshold: string;
  hasHistoricalAlert: boolean;
  isHealthy: boolean;
  activeStepValue?: number;
  lastEpisodeStart?: number;
  metrics: Record<string, MetricCellData>;
}

const ROW_HEIGHT = 34;
const OVERSCAN = 6;

// ─── Formatadores auxiliares para diagnóstico na janela ───────────────────────
export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) {
    return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  }
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) {
    return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatTimeHHmm(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatTimeHHmmss(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function isGenericName(name?: string | null): boolean {
  if (!name) return true;
  const s = name.trim().toLowerCase();
  return (
    s === '' ||
    s === 'value' ||
    s === 'val' ||
    s === 'values' ||
    s === 'metric' ||
    s === 'métrica' ||
    s === 'metricas' ||
    s === 'series' ||
    s === 'serie' ||
    s === 'data' ||
    s === 'null' ||
    s === 'undefined'
  );
}

export interface TimeAxisSplit {
  timestamp: number;
  label: string;
  pct: number;
}

export const CANDIDATE_STEPS_MS = [
  1 * 1000,                  // 1s
  2 * 1000,                  // 2s
  5 * 1000,                  // 5s
  10 * 1000,                 // 10s
  15 * 1000,                 // 15s
  30 * 1000,                 // 30s
  60 * 1000,                 // 1m
  2 * 60 * 1000,             // 2m
  5 * 60 * 1000,             // 5m
  10 * 60 * 1000,            // 10m
  15 * 60 * 1000,            // 15m
  20 * 60 * 1000,            // 20m
  30 * 60 * 1000,            // 30m
  45 * 60 * 1000,            // 45m
  60 * 60 * 1000,            // 1h
  2 * 60 * 60 * 1000,        // 2h
  3 * 60 * 60 * 1000,        // 3h
  4 * 60 * 60 * 1000,        // 4h
  6 * 60 * 60 * 1000,        // 6h
  8 * 60 * 60 * 1000,        // 8h
  12 * 60 * 60 * 1000,       // 12h
  24 * 60 * 60 * 1000,       // 1d (24h)
  2 * 24 * 60 * 60 * 1000,   // 2d
  3 * 24 * 60 * 60 * 1000,   // 3d
  7 * 24 * 60 * 60 * 1000,   // 7d (1w)
  14 * 24 * 60 * 60 * 1000,  // 14d (2w)
  30 * 24 * 60 * 60 * 1000,  // 30d (~1mo)
  60 * 24 * 60 * 60 * 1000,  // 60d (~2mo)
  90 * 24 * 60 * 60 * 1000,  // 90d (~1 quarter)
  180 * 24 * 60 * 60 * 1000, // 180d (~half year)
  365 * 24 * 60 * 60 * 1000, // 365d (1y)
];

export function formatTickLabel(ts: number, spansDays: boolean, stepMs: number): string {
  const d = new Date(ts);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${mins}`;

  // Se o passo for menor que 1 minuto, exibe também os segundos
  if (stepMs < 60 * 1000) {
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${timeStr}:${secs}`;
  }

  // Se o intervalo total abrange múltiplos dias
  if (spansDays) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    // Se o passo é de 1 dia ou mais (ex: 1d, 2d, 7d), basta a data sem hora
    if (stepMs >= 24 * 60 * 60 * 1000) {
      return `${day}/${month}`;
    }
    return `${day}/${month} ${timeStr}`;
  }

  return timeStr;
}

/**
 * Gera splits temporais para o Eixo de Tempo de forma totalmente adaptativa e robusta.
 * Aumenta ou diminui dinamicamente a quantidade de horários exibidos com base na largura horizontal (widthOrSplits).
 * Alinha perfeitamente os horários ao relógio local (00:00, 06:00, etc.) evitando sobreposição de textos.
 */
export function generateTimeAxisSplits(
  tStart: number,
  tEnd: number,
  widthOrSplits: number = 300
): TimeAxisSplit[] {
  const spanMs = Math.max(1, tEnd - tStart);
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || spanMs <= 0) {
    return [];
  }

  const minDate = new Date(tStart);
  const maxDate = new Date(tEnd);
  const spansDays =
    minDate.getDate() !== maxDate.getDate() ||
    minDate.getMonth() !== maxDate.getMonth() ||
    minDate.getFullYear() !== maxDate.getFullYear();

  // Determina a largura disponível em pixels
  // Se for passado um número pequeno (<= 30), interpreta como contagem alvo de splits
  const pixelWidth = widthOrSplits > 30 ? widthOrSplits : Math.max(60, widthOrSplits * 75);

  // Seleciona o melhor passo (step) onde a distância horizontal entre ticks não cause sobreposição
  let chosenStep = CANDIDATE_STEPS_MS[CANDIDATE_STEPS_MS.length - 1];

  for (const step of CANDIDATE_STEPS_MS) {
    const isStepDayPlus = step >= 24 * 60 * 60 * 1000;
    const labelIsLong = spansDays && !isStepDayPlus;
    // Rótulos como "21/10 14:00" precisam de ~85px; rótulos como "14:00" ou "21/10" precisam de ~55px
    const minSpacingPx = labelIsLong ? 85 : 55;

    const stepDistancePx = (step / spanMs) * pixelWidth;
    if (stepDistancePx >= minSpacingPx) {
      chosenStep = step;
      break;
    }
  }

  // Alinhamento ao relógio local
  let firstTick = tStart;
  if (chosenStep >= 24 * 60 * 60 * 1000) {
    const startDay = new Date(tStart);
    startDay.setHours(0, 0, 0, 0);
    let t = startDay.getTime();
    while (t < tStart) {
      t += chosenStep;
    }
    firstTick = t;
  } else {
    const tzOffsetMs = new Date(tStart).getTimezoneOffset() * 60 * 1000;
    const localTStart = tStart - tzOffsetMs;
    const firstLocalTick = Math.ceil(localTStart / chosenStep) * chosenStep;
    firstTick = firstLocalTick + tzOffsetMs;
  }

  const splits: TimeAxisSplit[] = [];

  for (let t = firstTick; t <= tEnd; t += chosenStep) {
    const pct = ((t - tStart) / spanMs) * 100;
    if (pct >= 0 && pct <= 100) {
      splits.push({
        timestamp: t,
        label: formatTickLabel(t, spansDays, chosenStep),
        pct,
      });
    }
  }

  // Garantia de robustez: se tiver menos de 2 splits (ex: janela muito curta ou container muito estreito),
  // exibe pelo menos os 2 extremos limpos
  if (splits.length < 2) {
    return [
      {
        timestamp: tStart,
        label: formatTickLabel(tStart, spansDays, chosenStep),
        pct: 0,
      },
      {
        timestamp: tEnd,
        label: formatTickLabel(tEnd, spansDays, chosenStep),
        pct: 100,
      },
    ];
  }

  return splits;
}

export interface ResponsiveTimeAxisProps {
  tStart: number;
  tEnd: number;
  fallbackWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const ResponsiveTimeAxis: React.FC<ResponsiveTimeAxisProps> = ({
  tStart,
  tEnd,
  fallbackWidth = 300,
  style,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(fallbackWidth);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return undefined;
    }

    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setMeasuredWidth((prev) => (Math.abs(prev - w) > 2 ? w : prev));
      }
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        measure();
      });
      ro.observe(el);
      return () => {
        ro.disconnect();
      };
    }

    return undefined;
  }, []);

  const splits = useMemo(() => {
    return generateTimeAxisSplits(tStart, tEnd, measuredWidth);
  }, [tStart, tEnd, measuredWidth]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '16px',
        lineHeight: '16px',
        overflow: 'hidden',
        userSelect: 'none',
        ...style,
      }}
    >
      {splits.map((split) => {
        const isStart = split.pct <= 3;
        const isEnd = split.pct >= 97;
        return (
          <div
            key={split.timestamp}
            style={{
              position: 'absolute',
              left: `${split.pct}%`,
              top: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: isStart ? 'flex-start' : isEnd ? 'flex-end' : 'center',
              transform: isStart
                ? 'translateX(0)'
                : isEnd
                ? 'translateX(-100%)'
                : 'translateX(-50%)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Pequeno traço superior indicando a marcação precisa do tick */}
            <div
              style={{
                width: 1,
                height: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.25)',
                marginBottom: 1,
                alignSelf: isStart ? 'flex-start' : isEnd ? 'flex-end' : 'center',
              }}
            />
            <span
              style={{
                fontSize: '10px',
                lineHeight: '13px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                color: 'rgba(255, 255, 255, 0.52)',
                whiteSpace: 'nowrap',
              }}
            >
              {split.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Retorna o estilo industrial vitrificado padronizado para ícones.
 * Quando habilitado (contained), o fundo, a borda e o brilho sutil assumem dinamicamente a cor do próprio ícone.
 */
export function getGlassyIconStyle(
  iconColor: string,
  isContained = true,
  size = 22,
  borderRadius = 5
): React.CSSProperties {
  if (!isContained) {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      backgroundColor: 'transparent',
      border: 'none',
      boxShadow: 'none',
      flexShrink: 0,
    };
  }

  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius,
    backgroundColor: `color-mix(in srgb, ${iconColor} 18%, transparent)`,
    border: `1px solid color-mix(in srgb, ${iconColor} 30%, transparent)`,
    boxShadow: `0 0 6px color-mix(in srgb, ${iconColor} 16%, transparent)`,
    flexShrink: 0,
    transition: 'all 0.2s ease',
  };
}

export interface WindowDiagnosisResult {
  text: string;
  color: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

/**
 * Gera o texto e a cor correspondente do diagnóstico exclusivo da janela de tempo.
 * Nunca retorna números soltos; sempre contextualizado.
 */
export function getWindowDiagnosisText(
  hostData: {
    tStart: number;
    tEnd: number;
    episodes?: AlertEpisode[];
    isActiveNow: boolean;
    corDoThreshold?: string;
  },
  tStartOverride?: number,
  tEndOverride?: number
): WindowDiagnosisResult {
  const tStart = tStartOverride ?? hostData.tStart;
  const tEnd = tEndOverride ?? hostData.tEnd;
  const windowDurationMs = Math.max(0, tEnd - tStart);
  const episodes = hostData.episodes || [];
  const alertColor = hostData.corDoThreshold || '#F2495C';

  // F: 5 ou mais quedas
  if (episodes.length >= 5) {
    const totalDurationMs = episodes.reduce((acc, ep) => acc + ep.durationMs, 0);
    return {
      text: `Intermitente: ${episodes.length} quedas (${formatDuration(totalDurationMs)} acum.)`,
      color: alertColor,
      category: 'F',
    };
  }

  // Se o host está em violação ativa agora
  if (hostData.isActiveNow) {
    const activeEp = episodes.find((ep) => ep.isActiveNow);
    const startTs = activeEp?.startTs ?? tStart;
    const failureDurationMs = activeEp ? Math.max(activeEp.durationMs, tEnd - startTs) : windowDurationMs;

    // C: Em falha 100% da janela visível
    const isFullWindow = (startTs <= tStart + 2000) && (failureDurationMs >= windowDurationMs * 0.95);
    if (isFullWindow || episodes.length === 0) {
      return {
        text: `Em falha por toda a janela (> ${formatDuration(windowDurationMs)})`,
        color: alertColor,
        category: 'C',
      };
    }

    // B: Entrou em falha e CONTINUA
    return {
      text: `Em falha há ${formatDuration(failureDurationMs)} (desde ${formatTimeHHmm(startTs)})`,
      color: alertColor,
      category: 'B',
    };
  }

  // A: Nenhuma violação
  if (episodes.length === 0) {
    return {
      text: 'Estável em toda a janela',
      color: 'rgba(255, 255, 255, 0.45)',
      category: 'A',
    };
  }

  // D: 1 queda apenas (já normalizada)
  if (episodes.length === 1) {
    const ep = episodes[0];
    const normTime = formatTimeHHmm(ep.endTs);
    const dropDuration = formatDuration(ep.durationMs);
    return {
      text: `Normalizado às ${normTime} (1 queda de ${dropDuration})`,
      color: '#EAB839',
      category: 'D',
    };
  }

  // E: 2 a 4 quedas
  const totalDurationMs = episodes.reduce((acc, ep) => acc + ep.durationMs, 0);
  return {
    text: `Oscilou ${episodes.length}x na janela (${formatDuration(totalDurationMs)} acum.)`,
    color: '#EAB839',
    category: 'E',
  };
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    container: css`
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: linear-gradient(180deg, #0d1720 0%, #0c141d 55%, #0b121a 100%);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};

      .u-select {
        background: rgba(128, 128, 128, 0.2);
        outline: 1px solid rgba(128, 128, 128, 0.4);
        outline-offset: -1px;
        border: none !important;
        position: absolute;
        pointer-events: none;
        z-index: 10;
      }
    `,
    scrollContainer: css`
      position: relative;
      width: 100%;
      height: 100%;
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      box-sizing: border-box;

      /* Scrollbar industrial suave OT */
      &::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      &::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.15);
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 3px;
      }
      &::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.22);
      }
    `,
    table: css`
      width: 100%;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: auto;
      font-size: 11.5px;
      line-height: 1.35;
      color: #e2e8f0;
    `,
    thead: css`
      position: sticky;
      top: 0;
      z-index: 10;
      background: #0c141d;
    `,
    th: css`
      position: sticky;
      top: 0;
      z-index: 10;
      background-color: #0c141d;
      color: rgba(255, 255, 255, 0.5);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      padding: 4px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
      box-sizing: border-box;
      text-align: left;
    `,
    tr: css`
      min-height: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.035);
      transition: background-color 0.12s ease;
      &:hover {
        background: rgba(255, 255, 255, 0.045) !important;
      }
    `,
    td: css`
      padding: 4px 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
      box-sizing: border-box;
      color: rgba(255, 255, 255, 0.85);
    `,
    tfoot: css`
      position: sticky;
      bottom: 0;
      z-index: 10;
      background: #0c141d;
    `,
    tfootTd: css`
      position: sticky;
      bottom: 0;
      z-index: 10;
      background-color: #0c141d;
      color: rgba(255, 255, 255, 0.45);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      padding: 4px 8px;
      user-select: none;
      box-sizing: border-box;
      box-shadow: 0 -3px 8px rgba(0, 0, 0, 0.5);
    `,
    colResizer: css`
      position: absolute;
      right: 0;
      top: 22%;
      bottom: 22%;
      width: 1px;
      cursor: col-resize;
      background: rgba(255, 255, 255, 0.18);
      user-select: none;
      z-index: 2;
      transition: background 0.15s ease;
      &::before {
        content: '';
        position: absolute;
        top: -6px;
        bottom: -6px;
        left: -4px;
        right: -4px;
      }
      &:hover,
      &:active {
        background: #38bdf8;
      }
    `,
    emptyState: css`
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(255, 255, 255, 0.4);
      font-size: 12px;
    `,
    globalCrosshairLine: css`
      position: absolute;
      top: 0;
      bottom: 0;
      width: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.4);
      pointer-events: none;
      z-index: 25;
      display: none;
    `,
    globalCrosshairTimeBadge: css`
      position: absolute;
      top: 4px;
      transform: translateX(-50%);
      background: rgba(12, 20, 29, 0.95);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      font-size: 9.5px;
      font-weight: 500;
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    `,
  };
};

export let currentActivePanelMode: 'table' | 'singleHost' | 'heatmap' = 'table';

export const TablePanel: React.FC<Props> = ({
  id: panelId,
  options,
  data,
  width,
  height,
  fieldConfig,
  timeRange,
  onChangeTimeRange,
}) => {
  currentActivePanelMode = options.panelMode ?? 'table';
  if (typeof window !== 'undefined') {
    (window as any).__VALE_PANEL_MODE__ = currentActivePanelMode;
  }
  const theme = useTheme2();
  const styles = useStyles2(getStyles);

  const handleCellTimeZoom = useCallback(
    (range: { from: number; to: number }) => {
      if (onChangeTimeRange) {
        onChangeTimeRange({
          from: range.from,
          to: range.to,
        });
      }
    },
    [onChangeTimeRange]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const crosshairLineRef = useRef<HTMLDivElement>(null);
  const crosshairTimeRef = useRef<HTMLDivElement>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(height || 300);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: 'asc' | 'desc';
  }>({ column: null, direction: 'asc' });

  const handleResizeMouseDown = useCallback((colKey: string, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const thEl = e.currentTarget.parentElement as HTMLElement | null;
    const fallbackWidth =
      colKey === '__heatmap_host__'
        ? (options.heatmapHostWidth || 180)
        : colKey === '__heatmap_now__'
        ? (options.heatmapNowWidth || 70)
        : 140;
    const startWidth = thEl ? thEl.getBoundingClientRect().width : (colWidths[colKey] || fallbackWidth);

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaX =
        colKey === '__heatmap_now__'
          ? startX - moveEvent.clientX
          : moveEvent.clientX - startX;
      const minW = colKey === '__heatmap_now__' ? 45 : 60;
      const newWidth = Math.max(minW, Math.round(startWidth + deltaX));
      setColWidths((prev) => ({
        ...prev,
        [colKey]: newWidth,
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [colWidths, options.heatmapHostWidth, options.heatmapNowWidth]);

  const handleSort = useCallback((colKey: string) => {
    setSortConfig((prev) => {
      if (prev.column === colKey) {
        if (prev.direction === 'asc') {
          return { column: colKey, direction: 'desc' };
        }
        return { column: null, direction: 'asc' };
      }
      return { column: colKey, direction: 'asc' };
    });
  }, []);

  // Estado isolado exclusivamente para este painel (baseado em panelId)
  const [interactionState, setInteractionState] = useState<{
    hoveredTimestamp: number | null;
    hoveredColumnKey: string | null;
    clientX: number | null;
  }>({
    hoveredTimestamp: null,
    hoveredColumnKey: null,
    clientX: null,
  });

  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterConfig>>({});

  const handleApplyColumnFilter = useCallback((colKey: string, filter: ColumnFilterConfig | null) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!filter) {
        delete next[colKey];
      } else {
        next[colKey] = filter;
      }
      return next;
    });
  }, []);

  const numBuckets = options.heatmapBuckets ?? 40;

  useLayoutEffect(() => {
    if (scrollRef.current) {
      setViewportHeight(scrollRef.current.clientHeight || height || 300);
    }
  }, [height]);

  // Posiciona a linha guia vertical pontilhada exclusivamente neste painel via PanelInteractionContext
  useLayoutEffect(() => {
    const lineEl = crosshairLineRef.current;
    const containerEl = containerRef.current;
    if (!lineEl || !containerEl) {
      return;
    }
    if (
      interactionState.hoveredTimestamp === null ||
      interactionState.clientX === null
    ) {
      lineEl.style.display = 'none';
      return;
    }
    const rect = containerEl.getBoundingClientRect();
    const relX = interactionState.clientX - rect.left;
    if (relX >= 0 && relX <= rect.width) {
      lineEl.style.display = 'block';
      lineEl.style.left = `${relX}px`;
      if (crosshairTimeRef.current) {
        crosshairTimeRef.current.textContent = formatTimeHHmmss(
          interactionState.hoveredTimestamp
        );
      }
    } else {
      lineEl.style.display = 'none';
    }
  }, [interactionState]);

  const setInteraction = useCallback(
    (payload: {
      hoveredTimestamp: number | null;
      hoveredColumnKey: string | null;
      clientX?: number | null;
    }) => {
      setInteractionState((prev) => {
        const nextClientX = payload.clientX ?? null;
        if (
          prev.hoveredTimestamp === payload.hoveredTimestamp &&
          prev.hoveredColumnKey === payload.hoveredColumnKey &&
          prev.clientX === nextClientX
        ) {
          return prev;
        }
        return {
          hoveredTimestamp: payload.hoveredTimestamp,
          hoveredColumnKey: payload.hoveredColumnKey,
          clientX: nextClientX,
        };
      });
    },
    []
  );

  const clearInteraction = useCallback(() => {
    setInteractionState((prev) => {
      if (
        prev.hoveredTimestamp === null &&
        prev.hoveredColumnKey === null &&
        prev.clientX === null
      ) {
        return prev;
      }
      return {
        hoveredTimestamp: null,
        hoveredColumnKey: null,
        clientX: null,
      };
    });
  }, []);

  const panelInteractionContextValue = useMemo<PanelInteractionContextValue>(
    () => ({
      panelId: panelId ?? 0,
      hoveredTimestamp: interactionState.hoveredTimestamp,
      hoveredColumnKey: interactionState.hoveredColumnKey,
      clientX: interactionState.clientX,
      setInteraction,
      clearInteraction,
    }),
    [panelId, interactionState, setInteraction, clearInteraction]
  );

  // Virtualização: Atualiza scrollTop no onScroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);
    if (e.currentTarget.clientHeight && e.currentTarget.clientHeight !== viewportHeight) {
      setViewportHeight(e.currentTarget.clientHeight);
    }
  }, [viewportHeight]);

  const tStart = data.timeRange?.from?.valueOf() ?? Date.now() - 3600000;
  const tEnd = data.timeRange?.to?.valueOf() ?? Date.now();
  const disconnectThreshold = options.disconnectThreshold ?? 'auto';

  // ── 1. Lógica de Agrupamento Matricial (Pivot: Linhas = Hosts, Colunas = Métricas) ──
  const { matrix, uniqueHosts, uniqueMetrics } = useMemo(() => {
    if (!data?.series?.length) {
      return { matrix: {}, uniqueHosts: [], uniqueMetrics: [] };
    }

    const mat: Record<string, Record<string, MetricCellData>> = {};
    const hostsSet = new Set<string>();
    const metricsSet = new Set<string>();

    // 1. Verifica se qualquer série possui identificador explícito de host (via labels ou campos string)
    let anyExplicitHostInDataset = false;
    data.series.forEach((df) => {
      if (
        df.fields.some(
          (f) =>
            f.type === FieldType.string &&
            /^(host|device|server|hostname|nodename|node|equipamento|ativo|nome|name)$/i.test(f.name)
        )
      ) {
        anyExplicitHostInDataset = true;
      }
      df.fields.forEach((f) => {
        if (
          f.labels?.host ||
          f.labels?.device ||
          f.labels?.instance ||
          f.labels?.hostname ||
          f.labels?.nodename ||
          f.labels?.node ||
          f.labels?.server ||
          f.labels?.target ||
          f.labels?.Host ||
          f.labels?.Device ||
          f.labels?.Server ||
          f.labels?.Instance
        ) {
          anyExplicitHostInDataset = true;
        }
      });
    });

    data.series.forEach((df, dfIndex) => {
      const timeField = df.fields.find((f) => f.type === FieldType.time);
      const timeValues: number[] = timeField
        ? Array.isArray(timeField.values)
          ? timeField.values
          : Array.from(timeField.values as any)
        : [];

      // Procura campo de string de host específico deste DataFrame
      const stringHostField = df.fields.find(
        (f) =>
          f.type === FieldType.string &&
          /^(host|device|server|hostname|nodename|node|equipamento|ativo|nome|name)$/i.test(f.name)
      );
      const stringHostVal =
        stringHostField && stringHostField.values.length > 0 && typeof stringHostField.values[0] === 'string'
          ? stringHostField.values[0].trim()
          : '';

      // Aceita campos numéricos e strings (exceto o próprio campo de identificação de host)
      const dataFields = df.fields.filter(
        (f) =>
          (f.type === FieldType.number || f.type === FieldType.string) &&
          f !== stringHostField
      );

      dataFields.forEach((targetField, targetFieldIndex) => {
        const isStringField = targetField.type === FieldType.string;
        const values: any[] = Array.isArray(targetField.values)
          ? targetField.values
          : Array.from(targetField.values as any);

        const custom = getEffectiveCustomConfig(targetField, fieldConfig);

        // 1. Extração do Host por labels ou campo string
        const labelHost =
          targetField.labels?.host ||
          targetField.labels?.device ||
          targetField.labels?.instance ||
          targetField.labels?.hostname ||
          targetField.labels?.nodename ||
          targetField.labels?.node ||
          targetField.labels?.server ||
          targetField.labels?.target ||
          targetField.labels?.Host ||
          targetField.labels?.Device ||
          targetField.labels?.Server ||
          targetField.labels?.Instance ||
          stringHostVal;

        // Separador em displayName (ex: "Host: Métrica" ou "Group : Host : Métrica")
        // Preserva o displayName original do datasource para não sofrer mutação em re-renders
        targetField.state = targetField.state || {};
        if (!(targetField.state as any).__origDisplayName) {
          (targetField.state as any).__origDisplayName = getFieldDisplayName(targetField, df).trim();
        }
        const rawDisplayName: string = (targetField.state as any).__origDisplayName;
        const sepSegments = rawDisplayName
          .split(/\s*(?::\s*|\s+-\s+|\s+\/\s+|\s+>\s+|\s+·\s+)/)
          .map((s) => s.trim())
          .filter(Boolean);

        let sepHost = '';
        let sepMetric = '';
        if (sepSegments.length === 2) {
          sepHost = sepSegments[0];
          sepMetric = sepSegments[1];
        } else if (sepSegments.length >= 3) {
          // Em formatos com 3+ partes (ex: "DCDC : SW-01 : ICMP ping" ou "Grupo : Host : Item"):
          // O último segmento é sempre o nome do Item/Métrica!
          sepMetric = sepSegments[sepSegments.length - 1];
          if (labelHost && sepSegments.includes(labelHost)) {
            sepHost = labelHost;
          } else {
            sepHost = sepSegments[sepSegments.length - 2] || sepSegments[0];
          }
        }

        // Fallback para displayNameFromDS caso displayName não tenha separador
        const dsName = targetField.config?.displayNameFromDS?.trim();
        if (!sepMetric && dsName) {
          const dsSegments = dsName
            .split(/\s*(?::\s*|\s+-\s+|\s+\/\s+|\s+>\s+|\s+·\s+)/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (dsSegments.length >= 2) {
            sepMetric = dsSegments[dsSegments.length - 1];
            if (!sepHost) {
              sepHost = dsSegments[0];
            }
          } else if (dsSegments.length === 1 && !isGenericName(dsSegments[0])) {
            sepMetric = dsSegments[0];
          }
        }

        // 2. Extração da Métrica por labels específicas de métrica/item (evita tags genéricas como 'name' ou 'key')
        const labelMetric =
          targetField.labels?.item ||
          targetField.labels?.item_name ||
          targetField.labels?.itemName ||
          targetField.labels?.itemname ||
          targetField.labels?.Item ||
          targetField.labels?.metric ||
          targetField.labels?.Metric ||
          targetField.labels?.metric_name ||
          targetField.labels?.__name__ ||
          targetField.labels?.item_description;

        // 3. Resolução rigorosa do Nome Base da Métrica vindo do Zabbix (sem overrides de label)
        let baseZabbixMetric = '';
        if (labelMetric) {
          baseZabbixMetric = labelMetric;
        } else if (sepMetric) {
          baseZabbixMetric = sepMetric;
        } else if (!isGenericName(targetField.name) && targetField.name !== labelHost && targetField.name !== sepHost) {
          baseZabbixMetric = targetField.name;
        } else if (!isGenericName(df.name) && df.name !== labelHost && df.name !== sepHost) {
          baseZabbixMetric = df.name!;
        } else if (!isGenericName(rawDisplayName) && rawDisplayName !== labelHost && rawDisplayName !== sepHost) {
          baseZabbixMetric = rawDisplayName;
        } else if (df.refId) {
          baseZabbixMetric = `Métrica ${df.refId}`;
        } else {
          baseZabbixMetric = dataFields.length > 1 ? `Métrica ${targetFieldIndex + 1}` : `Métrica ${dfIndex + 1}`;
        }

        // Atualiza displayName no state do field com o nome real da métrica do Zabbix
        // para que o seletor de Overrides ("Fields with name") sempre reconheça a métrica original
        targetField.state.displayName = String(baseZabbixMetric).trim() || 'Métrica';

        // No modo Heatmap, o nome da métrica vem sempre do Zabbix e só é sobrescrito por
        // options.heatmapCustomLabel ("Rótulo do Cabeçalho (Heatmap)" no menu do Heatmap).
        // Nos modos de Tabela / Host Único, aceita sobrescrita via Override Properties ('label').
        const overrideCustomLabel =
          options.panelMode === 'heatmap'
            ? undefined
            : getFieldOverrideProperty<string>(targetField, 'label', fieldConfig)?.trim();

        const resolvedMetric = overrideCustomLabel || baseZabbixMetric;

        // 4. Resolução do Nome do Host
        let resolvedHost = '';
        if (labelHost) {
          resolvedHost = labelHost;
        } else if (sepHost) {
          resolvedHost = sepHost;
        } else if (anyExplicitHostInDataset) {
          resolvedHost = (!isGenericName(df.name) && df.name !== resolvedMetric) ? df.name! : 'Geral';
        } else {
          // Quando não há host explícito em nenhuma série do dataset, todas as séries são métricas do mesmo host/painel!
          resolvedHost = 'Host / Dispositivo';
        }

        let cleanHost = String(resolvedHost).trim() || 'Host';
        let cleanMetric = String(resolvedMetric).trim() || 'Métrica';

        // Garante que métricas com mesmo nome não se sobrescrevam
        if (mat[cleanHost] && mat[cleanHost][cleanMetric]) {
          const suffix = df.refId ? ` (${df.refId})` : ` (#${dfIndex + 1})`;
          cleanMetric = `${cleanMetric}${suffix}`;
        }

        const exactMatch = getFieldExactMatch(targetField, options.exactThresholdMatch, fieldConfig);
        const thresholds = getFieldThresholds(targetField, theme, fieldConfig);

        // Escaneia de trás para frente para achar o último valor válido
        let lastVal: number | string | null = null;
        if (isStringField) {
          for (let i = values.length - 1; i >= 0; i--) {
            const v = values[i];
            if (v !== null && v !== undefined && String(v).trim() !== '') {
              lastVal = String(v);
              break;
            }
          }
        } else {
          for (let i = values.length - 1; i >= 0; i--) {
            const v = values[i];
            if (v !== null && v !== undefined && !isNaN(v as number)) {
              lastVal = v as number;
              break;
            }
          }
        }

        // Formatação do valor (com suporte nativo a Value Mapping e cores)
        const formattedLastVal =
          lastVal !== null ? formatFieldValue(lastVal, targetField, theme) : { text: '—' };

        const overrideCompMode = targetField
          ? getFieldOverrideProperty<ThresholdComparisonMode>(targetField, 'thresholdComparisonMode', fieldConfig)
          : undefined;
        const comparisonMode: ThresholdComparisonMode =
          overrideCompMode ??
          options.thresholdComparisonMode ??
          (exactMatch ? 'eq' : 'gte');

        // Histórico de episódios na janela (apenas para métricas numéricas com thresholds)
        const episodes = !isStringField
          ? getAlertEpisodes(
              values as number[],
              timeValues,
              thresholds,
              tStart,
              tEnd,
              comparisonMode,
              disconnectThreshold
            )
          : [];

        // Avaliação universal via resolveColumnThreshold
        const thrResult = resolveColumnThreshold(
          !isStringField && typeof lastVal === 'number' ? lastVal : null,
          thresholds,
          comparisonMode,
          theme
        );

        const isCurrentStepViolation = thrResult.isViolation;
        const hasActiveEpisode = episodes.some((ep) => ep.isActiveNow);
        const isActiveNow = isCurrentStepViolation || hasActiveEpisode;

        // Determina a cor do threshold violado (para destaque)
        let corDoThreshold = '#F2495C';
        if (isCurrentStepViolation) {
          corDoThreshold = thrResult.color;
        } else if (hasActiveEpisode) {
          const highestActive = episodes.find((ep) => ep.isActiveNow);
          if (highestActive) {
            corDoThreshold = resolveAlertHexColor(highestActive.color);
          }
        } else if (formattedLastVal.color) {
          corDoThreshold = formattedLastVal.color;
        } else {
          corDoThreshold = thrResult.color;
        }

        const hasHistoricalAlert = !isActiveNow && episodes.length > 0;
        const isHealthy = !isActiveNow && !hasHistoricalAlert;

        const badge = !isStringField
          ? getBadgeState(
              typeof lastVal === 'number' ? lastVal : null,
              values as number[],
              timeValues,
              thresholds,
              tStart,
              tEnd,
              theme,
              corDoThreshold,
              comparisonMode,
              disconnectThreshold
            )
          : { state: 'normal' as const, color: '', episodes: [] };

        let minVal: number | null = null;
        let maxVal: number | null = null;
        let avgVal: number | null = null;

        if (!isStringField) {
          const validValues = values
            .filter((v) => v !== null && v !== undefined && !isNaN(Number(v)))
            .map(Number);
          minVal = validValues.length ? Math.min(...validValues) : null;
          maxVal = validValues.length ? Math.max(...validValues) : null;
          avgVal = validValues.length
            ? validValues.reduce((a, b) => a + b, 0) / validValues.length
            : null;
        }

        const iconName = resolveIconName(custom.icon || 'server');

        // Lê displayMode vindo do Override do Grafana (ou pacote composto) ou das opções gerais do painel
        // Campos string sempre renderizam normalmente usando o estilo "Texto/Valor"
        const overrideMode = getFieldOverrideProperty<string>(targetField, 'cellDisplayMode', fieldConfig);
        const rawMode =
          overrideMode ||
          custom.cellDisplayMode ||
          custom.displayMode ||
          custom.statusDisplayMode ||
          options.cellDisplayMode ||
          options.displayMode ||
          options.statusDisplayMode ||
          'text';
        let resolvedMode = String(rawMode).toLowerCase();
        if (resolvedMode === 'auto') {
          resolvedMode = 'text';
        }
        const displayMode = isStringField ? 'text' : resolvedMode;

        const cellData: MetricCellData = {
          id: `${df.refId || ''}_${targetField.name}_${cleanHost}_${cleanMetric}`,
          hostName: cleanHost,
          metricName: cleanMetric,
          field: targetField,
          values,
          timeValues,
          lastVal,
          formattedLastVal,
          isActiveNow,
          corDoThreshold,
          hasHistoricalAlert,
          isHealthy,
          episodes,
          badge,
          minVal,
          maxVal,
          avgVal,
          iconName,
          activeStepValue:
            thrResult.activeStep?.value !== null && thrResult.activeStep?.value !== undefined
              ? Number(thrResult.activeStep.value)
              : undefined,
          lastEpisodeStart: episodes.length > 0 ? episodes[0].startTs : undefined,
          tStart,
          tEnd,
          thresholds,
          exactMatch,
          comparisonMode,
          displayMode,
        };

        hostsSet.add(cleanHost);
        metricsSet.add(cleanMetric);

        if (!mat[cleanHost]) {
          mat[cleanHost] = {};
        }
        mat[cleanHost][cleanMetric] = cellData;
      });
    });

    return {
      matrix: mat,
      uniqueHosts: Array.from(hostsSet),
      uniqueMetrics: Array.from(metricsSet),
    };
  }, [data, options, fieldConfig, theme, tStart, tEnd, disconnectThreshold]);

  // ── 2. Ordenação Inteligente Padrão dos Hosts (Linhas) ──────────────────────
  // Desempate:
  // 1º: isActiveNow === true (ainda em falha/alerta agora)
  // 2º: Histórico na janela (já normalizou, mas falhou no período filtrado)
  // 3º: 100% Saudáveis (ordem alfabética)
  const sortedHosts: HostRowData[] = useMemo(() => {
    const list: HostRowData[] = uniqueHosts.map((hostName) => {
      const hostMetrics = matrix[hostName] || {};
      const metricsArray = Object.values(hostMetrics);

      const isActiveNow = metricsArray.some((m) => m.isActiveNow);
      const activeMetrics = metricsArray.filter((m) => m.isActiveNow);
      const highestActive = activeMetrics.sort(
        (a, b) => (b.activeStepValue ?? 0) - (a.activeStepValue ?? 0)
      )[0];
      const corDoThreshold = highestActive ? highestActive.corDoThreshold : '#F2495C';

      const hasHistoricalAlert = !isActiveNow && metricsArray.some((m) => m.hasHistoricalAlert);
      const isHealthy = !isActiveNow && !hasHistoricalAlert;

      const activeStepValue = highestActive?.activeStepValue ?? 0;
      const lastEpisodeStart = metricsArray.reduce(
        (maxTs, m) => Math.max(maxTs, m.lastEpisodeStart ?? 0),
        0
      );

      const iconName = resolveIconName(
        options.panelMode === 'heatmap'
          ? (options.heatmapHostIconName || options.hostIconName || 'server')
          : (options.hostIconName || 'server')
      );

      return {
        hostName,
        iconName,
        isActiveNow,
        corDoThreshold,
        hasHistoricalAlert,
        isHealthy,
        activeStepValue,
        lastEpisodeStart,
        metrics: hostMetrics,
      };
    });

    // 1. Ordenação sob demanda via clique no cabeçalho <th>
    if (sortConfig.column === '__host__') {
      return list.sort((a, b) => {
        const cmp = a.hostName.localeCompare(b.hostName, undefined, { numeric: true, sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      });
    }

    if (sortConfig.column) {
      const col = sortConfig.column;
      return list.sort((a, b) => {
        const aMetric = a.metrics[col];
        const bMetric = b.metrics[col];

        if (!aMetric && !bMetric) return 0;
        if (!aMetric) return 1;
        if (!bMetric) return -1;

        const aVal = aMetric.lastVal;
        const bVal = bMetric.lastVal;

        if ((aVal === null || aVal === undefined) && (bVal === null || bVal === undefined)) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        let res = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          res = aVal - bVal;
        } else {
          res = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
        }

        return sortConfig.direction === 'asc' ? res : -res;
      });
    }

    // 2. Ordenação Padrão Inteligente NOC (Alertas Ativos -> Histórico -> Saudáveis)
    return list.sort((a, b) => {
      // 1º: isActiveNow === true
      const aActive = a.isActiveNow ? 1 : 0;
      const bActive = b.isActiveNow ? 1 : 0;
      if (aActive !== bActive) {
        return bActive - aActive;
      }

      if (a.isActiveNow && b.isActiveNow) {
        const aVal = a.activeStepValue ?? 0;
        const bVal = b.activeStepValue ?? 0;
        if (aVal !== bVal) {
          return bVal - aVal;
        }
      }

      // 2º: Histórico na janela
      const aHist = a.hasHistoricalAlert ? 1 : 0;
      const bHist = b.hasHistoricalAlert ? 1 : 0;
      if (aHist !== bHist) {
        return bHist - aHist;
      }

      if (a.hasHistoricalAlert && b.hasHistoricalAlert) {
        const aStart = a.lastEpisodeStart ?? 0;
        const bStart = b.lastEpisodeStart ?? 0;
        if (aStart !== bStart) {
          return bStart - aStart;
        }
      }

      // 3º: 100% Saudáveis (ordem alfabética por nome do Host)
      return a.hostName.localeCompare(b.hostName, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [uniqueHosts, matrix, sortConfig, options.hostIconName, options.heatmapHostIconName, options.panelMode]);

  // ── 3. Renderização Dinâmica de Célula via switch/case baseado no displayMode ──
  const renderMetricCell = (
    s: MetricCellData,
    hostName: string,
    metricName: string,
    mode: string
  ) => {
    const isStringField = s.field.type === FieldType.string;
    const effectiveMode = isStringField ? 'text' : mode;

    const custom = getEffectiveCustomConfig(s.field, fieldConfig);
    const overrideUseThreshold = s?.field
      ? getFieldOverrideProperty<boolean>(s.field, 'useThresholdColors', fieldConfig)
      : undefined;
    const useThresholdColors = Boolean(
      overrideUseThreshold !== undefined
        ? overrideUseThreshold
        : (options.useThresholdColors ?? false)
    );
    const defaultTextColor = 'rgba(255, 255, 255, 0.72)';
    const overrideCompMode = s?.field
      ? getFieldOverrideProperty<ThresholdComparisonMode>(s.field, 'thresholdComparisonMode', fieldConfig)
      : undefined;
    const compMode: ThresholdComparisonMode =
      overrideCompMode ??
      s.comparisonMode ??
      options.thresholdComparisonMode ??
      (s.exactMatch ? 'eq' : 'gte');
    const thrResult = resolveColumnThreshold(
      typeof s.lastVal === 'number' ? s.lastVal : null,
      s.thresholds,
      compMode,
      theme
    );

    const textColor = useThresholdColors
      ? (s.isActiveNow
          ? s.corDoThreshold
          : (thrResult.isViolation ? thrResult.color : defaultTextColor))
      : defaultTextColor;

    // Configuração do botão ! e Pop-up de alerta (respeita override específico e fallback global do painel)
    const overrideEnableAlert = s?.field
      ? getFieldOverrideProperty<boolean>(s.field, 'enableAlertPopup', fieldConfig)
      : undefined;
    const enableAlertPopup = overrideEnableAlert !== undefined
      ? overrideEnableAlert
      : (options.enableAlertPopup ?? true);

    const overrideAlertMode = s?.field
      ? getFieldOverrideProperty<'always' | 'alertOnly'>(s.field, 'alertPopupDisplayMode', fieldConfig)
      : undefined;
    const alertPopupMode = overrideAlertMode ?? options.alertPopupDisplayMode ?? 'always';
    const hasHistoricalProblem = Boolean(s.hasHistoricalAlert || (s.episodes && s.episodes.length > 0));
    const hasActiveProblem = Boolean(s.isActiveNow);
    const hasAnyAlert = hasActiveProblem || hasHistoricalProblem;

    const canShowAlert = enableAlertPopup && (
      alertPopupMode === 'alertOnly'
        ? hasActiveProblem
        : hasAnyAlert
    );

    const effectiveBadge: BadgeInfo =
      s.badge && s.badge.state !== 'normal'
        ? s.badge
        : {
            state: s.isActiveNow ? 'active' : s.hasHistoricalAlert ? 'historical' : 'normal',
            color: s.corDoThreshold || (s.hasHistoricalAlert ? '#EAB839' : '#F2495C'),
            episodes: s.episodes || [],
          };

    const renderAlertButton = () => {
      if (!canShowAlert) return null;
      return (
        <AlertBadgePopover
          badge={effectiveBadge}
          tStart={tStart}
          tEnd={tEnd}
          styles={styles}
          field={s.field}
          exactMatch={compMode === 'eq'}
          comparisonMode={compMode}
          fieldConfig={fieldConfig}
          metricLabel={`${hostName} · ${metricName}`}
          currentValueText={s.formattedLastVal.text}
          currentValueColor={textColor}
          size={18}
          allowNormal={false}
        />
      );
    };

    switch (effectiveMode) {
      case 'timeseries':
      case 'sparkline': {
        const rawValueMode = custom.timeSeriesValueMode || options.timeSeriesValueMode || 'text';
        const valueMode: 'badge' | 'text' | 'hidden' =
          rawValueMode === 'badge' || rawValueMode === 'hidden' ? rawValueMode : 'text';

        const overrideFollowThreshold = s?.field
          ? getFieldOverrideProperty<boolean>(s.field, 'sparklineFollowThreshold', fieldConfig)
          : undefined;
        const followThreshold = Boolean(
          overrideFollowThreshold ??
          custom.sparklineFollowThreshold ??
          options.sparklineFollowThreshold ??
          false
        );
        // Respeita estritamente a cor configurada na coluna (lineColor) quando definida pelo usuário (override ou custom)
        const overrideLineColor = s?.field
          ? getFieldOverrideProperty<string>(s.field, 'lineColor', fieldConfig)
          : undefined;
        const customLineColor = (overrideLineColor ?? custom.lineColor)?.trim();
        const hasCustomLineColor = Boolean(customLineColor);
        const normalLineColor = hasCustomLineColor
          ? customLineColor!
          : (thrResult.baseStep?.color ? resolveAlertHexColor(thrResult.baseStep.color) : '#00B59B');
        const activeLineColor = followThreshold
          ? (s.isActiveNow
              ? s.corDoThreshold
              : (thrResult.isViolation ? thrResult.color : normalLineColor))
          : normalLineColor;

        const badgeColor = useThresholdColors
          ? (s.isActiveNow
              ? s.corDoThreshold
              : (thrResult.isViolation ? thrResult.color : (s.formattedLastVal.color || thrResult.color)))
          : (s.formattedLastVal.color || undefined);

        const overrideBinaryStep = s?.field
          ? getFieldOverrideProperty<boolean>(s.field, 'binaryStepHighlight', fieldConfig)
          : undefined;
        const binaryStep = Boolean(
          overrideBinaryStep ??
          custom.binaryStepHighlight ??
          options.binaryStepHighlight ??
          false
        );
        const overrideLineWidth = s?.field
          ? getFieldOverrideProperty<number>(s.field, 'lineWidth', fieldConfig)
          : undefined;
        const resolvedLineWidth = overrideLineWidth ?? custom.lineWidth ?? 1.5;

        const overrideAreaOpacity = s?.field
          ? getFieldOverrideProperty<number>(s.field, 'areaOpacity', fieldConfig)
          : undefined;
        const resolvedAreaOpacity = overrideAreaOpacity ?? custom.areaOpacity ?? custom.sparklineFillOpacity ?? 25;

        const overrideLineOpacity = s?.field
          ? getFieldOverrideProperty<number>(s.field, 'sparklineLineOpacity', fieldConfig)
          : undefined;
        const resolvedLineOpacity = overrideLineOpacity ?? custom.sparklineLineOpacity ?? 100;

        const overrideInterpolation = s?.field
          ? getFieldOverrideProperty<LineInterpolation>(s.field, 'lineInterpolation', fieldConfig)
          : undefined;
        const resolvedInterpolation = (overrideInterpolation ?? custom.lineInterpolation) || 'smooth';

        const overrideSparklineHeight = s?.field
          ? getFieldOverrideProperty<number>(s.field, 'sparklineHeight', fieldConfig)
          : undefined;
        const resolvedSparklineHeight = overrideSparklineHeight ?? custom.sparklineHeight;

        const rowSeries: SparklineSeries[] = [
          {
            name: metricName,
            field: s.field,
            values: s.values,
            color: activeLineColor,
            lineWidth: resolvedLineWidth,
            areaOpacity: resolvedAreaOpacity,
            lineOpacity: resolvedLineOpacity,
            lineInterpolation: binaryStep ? 'stepBefore' : resolvedInterpolation,
            binaryStepHighlight: binaryStep,
            episodes: (followThreshold || binaryStep) ? s.episodes : [],
            thresholds: s.thresholds,
          },
        ];
        const rowTimestamps = s.timeValues;
        const overrideShowXAxis = s?.field
          ? getFieldOverrideProperty<boolean>(s.field, 'showXAxis', fieldConfig)
          : undefined;
        const showCellXAxis = overrideShowXAxis ?? custom.showXAxis ?? options.showXAxis ?? false;
        const currentRowHeight = (options.panelMode === 'singleHost' && options.singleHostRowHeight && options.singleHostRowHeight >= 20)
          ? options.singleHostRowHeight
          : effectiveRowHeight;
        // Altura dinâmica aproveitando o máximo da linha da tabela ou override customizado
        const cellHeight = resolvedSparklineHeight || Math.max(currentRowHeight - (showCellXAxis ? 8 : 10), 20);
        const cellWidth = colWidths[metricName]
          ? Math.max(colWidths[metricName] - (valueMode !== 'hidden' ? 65 : 15), 60)
          : undefined;

        return (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              gap: '10px',
            }}
          >
            {valueMode !== 'hidden' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                {valueMode === 'badge' ? (
                  <BadgeRenderer
                    label={s.formattedLastVal.text}
                    color={badgeColor}
                    dot={s.isActiveNow}
                    size={custom.badgeSize || 'sm'}
                    visualStyle={custom.badgeStyle || 'subtle'}
                  />
                ) : (
                  <span
                    style={{
                      color: textColor,
                      fontWeight: 500,
                      fontSize: '11px',
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: '38px',
                    }}
                  >
                    {s.formattedLastVal.text}
                  </span>
                )}
                {renderAlertButton()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 50, height: `${cellHeight}px`, position: 'relative' }}>
              <TableSparklineCell
                width={cellWidth}
                height={cellHeight}
                times={rowTimestamps}
                series={rowSeries}
                theme={theme}
                showXAxis={showCellXAxis}
                timeRange={{
                  from: timeRange ? timeRange.from.valueOf() : tStart,
                  to: timeRange ? timeRange.to.valueOf() : tEnd,
                }}
                onChangeTimeRange={handleCellTimeZoom}
              />
            </div>
            {valueMode === 'hidden' && renderAlertButton()}
          </div>
        );
      }

      case 'heatmap':
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
            <div style={{ flex: 1, minWidth: 60 }}>
              <HeatmapStrip
                values={s.values}
                timeValues={s.timeValues}
                tStart={tStart}
                tEnd={tEnd}
                numBuckets={numBuckets}
                thresholds={s.thresholds}
                exactMatch={s.exactMatch}
                disconnectThreshold={disconnectThreshold}
                corDoThreshold={s.corDoThreshold}
                healthyColor={options.heatmapHealthyColor || '#10b981'}
                formatValue={(val) => formatFieldValue(val, s.field, theme).text}
                height={7}
                columnKey={metricName}
              />
            </div>
            {renderAlertButton()}
          </div>
        );

      case 'badge': {
        const badgeColor = useThresholdColors
          ? (s.isActiveNow
              ? s.corDoThreshold
              : (thrResult.isViolation ? thrResult.color : (s.formattedLastVal.color || thrResult.color)))
          : (s.formattedLastVal.color || undefined);

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <BadgeRenderer
              label={s.formattedLastVal.text}
              color={badgeColor}
              dot={s.isActiveNow}
              size={custom.badgeSize || 'sm'}
              visualStyle={custom.badgeStyle || 'subtle'}
              icon={
                !s.isActiveNow && s.hasHistoricalAlert ? (
                  <HistoryAlertIcon size={10} color={badgeColor || 'rgba(255, 255, 255, 0.65)'} />
                ) : undefined
              }
            />
            {renderAlertButton()}
          </div>
        );
      }

      case 'progressbar': {
        const progMin = custom.progressMin ?? 0;
        const progMax = custom.progressMax ?? 100;
        const showVal = custom.showProgressValue ?? true;
        const barHeight = custom.progressHeight ?? '6px';
        const numVal = typeof s.lastVal === 'number' ? s.lastVal : null;
        const barThrResult = resolveColumnThreshold(numVal, s.thresholds, compMode, theme);
        const barColor = useThresholdColors
          ? (s.isActiveNow ? s.corDoThreshold : (barThrResult.isViolation ? barThrResult.color : (custom.lineColor || '#00B59B')))
          : (custom.lineColor || '#00B59B');

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 60, maxWidth: 140 }}>
              <ProgressBarRenderer
                value={numVal}
                min={progMin}
                max={progMax}
                color={barColor}
                useThreshold={useThresholdColors}
                thresholds={s.thresholds}
                comparisonMode={compMode}
                formattedValue={s.formattedLastVal.text}
                showValueText={showVal}
                height={barHeight}
                defaultColor={custom.lineColor || '#00B59B'}
              />
            </div>
            {renderAlertButton()}
          </div>
        );
      }

      case 'segmentedbar': {
        const segMin = custom.progressMin ?? 0;
        const segMax = custom.progressMax ?? 100;
        const showVal = custom.showProgressValue ?? true;
        const numVal = typeof s.lastVal === 'number' ? s.lastVal : null;
        const segThrResult = resolveColumnThreshold(numVal, s.thresholds, compMode, theme);
        const segColor = useThresholdColors
          ? (s.isActiveNow ? s.corDoThreshold : (segThrResult.isViolation ? segThrResult.color : (custom.lineColor || '#00B59B')))
          : (custom.lineColor || '#00B59B');
        const isActiveThreshold = useThresholdColors && (s.isActiveNow || segThrResult.isViolation);

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <SegmentedBarRenderer
              value={numVal}
              min={segMin}
              max={segMax}
              color={segColor}
              useThreshold={useThresholdColors}
              thresholds={s.thresholds}
              comparisonMode={compMode}
              isActiveThreshold={isActiveThreshold}
              formattedValue={s.formattedLastVal.text}
              showValueText={showVal}
              defaultColor={custom.lineColor || '#00B59B'}
            />
            {renderAlertButton()}
          </div>
        );
      }

      case 'deltatrend': {
        const numVal = typeof s.lastVal === 'number' ? s.lastVal : null;
        const showDelta = custom.showDeltaValue ?? true;
        const colorMode = custom.deltaTrendColorMode ?? 'proximity';
        const deltaRefMode = custom.deltaReferenceMode || 'mean';
        const deltaComparisonDir = custom.deltaComparisonDirection || custom.thresholdComparisonMode || s.comparisonMode || 'gte';
        const proximityPct = custom.deltaProximityPct ?? custom.deltaProximityMargin ?? 20;

        // Extrai referência conforme deltaReferenceMode ('mean', 'first', 'prev')
        const validVals = (s.values || []).filter((v: any) => typeof v === 'number' && !isNaN(v));
        let refVal: number | null = null;
        if (deltaRefMode === 'first') {
          refVal = validVals.length > 0 ? validVals[0] : (s.avgVal ?? numVal);
        } else if (deltaRefMode === 'prev') {
          refVal = validVals.length > 1 ? validVals[validVals.length - 2] : (validVals[0] ?? s.avgVal ?? numVal);
        } else {
          refVal = s.avgVal !== null && s.avgVal !== undefined && !isNaN(Number(s.avgVal))
            ? Number(s.avgVal)
            : (validVals.length > 0 ? validVals.reduce((a: number, b: number) => a + b, 0) / validVals.length : numVal);
        }

        const rawDelta = numVal !== null && refVal !== null ? numVal - refVal : 0;
        const formattedDelta = showDelta && numVal !== null && refVal !== null
          ? formatFieldValue(Math.abs(rawDelta), s.field, theme).text
          : undefined;

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <DeltaTrendRenderer
              current={numVal}
              values={s.values}
              periodAvg={refVal}
              formattedCurrent={s.formattedLastVal.text}
              formattedDelta={formattedDelta}
              showDeltaValue={showDelta}
              thresholds={s.thresholds}
              thresholdColor={s.corDoThreshold}
              isActiveThreshold={s.isActiveNow}
              deltaReferenceMode={deltaRefMode}
              deltaValueFormat={custom.deltaValueFormat}
              deltaDeadbandPct={custom.deltaDeadbandPct}
              deltaProximityPct={proximityPct}
              deltaComparisonDirection={deltaComparisonDir}
              deltaHighlightRelief={custom.deltaHighlightRelief}
              useThresholdColors={useThresholdColors}
              colorMode={colorMode}
            />
            {renderAlertButton()}
          </div>
        );
      }

      case 'text':
      default: {
        const textFontSize = custom.textFontSize || '11.5px';
        const textWeight = custom.textWeight ? Number(custom.textWeight) || 500 : 500;
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span
              style={{
                color: textColor,
                fontWeight: textWeight,
                fontSize: textFontSize,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.formattedLastVal.text}
            </span>
            {renderAlertButton()}
          </div>
        );
      }
    }
  };

  // ── 4. Virtualização no scroll com overscan de 6 linhas ─────────────────────
  const effectiveRowHeight =
    options.rowHeight && options.rowHeight >= 20 ? options.rowHeight : ROW_HEIGHT;
  const enableZebra = options.enableZebra ?? true;

  const filteredHosts = useMemo(() => {
    let list = sortedHosts;
    const filterEntries = Object.entries(columnFilters);
    if (filterEntries.length === 0) {
      return list;
    }

    return list.filter((host) => {
      for (const [colKey, filter] of filterEntries) {
        if (!filter) continue;

        // 1. Verificação de seleção de lista (checkboxes)
        if (filter.selectedValues && filter.selectedValues.length > 0) {
          if (colKey === '__host__') {
            if (!filter.selectedValues.includes(host.hostName)) return false;
          } else {
            const s = host.metrics[colKey];
            const valText = s ? s.formattedLastVal.text : '-';
            if (!filter.selectedValues.includes(valText)) return false;
          }
        }

        // 2. Verificação de Operador (=, !=, >, >=, <, <=)
        if (filter.operator && filter.operatorValue !== undefined && filter.operatorValue.trim() !== '') {
          const op = filter.operator;
          const targetStr = filter.operatorValue.trim();
          const targetNum = Number(targetStr.replace(',', '.'));
          const isTargetNumeric = !isNaN(targetNum);

          if (colKey === '__host__') {
            const hostVal = host.hostName;
            if (op === '=') { if (hostVal.toLowerCase() !== targetStr.toLowerCase()) return false; }
            else if (op === '!=') { if (hostVal.toLowerCase() === targetStr.toLowerCase()) return false; }
            else if (op === '>') { if (hostVal.localeCompare(targetStr, undefined, { numeric: true }) <= 0) return false; }
            else if (op === '>=') { if (hostVal.localeCompare(targetStr, undefined, { numeric: true }) < 0) return false; }
            else if (op === '<') { if (hostVal.localeCompare(targetStr, undefined, { numeric: true }) >= 0) return false; }
            else if (op === '<=') { if (hostVal.localeCompare(targetStr, undefined, { numeric: true }) > 0) return false; }
          } else {
            const s = host.metrics[colKey];
            if (!s) return false;
            const numVal =
              typeof s.lastVal === 'number'
                ? s.lastVal
                : parseFloat(s.formattedLastVal.text.replace(',', '.'));
            const isValNumeric = !isNaN(numVal);

            if (isTargetNumeric && isValNumeric) {
              if (op === '=') { if (Math.abs(numVal - targetNum) >= 1e-4) return false; }
              else if (op === '!=') { if (Math.abs(numVal - targetNum) < 1e-4) return false; }
              else if (op === '>') { if (numVal <= targetNum) return false; }
              else if (op === '>=') { if (numVal < targetNum) return false; }
              else if (op === '<') { if (numVal >= targetNum) return false; }
              else if (op === '<=') { if (numVal > targetNum) return false; }
            } else {
              const valStr = s.formattedLastVal.text;
              if (op === '=') { if (valStr.toLowerCase() !== targetStr.toLowerCase()) return false; }
              else if (op === '!=') { if (valStr.toLowerCase() === targetStr.toLowerCase()) return false; }
              else if (op === '>') { if (valStr.localeCompare(targetStr) <= 0) return false; }
              else if (op === '>=') { if (valStr.localeCompare(targetStr) < 0) return false; }
              else if (op === '<') { if (valStr.localeCompare(targetStr) >= 0) return false; }
              else if (op === '<=') { if (valStr.localeCompare(targetStr) > 0) return false; }
            }
          }
        }
      }
      return true;
    });
  }, [sortedHosts, columnFilters]);

  const totalRows = filteredHosts.length;
  const visibleCount = Math.ceil(viewportHeight / effectiveRowHeight);
  const rawStart = Math.floor(scrollTop / effectiveRowHeight);
  const startIndex = Math.max(0, rawStart - OVERSCAN);
  const endIndex = Math.min(totalRows, rawStart + visibleCount + OVERSCAN);

  const visibleRows = filteredHosts.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * effectiveRowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * effectiveRowHeight);
  const totalCols = 1 + uniqueMetrics.length;

  const isMetricTimeSeries = useCallback(
    (metricName: string): boolean => {
      for (const host of sortedHosts) {
        const s = host.metrics[metricName];
        if (s) {
          return s.displayMode === 'timeseries' || s.displayMode === 'sparkline';
        }
      }
      return options.cellDisplayMode === 'sparkline' || options.cellDisplayMode === 'timeseries';
    },
    [sortedHosts, options.cellDisplayMode]
  );

  const hasAnyTimeSeries = useMemo(() => {
    return uniqueMetrics.some(isMetricTimeSeries);
  }, [uniqueMetrics, isMetricTimeSeries]);

  if (sortedHosts.length === 0 || uniqueMetrics.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>Nenhum dado ou série disponível</div>
      </div>
    );
  }

  // ── 5. Modo Independente: Mapa de Calor Temporal (ISA-101) ──────────────────
  if (options.panelMode === 'heatmap') {
    const primaryMetricName = uniqueMetrics[0];
    const healthyBaseColor = options.heatmapBaseColor || options.heatmapHealthyColor || '#10b981';
    const healthyToneScale = getHealthyToneSteps(healthyBaseColor);
    const heatmapUseThresholds = options.heatmapUseThresholds ?? true;
    const showHeatmapLegend = options.showHeatmapLegend ?? true;

    // Localiza a primeira célula válida para extrair os thresholds configurados do field
    let referenceCell: MetricCellData | undefined;
    for (let i = 0; i < sortedHosts.length; i++) {
      const candidate =
        sortedHosts[i].metrics[primaryMetricName] || Object.values(sortedHosts[i].metrics)[0];
      if (candidate) {
        referenceCell = candidate;
        break;
      }
    }

    const rawSteps =
      referenceCell?.thresholds?.steps ||
      referenceCell?.field?.config?.thresholds?.steps ||
      fieldConfig?.defaults?.thresholds?.steps ||
      [];

    const configuredThresholdSteps = rawSteps
      .filter((st) => st.value !== null && st.value !== undefined && !isNaN(Number(st.value)))
      .map((st) => ({
        value: Number(st.value),
        color: resolveAlertHexColor(st.color, referenceCell?.corDoThreshold || '#F2495C'),
        formattedText: referenceCell
          ? formatFieldValue(Number(st.value), referenceCell.field, theme).text
          : String(st.value),
      }))
      .sort((a, b) => a.value - b.value);

    const hostColWidth = colWidths['__heatmap_host__'] ?? options.heatmapHostWidth ?? 180;
    const nowColWidth = colWidths['__heatmap_now__'] ?? options.heatmapNowWidth ?? 72;
    const heatmapGridColumns = `${hostColWidth}px minmax(120px, 1fr) ${nowColWidth}px`;
    const rawZabbixItemLabel =
      referenceCell?.field?.labels?.item ||
      referenceCell?.field?.labels?.item_name ||
      referenceCell?.field?.labels?.itemName ||
      referenceCell?.field?.labels?.itemname ||
      referenceCell?.field?.labels?.Item ||
      referenceCell?.field?.labels?.metric ||
      referenceCell?.field?.labels?.Metric ||
      referenceCell?.field?.labels?.metric_name;

    const defaultMetricHeaderLabel =
      (rawZabbixItemLabel && !isGenericName(rawZabbixItemLabel) ? rawZabbixItemLabel.trim() : '') ||
      (primaryMetricName && !isGenericName(primaryMetricName) ? primaryMetricName : '') ||
      (referenceCell?.metricName && !isGenericName(referenceCell.metricName) ? referenceCell.metricName : '') ||
      (referenceCell?.field?.name && !isGenericName(referenceCell.field.name) ? referenceCell.field.name : '') ||
      'Métrica';
    const metricHeaderLabel = options.heatmapCustomLabel?.trim() || defaultMetricHeaderLabel;

    // Largura disponível para o centro do gráfico (quadradinhos + eixo X)
    const availableChartWidth = Math.max(80, width - hostColWidth - nowColWidth - 44);

    const showHostIcon = options.heatmapShowHostIcon ?? options.showHostIcon ?? true;
    const defaultHostIcon = options.heatmapHostIconName || options.hostIconName || 'server';
    const hostIconBgMode = options.heatmapHostIconBgMode ?? options.hostIconBgMode ?? 'contained';

    return (
      <PanelInteractionContext.Provider key={panelId} value={panelInteractionContextValue}>
        <div
          className={styles.container}
          ref={containerRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Linha Guia Vertical Pontilhada Global (Shared Crosshair) isolada neste painel */}
          <div ref={crosshairLineRef} className={styles.globalCrosshairLine}>
            <div ref={crosshairTimeRef} className={styles.globalCrosshairTimeBadge} />
          </div>

          {/* Cabeçalho das Colunas do Heatmap com Filtros e Ordenação */}
          {(options.showHeatmapHeader ?? true) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: heatmapGridColumns,
                alignItems: 'center',
                gap: '12px',
                padding: '0 14px',
                minHeight: '32px',
                backgroundColor: '#0c141d',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                flexShrink: 0,
                userSelect: 'none',
                boxSizing: 'border-box',
                zIndex: 10,
              }}
            >
              {/* Coluna 1: HOST / DISPOSITIVO com Filtro */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  minWidth: 0,
                  height: '100%',
                  paddingRight: 10,
                  borderRight: '1px solid rgba(255, 255, 255, 0.04)',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflow: 'hidden',
                    minWidth: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => handleSort('__host__')}
                  title="Clique para ordenar por Host"
                >
                  <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                    <FilterBadgePopover
                      colKey="__host__"
                      colTitle={options.heatmapHostLabel?.trim() || 'HOST / DISPOSITIVO'}
                      currentFilter={columnFilters['__host__']}
                      getUniqueValues={() =>
                        Array.from(new Set(sortedHosts.map((h) => h.hostName))).sort((a, b) =>
                          a.localeCompare(b, undefined, { numeric: true })
                        )
                      }
                      theme={theme}
                      onApply={handleApplyColumnFilter}
                      size={18}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: 'rgba(255, 255, 255, 0.65)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {options.heatmapHostLabel?.trim() || 'HOST / DISPOSITIVO'}
                  </span>
                  {sortConfig.column === '__host__' && (
                    <Icon
                      name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                      size="xs"
                      style={{ color: '#38bdf8', flexShrink: 0 }}
                    />
                  )}
                </div>

                {/* Alça de redimensionamento da coluna de Host */}
                <div
                  style={{
                    position: 'absolute',
                    right: -6,
                    top: 0,
                    bottom: 0,
                    width: '12px',
                    cursor: 'col-resize',
                    zIndex: 5,
                  }}
                  onMouseDown={(e) => handleResizeMouseDown('__heatmap_host__', e)}
                  title="Arrastar para ajustar largura da coluna"
                />
              </div>

              {/* Coluna 2: MÉTRICA com Filtro */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  minWidth: 0,
                  height: '100%',
                  cursor: primaryMetricName ? 'pointer' : 'default',
                }}
                onClick={() => primaryMetricName && handleSort(primaryMetricName)}
                title={primaryMetricName ? `Clique para ordenar por ${primaryMetricName}` : undefined}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflow: 'hidden',
                    minWidth: 0,
                  }}
                >
                  {primaryMetricName && (
                    <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                      <FilterBadgePopover
                        colKey={primaryMetricName}
                        colTitle={metricHeaderLabel}
                        currentFilter={columnFilters[primaryMetricName]}
                        getUniqueValues={() => {
                          const valuesSet = new Set<string>();
                          sortedHosts.forEach((h) => {
                            const s = h.metrics[primaryMetricName] || Object.values(h.metrics)[0];
                            if (s && s.formattedLastVal && s.formattedLastVal.text) {
                              valuesSet.add(s.formattedLastVal.text);
                            }
                          });
                          return Array.from(valuesSet).sort((a, b) =>
                            a.localeCompare(b, undefined, { numeric: true })
                          );
                        }}
                        theme={theme}
                        onApply={handleApplyColumnFilter}
                        size={18}
                      />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'rgba(255, 255, 255, 0.65)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={metricHeaderLabel}
                    >
                      {metricHeaderLabel}
                    </span>
                    {sortConfig.column === primaryMetricName && (
                      <Icon
                        name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                        size="xs"
                        style={{ color: '#38bdf8', flexShrink: 0 }}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Coluna 3: Espaçador do cabeçalho alinhado à coluna de Agora */}
              <div
                style={{
                  position: 'relative',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                {/* Alça de redimensionamento da coluna de Agora */}
                <div
                  style={{
                    position: 'absolute',
                    left: -6,
                    top: 0,
                    bottom: 0,
                    width: '12px',
                    cursor: 'col-resize',
                    zIndex: 5,
                  }}
                  onMouseDown={(e) => handleResizeMouseDown('__heatmap_now__', e)}
                  title="Arrastar para ajustar largura da coluna de Agora"
                />
              </div>
            </div>
          )}

          {/* Corpo rolável com as linhas de Hosts + Eixo de Tempo + Legenda */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            {filteredHosts.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 100,
                  color: 'rgba(255, 255, 255, 0.45)',
                  fontSize: '12px',
                  fontStyle: 'italic',
                }}
              >
                Nenhum resultado encontrado para os filtros aplicados.
              </div>
            ) : (
              filteredHosts.map((host, rowIdx) => {
                const s =
                  host.metrics[primaryMetricName] || Object.values(host.metrics)[0];
                const isEven = rowIdx % 2 === 1;
                const rowBg = isEven ? 'rgba(0, 0, 0, 0.18)' : 'transparent';

                const overrideEnableAlert = s?.field
                  ? getFieldOverrideProperty<boolean>(s.field, 'enableAlertPopup', fieldConfig)
                  : undefined;
                const enableAlertPopup = overrideEnableAlert !== undefined
                  ? overrideEnableAlert
                  : (options.enableAlertPopup ?? true);
                const overrideAlertMode = s?.field
                  ? getFieldOverrideProperty<'always' | 'alertOnly'>(s.field, 'alertPopupDisplayMode', fieldConfig)
                  : undefined;
                const alertPopupMode = overrideAlertMode ?? options.alertPopupDisplayMode ?? 'always';
                const hasHistoricalProblem = Boolean(s?.hasHistoricalAlert || (s?.episodes && s.episodes.length > 0));
                const hasActiveProblem = Boolean(s?.isActiveNow);
                const hasAnyAlert = hasActiveProblem || hasHistoricalProblem;
                const effectiveBadge: BadgeInfo =
                  s && s.badge && s.badge.state !== 'normal'
                    ? s.badge
                    : {
                        state: s?.isActiveNow
                          ? 'active'
                          : s?.hasHistoricalAlert
                          ? 'historical'
                          : 'normal',
                        color:
                          s?.corDoThreshold ||
                          (s?.hasHistoricalAlert ? '#EAB839' : '#F2495C'),
                        episodes: s?.episodes || [],
                      };
                const canShowAlert =
                  Boolean(s) &&
                  enableAlertPopup &&
                  (alertPopupMode === 'alertOnly' ? hasActiveProblem : hasAnyAlert);

              // Cor da coluna direita ("AGORA"): cor do threshold apenas quando ativo; caso contrário cor neutra padrão
              const nowColor = !s || s.lastVal === null || s.lastVal === undefined
                ? 'rgba(255, 255, 255, 0.35)'
                : s.isActiveNow
                ? s.corDoThreshold
                : 'rgba(255, 255, 255, 0.72)';

              return (
                <div
                  key={host.hostName}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: heatmapGridColumns,
                    alignItems: 'center',
                    gap: '12px',
                    minHeight: '34px',
                    padding: '0 14px',
                    background: rowBg,
                    borderBottom: '1px solid rgba(255, 255, 255, 0.035)',
                    borderLeft: s?.isActiveNow
                      ? `2px solid ${s.corDoThreshold}`
                      : '2px solid transparent',
                  }}
                >
                  {/* Área 1 (Esquerda): Nome do Host + Botão ! + divisória imperceptível nas linhas */}
                  <div
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      minWidth: 0,
                      height: '100%',
                      paddingRight: 10,
                      borderRight: '1px solid rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {showHostIcon && (() => {
                        const colorByThreshold = Boolean(options.heatmapColorHostIconByThreshold ?? options.colorHostIconByThreshold ?? false);
                        const normalHostColor = 'rgba(255, 255, 255, 0.85)';
                        const hostIconColor = colorByThreshold
                          ? (s?.isActiveNow
                              ? s.corDoThreshold
                              : normalHostColor)
                          : normalHostColor;
                        const isContained = hostIconBgMode === 'contained';
                        return (
                          <div style={getGlassyIconStyle(hostIconColor, isContained, 22, 5)}>
                            <Icon
                              name={resolveIconName(host.iconName || defaultHostIcon) as any}
                              size="sm"
                              style={{
                                color: hostIconColor,
                                width: isContained ? 13 : 15,
                                height: isContained ? 13 : 15,
                              }}
                            />
                          </div>
                        );
                      })()}
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'rgba(255, 255, 255, 0.88)',
                        }}
                        title={host.hostName}
                      >
                        {host.hostName}
                      </span>
                    </div>
                    {canShowAlert && s && (
                      <AlertBadgePopover
                        badge={effectiveBadge}
                        tStart={tStart}
                        tEnd={tEnd}
                        styles={styles}
                        field={s.field}
                        exactMatch={s.exactMatch}
                        comparisonMode={s.comparisonMode || (s.field ? getFieldOverrideProperty<ThresholdComparisonMode>(s.field, 'thresholdComparisonMode', fieldConfig) : undefined) || s.field.config?.custom?.thresholdComparisonMode || options.thresholdComparisonMode || (s.exactMatch ? 'eq' : 'gte')}
                        fieldConfig={fieldConfig}
                        metricLabel={`${host.hostName} · ${s.metricName}`}
                        currentValueText={s.formattedLastVal.text}
                        currentValueColor={nowColor}
                        size={18}
                        allowNormal={false}
                      />
                    )}

                    {/* Alça de redimensionamento imperceptível sobre a divisória da linha */}
                    <div
                      style={{
                        position: 'absolute',
                        right: -6,
                        top: 0,
                        bottom: 0,
                        width: '12px',
                        cursor: 'col-resize',
                        zIndex: 3,
                      }}
                      onMouseDown={(e) => handleResizeMouseDown('__heatmap_host__', e)}
                      title="Arrastar para ajustar largura da coluna"
                    />
                  </div>

                  {/* Área 2 (Centro): Bloco contínuo de N quadradinhos */}
                  <div style={{ width: '100%', minWidth: 0 }}>
                    {s ? (
                      <HeatmapStrip
                        values={s.values}
                        timeValues={s.timeValues}
                        tStart={tStart}
                        tEnd={tEnd}
                        numBuckets={numBuckets}
                        thresholds={heatmapUseThresholds ? s.thresholds : undefined}
                        exactMatch={heatmapUseThresholds ? s.exactMatch : false}
                        disconnectThreshold={disconnectThreshold}
                        corDoThreshold={s.corDoThreshold}
                        healthyColor={healthyBaseColor}
                        stretchSquares={true}
                        formatValue={(val) => formatFieldValue(val, s.field, theme).text}
                        height={14}
                        columnKey="__heatmap_mode__"
                      />
                    ) : (
                      <div
                        style={{
                          height: 14,
                          borderRadius: 2,
                          border: '1px dashed rgba(255, 255, 255, 0.18)',
                        }}
                      />
                    )}
                  </div>

                  {/* Área 3 (Direita - "AGORA"): Valor do último instante colorido pela condição */}
                  <div
                    style={{
                      position: 'relative',
                      textAlign: 'right',
                      fontSize: '12px',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: nowColor,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {/* Alça de redimensionamento sobre a coluna de Agora */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -6,
                        top: 0,
                        bottom: 0,
                        width: '12px',
                        cursor: 'col-resize',
                        zIndex: 3,
                      }}
                      onMouseDown={(e) => handleResizeMouseDown('__heatmap_now__', e)}
                      title="Arrastar para ajustar largura da coluna de Agora"
                    />
                    <span>{s ? s.formattedLastVal.text : '-'}</span>
                  </div>
                </div>
              );
            }))}

            {/* Eixo de Tempo posicionado diretamente abaixo do último host monitorado */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: heatmapGridColumns,
                alignItems: 'center',
                gap: '12px',
                padding: '6px 14px 10px 14px',
                background: 'transparent',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              {/* Coluna 1: Espaçador abaixo dos hosts sem linhas no eixo X */}
              <div
                style={{
                  height: '16px',
                  lineHeight: '16px',
                  borderRight: 'none',
                  paddingRight: 10,
                }}
              />

              {/* Coluna 2: Apenas os horários perfeitamente alinhados na vertical com escala adaptativa */}
              <ResponsiveTimeAxis
                tStart={tStart}
                tEnd={tEnd}
                fallbackWidth={availableChartWidth}
                style={{ width: '100%', height: '16px' }}
              />

              {/* Coluna 3: 'AGORA' perfeitamente alinhado verticalmente com os horários do eixo X */}
              <div
                onClick={() => primaryMetricName && handleSort(primaryMetricName)}
                style={{
                  height: '16px',
                  lineHeight: '16px',
                  textAlign: 'right',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 3,
                }}
                title="Clique para ordenar pelo valor de Agora"
              >
                <span style={{ lineHeight: '16px' }}>AGORA</span>
                {sortConfig.column === primaryMetricName && (
                  <Icon
                    name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                    size="xs"
                    style={{ color: '#38bdf8', flexShrink: 0 }}
                  />
                )}
              </div>
            </div>

            {/* Legenda Horizontal aproveitando todo o espaço horizontal disponível abaixo do eixo temporal */}
            {showHeatmapLegend && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '24px',
                  flexWrap: 'wrap',
                  padding: '6px 14px 14px 14px',
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  flexShrink: 0,
                  userSelect: 'none',
                  fontSize: '11px',
                }}
              >
                {/* Bloco 1: NORMAL com a escala progressiva do gradiente */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                      padding: '2px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: 3,
                    }}
                  >
                    {healthyToneScale.map((tone, idx) => (
                      <span
                        key={idx}
                        style={{
                          width: 8,
                          height: 11,
                          borderRadius: idx === 0 ? '2px 0 0 2px' : idx === 4 ? '0 2px 2px 0' : 0,
                          backgroundColor: tone,
                          display: 'inline-block',
                        }}
                        title={`Nível saudável ${idx + 1}/5`}
                      />
                    ))}
                  </div>
                  <span style={{ color: 'rgba(255, 255, 255, 0.75)', fontWeight: 500 }}>
                    Normal
                  </span>
                </div>

                {/* Bloco 2: ALERTA / THRESHOLDS configurados (sem brilho/glow) */}
                {configuredThresholdSteps.length > 0 ? (
                  configuredThresholdSteps.map((st, idx) => (
                    <div key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 2,
                          backgroundColor: st.color,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: 'rgba(255, 255, 255, 0.85)', fontWeight: 600 }}>
                        ≥ {st.formattedText}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 2,
                        backgroundColor: '#F2495C',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: 'rgba(255, 255, 255, 0.85)', fontWeight: 600 }}>
                      Violação de limite
                    </span>
                  </div>
                )}

                {/* Bloco 3: SEM DADOS (LACUNA) */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 2,
                      border: '1px dashed rgba(255, 255, 255, 0.35)',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: 'rgba(255, 255, 255, 0.45)', fontWeight: 400 }}>Sem dados</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </PanelInteractionContext.Provider>
    );
  }

  const isSingleHostMode = options.panelMode === 'singleHost';

  if (isSingleHostMode && filteredHosts.length > 0) {
    const host = filteredHosts[0];

    return (
      <PanelInteractionContext.Provider key={panelId} value={panelInteractionContextValue}>
        <div className={styles.container} ref={containerRef}>
          {/* Linha Guia Vertical Pontilhada Global (Shared Crosshair) */}
          <div ref={crosshairLineRef} className={styles.globalCrosshairLine}>
            <div ref={crosshairTimeRef} className={styles.globalCrosshairTimeBadge} />
          </div>

          {/* Rótulo superior da visualização de host único (mesma altura exata do cabeçalho da tabela comum: 32px) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 10,
              padding: '0 14px',
              height: '32px',
              minHeight: '32px',
              maxHeight: '32px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              background: '#0c141d',
              flexShrink: 0,
              boxSizing: 'border-box',
              userSelect: 'none',
            }}
          >
            {/* Título do Host em linha única sem o badge/texto Operacional (sem ícone no cabeçalho) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'rgba(255, 255, 255, 0.88)',
                  lineHeight: '32px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {options.singleHostCustomLabel?.trim() || host.hostName}
              </span>

              {Boolean(options.singleHostCustomStatusText?.trim()) && (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'rgba(255, 255, 255, 0.45)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {options.singleHostCustomStatusText!.trim()}
                </span>
              )}
            </div>
          </div>

          {/* Lista de Métricas: Cada métrica é uma linha (chave à esquerda, valor à direita) */}
          <div
            className={styles.scrollContainer}
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            {uniqueMetrics.map((metricName, mIdx) => {
              const s = host.metrics[metricName];
              const isEven = mIdx % 2 === 1;
              const singleHostRowHeight =
                options.singleHostRowHeight && options.singleHostRowHeight >= 20
                  ? options.singleHostRowHeight
                  : effectiveRowHeight;
              const singleHostEnableZebra =
                options.singleHostEnableZebra ?? options.enableZebra ?? true;
              const rowBg = isEven && singleHostEnableZebra ? 'rgba(0, 0, 0, 0.18)' : 'transparent';
              const custom = getEffectiveCustomConfig(s?.field, fieldConfig);

              return (
                <div
                  key={metricName}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 18px',
                    height: `${singleHostRowHeight}px`,
                    minHeight: `${singleHostRowHeight}px`,
                    boxSizing: 'border-box',
                    background: rowBg,
                    borderBottom: '1px solid rgba(255, 255, 255, 0.035)',
                    borderLeft: s?.isActiveNow
                      ? `3px solid ${s.corDoThreshold}`
                      : '3px solid transparent',
                    transition: 'background-color 0.12s ease',
                  }}
                >
                  {/* Extremidade Esquerda: Nome da Métrica */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    {(() => {
                      const showMetricIcon = options.singleHostShowMetricIcon ?? true;

                      if (!showMetricIcon) {
                        return null;
                      }

                      const overrideIcon = s?.field
                        ? getFieldOverrideProperty<string>(s.field, 'icon', fieldConfig)
                        : undefined;
                      const iconToRender =
                        overrideIcon ||
                        options.singleHostMetricIcon ||
                        'server';

                      const overrideColorByThreshold = s?.field
                        ? getFieldOverrideProperty<boolean>(s.field, 'colorIconByThreshold', fieldConfig)
                        : undefined;
                      const colorByThreshold = Boolean(
                        overrideColorByThreshold !== undefined
                          ? overrideColorByThreshold
                          : (options.singleHostColorMetricIconByThreshold ??
                             options.colorHostIconByThreshold ??
                             false)
                      );

                      const normalIconColor = 'rgba(255, 255, 255, 0.85)';
                      const metricIconColor = colorByThreshold
                        ? (s?.isActiveNow
                            ? s.corDoThreshold
                            : normalIconColor)
                        : normalIconColor;

                      const overrideIconStyle = s?.field
                        ? getFieldOverrideProperty<'contained' | 'clean'>(s.field, 'iconStyle', fieldConfig)
                        : undefined;
                      const isContained = overrideIconStyle
                        ? overrideIconStyle !== 'clean'
                        : (options.singleHostMetricIconBgMode ?? 'contained') === 'contained';

                      return (
                        <div style={getGlassyIconStyle(metricIconColor, isContained, 22, 5)}>
                          <Icon
                            name={resolveIconName(iconToRender) as any}
                            size="sm"
                            style={{
                              color: metricIconColor,
                              width: isContained ? 13 : 15,
                              height: isContained ? 13 : 15,
                              flexShrink: 0,
                            }}
                          />
                        </div>
                      );
                    })()}
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'rgba(255, 255, 255, 0.88)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {getFieldOverrideProperty<string>(s?.field, 'label', fieldConfig) || custom.label || metricName}
                    </span>
                  </div>

                  {/* Extremidade Direita: Valor e Visualizador da Métrica */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 10,
                      minWidth: 0,
                      flexShrink: 0,
                    }}
                  >
                    {s ? (
                      renderMetricCell(s, host.hostName, metricName, s.displayMode)
                    ) : (
                      <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: '11px' }}>-</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PanelInteractionContext.Provider>
    );
  }

  return (
    <PanelInteractionContext.Provider key={panelId} value={panelInteractionContextValue}>
      <div className={styles.container} ref={containerRef}>
        {/* Linha Guia Vertical Pontilhada Global (Shared Crosshair) que corta a tabela inteira */}
        <div ref={crosshairLineRef} className={styles.globalCrosshairLine}>
          <div ref={crosshairTimeRef} className={styles.globalCrosshairTimeBadge} />
        </div>

        <div className={styles.scrollContainer} ref={scrollRef} onScroll={handleScroll}>
          <table className={styles.table}>
            {(options.showHeader ?? true) && (
            <thead className={styles.thead}>
              <tr>
                <th
                  className={styles.th}
                  style={{
                    textAlign: 'left',
                    width: colWidths['__host__'],
                    cursor: 'pointer',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                  }}
                  onClick={() => handleSort('__host__')}
                  title="Clique para ordenar por Host"
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      overflow: 'visible',
                      paddingRight: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', minWidth: 0 }}>
                      {/* Botão do Filtro do lado esquerdo do rótulo do Host */}
                      {(options.enableHostFilter || Boolean(columnFilters['__host__'])) && (
                        <FilterBadgePopover
                          colKey="__host__"
                          colTitle="HOST / DISPOSITIVO"
                          currentFilter={columnFilters['__host__']}
                          getUniqueValues={() =>
                            Array.from(new Set(sortedHosts.map((h) => h.hostName))).sort((a, b) =>
                              a.localeCompare(b, undefined, { numeric: true })
                            )
                          }
                          theme={theme}
                          onApply={handleApplyColumnFilter}
                          size={18}
                        />
                      )}

                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        HOST / DISPOSITIVO
                      </span>
                      {sortConfig.column === '__host__' && (
                        <Icon
                          name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                          size="xs"
                          style={{ color: '#38bdf8', flexShrink: 0 }}
                        />
                      )}
                    </div>
                  </div>
                  <div
                    className={`col-resizer ${styles.colResizer}`}
                    onMouseDown={(e) => handleResizeMouseDown('__host__', e)}
                    onClick={(e) => e.stopPropagation()}
                    title="Arrastar para redimensionar"
                  />
                </th>
                {uniqueMetrics.map((metricName) => {
                  const sampleField = sortedHosts[0]?.metrics[metricName]?.field;
                  const customConfig = getEffectiveCustomConfig(sampleField, fieldConfig);
                  const metricLabel = customConfig.label?.trim() || metricName;
                  const isMetricFilterEnabled = customConfig.enableColumnFilter ?? false;
                  const isFilterActive = Boolean(
                    columnFilters[metricName] &&
                      ((columnFilters[metricName]?.operator && columnFilters[metricName]?.operatorValue) ||
                        (columnFilters[metricName]?.selectedValues && columnFilters[metricName].selectedValues.length > 0))
                  );
                  const showMetricFilterIcon = isMetricFilterEnabled || isFilterActive;

                  return (
                    <th
                      key={metricName}
                      className={styles.th}
                      style={{
                        textAlign: 'left',
                        width: colWidths[metricName],
                        cursor: 'pointer',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                      }}
                      onClick={() => handleSort(metricName)}
                      title={`Clique para ordenar por ${metricLabel}`}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          overflow: 'visible',
                          paddingRight: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
                          {/* Botão do Filtro do lado esquerdo da métrica */}
                          {showMetricFilterIcon && (
                            <FilterBadgePopover
                              colKey={metricName}
                              colTitle={metricLabel}
                              currentFilter={columnFilters[metricName]}
                              getUniqueValues={() => {
                                const valuesSet = new Set<string>();
                                sortedHosts.forEach((h) => {
                                  const s = h.metrics[metricName];
                                  if (s && s.formattedLastVal.text) {
                                    valuesSet.add(s.formattedLastVal.text);
                                  }
                                });
                                return Array.from(valuesSet).sort((a, b) =>
                                  a.localeCompare(b, undefined, { numeric: true })
                                );
                              }}
                              theme={theme}
                              onApply={handleApplyColumnFilter}
                              size={18}
                            />
                          )}
                          <span
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={metricLabel}
                          >
                            {metricLabel}
                          </span>
                          {sortConfig.column === metricName && (
                            <Icon
                              name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                              size="xs"
                              style={{ color: '#38bdf8', flexShrink: 0 }}
                            />
                          )}
                        </div>
                      </div>
                      <div
                        className={`col-resizer ${styles.colResizer}`}
                        onMouseDown={(e) => handleResizeMouseDown(metricName, e)}
                        onClick={(e) => e.stopPropagation()}
                        title="Arrastar para redimensionar"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td
                    colSpan={totalCols}
                    style={{
                      padding: '24px 16px',
                      textAlign: 'center',
                      color: 'rgba(255, 255, 255, 0.55)',
                      fontSize: '12px',
                    }}
                  >
                    Nenhum host corresponde ao filtro ativo.{' '}
                    <span
                      onClick={() => setColumnFilters({})}
                      style={{
                        color: '#38bdf8',
                        cursor: 'pointer',
                        fontWeight: 600,
                        marginLeft: 6,
                      }}
                    >
                      Limpar filtros
                    </span>
                  </td>
                </tr>
              )}
              {topSpacerHeight > 0 && (
                <tr style={{ height: `${topSpacerHeight}px`, border: 'none' }}>
                  <td
                    colSpan={totalCols}
                    style={{ padding: 0, border: 'none', height: `${topSpacerHeight}px` }}
                  />
                </tr>
              )}

              {visibleRows.map((host, idx) => {
                const absoluteRowIdx = startIndex + idx;
                const isEven = absoluteRowIdx % 2 === 1;
                const rowBg = isEven && enableZebra ? 'rgba(0, 0, 0, 0.18)' : 'transparent';

                const showHostIcon = options.showHostIcon ?? true;
                const defaultHostIcon = options.hostIconName || 'server';
                const hostIconBgMode = options.hostIconBgMode ?? 'contained';

                return (
                  <tr
                    key={host.hostName}
                    className={styles.tr}
                    style={{ background: rowBg, height: `${effectiveRowHeight}px` }}
                  >
                    {/* 1ª célula: Nome do Host + Ícone + indicador fino de alerta ativo (2px solid) */}
                    <td
                      className={styles.td}
                      style={{
                        width: colWidths['__host__'],
                        borderLeft: host.isActiveNow
                          ? `2px solid ${host.corDoThreshold}`
                          : '2px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        {showHostIcon && (() => {
                          const colorByThreshold = Boolean(options.colorHostIconByThreshold ?? false);
                          const normalHostColor = 'rgba(255, 255, 255, 0.85)';
                          const hostIconColor = colorByThreshold
                            ? (host.isActiveNow
                                ? host.corDoThreshold
                                : normalHostColor)
                            : normalHostColor;
                          const isContained = hostIconBgMode === 'contained';
                          return (
                            <div style={getGlassyIconStyle(hostIconColor, isContained, 22, 5)}>
                              <Icon
                                name={resolveIconName(host.iconName || defaultHostIcon) as any}
                                size="sm"
                                style={{
                                  color: hostIconColor,
                                  width: isContained ? 13 : 15,
                                  height: isContained ? 13 : 15,
                                }}
                              />
                            </div>
                          );
                        })()}
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'rgba(255, 255, 255, 0.85)',
                          }}
                          title={host.hostName}
                        >
                          {host.hostName}
                        </span>
                      </div>
                    </td>

                    {/* Células dinâmicas para cada métrica única */}
                    {uniqueMetrics.map((metricName) => {
                      const s = host.metrics[metricName];
                      if (!s) {
                        return (
                          <td
                            key={metricName}
                            className={styles.td}
                            style={{
                              width: colWidths[metricName],
                              color: 'rgba(255, 255, 255, 0.35)',
                              textAlign: 'left',
                            }}
                          >
                            -
                          </td>
                        );
                      }

                      return (
                        <td
                          key={metricName}
                          className={styles.td}
                          style={{
                            width: colWidths[metricName],
                            overflow: (s.displayMode === 'heatmap' || s.displayMode === 'timeseries' || s.displayMode === 'sparkline') ? 'visible' : 'hidden',
                          }}
                        >
                          {renderMetricCell(s, host.hostName, metricName, s.displayMode)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {bottomSpacerHeight > 0 && (
                <tr style={{ height: `${bottomSpacerHeight}px`, border: 'none' }}>
                  <td
                    colSpan={totalCols}
                    style={{ padding: 0, border: 'none', height: `${bottomSpacerHeight}px` }}
                  />
                </tr>
              )}
            </tbody>
            {hasAnyTimeSeries && (
              <tfoot className={styles.tfoot}>
                <tr>
                  {/* Coluna 1: Rodapé fixo do Host */}
                  <td
                    className={styles.tfootTd}
                    style={{
                      width: colWidths['__host__'],
                      borderLeft: '2px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, height: '16px', lineHeight: '16px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'rgba(255, 255, 255, 0.4)',
                        }}
                      >
                        Tempo
                      </span>
                    </div>
                  </td>

                  {/* Colunas Dinâmicas: Eixo Temporal dedicado para cada métrica Time Series */}
                  {uniqueMetrics.map((metricName) => {
                    const isTS = isMetricTimeSeries(metricName);
                    if (!isTS) {
                      return (
                        <td
                          key={metricName}
                          className={styles.tfootTd}
                          style={{
                            width: colWidths[metricName],
                          }}
                        />
                      );
                    }

                    // Encontra uma série representativa desta métrica para alinhar o espaçamento
                    let sampleS: MetricCellData | undefined;
                    for (const host of sortedHosts) {
                      if (host.metrics[metricName]) {
                        sampleS = host.metrics[metricName];
                        break;
                      }
                    }

                    const custom = getEffectiveCustomConfig(sampleS?.field, fieldConfig);
                    const rawValueMode = custom.timeSeriesValueMode || options.timeSeriesValueMode || 'text';
                    const valueMode = rawValueMode === 'badge' || rawValueMode === 'hidden' ? rawValueMode : 'text';

                    // Largura de fallback da coluna
                    const colW = Number.isFinite(parseInt(String(colWidths[metricName]), 10))
                      ? parseInt(String(colWidths[metricName]), 10)
                      : 200;

                    return (
                      <td
                        key={metricName}
                        className={styles.tfootTd}
                        style={{
                          width: colWidths[metricName],
                          overflow: 'visible',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            gap: '10px',
                            height: '16px',
                          }}
                        >
                          {/* Espaçador invisível emparelhado com o valor numérico à esquerda da linha do gráfico */}
                          {valueMode !== 'hidden' && (
                            <div
                              style={{
                                visibility: 'hidden',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                flexShrink: 0,
                                pointerEvents: 'none',
                                userSelect: 'none',
                              }}
                            >
                              {valueMode === 'badge' ? (
                                <div style={{ width: 44, height: 18 }} />
                              ) : (
                                <span style={{ fontSize: '11px', minWidth: '38px' }}>
                                  {sampleS?.formattedLastVal?.text || '—'}
                                </span>
                              )}
                              <div style={{ width: 18, height: 18 }} />
                            </div>
                          )}

                          {/* Eixo de Tempo adaptativo da coluna, sincronizado dinamicamente com a largura real */}
                          <ResponsiveTimeAxis
                            tStart={tStart}
                            tEnd={tEnd}
                            fallbackWidth={colW}
                            style={{ flex: 1, minWidth: 50, height: '16px' }}
                          />
                          {valueMode === 'hidden' && <div style={{ width: 18 }} />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </PanelInteractionContext.Provider>
  );
};
