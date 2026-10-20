import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import {
  parseColorToRgba,
  estimateTypicalStepMs,
  resolveDisconnectThresholdMs,
} from './UplotChart';
import { NativeThresholdsConfig, DisconnectThresholdMode } from '../types';
import { getActiveNativeThreshold, resolveAlertHexColor } from './SimplePanel';

// ── Contexto de Isolamento Absoluto do Painel (PanelInteractionContext) ───────
export interface PanelInteractionState {
  panelId: number | string;
  hoveredTimestamp: number | null;
  hoveredColumnKey: string | null;
  clientX: number | null;
}

export interface PanelInteractionContextValue extends PanelInteractionState {
  setInteraction: (payload: {
    hoveredTimestamp: number | null;
    hoveredColumnKey: string | null;
    clientX?: number | null;
  }) => void;
  clearInteraction: () => void;
}

export const PanelInteractionContext = createContext<PanelInteractionContextValue>({
  panelId: 0,
  hoveredTimestamp: null,
  hoveredColumnKey: null,
  clientX: null,
  setInteraction: () => {},
  clearInteraction: () => {},
});

export const usePanelInteraction = () => useContext(PanelInteractionContext);

// Alias de compatibilidade sem eventos globais de window
export const HeatmapCrosshairContext = PanelInteractionContext;

/**
 * Busca binária O(log N) em array ordenado por timestamp `t` para encontrar
 * o ponto real mais próximo de `targetTs`.
 */
export function findClosestDataPoint(
  points: ReadonlyArray<{ t: number; v: number }>,
  targetTs: number
): { t: number; v: number; index: number } | null {
  const n = points.length;
  if (n === 0) {
    return null;
  }
  if (n === 1 || targetTs <= points[0].t) {
    return { t: points[0].t, v: points[0].v, index: 0 };
  }
  if (targetTs >= points[n - 1].t) {
    return { t: points[n - 1].t, v: points[n - 1].v, index: n - 1 };
  }

  let low = 0;
  let high = n - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midTs = points[mid].t;
    if (midTs === targetTs) {
      return { t: points[mid].t, v: points[mid].v, index: mid };
    } else if (midTs < targetTs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const leftIdx = Math.max(0, high);
  const rightIdx = Math.min(n - 1, low);
  const leftDiff = Math.abs(targetTs - points[leftIdx].t);
  const rightDiff = Math.abs(points[rightIdx].t - targetTs);
  const bestIdx = rightDiff < leftDiff ? rightIdx : leftIdx;

  return { t: points[bestIdx].t, v: points[bestIdx].v, index: bestIdx };
}

/**
 * Prepara e garante ordenação ascendente por timestamp `t` para busca binária.
 */
function buildSortedValidPairs(
  values: Array<number | null | undefined>,
  timeValues: number[],
  tStart: number,
  tEnd: number
): Array<{ t: number; v: number }> {
  const len = values.length;
  const windowSpan = Math.max(1, tEnd - tStart);
  const sampleFallbackStep = len > 1 ? windowSpan / (len - 1) : windowSpan;
  const pairs: Array<{ t: number; v: number }> = [];
  let isSorted = true;

  for (let i = 0; i < len; i++) {
    const rawV = values[i];
    if (rawV === null || rawV === undefined || (rawV as any) === '' || isNaN(Number(rawV))) {
      continue;
    }
    const rawT =
      timeValues[i] !== undefined && timeValues[i] !== null
        ? Number(timeValues[i])
        : tStart + i * sampleFallbackStep;
    if (isNaN(rawT)) {
      continue;
    }
    if (pairs.length > 0 && rawT < pairs[pairs.length - 1].t) {
      isSorted = false;
    }
    pairs.push({ t: rawT, v: Number(rawV) });
  }

  if (!isSorted) {
    pairs.sort((a, b) => a.t - b.t);
  }

  return pairs;
}

// ── Tooltip Fixo via ReactDOM.createPortal com proteção de borda da viewport ─
interface PortalChartTooltipProps {
  clientX: number;
  clientY: number;
  timeText: string;
  valueText: string;
  statusLabel?: string;
  accentColor?: string;
}

const PortalChartTooltip: React.FC<PortalChartTooltipProps> = ({
  clientX,
  clientY,
  timeText,
  valueText,
  statusLabel,
  accentColor = '#38bdf8',
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number }>({ w: 175, h: 26 });

  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (
        rect.width > 0 &&
        (Math.abs(rect.width - dimensions.w) > 2 || Math.abs(rect.height - dimensions.h) > 2)
      ) {
        setDimensions({ w: rect.width, h: rect.height });
      }
    }
  }, [timeText, valueText, statusLabel, dimensions.w, dimensions.h]);

  if (typeof document === 'undefined') {
    return null;
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const OFFSET_X = 12;
  const OFFSET_Y = 28;
  const MARGIN = 8;

  // Se o mouse estiver muito à direita da viewport, joga o tooltip para a esquerda do ponteiro
  const overflowsRight = clientX + OFFSET_X + dimensions.w > vw - MARGIN;
  const computedLeft = overflowsRight
    ? Math.max(MARGIN, clientX - dimensions.w - OFFSET_X)
    : clientX + OFFSET_X;

  const rawTop = clientY - OFFSET_Y;
  const computedTop = Math.max(MARGIN, Math.min(vh - dimensions.h - MARGIN, rawTop));

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left: `${computedLeft}px`,
        top: `${computedTop}px`,
        pointerEvents: 'none',
        zIndex: 99999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        borderRadius: '6px',
        backgroundColor: 'rgba(11, 16, 23, 0.96)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.65)',
        color: '#f1f5f9',
        fontSize: '11px',
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: accentColor,
          boxShadow: `0 0 5px ${accentColor}`,
          flexShrink: 0,
        }}
      />
      <span style={{ color: 'rgba(255, 255, 255, 0.68)' }}>{timeText}</span>
      <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>•</span>
      <span style={{ color: '#ffffff', fontWeight: 600 }}>{valueText}</span>
      {statusLabel && (
        <span style={{ color: accentColor, fontSize: '10px', fontWeight: 600 }}>
          ({statusLabel})
        </span>
      )}
    </div>,
    document.body
  );
};

