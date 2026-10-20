import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import {
  PanelProps,
  Field,
  FieldType,
  getFieldDisplayName,
  GrafanaTheme2,
} from '@grafana/data';
import { SimpleOptions, CustomFieldConfig, NativeThresholdsConfig } from '../types';
import { FilterBadgePopover, ColumnFilterConfig } from './ColumnFilterModal';
import { css } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import {
  HistoryAlertIcon,
  AlertEpisode,
  getAlertEpisodes,
  formatFieldValue,
  getActiveNativeThreshold,
  getFieldExactMatch,
  getFieldThresholds,
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
  TimeSeriesRenderer,
  PanelInteractionContext,
  PanelInteractionContextValue,
  getHealthyToneSteps,
} from './CellRenderers';

export {
  BadgeRenderer,
  ProgressBarRenderer,
  SegmentedBarRenderer,
  DeltaTrendRenderer,
  HeatmapStrip,
  TimeSeriesRenderer,
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

export interface TimeAxisSplit {
  timestamp: number;
  label: string;
  pct: number;
}

/**
 * Gera splits temporais para o Eixo de Tempo idênticos ao uPlot / vale-time-series.
 * Utiliza passos temporais limpos e formatação tabular DD/MM HH:mm ou HH:mm.
 */
export function generateTimeAxisSplits(
  tStart: number,
  tEnd: number,
  targetSplits = 6
): TimeAxisSplit[] {
  const spanMs = Math.max(1, tEnd - tStart);
  const minDate = new Date(tStart);
  const maxDate = new Date(tEnd);
  const spansDays =
    minDate.getDate() !== maxDate.getDate() ||
    minDate.getMonth() !== maxDate.getMonth() ||
    minDate.getFullYear() !== maxDate.getFullYear();

  const candidateStepsMs = [
    5 * 1000,
    10 * 1000,
    15 * 1000,
    30 * 1000,
    60 * 1000,
    2 * 60 * 1000,
    5 * 60 * 1000,
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
    48 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
  ];

  const targetStep = spanMs / Math.max(1, targetSplits);
  let chosenStep = candidateStepsMs[candidateStepsMs.length - 1];
  for (const step of candidateStepsMs) {
    if (step >= targetStep) {
      chosenStep = step;
      break;
    }
  }

  const formatTickLabel = (ts: number): string => {
    const d = new Date(ts);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${mins}`;
    if (spansDays) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month} ${timeStr}`;
    }
    return timeStr;
  };

  const splits: TimeAxisSplit[] = [];
  const firstTick = Math.ceil(tStart / chosenStep) * chosenStep;

  for (let t = firstTick; t <= tEnd; t += chosenStep) {
    const pct = ((t - tStart) / spanMs) * 100;
    if (pct >= 2 && pct <= 98) {
      splits.push({
        timestamp: t,
        label: formatTickLabel(t),
        pct,
      });
    }
  }

  if (splits.length < 2) {
    splits.length = 0;
    const count = Math.max(2, Math.min(targetSplits, 4));
    for (let i = 0; i <= count; i++) {
      const t = tStart + (spanMs * i) / count;
      const pct = (i / count) * 100;
      splits.push({
        timestamp: t,
        label: formatTickLabel(t),
        pct,
      });
    }
  }

  return splits;
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
      height: ${ROW_HEIGHT}px;
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

export let currentActivePanelMode: 'table' | 'heatmap' = 'table';

export const TablePanel: React.FC<Props> = ({
  id: panelId,
  options,
  data,
  width,
  height,
  fieldConfig,
}) => {
  currentActivePanelMode = options.panelMode ?? 'table';
  if (typeof window !== 'undefined') {
    (window as any).__VALE_PANEL_MODE__ = currentActivePanelMode;
  }
  const theme = useTheme2();
  const styles = useStyles2(getStyles);

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
  const [singleHostViewOverride, setSingleHostViewOverride] = useState<'keyvalue' | 'table' | null>(null);

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

    const isGenericName = (name?: string | null): boolean => {
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
    };

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

        const custom = (targetField.config?.custom ?? {}) as CustomFieldConfig;

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

        // Separador em displayName (ex: "Host: Métrica")
        const rawDisplayName = getFieldDisplayName(targetField, df).trim();
        const sepMatch = rawDisplayName.match(/^(.+?)\s*(?::\s*|\s+-\s+|\s+\/\s+|\s+>\s+|\s+·\s+)(.+)$/);
        const sepHost = sepMatch ? sepMatch[1].trim() : '';
        const sepMetric = sepMatch ? sepMatch[2].trim() : '';

        // 2. Extração da Métrica por labels
        const labelMetric =
          targetField.labels?.__name__ ||
          targetField.labels?.metric ||
          targetField.labels?.item ||
          targetField.labels?.metric_name ||
          targetField.labels?.item_name ||
          targetField.labels?.name ||
          targetField.labels?.key;

        const customMetric = custom?.label?.trim() || targetField.config?.displayName?.trim();

        // 3. Resolução rigorosa do Nome da Métrica (nunca aceita 'Value' se houver outro identificador)
        let resolvedMetric = '';
        if (customMetric) {
          resolvedMetric = customMetric;
        } else if (labelMetric) {
          resolvedMetric = labelMetric;
        } else if (sepMetric) {
          resolvedMetric = sepMetric;
        } else if (!isGenericName(targetField.name) && targetField.name !== labelHost && targetField.name !== sepHost) {
          resolvedMetric = targetField.name;
        } else if (!isGenericName(df.name) && df.name !== labelHost && df.name !== sepHost) {
          resolvedMetric = df.name!;
        } else if (!isGenericName(rawDisplayName) && rawDisplayName !== labelHost && rawDisplayName !== sepHost) {
          resolvedMetric = rawDisplayName;
        } else if (df.refId) {
          resolvedMetric = `Métrica ${df.refId}`;
        } else {
          resolvedMetric = dataFields.length > 1 ? `Métrica ${targetFieldIndex + 1}` : `Métrica ${dfIndex + 1}`;
        }

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

        // Atualiza displayName no state do field para que o seletor de Overrides ("Fields with name")
        // reconheça perfeitamente a métrica
        if (targetField.state) {
          targetField.state.displayName = cleanMetric;
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

        // Histórico de episódios na janela (apenas para métricas numéricas com thresholds)
        const episodes = !isStringField
          ? getAlertEpisodes(
              values as number[],
              timeValues,
              thresholds,
              tStart,
              tEnd,
              exactMatch,
              disconnectThreshold
            )
          : [];

        // Avalia se há violação ativa agora (somente se ultrapassar o threshold configurado)
        const currentStep =
          !isStringField && typeof lastVal === 'number'
            ? getActiveNativeThreshold(lastVal, thresholds, exactMatch)
            : null;
        const sortedThresholdSteps = [...(thresholds?.steps || [])].sort((a, b) => {
          const av = a.value !== null && a.value !== undefined ? Number(a.value) : -Infinity;
          const bv = b.value !== null && b.value !== undefined ? Number(b.value) : -Infinity;
          return av - bv;
        });
        const baseThresholdStep = sortedThresholdSteps[0];
        const isCurrentStepViolation = Boolean(
          currentStep &&
          currentStep !== baseThresholdStep &&
          currentStep.value !== null &&
          currentStep.value !== undefined &&
          Number(currentStep.value) !== -Infinity &&
          !isNaN(Number(currentStep.value))
        );
        const hasActiveEpisode = episodes.some((ep) => ep.isActiveNow);

        const isActiveNow = isCurrentStepViolation || hasActiveEpisode;

        // Determina a cor do threshold violado (para destaque)
        let corDoThreshold = '#F2495C';
        if (isCurrentStepViolation && currentStep?.color) {
          corDoThreshold = resolveAlertHexColor(currentStep.color);
        } else if (hasActiveEpisode) {
          const highestActive = episodes.find((ep) => ep.isActiveNow);
          if (highestActive) {
            corDoThreshold = resolveAlertHexColor(highestActive.color);
          }
        } else if (formattedLastVal.color) {
          corDoThreshold = formattedLastVal.color;
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
              exactMatch,
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

        // Lê displayMode vindo do Override do Grafana ou das opções gerais do painel
        // Campos string sempre renderizam normalmente usando o estilo "Texto/Valor"
        const rawMode =
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
            currentStep?.value !== null && currentStep?.value !== undefined
              ? Number(currentStep.value)
              : undefined,
          lastEpisodeStart: episodes.length > 0 ? episodes[0].startTs : undefined,
          tStart,
          tEnd,
          thresholds,
          exactMatch,
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

      const iconName = resolveIconName(options.hostIconName || 'server');

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
  }, [uniqueHosts, matrix, sortConfig, options.hostIconName]);

  // ── 3. Renderização Dinâmica de Célula via switch/case baseado no displayMode ──
  const renderMetricCell = (
    s: MetricCellData,
    hostName: string,
    metricName: string,
    mode: string
  ) => {
    const isStringField = s.field.type === FieldType.string;
    const effectiveMode = isStringField ? 'text' : mode;

    const custom = (s.field.config?.custom ?? {}) as CustomFieldConfig;
    const useThresholdColors = Boolean(
      custom.useThresholdColors ?? custom.colorValueByThreshold ?? options.useThresholdColors ?? false
    );
    const defaultTextColor = 'rgba(255, 255, 255, 0.72)';
    const textColor = useThresholdColors
      ? (s.isActiveNow
          ? s.corDoThreshold
          : (s.formattedLastVal.color || defaultTextColor))
      : defaultTextColor;

    // Universalidade do botão ! : qualquer métrica com Threshold e alerta (ativo ou histórico na janela)
    const enableAlertPopup = custom.enableAlertPopup ?? options.enableAlertPopup ?? true;
    const hasThresholdAndAlert = Boolean(
      (s.thresholds?.steps?.length || s.field.config?.thresholds?.steps?.length) &&
      (s.isActiveNow || s.hasHistoricalAlert || (s.badge && s.badge.state !== 'normal'))
    );

    const effectiveBadge: BadgeInfo =
      s.badge && s.badge.state !== 'normal'
        ? s.badge
        : {
            state: s.isActiveNow ? 'active' : s.hasHistoricalAlert ? 'historical' : 'normal',
            color: s.corDoThreshold || (s.hasHistoricalAlert ? '#EAB839' : '#F2495C'),
            episodes: s.episodes || [],
          };

    const canShowAlert = enableAlertPopup && hasThresholdAndAlert && effectiveBadge.state !== 'normal';

    const renderAlertButton = () => {
      if (!canShowAlert) return null;
      return (
        <AlertBadgePopover
          badge={effectiveBadge}
          tStart={tStart}
          tEnd={tEnd}
          styles={styles}
          field={s.field}
          exactMatch={s.exactMatch}
          fieldConfig={fieldConfig}
          metricLabel={`${hostName} · ${metricName}`}
          currentValueText={s.formattedLastVal.text}
          currentValueColor={textColor}
          size={18}
        />
      );
    };

    switch (effectiveMode) {
      case 'timeseries':
      case 'sparkline': {
        const rawValueMode = custom.timeSeriesValueMode || options.timeSeriesValueMode || 'text';
        const valueMode: 'badge' | 'text' | 'hidden' =
          rawValueMode === 'badge' || rawValueMode === 'hidden' ? rawValueMode : 'text';

        const badgeColor = useThresholdColors
          ? s.isActiveNow
            ? s.corDoThreshold
            : s.hasHistoricalAlert
            ? '#EAB839'
            : '#73BF69'
          : (s.formattedLastVal.color || undefined);

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
            <div style={{ flex: 1, minWidth: 50, height: 20 }}>
              <TimeSeriesRenderer
                values={s.values}
                timeValues={s.timeValues}
                tStart={tStart}
                tEnd={tEnd}
                lineColor={useThresholdColors ? s.corDoThreshold : (custom.lineColor || '#00B59B')}
                lineWidth={custom.lineWidth ?? 1.5}
                areaOpacity={custom.areaOpacity ?? 25}
                lineInterpolation={custom.lineInterpolation || 'smooth'}
                disconnectThreshold={disconnectThreshold}
                height={20}
                columnKey={metricName}
                formatValue={(val) => formatFieldValue(val, s.field, theme).text}
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
          ? s.isActiveNow
            ? s.corDoThreshold
            : s.hasHistoricalAlert
            ? '#EAB839'
            : (s.formattedLastVal.color || s.corDoThreshold || '#73BF69')
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

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 60, maxWidth: 140 }}>
              <ProgressBarRenderer
                value={numVal}
                min={progMin}
                max={progMax}
                color={s.corDoThreshold}
                useThreshold={useThresholdColors}
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

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <SegmentedBarRenderer
              value={numVal}
              min={segMin}
              max={segMax}
              color={s.corDoThreshold}
              isActiveThreshold={useThresholdColors && s.isActiveNow}
              formattedValue={s.formattedLastVal.text}
              showValueText={showVal}
            />
            {renderAlertButton()}
          </div>
        );
      }

      case 'deltatrend': {
        const numVal = typeof s.lastVal === 'number' ? s.lastVal : null;
        const showDelta = custom.showDeltaValue ?? true;
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <DeltaTrendRenderer
              current={numVal}
              periodAvg={s.avgVal}
              formattedCurrent={s.formattedLastVal.text}
              formattedDelta={
                showDelta && numVal !== null && s.avgVal !== null
                  ? formatFieldValue(Math.abs(numVal - s.avgVal), s.field, theme).text
                  : undefined
              }
              thresholdColor={s.corDoThreshold}
              isActiveThreshold={useThresholdColors && s.isActiveNow}
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
    const metricHeaderLabel =
      referenceCell?.field?.config?.custom?.label ||
      referenceCell?.field?.config?.displayName ||
      referenceCell?.field?.name ||
      primaryMetricName ||
      'Host';

    // Largura disponível para o centro do gráfico (quadradinhos + eixo X)
    const availableChartWidth = Math.max(80, width - hostColWidth - nowColWidth - 44);
    // Adapta dinamicamente os rótulos do eixo X de acordo com a largura real do gráfico
    const dynamicTargetSplits = Math.max(2, Math.min(10, Math.floor(availableChartWidth / 90)));
    const timeSplits = generateTimeAxisSplits(tStart, tEnd, dynamicTargetSplits);

    const showHostIcon = options.showHostIcon ?? true;
    const defaultHostIcon = options.hostIconName || 'server';
    const hostIconBgMode = options.hostIconBgMode ?? 'contained';

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

          {/* Rótulo Superior elegante para o Heatmap (sem estilo de cabeçalho tabular) */}
          {(options.showHeatmapHeader ?? true) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 14px 4px 14px',
                background: 'transparent',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              <div
                onClick={() => handleSort('__host__')}
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  gap: 1,
                  cursor: 'pointer',
                }}
                title="Clique para ordenar por Host"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      color: 'rgba(255, 255, 255, 0.88)',
                    }}
                  >
                    {options.heatmapCustomLabel?.trim() || metricHeaderLabel}
                  </span>
                  {sortConfig.column === '__host__' && (
                    <Icon
                      name={sortConfig.direction === 'asc' ? 'arrow-up' : 'arrow-down'}
                      size="xs"
                      style={{ color: '#38bdf8', flexShrink: 0 }}
                    />
                  )}
                </div>
                {options.heatmapCustomSubtitle?.trim() && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'rgba(255, 255, 255, 0.45)',
                      lineHeight: 1.2,
                    }}
                  >
                    {options.heatmapCustomSubtitle.trim()}
                  </span>
                )}
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
            {sortedHosts.map((host, rowIdx) => {
              const s =
                host.metrics[primaryMetricName] || Object.values(host.metrics)[0];
              const isEven = rowIdx % 2 === 1;
              const rowBg = isEven ? 'rgba(0, 0, 0, 0.18)' : 'transparent';

              const custom = (s?.field?.config?.custom ?? {}) as CustomFieldConfig;
              const enableAlertPopup = custom.enableAlertPopup ?? options.enableAlertPopup ?? true;
              const hasThresholdAndAlert = Boolean(
                s &&
                  (s.thresholds?.steps?.length || s.field.config?.thresholds?.steps?.length) &&
                  (s.isActiveNow || s.hasHistoricalAlert || (s.badge && s.badge.state !== 'normal'))
              );
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
                hasThresholdAndAlert &&
                effectiveBadge.state !== 'normal';

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
                        const colorByThreshold = options.colorHostIconByThreshold ?? false;
                        const isThresholdActive =
                          colorByThreshold &&
                          Boolean(s?.isActiveNow || s?.hasHistoricalAlert || host.hasHistoricalAlert);
                        const hostIconColor = isThresholdActive
                          ? s?.isActiveNow
                            ? s.corDoThreshold
                            : '#EAB839'
                          : 'rgba(255, 255, 255, 0.72)';
                        const isContained = hostIconBgMode === 'contained';
                        return (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 22,
                              height: 22,
                              borderRadius: 5,
                              backgroundColor: isContained
                                ? isThresholdActive
                                  ? `color-mix(in srgb, ${hostIconColor} 18%, transparent)`
                                  : 'rgba(255, 255, 255, 0.06)'
                                : 'transparent',
                              border: isContained
                                ? isThresholdActive
                                  ? `1px solid color-mix(in srgb, ${hostIconColor} 30%, transparent)`
                                  : '1px solid rgba(255, 255, 255, 0.12)'
                                : 'none',
                              boxShadow:
                                isContained && isThresholdActive
                                  ? `0 0 6px color-mix(in srgb, ${hostIconColor} 18%, transparent)`
                                  : 'none',
                              flexShrink: 0,
                              transition: 'all 0.2s ease',
                            }}
                          >
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
                        fieldConfig={fieldConfig}
                        metricLabel={`${host.hostName} · ${s.metricName}`}
                        currentValueText={s.formattedLastVal.text}
                        currentValueColor={nowColor}
                        size={18}
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
            })}

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

              {/* Coluna 2: Apenas os horários perfeitamente alinhados na vertical */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '16px',
                  lineHeight: '16px',
                }}
              >
                {timeSplits.map((split) => {
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
                        alignItems: 'center',
                        transform: isStart
                          ? 'translateX(0)'
                          : isEnd
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          lineHeight: '16px',
                          fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'rgba(255, 255, 255, 0.45)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {split.label}
                      </span>
                    </div>
                  );
                })}
              </div>

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

  const isSingleHostCondition = filteredHosts.length === 1;

  let isSingleHostMode = false;
  if (options.panelMode === 'table') {
    if (singleHostViewOverride === 'keyvalue') {
      isSingleHostMode = true;
    } else if (singleHostViewOverride === 'table') {
      isSingleHostMode = false;
    } else if (options.singleHostLayout === 'keyvalue') {
      isSingleHostMode = true;
    } else if (options.singleHostLayout !== 'table' && isSingleHostCondition) {
      isSingleHostMode = true;
    }
  }

  if (isSingleHostMode && filteredHosts.length > 0) {
    const host = filteredHosts[0];

    return (
      <PanelInteractionContext.Provider key={panelId} value={panelInteractionContextValue}>
        <div className={styles.container} ref={containerRef}>
          {/* Linha Guia Vertical Pontilhada Global (Shared Crosshair) */}
          <div ref={crosshairLineRef} className={styles.globalCrosshairLine}>
            <div ref={crosshairTimeRef} className={styles.globalCrosshairTimeBadge} />
          </div>

          {/* Rótulo superior da visualização de host único */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 12,
              padding: '5px 14px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              background: '#0c141d',
              flexShrink: 0,
            }}
          >
            {/* Botão switch on/off posicionado à esquerda com as cores neutras do plugin */}
            <div
              onClick={() => setSingleHostViewOverride('table')}
              style={{
                width: 26,
                height: 14,
                borderRadius: 7,
                background: 'rgba(255, 255, 255, 0.22)',
                border: '1px solid rgba(255, 255, 255, 0.38)',
                position: 'relative',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'background 0.2s ease, border-color 0.2s ease',
                flexShrink: 0,
              }}
              title="Alternar para exibição em tabela (Desligar host único)"
            >
              <div
                style={{
                  position: 'absolute',
                  top: 1,
                  right: 1.5,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.55)',
                }}
              />
            </div>

            {/* Título e Subtexto como subtexto vertical */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  color: 'rgba(255, 255, 255, 0.92)',
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {options.singleHostCustomLabel?.trim() || host.hostName}
              </span>
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 400,
                  color: host.isActiveNow
                    ? (host.corDoThreshold || '#F2495C')
                    : 'rgba(255, 255, 255, 0.45)',
                  lineHeight: 1.2,
                }}
              >
                {options.singleHostCustomStatusText?.trim() || (host.isActiveNow ? 'Em Alerta' : 'Operacional')}
              </span>
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
              const rowBg = isEven && enableZebra ? 'rgba(0, 0, 0, 0.18)' : 'transparent';
              const custom = (s?.field?.config?.custom ?? {}) as CustomFieldConfig;

              return (
                <div
                  key={metricName}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 18px',
                    minHeight: `${effectiveRowHeight}px`,
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
                    {custom.icon && (
                      <Icon
                        name={resolveIconName(custom.icon) as any}
                        size="sm"
                        style={{ color: 'rgba(255, 255, 255, 0.5)', flexShrink: 0 }}
                      />
                    )}
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
                      {custom.label || metricName}
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

        {isSingleHostCondition && options.showHeader === false && (
          <div
            onClick={() => setSingleHostViewOverride('keyvalue')}
            style={{
              position: 'absolute',
              top: 6,
              left: 8,
              zIndex: 15,
              width: 26,
              height: 14,
              borderRadius: 7,
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              cursor: 'pointer',
              userSelect: 'none',
              flexShrink: 0,
            }}
            title="Alternar para visualização de host único (Ligar)"
          >
            <div
              style={{
                position: 'absolute',
                top: 1,
                left: 1.5,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.7)',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
              }}
            />
          </div>
        )}

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
                          isSingleHostMode={isSingleHostMode}
                          onToggleSingleHostMode={
                            isSingleHostCondition
                              ? () => setSingleHostViewOverride(isSingleHostMode ? 'table' : 'keyvalue')
                              : undefined
                          }
                        />
                      )}

                      {/* Quando em tabela com 1 host: switch on/off compacto no cabeçalho sem ocupar espaço extra */}
                      {isSingleHostCondition && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSingleHostViewOverride('keyvalue');
                          }}
                          style={{
                            width: 26,
                            height: 14,
                            borderRadius: 7,
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            position: 'relative',
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'background 0.2s ease, border-color 0.2s ease',
                            flexShrink: 0,
                          }}
                          title="Alternar para visualização de host único (Ligar)"
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: 1,
                              left: 1.5,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: 'rgba(255, 255, 255, 0.65)',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
                            }}
                          />
                        </div>
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
                  const customConfig = (sampleField?.config?.custom ?? {}) as CustomFieldConfig;
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
                      title={`Clique para ordenar por ${metricName}`}
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
                              colTitle={metricName}
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
                              isSingleHostMode={isSingleHostMode}
                              onToggleSingleHostMode={
                                isSingleHostCondition
                                  ? () => setSingleHostViewOverride(isSingleHostMode ? 'table' : 'keyvalue')
                                  : undefined
                              }
                            />
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {metricName}
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
                          const colorByThreshold = options.colorHostIconByThreshold ?? false;
                          const isThresholdActive =
                            colorByThreshold &&
                            Boolean(host.isActiveNow || host.hasHistoricalAlert);
                          const hostIconColor = isThresholdActive
                            ? host.isActiveNow
                              ? host.corDoThreshold
                              : '#EAB839'
                            : 'rgba(255, 255, 255, 0.72)';
                          const isContained = hostIconBgMode === 'contained';
                          return (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                backgroundColor: isContained
                                  ? isThresholdActive
                                    ? `color-mix(in srgb, ${hostIconColor} 18%, transparent)`
                                    : 'rgba(255, 255, 255, 0.06)'
                                  : 'transparent',
                                border: isContained
                                  ? isThresholdActive
                                    ? `1px solid color-mix(in srgb, ${hostIconColor} 30%, transparent)`
                                    : '1px solid rgba(255, 255, 255, 0.12)'
                                  : 'none',
                                boxShadow:
                                  isContained && isThresholdActive
                                    ? `0 0 6px color-mix(in srgb, ${hostIconColor} 18%, transparent)`
                                    : 'none',
                                flexShrink: 0,
                                transition: 'all 0.2s ease',
                              }}
                            >
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
          </table>
        </div>
      </div>
    </PanelInteractionContext.Provider>
  );
};
