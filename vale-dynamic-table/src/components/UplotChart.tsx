import React, { useEffect, useRef, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartType, LineInterpolation, LinePattern, ThresholdMode, DisconnectThresholdMode } from '../types';
import { getDisplayProcessor } from '@grafana/data';
import { css } from '@emotion/css';

/**
 * Calcula o intervalo típico de coleta (em ms) usando a mediana dos deltas positivos consecutivos.
 * A mediana é imune a grandes hiatos (ex: horas de máquina desligada), ao contrário da média aritmética.
 */
export function estimateTypicalStepMs(times: number[], tStart = 0, tEnd = 0): number {
  if (!times || times.length < 2) {
    return tEnd > tStart ? Math.max(tEnd - tStart, 1000) : 60000;
  }
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt > 0) {
      deltas.push(dt);
    }
  }
  if (deltas.length === 0) {
    return 60000;
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 !== 0
    ? deltas[mid]
    : (deltas[mid - 1] + deltas[mid]) / 2;
  return Math.max(median, 1000);
}

/**
 * Resolve o limite máximo de tempo sem dados (em ms) antes de considerar uma lacuna (gap)
 * e desconectar a linha do gráfico / encerrar episódio de alerta.
 */
export function resolveDisconnectThresholdMs(
  typicalStepMs: number,
  mode: DisconnectThresholdMode = 'auto'
): number {
  switch (mode) {
    case '1m':
      return 60 * 1000;
    case '2m':
      return 2 * 60 * 1000;
    case '5m':
      return 5 * 60 * 1000;
    case '15m':
      return 15 * 60 * 1000;
    case '30m':
      return 30 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    case 'never':
      return Infinity;
    case 'auto':
    default:
      // Padrão explícito: 3.5x o ciclo normal de coleta da série (mínimo de 2 minutos)
      return Math.max(typicalStepMs * 3.5, 2 * 60 * 1000);
  }
}

/**
 * Constrói a matriz AlignedData do uPlot [x_sec, y1, y2, ...] garantindo que:
 * 1) Qualquer hiato temporal > maxGapMs receba pontos explícitos `null` (mesmo quando o datasource
 *    como Zabbix omite linhas em vez de enviar `null`), interrompendo o traço e a área.
 * 2) Múltiplas séries com timestamps desalinhados ou hiatos distintos sejam alinhadas na mesma régua.
 */
