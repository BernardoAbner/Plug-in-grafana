import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import {
  PanelProps,
  Field,
  FieldType,
  formattedValueToString,
  getFieldDisplayName,
  GrafanaTheme2,
  getValueFormat,
  getDisplayProcessor,
} from '@grafana/data';
import {
  SimpleOptions, CardTheme,
  NativeThresholdsConfig, ThresholdStep,
  AnyMapping, ValueMapping, RangeMapping, RegexMapping, SpecialMapping,
  NativeUnit,
  LineInterpolation,
} from '../types';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';

interface Props extends PanelProps<SimpleOptions> { }

// ─── Mapeamento de ícones ──────────────────────────────────────────────────
const ICON_MAP: Record<string, string> = {
  cpu: 'processor',
  server: 'server',
  'server-alt': 'server',
  database: 'database',
  hdd: 'save',
  'network-wired': 'plug-connected',
  temperature: 'gf-interpolation',
  wifi: 'wifi',
  bolt: 'bolt',
  'check-circle': 'check-circle',
  'exclamation-triangle': 'exclamation-triangle',
  alert: 'alert',
  'bell-slash': 'bell-slash',
  'times-circle': 'times',
  heartbeat: 'heart',
  'arrow-up': 'arrow-up',
  'arrow-down': 'arrow-down',
  'chart-line': 'chart-line',
  signal: 'signal',
  clock: 'clock',
  heart: 'heart',
  shield: 'shield',
  apps: 'apps',
};