// ── 1. Estilo Badge ──────────────────────────────────────────────────────────
export type BadgeSize = 'sm' | 'md' | 'lg';
export type BadgeVisual = 'subtle' | 'solid' | 'outline';

export interface BadgeRendererProps {
  label: string;
  color?: string; // Cor do threshold ou neutra
  icon?: React.ReactNode;
  dot?: boolean;
  size?: BadgeSize;
  visualStyle?: BadgeVisual;
  style?: React.CSSProperties;
}

export const BadgeRenderer: React.FC<BadgeRendererProps> = ({
  label,
  color,
  icon,
  dot = false,
  size = 'sm',
  visualStyle = 'subtle',
  style,
}) => {
  const isNeutral = !color;
  const effectiveColor = color || '#cbd5e1';

  let bg = 'rgba(255, 255, 255, 0.04)';
  let border = '1px solid rgba(255, 255, 255, 0.10)';
  let textColor = effectiveColor;

  if (visualStyle === 'solid') {
    bg = isNeutral ? 'rgba(255, 255, 255, 0.18)' : effectiveColor;
    border = '1px solid transparent';
    textColor = isNeutral ? '#ffffff' : '#0b121a';
  } else if (visualStyle === 'outline') {
    bg = 'transparent';
    border = isNeutral ? '1px solid rgba(255, 255, 255, 0.25)' : `1px solid ${effectiveColor}`;
    textColor = effectiveColor;
  } else {
    // subtle
    bg = isNeutral ? 'rgba(255, 255, 255, 0.04)' : parseColorToRgba(effectiveColor, 0.12);
    border = isNeutral ? '1px solid rgba(255, 255, 255, 0.10)' : `1px solid ${parseColorToRgba(effectiveColor, 0.30)}`;
    textColor = effectiveColor;
  }

  // Dimensionamento baseado em size
  let fontSize = '9.5px';
  let padding = '2px 6px';
  let lineHeight = '13px';
  let dotSize = 4.5;

  if (size === 'md') {
    fontSize = '11px';
    padding = '2.5px 8px';
    lineHeight = '15px';
    dotSize = 5.5;
  } else if (size === 'lg') {
    fontSize = '12px';
    padding = '3.5px 10px';
    lineHeight = '17px';
    dotSize = 6;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding,
        borderRadius: 9999,
        fontSize,
        fontWeight: 500,
        letterSpacing: '0.02em',
        backgroundColor: bg,
        border,
        color: textColor,
        whiteSpace: 'nowrap',
        lineHeight,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            backgroundColor: textColor === '#0b121a' ? '#0b121a' : effectiveColor,
            boxShadow: textColor === '#0b121a' ? 'none' : `0 0 4px ${effectiveColor}`,
            flexShrink: 0,
          }}
        />
      )}
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
      <span>{label}</span>
    </span>
  );
};

// ── 2. Estilo ProgressBar ────────────────────────────────────────────────────
export type ProgressHeight = '6px' | '8px' | '12px';

export interface ProgressBarRendererProps {
  value: number | null;
  min?: number | null;
  max?: number | null;
  color?: string; // Cor do threshold se usar threshold
  useThreshold?: boolean;
  formattedValue?: string;
  showValueText?: boolean;
  height?: ProgressHeight | number;
  defaultColor?: string;
  style?: React.CSSProperties;
}

export const ProgressBarRenderer: React.FC<ProgressBarRendererProps> = ({
  value,
  min = 0,
  max = 100,
  color,
  useThreshold = false,
  formattedValue,
  showValueText = true,
  height = '6px',
  defaultColor = '#00B59B',
  style,
}) => {
  const numVal = value !== null && !isNaN(Number(value)) ? Number(value) : 0;
  const rangeMin = min !== null && !isNaN(Number(min)) ? Number(min) : 0;
  const rangeMax = max !== null && !isNaN(Number(max)) && Number(max) > rangeMin ? Number(max) : 100;

  const rawPct = ((numVal - rangeMin) / (rangeMax - rangeMin)) * 100;
  const percentage = Math.min(100, Math.max(0, rawPct));

  const barHeight = typeof height === 'number' ? height : (height === '12px' ? 12 : height === '8px' ? 8 : 6);

  // Se usar threshold, pinte com a cor da faixa; se não, pinte com gradiente da cor padrão
  const fillBg = (useThreshold && color)
    ? color
    : `linear-gradient(90deg, ${parseColorToRgba(defaultColor, 0.70)} 0%, ${defaultColor} 100%)`;

  const shadowColor = (useThreshold && color) ? color : defaultColor;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        minWidth: 80,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          height: barHeight,
          borderRadius: Math.round(barHeight / 2),
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: `${percentage.toFixed(1)}%`,
            height: '100%',
            background: fillBg,
            borderRadius: Math.round(barHeight / 2),
            boxShadow: `0 0 6px ${parseColorToRgba(shadowColor, 0.35)}`,
            transition: 'width 0.25s ease',
          }}
        />
      </div>
      {showValueText && formattedValue && (
        <span
          style={{
            fontSize: barHeight >= 12 ? 11.5 : 10.5,
            fontWeight: 500,
            color: (useThreshold && color) ? color : 'rgba(255, 255, 255, 0.72)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 32,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {formattedValue}
        </span>
      )}
    </div>
  );
};

