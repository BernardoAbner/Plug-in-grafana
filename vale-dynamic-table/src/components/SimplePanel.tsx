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
  NativeThresholdsConfig, ThresholdStep, CustomFieldConfig, DisconnectThresholdMode,
  ThresholdComparisonMode, MetricProfile,
} from '../types';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView, locationService } from '@grafana/runtime';
import { UplotChart, parseColorToRgba, resolveCanvasColor, estimateTypicalStepMs, resolveDisconnectThresholdMs } from './UplotChart';

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

export function resolveIconName(icon: string): string {
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
export function formatFieldValue(raw: unknown, field: Field, theme: GrafanaTheme2): { text: string; color?: string } {
  // Use Grafana's display logic natively. This handles standard Options like unit, decimals, min, max, thresholds implicitly!
  const displayProcessor = field.display || getDisplayProcessor({ field, theme });
  const display = displayProcessor(raw);
  return { text: display.text + (display.suffix ? display.suffix : ''), color: display.color };
}

export interface ColumnThresholdResult {
  isViolation: boolean;
  color: string;
  activeStep: ThresholdStep | null;
  baseStep: ThresholdStep | null;
}

/**
 * Motor Universal de Avaliação de Thresholds
 * Suporta os modos 'gte' (>=), 'eq' (==) e 'lte' (<=).
 *
 * No modo 'eq' (==): SÓ PINTA se o valor for ESTRITAMENTE IGUAL ao step (ignorando -Infinity / base).
 * Ex: se Ping = 1 (Up) e threshold é == 0 (Vermelho), deve retornar a cor base/saudável, não vermelho!
 */
export function resolveColumnThreshold(
  value: number | null | undefined,
  thresholds: NativeThresholdsConfig | undefined,
  comparisonMode: ThresholdComparisonMode = 'gte',
  theme?: GrafanaTheme2,
  healthyFallbackColor = '#10b981'
): ColumnThresholdResult {
  if (!thresholds?.steps || thresholds.steps.length === 0) {
    return {
      isViolation: false,
      color: healthyFallbackColor,
      activeStep: null,
      baseStep: null,
    };
  }

  const steps = thresholds.steps;

  // Base step é o step com valor nulo/indefinido/-Infinity
  const baseStep =
    steps.find(
      (s) =>
        s.value === null ||
        s.value === undefined ||
        (s.value as any) === '' ||
        Number(s.value) === -Infinity ||
        isNaN(Number(s.value))
    ) || steps[0];

  const baseColor = baseStep?.color ? resolveAlertHexColor(baseStep.color) : healthyFallbackColor;

  if (value === null || value === undefined || isNaN(Number(value))) {
    return {
      isViolation: false,
      color: baseColor,
      activeStep: baseStep,
      baseStep,
    };
  }

  const numVal = Number(value);

  // Steps de violação configurados (valores numéricos finitos diferentes da base)
  const violationSteps = steps.filter(
    (s) =>
      s !== baseStep &&
      s.value !== null &&
      s.value !== undefined &&
      (s.value as any) !== '' &&
      Number(s.value) !== -Infinity &&
      !isNaN(Number(s.value))
  );

  if (violationSteps.length === 0) {
    return {
      isViolation: false,
      color: baseColor,
      activeStep: baseStep,
      baseStep,
    };
  }

  if (comparisonMode === 'eq') {
    // No modo 'eq' (==), SÓ PINTA se o valor for ESTRITAMENTE IGUAL ao step (ignorando o -Infinity)
    const matched = violationSteps.find((s) => Math.abs(numVal - Number(s.value)) < 1e-6);
    if (matched) {
      return {
        isViolation: true,
        color: resolveAlertHexColor(matched.color),
        activeStep: matched,
        baseStep,
      };
    }
    return {
      isViolation: false,
      color: baseColor,
      activeStep: baseStep,
      baseStep,
    };
  }

  if (comparisonMode === 'lte') {
    // No modo 'lte' (<=): o menor valor violado é o mais crítico
    const sortedLte = [...violationSteps].sort((a, b) => Number(a.value) - Number(b.value));
    const matched = sortedLte.find((s) => numVal <= Number(s.value));
    if (matched) {
      return {
        isViolation: true,
        color: resolveAlertHexColor(matched.color),
        activeStep: matched,
        baseStep,
      };
    }
    return {
      isViolation: false,
      color: baseColor,
      activeStep: baseStep,
      baseStep,
    };
  }

  // Modo 'gte' (>=) padrão: o maior valor atingido é a violação ativa
  const sortedGte = [...violationSteps].sort((a, b) => Number(b.value) - Number(a.value));
  const matched = sortedGte.find((s) => numVal >= Number(s.value));
  if (matched) {
    return {
      isViolation: true,
      color: resolveAlertHexColor(matched.color),
      activeStep: matched,
      baseStep,
    };
  }

  return {
    isViolation: false,
    color: baseColor,
    activeStep: baseStep,
    baseStep,
  };
}

/** Retorna o step de threshold ativo para um valor dado um NativeThresholdsConfig. */
export function getActiveNativeThreshold(
  value: number,
  cfg: NativeThresholdsConfig | null | undefined,
  exactMatchOrMode: boolean | ThresholdComparisonMode = false
): ThresholdStep | null {
  if (!cfg?.steps?.length) { return null; }
  const mode: ThresholdComparisonMode =
    typeof exactMatchOrMode === 'string'
      ? exactMatchOrMode
      : exactMatchOrMode
      ? 'eq'
      : 'gte';
  const result = resolveColumnThreshold(value, cfg, mode);
  return result.activeStep;
}


const COMPOSITE_OVERRIDE_KEYS = [
  'timeSeriesConfig',
  'badgeConfig',
  'progressConfig',
  'textConfig',
  'deltaConfig',
  'alertConfig',
] as const;

function doesOverrideMatchField(override: any, field: Field): boolean {
  const fieldName = field.name;
  const displayName = field.state?.displayName;
  return Boolean(
    !override.matcher ||
      (override.matcher.id === 'byName' &&
        (override.matcher.options === fieldName ||
          (displayName && override.matcher.options === displayName))) ||
      (override.matcher.id === 'byRegexp' &&
        (new RegExp(override.matcher.options).test(fieldName) ||
          (displayName && new RegExp(override.matcher.options).test(displayName)))) ||
      (override.matcher.id === 'byType' && override.matcher.options === field.type)
  );
}

/**
 * Busca o valor de uma propriedade específica nos Overrides do campo.
 * Retorna undefined se o usuário NÃO tiver adicionado um override explícito para este campo.
 * Suporta tanto propriedades individuais quanto os pacotes compostos (Aba Completa por Modo).
 */
export function getFieldOverrideProperty<T = any>(
  field: Field | undefined,
  propName: string,
  panelFieldConfig?: FieldConfigSource
): T | undefined {
  if (!field) {
    return undefined;
  }

  if (panelFieldConfig?.overrides) {
    for (const override of panelFieldConfig.overrides) {
      if (doesOverrideMatchField(override, field) && override.properties) {
        // 1. Propriedade direta (ex: custom.lineWidth)
        const directProp = override.properties.find(
          (p: any) => p.id === `custom.${propName}` || p.id === propName
        );
        if (directProp && directProp.value !== undefined) {
          return directProp.value as T;
        }

        // 2. Propriedade dentro de pacote composto (ex: custom.timeSeriesConfig.lineWidth)
        for (const compKey of COMPOSITE_OVERRIDE_KEYS) {
          const compProp = override.properties.find(
            (p: any) => p.id === `custom.${compKey}` || p.id === compKey
          );
          if (compProp && compProp.value && typeof compProp.value === 'object') {
            if (compProp.value[propName] !== undefined) {
              return compProp.value[propName] as T;
            }
            if (propName === 'cellDisplayMode') {
              if (compKey === 'timeSeriesConfig') return 'sparkline' as unknown as T;
              if (compKey === 'badgeConfig') return 'badge' as unknown as T;
              if (compKey === 'progressConfig') return (compProp.value.barType || 'progressBar') as unknown as T;
              if (compKey === 'deltaConfig') return 'deltaTrend' as unknown as T;
              if (compKey === 'textConfig') return 'text' as unknown as T;
            }
          }
        }
      }
    }
  }

  // 3. Fallback: verifica os pacotes compostos já mesclados pelo Grafana em field.config.custom
  const rawCustom = (field.config?.custom ?? {}) as Record<string, any>;
  for (const compKey of COMPOSITE_OVERRIDE_KEYS) {
    const compObj = rawCustom[compKey];
    if (compObj && typeof compObj === 'object') {
      if (compObj[propName] !== undefined) {
        return compObj[propName] as T;
      }
      if (propName === 'cellDisplayMode') {
        if (compKey === 'timeSeriesConfig') return 'sparkline' as unknown as T;
        if (compKey === 'badgeConfig') return 'badge' as unknown as T;
        if (compKey === 'progressConfig') return (compObj.barType || 'progressBar') as unknown as T;
        if (compKey === 'deltaConfig') return 'deltaTrend' as unknown as T;
        if (compKey === 'textConfig') return 'text' as unknown as T;
      }
    }
  }

  return undefined;
}

/**
 * Mescla field.config.custom com quaisquer pacotes compostos (Aba Completa por Modo)
 * aplicados via Override Properties. Se o usuário adicionou uma aba de visualização
 * (ex: timeSeriesConfig, badgeConfig, progressConfig, deltaConfig, textConfig),
 * ativa automaticamente o respectivo cellDisplayMode na coluna.
 */
export function getEffectiveCustomConfig(
  field: Field | undefined,
  panelFieldConfig?: FieldConfigSource
): CustomFieldConfig {
  if (!field) {
    return {};
  }
  const base = { ...(field.config?.custom ?? {}) } as CustomFieldConfig;
  // 'label' é exclusivo de Override Properties (hideFromDefaults: true);
  // nunca herda valores residuais salvos em fieldConfig.defaults.custom.label.
  delete base.label;
  let inferredMode: CustomFieldConfig['cellDisplayMode'] | undefined;
  let hasExplicitModeOverride = false;

  // Mescla pacotes compostos vindos de field.config.custom
  if (base.textConfig && typeof base.textConfig === 'object') {
    Object.assign(base, base.textConfig);
    inferredMode = 'text';
  }
  if (base.badgeConfig && typeof base.badgeConfig === 'object') {
    Object.assign(base, base.badgeConfig);
    inferredMode = 'badge';
  }
  if (base.progressConfig && typeof base.progressConfig === 'object') {
    Object.assign(base, base.progressConfig);
    inferredMode = base.progressConfig.barType || 'progressBar';
  }
  if (base.deltaConfig && typeof base.deltaConfig === 'object') {
    Object.assign(base, base.deltaConfig);
    inferredMode = 'deltaTrend';
  }
  if (base.timeSeriesConfig && typeof base.timeSeriesConfig === 'object') {
    Object.assign(base, base.timeSeriesConfig);
    if (base.timeSeriesConfig.sparklineHeight === undefined) {
      delete base.sparklineHeight;
    }
    inferredMode = 'sparkline';
  }
  if (base.alertConfig && typeof base.alertConfig === 'object') {
    Object.assign(base, base.alertConfig);
  }

  // Mescla pacotes compostos e propriedades diretas vindas de panelFieldConfig.overrides
  if (panelFieldConfig?.overrides) {
    for (const override of panelFieldConfig.overrides) {
      if (doesOverrideMatchField(override, field) && override.properties) {
        for (const prop of override.properties) {
          if ((prop.id === 'custom.label' || prop.id === 'label') && typeof prop.value === 'string') {
            base.label = prop.value;
          }
          if (prop.id === 'custom.cellDisplayMode' || prop.id === 'cellDisplayMode') {
            hasExplicitModeOverride = true;
            base.cellDisplayMode = prop.value;
          }
          for (const compKey of COMPOSITE_OVERRIDE_KEYS) {
            if ((prop.id === `custom.${compKey}` || prop.id === compKey) && prop.value && typeof prop.value === 'object') {
              Object.assign(base, prop.value);
              if (compKey === 'timeSeriesConfig') {
                inferredMode = 'sparkline';
                if (prop.value.sparklineHeight === undefined) {
                  delete base.sparklineHeight;
                }
              }
              else if (compKey === 'badgeConfig') inferredMode = 'badge';
              else if (compKey === 'progressConfig') inferredMode = prop.value.barType || 'progressBar';
              else if (compKey === 'deltaConfig') inferredMode = 'deltaTrend';
              else if (compKey === 'textConfig') inferredMode = 'text';
            }
          }
        }
      }
    }
  }

  if (!hasExplicitModeOverride && inferredMode) {
    base.cellDisplayMode = inferredMode;
  }

  return base;
}

/**
 * Obtém se a métrica avalia thresholds por correspondência exata (==)
 * Prioriza: override no fieldConfig > field.config.custom > panel options > false
 */
export function getFieldExactMatch(
  field: Field,
  panelExactMatch = false,
  panelFieldConfig?: FieldConfigSource
): boolean {
  if (panelFieldConfig?.overrides) {
    for (const override of panelFieldConfig.overrides) {
      const fieldName = field.name;
      const displayName = field.state?.displayName;
      const matches =
        !override.matcher ||
        (override.matcher.id === 'byName' && (override.matcher.options === fieldName || (displayName && override.matcher.options === displayName))) ||
        (override.matcher.id === 'byRegexp' && (new RegExp(override.matcher.options).test(fieldName) || (displayName && new RegExp(override.matcher.options).test(displayName)))) ||
        (override.matcher.id === 'byType' && override.matcher.options === field.type);
      if (matches) {
        const prop = override.properties.find((p) => p.id === 'custom.exactThresholdMatch' || p.id === 'exactThresholdMatch');
        if (prop?.value !== undefined) {
          return Boolean(prop.value);
        }
      }
    }
  }
  const custom = (field.config?.custom ?? {}) as CustomFieldConfig;
  return custom?.exactThresholdMatch ?? panelExactMatch ?? false;
}

/** Usa o threshold nativo do Grafana e preserva a configuração legada do plugin. */
export function getFieldThresholds(
  field: Field,
  theme?: GrafanaTheme2,
  panelFieldConfig?: FieldConfigSource
): NativeThresholdsConfig | undefined {
  // 1. Overrides específicos do campo no panelFieldConfig (se houver)
  let overrideThresholds: any = undefined;
  if (panelFieldConfig?.overrides) {
    for (const override of panelFieldConfig.overrides) {
      const fieldName = field.name;
      const displayName = field.state?.displayName;
      const matches =
        !override.matcher ||
        (override.matcher.id === 'byName' && (override.matcher.options === fieldName || (displayName && override.matcher.options === displayName))) ||
        (override.matcher.id === 'byRegexp' && (new RegExp(override.matcher.options).test(fieldName) || (displayName && new RegExp(override.matcher.options).test(displayName)))) ||
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
  exactMatch = false,
  disconnectThreshold: DisconnectThresholdMode = 'auto'
): AlertDuration[] {
  if (!thresholds?.steps) { return []; }

  // Deduplicar e ordenar steps válidos (não-nulos) de forma crescente
  const validStepsMap = new Map<number, { value: number; color: string }>();
  for (const step of thresholds.steps) {
    if (step.value !== null && step.value !== undefined && !isNaN(Number(step.value))) {
      validStepsMap.set(Number(step.value), { value: Number(step.value), color: step.color });
    }
  }
  const validSteps = [...validStepsMap.values()].sort((a, b) => a.value - b.value);

  if (validSteps.length === 0) { return []; }

  const sampleStep = estimateTypicalStepMs(times, tStart, tEnd);
  const maxGapMs = resolveDisconnectThresholdMs(sampleStep, disconnectThreshold);

  const results: AlertDuration[] = [];

  for (const step of validSteps) {
    let durationMs = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || isNaN(v)) { continue; }
      const violates = exactMatch
        ? Math.abs(v - step.value) < 1e-6
        : v >= step.value;
      if (violates) {
        const ptTime = times[i] !== undefined ? times[i] : (tStart + i * sampleStep);
        let nextPtTime: number;
        if (i + 1 < times.length && times[i + 1] !== undefined && times[i + 1] > ptTime) {
          const dt = times[i + 1] - ptTime;
          nextPtTime = dt > maxGapMs ? (ptTime + sampleStep) : times[i + 1];
        } else if (ptTime < tEnd) {
          const dtEnd = tEnd - ptTime;
          nextPtTime = dtEnd > maxGapMs ? (ptTime + sampleStep) : tEnd;
        } else {
          nextPtTime = ptTime + sampleStep;
        }

        const from = Math.max(ptTime, tStart);
        const to = Math.max(nextPtTime, from + 1);
        durationMs += to - from;
      }
    }
    if (durationMs > 0) {
      results.push({
        value: step.value,
        color: step.color,
        durationMs,
      });
    }
  }

  return results.sort((a, b) => a.value - b.value);
}

// ─── Lógica de Episódios de Alerta e Badge ─────────────────────────────────

export interface AlertEpisode {
  /** Valor do step de threshold violado (identifica o nível/severidade) */
  stepValue: number;
  startTs: number;
  endTs: number;
  durationMs: number;
  /** Cor hexadecimal válida do threshold violado neste episódio */
  color: string;
  /** Estatísticas dos valores reais durante o episódio */
  avgValue: number;
  minValue: number;
  maxValue: number;
  /** true quando o episódio ainda está em andamento (último valor válido pertence a ele) */
  isActiveNow: boolean;
  /** Campos internos para cálculo incremental */
  _sum: number;
  _count: number;
  _lastIndex: number;
}

/**
 * Garante que a cor do alerta seja sempre um hexadecimal válido.
 * Faz fallback caso o Grafana envie "text", "transparent" ou vazio.
 */
export function resolveAlertHexColor(color?: string | null, fallback = '#E24D42'): string {
  const raw = (color ?? '').trim();
  const lower = raw.toLowerCase();
  if (
    !raw ||
    lower === 'text' ||
    lower === 'transparent' ||
    lower.replace(/\s+/g, '') === 'rgba(0,0,0,0)'
  ) {
    return fallback;
  }
  if (raw.startsWith('#')) {
    return raw;
  }
  const namedFallbacks: Record<string, string> = {
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
  };
  if (namedFallbacks[lower]) {
    return namedFallbacks[lower];
  }
  const rgbMatch = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbMatch[1]))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, Number(rgbMatch[2]))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, Number(rgbMatch[3]))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return fallback;
}