export function buildAlignedDataWithGaps(
  seriesInfos: Array<{ values: Array<number | null | undefined>; timeValues?: number[] }>,
  fallbackTimes: number[],
  disconnectThreshold: DisconnectThresholdMode = 'auto'
): uPlot.AlignedData {
  if (!seriesInfos || seriesInfos.length === 0) {
    return [fallbackTimes.map((t) => t / 1000)];
  }

  const processed = seriesInfos.map((s) => {
    const rawTimes = s.timeValues && s.timeValues.length > 0 ? s.timeValues : fallbackTimes;
    const rawVals = s.values || [];
    const len = Math.min(rawTimes.length, rawVals.length);
    const stepMs = estimateTypicalStepMs(rawTimes);
    const maxGapMs = resolveDisconnectThresholdMs(stepMs, disconnectThreshold);

    const pTimes: number[] = [];
    const pVals: Array<number | null> = [];

    for (let i = 0; i < len; i++) {
      const t = rawTimes[i];
      const rawV = rawVals[i];
      const v = rawV === null || rawV === undefined || (rawV as any) === '' || Number.isNaN(Number(rawV))
        ? null
        : Number(rawV);

      pTimes.push(t);
      pVals.push(v);

      if (disconnectThreshold !== 'never' && i + 1 < len) {
        const nextT = rawTimes[i + 1];
        const dt = nextT - t;
        if (dt > maxGapMs) {
          const offset = Math.min(stepMs, Math.max(1, Math.floor(dt * 0.2)));
          const gapStart = t + offset;
          pTimes.push(gapStart);
          pVals.push(null);

          if (dt > stepMs * 4) {
            const gapMid = Math.floor((t + nextT) / 2);
            if (gapMid > gapStart) {
              pTimes.push(gapMid);
              pVals.push(null);
            }
          }

          if (dt > stepMs * 2) {
            const gapEnd = nextT - offset;
            if (gapEnd > pTimes[pTimes.length - 1] && gapEnd < nextT) {
              pTimes.push(gapEnd);
              pVals.push(null);
            }
          }
        }
      }
    }

    return { times: pTimes, values: pVals, stepMs, maxGapMs };
  });

  if (processed.length === 1) {
    return [
      processed[0].times.map((t) => t / 1000),
      processed[0].values,
    ];
  }

  // Verifica se todas as séries já compartilham exatamente os mesmos timestamps (fast-path)
  const p0 = processed[0];
  const allSameTimeline = processed.every(
    (p) => p.times.length === p0.times.length && p.times.every((t, idx) => t === p0.times[idx])
  );
  if (allSameTimeline) {
    return [
      p0.times.map((t) => t / 1000),
      ...processed.map((p) => p.values),
    ];
  }

  // Multi-série com timestamps distintos: unifica a linha do tempo com tolerância de jitter de coleta
  const minStepMs = Math.min(...processed.map((p) => p.stepMs));
  const mergeTolMs = Math.min(minStepMs * 0.4, 15000);

  const allRawTimes: number[] = [];
  for (const p of processed) {
    for (let i = 0; i < p.times.length; i++) {
      allRawTimes.push(p.times[i]);
    }
  }
  allRawTimes.sort((a, b) => a - b);

  const masterTimes: number[] = [];
  for (let i = 0; i < allRawTimes.length; i++) {
    const t = allRawTimes[i];
    if (masterTimes.length === 0 || t - masterTimes[masterTimes.length - 1] > mergeTolMs) {
      masterTimes.push(t);
    }
  }

  const alignedSeries = processed.map((p) => {
    const out: Array<number | null> = new Array(masterTimes.length).fill(null);
    if (p.times.length === 0) {
      return out;
    }
    const matchWindow = Math.max(mergeTolMs, p.stepMs * 0.55);
    let ptr = 0;
    for (let mIdx = 0; mIdx < masterTimes.length; mIdx++) {
      const mT = masterTimes[mIdx];
      while (ptr + 1 < p.times.length && Math.abs(p.times[ptr + 1] - mT) <= Math.abs(p.times[ptr] - mT)) {
        ptr++;
      }
      if (Math.abs(p.times[ptr] - mT) <= matchWindow) {
        out[mIdx] = p.values[ptr];
      }
    }
    return out;
  });

  return [
    masterTimes.map((t) => t / 1000),
    ...alignedSeries,
  ];
}

export const GRAFANA_NAMED_COLORS: Record<string, string> = {
  red: '#F2495C',
  'dark-red': '#C4162A',
  'semi-dark-red': '#E02F44',
  'light-red': '#FF7383',
  'super-light-red': '#FFA6B0',
  orange: '#FF9830',
  'dark-orange': '#FA6400',
  'semi-dark-orange': '#FF780A',
  'light-orange': '#FFB357',
  'super-light-orange': '#FFCB7D',
  yellow: '#FADE2A',
  'dark-yellow': '#E0B400',
  'semi-dark-yellow': '#F2CC0C',
  'light-yellow': '#FFEE52',
  'super-light-yellow': '#FFF899',
  green: '#73BF69',
  'dark-green': '#37872D',
  'semi-dark-green': '#56A64B',
  'light-green': '#96D98D',
  'super-light-green': '#C8F2C2',
  blue: '#5794F2',
  'dark-blue': '#1F60C4',
  'semi-dark-blue': '#3274D9',
  'light-blue': '#8AB8FF',
  'super-light-blue': '#C0D8FF',
  purple: '#B877D9',
  'dark-purple': '#8F3BB8',
  'semi-dark-purple': '#A352CC',
  'light-purple': '#CA95E5',
  'super-light-purple': '#DEB6F2',
  text: '#CCCCDC',
  transparent: 'rgba(0,0,0,0)',
};

/**
 * Converte qualquer cor (incluindo cores nomeadas da paleta do Grafana como 'dark-red')
 * em um formato seguro para Canvas 2D (hexadecimal ou rgb/rgba).
 */