// ── 3. Estilo SegmentedBar (VU Industrial) ───────────────────────────────────
export interface SegmentedBarRendererProps {
  value: number | null;
  min?: number | null;
  max?: number | null;
  color?: string; // Cor do threshold se ativo
  isActiveThreshold?: boolean;
  formattedValue?: string;
  showValueText?: boolean;
  blockCount?: number;
  style?: React.CSSProperties;
}

function getVuBarColor(index: number): string {
  // Gradiente/interpolação clássica VU meter: verde (0-5) -> amarelo/âmbar (6-7) -> vermelho (8-9)
  if (index <= 5) return '#4ade80';
  if (index <= 7) return '#FF9830';
  return '#F2495C';
}

export const SegmentedBarRenderer: React.FC<SegmentedBarRendererProps> = ({
  value,
  min = 0,
  max = 100,
  color,
  isActiveThreshold = false,
  formattedValue,
  showValueText = true,
  blockCount = 10,
  style,
}) => {
  const numVal = value !== null && !isNaN(Number(value)) ? Number(value) : 0;
  const rangeMin = min !== null && !isNaN(Number(min)) ? Number(min) : 0;
  const rangeMax = max !== null && !isNaN(Number(max)) && Number(max) > rangeMin ? Number(max) : 100;

  // Calcule a taxa do valor ((val - min) / (max - min) * blockCount)
  const rate = ((numVal - rangeMin) / (rangeMax - rangeMin)) * blockCount;
  const litCount = Math.min(blockCount, Math.max(0, Math.round(rate)));

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...style,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        {Array.from({ length: blockCount }, (_, i) => {
          const isLit = i < litCount;
          // Se ativo por threshold: cor do threshold; senão interpolando de verde a vermelho
          const litColor = (isActiveThreshold && color) ? color : (color || getVuBarColor(i));
          const barBg = isLit ? litColor : 'rgba(255, 255, 255, 0.05)';
          const boxShadow = isLit ? `0 0 3px ${parseColorToRgba(litColor, 0.45)}` : 'none';

          return (
            <div
              key={i}
              style={{
                width: 3,
                height: 10,
                borderRadius: 1.5,
                backgroundColor: barBg,
                boxShadow,
                transition: 'background-color 0.15s ease',
              }}
            />
          );
        })}
      </div>
      {showValueText && formattedValue && (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            color: (isActiveThreshold && color) ? color : 'rgba(255, 255, 255, 0.72)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 28,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {formattedValue}
        </span>
      )}
    </div>
  );
};


// ── 4. Estilo DeltaTrend ─────────────────────────────────────────────────────
export interface DeltaTrendRendererProps {
  current: number | null;
  periodAvg: number | null;
  formattedCurrent?: string;
  formattedDelta?: string;
  thresholdColor?: string;
  isActiveThreshold?: boolean;
  style?: React.CSSProperties;
}