/**
 * Determina se o episódio `candidate` possui maior criticidade que `current`.
 * Respeita o modo de comparação do threshold:
 * - 'gte': stepValue maior = mais crítico (ex: 80% > 40%)
 * - 'lte': stepValue menor = mais crítico (ex: 10% < 30%)
 * - 'eq' ou empate: desempate pela ordem de configuração dos steps e peso da cor.
 */
export function isMoreCriticalEpisode(
  candidate: AlertEpisode,
  current: AlertEpisode,
  mode: ThresholdComparisonMode = 'gte',
  thresholds?: NativeThresholdsConfig
): boolean {
  if (mode === 'lte') {
    if (Math.abs(candidate.stepValue - current.stepValue) > 1e-6) {
      return candidate.stepValue < current.stepValue;
    }
  } else if (mode === 'gte') {
    if (Math.abs(candidate.stepValue - current.stepValue) > 1e-6) {
      return candidate.stepValue > current.stepValue;
    }
  }

  // Se o stepValue for igual ou for 'eq', busca a posição nos steps configurados
  if (thresholds?.steps && thresholds.steps.length > 0) {
    const candidateIdx = thresholds.steps.findIndex(
      (s) => s.value !== null && s.value !== undefined && Math.abs(Number(s.value) - candidate.stepValue) < 1e-6
    );
    const currentIdx = thresholds.steps.findIndex(
      (s) => s.value !== null && s.value !== undefined && Math.abs(Number(s.value) - current.stepValue) < 1e-6
    );
    if (candidateIdx !== -1 && currentIdx !== -1 && candidateIdx !== currentIdx) {
      // No Grafana, steps posteriores na lista são mais severos
      return candidateIdx > currentIdx;
    }
  }

  // Fallback por peso de cor de severidade
  const getColorWeight = (color?: string): number => {
    if (!color) return 0;
    const c = color.toLowerCase();
    if (c.includes('dark-red') || c.includes('purple') || c === '#e02f44' || c === '#c4162a' || c === '#8f0714') return 5;
    if (c.includes('red') || c === '#f2495c' || c === '#d44a3a' || c === '#e53935') return 4;
    if (c.includes('orange') || c === '#ff780a' || c === '#fa8f37' || c === '#ff9800') return 3;
    if (c.includes('yellow') || c === '#eab839' || c === '#f2cc0c' || c === '#fbc02d') return 2;
    if (c.includes('blue')) return 1;
    return 0;
  };

  return getColorWeight(candidate.color) > getColorWeight(current.color);
}

/**
 * Remove ocorrências de alerta duplicadas que possuem exatamente o mesmo intervalo de tempo (início e fim iguais),
 * preservando estritamente aquela de MAIOR CRITICIDADE conforme a regra do threshold.
 */
export function deduplicateEpisodesByCriticality(
  episodes: AlertEpisode[],
  mode: ThresholdComparisonMode = 'gte',
  thresholds?: NativeThresholdsConfig
): AlertEpisode[] {
  if (!episodes || episodes.length <= 1) {
    return episodes || [];
  }

  const result: AlertEpisode[] = [];

  for (const ep of episodes) {
    const matchIdx = result.findIndex((existing) => {
      const sameStart = Math.abs(existing.startTs - ep.startTs) <= 1000;
      const sameEnd = Math.abs(existing.endTs - ep.endTs) <= 1000;
      const bothActive = Boolean(existing.isActiveNow) && Boolean(ep.isActiveNow);
      return sameStart && (sameEnd || bothActive);
    });

    if (matchIdx === -1) {
      result.push(ep);
    } else {
      const existing = result[matchIdx];
      if (isMoreCriticalEpisode(ep, existing, mode, thresholds)) {
        result[matchIdx] = ep;
      }
    }
  }

  return result;
}

/**
 * Varre o array de valores avaliando cada threshold step válido em sua própria passagem independente.
 * Retorna um Array Plano (flat array) unificado com todas as ocorrências da janela,
 * ordenado estritamente por:
 *   1º: Casos em aberto (isActiveNow === true) no topo, do maior para o menor stepValue.
 *   2º: Casos encerrados do mais recente para o mais antigo (b.startTs - a.startTs).
 */
export function getAlertEpisodes(
  values: number[],
  times: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  exactMatchOrMode: boolean | ThresholdComparisonMode = false,
  disconnectThreshold: DisconnectThresholdMode = 'auto'
): AlertEpisode[] {
  if (!thresholds?.steps) { return []; }

  const mode: ThresholdComparisonMode =
    typeof exactMatchOrMode === 'string'
      ? exactMatchOrMode
      : exactMatchOrMode
      ? 'eq'
      : 'gte';

  // Deduplicar e ordenar steps válidos (não-nulos) de forma crescente
  const validStepsMap = new Map<number, { value: number; color: string }>();
  for (const step of thresholds.steps) {
    if (step.value !== null && step.value !== undefined && (step.value as any) !== '' && !isNaN(Number(step.value))) {
      const numVal = Number(step.value);
      validStepsMap.set(numVal, {
        value: numVal,
        color: resolveAlertHexColor(step.color),
      });
    }
  }
  const validSteps = [...validStepsMap.values()].sort((a, b) => a.value - b.value);

  if (validSteps.length === 0) { return []; }

  const sampleStep = estimateTypicalStepMs(times, tStart, tEnd);
  const maxGapMs = resolveDisconnectThresholdMs(sampleStep, disconnectThreshold);

  let lastValidIndex = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && (v as any) !== '' && !isNaN(Number(v))) {
      lastValidIndex = i;
      break;
    }
  }

  const allEpisodes: AlertEpisode[] = [];

  // Identifica se a janela atual monitorada está no tempo real (presente)
  // Se for um recorte histórico passado ou filtrado pelo card, nenhum caso pode ser considerado ativo agora
  let isRealtimeWindow = Math.abs(Date.now() - tEnd) < 120000;
  try {
    const rawFilter = typeof window !== 'undefined' ? window.sessionStorage?.getItem(ALERT_TIME_FILTER_STORAGE_KEY) : null;
    if (rawFilter) {
      const parsed = JSON.parse(rawFilter);
      if (parsed && parsed.wasActiveWhenFiltered === false) {
        isRealtimeWindow = false;
      }
    }
  } catch {
    // ignore
  }

  // Passagem independente do início ao fim da série para cada step configurado
  for (const step of validSteps) {
    let current: AlertEpisode | null = null;
    const close = () => {
      if (current) {
        current.isActiveNow = isRealtimeWindow && current._lastIndex === lastValidIndex;
        allEpisodes.push(current);
        current = null;
      }
    };

    for (let i = 0; i < values.length; i++) {
      const rawVal = values[i];

      // Valor inválido/inexistente quebra a continuidade do episódio
      if (rawVal === null || rawVal === undefined || (rawVal as any) === '' || isNaN(Number(rawVal))) {
        close();
        continue;
      }

      const value = Number(rawVal);
      let violates = false;
      if (mode === 'eq') {
        violates = Math.abs(value - step.value) < 1e-6;
      } else if (mode === 'lte') {
        violates = value <= step.value;
      } else {
        violates = value >= step.value;
      }

      if (!violates) {
        close();
        continue;
      }

      const ptTime = times[i] !== undefined ? times[i] : (tStart + i * sampleStep);
      let nextPtTime: number;
      let hasGapAfter = false;
      if (i + 1 < times.length && times[i + 1] !== undefined && times[i + 1] > ptTime) {
        const dt = times[i + 1] - ptTime;
        if (dt > maxGapMs) {
          nextPtTime = ptTime + sampleStep;
          hasGapAfter = true;
        } else {
          nextPtTime = times[i + 1];
        }
      } else if (ptTime < tEnd) {
        const dtEnd = tEnd - ptTime;
        nextPtTime = dtEnd > maxGapMs ? (ptTime + sampleStep) : tEnd;
      } else {
        nextPtTime = ptTime + sampleStep;
      }

      const from = Math.max(ptTime, tStart);
      const to = Math.max(nextPtTime, from + 1);

      if (current) {
        current.endTs = to;
        current.durationMs += to - from;
        current._sum += value;
        current._count += 1;
        current._lastIndex = i;
        current.avgValue = current._sum / current._count;
        if (value < current.minValue) { current.minValue = value; }
        if (value > current.maxValue) { current.maxValue = value; }
      } else {
        current = {
          stepValue: step.value,
          startTs: from,
          endTs: to,
          durationMs: to - from,
          color: step.color,
          avgValue: value,
          minValue: value,
          maxValue: value,
          isActiveNow: false,
          _sum: value,
          _count: 1,
          _lastIndex: i,
        };
      }

      if (hasGapAfter) {
        // Fecha o episódio antes do período sem dados para não somar horas offline como alerta
        close();
      }
    }
    close();
  }

  // Deduplica episódios com o mesmo intervalo de tempo na mesma métrica,
  // mantendo apenas aquele de maior criticidade
  const deduplicated = deduplicateEpisodesByCriticality(allEpisodes, mode, thresholds);

  // Ordenação estrita do array plano unificado:
  // 1º: Casos isActiveNow === true no topo (ordenados por maior severidade)
  // 2º: Casos encerrados ordenados do mais recente para o mais antigo (b.startTs - a.startTs)
  return deduplicated.sort((a, b) => {
    const aActive = Boolean(a.isActiveNow);
    const bActive = Boolean(b.isActiveNow);

    if (aActive !== bActive) {
      return aActive ? -1 : 1;
    }

    if (aActive && bActive) {
      return mode === 'lte' ? a.stepValue - b.stepValue : b.stepValue - a.stepValue;
    }

    if (b.startTs !== a.startTs) {
      return b.startTs - a.startTs;
    }

    return mode === 'lte' ? a.stepValue - b.stepValue : b.stepValue - a.stepValue;
  });
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
  /** Tempo total (ms) em que houve coleta válida de dados na janela */
  monitoredDurationMs?: number;
  /** Tempo total (ms) em que a métrica esteve saudável (sem violar thresholds) com coleta válida */
  healthyDurationMs?: number;
}

/**
 * Calcula a duração total efetivamente monitorada/coletada (monitoredDurationMs)
 * e a duração em estado saudável sem violação de threshold (healthyDurationMs) na janela [tStart, tEnd],
 * respeitando estritamente o mesmo maxGapMs de desconexão usado em getAlertEpisodes.
 * Evita que lacunas sem coleta de dados (gaps) sejam contabilizadas falsamente como tempo "Up" (disponível).
 */
