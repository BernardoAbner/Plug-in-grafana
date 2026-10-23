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
import { NativeThresholdsConfig, DisconnectThresholdMode, ThresholdComparisonMode, ThresholdStep, DeltaValueFormat } from '../types';
import { getActiveNativeThreshold, resolveAlertHexColor, resolveColumnThreshold, AlertEpisode } from './SimplePanel';

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

/**
 * Constrói o gradiente inteligente CSS para a Barra de Progresso Contínua.
 * Inicia no verde padrão (ou cor base saudável) e percorre as faixas de threshold (amarelo, laranja, vermelho)
 * mapeadas ao longo de toda a escala [rangeMin, rangeMax].
 */
export function buildProgressBarGradient(
  rangeMin: number,
  rangeMax: number,
  thresholds?: NativeThresholdsConfig,
  comparisonMode: ThresholdComparisonMode = 'gte',
  defaultColor = '#00B59B'
): string {
  const fallbackHealthy = '#10b981';
  const effectiveBase = defaultColor || fallbackHealthy;

  const validSteps = thresholds?.steps
    ? thresholds.steps.filter((s) => s.value !== null && s.value !== undefined && !isNaN(Number(s.value)))
    : [];

  const rangeSpan = Math.max(1e-4, rangeMax - rangeMin);

  // Caso 1: Sem thresholds configurados -> Gradiente inteligente clássico: Verde (0-55%) -> Amarelo (75%) -> Vermelho (95-100%)
  if (!validSteps || validSteps.length === 0) {
    return `linear-gradient(90deg, ${effectiveBase} 0%, ${effectiveBase} 55%, #EAB839 75%, #F2495C 95%, #F2495C 100%)`;
  }

  // Caso 2: Modo decrescente (lte, <=) -> ex: Bateria / Espaço Livre (0% é Crítico/Vermelho, 100% é Saudável/Verde)
  if (comparisonMode === 'lte') {
    const sortedLte = [...validSteps].sort((a, b) => Number(a.value) - Number(b.value));
    const stops: string[] = [];

    // O menor threshold é o mais crítico (ex: <= 10% vermelho, <= 20% amarelo)
    sortedLte.forEach((st, idx) => {
      const posPct = Math.max(0, Math.min(100, ((Number(st.value) - rangeMin) / rangeSpan) * 100));
      const col = resolveAlertHexColor(st.color);
      if (idx === 0) {
        stops.push(`${col} 0%`);
        stops.push(`${col} ${Math.max(0, posPct - 3).toFixed(1)}%`);
      }
      stops.push(`${col} ${posPct.toFixed(1)}%`);
    });

    stops.push(`${effectiveBase} ${Math.min(100, Math.max(0, ((Number(sortedLte[sortedLte.length - 1].value) - rangeMin) / rangeSpan) * 100) + 5).toFixed(1)}%`);
    stops.push(`${effectiveBase} 100%`);

    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  // Caso 3: Modo crescente padrão (gte / eq) -> Começa no verde padrão e escala até vermelho
  const baseStep = thresholds?.steps?.find((s) => s.value === null || s.value === -Infinity);
  const startColor = baseStep?.color ? resolveAlertHexColor(baseStep.color, effectiveBase) : effectiveBase;

  const sortedGte = [...validSteps].sort((a, b) => Number(a.value) - Number(b.value));

  const stops: string[] = [];
  stops.push(`${startColor} 0%`);

  sortedGte.forEach((st, idx) => {
    const posPct = Math.max(0, Math.min(100, ((Number(st.value) - rangeMin) / rangeSpan) * 100));
    const col = resolveAlertHexColor(st.color);

    const prevColor = idx === 0 ? startColor : resolveAlertHexColor(sortedGte[idx - 1].color);
    const blendStart = Math.max(0, posPct - 6);

    stops.push(`${prevColor} ${blendStart.toFixed(1)}%`);
    stops.push(`${col} ${posPct.toFixed(1)}%`);
  });

  const lastColor = resolveAlertHexColor(sortedGte[sortedGte.length - 1].color);
  stops.push(`${lastColor} 100%`);

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export interface ProgressBarRendererProps {
  value: number | null;
  min?: number | null;
  max?: number | null;
  color?: string; // Cor do threshold se usar threshold
  useThreshold?: boolean;
  thresholds?: NativeThresholdsConfig;
  comparisonMode?: ThresholdComparisonMode;
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
  thresholds,
  comparisonMode = 'gte',
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

  // Gradiente inteligente: se usar threshold, mapeia a escala inteira da barra de verde -> amarelo -> vermelho
  const fillGradient = useThreshold
    ? buildProgressBarGradient(rangeMin, rangeMax, thresholds, comparisonMode, defaultColor)
    : `linear-gradient(90deg, ${parseColorToRgba(defaultColor, 0.70)} 0%, ${defaultColor} 100%)`;

  const thrRes = useThreshold && thresholds
    ? resolveColumnThreshold(numVal, thresholds, comparisonMode)
    : undefined;
  const tipColor = (useThreshold && thrRes?.isViolation)
    ? thrRes.color
    : (color || defaultColor || '#10b981');

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
            backgroundImage: fillGradient,
            backgroundSize: (useThreshold && percentage > 0) ? `${(100 / percentage) * 100}% 100%` : '100% 100%',
            backgroundPosition: 'left center',
            backgroundRepeat: 'no-repeat',
            borderRadius: Math.round(barHeight / 2),
            boxShadow: `0 0 6px ${parseColorToRgba(tipColor, 0.45)}`,
            transition: 'width 0.25s ease',
          }}
        />
      </div>
      {showValueText && formattedValue && (
        <span
          style={{
            fontSize: barHeight >= 12 ? 11.5 : 10.5,
            fontWeight: 500,
            color: (useThreshold && thrRes?.isViolation) ? thrRes.color : 'rgba(255, 255, 255, 0.72)',
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
  useThreshold?: boolean;
  thresholds?: NativeThresholdsConfig;
  comparisonMode?: ThresholdComparisonMode;
  isActiveThreshold?: boolean;
  formattedValue?: string;
  showValueText?: boolean;
  blockCount?: number;
  defaultColor?: string;
  style?: React.CSSProperties;
}

export const SegmentedBarRenderer: React.FC<SegmentedBarRendererProps> = ({
  value,
  min = 0,
  max = 100,
  color,
  useThreshold = false,
  thresholds,
  comparisonMode = 'gte',
  isActiveThreshold = false,
  formattedValue,
  showValueText = true,
  blockCount = 10,
  defaultColor = '#00B59B',
  style,
}) => {
  const numVal = value !== null && !isNaN(Number(value)) ? Number(value) : 0;
  const rangeMin = min !== null && !isNaN(Number(min)) ? Number(min) : 0;
  const rangeMax = max !== null && !isNaN(Number(max)) && Number(max) > rangeMin ? Number(max) : 100;

  // Calcule a taxa do valor ((val - min) / (max - min) * blockCount)
  const rate = ((numVal - rangeMin) / (rangeMax - rangeMin)) * blockCount;
  const litCount = Math.min(blockCount, Math.max(0, Math.round(rate)));

  const currentThr = useThreshold && thresholds
    ? resolveColumnThreshold(numVal, thresholds, comparisonMode)
    : undefined;
  const textColor = (useThreshold && currentThr?.isViolation)
    ? currentThr.color
    : (isActiveThreshold && color ? color : 'rgba(255, 255, 255, 0.72)');

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
          const segVal = rangeMin + ((i + 0.5) / blockCount) * (rangeMax - rangeMin);

          // Gradiente inteligente por bloco: cada segmento assume a cor da faixa em que está posicionado
          let blockColor = defaultColor || '#00B59B';
          if (useThreshold) {
            if (thresholds?.steps && thresholds.steps.some((st) => st.value !== null)) {
              const res = resolveColumnThreshold(segVal, thresholds, comparisonMode);
              blockColor = res.isViolation
                ? res.color
                : resolveAlertHexColor(res.baseStep?.color, defaultColor || '#10b981');
            } else {
              // Gradiente inteligente clássico quando não há thresholds manuais configurados
              blockColor = i <= 5 ? (defaultColor || '#10b981') : i <= 7 ? '#EAB839' : '#F2495C';
            }
          } else if (isActiveThreshold && color) {
            blockColor = color;
          }

          const barBg = isLit ? blockColor : 'rgba(255, 255, 255, 0.05)';
          const boxShadow = isLit ? `0 0 3px ${parseColorToRgba(blockColor, 0.45)}` : 'none';

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
            color: textColor,
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
  values?: any[];
  periodAvg?: number | null;
  formattedCurrent?: string;
  formattedDelta?: string;
  showDeltaValue?: boolean;
  thresholds?: NativeThresholdsConfig;
  thresholdColor?: string;
  isActiveThreshold?: boolean;
  isApproachingThreshold?: boolean;
  deltaReferenceMode?: 'mean' | 'first' | 'prev';
  deltaValueFormat?: DeltaValueFormat;
  deltaDeadbandPct?: number;
  deltaProximityPct?: number;
  deltaComparisonDirection?: ThresholdComparisonMode;
  deltaHighlightRelief?: boolean;
  useThresholdColors?: boolean;
  colorMode?: 'proximity' | 'direction' | 'threshold' | 'neutral';
  style?: React.CSSProperties;
}

export const DeltaTrendRenderer: React.FC<DeltaTrendRendererProps> = ({
  current,
  values,
  periodAvg,
  formattedCurrent,
  formattedDelta,
  showDeltaValue = true,
  thresholds,
  thresholdColor,
  isActiveThreshold = false,
  isApproachingThreshold = false,
  deltaReferenceMode = 'mean',
  deltaValueFormat = 'percent',
  deltaDeadbandPct = 1,
  deltaProximityPct = 20,
  deltaComparisonDirection = 'gte',
  deltaHighlightRelief = true,
  useThresholdColors = true,
  colorMode = 'proximity',
  style,
}) => {
  const cur = current !== null && !isNaN(Number(current)) ? Number(current) : null;
  const refMode = deltaReferenceMode || 'mean';

  // 1. Cálculo de Referência e Deadband
  let refVal: number | null = null;
  if (refMode === 'first') {
    const valid = (values || []).filter((v) => typeof v === 'number' && !isNaN(v));
    refVal = valid.length > 0 ? valid[0] : (periodAvg !== null && periodAvg !== undefined ? Number(periodAvg) : cur);
  } else if (refMode === 'prev') {
    const valid = (values || []).filter((v) => typeof v === 'number' && !isNaN(v));
    refVal = valid.length > 1 ? valid[valid.length - 2] : (valid[0] ?? (periodAvg !== null && periodAvg !== undefined ? Number(periodAvg) : cur));
  } else {
    // 'mean' (Padrão)
    if (periodAvg !== null && periodAvg !== undefined && !isNaN(Number(periodAvg))) {
      refVal = Number(periodAvg);
    } else {
      const valid = (values || []).filter((v) => typeof v === 'number' && !isNaN(v));
      refVal = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : cur;
    }
  }

  const rawDelta = cur !== null && refVal !== null ? cur - refVal : 0;
  const pctDelta = refVal !== null && refVal !== 0 ? (rawDelta / Math.abs(refVal)) * 100 : 0;

  const deadbandLimit = deltaDeadbandPct ?? 1;
  const isStable = Math.abs(pctDelta) < deadbandLimit || cur === null || refVal === null;

  // Formatação do delta exibido no badge conforme deltaValueFormat ('percent' | 'absolute' | 'both')
  const dispAbs = formattedDelta || Math.abs(rawDelta).toFixed(1);
  const dispPct = `${Math.abs(pctDelta).toFixed(1)}%`;
  let valDisp = dispPct;
  if (deltaValueFormat === 'absolute') {
    valDisp = dispAbs;
  } else if (deltaValueFormat === 'both') {
    valDisp = `${dispAbs} (${dispPct})`;
  } else {
    // 'percent' (padrão)
    valDisp = dispPct;
  }

  // Texto da Pílula (Badge de Tendência)
  let badgeText = '● 0%';
  if (isStable) {
    badgeText = showDeltaValue === false ? '●' : (deltaValueFormat === 'absolute' ? '● 0' : '● 0%');
  } else if (rawDelta > 0) {
    badgeText = showDeltaValue === false ? '▲' : `▲ +${valDisp}`;
  } else {
    badgeText = showDeltaValue === false ? '▼' : `▼ -${valDisp}`;
  }

  // 2. Cálculo da Zona de Proximidade (20%)
  const compDir: ThresholdComparisonMode = deltaComparisonDirection || 'gte';
  const proxRatio = (deltaProximityPct ?? 20) / 100;

  // Encontra firstThreshold (ignorando -Infinity / null / NaN)
  const finiteSteps = (thresholds?.steps || []).filter(
    (s) =>
      s.value !== null &&
      s.value !== undefined &&
      (s.value as any) !== '' &&
      Number(s.value) !== -Infinity &&
      !isNaN(Number(s.value))
  );

  let firstThreshold: ThresholdStep | undefined;
  if (finiteSteps.length > 0) {
    if (compDir === 'lte') {
      const sortedLte = [...finiteSteps].sort((a, b) => Number(b.value) - Number(a.value));
      firstThreshold = sortedLte[0];
    } else {
      const sortedGte = [...finiteSteps].sort((a, b) => Number(a.value) - Number(b.value));
      firstThreshold = sortedGte[0];
    }
  }

  let inProximity = false;
  if (firstThreshold && cur !== null) {
    const fVal = Number(firstThreshold.value);
    if (compDir === 'gte') {
      const proximityLimit = fVal !== 0 ? fVal - Math.abs(fVal) * proxRatio : -proxRatio;
      inProximity = cur >= proximityLimit && cur < fVal;
    } else if (compDir === 'lte') {
      const proximityLimit = fVal !== 0 ? fVal + Math.abs(fVal) * proxRatio : proxRatio;
      inProximity = cur > fVal && cur <= proximityLimit;
    }
  }

  // Avaliação de violação de threshold
  const thrRes = (thresholds && cur !== null)
    ? resolveColumnThreshold(cur, thresholds, compDir)
    : undefined;
  const isViolating = Boolean(thrRes?.isViolation || isActiveThreshold);
  const activeThrColor = resolveAlertHexColor(thrRes?.color || thresholdColor || '#F2495C');
  const firstThrColor = firstThreshold?.color ? resolveAlertHexColor(firstThreshold.color) : '#EAB839';

  // 3. Matriz de Coloração Independente (Apenas se useThresholdColors !== false)
  const neutralText = '#f8fafc';
  const neutralBadgeText = 'rgba(248, 250, 252, 0.65)';
  const neutralBadgeBg = 'rgba(255, 255, 255, 0.05)';
  const neutralBadgeBorder = '1px solid rgba(255, 255, 255, 0.10)';

  let textColor = neutralText;
  let badgeColor = neutralBadgeText;
  let badgeBg = neutralBadgeBg;
  let badgeBorder = neutralBadgeBorder;

  if (useThresholdColors !== false) {
    if (isViolating) {
      // Cenários 4 e 5: Violou limiar de threshold (Texto assume a cor do threshold)
      textColor = activeThrColor;

      const isWorsening = (compDir === 'gte' && rawDelta > 0) || (compDir === 'lte' && rawDelta < 0);
      const isRetreating = (compDir === 'gte' && rawDelta < 0) || (compDir === 'lte' && rawDelta > 0);

      if (isStable) {
        // Estável no threshold violado (deadband): Badge Neutro Discreto
        badgeColor = neutralBadgeText;
        badgeBg = neutralBadgeBg;
        badgeBorder = neutralBadgeBorder;
      } else if (isWorsening) {
        // Cenário 4 (No Threshold Agravando): Violou limiar e continua piorando
        badgeColor = activeThrColor;
        badgeBg = parseColorToRgba(activeThrColor, 0.28);
        badgeBorder = `1px solid ${parseColorToRgba(activeThrColor, 0.50)}`;
      } else if (isRetreating) {
        // Cenário 5 (No Threshold Recuperando): Violou limiar, mas recuando
        if (deltaHighlightRelief !== false) {
          const recoveryGreen = '#4ade80';
          badgeColor = recoveryGreen;
          badgeBg = parseColorToRgba(recoveryGreen, 0.18);
          badgeBorder = `1px solid ${parseColorToRgba(recoveryGreen, 0.35)}`;
        } else {
          badgeColor = neutralBadgeText;
          badgeBg = neutralBadgeBg;
          badgeBorder = neutralBadgeBorder;
        }
      }
    } else if (inProximity) {
      // Cenários 2 e 3: Na proximidade (20%), sem violar (Texto permanece neutro #f8fafc)
      textColor = neutralText;

      const isApproaching = (compDir === 'gte' && rawDelta > 0) || (compDir === 'lte' && rawDelta < 0);
      const isRelieving = (compDir === 'gte' && rawDelta < 0) || (compDir === 'lte' && rawDelta > 0);

      if (isStable) {
        // Estável na zona de proximidade (deadband): Badge Neutro Discreto
        badgeColor = neutralBadgeText;
        badgeBg = neutralBadgeBg;
        badgeBorder = neutralBadgeBorder;
      } else if (isApproaching) {
        // Cenário 2 (Proximidade Agravando): Indo para o limiar (Alerta Preventivo)
        badgeColor = firstThrColor;
        badgeBg = parseColorToRgba(firstThrColor, 0.18);
        badgeBorder = `1px solid ${parseColorToRgba(firstThrColor, 0.35)}`;
      } else if (isRelieving) {
        // Cenário 3 (Proximidade Aliviando): Afastando do limiar
        if (deltaHighlightRelief) {
          const softGreen = '#4ade80';
          badgeColor = softGreen;
          badgeBg = parseColorToRgba(softGreen, 0.15);
          badgeBorder = `1px solid ${parseColorToRgba(softGreen, 0.30)}`;
        } else {
          badgeColor = neutralBadgeText;
          badgeBg = neutralBadgeBg;
          badgeBorder = neutralBadgeBorder;
        }
      }
    } else {
      // Cenário 1 (Seguro): Fora de proximidade e sem violar
      textColor = neutralText;
      badgeColor = neutralBadgeText;
      badgeBg = neutralBadgeBg;
      badgeBorder = neutralBadgeBorder;
    }
  } else {
    // useThresholdColors === false
    if (colorMode === 'direction') {
      if (rawDelta > 0) {
        const upColor = '#F2495C';
        badgeColor = upColor;
        badgeBg = parseColorToRgba(upColor, 0.14);
        badgeBorder = `1px solid ${parseColorToRgba(upColor, 0.30)}`;
      } else if (rawDelta < 0) {
        const downColor = '#4ade80';
        badgeColor = downColor;
        badgeBg = parseColorToRgba(downColor, 0.14);
        badgeBorder = `1px solid ${parseColorToRgba(downColor, 0.30)}`;
      }
    }
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {formattedCurrent && (
        <span
          style={{
            fontWeight: 500,
            color: textColor,
            fontSize: '11.5px',
            lineHeight: '14px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
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
          backgroundColor: badgeBg,
          border: badgeBorder,
          color: badgeColor,
          whiteSpace: 'nowrap',
          lineHeight: '13px',
          fontVariantNumeric: 'tabular-nums',
          transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        }}
      >
        {badgeText}
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
  normalLineColor?: string;
  thresholds?: NativeThresholdsConfig;
  lineWidth?: number;
  lineOpacity?: number; // 10..100 (%)
  areaOpacity?: number; // 0..100 (%)
  lineInterpolation?: 'smooth' | 'straight' | 'stepBefore' | 'stepAfter';
  disconnectThreshold?: DisconnectThresholdMode;
  height?: number;
  formatValue?: (val: number) => string;
  columnKey?: string;
  style?: React.CSSProperties;
  binaryStepHighlight?: boolean;
  episodes?: AlertEpisode[];
  violationColor?: string;
  thresholdComparisonMode?: ThresholdComparisonMode;
}

export const TimeSeriesRenderer: React.FC<TimeSeriesRendererProps> = ({
  values,
  timeValues,
  tStart,
  tEnd,
  lineColor = '#00B59B',
  normalLineColor,
  thresholds,
  lineWidth = 1.5,
  lineOpacity = 100,
  areaOpacity = 25,
  lineInterpolation = 'smooth',
  disconnectThreshold = 'auto',
  height = 20,
  formatValue,
  columnKey,
  style,
  binaryStepHighlight = false,
  episodes = [],
  violationColor,
  thresholdComparisonMode,
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

    const timeSpan = Math.max(1, tEnd - tStart);

    const numVals = validPairs.map((p) => p.v);
    const hasOnly0and1 =
      numVals.length > 0 &&
      numVals.every((v) => v === 0 || v === 1 || Math.abs(v) < 1e-4 || Math.abs(v - 1) < 1e-4);

    const isBinary =
      Boolean(binaryStepHighlight) ||
      thresholdComparisonMode === 'eq' ||
      hasOnly0and1;

    // Se for binário (ex: Ping / UP-DOWN), trava rigidamente a escala Y em [0, 1]
    // com amplitude vertical máxima na célula:
    // UP (1) fica sempre no TOPO (py = 1.5px)
    // DOWN (0) fica sempre na BASE (py = height) para nunca gerar gradiente abaixo ou acima de 0
    const calcPy = (v: number) => {
      if (isBinary) {
        const clamped = Math.max(0, Math.min(1, v));
        return height - clamped * (height - 2);
      }
      let minVal = Math.min(...numVals);
      let maxVal = Math.max(...numVals);
      if (minVal === maxVal) {
        if (minVal === 0) {
          minVal = 0;
          maxVal = 1;
        } else {
          minVal = minVal > 0 ? minVal * 0.9 : minVal - 1;
          maxVal = maxVal > 0 ? maxVal * 1.1 : maxVal + 1;
        }
      }
      const valRange = maxVal - minVal || 1;
      const normY = Math.max(0, Math.min(1, (v - minVal) / valRange));
      return height - normY * (height - 3);
    };

    // Interpolação efetiva: para binário, FORÇA degrau reto 90° ('stepBefore') para queda/subida estritamente vertical
    const effectiveInterpolation = isBinary ? 'stepBefore' : lineInterpolation;

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
      const py = calcPy(pt.v);

      curSegment.push({ x: px, y: py, t: pt.t, v: pt.v });
    }
    if (curSegment.length > 0) {
      segments.push(curSegment);
    }

    const fallbackHealthyColor = '#10b981';
    const effectiveNormalColor = normalLineColor || lineColor || fallbackHealthyColor;

    const getPointColor = (v: number, t: number): string => {
      // 1. Avalia thresholds nativos configurados
      if (thresholds?.steps && thresholds.steps.length > 0) {
        const res = resolveColumnThreshold(v, thresholds, thresholdComparisonMode, undefined, effectiveNormalColor);
        if (res.isViolation) {
          return res.color;
        }
      }

      // 2. Avalia episódios de alerta
      if (episodes && episodes.length > 0) {
        const ep = episodes.find((e) => t >= e.startTs && t <= e.endTs);
        if (ep) {
          return ep.color || violationColor || '#F2495C';
        }
      }

      // 3. Para métricas binárias (0 = Down / Alerta, 1 = Up / Normal)
      if (isBinary && Math.abs(v) < 1e-4) {
        return violationColor || '#F2495C';
      }

      // 4. Cor normal saudável
      return effectiveNormalColor;
    };

    // Desenha cada segmento
    segments.forEach((seg) => {
      if (seg.length === 0) {
        return;
      }

      // Associa a cor correspondente (threshold vs normal) a cada ponto
      const coloredSeg = seg.map((pt) => ({
        ...pt,
        color: getPointColor(pt.v, pt.t),
      }));

      const isMultiColor = coloredSeg.some((pt) => pt.color !== coloredSeg[0].color);
      const fillAlpha = Math.min(1.0, Math.max(0, (areaOpacity ?? 25) / 100));

      // Caso 1: Monocromático (todos os pontos têm a mesma cor)
      if (!isMultiColor) {
        const segColor = coloredSeg[0].color;
        const solidColor = parseColorToRgba(segColor, 1.0);

        if (fillAlpha > 0 && seg.length > 1) {
          ctx.beginPath();
          ctx.moveTo(seg[0].x, height);
          ctx.lineTo(seg[0].x, seg[0].y);

          if (effectiveInterpolation === 'straight') {
            for (let i = 1; i < seg.length; i++) {
              ctx.lineTo(seg[i].x, seg[i].y);
            }
          } else if (effectiveInterpolation === 'stepBefore') {
            for (let i = 1; i < seg.length; i++) {
              ctx.lineTo(seg[i].x, seg[i - 1].y);
              ctx.lineTo(seg[i].x, seg[i].y);
            }
          } else if (effectiveInterpolation === 'stepAfter') {
            for (let i = 1; i < seg.length; i++) {
              ctx.lineTo(seg[i - 1].x, seg[i].y);
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
          grad.addColorStop(0, parseColorToRgba(segColor, fillAlpha));
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);

        if (seg.length === 1) {
          ctx.arc(seg[0].x, seg[0].y, 1.5, 0, Math.PI * 2);
        } else if (effectiveInterpolation === 'straight') {
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i].x, seg[i].y);
          }
        } else if (effectiveInterpolation === 'stepBefore') {
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i].x, seg[i - 1].y);
            ctx.lineTo(seg[i].x, seg[i].y);
          }
        } else if (effectiveInterpolation === 'stepAfter') {
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i - 1].x, seg[i].y);
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

        ctx.strokeStyle = solidColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = isBinary ? 'square' : 'round';
        ctx.lineJoin = isBinary ? 'miter' : 'round';
        ctx.stroke();
        return;
      }

      // Caso 2: MULTICOR (Partes diferentes da linha têm cores diferentes de threshold/normal)
      if (effectiveInterpolation === 'stepBefore') {
        // --- 2.A: STEPBEFORE (Degrau Reto / Binário / UP-DOWN) ---
        for (let i = 0; i < coloredSeg.length - 1; i++) {
          const p0 = coloredSeg[i];
          const p1 = coloredSeg[i + 1];
          const c0 = p0.color;
          const c1 = p1.color;

          // Área sob o patamar horizontal [p0.x -> p1.x] na altura p0.y
          if (fillAlpha > 0) {
            ctx.beginPath();
            ctx.moveTo(p0.x, height);
            ctx.lineTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p0.y);
            ctx.lineTo(p1.x, height);
            ctx.closePath();

            const segGrad = ctx.createLinearGradient(0, 0, 0, height);
            segGrad.addColorStop(0, parseColorToRgba(c0, fillAlpha));
            segGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = segGrad;
            ctx.fill();
          }

          // Linha Horizontal no valor p0.y com a cor c0
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p0.y);
          ctx.strokeStyle = parseColorToRgba(c0, 1.0);
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'square';
          ctx.lineJoin = 'miter';
          ctx.stroke();

          // Degrau Vertical no instante p1.x conectando p0.y -> p1.y
          if (Math.abs(p0.y - p1.y) > 0.5) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            if (c0 === c1) {
              ctx.strokeStyle = parseColorToRgba(c0, 1.0);
            } else {
              const vGrad = ctx.createLinearGradient(p1.x, p0.y, p1.x, p1.y);
              vGrad.addColorStop(0, parseColorToRgba(c0, 1.0));
              vGrad.addColorStop(1, parseColorToRgba(c1, 1.0));
              ctx.strokeStyle = vGrad;
            }
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';
            ctx.stroke();
          }
        }
      } else {
        // --- 2.B: CURVA CONTÍNUA (Straight ou Smooth) ---
        for (let i = 0; i < coloredSeg.length - 1; i++) {
          const p0 = coloredSeg[i];
          const p1 = coloredSeg[i + 1];
          const c0 = p0.color;
          const c1 = p1.color;
          const mx = (p0.x + p1.x) / 2;
          const my = (p0.y + p1.y) / 2;

          // Área sob a curva
          if (fillAlpha > 0) {
            if (c0 === c1) {
              ctx.beginPath();
              ctx.moveTo(p0.x, height);
              ctx.lineTo(p0.x, p0.y);
              if (effectiveInterpolation === 'straight') {
                ctx.lineTo(p1.x, p1.y);
              } else {
                ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
                ctx.lineTo(p1.x, p1.y);
              }
              ctx.lineTo(p1.x, height);
              ctx.closePath();

              const segGrad = ctx.createLinearGradient(0, 0, 0, height);
              segGrad.addColorStop(0, parseColorToRgba(c0, fillAlpha));
              segGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.fillStyle = segGrad;
              ctx.fill();
            } else {
              // Transição de cores: fatia esquerda c0, fatia direita c1
              ctx.beginPath();
              ctx.moveTo(p0.x, height);
              ctx.lineTo(p0.x, p0.y);
              ctx.lineTo(mx, my);
              ctx.lineTo(mx, height);
              ctx.closePath();
              const g0 = ctx.createLinearGradient(0, 0, 0, height);
              g0.addColorStop(0, parseColorToRgba(c0, fillAlpha));
              g0.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.fillStyle = g0;
              ctx.fill();

              ctx.beginPath();
              ctx.moveTo(mx, height);
              ctx.lineTo(mx, my);
              ctx.lineTo(p1.x, p1.y);
              ctx.lineTo(p1.x, height);
              ctx.closePath();
              const g1 = ctx.createLinearGradient(0, 0, 0, height);
              g1.addColorStop(0, parseColorToRgba(c1, fillAlpha));
              g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.fillStyle = g1;
              ctx.fill();
            }
          }

          // Traçado da linha
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          if (effectiveInterpolation === 'straight') {
            ctx.lineTo(p1.x, p1.y);
          } else {
            ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
            ctx.lineTo(p1.x, p1.y);
          }

          if (c0 === c1) {
            ctx.strokeStyle = parseColorToRgba(c0, 1.0);
          } else {
            const segGrad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
            segGrad.addColorStop(0, parseColorToRgba(c0, 1.0));
            segGrad.addColorStop(1, parseColorToRgba(c1, 1.0));
            ctx.strokeStyle = segGrad;
          }
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
      }
    });

    // 3. Marcador final (ponto luminoso no último valor do segmento mais recente)
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && lastSeg.length > 0) {
      const lastPt = lastSeg[lastSeg.length - 1];
      const lastColor = getPointColor(lastPt.v, lastPt.t);
      ctx.save();
      ctx.shadowColor = lastColor;
      ctx.shadowBlur = 4;
      ctx.fillStyle = lastColor;
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
          const ptY = calcPy(closest.v);
          const ptColor = getPointColor(closest.v, closest.t);
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = ptColor;
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
    normalLineColor,
    thresholds,
    lineWidth,
    areaOpacity,
    lineInterpolation,
    disconnectThreshold,
    isCrosshairActiveForCol,
    hoveredTimestamp,
    binaryStepHighlight,
    episodes,
    violationColor,
    thresholdComparisonMode,
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