export function resolveCanvasColor(color: string, theme?: any, fallback = '#2dd4bf'): string {
  if (!color) return fallback;
  const raw = String(color).trim();
  const lower = raw.toLowerCase();
  if (GRAFANA_NAMED_COLORS[lower]) {
    return GRAFANA_NAMED_COLORS[lower];
  }
  if (theme?.visualization?.getColorByName) {
    try {
      const fromTheme = theme.visualization.getColorByName(raw);
      if (fromTheme && fromTheme !== raw) {
        const fromThemeLower = fromTheme.toLowerCase();
        if (GRAFANA_NAMED_COLORS[fromThemeLower]) {
          return GRAFANA_NAMED_COLORS[fromThemeLower];
        }
        if (fromTheme.startsWith('#') || fromTheme.startsWith('rgb(') || fromTheme.startsWith('rgba(')) {
          return fromTheme;
        }
      }
    } catch {
      // ignore
    }
  }
  if (raw.startsWith('#') || raw.startsWith('rgb(') || raw.startsWith('rgba(')) {
    return raw;
  }
  return fallback;
}

/**
 * Converte qualquer cor em string rgba(r, g, b, alpha) válida.
 * NUNCA retorna color-mix(...) pois o Canvas 2D (createLinearGradient.addColorStop)
 * rejeita color-mix e quebra a renderização do uPlot.
 */