export const DeltaTrendRenderer: React.FC<DeltaTrendRendererProps> = ({
  current,
  periodAvg,
  formattedCurrent,
  formattedDelta,
  thresholdColor,
  isActiveThreshold = false,
  style,
}) => {
  const cur = current !== null && !isNaN(Number(current)) ? Number(current) : null;
  const avg = periodAvg !== null && !isNaN(Number(periodAvg)) ? Number(periodAvg) : null;

  const delta = cur !== null && avg !== null ? cur - avg : 0;
  const absDelta = Math.abs(delta);

  let pillText = '● 0';
  let pillColor = (isActiveThreshold && thresholdColor) ? thresholdColor : 'rgba(255, 255, 255, 0.45)';
  let pillBg = (isActiveThreshold && thresholdColor) ? parseColorToRgba(thresholdColor, 0.12) : 'rgba(255, 255, 255, 0.04)';
  let pillBorder = (isActiveThreshold && thresholdColor) ? `1px solid ${parseColorToRgba(thresholdColor, 0.30)}` : '1px solid rgba(255, 255, 255, 0.08)';

  if (cur === null || avg === null || absDelta < 1e-5) {
    pillText = '● 0';
  } else if (delta > 0) {
    const disp = formattedDelta || absDelta.toFixed(1);
    pillText = `▲ +${disp}`;
    const clr = (isActiveThreshold && thresholdColor) ? thresholdColor : 'rgba(255, 255, 255, 0.65)';
    pillColor = clr;
    pillBg = (isActiveThreshold && thresholdColor) ? parseColorToRgba(clr, 0.12) : 'rgba(255, 255, 255, 0.05)';
    pillBorder = (isActiveThreshold && thresholdColor) ? `1px solid ${parseColorToRgba(clr, 0.30)}` : '1px solid rgba(255, 255, 255, 0.10)';
  } else {
    const disp = formattedDelta || absDelta.toFixed(1);
    pillText = `▼ -${disp}`;
    const clr = (isActiveThreshold && thresholdColor) ? thresholdColor : 'rgba(255, 255, 255, 0.65)';
    pillColor = clr;
    pillBg = (isActiveThreshold && thresholdColor) ? parseColorToRgba(clr, 0.12) : 'rgba(255, 255, 255, 0.05)';
    pillBorder = (isActiveThreshold && thresholdColor) ? `1px solid ${parseColorToRgba(clr, 0.30)}` : '1px solid rgba(255, 255, 255, 0.10)';
  }

  const currentValueColor = (isActiveThreshold && thresholdColor) ? thresholdColor : 'rgba(255, 255, 255, 0.72)';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {formattedCurrent && (
        <span style={{ fontWeight: 500, color: currentValueColor, fontSize: '11.5px' }}>
          {formattedCurrent}
        </span>
      )}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          padding: '1px 5px',
          borderRadius: 9999,
          fontSize: '9.5px',
          fontWeight: 500,
          backgroundColor: pillBg,
          border: pillBorder,
          color: pillColor,
          whiteSpace: 'nowrap',
          lineHeight: '13px',
        }}
      >
        {pillText}
      </span>
    </div>
  );
};

// ── 5. Componente HeatmapStrip (Modo Mapa de Calor Temporal) ─────────────────
export interface HeatmapBucket {
  index: number;
  tStart: number;
  tEnd: number;
  value: number | null;
  color: string;
  isViolation: boolean;
  isApproaching: boolean;
  isGap: boolean;
  tooltip: string;
}

export interface HeatmapStripProps {
  values: number[];
  timeValues: number[];
  tStart: number;
  tEnd: number;
  numBuckets?: number;
  thresholds?: NativeThresholdsConfig;
  exactMatch?: boolean;
  disconnectThreshold?: DisconnectThresholdMode;
  corDoThreshold?: string;
  healthyColor?: string;
  stretchSquares?: boolean;
  formatValue?: (val: number) => string;
  height?: number;
  columnKey?: string;
  style?: React.CSSProperties;
}

/**
 * Extrai componentes RGB de qualquer cor CSS/Hex/Grafana token via parseColorToRgba
 */
function extractRgbTuple(colorStr: string | undefined, fallbackHex = '#10b981'): [number, number, number] {
  const resolved = resolveAlertHexColor(colorStr || fallbackHex, fallbackHex);
  const rgbaStr = parseColorToRgba(resolved, 1);
  const match = rgbaStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return [16, 185, 129];
}

/**
 * Gera 5 tons progressivos da Cor Saudável do Heatmap (ex: verde esmeralda #10b981),
 * onde o nível 0 (0-20%) é o mais escuro/sutil e o nível 4 (80-99%) é o mais claro/intenso
 * ("Mais claro = mais perto do alerta").
 */