function resolveIconName(icon: string): string {
  return ICON_MAP[icon] ?? 'apps';
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

/** Aplica mapeamentos de valor (todos os 4 tipos, mesma ordem que o Grafana). */
function applyMappings(
  raw: unknown,
  mappings: AnyMapping[]
): { text?: string; color?: string } | null {
  for (const m of mappings) {
    if (m.type === 'value') {
      const vm = m as ValueMapping;
      const key = String(raw);
      if (vm.options[key]) { return vm.options[key]; }
    } else if (m.type === 'range') {
      const rm = m as RangeMapping;
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!isNaN(n)) {
        const from = rm.options.from ?? -Infinity;
        const to = rm.options.to ?? Infinity;
        if (n >= from && n <= to) { return rm.options.result; }
      }
    } else if (m.type === 'regex') {
      const rxm = m as RegexMapping;
      try {
        if (new RegExp(rxm.options.pattern).test(String(raw))) {
          return rxm.options.result;
        }
      } catch { /* regex inválida — ignora */ }
    } else if (m.type === 'special') {
      const sm = m as SpecialMapping;
      const match = sm.options.match;
      const isNull = raw === null || raw === undefined;
      const isNaN_ = typeof raw === 'number' && isNaN(raw);
      const isEmpty = raw === '';
      const hit =
        (match === 'null' && isNull) ||
        (match === 'nan' && isNaN_) ||
        (match === 'null+nan' && (isNull || isNaN_)) ||
        (match === 'true' && raw === true) ||
        (match === 'false' && raw === false) ||
        (match === 'empty' && isEmpty);
      if (hit) { return sm.options.result; }
    }
  }
  return null;
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

/** Formata um número bruto aplicando unit, decimals e mapeamentos. */
function formatValue(
  raw: unknown,
  unit: NativeUnit,
  decimals: number,
  mappings: AnyMapping[]
): { text: string; color?: string } {
  // 1. Mapeamentos têm prioridade máxima
  const mapped = applyMappings(raw, mappings);
  if (mapped?.text !== undefined) {
    return { text: mapped.text, color: mapped.color };
  }

  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (isNaN(n)) { return { text: String(raw ?? '') }; }

  // 2. Casas decimais
  const dp = decimals >= 0 ? decimals : undefined; // undefined = automático

  // 3. Unidade
  switch (unit) {
    case 'percent': return { text: `${toFixed(n, dp ?? 2)} %` };
    case 'percentunit': return { text: `${toFixed(n * 100, dp ?? 2)} %` };
    // Tempo
    case 'ms': return { text: `${toFixed(n, dp ?? 0)} ms` };
    case 's': return { text: `${toFixed(n, dp ?? 2)} s` };
    case 'm': return { text: `${toFixed(n, dp ?? 2)} m` };
    case 'h': return { text: `${toFixed(n, dp ?? 2)} h` };
    case 'd': return { text: `${toFixed(n, dp ?? 2)} d` };
    case 'dtdurationms': return { text: humanDuration(n, 'ms') };
    case 'dtdurations': return { text: humanDuration(n * 1000, 'ms') };
    // Bytes (IEC)
    case 'bytes': return { text: humanBytes(n, 1024, dp, ['B', 'KB', 'MB', 'GB', 'TB', 'PB']) };
    case 'kbytes': return { text: humanBytes(n * 1024, 1024, dp, ['B', 'KB', 'MB', 'GB', 'TB']) };
    case 'mbytes': return { text: humanBytes(n * 1048576, 1024, dp, ['B', 'KB', 'MB', 'GB', 'TB']) };
    case 'gbytes': return { text: humanBytes(n * 1073741824, 1024, dp, ['B', 'KB', 'MB', 'GB', 'TB', 'PB']) };
    case 'tbytes': return { text: humanBytes(n * 1099511627776, 1024, dp, ['B', 'KB', 'MB', 'GB', 'TB', 'PB']) };
    // Bits
    case 'bits': return { text: humanBytes(n, 1000, dp, ['b', 'kb', 'Mb', 'Gb', 'Tb']) };
    case 'kbits': return { text: humanBytes(n * 1000, 1000, dp, ['b', 'kb', 'Mb', 'Gb']) };
    case 'mbits': return { text: humanBytes(n * 1e6, 1000, dp, ['b', 'kb', 'Mb', 'Gb']) };
    case 'gbits': return { text: humanBytes(n * 1e9, 1000, dp, ['b', 'kb', 'Mb', 'Gb', 'Tb']) };
    // Throughput
    case 'Bps': return { text: `${humanBytes(n, 1024, dp, ['B/s', 'KB/s', 'MB/s', 'GB/s'])}` };
    case 'KBs': return { text: `${humanBytes(n * 1024, 1024, dp, ['B/s', 'KB/s', 'MB/s', 'GB/s'])}` };
    case 'MBs': return { text: `${humanBytes(n * 1048576, 1024, dp, ['B/s', 'KB/s', 'MB/s', 'GB/s'])}` };
    case 'GBs': return { text: `${humanBytes(n * 1073741824, 1024, dp, ['B/s', 'KB/s', 'MB/s', 'GB/s'])}` };
    case 'bps': return { text: humanBytes(n, 1000, dp, ['bps', 'kbps', 'Mbps', 'Gbps']) };
    case 'Kbits': return { text: humanBytes(n * 1000, 1000, dp, ['bps', 'kbps', 'Mbps', 'Gbps']) };
    case 'Mbits': return { text: humanBytes(n * 1e6, 1000, dp, ['bps', 'kbps', 'Mbps', 'Gbps']) };
    case 'Gbits': return { text: humanBytes(n * 1e9, 1000, dp, ['bps', 'kbps', 'Mbps', 'Gbps']) };
    // Ops
    case 'ops': return { text: `${toFixed(n, dp ?? 2)} ops/s` };
    case 'reqps': return { text: `${toFixed(n, dp ?? 2)} req/s` };
    case 'rps': return { text: `${toFixed(n, dp ?? 2)} rps` };
    case 'wps': return { text: `${toFixed(n, dp ?? 2)} wps` };
    case 'iops': return { text: `${toFixed(n, dp ?? 0)} IOPS` };
    // Temperatura
    case 'celsius': return { text: `${toFixed(n, dp ?? 1)} °C` };
    case 'fahrenheit': return { text: `${toFixed(n, dp ?? 1)} °F` };
    case 'kelvin': return { text: `${toFixed(n, dp ?? 1)} K` };
    // Frequência
    case 'hertz': return { text: humanBytes(n, 1000, dp, ['Hz', 'kHz', 'MHz', 'GHz']) };
    case 'kilohertz': return { text: humanBytes(n * 1e3, 1000, dp, ['Hz', 'kHz', 'MHz', 'GHz']) };
    case 'megahertz': return { text: humanBytes(n * 1e6, 1000, dp, ['Hz', 'kHz', 'MHz', 'GHz']) };
    case 'gigahertz': return { text: humanBytes(n * 1e9, 1000, dp, ['Hz', 'kHz', 'MHz', 'GHz', 'THz']) };
    // Elétrica
    case 'volt': return { text: `${toFixed(n, dp ?? 2)} V` };
    case 'amp': return { text: `${toFixed(n, dp ?? 2)} A` };
    case 'watt': return { text: `${toFixed(n, dp ?? 2)} W` };
    case 'kilowatt': return { text: `${toFixed(n / 1000, dp ?? 2)} kW` };
    case 'kwatth': return { text: `${toFixed(n, dp ?? 2)} kWh` };
    // Moeda
    case 'currencyUSD': return { text: `$${toFixed(n, dp ?? 2)}` };
    case 'currencyBRL': return { text: `R$\u00a0${toFixed(n, dp ?? 2)}` };
    case 'currencyEUR': return { text: `€${toFixed(n, dp ?? 2)}` };
    // Comprimento / velocidade
    case 'lengthm': return { text: `${toFixed(n, dp ?? 2)} m` };
    case 'lengthkm': return { text: `${toFixed(n, dp ?? 2)} km` };
    case 'velocityms': return { text: `${toFixed(n, dp ?? 2)} m/s` };
    case 'velocitykmh': return { text: `${toFixed(n, dp ?? 2)} km/h` };
    // Short
    case 'short': return { text: humanShort(n, dp) };
    case 'number': return { text: toFixed(n, dp ?? 0) };
    default: return { text: toFixed(n, dp ?? 2) };
  }
}

/**
 * Formata o valor respeitando a configuração escolhida no painel.
 * Em "Automático", delega ao processador do campo do Grafana, que preserva
 * a unidade e os prefixos entregues pela fonte de dados (por exemplo, Zabbix).
 */
function formatFieldValue(raw: unknown, field: Field, theme: GrafanaTheme2): { text: string; color?: string } {
  const customCfg = (field.config?.custom ?? {}) as any;
  const unitToUse = (customCfg.customUnit && customCfg.customUnit !== 'none') ? customCfg.customUnit : field.config.unit;
  const decimalsToUse = customCfg.customDecimals !== undefined && customCfg.customDecimals !== null ? customCfg.customDecimals : field.config.decimals;

  // Cria um processador de display fresco, que IGNORA os defaults da fonte de dados
  // e força as Standard Options e a unidade customizada configurada no painel.
  const overriddenField = { 
    ...field, 
    display: undefined,
    config: {
      ...field.config,
      unit: unitToUse,
      decimals: decimalsToUse
    }
  };

  const displayProcessor = getDisplayProcessor({ field: overriddenField, theme });
  const display = displayProcessor(raw);
  return { text: formattedValueToString(display), color: display.color };
}

/** Formata com casas decimais fixas ou automáticas. */
function toFixed(n: number, dp: number): string {
  if (dp === undefined || dp < 0) {
    // automático: até 2 casas, remove zeros à direita
    return parseFloat(n.toFixed(2)).toString();
  }
  return n.toFixed(dp);
}

/** Formata bytes em escala IEC ou SI com prefixos. */
function humanBytes(n: number, base: number, dp: number | undefined, units: string[]): string {
  let val = n;
  let idx = 0;
  while (Math.abs(val) >= base && idx < units.length - 1) {
    val /= base;
    idx++;
  }
  return `${toFixed(val, dp ?? 2)} ${units[idx]}`;
}

/** Formata duração humanizada a partir de milissegundos. */
function humanDuration(ms: number, _unit: 'ms'): string {
  if (ms < 1000) { return `${Math.round(ms)} ms`; }
  const s = ms / 1000;
  if (s < 60) { return `${toFixed(s, 1)} s`; }
  const m = s / 60;
  if (m < 60) { return `${Math.floor(m)}m ${Math.round(s % 60)}s`; }
  const h = m / 60;
  if (h < 24) { return `${Math.floor(h)}h ${Math.round(m % 60)}m`; }
  const d = h / 24;
  return `${Math.floor(d)}d ${Math.round(h % 24)}h`;
}

/** Formata número encurtado (1k, 1M, 1B). */
function humanShort(n: number, dp: number | undefined): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) { return `${toFixed(n / 1e9, dp ?? 2)} B`; }
  if (abs >= 1e6) { return `${toFixed(n / 1e6, dp ?? 2)} M`; }
  if (abs >= 1e3) { return `${toFixed(n / 1e3, dp ?? 2)} K`; }
  return toFixed(n, dp ?? 2);
}