export function getMonitoredAndHealthyDurationMs(
  values: number[],
  times: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  exactMatchOrMode: boolean | ThresholdComparisonMode = false,
  disconnectThreshold: DisconnectThresholdMode = 'auto'
): { monitoredDurationMs: number; healthyDurationMs: number } {
  if (!values || values.length === 0) {
    return { monitoredDurationMs: 0, healthyDurationMs: 0 };
  }

  const mode: ThresholdComparisonMode =
    typeof exactMatchOrMode === 'string'
      ? exactMatchOrMode
      : exactMatchOrMode
      ? 'eq'
      : 'gte';

  const validSteps: number[] = [];
  if (thresholds?.steps) {
    for (const step of thresholds.steps) {
      if (step.value !== null && step.value !== undefined && (step.value as any) !== '' && !isNaN(Number(step.value))) {
        validSteps.push(Number(step.value));
      }
    }
  }

  const sampleStep = estimateTypicalStepMs(times, tStart, tEnd);
  const maxGapMs = resolveDisconnectThresholdMs(sampleStep, disconnectThreshold);

  let monitoredDurationMs = 0;
  let healthyDurationMs = 0;

  for (let i = 0; i < values.length; i++) {
    const rawVal = values[i];
    if (rawVal === null || rawVal === undefined || (rawVal as any) === '' || isNaN(Number(rawVal))) {
      continue;
    }

    const value = Number(rawVal);

    const ptTime = times[i] !== undefined ? times[i] : (tStart + i * sampleStep);
    let nextPtTime: number;
    if (i + 1 < times.length && times[i + 1] !== undefined && times[i + 1] > ptTime) {
      const dt = times[i + 1] - ptTime;
      if (dt > maxGapMs) {
        nextPtTime = ptTime + sampleStep;
      } else {
        nextPtTime = times[i + 1];
      }
    } else if (ptTime < tEnd) {
      const dtEnd = tEnd - ptTime;
      nextPtTime = dtEnd > maxGapMs ? (ptTime + sampleStep) : tEnd;
    } else {
      nextPtTime = ptTime + sampleStep;
    }

    const from = Math.max(ptTime, tStart);
    const to = Math.max(nextPtTime, from + 1);
    const segMs = Math.max(0, to - from);

    monitoredDurationMs += segMs;

    let violates = false;
    for (const stepVal of validSteps) {
      if (mode === 'eq') {
        if (Math.abs(value - stepVal) < 1e-6) {
          violates = true;
          break;
        }
      } else if (mode === 'lte') {
        if (value <= stepVal) {
          violates = true;
          break;
        }
      } else {
        if (value >= stepVal) {
          violates = true;
          break;
        }
      }
    }

    if (!violates) {
      healthyDurationMs += segMs;
    }
  }

  return { monitoredDurationMs, healthyDurationMs };
}

/**
 * Calcula o estado unificado do badge para uma série com base nos episódios processados.
 */
export function getBadgeState(
  lastVal: number | null,
  allValues: number[],
  timeValues: number[],
  thresholds: NativeThresholdsConfig | undefined,
  tStart: number,
  tEnd: number,
  _theme: GrafanaTheme2,
  activeThresholdColor?: string | null,
  exactMatchOrMode: boolean | ThresholdComparisonMode = false,
  disconnectThreshold: DisconnectThresholdMode = 'auto'
): BadgeInfo {
  if (!thresholds?.steps?.some((s) => s.value !== null)) {
    return { state: 'normal', color: '', episodes: [] };
  }

  const mode: ThresholdComparisonMode =
    typeof exactMatchOrMode === 'string'
      ? exactMatchOrMode
      : exactMatchOrMode
      ? 'eq'
      : 'gte';

  const episodes = getAlertEpisodes(allValues, timeValues, thresholds, tStart, tEnd, mode, disconnectThreshold);
  const { monitoredDurationMs, healthyDurationMs } = getMonitoredAndHealthyDurationMs(
    allValues,
    timeValues,
    thresholds,
    tStart,
    tEnd,
    mode,
    disconnectThreshold
  );
  const activeEpisodes = episodes.filter((ep) => ep.isActiveNow);

  // Identifica se a janela atual monitorada está no tempo real (presente)
  const isRealtimeWindow = Math.abs(Date.now() - tEnd) < 120000;
  let isFilteredHistorical = false;
  try {
    const rawFilter = typeof window !== 'undefined' ? window.sessionStorage?.getItem(ALERT_TIME_FILTER_STORAGE_KEY) : null;
    if (rawFilter) {
      const parsed = JSON.parse(rawFilter);
      if (parsed && parsed.wasActiveWhenFiltered === false) {
        isFilteredHistorical = true;
      }
    }
  } catch {
    // ignore
  }
  const canBeActiveNow = isRealtimeWindow && !isFilteredHistorical;

  // Estado A — isCurrentlyActive: O valor atual (lastVal) viola o threshold agora
  if (canBeActiveNow && lastVal !== null) {
    const res = resolveColumnThreshold(lastVal, thresholds, mode, _theme);
    if (res.isViolation) {
      return { state: 'active', color: res.color, episodes, monitoredDurationMs, healthyDurationMs };
    }
  }

  // Se algum episódio foi marcado como ativo agora, herda a cor do step ativo mais severo
  if (canBeActiveNow && activeEpisodes.length > 0) {
    const highestActive = activeEpisodes[0]; // episodes já vêm ordenados com o ativo de maior severidade no topo
    const stepColor = thresholds?.steps?.find(
      (s) => s.value !== null && Math.abs(Number(s.value) - highestActive.stepValue) < 1e-6
    )?.color;
    const color = resolveAlertHexColor(stepColor || highestActive.color || activeThresholdColor);
    return { state: 'active', color, episodes, monitoredDurationMs, healthyDurationMs };
  }

  // Estado B — wasActiveInWindow: O valor atual normalizou, mas houve episódios passados na janela
  if (episodes.length > 0) {
    // Cor exclusiva de histórico: âmbar suave
    return { state: 'historical', color: '#EAB839', episodes, monitoredDurationMs, healthyDurationMs };
  }

  return { state: 'normal', color: '', episodes: [], monitoredDurationMs, healthyDurationMs };
}

/**
 * Classifica o perfil da métrica para determinar o tratamento estatístico adequado no Pop-up de Alertas.
 * Evita que métricas binárias ou de estado (Value Mapping como Up/Down) exibam médias matemáticas sem sentido.
 *
 * @param series - Field, array de números ou objeto com values da série
 * @param thresholdComparisonMode - Modo de comparação de threshold ('gte' | 'lte' | 'eq')
 * @param displayProcessor - Processador de display do Grafana (field.display) ou função de formatação
 * @returns MetricProfile: 'state_or_binary' | 'continuous_lte' | 'continuous_gte'
 */
export function getMetricProfile(
  series: Field | number[] | any[] | { values: any } | null | undefined,
  thresholdComparisonMode?: ThresholdComparisonMode | string,
  displayProcessor?: ((val: any) => { text: string; [key: string]: any }) | ((val: any) => string) | null
): MetricProfile {
  // Regra (b): Se thresholdComparisonMode === 'eq', retorna 'state_or_binary'
  if (thresholdComparisonMode === 'eq') {
    return 'state_or_binary';
  }

  // Extração segura dos valores numéricos válidos da série
  const validNumbers: number[] = [];
  if (Array.isArray(series)) {
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) {
        validNumbers.push(Number(v));
      }
    }
  } else if (series && typeof series === 'object') {
    const raw = 'values' in series ? (series as any).values : [];
    const arr = Array.isArray(raw)
      ? raw
      : typeof raw?.toArray === 'function'
      ? raw.toArray()
      : Array.from(raw || []);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) {
        validNumbers.push(Number(v));
      }
    }
  }

  // Regra (a): Todos os valores válidos da série são 0 ou 1
  if (validNumbers.length > 0 && validNumbers.every((v) => v === 0 || v === 1)) {
    return 'state_or_binary';
  }

  // Regra (c): Ao passar o valor máximo/mínimo da série no displayProcessor(val).text,
  // o resultado for uma string puramente alfabética (ex: "Down", "Up") sem dígitos numéricos [0-9]
  if (validNumbers.length > 0 && displayProcessor) {
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < validNumbers.length; i++) {
      const n = validNumbers[i];
      if (n < minVal) minVal = n;
      if (n > maxVal) maxVal = n;
    }

    if (minVal !== Infinity && maxVal !== -Infinity) {
      const extractText = (val: number): string => {
        try {
          const res = (displayProcessor as any)(val);
          if (typeof res === 'string') {
            return res.trim();
          }
          return (res?.text ?? '').trim();
        } catch {
          return '';
        }
      };

      const minText = extractText(minVal);
      const maxText = extractText(maxVal);

      const isPureAlpha = (str: string): boolean => {
        if (!str) return false;
        const s = str.trim();
        if (s.length === 0) return false;
        // Não possui dígitos numéricos [0-9] e possui caracteres alfabéticos (com suporte a acentos/unicode)
        return !/\d/.test(s) && /[a-zA-Z\u00C0-\u017F]/.test(s);
      };

      if (isPureAlpha(minText) || isPureAlpha(maxText)) {
        return 'state_or_binary';
      }
    }
  }

  // Retorna 'continuous_lte' SE não for binária E (thresholdComparisonMode === 'lte')
  if (thresholdComparisonMode === 'lte') {
    return 'continuous_lte';
  }

  // Retorna 'continuous_gte' (Padrão) para qualquer outra métrica contínua
  return 'continuous_gte';
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

export interface ThirdSummaryCellData {
  label: string;
  value: string;
  color: string;
  subtext?: string;
  title?: string;
}

/**
 * Resolve estritamente a 3ª Coluna do Resumo Contextual (Pop-up/Drawer) conforme o perfil da métrica (profile).
 * 1. state_or_binary: DISPONIBILIDADE (% Up com cor verde se não estiver ativo ou alerta se Down).
 * 2. continuous_lte: MÍNIMO CRÍTICO (menor valor registrado com a cor do threshold).
 * 3. continuous_gte: PICO MÁXIMO (maior valor registrado com a cor do threshold).
 */
export function resolveThirdSummaryCell(
  profile: MetricProfile,
  resolvedEpisodes: AlertEpisode[],
  totalMs: number,
  tStart: number,
  tEnd: number,
  field: Field | undefined,
  comparisonMode: ThresholdComparisonMode | undefined,
  formatValue: (v: number) => string,
  badgeState: string,
  badgeColor?: string,
  fallbackColor = '#EAB839',
  monitoredDurationMs?: number,
  healthyDurationMs?: number
): ThirdSummaryCellData {
  const windowDurationMs = Math.max(1, tEnd - tStart);
  const activeEpisode = resolvedEpisodes.find((ep) => ep.isActiveNow);
  const isCurrentlyDown = Boolean(activeEpisode || badgeState === 'active');

  if (profile === 'state_or_binary') {
    const hasMonitoredData = monitoredDurationMs !== undefined && monitoredDurationMs > 0;
    const effectiveMonitoredMs = hasMonitoredData
      ? Math.max(monitoredDurationMs, totalMs)
      : windowDurationMs;
    const effectiveHealthyMs =
      healthyDurationMs !== undefined
        ? Math.min(healthyDurationMs, Math.max(0, effectiveMonitoredMs - totalMs))
        : Math.max(0, effectiveMonitoredMs - totalMs);

    const availPct =
      effectiveMonitoredMs > 0
        ? Math.max(0, Math.min(100, (effectiveHealthyMs / effectiveMonitoredMs) * 100))
        : 0;
    const availFormatted =
      availPct === 100
        ? '100%'
        : availPct <= 0
        ? '0%'
        : availPct >= 99.95
        ? '99.9%'
        : `${availPct.toFixed(1)}%`;

    let healthyLabel = 'Up';
    if (field?.display) {
      try {
        const text1 = field.display(1)?.text?.trim();
        if (text1 && !/\d/.test(text1) && /[a-zA-Z\u00C0-\u017F]/.test(text1)) {
          healthyLabel = text1;
        } else {
          const text0 = field.display(0)?.text?.trim();
          if (text0 && !/\d/.test(text0) && comparisonMode === 'eq') {
            healthyLabel = 'Up';
          }
        }
      } catch {
        healthyLabel = 'Up';
      }
    }

    const value = `${availFormatted} ${healthyLabel}`;
    const color =
      isCurrentlyDown || availPct === 0
        ? resolveAlertHexColor(activeEpisode?.color || resolvedEpisodes[0]?.color || badgeColor || '#F2495C')
        : '#10b981';

    const maxDowntimeMs = resolvedEpisodes.length > 0
      ? Math.max(...resolvedEpisodes.map((ep) => Math.max(0, ep.endTs - ep.startTs)))
      : 0;
    const noDataMs = Math.max(0, windowDurationMs - effectiveMonitoredMs);
    const subtext = maxDowntimeMs > 0 ? `Maior queda: ${humanDuration(maxDowntimeMs, 'ms')}` : undefined;
    const title =
      noDataMs >= windowDurationMs * 0.05 && subtext
        ? `${subtext} • Sem coleta: ${humanDuration(noDataMs, 'ms')}`
        : subtext;

    return {
      label: 'DISPONIBILIDADE',
      value,
      color,
      subtext,
      title,
    };
  }

  if (profile === 'continuous_lte') {
    const minEpisode = resolvedEpisodes.length > 0
      ? resolvedEpisodes.reduce((prev, curr) => (curr.minValue < prev.minValue ? curr : prev), resolvedEpisodes[0])
      : undefined;

    return {
      label: 'MÍNIMO CRÍTICO',
      value: minEpisode ? formatValue(minEpisode.minValue) : '—',
      color: minEpisode ? resolveAlertHexColor(minEpisode.color || fallbackColor) : fallbackColor,
    };
  }

  // continuous_gte (Padrão)
  const peakEpisode = resolvedEpisodes.length > 0
    ? resolvedEpisodes.reduce((prev, curr) => (curr.maxValue > prev.maxValue ? curr : prev), resolvedEpisodes[0])
    : undefined;

  return {
    label: 'PICO MÁXIMO',
    value: peakEpisode ? formatValue(peakEpisode.maxValue) : '—',
    color: peakEpisode ? resolveAlertHexColor(peakEpisode.color || fallbackColor) : fallbackColor,
  };
}

/**
 * Renderiza a mini-grade de 3 colunas na base de CADA CARD de ocorrência (Pop-up/Drawer)
 * adaptada estritamente conforme o perfil da métrica (profile):
 * 1. state_or_binary: ESTADO ATINGIDO | IMPACTO NA JANELA | APÓS O EVENTO (proibido Pico/Média/Mínimo)
 * 2. continuous_lte: MÍNIMO | MÉDIA | MÁXIMO
 * 3. continuous_gte: PICO | MÉDIA | MÍNIMO
 */