export function getHealthyToneSteps(baseColor = '#10b981'): [string, string, string, string, string] {
  const [r, g, b] = extractRgbTuple(baseColor, '#10b981');
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

  return [
    `rgba(${clamp(r * 0.42)}, ${clamp(g * 0.42)}, ${clamp(b * 0.42)}, 0.36)`,
    `rgba(${clamp(r * 0.68)}, ${clamp(g * 0.68)}, ${clamp(b * 0.68)}, 0.54)`,
    `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, 0.72)`,
    `rgba(${clamp(r + (255 - r) * 0.24)}, ${clamp(g + (255 - g) * 0.24)}, ${clamp(b + (255 - b) * 0.24)}, 0.86)`,
    `rgba(${clamp(r + (255 - r) * 0.48)}, ${clamp(g + (255 - g) * 0.48)}, ${clamp(b + (255 - b) * 0.48)}, 0.96)`,
  ];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatExactTimeRange(startMs: number, endMs: number): string {
  const d1 = new Date(startMs);
  const d2 = new Date(endMs);
  const spanMs = Math.abs(endMs - startMs);
  const sameDay =
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear();

  const t1 = `${pad2(d1.getHours())}:${pad2(d1.getMinutes())}:${pad2(d1.getSeconds())}`;
  const t2 = `${pad2(d2.getHours())}:${pad2(d2.getMinutes())}:${pad2(d2.getSeconds())}`;

  if (spanMs < 10) {
    if (!sameDay) {
      return `${pad2(d1.getDate())}/${pad2(d1.getMonth() + 1)} ${t1}`;
    }
    return t1;
  }

  if (spanMs > 86400000 || !sameDay) {
    return `${pad2(d1.getDate())}/${pad2(d1.getMonth() + 1)} ${t1} – ${pad2(d2.getDate())}/${pad2(d2.getMonth() + 1)} ${t2}`;
  }
  return `${t1} – ${t2}`;
}

export const HeatmapStrip: React.FC<HeatmapStripProps> = ({
  values,
  timeValues,
  tStart,
  tEnd,
  numBuckets = 40,
  thresholds,
  exactMatch = false,
  disconnectThreshold = 'auto',
  corDoThreshold = '#F2495C',
  healthyColor = '#10b981',
  stretchSquares = false,
  formatValue,
  height = 7,
  columnKey,
  style,
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const { hoveredTimestamp, hoveredColumnKey, setInteraction, clearInteraction } =
    usePanelInteraction();

  const [hoverTooltip, setHoverTooltip] = useState<{
    clientX: number;
    clientY: number;
    timeText: string;
    valueText: string;
    statusLabel?: string;
    accentColor: string;
  } | null>(null);

  // Pares válidos ordenados por timestamp para busca binária O(log N)
  const validPairs = useMemo(
    () => buildSortedValidPairs(values, timeValues, tStart, tEnd),
    [values, timeValues, tStart, tEnd]
  );

  // Cálculo matemático dos N buckets na janela [tStart, tEnd]
  const buckets: HeatmapBucket[] = useMemo(() => {
    const N = Math.max(1, numBuckets);
    const windowSpan = Math.max(1, tEnd - tStart);
    const bucketStep = windowSpan / N;

    // Identifica se a série é binária (0/1)
    const isBinary =
      validPairs.length > 0 && validPairs.every((p) => p.v === 0 || p.v === 1);

    // Determina o limite de gap para desconexão
    const typicalStepMs = estimateTypicalStepMs(
      validPairs.map((p) => p.t),
      tStart,
      tEnd
    );
    const maxGapMs = resolveDisconnectThresholdMs(typicalStepMs, disconnectThreshold);

    // Determina o step base e steps configurados de threshold
    const sortedThresholdSteps = [...(thresholds?.steps || [])].sort((a, b) => {
      const av = a.value !== null && a.value !== undefined ? Number(a.value) : -Infinity;
      const bv = b.value !== null && b.value !== undefined ? Number(b.value) : -Infinity;
      return av - bv;
    });
    const baseThresholdStep = sortedThresholdSteps[0];

    // Determina o valor do threshold de referência
    const validSteps = (thresholds?.steps || [])
      .filter((s) => s.value !== null && s.value !== undefined && !isNaN(Number(s.value)))
      .map((s) => ({
        value: Number(s.value),
        color: resolveAlertHexColor(s.color, corDoThreshold),
      }))
      .sort((a, b) => a.value - b.value);

    const positiveSteps = validSteps.filter((s) => s.value > 0);
    const primaryThresholdColor =
      positiveSteps.length > 0
        ? positiveSteps[0].color
        : validSteps.length > 0
        ? validSteps[0].color
        : corDoThreshold;

    const result: HeatmapBucket[] = [];

    for (let k = 0; k < N; k++) {
      const tk = tStart + k * bucketStep;
      const tkNext = k === N - 1 ? tEnd : tStart + (k + 1) * bucketStep;

      // Pontos que caem diretamente dentro de [tk, tkNext]
      const inBucket: number[] = [];
      for (let i = 0; i < validPairs.length; i++) {
        const pt = validPairs[i];
        if (k === N - 1 ? pt.t >= tk && pt.t <= tkNext : pt.t >= tk && pt.t < tkNext) {
          inBucket.push(pt.v);
        }
      }

      let bucketVal: number | null = null;

      if (inBucket.length > 0) {
        if (isBinary) {
          bucketVal = Math.min(...inBucket);
        } else if (exactMatch) {
          const violatingSample = inBucket.find((v) => {
            const st = getActiveNativeThreshold(v, thresholds, true);
            return Boolean(
              st &&
              st !== baseThresholdStep &&
              st.value !== null &&
              st.value !== undefined &&
              Number(st.value) !== -Infinity &&
              !isNaN(Number(st.value))
            );
          });
          bucketVal = violatingSample !== undefined ? violatingSample : Math.max(...inBucket);
        } else {
          bucketVal = Math.max(...inBucket);
        }
      } else if (validPairs.length > 0) {
        let prevPair: { t: number; v: number } | null = null;
        let nextPair: { t: number; v: number } | null = null;
        for (let i = 0; i < validPairs.length; i++) {
          if (validPairs[i].t <= tk) {
            prevPair = validPairs[i];
          } else if (validPairs[i].t >= tkNext) {
            nextPair = validPairs[i];
            break;
          }
        }
        if (prevPair && nextPair) {
          const spanBetweenSamples = nextPair.t - prevPair.t;
          if (spanBetweenSamples <= Math.min(maxGapMs, typicalStepMs * 2.2)) {
            bucketVal = prevPair.v;
          }
        }
      }

      const timeLabel = formatExactTimeRange(tk, tkNext);

      if (bucketVal === null) {
        result.push({
          index: k,
          tStart: tk,
          tEnd: tkNext,
          value: null,
          color: 'rgba(255, 255, 255, 0.015)',
          isViolation: false,
          isApproaching: false,
          isGap: true,
          tooltip: `${timeLabel} • Sem dados (Lacuna)`,
        });
        continue;
      }

      const formattedValStr = formatValue ? formatValue(bucketVal) : String(Number(bucketVal.toFixed(2)));
      const activeStep = getActiveNativeThreshold(bucketVal, thresholds, exactMatch);
      const isStepViolated = Boolean(
        activeStep &&
        activeStep !== baseThresholdStep &&
        activeStep.value !== null &&
        activeStep.value !== undefined &&
        Number(activeStep.value) !== -Infinity &&
        !isNaN(Number(activeStep.value))
      );

      if (isBinary) {
        const isBinaryFail = bucketVal === 0 || isStepViolated;
        if (isBinaryFail) {
          const failColor =
            activeStep && activeStep !== baseThresholdStep && activeStep.color
              ? resolveAlertHexColor(activeStep.color, primaryThresholdColor)
              : primaryThresholdColor;
          result.push({
            index: k,
            tStart: tk,
            tEnd: tkNext,
            value: bucketVal,
            color: parseColorToRgba(failColor, 0.92),
            isViolation: true,
            isApproaching: false,
            isGap: false,
            tooltip: `${timeLabel} • Falha (${formattedValStr})`,
          });
        } else {
          result.push({
            index: k,
            tStart: tk,
            tEnd: tkNext,
            value: bucketVal,
            color: 'rgba(255, 255, 255, 0.08)',
            isViolation: false,
            isApproaching: false,
            isGap: false,
            tooltip: `${timeLabel} • Normal (${formattedValStr})`,
          });
        }
        continue;
      }

      if (isStepViolated) {
        const violationHex =
          activeStep && activeStep.color
            ? resolveAlertHexColor(activeStep.color, primaryThresholdColor)
            : primaryThresholdColor;
        result.push({
          index: k,
          tStart: tk,
          tEnd: tkNext,
          value: bucketVal,
          color: parseColorToRgba(violationHex, 0.92),
          isViolation: true,
          isApproaching: false,
          isGap: false,
          tooltip: `${timeLabel} • ${formattedValStr} (Alerta)`,
        });
      } else {
        // Célula abaixo do threshold: aplica os tons saudáveis progressivos do gradiente
        const healthyTones = getHealthyToneSteps(healthyColor);
        let normalColor: string;
        if (positiveSteps.length > 0 && positiveSteps[0].value > 0) {
          const ratio = Math.max(0, Math.min(0.999, bucketVal / positiveSteps[0].value));
          const level = Math.min(4, Math.floor(ratio * 5));
          normalColor = healthyTones[level];
        } else {
          normalColor = healthyTones[1];
        }

        result.push({
          index: k,
          tStart: tk,
          tEnd: tkNext,
          value: bucketVal,
          color: normalColor,
          isViolation: false,
          isApproaching: false,
          isGap: false,
          tooltip: `${timeLabel} • ${formattedValStr}`,
        });
      }
    }

    return result;
  }, [
    validPairs,
    tStart,
    tEnd,
    numBuckets,
    thresholds,
    exactMatch,
    disconnectThreshold,
    corDoThreshold,
    healthyColor,
    formatValue,
  ]);

  // Lê exclusivamente do PanelInteractionContext (isolado por painel)
  const isCrosshairActiveForCol =
    hoveredTimestamp !== null &&
    (!columnKey || !hoveredColumnKey || hoveredColumnKey === columnKey);

  const activeBucketIndex = useMemo(() => {
    if (!isCrosshairActiveForCol || hoveredTimestamp === null || buckets.length === 0) {
      return null;
    }
    const span = Math.max(1, tEnd - tStart);
    const r = (hoveredTimestamp - tStart) / span;
    if (r < 0 || r > 1) {
      return null;
    }
    return Math.min(buckets.length - 1, Math.max(0, Math.floor(r * buckets.length)));
  }, [isCrosshairActiveForCol, hoveredTimestamp, tStart, tEnd, buckets.length]);

  const handlePointerHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const rawRatio = (e.clientX - rect.left) / rect.width;
      const ratio = Math.max(0, Math.min(1, rawRatio));
      const targetTs = tStart + ratio * (tEnd - tStart);

      // Busca binária no array da série para achar o ponto real mais próximo
      const closest = findClosestDataPoint(validPairs, targetTs);

      const bucketIdx = Math.min(
        buckets.length - 1,
        Math.max(0, Math.floor(ratio * buckets.length))
      );
      const bucket = buckets[bucketIdx];

      const resolvedVal =
        closest !== null
          ? closest.v
          : bucket && !bucket.isGap && bucket.value !== null
          ? bucket.value
          : null;

      const valText =
        bucket && bucket.isGap
          ? 'Sem dados (Lacuna)'
          : resolvedVal !== null
          ? formatValue
            ? formatValue(resolvedVal)
            : String(Number(resolvedVal.toFixed(2)))
          : 'Sem dados';

      const statusLabel = bucket
        ? bucket.isGap
          ? 'Lacuna'
          : bucket.isViolation
          ? 'Alerta'
          : bucket.isApproaching
          ? 'Perto do Alerta'
          : 'Normal'
        : undefined;

      const dotColor = bucket
        ? bucket.isViolation
          ? bucket.color
          : bucket.isGap
          ? '#64748b'
          : 'rgba(255, 255, 255, 0.65)'
        : '#10b981';

      const displayTs = closest ? closest.t : targetTs;
      const timeText = bucket
        ? formatExactTimeRange(bucket.tStart, bucket.tEnd)
        : formatExactTimeRange(displayTs, displayTs);

      setHoverTooltip({
        clientX: e.clientX,
        clientY: e.clientY,
        timeText,
        valueText: valText,
        statusLabel,
        accentColor: dotColor,
      });

      setInteraction({
        hoveredTimestamp: targetTs,
        hoveredColumnKey: columnKey ?? null,
        clientX: e.clientX,
      });
    },
    [tStart, tEnd, validPairs, buckets, formatValue, setInteraction, columnKey]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverTooltip(null);
    clearInteraction();
  }, [clearInteraction]);

  return (
    <div
      ref={stripRef}
      onMouseOver={handlePointerHover}
      onMouseMove={handlePointerHover}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        width: '100%',
        height: `${height}px`,
        padding: 0,
        borderRadius: 2,
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        cursor: 'crosshair',
        userSelect: 'none',
        ...style,
      }}
    >
      {buckets.map((b) => {
        const isSyncedHover = activeBucketIndex === b.index;
        return (
          <div
            key={b.index}
            style={{
              flex: stretchSquares ? '1 1 0px' : '1 1 4px',
              maxWidth: stretchSquares ? undefined : 5,
              minWidth: stretchSquares ? 2 : 3,
              height: `${height}px`,
              borderRadius: 2,
              boxSizing: 'border-box',
              backgroundColor: b.color,
              border: b.isGap ? '1px dashed rgba(255, 255, 255, 0.28)' : 'none',
              boxShadow: isSyncedHover
                ? '0 0 0 1px rgba(255, 255, 255, 0.95)'
                : 'none',
              transform: isSyncedHover ? 'scaleY(1.25)' : 'scaleY(1)',
              zIndex: isSyncedHover ? 3 : 1,
              transition: 'transform 0.06s ease',
            }}
          />
        );
      })}
      {hoverTooltip && (
        <PortalChartTooltip
          clientX={hoverTooltip.clientX}
          clientY={hoverTooltip.clientY}
          timeText={hoverTooltip.timeText}
          valueText={hoverTooltip.valueText}
          statusLabel={hoverTooltip.statusLabel}
          accentColor={hoverTooltip.accentColor}
        />
      )}
    </div>
  );
};