export function parseColorToRgba(color: string, alpha: number, theme?: any): string {
  const safeAlpha = Math.max(0, Math.min(1, isNaN(alpha) ? 0.35 : alpha));
  if (!color) return `rgba(45, 212, 191, ${safeAlpha})`;

  const resolved = resolveCanvasColor(color, theme);

  if (resolved.toLowerCase() === 'transparent' || resolved.replace(/\s+/g, '') === 'rgba(0,0,0,0)') {
    return `rgba(0, 0, 0, 0)`;
  }

  if (resolved.startsWith('#')) {
    let hex = resolved.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }

  const rgbMatch = resolved.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${safeAlpha})`;
  }

  return `rgba(45, 212, 191, ${safeAlpha})`;
}

const getTooltipStyles = (theme: any) => ({
  tooltip: css`
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 100;
    background: rgba(15, 17, 23, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    min-width: 140px;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  `,
  marker: css`
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 99;
    box-shadow: 0 0 0 2px ${theme.isDark ? '#181b24' : '#ffffff'};
  `,

  time: css`
    font-size: 11px;
    color: ${theme.isDark ? 'rgba(255,255,255,0.5)' : theme.colors.text.secondary};
    margin-bottom: 6px;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  `,
  dot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  label: css`
    flex: 1;
    color: ${theme.isDark ? 'rgba(255,255,255,0.5)' : theme.colors.text.secondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    font-size: 12px;
  `,
  value: css`
    font-size: 12px;
    font-weight: 600;
    font-family: ${theme.typography.fontFamilyMonospace};
    flex-shrink: 0;
    color: ${theme.isDark ? '#e2e8f0' : theme.colors.text.primary};
  `
});

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatTooltipTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}


export interface UplotChartProps {
  width: number;
  height: number;
  seriesInfos: any[]; // will hold data
  times: number[];
  timeRange: { from: number; to: number };
  chartType: ChartType;
  lineInterpolation: LineInterpolation;
  linePattern: LinePattern;
  lineWidth: number;
  areaOpacity: number;
  showPoints: boolean;
  pointSize: number;
  showGrid: boolean;
  showYAxis: boolean;
  showXAxis: boolean;
  yLo: number;
  yHi: number;
  theme: any;
  thresholdMode: ThresholdMode;
  useThreshold: boolean;
  thresholdLines?: Array<{ value: number; color: string }>;
  getSeriesColor: (s: any) => string;
  axisTextColor: string;
  axisLineColor: string;
  gridLineColor: string;
  selectedSeriesIndex: number | null;
  disconnectThreshold?: DisconnectThresholdMode;
  onHover: (ts: number | null, points: any[] | null, px: number, py: number) => void;
  onClickTimeRange?: (from: number, to: number) => void;
  onDoubleClick?: () => void;
  onChartClick?: (ts: number | null, points: any[] | null, px: number, py: number) => void;
}

export const UplotChart: React.FC<UplotChartProps> = ({
  width, height, seriesInfos, times, timeRange, chartType, lineInterpolation, linePattern,
  lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis,
  yLo, yHi, theme, thresholdMode, useThreshold, thresholdLines, getSeriesColor,
  axisTextColor, axisLineColor, gridLineColor, selectedSeriesIndex, disconnectThreshold = 'auto',
  onHover, onClickTimeRange, onDoubleClick, onChartClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersContainerRef = useRef<HTMLDivElement>(null);
  // Flag própria e explícita: só vira true com mouseenter REAL do browser,
  // independente de qualquer lógica interna do uPlot.
  const hasRealHoverRef = useRef<boolean>(false);
  const tooltipStyles = getTooltipStyles(theme);

  // Funções de hide/show para marker e tooltip — centralizadas para evitar duplicação
  const hideOverlays = useCallback(() => {
    if (markersContainerRef.current) {
      const children = markersContainerRef.current.children;
      for (let i = 0; i < children.length; i++) {
        (children[i] as HTMLElement).style.display = 'none';
      }
    }
    if (tooltipRef.current) { tooltipRef.current.style.display = 'none'; }
  }, []);

  // Handlers de mouse no wrapper div React (não no uPlot overlay!)
  // Assim eles sobrevivem a recriações do uPlot sem perder o tracking.
  const handleMouseEnter = useCallback(() => {
    hasRealHoverRef.current = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    hasRealHoverRef.current = false;
    hideOverlays();
    onHover(null, null, 0, 0);
  }, [hideOverlays, onHover]);

  useEffect(() => {
    if (!containerRef.current || (times.length === 0 && seriesInfos.every((s) => !s.timeValues?.length))) return;

    // Prepare aligned data array for uPlot: [x_values_sec, y1_values, y2_values, ...]
    // Injeta pontos `null` explícitos quando o intervalo entre coletas excede o limite (disconnectThreshold)
    const data: uPlot.AlignedData = buildAlignedDataWithGaps(seriesInfos, times, disconnectThreshold);

    const getPaths = () => {
      if (lineInterpolation === 'smooth') return uPlot.paths.spline!();
      if (lineInterpolation === 'stepBefore') return uPlot.paths.stepped!({ align: 1 });
      if (lineInterpolation === 'stepAfter') return uPlot.paths.stepped!({ align: -1 });
      return uPlot.paths.linear!();
    };

    const seriesConfig: uPlot.Series[] = [
      {} // x-axis series
    ];

    seriesInfos.forEach((s, idx) => {
      const color = resolveCanvasColor(getSeriesColor(s), theme);

      const dash = linePattern === 'dashed' ? [6, 4] : [];
      const isVisible = selectedSeriesIndex === null || selectedSeriesIndex === idx;

      seriesConfig.push({
        show: isVisible,
        spanGaps: disconnectThreshold === 'never',
        stroke: (u, seriesIdx) => {
          if (useThreshold && thresholdMode === 'schema') {
             // Basic schema: we'll just use the series color for now
             return color;
          }
          return color;
        },
        width: lineWidth,
        dash,
        paths: chartType === 'bar' ? uPlot.paths.bars!() : getPaths(),
        points: {
          show: showPoints ? true : false,
          size: showPoints ? pointSize * 2 : 0,
        },
        fill: (u, seriesIdx) => {
          if (chartType !== 'area') return 'rgba(0,0,0,0)';
          try {
            const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            const isMultiSeriesMode = seriesInfos.length > 1 && selectedSeriesIndex === null;

            if (isMultiSeriesMode) {
              // No modo multi-série: usa areaOpacity escalonado para não ofuscar o grid
              const topAlpha = Math.min(areaOpacity * 0.6, 0.4);
              const midAlpha = topAlpha * 0.4;
              const baseAlpha = topAlpha * 0.15;
              gradient.addColorStop(0, parseColorToRgba(color, topAlpha, theme));
              gradient.addColorStop(0.6, parseColorToRgba(color, midAlpha, theme));
              gradient.addColorStop(1, parseColorToRgba(color, baseAlpha, theme));
            } else {
              // No modo single-série / isolado: respeita a prop areaOpacity no topo
              const topAlpha = Math.min(Math.max(areaOpacity, 0), 1);
              const midAlpha = topAlpha * 0.4;
              const baseAlpha = topAlpha * 0.1;
              gradient.addColorStop(0, parseColorToRgba(color, topAlpha, theme));
              gradient.addColorStop(0.6, parseColorToRgba(color, midAlpha, theme));
              gradient.addColorStop(1, parseColorToRgba(color, baseAlpha, theme));
            }
            return gradient;
          } catch (e) {
            console.warn('[UplotChart] Error creating linear gradient fill:', e);
            return parseColorToRgba(color, 0.1, theme);
          }
        }
      });
    });

    const opts: uPlot.Options = {
      width,
      height,
      padding: [15, 10, 0, 10], // Força 15px de espaço no topo
      cursor: {
        x: true,
        y: true, // Cruz nativa do uPlot segue o mouse livremente
        points: {
          show: false, // Desabilitado para usar a bolinha customizada em div
        },
        drag: { setScale: false, x: true, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true, range: () => [timeRange.from / 1000, timeRange.to / 1000] },
        y: {
          auto: false,
          range: () => [yLo, yHi > yLo ? yHi : yLo + 1],
        },
      },
      axes: [
        {
          show: showXAxis,
          size: 25,
          space: 90, // Aumentado para não espremer textos de data grandes (DD/MM HH:MM)
          stroke: axisTextColor,
          border: { show: false },
          grid: { show: showGrid, stroke: gridLineColor },
          ticks: { show: false, stroke: axisLineColor },
          values: (u, splits) => {
            if (!u.scales.x.min || !u.scales.x.max) return splits.map(v => String(v));
            const minDate = new Date(u.scales.x.min * 1000);
            const maxDate = new Date(u.scales.x.max * 1000);
            const spansDays = minDate.getDate() !== maxDate.getDate() || 
                              minDate.getMonth() !== maxDate.getMonth() || 
                              minDate.getFullYear() !== maxDate.getFullYear();
            
            return splits.map(v => {
              const d = new Date(v * 1000);
              const hours = String(d.getHours()).padStart(2, '0');
              const mins = String(d.getMinutes()).padStart(2, '0');
              const timeStr = `${hours}:${mins}`;
              
              if (spansDays) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                return `${day}/${month} ${timeStr}`;
              }
              return timeStr;
            });
          }
        },
        {
          show: showYAxis,
          space: 20, // Força mais valores no eixo Y mesmo quando a altura do painel for curta
          stroke: axisTextColor,
          grid: { show: showGrid, stroke: gridLineColor },
          ticks: { show: showYAxis, stroke: axisLineColor },
        }
      ],
      series: seriesConfig,
      hooks: {
        draw: [
          (u) => {
            if (!thresholdLines || thresholdLines.length === 0) return;
            
            const { ctx } = u;
            ctx.save();
            thresholdLines.forEach((line) => {
              // Converter o valor do threshold para a coordenada vertical (pixels)
              const cy = u.valToPos(line.value, 'y', true);

              // Proteção: Só desenhar se a linha estiver dentro da área visível do gráfico
              if (cy < u.bbox.top || cy > u.bbox.top + u.bbox.height) return;

              // Desenhar a linha pontilhada
              ctx.beginPath();
              // Usar a cor configurada ou um fallback elegante (ex: vermelho translúcido)
              ctx.strokeStyle = resolveCanvasColor(line.color, theme, 'rgba(255, 60, 60, 0.6)');
              ctx.lineWidth = 1.5;
              ctx.setLineDash([5, 5]); // Estilo tracejado premium
              
              // Traçar a linha de ponta a ponta na área do gráfico
              ctx.moveTo(u.bbox.left, cy);
              ctx.lineTo(u.bbox.left + u.bbox.width, cy);
              ctx.stroke();
            });
            ctx.restore();
          }
        ],
        setCursor: [
          (u) => {
            const el = tooltipRef.current;
            const markersContainer = markersContainerRef.current;
            if (!el || !markersContainer) return;

            const idx = u.cursor.idx;

            // CONDIÇÃO DUPLA DE SEGURANÇA:
            // 1. hasRealHoverRef — controlado EXCLUSIVAMENTE por mouseenter/leave no wrapper div React
            // 2. idx válido — o uPlot reporta um índice de dado real
            // Ambas devem ser true para mostrar qualquer coisa.
            const shouldShow = hasRealHoverRef.current === true
              && idx !== undefined && idx !== null && idx >= 0;

            if (!shouldShow) {
              const children = markersContainer.children;
              for (let i = 0; i < children.length; i++) {
                (children[i] as HTMLElement).style.display = 'none';
              }
              el.style.display = 'none';
              onHover(null, null, 0, 0);
              return;
            }

            const xSec = u.data[0]?.[idx];
            const ts = xSec !== undefined ? Math.round(xSec * 1000) : times[idx];

            const timeEl = el.querySelector('.tooltipTime');
            if (timeEl) timeEl.textContent = formatTooltipTime(ts);

            const rowsEl = el.querySelector('.tooltipRows');
            if (rowsEl) {
              rowsEl.innerHTML = '';
              const activeMetrics: Array<{ rawValue: number | null, name: string, formatted: string, color: string }> = [];

              seriesInfos.forEach((s, idxSeries) => {
                if (selectedSeriesIndex !== null && selectedSeriesIndex !== idxSeries) return;

                const rawVal = u.data[idxSeries + 1]?.[idx];
                if (rawVal === null || rawVal === undefined || Number.isNaN(Number(rawVal))) return;
                const val = Number(rawVal);
                const displayProcessor = s.field.display || getDisplayProcessor({ field: s.field, theme });
                const display = displayProcessor(val);
                const formatted = display.text + (display.suffix ? display.suffix : '');
                const color = resolveCanvasColor(getSeriesColor(s), theme);

                activeMetrics.push({
                  rawValue: val,
                  name: s.name,
                  formatted,
                  color
                });
              });

              if (selectedSeriesIndex === null) {
                activeMetrics.sort((a, b) => {
                  const valA = a.rawValue ?? -Infinity;
                  const valB = b.rawValue ?? -Infinity;
                  return valB - valA;
                });
              }

              activeMetrics.forEach(metric => {
                const row = document.createElement('div');
                row.className = tooltipStyles.row;

                const dot = document.createElement('span');
                dot.className = tooltipStyles.dot;
                dot.style.backgroundColor = metric.color;
                row.appendChild(dot);

                const label = document.createElement('span');
                label.className = tooltipStyles.label;
                label.textContent = metric.name;
                row.appendChild(label);

                const valEl = document.createElement('span');
                valEl.className = tooltipStyles.value;
                valEl.textContent = metric.formatted;
                row.appendChild(valEl);

                rowsEl.appendChild(row);
              });
            }

            // Converter o valor do dado para pixels dentro da área de plotagem
            const xVal = u.data[0][idx];
            // cx é coordenada relativa à área interna de desenho (u.bbox)
            const cx = u.valToPos(xVal, 'x');
            
            let firstActiveCy: number | null = null;
            const markerChildren = markersContainer.children;

            // BOLINHAS: posicionar cada uma no pixel exato do dado.
            seriesInfos.forEach((s, idxSeries) => {
              const markerEl = markerChildren[idxSeries] as HTMLElement;
              if (!markerEl) return;

              if (selectedSeriesIndex !== null && selectedSeriesIndex !== idxSeries) {
                markerEl.style.display = 'none';
                return;
              }

              const yVal = u.data[idxSeries + 1][idx];
              if (yVal != null) {
                const cy = u.valToPos(yVal, 'y');
                if (firstActiveCy === null) firstActiveCy = cy;
                
                markerEl.style.display = 'block';
                markerEl.style.left = `${cx + u.bbox.left / window.devicePixelRatio}px`;
                markerEl.style.top = `${cy + u.bbox.top / window.devicePixelRatio}px`;
                markerEl.style.transform = 'translate(-50%, -50%)';
                markerEl.style.backgroundColor = resolveCanvasColor(getSeriesColor(s), theme);
              } else {
                markerEl.style.display = 'none';
              }
            });

            // TOOLTIP: Inversão Dinâmica (Collision Detection) ancorado na primeira série ativa
            if (firstActiveCy != null) {
              const cy = firstActiveCy;
              el.style.display = 'block';
              // 1. Ler dimensões reais do tooltip (com fallback seguro)
              const tooltipWidth  = el.offsetWidth  || 200;
              const tooltipHeight = el.offsetHeight || 80;

              const chartLeft = u.bbox.left / window.devicePixelRatio;
              const chartTop = u.bbox.top / window.devicePixelRatio;
              const chartWidth = u.bbox.width / window.devicePixelRatio;
              const chartHeight = u.bbox.height / window.devicePixelRatio;

              const cursorY = cy + chartTop;
              const cursorX = cx + chartLeft;

              // 2. Posicionamento preferencial ACIMA do ponto para não tampar o gráfico
              // Permite que o tooltip suba até a faixa superior do card (acima de chartTop)
              const calculatedTop = cursorY - tooltipHeight - 14;
              const minAllowedTop = -Math.min(tooltipHeight - 8, 72);
              let safeTop = Math.max(minAllowedTop, calculatedTop);

              // Trava de segurança na base: se for cortar embaixo, joga o tooltip para cima
              if (safeTop + tooltipHeight > chartTop + chartHeight) {
                safeTop = Math.max(minAllowedTop, chartTop + chartHeight - tooltipHeight - 8);
              }

              // 3. Lógica de Inversão Horizontal (Direita -> Esquerda)
              let calculatedLeft = cursorX + 15;
              if (calculatedLeft + tooltipWidth > chartLeft + chartWidth) {
                 calculatedLeft = cursorX - tooltipWidth - 15;
              }
              const safeLeft = Math.max(chartLeft + 8, calculatedLeft);

              el.style.transform = `translate(${safeLeft}px, ${safeTop}px)`;
            } else {
              el.style.display = 'none';
            }

            onHover(firstActiveCy != null ? ts : null, null, cx, firstActiveCy ?? 0);
          }
        ],
        setSelect: [
          (u) => {
            if (u.select.width > 0 && onClickTimeRange) {
              const min = u.posToVal(u.select.left, 'x');
              const max = u.posToVal(u.select.left + u.select.width, 'x');
              onClickTimeRange(min * 1000, max * 1000);
              u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false); // reset
            }
          }
        ]
      }
    };

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    // Resetar a flag de hover antes de recriar — a recriação do uPlot
    // pode disparar setCursor internamente, e não queremos que isso
    // herde um hasRealHoverRef=true de um hover anterior.
    hasRealHoverRef.current = false;

    uplotRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [width, height, times, timeRange, seriesInfos, chartType, lineInterpolation, linePattern, lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis, yLo, yHi, theme, thresholdMode, useThreshold, thresholdLines, getSeriesColor, axisTextColor, axisLineColor, gridLineColor, selectedSeriesIndex, disconnectThreshold]);

  // Update size without recreating instance if only dimensions change
  useEffect(() => {
    if (uplotRef.current) {
      uplotRef.current.setSize({ width, height });
    }
  }, [width, height]);

  // ── Click-to-Solo: Alternar visibilidade de séries via API nativa do uPlot ──
  // Usa setSeries() para mostrar/esconder séries sem recriar a instância inteira.
  useEffect(() => {
    const u = uplotRef.current;
    if (!u) return;
    u.series.forEach((s, idx) => {
      if (idx === 0) return; // ignora o eixo X (tempo)
      const shouldShow = selectedSeriesIndex === null || selectedSeriesIndex === (idx - 1);
      if (s.show !== shouldShow) {
        u.setSeries(idx, { show: shouldShow });
      }
    });
  }, [selectedSeriesIndex]);

  return (
    <div 
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} 
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={onDoubleClick}
      onMouseUp={(e) => {
        if (!onChartClick) return;
        const u = uplotRef.current;
        if (!u) return;
        // Espera o uPlot processar a seleção no event loop
        setTimeout(() => {
          if (u.select && u.select.width > 2) return;
          // Pega as coordenadas e timestamp diretamente do cursor atualizado do uPlot
          const cx = u.cursor.left || 0;
          const cy = u.cursor.top || 0;
          const ts = u.cursor.idx != null ? times[u.cursor.idx] : null;
          onChartClick(ts ? ts * 1000 : null, null, cx, cy);
        }, 10);
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div ref={markersContainerRef} style={{ pointerEvents: 'none', position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {seriesInfos.map((_, i) => (
          <div key={i} className={tooltipStyles.marker} style={{ display: 'none' }} />
        ))}
      </div>
      <div ref={tooltipRef} className={tooltipStyles.tooltip} style={{ display: 'none', pointerEvents: 'none' }}>
        <div className={`tooltipTime ${tooltipStyles.time}`}></div>
        <div className="tooltipRows"></div>
      </div>
    </div>
  );
};