export function renderEpisodeCardBottomGrid(
  ep: AlertEpisode,
  profile: MetricProfile,
  tStart: number,
  tEnd: number,
  formatValue: (v: number) => string,
  statCell: (
    label: string,
    value: string,
    extra?: React.CSSProperties,
    valueStyle?: React.CSSProperties,
    subtext?: string,
    title?: string
  ) => React.ReactNode,
  field?: Field
): React.ReactNode {
  if (profile === 'state_or_binary') {
    const windowDurationMs = Math.max(1, tEnd - tStart);
    const impactPct = (ep.durationMs / windowDurationMs) * 100;
    const impactText = impactPct < 0.1 ? '< 0,1%' : `${impactPct.toFixed(1).replace('.', ',')}%`;

    let stateText = formatValue(ep.stepValue);
    if (field?.display) {
      try {
        const d = field.display(ep.stepValue);
        if (d && d.text) {
          stateText = d.text + (d.suffix || '');
        }
      } catch {
        // fallback to formatValue
      }
    }

    const afterText = ep.isActiveNow ? 'Permanece em alerta' : 'Retornou p/ normal';
    const afterColor = ep.isActiveNow ? resolveAlertHexColor(ep.color || '#F2495C') : '#10b981';

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 4,
          marginTop: 2,
          padding: '4px 6px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.22)',
          textAlign: 'center',
        }}
      >
        {statCell('Estado Atingido', stateText, { textAlign: 'center' }, { fontWeight: 700, color: ep.color, textAlign: 'center' })}
        {statCell(
          'Impacto na Janela',
          impactText,
          {
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            textAlign: 'center',
          },
          { fontWeight: 600, color: '#e2e8f0', textAlign: 'center' }
        )}
        {statCell(
          'Após o Evento',
          afterText,
          { textAlign: 'center' },
          { fontWeight: 600, fontSize: 9.5, color: afterColor, textAlign: 'center' },
          undefined,
          afterText
        )}
      </div>
    );
  }

  if (profile === 'continuous_lte') {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 4,
          marginTop: 2,
          padding: '4px 6px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.22)',
        }}
      >
        {statCell(
          'Mínimo',
          ep.minValue !== undefined && !isNaN(ep.minValue) ? formatValue(ep.minValue) : '—',
          {},
          { fontWeight: 700, color: ep.color }
        )}
        {statCell(
          'Média',
          ep.avgValue !== undefined && !isNaN(ep.avgValue) ? formatValue(ep.avgValue) : '—',
          { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }
        )}
        {statCell(
          'Máximo',
          ep.maxValue !== undefined && !isNaN(ep.maxValue) ? formatValue(ep.maxValue) : '—',
          {},
          { opacity: 0.85 }
        )}
      </div>
    );
  }

  // continuous_gte (Padrão)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 4,
        marginTop: 2,
        padding: '4px 6px',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.22)',
      }}
    >
      {statCell(
        'Pico',
        ep.maxValue !== undefined && !isNaN(ep.maxValue) ? formatValue(ep.maxValue) : '—',
        {},
        { fontWeight: 700, color: ep.color }
      )}
      {statCell(
        'Média',
        ep.avgValue !== undefined && !isNaN(ep.avgValue) ? formatValue(ep.avgValue) : '—',
        { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }
      )}
      {statCell(
        'Mínimo',
        ep.minValue !== undefined && !isNaN(ep.minValue) ? formatValue(ep.minValue) : '—',
        {},
        { opacity: 0.85 }
      )}
    </div>
  );
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

// Registro global em ordem de abertura para evitar sobreposição entre popups simultâneos
const openPopupRegistry: HTMLElement[] = [];

interface AlertWindowStats {
  totalMs: number;
  windowMs: number;
  monitoredMs?: number;
  profile?: MetricProfile;
  spansDays: boolean;
  exactMatch: boolean;
  comparisonMode?: ThresholdComparisonMode;
  formatValue: (v: number) => string;
}

/**
 * Gera uma narrativa contextual concisa para a janela de análise com base em 6 cenários lógicos.
 */
function getAlertContextSummary(episodes: AlertEpisode[], windowStats: AlertWindowStats): React.ReactNode {
  if (episodes.length === 0) {
    return 'Nenhuma violação registrada no período.';
  }

  const { totalMs, windowMs, monitoredMs, profile, spansDays, exactMatch, comparisonMode, formatValue } = windowStats;
  const effectiveWindowMs =
    monitoredMs !== undefined && monitoredMs > 0
      ? Math.max(monitoredMs, totalMs, 1)
      : Math.max(windowMs, totalMs, 1);
  const noDataMs = Math.max(0, windowMs - effectiveWindowMs);
  const hasSignificantNoData = noDataMs >= windowMs * 0.1;
  const alertRatio = Math.min(1, totalMs / effectiveWindowMs);
  const pct = Math.min(100, Math.round(alertRatio * 100));
  const op = comparisonMode === 'eq' || exactMatch ? '=' : comparisonMode === 'lte' ? '≤' : '≥';
  const hasActive = episodes.some((ep) => ep.isActiveNow);
  const peakEp = episodes.reduce((prev, curr) => (curr.maxValue > prev.maxValue ? curr : prev), episodes[0]);
  const minEp = episodes.reduce((prev, curr) => (curr.minValue < prev.minValue ? curr : prev), episodes[0]);

  // Agrupa durações por nível de threshold para detectar escalada entre múltiplos níveis
  const stepTotals = new Map<number, { stepValue: number; durationMs: number; color: string; count: number }>();
  for (const ep of episodes) {
    const prev = stepTotals.get(ep.stepValue);
    if (prev) {
      prev.durationMs += ep.durationMs;
      prev.count += 1;
    } else {
      stepTotals.set(ep.stepValue, {
        stepValue: ep.stepValue,
        durationMs: ep.durationMs,
        color: ep.color,
        count: 1,
      });
    }
  }
  const sortedLevels = [...stepTotals.values()].sort((a, b) => a.stepValue - b.stepValue);

  // Cenário 1: >= 95% do tempo (coletado) em alerta
  if (alertRatio >= 0.95) {
    if (sortedLevels.length >= 2) {
      const lowest = sortedLevels[0];
      const highest = sortedLevels[sortedLevels.length - 1];
      return (
        <>
          Permaneceu fora do padrão durante <strong>{pct}%</strong> do período {hasSignificantNoData ? 'com coleta' : ''} ({op}{' '}
          <strong style={{ color: lowest.color }}>{formatValue(lowest.stepValue)}</strong>), agravando para {op}{' '}
          <strong style={{ color: highest.color }}>{formatValue(highest.stepValue)}</strong> por{' '}
          <strong>{humanDuration(highest.durationMs, 'ms')}</strong>.
        </>
      );
    }
    if (profile === 'state_or_binary') {
      return (
        <>
          Permaneceu em <strong style={{ color: peakEp.color }}>{formatValue(peakEp.stepValue)}</strong> durante{' '}
          <strong>{pct}%</strong> do período {hasSignificantNoData ? 'com coleta' : 'analisado'} (
          <strong>{humanDuration(totalMs, 'ms')}</strong>)
          {hasSignificantNoData ? (
            <> — com <strong>{humanDuration(noDataMs, 'ms')}</strong> sem coleta na janela.</>
          ) : (
            '.'
          )}
        </>
      );
    }
    if (profile === 'continuous_lte') {
      return (
        <>
          Permaneceu fora do padrão durante <strong>{pct}%</strong> do período {hasSignificantNoData ? 'com coleta' : 'analisado'} (
          <strong>{humanDuration(totalMs, 'ms')}</strong>), com mínimo de{' '}
          <strong style={{ color: minEp.color }}>{formatValue(minEp.minValue)}</strong>.
        </>
      );
    }
    return (
      <>
        Permaneceu fora do padrão durante <strong>{pct}%</strong> do período {hasSignificantNoData ? 'com coleta' : 'analisado'} (
        <strong>{humanDuration(totalMs, 'ms')}</strong>), com pico de{' '}
        <strong style={{ color: peakEp.color }}>{formatValue(peakEp.maxValue)}</strong>.
      </>
    );
  }

  // Cenário 2: Escalada entre múltiplos thresholds
  if (sortedLevels.length >= 2) {
    const lowest = sortedLevels[0];
    const highest = sortedLevels[sortedLevels.length - 1];
    return (
      <>
        Passou <strong>{humanDuration(lowest.durationMs, 'ms')}</strong> {exactMatch ? 'em' : 'acima de'}{' '}
        <strong style={{ color: lowest.color }}>{formatValue(lowest.stepValue)}</strong>, agravando para{' '}
        <strong style={{ color: highest.color }}>{formatValue(highest.stepValue)}</strong> por{' '}
        <strong>{humanDuration(highest.durationMs, 'ms')}</strong>
        {hasActive ? ' (ainda em aberto).' : '.'}
      </>
    );
  }

  // Cenário 3: Intermitente/Oscilação (5+ casos na janela)
  if (episodes.length >= 5) {
    return (
      <>
        Comportamento intermitente com <strong>{episodes.length} casos</strong> na janela (acumulando{' '}
        <strong>{humanDuration(totalMs, 'ms')}</strong> em alerta)
        {hasActive ? ', permanecendo em aberto agora.' : ', mas operando normalmente agora.'}
      </>
    );
  }

  // Cenário 4: 1 caso apenas e isActiveNow === true
  if (episodes.length === 1 && episodes[0].isActiveNow) {
    const ep = episodes[0];
    return (
      <>
        Estável na maior parte do período; entrou em alerta às{' '}
        <strong>{formatTimeDisplay(ep.startTs, spansDays)}</strong> (há{' '}
        <strong>{humanDuration(ep.durationMs, 'ms')}</strong>).
      </>
    );
  }

  // Cenário 5: 1 caso apenas e isActiveNow === false
  if (episodes.length === 1 && !episodes[0].isActiveNow) {
    const ep = episodes[0];
    return (
      <>
        Operando normalmente agora. Registrou apenas <strong>1 desvio</strong> às{' '}
        <strong>{formatTimeDisplay(ep.startTs, spansDays)}</strong> ({humanDuration(ep.durationMs, 'ms')}).
      </>
    );
  }

  // Cenário 6: Poucas ocorrências (2 a 4 casos)
  return (
    <>
      {hasActive ? (
        <>
          Registrou <strong>{episodes.length} ocorrências</strong> pontuais na janela (
          <strong>{humanDuration(totalMs, 'ms')}</strong> acumulados), com alerta em aberto no momento.
        </>
      ) : (
        <>
          Operando normalmente agora após <strong>{episodes.length} ocorrências</strong> pontuais na janela (
          <strong>{humanDuration(totalMs, 'ms')}</strong> acumulados).
        </>
      )}
    </>
  );
}

export interface AlertInspectPayload {
  badge: BadgeInfo;
  tStart: number;
  tEnd: number;
  field: Field;
  theme: GrafanaTheme2;
  exactMatch?: boolean;
  comparisonMode?: ThresholdComparisonMode;
  fieldConfig?: FieldConfigSource;
  metricLabel: string;
  currentValueText: string;
  currentValueColor?: string;
  onChangeTimeRange?: (range: { from: number; to: number }) => void;
}

export interface TimeRangeBackup {
  from: string | number;
  to: string | number;
  startTs: number;
  endTs: number;
  stepValue: number;
  wasActiveWhenFiltered?: boolean;
}

export const ALERT_TIME_FILTER_STORAGE_KEY = 'vale_alert_time_filter_backup';

/**
 * Aba Lateral Esquerda (Left Side Drawer) renderizada via createPortal em document.body.
 * Escuta globalmente o evento 'vale-stat-alert-inspect' para troca rápida entre métricas
 * sem abrir novos pop-ups flutuantes.
 */