interface SeriesInfo {
  name: string;
  field: Field;
  fieldConfig: Record<string, any>;
  values: number[];
  timeValues: number[];
  color: string;
}

// ─── Algoritmo "Nice Numbers" para eixo Y (Wilkinson simplificado) ─────────
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) { niceFraction = 1; }
    else if (fraction < 3) { niceFraction = 2; }
    else if (fraction < 7) { niceFraction = 5; }
    else { niceFraction = 10; }
  } else {
    if (fraction <= 1) { niceFraction = 1; }
    else if (fraction <= 2) { niceFraction = 2; }
    else if (fraction <= 5) { niceFraction = 5; }
    else { niceFraction = 10; }
  }
  return niceFraction * Math.pow(10, exponent);
}

function calcYTicks(
  dataMin: number,
  dataMax: number,
  pixelH: number,
  minPxPerTick = 40
): { ticks: Array<{ value: number; y: number }>; lo: number; hi: number } {
  const maxTicks = Math.max(2, Math.floor(pixelH / minPxPerTick));
  let dMin = dataMin;
  let dMax = dataMax;
  let range = dMax - dMin;
  if (range === 0) {
    const base = Math.abs(dMin) || 1;
    dMin = dMin - base * 0.1;
    dMax = dMax + base * 0.1;
    range = dMax - dMin;
  }
  const rawStep = range / maxTicks;
  const niceStep = niceNum(rawStep, true);
  const lo = Math.floor(dMin / niceStep) * niceStep;
  const hi = Math.ceil(dMax / niceStep) * niceStep;
  const ticks: Array<{ value: number; y: number }> = [];
  const finalRange = hi - lo || 1;
  let v = lo;
  while (v <= hi + niceStep * 0.0001) {
    const y = pixelH - ((v - lo) / finalRange) * pixelH;
    ticks.push({ value: v, y });
    v = Math.round((v + niceStep) * 1e10) / 1e10;
    if (ticks.length > maxTicks + 2) { break; }
  }
  return { ticks, lo, hi };
}