// ── 6. Estilo TimeSeriesRenderer (Gráfico Temporal / Sparkline) ──────────────
export interface TimeSeriesRendererProps {
  values: Array<number | null | undefined>;
  timeValues: number[];
  tStart: number;
  tEnd: number;
  lineColor?: string;
  lineWidth?: number;
  areaOpacity?: number; // 0..100
  lineInterpolation?: 'smooth' | 'straight' | 'stepBefore' | 'stepAfter';
  disconnectThreshold?: DisconnectThresholdMode;
  height?: number;
  formatValue?: (val: number) => string;
  columnKey?: string;
  style?: React.CSSProperties;
}

export const TimeSeriesRenderer: React.FC<TimeSeriesRendererProps> = ({
  values,
  timeValues,
  tStart,
  tEnd,
  lineColor = '#00B59B',
  lineWidth = 1.5,
  areaOpacity = 25,
  lineInterpolation = 'smooth',
  disconnectThreshold = 'auto',
  height = 20,
  formatValue,
  columnKey,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(100);
  const [hoverInfo, setHoverInfo] = useState<{
    clientX: number;
    clientY: number;
    ts: number;
    val: number;
    text: string;
  } | null>(null);

  const { hoveredTimestamp, hoveredColumnKey, setInteraction, clearInteraction } =
    usePanelInteraction();

  // Pares válidos ordenados por timestamp para busca binária O(log N)
  const validPairs = useMemo(
    () => buildSortedValidPairs(values, timeValues, tStart, tEnd),
    [values, timeValues, tStart, tEnd]
  );

  // ResizeObserver para manter o canvas perfeitamente ajustado à largura da coluna
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) {
          setContainerWidth(w);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCrosshairActiveForCol =
    hoveredTimestamp !== null &&
    (!columnKey || !hoveredColumnKey || hoveredColumnKey === columnKey);

  // Processamento e desenho de alta performance no Canvas 2D
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0 || height <= 0) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(containerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, height);

    if (validPairs.length === 0) {
      // Linha tracejada neutra de ausência de dados
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(containerWidth, height / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const typicalStepMs = estimateTypicalStepMs(
      validPairs.map((p) => p.t),
      tStart,
      tEnd
    );
    const maxGapMs = resolveDisconnectThresholdMs(typicalStepMs, disconnectThreshold);

    const numVals = validPairs.map((p) => p.v);
    let minVal = Math.min(...numVals);
    let maxVal = Math.max(...numVals);
    if (minVal === maxVal) {
      minVal -= 1;
      maxVal += 1;
    }
    const valRange = maxVal - minVal || 1;
    const timeSpan = Math.max(1, tEnd - tStart);

    // Divide em segmentos contínuos respeitando limites de desconexão (gaps)
    const segments: Array<Array<{ x: number; y: number; t: number; v: number }>> = [];
    let curSegment: Array<{ x: number; y: number; t: number; v: number }> = [];

    for (let i = 0; i < validPairs.length; i++) {
      const pt = validPairs[i];
      if (i > 0 && pt.t - validPairs[i - 1].t > maxGapMs) {
        if (curSegment.length > 0) {
          segments.push(curSegment);
          curSegment = [];
        }
      }

      const normX = Math.max(0, Math.min(1, (pt.t - tStart) / timeSpan));
      const px = normX * containerWidth;
      const normY = Math.max(0, Math.min(1, (pt.v - minVal) / valRange));
      const py = height - 2 - normY * (height - 5);

      curSegment.push({ x: px, y: py, t: pt.t, v: pt.v });
    }
    if (curSegment.length > 0) {
      segments.push(curSegment);
    }

    // Desenha cada segmento
    segments.forEach((seg) => {
      if (seg.length === 0) {
        return;
      }

      // 1. Área preenchida com gradiente sutil
      if (areaOpacity > 0 && seg.length > 1) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, height);
        ctx.lineTo(seg[0].x, seg[0].y);

        if (lineInterpolation === 'straight') {
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i].x, seg[i].y);
          }
        } else {
          for (let i = 0; i < seg.length - 1; i++) {
            const p0 = seg[i];
            const p1 = seg[i + 1];
            const mx = (p0.x + p1.x) / 2;
            ctx.quadraticCurveTo(p0.x, p0.y, mx, (p0.y + p1.y) / 2);
          }
          ctx.lineTo(seg[seg.length - 1].x, seg[seg.length - 1].y);
        }

        ctx.lineTo(seg[seg.length - 1].x, height);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        const topAlpha = Math.min(0.8, (areaOpacity / 100) * 0.6);
        grad.addColorStop(0, parseColorToRgba(lineColor, topAlpha));
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 2. Traçado da linha
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);

      if (seg.length === 1) {
        ctx.arc(seg[0].x, seg[0].y, 1.5, 0, Math.PI * 2);
      } else if (lineInterpolation === 'straight') {
        for (let i = 1; i < seg.length; i++) {
          ctx.lineTo(seg[i].x, seg[i].y);
        }
      } else {
        for (let i = 0; i < seg.length - 1; i++) {
          const p0 = seg[i];
          const p1 = seg[i + 1];
          const mx = (p0.x + p1.x) / 2;
          ctx.quadraticCurveTo(p0.x, p0.y, mx, (p0.y + p1.y) / 2);
        }
        ctx.lineTo(seg[seg.length - 1].x, seg[seg.length - 1].y);
      }

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });

    // 3. Marcador final (ponto luminoso no último valor do segmento mais recente)
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && lastSeg.length > 0) {
      const lastPt = lastSeg[lastSeg.length - 1];
      ctx.save();
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 4;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(lastPt.x, lastPt.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Guia Vertical do Crosshair Sincronizado via PanelInteractionContext
    if (isCrosshairActiveForCol && hoveredTimestamp !== null) {
      const ratioX = (hoveredTimestamp - tStart) / timeSpan;
      if (ratioX >= 0 && ratioX <= 1) {
        const cx = ratioX * containerWidth;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
        ctx.restore();

        // Destaca o ponto mais próximo via busca binária
        const closest = findClosestDataPoint(validPairs, hoveredTimestamp);
        if (closest) {
          const ptNormX = Math.max(0, Math.min(1, (closest.t - tStart) / timeSpan));
          const ptX = ptNormX * containerWidth;
          const ptNormY = Math.max(0, Math.min(1, (closest.v - minVal) / valRange));
          const ptY = height - 2 - ptNormY * (height - 5);
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ptX, ptY, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }, [
    validPairs,
    tStart,
    tEnd,
    containerWidth,
    height,
    lineColor,
    lineWidth,
    areaOpacity,
    lineInterpolation,
    disconnectThreshold,
    isCrosshairActiveForCol,
    hoveredTimestamp,
  ]);

  const handlePointerHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const rawRatio = (e.clientX - rect.left) / rect.width;
      const ratio = Math.max(0, Math.min(1, rawRatio));
      const targetTs = tStart + ratio * (tEnd - tStart);

      // Busca binária no array da série para achar o ponto real mais próximo
      const closest = findClosestDataPoint(validPairs, targetTs);

      if (closest !== null) {
        const valText = formatValue
          ? formatValue(closest.v)
          : String(Number(closest.v.toFixed(2)));
        setHoverInfo({
          clientX: e.clientX,
          clientY: e.clientY,
          ts: closest.t,
          val: closest.v,
          text: valText,
        });
      } else {
        setHoverInfo({
          clientX: e.clientX,
          clientY: e.clientY,
          ts: targetTs,
          val: 0,
          text: 'Sem dados',
        });
      }

      setInteraction({
        hoveredTimestamp: targetTs,
        hoveredColumnKey: columnKey ?? null,
        clientX: e.clientX,
      });
    },
    [tStart, tEnd, validPairs, formatValue, setInteraction, columnKey]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null);
    clearInteraction();
  }, [clearInteraction]);

  return (
    <div
      ref={containerRef}
      onMouseOver={handlePointerHover}
      onMouseMove={handlePointerHover}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        cursor: 'crosshair',
        display: 'flex',
        alignItems: 'center',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          display: 'block',
        }}
      />
      {hoverInfo && (
        <PortalChartTooltip
          clientX={hoverInfo.clientX}
          clientY={hoverInfo.clientY}
          timeText={formatExactTimeRange(hoverInfo.ts, hoverInfo.ts)}
          valueText={hoverInfo.text}
          accentColor={lineColor}
        />
      )}
    </div>
  );
};