const AlertLeftDrawer: React.FC<{
  initialPayload: AlertInspectPayload;
  onCollapse: () => void;
  onClose: () => void;
}> = ({ initialPayload, onCollapse, onClose }) => {
  const [payload, setPayload] = useState<AlertInspectPayload>(initialPayload);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | number>('all');
  const [entered, setEntered] = useState(false);

  // Sincroniza caso a própria métrica de origem sofra atualização de dados em tempo real
  useEffect(() => {
    setPayload((prev) => {
      if (prev.field?.name === initialPayload.field?.name && prev.metricLabel === initialPayload.metricLabel) {
        return initialPayload;
      }
      return prev;
    });
  }, [initialPayload]);

  // Transição suave de entrada (translateX)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Barramento de Eventos Global: intercepta cliques em outros badges '!' enquanto o Drawer estiver aberto
  useEffect(() => {
    const handleInspect = (evt: Event) => {
      const customEvt = evt as CustomEvent<AlertInspectPayload>;
      if (customEvt.detail) {
        evt.preventDefault(); // Sinaliza ao emissor que a Aba Lateral interceptou o evento
        setPayload(customEvt.detail);
        setActiveFilter('all');
      }
    };
    window.addEventListener('vale-stat-alert-inspect', handleInspect);
    return () => {
      window.removeEventListener('vale-stat-alert-inspect', handleInspect);
    };
  }, []);

  // Fechar com Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const { badge, tStart, tEnd, field, theme, exactMatch = false, comparisonMode, fieldConfig, metricLabel, currentValueText, currentValueColor, onChangeTimeRange } = payload;

  const [activeTimeFilter, setActiveTimeFilter] = useState<TimeRangeBackup | null>(() => {
    try {
      const raw = sessionStorage.getItem(ALERT_TIME_FILTER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleRestoreTimeRange = useCallback(() => {
    let backup = activeTimeFilter;
    if (!backup) {
      try {
        const raw = sessionStorage.getItem(ALERT_TIME_FILTER_STORAGE_KEY);
        if (raw) {
          backup = JSON.parse(raw);
        }
      } catch {
        // ignore
      }
    }

    if (backup) {
      const { from, to } = backup;
      if (onChangeTimeRange) {
        try {
          const numFrom = typeof from === 'number' ? from : Number(from) || tStart;
          const numTo = typeof to === 'number' ? to : Number(to) || tEnd;
          onChangeTimeRange({ from: numFrom, to: numTo });
        } catch (err) {
          console.warn('Falha em onChangeTimeRange ao restaurar:', err);
        }
      }
      try {
        locationService.partial({ from, to });
      } catch (err) {
        console.warn('Falha em locationService.partial ao restaurar:', err);
      }
    }

    try {
      sessionStorage.removeItem(ALERT_TIME_FILTER_STORAGE_KEY);
    } catch {
      // ignore
    }
    setActiveTimeFilter(null);
  }, [activeTimeFilter, onChangeTimeRange, tStart, tEnd]);

  const handleEpisodeClick = useCallback(
    (ep: AlertEpisode) => {
      if (
        activeTimeFilter &&
        Math.abs(activeTimeFilter.stepValue - ep.stepValue) < 1e-6 &&
        (
          Math.abs(activeTimeFilter.startTs - ep.startTs) <= 30000 ||
          (ep.startTs <= activeTimeFilter.endTs + 15000 && ep.endTs >= activeTimeFilter.startTs - 15000)
        )
      ) {
        handleRestoreTimeRange();
        return;
      }

      let searchFrom: string | number | undefined;
      let searchTo: string | number | undefined;
      try {
        const search = locationService.getSearchObject();
        if (search?.from !== null && search?.from !== undefined) {
          searchFrom = search.from as string | number;
        }
        if (search?.to !== null && search?.to !== undefined) {
          searchTo = search.to as string | number;
        }
      } catch {
        // fallback
      }

      const backup: TimeRangeBackup = activeTimeFilter
        ? {
            ...activeTimeFilter,
            startTs: ep.startTs,
            endTs: ep.endTs,
            stepValue: ep.stepValue,
            wasActiveWhenFiltered: Boolean(ep.isActiveNow),
          }
        : {
            from: searchFrom ?? tStart,
            to: searchTo ?? tEnd,
            startTs: ep.startTs,
            endTs: ep.endTs,
            stepValue: ep.stepValue,
            wasActiveWhenFiltered: Boolean(ep.isActiveNow),
          };

      try {
        sessionStorage.setItem(ALERT_TIME_FILTER_STORAGE_KEY, JSON.stringify(backup));
      } catch {
        // ignore
      }
      setActiveTimeFilter(backup);

      const duration = Math.max(ep.endTs - ep.startTs, 60000);
      const padding = Math.max(Math.round(duration * 0.05), 30000);
      const from = Math.max(0, ep.startTs - padding);
      const to = ep.isActiveNow ? Date.now() : ep.endTs + padding;

      if (onChangeTimeRange) {
        try {
          onChangeTimeRange({ from, to });
        } catch (err) {
          console.warn('Falha em onChangeTimeRange:', err);
        }
      }
      try {
        locationService.partial({ from, to });
      } catch (err) {
        console.warn('Falha em locationService.partial:', err);
      }
    },
    [activeTimeFilter, handleRestoreTimeRange, onChangeTimeRange, tStart, tEnd]
  );

  // Classificação estrita do perfil da métrica (ISA-101 / Pop-up de Alertas)
  const profile: MetricProfile = useMemo(
    () => getMetricProfile(field, comparisonMode, field?.display),
    [field, comparisonMode]
  );

  const formatValue = useCallback((v: number) => formatFieldValue(v, field, theme).text, [field, theme]);
  const liveThresholds = getFieldThresholds(field, theme, fieldConfig);

  const resolvedEpisodes = useMemo(() => {
    const isRealtime = Math.abs(Date.now() - tEnd) < 120000;
    const isFilteredHistorical = Boolean(activeTimeFilter && !activeTimeFilter.wasActiveWhenFiltered);
    const forceHistorical = !isRealtime || isFilteredHistorical;

    const raw = badge.episodes.map((ep) => {
      const numStepVal = Number(ep.stepValue);
      const matchingStep = liveThresholds?.steps.find(
        (s) => s.value !== null && s.value !== undefined && Math.abs(Number(s.value) - numStepVal) < 1e-6
      );
      const color = resolveAlertHexColor(matchingStep?.color || ep.color || badge.color);
      const isActiveNow = forceHistorical ? false : Boolean(ep.isActiveNow);
      return { ...ep, color, isActiveNow };
    });
    return deduplicateEpisodesByCriticality(raw, comparisonMode, liveThresholds);
  }, [badge.episodes, badge.color, liveThresholds, comparisonMode, tEnd, activeTimeFilter]);

  const totalMs = useMemo(() => {
    if (resolvedEpisodes.length === 0) { return 0; }
    const intervals = resolvedEpisodes
      .map((ep) => ({ start: ep.startTs, end: ep.endTs }))
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      const curr = intervals[i];
      if (curr.start <= last.end) {
        last.end = Math.max(last.end, curr.end);
      } else {
        merged.push({ ...curr });
      }
    }
    return merged.reduce((acc, iv) => acc + Math.max(0, iv.end - iv.start), 0);
  }, [resolvedEpisodes]);

  const spansDays = new Date(tStart).toDateString() !== new Date(tEnd).toDateString();
  const activeEpisode = resolvedEpisodes.find((ep) => ep.isActiveNow);
  const headerColor = badge.state === 'active'
    ? resolveAlertHexColor(activeEpisode?.color || badge.color)
    : '#EAB839';

  const narrativeSummary = useMemo(
    () =>
      getAlertContextSummary(resolvedEpisodes, {
        totalMs,
        windowMs: Math.max(0, tEnd - tStart),
        monitoredMs: badge.monitoredDurationMs,
        profile,
        spansDays,
        exactMatch,
        comparisonMode,
        formatValue,
      }),
    [resolvedEpisodes, totalMs, tStart, tEnd, badge.monitoredDurationMs, profile, spansDays, exactMatch, comparisonMode, formatValue]
  );

  // Níveis únicos de threshold para as pílulas de filtro rápido
  const uniqueThresholdSteps = useMemo(() => {
    const map = new Map<number, string>();
    resolvedEpisodes.forEach((ep) => {
      if (!map.has(ep.stepValue)) {
        map.set(ep.stepValue, ep.color);
      }
    });
    return [...map.entries()]
      .map(([stepValue, color]) => ({ stepValue, color }))
      .sort((a, b) => a.stepValue - b.stepValue);
  }, [resolvedEpisodes]);

  const activeCount = useMemo(() => resolvedEpisodes.filter((ep) => ep.isActiveNow).length, [resolvedEpisodes]);

  const filteredEpisodes = useMemo(() => {
    if (activeFilter === 'all') {
      return resolvedEpisodes;
    }
    if (activeFilter === 'active') {
      return resolvedEpisodes.filter((ep) => ep.isActiveNow);
    }
    return resolvedEpisodes.filter((ep) => Math.abs(ep.stepValue - activeFilter) < 1e-6);
  }, [resolvedEpisodes, activeFilter]);

  const statCell = (
    label: string,
    value: string,
    extra: React.CSSProperties = {},
    valueStyle: React.CSSProperties = {},
    subtext?: string,
    title?: string
  ) => (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0, gap: 1, ...extra }}
      title={title}
    >
      <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', width: '100%', lineHeight: 1.2 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 11, textAlign: 'center', width: '100%', ...valueStyle }}>{value}</span>
      {subtext && (
        <span style={{ fontSize: 8.5, opacity: 0.55, whiteSpace: 'nowrap', lineHeight: 1, textAlign: 'center', width: '100%' }}>{subtext}</span>
      )}
    </div>
  );

  const thirdStat = resolveThirdSummaryCell(
    profile,
    resolvedEpisodes,
    totalMs,
    tStart,
    tEnd,
    field,
    comparisonMode,
    formatValue,
    badge.state,
    badge.color,
    headerColor,
    badge.monitoredDurationMs,
    badge.healthyDurationMs
  );

  const iconBtnStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.09)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    cursor: 'pointer',
    opacity: 0.7,
    padding: 0,
    transition: 'opacity 0.15s ease, background-color 0.15s ease',
    flexShrink: 0,
  };

  const renderPill = (
    key: string,
    label: string,
    isSelected: boolean,
    onClick: () => void,
    accentColor = '#38bdf8'
  ) => (
    <button
      key={key}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: isSelected ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s ease',
        color: isSelected ? accentColor : 'rgba(226,232,240,0.72)',
        background: isSelected ? parseColorToRgba(accentColor, 0.16) : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isSelected ? parseColorToRgba(accentColor, 0.45) : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      data-alert-left-drawer="true"
      data-alert-popup="true"
      data-metric-profile={profile}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 380,
        maxWidth: '90vw',
        zIndex: 99999,
        background: 'rgba(11, 16, 22, 0.98)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRight: `1px solid color-mix(in srgb, ${headerColor} 32%, rgba(255,255,255,0.1))`,
        boxShadow: '12px 0 36px rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        color: '#e2e8f0',
        fontSize: 12,
        lineHeight: 1.5,
        pointerEvents: 'all',
        transform: entered ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* 1. Header da Aba Lateral */}
      <div
        style={{
          flexShrink: 0,
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.018)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {badge.state === 'active' ? (
              <Icon name="exclamation-triangle" size="sm" style={{ color: headerColor, flexShrink: 0 }} />
            ) : (
              <HistoryAlertIcon size={16} color={headerColor} />
            )}
            <span
              style={{
                fontWeight: 700,
                fontSize: 13.5,
                color: '#f8fafc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={metricLabel}
            >
              {metricLabel}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span
              style={{
                fontWeight: 800,
                fontSize: 14,
                color: currentValueColor || headerColor,
                padding: '1px 7px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {currentValueText}
            </span>
            <button
              type="button"
              title="Recolher para pop-up flutuante"
              style={iconBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.7';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
            >
              <Icon name="arrow-left" size="sm" />
            </button>
            <button
              type="button"
              title="Fechar (Esc)"
              style={{ ...iconBtnStyle, fontSize: 16, fontWeight: 600, lineHeight: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.7';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, opacity: 0.65 }}>
          <span>
            Janela: {formatShortTime(tStart, spansDays)} – {formatShortTime(tEnd, spansDays)}
          </span>
          <span style={{ color: headerColor, fontWeight: 600 }}>
            {badge.state === 'active' ? '● Alerta em aberto' : 'Normalizado'}
          </span>
        </div>
      </div>

      {/* 2. Bloco de Resumo (Visão Geral do Período) */}
      <div style={{ flexShrink: 0, padding: '12px 16px 0' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'rgba(226, 232, 240, 0.94)' }}>
            {narrativeSummary}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.35fr 1fr',
              gap: 4,
              padding: '6px 8px',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.28)',
            }}
          >
            {statCell('Total de Casos', `${resolvedEpisodes.length}`, {}, { fontWeight: 700, color: '#e2e8f0' })}
            {statCell(
              'Tempo em Alerta',
              humanDuration(totalMs, 'ms'),
              { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' },
              { fontWeight: 700, color: headerColor }
            )}
            {statCell(
              thirdStat.label,
              thirdStat.value,
              {},
              { fontWeight: 700, color: thirdStat.color },
              thirdStat.subtext,
              thirdStat.title
            )}
          </div>
        </div>
      </div>

      {/* 3. Barra de Filtros Rápidos (Pílulas clicáveis) */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {renderPill(
          'all',
          `Todos (${resolvedEpisodes.length})`,
          activeFilter === 'all',
          () => setActiveFilter('all'),
          '#38bdf8'
        )}
        {renderPill(
          'active',
          `Em aberto (${activeCount})`,
          activeFilter === 'active',
          () => setActiveFilter('active'),
          activeEpisode?.color || '#E24D42'
        )}
        {uniqueThresholdSteps.map((st) =>
          renderPill(
            `step-${st.stepValue}`,
            `${exactMatch ? '=' : '>='} ${formatValue(st.stepValue)}`,
            activeFilter === st.stepValue,
            () => setActiveFilter(st.stepValue),
            st.color
          )
        )}
      </div>

      {/* 4. Lista de Casos ocupando o resto do 100vh */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {filteredEpisodes.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              opacity: 0.55,
              fontSize: 11.5,
              borderRadius: 6,
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.08)',
            }}
          >
            Nenhum caso corresponde ao filtro selecionado.
          </div>
        ) : (
          filteredEpisodes.map((ep, idx) => {
            const isThisEpFiltered = Boolean(
              activeTimeFilter &&
              Math.abs(activeTimeFilter.stepValue - ep.stepValue) < 1e-6 &&
              (
                Math.abs(activeTimeFilter.startTs - ep.startTs) <= 30000 ||
                (ep.startTs <= activeTimeFilter.endTs + 15000 && ep.endTs >= activeTimeFilter.startTs - 15000)
              )
            );

            return (
              <div
                key={`${ep.stepValue}-${ep.startTs}-${idx}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isThisEpFiltered) {
                    handleRestoreTimeRange();
                  } else {
                    handleEpisodeClick(ep);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    if (isThisEpFiltered) {
                      handleRestoreTimeRange();
                    } else {
                      handleEpisodeClick(ep);
                    }
                  }
                }}
                title={
                  isThisEpFiltered
                    ? 'Período filtrado no dashboard — clique para voltar ao tempo anterior'
                    : `Clique para filtrar o dashboard neste período (${formatTimeDisplay(ep.startTs, spansDays)} – ${ep.isActiveNow ? 'Agora' : formatTimeDisplay(ep.endTs, spansDays)})`
                }
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '9px 11px',
                  borderRadius: 6,
                  background: isThisEpFiltered
                    ? parseColorToRgba(ep.color, 0.16)
                    : ep.isActiveNow
                    ? parseColorToRgba(ep.color, 0.08)
                    : 'rgba(255,255,255,0.025)',
                  border: isThisEpFiltered
                    ? `1px solid ${parseColorToRgba(ep.color, 0.75)}`
                    : `1px solid ${ep.isActiveNow ? parseColorToRgba(ep.color, 0.32) : 'rgba(255,255,255,0.06)'}`,
                  borderLeft: `3px solid ${ep.color}`,
                  boxShadow: isThisEpFiltered
                    ? `0 0 10px ${parseColorToRgba(ep.color, 0.35)}, inset 0 0 0 1px ${parseColorToRgba(ep.color, 0.25)}`
                    : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                  transform: isThisEpFiltered ? 'translateY(-1px)' : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isThisEpFiltered
                    ? parseColorToRgba(ep.color, 0.22)
                    : ep.isActiveNow
                    ? parseColorToRgba(ep.color, 0.14)
                    : 'rgba(255,255,255,0.06)';
                  const outline = isThisEpFiltered
                    ? parseColorToRgba(ep.color, 0.9)
                    : ep.isActiveNow
                    ? parseColorToRgba(ep.color, 0.55)
                    : 'rgba(255,255,255,0.25)';
                  e.currentTarget.style.borderTopColor = outline;
                  e.currentTarget.style.borderRightColor = outline;
                  e.currentTarget.style.borderBottomColor = outline;
                  e.currentTarget.style.borderLeftColor = ep.color;
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isThisEpFiltered
                    ? parseColorToRgba(ep.color, 0.16)
                    : ep.isActiveNow
                    ? parseColorToRgba(ep.color, 0.08)
                    : 'rgba(255,255,255,0.025)';
                  const outline = isThisEpFiltered
                    ? parseColorToRgba(ep.color, 0.75)
                    : ep.isActiveNow
                    ? parseColorToRgba(ep.color, 0.32)
                    : 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderTopColor = outline;
                  e.currentTarget.style.borderRightColor = outline;
                  e.currentTarget.style.borderBottomColor = outline;
                  e.currentTarget.style.borderLeftColor = ep.color;
                  e.currentTarget.style.transform = isThisEpFiltered ? 'translateY(-1px)' : 'none';
                }}
              >
                {/* Cabeçalho do Card */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: ep.color }}>
                    Threshold {exactMatch ? '=' : '≥'} {formatValue(ep.stepValue)}
                  </span>
                  {ep.isActiveNow ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: ep.color,
                      backgroundColor: parseColorToRgba(ep.color, 0.16),
                      border: `1px solid ${parseColorToRgba(ep.color, 0.38)}`,
                      padding: '1px 5px',
                      borderRadius: 3,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ● EM ABERTO
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.6)',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      padding: '1px 5px',
                      borderRadius: 3,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    NORMALIZADO
                  </span>
                )}
              </div>

              {/* Tempos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ opacity: 0.7 }}>Início:</span>
                  <span style={{ fontWeight: 600 }}>{formatTimeDisplay(ep.startTs, spansDays)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ opacity: 0.7 }}>Normalização:</span>
                  {ep.isActiveNow ? (
                    <span style={{ color: ep.color, fontWeight: 700 }}>Ainda em aberto</span>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{formatTimeDisplay(ep.endTs, spansDays)}</span>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ opacity: 0.7 }}>Duração:</span>
                  <span style={{ fontWeight: 600 }}>{humanDuration(ep.durationMs, 'ms')}</span>
                </div>
              </div>

              {/* Base do Card: 3 colunas compactas adaptadas ao perfil da métrica */}
              {renderEpisodeCardBottomGrid(ep, profile, tStart, tEnd, formatValue, statCell, field)}
            </div>
          );
        })
      )}
      </div>
    </div>,
    document.body
  );
};

/**
 * Portal do popup: renderiza diretamente em document.body via createPortal,
 * escapando do overflow:hidden do painel Grafana. A posição é calculada
 * com getBoundingClientRect() do botão de trigger e ajustada para nunca
 * sobrepor outros popups já abertos.
 */
const AlertPopupPortal: React.FC<{
  badge: BadgeInfo;
  tStart: number;
  tEnd: number;
  triggerRect: DOMRect;
  isPinned: boolean;
  onClose: () => void;
  onExpand: () => void;
  formatValue: (v: number) => string;
  exactMatch?: boolean;
  comparisonMode?: ThresholdComparisonMode;
  field: Field;
  theme: GrafanaTheme2;
  fieldConfig?: FieldConfigSource;
  metricLabel?: string;
  currentValueText?: string;
  currentValueColor?: string;
  onChangeTimeRange?: (range: { from: number; to: number }) => void;
}> = ({
  badge,
  tStart,
  tEnd,
  triggerRect,
  onClose,
  onExpand,
  formatValue,
  exactMatch = false,
  comparisonMode,
  field,
  theme,
  fieldConfig,
  metricLabel,
  currentValueText,
  currentValueColor,
  onChangeTimeRange,
}) => {
  // Classificação estrita do perfil da métrica (ISA-101 / Pop-up de Alertas)
  const profile: MetricProfile = useMemo(
    () => getMetricProfile(field, comparisonMode, field?.display),
    [field, comparisonMode]
  );

  const [activeTimeFilter, setActiveTimeFilter] = useState<TimeRangeBackup | null>(() => {
    try {
      const raw = sessionStorage.getItem(ALERT_TIME_FILTER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleRestoreTimeRange = useCallback(() => {
    let backup = activeTimeFilter;
    if (!backup) {
      try {
        const raw = sessionStorage.getItem(ALERT_TIME_FILTER_STORAGE_KEY);
        if (raw) {
          backup = JSON.parse(raw);
        }
      } catch {
        // ignore
      }
    }

    if (backup) {
      const { from, to } = backup;
      if (onChangeTimeRange) {
        try {
          const numFrom = typeof from === 'number' ? from : Number(from) || tStart;
          const numTo = typeof to === 'number' ? to : Number(to) || tEnd;
          onChangeTimeRange({ from: numFrom, to: numTo });
        } catch (err) {
          console.warn('Falha em onChangeTimeRange ao restaurar:', err);
        }
      }
      try {
        locationService.partial({ from, to });
      } catch (err) {
        console.warn('Falha em locationService.partial ao restaurar:', err);
      }
    }

    try {
      sessionStorage.removeItem(ALERT_TIME_FILTER_STORAGE_KEY);
    } catch {
      // ignore
    }
    setActiveTimeFilter(null);
  }, [activeTimeFilter, onChangeTimeRange, tStart, tEnd]);

  const handleEpisodeClick = useCallback(
    (ep: AlertEpisode) => {
      if (
        activeTimeFilter &&
        Math.abs(activeTimeFilter.stepValue - ep.stepValue) < 1e-6 &&
        (
          Math.abs(activeTimeFilter.startTs - ep.startTs) <= 30000 ||
          (ep.startTs <= activeTimeFilter.endTs + 15000 && ep.endTs >= activeTimeFilter.startTs - 15000)
        )
      ) {
        handleRestoreTimeRange();
        return;
      }

      let searchFrom: string | number | undefined;
      let searchTo: string | number | undefined;
      try {
        const search = locationService.getSearchObject();
        if (search?.from !== null && search?.from !== undefined) {
          searchFrom = search.from as string | number;
        }
        if (search?.to !== null && search?.to !== undefined) {
          searchTo = search.to as string | number;
        }
      } catch {
        // fallback
      }

      const backup: TimeRangeBackup = activeTimeFilter
        ? {
            ...activeTimeFilter,
            startTs: ep.startTs,
            endTs: ep.endTs,
            stepValue: ep.stepValue,
            wasActiveWhenFiltered: Boolean(ep.isActiveNow),
          }
        : {
            from: searchFrom ?? tStart,
            to: searchTo ?? tEnd,
            startTs: ep.startTs,
            endTs: ep.endTs,
            stepValue: ep.stepValue,
            wasActiveWhenFiltered: Boolean(ep.isActiveNow),
          };

      try {
        sessionStorage.setItem(ALERT_TIME_FILTER_STORAGE_KEY, JSON.stringify(backup));
      } catch {
        // ignore
      }
      setActiveTimeFilter(backup);

      const duration = Math.max(ep.endTs - ep.startTs, 60000);
      const padding = Math.max(Math.round(duration * 0.05), 30000);
      const from = Math.max(0, ep.startTs - padding);
      const to = ep.isActiveNow ? Date.now() : ep.endTs + padding;

      if (onChangeTimeRange) {
        try {
          onChangeTimeRange({ from, to });
        } catch (err) {
          console.warn('Falha em onChangeTimeRange:', err);
        }
      }
      try {
        locationService.partial({ from, to });
      } catch (err) {
        console.warn('Falha em locationService.partial:', err);
      }
    },
    [activeTimeFilter, handleRestoreTimeRange, onChangeTimeRange, tStart, tEnd]
  );

  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; opacity: number; maxHeight: number }>({
    top: 0,
    left: 0,
    opacity: 0,
    maxHeight: 360,
  });

  // Calcula o tempo total em alerta unindo intervalos sobrepostos (evita somar duplicado quando >=40% e >=50% ocorrem juntos)
  const totalMs = useMemo(() => {
    if (badge.episodes.length === 0) { return 0; }
    const intervals = badge.episodes
      .map((ep) => ({ start: ep.startTs, end: ep.endTs }))
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      const curr = intervals[i];
      if (curr.start <= last.end) {
        last.end = Math.max(last.end, curr.end);
      } else {
        merged.push({ ...curr });
      }
    }
    return merged.reduce((acc, iv) => acc + Math.max(0, iv.end - iv.start), 0);
  }, [badge.episodes]);

  // Registro de montagem do popup para coordenação de não-sobreposição
  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!el) { return; }
    if (!openPopupRegistry.includes(el)) {
      openPopupRegistry.push(el);
    }
    return () => {
      const idx = openPopupRegistry.indexOf(el);
      if (idx !== -1) {
        openPopupRegistry.splice(idx, 1);
      }
    };
  }, []);

  // Calcular posição real na tela após montar, priorizando SEMPRE abrir para cima
  // para não tampar o gráfico abaixo do cabeçalho do card e nunca cobrir o botão trigger
  useLayoutEffect(() => {
    if (!popupRef.current) { return; }
    const popup = popupRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;
    const GAP = 8;

    // Espaço livre exatamente acima do botão trigger até o topo da viewport
    const availableAbove = triggerRect.top - GAP - MARGIN;
    // Se houver pelo menos 150px acima do botão, limita a altura máxima do popup para caber
    // 100% acima do botão (o corpo interno já possui scroll próprio). Caso o card esteja no
    // topo absoluto da tela, usa altura mais compacta para encaixar ao lado/topo sem cobrir o gráfico.
    const targetMaxH = availableAbove >= 150
      ? Math.min(360, Math.floor(availableAbove))
      : 250;

    // Aplica o maxHeight antes de medir offsetHeight para obter a altura real ajustada
    popup.style.maxHeight = `${targetMaxH}px`;
    const popupW = popup.offsetWidth;
    const popupH = popup.offsetHeight;

    const clampHoriz = (l: number) => Math.max(MARGIN, Math.min(l, Math.max(MARGIN, vw - popupW - MARGIN)));
    const clampVert = (t: number) => Math.max(MARGIN, Math.min(t, Math.max(MARGIN, vh - popupH - MARGIN)));

    // Preferência estrita: ACIMA do botão
    const prefAboveTop = triggerRect.top - popupH - GAP;
    const prefBelowTop = triggerRect.bottom + GAP;
    const prefRightLeft = triggerRect.right - popupW;

    // Coleta retângulos de popups abertos anteriormente
    const myIdx = openPopupRegistry.indexOf(popup);
    const priorPopups = (myIdx > 0 ? openPopupRegistry.slice(0, myIdx) : [])
      .filter((el) => el !== popup && document.body.contains(el) && el.offsetWidth > 0 && el.offsetHeight > 0)
      .map((el) => el.getBoundingClientRect());

    document.querySelectorAll('[data-alert-popup="true"]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl !== popup && !openPopupRegistry.includes(htmlEl) && htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0) {
        priorPopups.push(htmlEl.getBoundingClientRect());
      }
    });

    const getOverlapArea = (t: number, l: number, rects: DOMRect[], pad = 0): number => {
      let area = 0;
      for (const r of rects) {
        const xOverlap = Math.max(0, Math.min(l + popupW + pad, r.right + pad) - Math.max(l, r.left));
        const yOverlap = Math.max(0, Math.min(t + popupH + pad, r.bottom + pad) - Math.max(t, r.top));
        area += xOverlap * yOverlap;
      }
      return area;
    };

    // Gera candidatos priorizando posições ACIMA ou ancoradas no topo ao lado do botão
    const rawCandidates: Array<{ top: number; left: number }> = [];

    // 1. Acima do botão (prioridade máxima — nunca cobre o gráfico abaixo do header)
    if (prefAboveTop >= MARGIN) {
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(prefRightLeft) });
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(triggerRect.left) });
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(triggerRect.left + triggerRect.width / 2 - popupW / 2) });
    }

    // 2. À esquerda ou direita do botão, ancorado o mais para cima possível (top = MARGIN ou subindo a partir da base do botão)
    const sideTopUpward = clampVert(Math.min(MARGIN, triggerRect.bottom - popupH));
    const sideTopAlignedBottom = clampVert(triggerRect.bottom - popupH);
    if (triggerRect.left - popupW - GAP >= MARGIN) {
      rawCandidates.push({ top: sideTopAlignedBottom, left: triggerRect.left - popupW - GAP });
      rawCandidates.push({ top: sideTopUpward, left: triggerRect.left - popupW - GAP });
      rawCandidates.push({ top: clampVert(triggerRect.top + 11 - popupH / 2), left: triggerRect.left - popupW - GAP });
    }
    if (triggerRect.right + GAP + popupW <= vw - MARGIN) {
      rawCandidates.push({ top: sideTopAlignedBottom, left: triggerRect.right + GAP });
      rawCandidates.push({ top: sideTopUpward, left: triggerRect.right + GAP });
      rawCandidates.push({ top: clampVert(triggerRect.top + 11 - popupH / 2), left: triggerRect.right + GAP });
    }

    // 3. Abaixo do botão (apenas último recurso caso nenhuma posição superior/lateral esteja livre)
    if (prefBelowTop + popupH <= vh - MARGIN) {
      rawCandidates.push({ top: prefBelowTop, left: clampHoriz(prefRightLeft) });
      rawCandidates.push({ top: prefBelowTop, left: clampHoriz(triggerRect.left) });
    }

    // 4. Fallbacks padrão clampados
    rawCandidates.push(
      { top: clampVert(prefAboveTop), left: clampHoriz(prefRightLeft) },
      { top: clampVert(sideTopAlignedBottom), left: clampHoriz(triggerRect.left - popupW - GAP) },
      { top: clampVert(sideTopAlignedBottom), left: clampHoriz(triggerRect.right + GAP) },
      { top: clampVert(prefBelowTop), left: clampHoriz(prefRightLeft) }
    );

    // Candidatos adjacentes a popups já abertos (priorizando acima/lados antes de abaixo)
    for (const r of priorPopups) {
      rawCandidates.push(
        { top: clampVert(r.top - popupH - GAP), left: clampHoriz(r.left) },
        { top: clampVert(r.top), left: clampHoriz(r.left - popupW - GAP) },
        { top: clampVert(r.top), left: clampHoriz(r.right + GAP) },
        { top: clampVert(r.bottom + GAP), left: clampHoriz(r.left) }
      );
    }

    let best = rawCandidates[0];
    let bestScore = Infinity;
    const idealTop = Math.max(MARGIN, prefAboveTop);

    for (const cand of rawCandidates) {
      const c = { top: clampVert(cand.top), left: clampHoriz(cand.left) };
      // Penalidade extrema se cobrir qualquer pixel do botão trigger (com 6px de folga para respiro de clique)
      const triggerOverlap = getOverlapArea(c.top, c.left, [triggerRect], 6);
      const priorOverlap = getOverlapArea(c.top, c.left, priorPopups, GAP);
      const dist = Math.hypot(c.top - idealTop, c.left - prefRightLeft);

      // Penaliza fortemente candidatos que desçam abaixo do botão (invadindo a área do gráfico do card)
      const belowTriggerPx = Math.max(0, (c.top + popupH) - triggerRect.bottom);
      const chartCoverPenalty = (c.top >= triggerRect.bottom ? 50000 : 0) + belowTriggerPx * 40;

      // triggerOverlap recebe peso de 10 milhões para NUNCA ficar em cima do botão de exclamação
      const score =
        (triggerOverlap > 0 ? 10000000 + triggerOverlap * 1000 : 0) +
        priorOverlap * 10000 +
        chartCoverPenalty +
        dist;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    setPos({ top: best.top, left: best.left, opacity: 1, maxHeight: targetMaxH });
  }, [triggerRect, badge.episodes.length]);

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

  // Lista plana unificada mantendo a ordenação estrita de getAlertEpisodes e cores hexadecimais válidas
  const resolvedEpisodes = useMemo(() => {
    const isRealtime = Math.abs(Date.now() - tEnd) < 120000;
    const isFilteredHistorical = Boolean(activeTimeFilter && !activeTimeFilter.wasActiveWhenFiltered);
    const forceHistorical = !isRealtime || isFilteredHistorical;

    const raw = badge.episodes.map((ep) => {
      const numStepVal = Number(ep.stepValue);
      const matchingStep = liveThresholds?.steps.find(
        (s) => s.value !== null && s.value !== undefined && Math.abs(Number(s.value) - numStepVal) < 1e-6
      );
      const color = resolveAlertHexColor(matchingStep?.color || ep.color || badge.color);
      const isActiveNow = forceHistorical ? false : Boolean(ep.isActiveNow);
      return { ...ep, color, isActiveNow };
    });
    return deduplicateEpisodesByCriticality(raw, comparisonMode, liveThresholds);
  }, [badge.episodes, badge.color, liveThresholds, comparisonMode, tEnd, activeTimeFilter]);

  const spansDays = new Date(tStart).toDateString() !== new Date(tEnd).toDateString();

  const statCell = (
    label: string,
    value: string,
    extra: React.CSSProperties = {},
    valueStyle: React.CSSProperties = {},
    subtext?: string,
    title?: string
  ) => (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0, gap: 1, ...extra }}
      title={title}
    >
      <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', width: '100%', lineHeight: 1.2 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 11, textAlign: 'center', width: '100%', ...valueStyle }}>{value}</span>
      {subtext && (
        <span style={{ fontSize: 8.5, opacity: 0.55, whiteSpace: 'nowrap', lineHeight: 1, textAlign: 'center', width: '100%' }}>{subtext}</span>
      )}
    </div>
  );

  const activeEpisode = resolvedEpisodes.find((ep) => ep.isActiveNow);
  const headerColor = badge.state === 'active'
    ? resolveAlertHexColor(activeEpisode?.color || badge.color)
    : '#EAB839';
  const containerGlowColor = headerColor;

  const thirdStat = resolveThirdSummaryCell(
    profile,
    resolvedEpisodes,
    totalMs,
    tStart,
    tEnd,
    field,
    comparisonMode,
    formatValue,
    badge.state,
    badge.color,
    headerColor,
    badge.monitoredDurationMs,
    badge.healthyDurationMs
  );

  const narrativeSummary = useMemo(
    () =>
      getAlertContextSummary(resolvedEpisodes, {
        totalMs,
        windowMs: Math.max(0, tEnd - tStart),
        monitoredMs: badge.monitoredDurationMs,
        profile,
        spansDays,
        exactMatch,
        comparisonMode,
        formatValue,
      }),
    [resolvedEpisodes, totalMs, tStart, tEnd, badge.monitoredDurationMs, profile, spansDays, exactMatch, comparisonMode, formatValue]
  );

  const iconBtnStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    cursor: 'pointer',
    opacity: 0.65,
    padding: 0,
    transition: 'opacity 0.15s ease, background-color 0.15s ease',
    flexShrink: 0,
  };

  return createPortal(
    <div
      ref={popupRef}
      data-alert-popup="true"
      data-metric-profile={profile}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        opacity: pos.opacity,
        transition: 'opacity 0.15s ease',
        zIndex: 99999,
        minWidth: 280,
        maxWidth: 400,
        maxHeight: pos.maxHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'rgba(11, 16, 21, 0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '8px',
        border: `1px solid color-mix(in srgb, ${containerGlowColor} 30%, rgba(255,255,255,0.08))`,
        boxShadow: `0 12px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), 0 0 20px color-mix(in srgb, ${containerGlowColor} 12%, transparent)`,
        color: '#e2e8f0',
        fontSize: '12px',
        lineHeight: 1.5,
        pointerEvents: 'all',
      }}
    >
      {/* Bloco 1: Header Fixo (Sticky no topo) */}
      <div
        style={{
          flexShrink: 0,
          padding: '11px 13px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          background: 'rgba(255,255,255,0.015)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ color: headerColor, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {badge.state === 'active' ? (
              <Icon name="exclamation-triangle" size="sm" style={{ color: headerColor, flexShrink: 0 }} />
            ) : (
              <HistoryAlertIcon size={15} color={headerColor} />
            )}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={metricLabel}>
              {metricLabel || (badge.state === 'active' ? 'Threshold excedido' : 'Excursões na janela')}
            </span>
          </div>

          {/* Botões de ação minimalistas (22x22px) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              title="Expandir na aba lateral"
              style={iconBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.65';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
            >
              <Icon name="columns" size="sm" />
            </button>
            <button
              type="button"
              title="Fechar (Esc)"
              style={{ ...iconBtnStyle, fontSize: 15, fontWeight: 600, lineHeight: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.65';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
            >
              ×
            </button>
          </div>
        </div>

        {metricLabel && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255, 255, 255, 0.55)', padding: '0 1px' }}>
            <span>{badge.state === 'active' ? 'Threshold excedido' : 'Excursões na janela'}</span>
            {currentValueText && (
              <span style={{ fontWeight: 600, color: currentValueColor || headerColor }}>
                {badge.state === 'active' ? `Atual: ${currentValueText}` : `Último: ${currentValueText}`}
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 10.5, opacity: 0.65 }}>
          <span>
            {formatShortTime(tStart, spansDays)} – {formatShortTime(tEnd, spansDays)}
          </span>
          <span>
            {resolvedEpisodes.length} {resolvedEpisodes.length === 1 ? 'caso' : 'casos'} · <strong style={{ color: '#e2e8f0' }}>{humanDuration(totalMs, 'ms')}</strong>
          </span>
        </div>
      </div>

      {/* Bloco 2: Corpo rolável com Visão Geral do Período + Lista Unificada de Cards */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 13px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Visão Geral do Período */}
        {resolvedEpisodes.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}
          >
            {/* Narrativa dinâmica */}
            <div style={{ fontSize: 11, lineHeight: 1.45, color: 'rgba(226, 232, 240, 0.92)' }}>
              {narrativeSummary}
            </div>

            {/* Faixa Resumo: 3 células horizontais compactas */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.35fr 1fr',
                gap: 4,
                padding: '5px 6px',
                borderRadius: 4,
                background: 'rgba(0,0,0,0.25)',
              }}
            >
              {statCell('Total de Casos', `${resolvedEpisodes.length}`, {}, { fontWeight: 700, color: '#e2e8f0' })}
              {statCell(
                'Tempo em Alerta',
                humanDuration(totalMs, 'ms'),
                { borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' },
                { fontWeight: 700, color: headerColor }
              )}
              {statCell(
                thirdStat.label,
                thirdStat.value,
                {},
                { fontWeight: 700, color: thirdStat.color },
                thirdStat.subtext,
                thirdStat.title
              )}
            </div>
          </div>
        )}

        {resolvedEpisodes.map((ep, idx) => {
          const isThisEpFiltered = Boolean(
            activeTimeFilter &&
            Math.abs(activeTimeFilter.stepValue - ep.stepValue) < 1e-6 &&
            (
              Math.abs(activeTimeFilter.startTs - ep.startTs) <= 30000 ||
              (ep.startTs <= activeTimeFilter.endTs + 15000 && ep.endTs >= activeTimeFilter.startTs - 15000)
            )
          );

          return (
            <div
              key={`${ep.stepValue}-${ep.startTs}-${idx}`}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (isThisEpFiltered) {
                  handleRestoreTimeRange();
                } else {
                  handleEpisodeClick(ep);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  if (isThisEpFiltered) {
                    handleRestoreTimeRange();
                  } else {
                    handleEpisodeClick(ep);
                  }
                }
              }}
              title={
                isThisEpFiltered
                  ? 'Período filtrado no dashboard — clique para voltar ao tempo anterior'
                  : `Clique para filtrar o dashboard neste período (${formatTimeDisplay(ep.startTs, spansDays)} – ${ep.isActiveNow ? 'Agora' : formatTimeDisplay(ep.endTs, spansDays)})`
              }
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 6,
                background: isThisEpFiltered
                  ? parseColorToRgba(ep.color, 0.16)
                  : ep.isActiveNow
                  ? parseColorToRgba(ep.color, 0.08)
                  : 'rgba(255,255,255,0.025)',
                border: isThisEpFiltered
                  ? `1px solid ${parseColorToRgba(ep.color, 0.75)}`
                  : `1px solid ${ep.isActiveNow ? parseColorToRgba(ep.color, 0.32) : 'rgba(255,255,255,0.06)'}`,
                borderLeft: `3px solid ${ep.color}`,
                boxShadow: isThisEpFiltered
                  ? `0 0 10px ${parseColorToRgba(ep.color, 0.35)}, inset 0 0 0 1px ${parseColorToRgba(ep.color, 0.25)}`
                  : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                flexShrink: 0,
                transform: isThisEpFiltered ? 'translateY(-1px)' : 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isThisEpFiltered
                  ? parseColorToRgba(ep.color, 0.22)
                  : ep.isActiveNow
                  ? parseColorToRgba(ep.color, 0.14)
                  : 'rgba(255,255,255,0.06)';
                const outline = isThisEpFiltered
                  ? parseColorToRgba(ep.color, 0.9)
                  : ep.isActiveNow
                  ? parseColorToRgba(ep.color, 0.55)
                  : 'rgba(255,255,255,0.25)';
                e.currentTarget.style.borderTopColor = outline;
                e.currentTarget.style.borderRightColor = outline;
                e.currentTarget.style.borderBottomColor = outline;
                e.currentTarget.style.borderLeftColor = ep.color;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isThisEpFiltered
                  ? parseColorToRgba(ep.color, 0.16)
                  : ep.isActiveNow
                  ? parseColorToRgba(ep.color, 0.08)
                  : 'rgba(255,255,255,0.025)';
                const outline = isThisEpFiltered
                  ? parseColorToRgba(ep.color, 0.75)
                  : ep.isActiveNow
                  ? parseColorToRgba(ep.color, 0.32)
                  : 'rgba(255,255,255,0.06)';
                e.currentTarget.style.borderTopColor = outline;
                e.currentTarget.style.borderRightColor = outline;
                e.currentTarget.style.borderBottomColor = outline;
                e.currentTarget.style.borderLeftColor = ep.color;
                e.currentTarget.style.transform = isThisEpFiltered ? 'translateY(-1px)' : 'none';
              }}
            >
              {/* Cabeçalho do Card */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 11, color: ep.color }}>
                  Threshold {exactMatch ? '=' : '≥'} {formatValue(ep.stepValue)}
                </span>
                {ep.isActiveNow ? (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    color: ep.color,
                    backgroundColor: parseColorToRgba(ep.color, 0.16),
                    border: `1px solid ${parseColorToRgba(ep.color, 0.38)}`,
                    padding: '1px 5px',
                    borderRadius: 3,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ● EM ABERTO
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.6)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  NORMALIZADO
                </span>
              )}
            </div>

            {/* Tempos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ opacity: 0.7 }}>Início:</span>
                <span style={{ fontWeight: 600 }}>{formatTimeDisplay(ep.startTs, spansDays)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ opacity: 0.7 }}>Normalização:</span>
                {ep.isActiveNow ? (
                  <span style={{ color: ep.color, fontWeight: 700 }}>Ainda em aberto</span>
                ) : (
                  <span style={{ fontWeight: 600 }}>{formatTimeDisplay(ep.endTs, spansDays)}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ opacity: 0.7 }}>Duração:</span>
                <span style={{ fontWeight: 600 }}>{humanDuration(ep.durationMs, 'ms')}</span>
              </div>
            </div>

            {/* Base do Card: 3 colunas compactas adaptadas ao perfil da métrica */}
            {renderEpisodeCardBottomGrid(ep, profile, tStart, tEnd, formatValue, statCell, field)}
          </div>
        );
      })}
    </div>
  </div>,
  document.body
);
};

export const AlertBadgePopover: React.FC<{
  badge: BadgeInfo;
  tStart: number;
  tEnd: number;
  styles?: any;
  field: Field;
  exactMatch?: boolean;
  comparisonMode?: ThresholdComparisonMode;
  fieldConfig?: FieldConfigSource;
  metricLabel?: string;
  currentValueText?: string;
  currentValueColor?: string;
  size?: number;
  allowNormal?: boolean;
  onChangeTimeRange?: (range: { from: number; to: number }) => void;
}> = ({
  badge,
  tStart,
  tEnd,
  field,
  exactMatch,
  comparisonMode,
  fieldConfig,
  metricLabel,
  currentValueText,
  currentValueColor,
  size = 18,
  allowNormal = false,
  onChangeTimeRange,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const theme = useTheme2();
  const formatValue = useCallback((v: number) => formatFieldValue(v, field, theme).text, [field, theme]);

  const handleClose = useCallback(() => {
    setIsPinned(false);
    setIsHovered(false);
    setIsDrawerOpen(false);
  }, []);

  const handleExpandToDrawer = useCallback(() => {
    setIsPinned(false);
    setIsHovered(false);
    setIsDrawerOpen(true);
  }, []);

  const handleCollapseFromDrawer = useCallback(() => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setIsDrawerOpen(false);
    setIsPinned(true);
  }, []);

  if (badge.state === 'normal' && !allowNormal) return null;

  const isNormal = badge.state === 'normal';
  const isHistory = badge.state === 'historical';
  const liveThresholds = getFieldThresholds(field, theme, fieldConfig);
  const effectiveMode: ThresholdComparisonMode = comparisonMode || (exactMatch ? 'eq' : 'gte');

  // Determina o valor atual da métrica para garantir a cor do threshold ativo agora
  let currentLastVal: number | null = null;
  const rawVals = field.values as any[];
  if (rawVals && rawVals.length) {
    for (let i = rawVals.length - 1; i >= 0; i--) {
      const v = rawVals[i];
      if (v !== null && v !== undefined && !isNaN(Number(v))) {
        currentLastVal = Number(v);
        break;
      }
    }
  }

  const currentStep = currentLastVal !== null ? getActiveNativeThreshold(currentLastVal, liveThresholds, effectiveMode) : null;
  const currentThresholdColor = (currentStep && currentStep.value !== null && currentStep.color) ? currentStep.color : null;

  const activeEpisodes = badge.episodes.filter((e) => e.isActiveNow);
  const activeEpisode = activeEpisodes.sort((a, b) => b.stepValue - a.stepValue)[0];
  const activeStep = activeEpisode
    ? (liveThresholds?.steps.find((s) => s.value !== null && Math.abs(Number(s.value) - Number(activeEpisode.stepValue)) < 1e-6)
       || getActiveNativeThreshold(activeEpisode.maxValue, liveThresholds, effectiveMode))
    : null;

  const activeColor = currentThresholdColor || activeStep?.color || badge.color || '#E24D42';
  const badgeColor = isHistory
    ? '#EAB839'
    : isNormal
    ? 'rgba(255, 255, 255, 0.45)'
    : activeColor;
  const bgAlpha = (isPinned || isDrawerOpen)
    ? (isHistory ? 0.18 : isNormal ? 0.12 : 0.28)
    : (isHistory ? 0.08 : isNormal ? 0.04 : 0.16);
  const borderAlpha = (isPinned || isDrawerOpen)
    ? 0.75
    : isNormal
    ? 0.25
    : 0.55;

  const customCfg = (field.config?.custom ?? {}) as CustomFieldConfig;
  const resolvedLabel = metricLabel || customCfg.label || field.state?.displayName || field.name || 'Métrica';
  const resolvedValueText = currentValueText || (currentLastVal !== null ? formatFieldValue(currentLastVal, field, theme).text : '—');

  const inspectPayload: AlertInspectPayload = {
    badge,
    tStart,
    tEnd,
    field,
    theme,
    exactMatch,
    comparisonMode: effectiveMode,
    fieldConfig,
    metricLabel: resolvedLabel,
    currentValueText: resolvedValueText,
    currentValueColor: currentValueColor || badgeColor,
    onChangeTimeRange,
  };

  const isOpen = (isHovered || isPinned) && !isDrawerOpen;

  const handleMouseEnter = () => {
    // Se já houver uma Aba Lateral montada no DOM, não abre pop-up flutuante por cima no hover
    if (document.querySelector('[data-alert-left-drawer="true"]')) {
      return;
    }
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

    // Dispara evento global antes de abrir o pop-up flutuante comum.
    // Se uma Aba Lateral já estiver montada no DOM, ela intercepta (preventDefault) e atualiza seu estado.
    const inspectEvent = new CustomEvent<AlertInspectPayload>('vale-stat-alert-inspect', {
      detail: inspectPayload,
      cancelable: true,
    });
    const wasNotIntercepted = window.dispatchEvent(inspectEvent);
    if (!wasNotIntercepted) {
      setIsPinned(false);
      setIsHovered(false);
      return;
    }

    if (isPinned) {
      setIsPinned(false);
      setIsHovered(false);
    } else {
      setIsPinned(true);
    }
  };

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: isOpen ? 100005 : 10 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Botão de alerta (Estado A) ou Histórico de Excursão (Estado B) */}
      <div
        ref={triggerRef}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: size <= 18 ? 10 : 12,
          color: badgeColor,
          backgroundColor: parseColorToRgba(badgeColor, bgAlpha),
          border: isHistory
            ? `1px dashed ${parseColorToRgba(badgeColor, borderAlpha)}`
            : `1px solid ${parseColorToRgba(badgeColor, borderAlpha)}`,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
          boxShadow: (isPinned || isDrawerOpen)
            ? `0 0 8px ${parseColorToRgba(badgeColor, 0.4)}`
            : `0 0 5px ${parseColorToRgba(badgeColor, 0.2)}`,
          transform: (isPinned || isDrawerOpen) ? 'scale(1.08)' : 'scale(1)',
        }}
        onClick={handleClick}
        title={
          isHistory
            ? (isPinned ? 'Clique para fechar' : 'Excursão registrada na janela — clique para detalhes')
            : isNormal
            ? (isPinned ? 'Clique para fechar' : 'Operacional / Sem alertas — clique para detalhes e histórico')
            : (isPinned ? 'Clique para fechar' : 'Threshold ativo neste momento — clique para detalhes')
        }
      >
        {isHistory ? (
          <HistoryAlertIcon size={size <= 18 ? 10 : 12} color="#EAB839" />
        ) : (
          <span style={{ lineHeight: 1, marginTop: -1 }}>!</span>
        )}
      </div>

      {/* Portal do Pop-up Flutuante: renderizado fora do DOM do painel, direto no body */}
      {isOpen && triggerRect && (
        <AlertPopupPortal
          badge={badge}
          tStart={tStart}
          tEnd={tEnd}
          triggerRect={triggerRect}
          isPinned={isPinned}
          onClose={handleClose}
          onExpand={handleExpandToDrawer}
          formatValue={formatValue}
          exactMatch={exactMatch}
          comparisonMode={effectiveMode}
          field={field}
          theme={theme}
          fieldConfig={fieldConfig}
          metricLabel={resolvedLabel}
          currentValueText={resolvedValueText}
          currentValueColor={currentValueColor || badgeColor}
          onChangeTimeRange={onChangeTimeRange}
        />
      )}

      {/* Portal da Aba Lateral (Left Side Drawer) */}
      {isDrawerOpen && (
        <AlertLeftDrawer
          initialPayload={inspectPayload}
          onCollapse={handleCollapseFromDrawer}
          onClose={handleClose}
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
  const themeKey = options.theme && THEME_COLORS[options.theme] ? options.theme : 'vale';
  const { accent } = THEME_COLORS[themeKey] ?? THEME_COLORS.vale;
  const styles = useStyles2((t) => getStyles(t, accent, (options.valueFontSize as any) ?? 26));

  // ── Refs e estado de UI ────────────────────────────────────────────────────
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(52);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinnedHover, setPinnedHover] = useState<HoverState | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [selectedSeriesIndex, setSelectedSeriesIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) {
      return;
    }
    const updateHeight = () => {
      if (headerRef.current) {
        setHeaderH(headerRef.current.offsetHeight);
      }
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    options.valueFontSize,
    options.showIcon,
    options.showLabel,
    options.showCurrentValue,
    options.showSummary,
    options.showPeriodMin,
    options.showPeriodAverage,
    options.showPeriodPeak,
    options.showTimeInAlert,
    width,
    height,
    data,
  ]);

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
        const rawFixedColor = numericField.config?.color?.fixedColor;
        const color = rawFixedColor
          ? resolveCanvasColor(rawFixedColor, theme)
          : (SERIES_PALETTE[seriesIndex % SERIES_PALETTE.length] || accent);
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
  const baseColor = resolveCanvasColor(customCfg.lineColor || firstSeriesColor, theme);
  
  const effectiveAreaOpacity = (customCfg.areaOpacity ?? 35) / 100;

  // Linhas de threshold calculadas APENAS a partir das séries ativas/selecionadas
  const thresholdLines: Array<{ value: number; color: string }> = useMemo(() => {
    if (!options.showThresholdLine) return [];
    const lines: Array<{ value: number; color: string }> = [];
    activeChartSeries.forEach((s) => {
      const nativeThr = getFieldThresholds(s.field, theme, fieldConfig);
      if (nativeThr?.steps) {
        nativeThr.steps.forEach((st) => {
          if (st.value !== null && typeof st.value === 'number') {
            const lineCol = resolveCanvasColor(st.color, theme);
            if (!lines.some((l) => l.value === st.value && l.color === lineCol)) {
              lines.push({ value: st.value, color: lineCol });
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
    if (last === null) { return resolveCanvasColor(fallback, theme); }
    const isExact = getFieldExactMatch(s.field, options.exactThresholdMatch, fieldConfig);
    const step = getActiveNativeThreshold(last, getFieldThresholds(s.field, theme, fieldConfig), isExact);
    if (step && step.value !== null && step.color) { return resolveCanvasColor(step.color, theme); }
    const mapped = getMappedColor(last, s.field, theme);
    if (mapped) { return resolveCanvasColor(mapped, theme); }
    if (isExact) { return resolveCanvasColor(fallback, theme); }
    return step?.color ? resolveCanvasColor(step.color, theme) : resolveCanvasColor(fallback, theme);
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

  const disconnectThreshold = options.disconnectThreshold ?? 'auto';

  const alertDurations = useMemo(() => {
    if (!options.showTimeInAlert || periodSummaryInfos.length !== 1) return [];
    const isExact = getFieldExactMatch(periodSummaryInfos[0].field, options.exactThresholdMatch, fieldConfig);
    return getAlertDurations(
      periodSummaryInfos[0].values,
      periodSummaryInfos[0].timeValues,
      getFieldThresholds(periodSummaryInfos[0].field, theme, fieldConfig),
      tStart,
      tEnd,
      isExact,
      disconnectThreshold
    );
  }, [options.showTimeInAlert, options.exactThresholdMatch, periodSummaryInfos, tStart, tEnd, theme, fieldConfig, disconnectThreshold]);

  // ── Auto min/max com cálculo dinâmico sobre séries ativas/selecionadas ─────
  const autoMin = customCfg.axisConfig?.autoMin ?? true;
  const autoMax = customCfg.axisConfig?.autoMax ?? true;

  const { dataMinEff, dataMaxEff } = useMemo(() => {
    const allVals = activeChartSeries
      .flatMap((s) => s.values)
      .filter((v) => v !== null && v !== undefined && v !== ('' as any) && !isNaN(Number(v)))
      .map((v) => Number(v));

    const rawDataMin = allVals.length ? Math.min(...allVals) : 0;
    const rawDataMax = allVals.length ? Math.max(...allVals) : 1;

    const fieldMin = activeChartSeries.map((s) => s.field.config?.min).find((v) => v !== undefined && v !== null);
    const fieldMax = activeChartSeries.map((s) => s.field.config?.max).find((v) => v !== undefined && v !== null);

    // Série binária/status (ex: ICMP Ping onde os pontos coletados são apenas 0 ou 1)
    const isBinarySeries = allVals.length > 0 && allVals.every((v) => v === 0 || v === 1);

    // Thresholds relevantes das séries ativas (passando fieldConfig para respeitar Overrides)
    const relevantThresholdVals: number[] = [];
    if (!isBinarySeries) {
      activeChartSeries.forEach((s) => {
        const thr = getFieldThresholds(s.field, theme, fieldConfig);
        if (thr?.steps) {
          thr.steps.forEach((st) => {
            if (st.value !== null && typeof st.value === 'number') {
              if (rawDataMax > 0 && st.value <= rawDataMax * 3 && st.value >= rawDataMin) {
                relevantThresholdVals.push(st.value);
              } else if (rawDataMax === 0 && st.value > 0 && st.value <= 10) {
                relevantThresholdVals.push(st.value);
              }
            }
          });
        }
      });
    }

    const peakVal = relevantThresholdVals.length > 0
      ? Math.max(rawDataMax, ...relevantThresholdVals)
      : rawDataMax;

    let min: number;
    if (!autoMin && customCfg.axisConfig?.min !== undefined) {
      min = customCfg.axisConfig.min;
    } else if (isBinarySeries) {
      // Prioridade máxima para série binária (ignora fieldMin legado como -1 salvo no JSON):
      // Fixa 0 (Down) na base do card com respiro estético, independente do número de thresholds
      min = -0.12;
    } else if (fieldMin !== undefined) {
      min = fieldMin;
    } else if (rawDataMin === 0 && peakVal === 0) {
      min = -0.12;
    } else {
      const delta = (peakVal - rawDataMin) || (peakVal !== 0 ? Math.abs(peakVal) * 0.12 : 1);
      min = chartType === 'bar' ? Math.min(rawDataMin, 0) : rawDataMin - delta * 0.08;
    }

    let max: number;
    if (!autoMax && customCfg.axisConfig?.max !== undefined) {
      max = customCfg.axisConfig.max;
    } else if (isBinarySeries) {
      // Prioridade máxima para série binária:
      // Fixa 1 (Up) no topo do card com respiro estético, mesmo quando todos os pontos atuais são 0 (Down)
      max = 1.15;
    } else if (fieldMax !== undefined) {
      max = fieldMax;
    } else if (rawDataMin === 0 && peakVal === 0) {
      max = 1.15;
    } else {
      const delta = (peakVal - rawDataMin) || (peakVal !== 0 ? Math.abs(peakVal) * 0.12 : 1);
      max = chartType === 'bar' ? Math.max(peakVal, 0) + delta * 0.12 : peakVal + delta * 0.12;
    }

    return { dataMinEff: min, dataMaxEff: max > min ? max : min + 1 };
  }, [activeChartSeries, autoMin, autoMax, chartType, customCfg.axisConfig, theme, fieldConfig]);

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
    singleExactMatch = getFieldExactMatch(singleSeries.field, options.exactThresholdMatch, fieldConfig);
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
  if (singleExactMatch && activeSingleThresholdColor === null) {
    valueColor = displayValueColor || singleStepColor || '#FFFFFF';
  } else if (isSingleValueThreshold) {
    if (activeSingleThresholdColor) {
      valueColor = activeSingleThresholdColor;
    } else if (displayValueColor) {
      valueColor = displayValueColor;
    } else {
      valueColor = singleStepColor ?? '#FFFFFF';
    }
  } else {
    valueColor = activeSingleThresholdColor || displayValueColor || '#FFFFFF';
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
                backgroundColor: singleIconStyle === 'clean' ? 'transparent' : `color-mix(in srgb, ${iconColor} 18%, transparent)`,
                border: singleIconStyle === 'clean' ? 'none' : `1px solid color-mix(in srgb, ${iconColor} 30%, transparent)`,
                boxShadow: singleIconStyle === 'clean' ? 'none' : `0 0 6px color-mix(in srgb, ${iconColor} 16%, transparent)`,
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
                    badge={getBadgeState(singleLastVal, singleS.values, singleS.timeValues, singleThr, tStart, tEnd, theme, activeSingleThresholdColor, singleExactMatch, disconnectThreshold)}
                    tStart={tStart}
                    tEnd={tEnd}
                    styles={styles}
                    field={singleS.field}
                    exactMatch={singleExactMatch}
                    fieldConfig={fieldConfig}
                    metricLabel={singleLabel}
                    currentValueText={displayValue ?? '—'}
                    currentValueColor={valueColor}
                    onChangeTimeRange={onChangeTimeRange}
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
            const sExactMatch = getFieldExactMatch(s.field, options.exactThresholdMatch, fieldConfig);
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
            if (sExactMatch && activeViolationColor === null) {
              multiValueColor = mappedValColor || step?.color || '#FFFFFF';
            } else if (isMultiValueThreshold) {
              if (activeViolationColor) {
                multiValueColor = activeViolationColor;
              } else if (mappedValColor) {
                multiValueColor = mappedValColor;
              } else {
                multiValueColor = step?.color ?? '#FFFFFF';
              }
            } else {
              multiValueColor = activeViolationColor || mappedValColor || '#FFFFFF';
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
              ? getAlertDurations(s.values, s.timeValues, getFieldThresholds(s.field, theme, fieldConfig), tStart, tEnd, sExactMatch, disconnectThreshold)
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
                        backgroundColor: currentIconStyle === 'clean' ? 'transparent' : `color-mix(in srgb, ${multiIconColor} 18%, transparent)`,
                        border: currentIconStyle === 'clean' ? 'none' : `1px solid color-mix(in srgb, ${multiIconColor} 30%, transparent)`,
                        boxShadow: currentIconStyle === 'clean' ? 'none' : `0 0 6px color-mix(in srgb, ${multiIconColor} 16%, transparent)`,
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
                       badge={getBadgeState(lastVal, s.values, s.timeValues, thr, tStart, tEnd, theme, activeViolationColor, sExactMatch, disconnectThreshold)}
                       tStart={tStart}
                       tEnd={tEnd}
                       styles={styles}
                       field={s.field}
                       exactMatch={sExactMatch}
                       fieldConfig={fieldConfig}
                       metricLabel={serieLabel}
                       currentValueText={formattedVal}
                       currentValueColor={multiValueColor}
                       onChangeTimeRange={onChangeTimeRange}
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
              disconnectThreshold={disconnectThreshold}
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