// ─── Algoritmo de ticks X (tempo adaptativo) ──────────────────────────────
const TIME_INTERVALS_MS = [
  1000, 5000, 10000, 30000,
  60000, 5 * 60000, 10 * 60000, 15 * 60000, 30 * 60000,
  60 * 60000, 3 * 3600000, 6 * 3600000, 12 * 3600000,
  86400000, 7 * 86400000,
];

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatXLabel(ts: number, showDate: boolean): string {
  const d = new Date(ts);
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  if (showDate) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function formatTooltipTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

interface XTick { ts: number; x: number; label: string; }

function calcXTicks(times: number[], pixelW: number, minPxPerTick = 80): XTick[] {
  if (times.length < 2) { return []; }
  const tStart = times[0];
  const tEnd = times[times.length - 1];
  const totalMs = tEnd - tStart;
  if (totalMs <= 0) { return []; }
  const showDate = new Date(tStart).toDateString() !== new Date(tEnd).toDateString();
  const maxTicks = Math.max(2, Math.floor(pixelW / minPxPerTick));
  const rawInterval = totalMs / maxTicks;
  let chosenInterval = TIME_INTERVALS_MS[TIME_INTERVALS_MS.length - 1];
  for (const iv of TIME_INTERVALS_MS) {
    if (iv >= rawInterval) { chosenInterval = iv; break; }
  }
  const firstTick = Math.ceil(tStart / chosenInterval) * chosenInterval;
  const ticks: XTick[] = [];
  let ts = firstTick;
  while (ts <= tEnd && ticks.length <= maxTicks + 1) {
    const x = ((ts - tStart) / totalMs) * pixelW;
    ticks.push({ ts, x, label: formatXLabel(ts, showDate) });
    ts += chosenInterval;
  }
  return ticks;
}

// ─── Build de paths SVG ──────────────────────────────────────────────────────
// Posiciona cada ponto no eixo X usando o timestamp real (não índice),
// mapeado sobre o range completo do Grafana (tStart → tStart+totalMs).
// Onde não há dado, a linha simplesmente não existe — nenhuma interpolação.
interface BarRect { x: number; y: number; w: number; h: number; }

function buildLinePath(points: Array<{ x: number; y: number }>, interpolation: LineInterpolation): string {
  if (!points.length) { return ''; }
  if (points.length === 1) { return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`; }
  if (interpolation === 'smooth') {
    // Interpolação cúbica monotônica: suaviza sem ultrapassar os pontos,
    // evitando a oscilação visual que curvas Bézier simples podem causar.
    const slopes = points.slice(0, -1).map((point, index) => {
      const next = points[index + 1];
      return (next.y - point.y) / Math.max(next.x - point.x, 0.0001);
    });
    const tangents = points.map((_point, index) => {
      if (index === 0) { return slopes[0]; }
      if (index === points.length - 1) { return slopes[slopes.length - 1]; }
      return (slopes[index - 1] + slopes[index]) / 2;
    });
    slopes.forEach((slope, index) => {
      if (Math.abs(slope) < 0.0001) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        return;
      }
      const a = tangents[index] / slope;
      const b = tangents[index + 1] / slope;
      const magnitude = a * a + b * b;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[index] = scale * a * slope;
        tangents[index + 1] = scale * b * slope;
      }
    });
    let smoothPath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      const dx = end.x - start.x;
      smoothPath += ` C ${(start.x + dx / 3).toFixed(1)} ${(start.y + tangents[index] * dx / 3).toFixed(1)}, ${(end.x - dx / 3).toFixed(1)} ${(end.y - tangents[index + 1] * dx / 3).toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    }
    return smoothPath;
  }
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    if (interpolation === 'stepBefore') {
      path += ` V ${current.y.toFixed(1)} H ${current.x.toFixed(1)}`;
    } else if (interpolation === 'stepAfter') {
      path += ` H ${current.x.toFixed(1)} V ${current.y.toFixed(1)}`;
    } else {
      path += ` L ${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
    }
  }
  return path;
}

function buildChartPaths(
  values: number[],
  times: number[],   // timestamps reais de cada ponto
  width: number,
  height: number,
  lo: number,
  hi: number,
  tStart: number,    // início do range selecionado (data.timeRange.from)
  totalMs: number,   // duração total do range
  interpolation: LineInterpolation = 'straight',
  barWidthPercent = 70
): { line: string; area: string; bars: BarRect[] } {
  if (values.length < 1) { return { line: '', area: '', bars: [] }; }
  const range = hi - lo || 1;
  // Cada ponto tem sua posição X baseada no timestamp real
  const toX = (ts: number) => ((ts - tStart) / totalMs) * width;
  const toY = (v: number) => height - ((v - lo) / range) * height;
  const points: {x: number, y: number}[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && !isNaN(v)) {
      points.push({ x: toX(times[i] ?? tStart), y: toY(v) });
    }
  }

  if (points.length === 0) { return { line: '', area: '', bars: [] }; }

  const line = buildLinePath(points, interpolation);
  const lastPt = points[points.length - 1];
  const firstX = points[0].x.toFixed(1);
  const lastX = lastPt ? lastPt.x.toFixed(1) : width.toFixed(1);
  const area = line ? `${line} L ${lastX} ${height} L ${firstX} ${height} Z` : '';
  return { line, area, bars: [] };
}

/** Retorna a cor do threshold nativo para uso no modo schema (por trecho). */
function getSchemaColor(
  value: number,
  thresholds: NativeThresholdsConfig | undefined,
  fallbackColor: string
): string {
  const step = getActiveNativeThreshold(value, thresholds);
  return step?.color ?? fallbackColor;
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

// ─── Estado de interação ───────────────────────────────────────────────────
interface HoverState {
  px: number;
  py: number;
  points: Array<{ name: string; value: string; color: string }>;
  ts: number;
}

interface DragState {
  startPx: number;
  currentPx: number;
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
    label: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${labelColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
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
      flex-wrap: wrap;
      gap: ${theme.spacing(0.75)} ${theme.spacing(1.5)};
      padding: 0 ${theme.spacing(2)} ${theme.spacing(0.5)};
      z-index: 3;
      flex-shrink: 0;
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
      margin-top: ${theme.spacing(0.75)};
    `,
    chartArea: css`
      position: relative;
      flex: 1;
      min-height: 0;
      user-select: none;
      -webkit-user-select: none;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [headerH, setHeaderH] = useState(52);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());

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
  const lineGradient = customCfg.lineGradient ?? 'none';
  const lineWidth = customCfg.lineWidth ?? 2;
  const showPoints = customCfg.showPoints ?? false;
  const pointSize = customCfg.pointSize ?? 3;
  const barWidth = customCfg.barWidth ?? 70;
  const barMode = customCfg.barMode ?? 'grouped';
  const axisConfig = customCfg.axisConfig ?? { autoMin: true, autoMax: true, min: 0, max: 100 };
  const baseColor = customCfg.lineColor || accent;
  const effectiveAreaOpacity = (customCfg.areaOpacity ?? 35) / 100;

  let singleEffectiveColor = baseColor;
  if (visibleSeriesInfos.length === 1 && options.useThreshold && !customCfg.lineColor) {
    const s = visibleSeriesInfos[0];
    const last = s.values.length ? s.values[s.values.length - 1] : null;
    if (last !== null) {
      const nativeThr = getFieldThresholds(s.field);
      const step = getActiveNativeThreshold(last, nativeThr);
      if (step?.color) { singleEffectiveColor = step.color; }
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
  const X_AXIS_H = showXAxis ? 22 : 0;
  const LEGEND_H = options.showLegend ? 28 : 0;
  const PAD_LEFT = 8;
  const PAD_RIGHT = 8;
  const PAD_TOP = 6;

  const periodSummaryInfos = options.showPeriodSummary ? (seriesInfos.length === 1 ? seriesInfos : (allSeriesInfos.length === 1 ? allSeriesInfos : [])) : [];
  const summaryValues = periodSummaryInfos.length > 0 ? periodSummaryInfos[0].values.filter((v) => v !== null && !isNaN(v)) : [];
  const summaryH = options.showPeriodSummary && periodSummaryInfos.length === 1 ? 24 : 0;

  const totalHeaderH = Math.max(headerH, 40) + theme.spacing.gridSize + summaryH;
  const svgW = width;
  const svgH = Math.max(height - totalHeaderH - LEGEND_H, 30);
  const plotX = Y_AXIS_W + PAD_LEFT;
  const plotW = Math.max(svgW - plotX - PAD_RIGHT, 10);
  const plotY = PAD_TOP;
  const plotH = Math.max(svgH - PAD_TOP - X_AXIS_H, 10);

  const tStart = data.timeRange.from.valueOf();
  const tEnd = data.timeRange.to.valueOf();
  const totalMs = Math.max(tEnd - tStart, 1);

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

  // ── Ticks Y (useMemo #2) ───────────────────────────────────────────────────
  const autoMin = axisConfig.autoMin ?? true;
  const autoMax = axisConfig.autoMax ?? true;
  const fallbackInfos = seriesInfos.length > 0 ? seriesInfos : allSeriesInfos;

  const { dataMinEff, dataMaxEff } = useMemo(() => {
    const allVals = fallbackInfos.flatMap((s) => s.values).filter(v => v !== null && v !== undefined && !isNaN(v));
    const rawDataMin = allVals.length ? Math.min(...allVals) : 0;
    const rawDataMax = allVals.length ? Math.max(...allVals) : 1;
    const min = autoMin ? (chartType === 'bar' ? Math.min(rawDataMin, 0) : rawDataMin) : (axisConfig.min ?? 0);
    const max = autoMax ? (chartType === 'bar' ? Math.max(rawDataMax, 0) : rawDataMax) : (axisConfig.max ?? 100);
    return { dataMinEff: min, dataMaxEff: max };
  }, [fallbackInfos, autoMin, autoMax, chartType, axisConfig]);

  const { ticks: yTicks, lo: yLo, hi: yHi } = useMemo(
    () => calcYTicks(dataMinEff, dataMaxEff, plotH, 28),
    [dataMinEff, dataMaxEff, plotH]
  );

  // ── Ticks X (useMemo #3) ───────────────────────────────────────────────────
  const xTicks = useMemo(() => {
    if (totalMs <= 0) return [];
    return calcXTicks([tStart, tEnd], plotW, showYAxis ? 65 : 60);
  }, [tStart, tEnd, totalMs, plotW, showYAxis]);

  // ── Funções de conversão de coordenadas (useCallback #1, #2) ──────────────
  const pxToTs = useCallback(
    (px: number) => tStart + (px / plotW) * totalMs,
    [tStart, totalMs, plotW]
  );

  const pxToDataIndex = useCallback(
    (px: number, n: number) => Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))),
    [plotW]
  );

  const eventToPx = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): { px: number; py: number } | null => {
      const svg = svgRef.current;
      if (!svg) { return null; }
      const rect = svg.getBoundingClientRect();
      const scaleX = svgW / rect.width;
      const scaleY = svgH / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;
      return { px: svgX - plotX, py: svgY - plotY };
    },
    [svgW, svgH, plotX, plotY]
  );

  // ── Handlers de mouse ──────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const pos = eventToPx(e);
    if (!pos) { return; }
    const { px, py } = pos;
    if (drag) {
      setDrag((d) => d ? { ...d, currentPx: Math.max(0, Math.min(plotW, px)) } : d);
      return;
    }
    if (px < 0 || px > plotW || py < 0 || py > plotH) {
      setHover(null);
      return;
    }
    const ts = pxToTs(px);
    const points = seriesInfos.map((s) => {
      const vals = s.values.slice(-300);
      const idx = pxToDataIndex(px, vals.length);
      const raw = vals[idx] ?? 0;
      return { name: s.name, value: formatFieldValue(raw, s.field, theme).text, color: getSeriesColor(s) };
    });
    setHover({ px, py, points, ts });
  }, [drag, plotW, plotH, pxToTs, pxToDataIndex, seriesInfos, eventToPx, getSeriesColor]);

  const handleMouseLeave = useCallback(() => { setHover(null); setDrag(null); }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const pos = eventToPx(e);
    if (!pos || pos.px < 0 || pos.px > plotW || pos.py < 0 || pos.py > plotH) return;
    e.preventDefault();
    setDrag({ startPx: pos.px, currentPx: pos.px });
    setHover(null);
  }, [eventToPx, plotW, plotH]);

  const handleMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    const pos = eventToPx(e);
    const endPx = pos ? Math.max(0, Math.min(plotW, pos.px)) : drag.currentPx;
    const minPx = Math.min(drag.startPx, endPx);
    const maxPx = Math.max(drag.startPx, endPx);
    if (maxPx - minPx >= 8) {
      onChangeTimeRange({ from: Math.round(pxToTs(minPx)), to: Math.round(pxToTs(maxPx)) });
    }
    setDrag(null);
    setHover(null);
  }, [drag, plotW, pxToTs, onChangeTimeRange, eventToPx]);

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />;
  }

  const tooltipStyle: React.CSSProperties = hover && !drag ? { display: 'block', left: (plotX + hover.px + 14), top: (plotY + hover.py + 10), maxWidth: 172 } : { display: 'none' };
  const axisTextColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const axisLineColor = theme.isDark ? 'rgba(255,255,255,0.08)' : theme.colors.border.weak;
  const gridLineColor = theme.isDark ? 'rgba(255,255,255,0.07)' : theme.colors.border.weak;
  const dragSelX = drag ? Math.min(drag.startPx, drag.currentPx) : 0;
  const dragSelW = drag ? Math.abs(drag.currentPx - drag.startPx) : 0;
  const displayValueColor = options.valueFollowsThreshold && options.useThreshold && singleEffectiveColor !== baseColor ? singleEffectiveColor : undefined;

  return (
    <div className={cx(styles.card, css`width: ${width}px; height: ${height}px;`)}>
      <div ref={headerRef} className={styles.header}>
        {options.showIcon !== false && (
          <div className={styles.iconWrap} style={displayValueColor ? { color: displayValueColor, backgroundColor: `${displayValueColor}33` } : undefined}>
            <Icon name={resolveIconName(options.icon) as any} size="sm" />
          </div>
        )}
        {options.showLabel !== false && (
          <div className={styles.label} style={displayValueColor ? { color: displayValueColor } : undefined}>
            {options.label}
          </div>
        )}
        {!hasMultipleSeries && options.showValue !== false && (
          <span className={styles.value} style={displayValueColor ? { color: displayValueColor } : undefined}>
            {displayValue ?? '—'}
          </span>
        )}
      </div>

      {options.showPeriodSummary && periodSummaryInfos.length === 1 && (
        <div className={styles.periodSummary}>
          {options.showPeriodPeak && periodPeak !== null && <span className={styles.periodStat}>Pico {formatFieldValue(periodPeak, periodSummaryInfos[0].field, theme).text}</span>}
          {options.showPeriodMin && periodMin !== null && <span className={styles.periodStat}>Mínimo {formatFieldValue(periodMin, periodSummaryInfos[0].field, theme).text}</span>}
          {options.showPeriodAverage && periodAverage !== null && <span className={styles.periodStat}>Média {formatFieldValue(periodAverage, periodSummaryInfos[0].field, theme).text}</span>}
          {alertDurations.map((alert) => (
            <span key={alert.value} className={styles.periodStat} style={{ color: alert.color }}>
              ≥ {formatFieldValue(alert.value, periodSummaryInfos[0].field, theme).text}: {humanDuration(alert.durationMs, 'ms')}
            </span>
          ))}
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

            <svg
              ref={svgRef}
              className={styles.chartSvg}
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{ overflow: 'visible', cursor: drag ? 'ew-resize' : 'crosshair' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
            >
              {showYAxis && <line x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke={axisLineColor} strokeWidth={1} />}
              {yTicks.map((tick, i) => {
                const py = plotY + tick.y;
                const axisField = allSeriesInfos[0]?.field;
                const label = axisField ? formatFieldValue(tick.value, axisField, theme).text : String(tick.value);
                return (
                  <g key={`yt-${i}`}>
                    {(showGrid || showYAxis) && <line x1={plotX} y1={py} x2={plotX + plotW} y2={py} stroke={gridLineColor} strokeWidth={1} />}
                    {showYAxis && (
                      <>
                        <line x1={plotX - 4} y1={py} x2={plotX} y2={py} stroke={axisLineColor} strokeWidth={1} />
                        <text x={plotX - 7} y={py + 4} textAnchor="end" fill={axisTextColor} fontSize={11} fontFamily={theme.typography.fontFamily}>{label}</text>
                      </>
                    )}
                  </g>
                );
              })}
              <defs><clipPath id={`plot-clip-${id}`}><rect x={plotX} y={plotY} width={plotW} height={plotH} /></clipPath></defs>
              <g clipPath={`url(#plot-clip-${id})`}>
                {seriesInfos.map((s, si) => {
                  const vals = s.values;
                  const times = s.timeValues;
                  const { line, area } = buildChartPaths(vals, times, plotW, plotH, yLo, yHi, tStart, totalMs, lineInterpolation, barWidth);
                  const seriesColor = getSeriesColor(s);
                  return (
                    <g key={si} transform={`translate(${plotX}, ${plotY})`}>
                      <defs>
                        {chartType === 'area' && line && (
                          <linearGradient id={`fill-${id}-${si}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={plotH}>
                            <stop offset="0%" stopColor={seriesColor} stopOpacity={effectiveAreaOpacity} />
                            <stop offset="80%" stopColor={seriesColor} stopOpacity={effectiveAreaOpacity * 0.25} />
                            <stop offset="100%" stopColor={seriesColor} stopOpacity="0" />
                          </linearGradient>
                        )}
                        {lineGradient === 'opacity' && (
                          <linearGradient id={`stroke-${id}-${si}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={plotH}>
                            <stop offset="0%" stopColor={`color-mix(in srgb, ${seriesColor} 70%, black)`} stopOpacity={1} />
                            <stop offset="100%" stopColor={seriesColor} stopOpacity={0.1} />
                          </linearGradient>
                        )}
                        {lineGradient === 'fade' && (
                          <linearGradient id={`stroke-${id}-${si}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={plotW} y2="0">
                            <stop offset="0%" stopColor={seriesColor} stopOpacity={0.1} />
                            <stop offset="100%" stopColor={`color-mix(in srgb, ${seriesColor} 70%, black)`} stopOpacity={1} />
                          </linearGradient>
                        )}
                      </defs>
                      {chartType === 'area' && line && (
                        <path d={area} fill={`url(#fill-${id}-${si})`} />
                      )}
                      {line && (
                        <path 
                          d={line} 
                          fill="none" 
                          stroke={lineGradient === 'opacity' || lineGradient === 'fade' ? `url(#stroke-${id}-${si})` : seriesColor} 
                          strokeWidth={lineWidth} 
                          strokeDasharray={linePattern === 'dashed' ? '6 4' : undefined} 
                        />
                      )}
                      {showPoints && vals.map((value, index) => {
                        const x = (((times[index] ?? tStart) - tStart) / totalMs) * plotW;
                        const y = plotH - ((value - yLo) / (yHi - yLo || 1)) * plotH;
                        return <circle key={`p-${index}`} cx={x} cy={y} r={pointSize} fill={seriesColor} />;
                      })}
                    </g>
                  );
                })}
                {drag && dragSelW > 0 && <rect x={plotX + dragSelX} y={plotY} width={dragSelW} height={plotH} fill="rgba(130,180,255,0.15)" stroke="rgba(130,180,255,0.55)" strokeWidth={1} />}
              </g>
              {hover && !drag && (
                <>
                  <line x1={plotX + hover.px} y1={plotY} x2={plotX + hover.px} y2={plotY + plotH} stroke="rgba(255,255,255,0.28)" strokeWidth={1} strokeDasharray="4 3" />
                  {seriesInfos.map((s, si) => {
                    const vals = s.values;
                    const idx = pxToDataIndex(hover.px, vals.length);
                    const dotY = plotY + plotH - (((vals[idx] ?? 0) - yLo) / (yHi - yLo || 1)) * plotH;
                    return <circle key={`dot-${si}`} cx={plotX + hover.px} cy={dotY} r={4} fill={getSeriesColor(s)} stroke="#fff" strokeWidth={1.5} />;
                  })}
                </>
              )}
              {/* Estimativa de meia-largura do label para detectar overflow à direita */}
              {showXAxis && xTicks.map((tick, i) => {
                const px = plotX + tick.x;
                const py = plotY + plotH;
                // Largura estimada do label: ~6.5px por caractere, metade para verificar overflow
                const halfLabelW = (tick.label.length * 6.5) / 2;
                // Se o label transbordar à direita, pula — melhor não mostrar do que cortar
                if (tick.x + halfLabelW > plotW + 4) { return null; }
                // Se o label transbordar à esquerda (primeiro tick muito próximo da borda)
                if (tick.x - halfLabelW < -4) { return null; }
                return (
                  <g key={`xt-${i}`}>
                    <line x1={px} y1={py} x2={px} y2={py + 4} stroke={axisLineColor} strokeWidth={1} />
                    {showGrid && (
                      <line x1={px} y1={plotY} x2={px} y2={py} stroke={gridLineColor} strokeWidth={1} />
                    )}
                    <text x={px} y={py + 16} textAnchor="middle"
                      fill={axisTextColor} fontSize={11} fontFamily={theme.typography.fontFamily}>
                      {tick.label}
                    </text>
                  </g>
                );
              })}

              {/* ── Grade horizontal sem eixo Y ─── */}
              {showGrid && !showYAxis && yTicks.map((tick, i) => {
                const py = plotY + tick.y;
                return (
                  <line key={`grid-${i}`}
                    x1={plotX} y1={py} x2={plotX + plotW} y2={py}
                    stroke={gridLineColor} strokeWidth={1} />
                );
              })}
            </svg>
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
