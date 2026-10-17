import React, { useMemo } from 'react';
import { PanelProps, Field, formattedValueToString, GrafanaTheme2, getDisplayProcessor, isIconName } from '@grafana/data';
import { SimpleOptions, CardTheme, MetricSource, CustomFieldConfig } from '../types';
import { bounded, listMetrics, selectMetrics, matchMetric, getLastNonNullValue } from '../metrics';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, IconName, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';
import { NestedGroupPanel } from './NestedGroupPanel';




interface Props extends PanelProps<SimpleOptions> {}

// Verde industrial: cor padrão de todo o plugin quando nenhuma cor é configurada
const DEFAULT_COLOR = '#00B59B';

/** Resolve nomes de cor do Grafana (ex.: 'green', 'semi-dark-red') para um valor CSS utilizável. */
function resolveColor(theme: GrafanaTheme2, color: string | undefined, fallback: string = DEFAULT_COLOR): string {
  // Intercepta a cor legada que foi injetada no JSON do dashboard e atualiza automaticamente
  if (!color || color.toUpperCase() === '#32D1A7') {
    return fallback;
  }
  try {
    return theme.visualization.getColorByName(color);
  } catch (e) {
    return color;
  }
}

// ─── Resolução de ícones ───────────────────────────────────────────────────
// Alguns ícones do catálogo industrial não existem no conjunto do Grafana UI;
// estes aliases garantem um ícone visualmente equivalente em vez de um ícone quebrado.
const CARD_ICON_FALLBACKS: Record<string, IconName> = {
  server: 'database',
  hdd: 'save',
  wifi: 'signal',
  radio: 'rss',
};

function resolveCardIconName(icon: string): IconName {
  if (CARD_ICON_FALLBACKS[icon]) {
    return CARD_ICON_FALLBACKS[icon];
  }
  if (isIconName(icon)) {
    return icon;
  }
  return 'apps';
}

/**
 * Calcula dinamicamente o span de colunas no grid de 6 colunas (Grid Assimétrico).
 * Preenche 100% do espaço horizontal disponível da linha sem criar quebras indesejadas
 * e sem esticar a altura vertical.
 */
function getChildGridSpan(idx: number, total: number): number {
  if (idx < 2) {
    // Linha 1 (máximo 2 destaques)
    return total === 1 ? 6 : 3;
  }
  if (idx < 5) {
    // Linha 2 (itens 3, 4, 5 -> idx 2, 3, 4)
    const row2Count = Math.min(Math.max(total - 2, 0), 3);
    if (row2Count === 1) return 6; // Ocupa 100% da linha 2
    if (row2Count === 2) return 3; // Divide 50% / 50% na linha 2
    return 2;                      // Divide 33.3% cada (2 colunas * 3 = 6)
  }
  // Linha 3 (itens 6, 7, 8 -> idx 5, 6, 7)
  const row3Count = Math.min(Math.max(total - 5, 0), 3);
  if (row3Count === 1) return 6;   // Ocupa 100% da linha 3
  if (row3Count === 2) return 3;   // Divide 50% / 50% na linha 3
  return 2;                        // Divide 33.3% cada
}

/**
 * Estilo do contêiner do ícone, compartilhado entre Cards e Barra de status.
 * - contained: fundo vitrificado (glass) na mesma cor do ícone, em tom mais claro e translúcido.
 * - clean: sem fundo.
 */
function getIconContainerStyle(
  iconStyle: 'contained' | 'clean',
  color: string,
  size: number,
  radius: number
): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color,
  };

  if (iconStyle !== 'contained') {
    return { ...base, width: 'auto', height: 'auto', backgroundColor: 'transparent', border: 'none' };
  }

  return {
    ...base,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${radius}px`,
    backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
  };
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

/**
 * Formata o valor respeitando a configuração escolhida no painel.
 */
function formatFieldValue(raw: unknown, field: Field, theme: GrafanaTheme2): { text: string; color?: string } {
  const customCfg = (field.config?.custom ?? {}) as any;
  const unitToUse = customCfg.customUnit && customCfg.customUnit !== 'none' ? customCfg.customUnit : field.config.unit;
  const decimalsToUse =
    customCfg.customDecimals !== undefined && customCfg.customDecimals !== null
      ? customCfg.customDecimals
      : field.config.decimals;

  const overriddenField = {
    ...field,
    display: undefined,
    config: {
      ...field.config,
      unit: unitToUse,
      decimals: decimalsToUse,
    },
  };

  const displayProcessor = getDisplayProcessor({ field: overriddenField, theme });
  const display = displayProcessor(raw);
  return { text: formattedValueToString(display), color: display.color };
}

function getExceededColor(field: Field | undefined, displayColor: string | undefined, theme: GrafanaTheme2): string | undefined {
  if (!field || !displayColor) return undefined;
  const steps = field.config?.thresholds?.steps;
  if (!steps || steps.length === 0) return undefined;
  
  // O Grafana garante que o passo base é sempre o primeiro na configuração padrão
  const baseColor = steps[0]?.color;
  if (!baseColor) return displayColor;

  const resolvedDisplay = resolveColor(theme, displayColor, displayColor);
  const resolvedBase = resolveColor(theme, baseColor, baseColor);

  if (resolvedDisplay.toLowerCase() === resolvedBase.toLowerCase()) {
    return undefined; // Não ultrapassou (está no limiar seguro)
  }
  return displayColor;
}

function isHealthy(value: unknown): boolean {
  if (typeof value === 'number') {
    return value > 0;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'up', 'ok', 'active', 'ativo', 'healthy', 'online'].includes(normalized);
}

function getDynamicSubMetricStyle(text: string, sizeOption: string | undefined): React.CSSProperties {
  if (sizeOption === 'compact') return { fontSize: '11px', lineHeight: 1.1, wordBreak: 'break-word' };
  if (sizeOption === 'medium') return { fontSize: '13px', lineHeight: 1.15, wordBreak: 'break-word' };
  if (sizeOption === 'large') return { fontSize: '16px', lineHeight: 1.2, wordBreak: 'break-word' };
  
  // auto
  const len = (text || '').length;
  if (len > 10) return { fontSize: '11px', lineHeight: 1.05, wordBreak: 'break-word' };
  if (len >= 6) return { fontSize: '13px', lineHeight: 1.1, wordBreak: 'break-word' };
  return { fontSize: '16px', lineHeight: 1.2, fontWeight: 'bold', wordBreak: 'break-word' };
}

/**
 * Tipografia adaptativa para rótulos dos sub-cards e métricas da barra de status.
 * Reduz a fonte conforme o comprimento do texto para evitar corte precoce.
 */
function getAdaptiveLabelStyle(label: string, baseFontSize = 10.5): React.CSSProperties {
  const len = (label || '').length;
  if (len <= 15) {
    return { fontSize: `${baseFontSize}px` };
  }
  if (len <= 23) {
    return { fontSize: '9.5px', letterSpacing: '-0.01em' };
  }
  return { fontSize: '8.8px', letterSpacing: '-0.015em' };
}

// ─── Estilos ───────────────────────────────────────────────────────────────
const getStyles = (theme: GrafanaTheme2, accent: string, options: SimpleOptions) => {
  const baseBg = theme.isDark ? '#0c141d' : theme.colors.background.primary;
  const cardGradient = theme.isDark
    ? 'linear-gradient(180deg, #0d1720 0%, #0c141d 55%, #0b121a 100%)'
    : 'none';
  const borderColor = theme.isDark ? 'rgba(255, 255, 255, 0.06)' : theme.colors.border.weak;
  const labelColor = theme.isDark ? 'rgba(255,255,255,0.55)' : theme.colors.text.secondary;
  const valueTextColor = theme.isDark ? '#f4f6fb' : theme.colors.text.primary;

  const isVertical = options.layoutOrientation === 'vertical';
  // Aceita tanto '26' quanto '26px' (o padrão do painel já inclui a unidade)
  const rawFontSize = String(options.valueFontSize ?? '26');
  const valueFontSize = rawFontSize.trim() !== '' && !isNaN(Number(rawFontSize)) ? `${rawFontSize}px` : rawFontSize;

  return {
    container: css`
      display: flex;
      flex-direction: ${isVertical ? 'column' : 'row'};
      flex-wrap: ${isVertical ? 'nowrap' : 'wrap'};
      gap: ${bounded(options.gap, 16, 0, 100)}px;
      box-sizing: border-box;
      overflow-x: auto;
      overflow-y: auto;
      align-items: stretch;
      justify-content: flex-start;
      padding: 8px;
    `,
    containerGrouped: css`
      display: flex;
      flex-direction: ${isVertical ? 'column' : 'row'};
      flex-wrap: ${isVertical ? 'nowrap' : 'wrap'};
      gap: ${bounded(options.gap, 16, 0, 100)}px;
      box-sizing: border-box;
      overflow-x: auto;
      overflow-y: auto;
      align-items: stretch;
      justify-content: flex-start;
      background-color: ${baseBg};
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      border-radius: ${bounded(options.borderRadius, 12, 0, 100)}px;
      padding: ${bounded(options.cardPadding, 16, 0, 100)}px;
      position: relative;
    `,
    card: css`
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1 1 ${isVertical ? 'auto' : '300px'};
      min-width: min(100%, ${bounded(options.minCardWidth, 250, 80, 1000)}px);
      box-sizing: border-box;
      border-radius: ${bounded(options.borderRadius, 12, 0, 100)}px;
      background-color: ${baseBg};
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};
      padding: ${bounded(options.cardPadding, 16, 0, 100)}px;
      justify-content: center;
      transition:
        background-color 0.2s ease,
        border-color 0.2s ease;
    `,
    cardGrouped: css`
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1 1 ${isVertical ? 'auto' : '300px'};
      min-width: min(100%, ${bounded(options.minCardWidth, 250, 80, 1000)}px);
      box-sizing: border-box;
      background-color: transparent;
      border: none;
      font-family: ${theme.typography.fontFamily};
      justify-content: center;
      z-index: 3;
    `,
    textEllipsis: css`
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
      width: 100%;
    `,
    header: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      z-index: 3;
      margin-bottom: ${options.showValue ? theme.spacing(1.5) : 0};
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
    iconWrapStatusBar: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      flex-shrink: 0;
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
    valueWrap: css`
      display: flex;
      align-items: baseline;
      z-index: 3;
    `,
    value: css`
      font-size: ${valueFontSize};
      font-weight: ${theme.typography.fontWeightBold};
      color: ${valueTextColor};
      line-height: 1.1;
      letter-spacing: -0.02em;
      word-break: break-word;
    `,
    statusBar: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${theme.spacing(3)};
      width: 100%;
      height: 100%;
      min-height: 76px;
      box-sizing: border-box;
      overflow: hidden;
      padding: ${theme.spacing(1.5)} ${theme.spacing(2)};
      background-color: ${baseBg};
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      font-family: ${theme.typography.fontFamily};
      position: relative;
    `,
    identity: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1.5)};
      min-width: 210px;
      flex: 0 0 auto;
    `,
    identityText: css`
      min-width: 0;
    `,
    identityTitleRow: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
    `,
    identityTitle: css`
      color: ${valueTextColor};
      font-weight: ${theme.typography.fontWeightBold};
      font-size: ${theme.typography.h5.fontSize};
      line-height: 1.2;
      white-space: nowrap;
    `,
    identitySubtitle: css`
      color: ${labelColor};
      font-size: ${theme.typography.bodySmall.fontSize};
      margin-top: 2px;
      white-space: nowrap;
    `,
    statusGroup: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      flex: 0 0 auto;
      flex-wrap: wrap;
    `,
    health: css`
      display: flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 6px;
      color: #fff;
      font-size: 11px;
      font-weight: ${theme.typography.fontWeightMedium};
      white-space: nowrap;
    `,
    metricCompact: css`
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 78px;
      padding: ${theme.spacing(0.5)} 0;
      white-space: nowrap;
    `,
    metricCompactLabel: css`
      color: ${labelColor};
      font-size: 10px;
      font-weight: ${theme.typography.fontWeightMedium};
      letter-spacing: 0.04em;
      text-transform: uppercase;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-sizing: border-box;
    `,
    metricCompactValue: css`
      color: ${valueTextColor};
      font-size: ${theme.typography.body.fontSize};
      font-weight: ${theme.typography.fontWeightBold};
      margin-top: 2px;
    `,
    avoContainer: css`
      flex-grow: 1;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      background-color: ${baseBg};
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      padding: ${theme.spacing(1)} ${theme.spacing(1.5)};
      position: relative;
    `,
    avoContainerSingle: css`
      flex-grow: 1;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      background: transparent;
      padding: 0;
      position: relative;
      border: none;
    `,
    avoHeader: css`
      color: ${labelColor};
      font-weight: ${theme.typography.fontWeightBold};
      font-size: ${theme.typography.bodySmall.fontSize};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: ${theme.spacing(1)};
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
    `,
    gridPais: css`
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
      gap: ${theme.spacing(1)};
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow-y: auto;
      overflow-x: hidden;
      background-color: transparent;
      align-content: start;
      align-items: stretch;
      justify-items: stretch;
    `,
    gridPaisSingle: css`
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
      background-color: transparent;
      align-items: stretch;
      justify-items: stretch;
    `,
    paiCard: css`
      position: relative;
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      padding: ${theme.spacing(1)};
      background-color: ${baseBg};
      background-image: ${cardGradient};
      border: 1px solid ${borderColor};
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};
      gap: ${theme.spacing(0.5)};
      transition: all 0.3s ease;
      outline: none !important;
    `,
    paiHeader: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      z-index: 3;
    `,
    paiTitleWrap: css`
      display: flex;
      flex-direction: row;
      align-items: baseline;
      gap: ${theme.spacing(1)};
      flex: 1;
      min-width: 0;
    `,
    paiTitle: css`
      color: ${valueTextColor};
      font-size: ${theme.typography.body.fontSize};
      font-weight: ${theme.typography.fontWeightBold};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,
    paiSubtitle: css`
      color: ${labelColor};
      font-size: ${theme.typography.bodySmall.fontSize};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,
    paiStatusBadge: css`
      display: flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: ${theme.typography.fontWeightBold};
      text-transform: uppercase;
      flex-shrink: 0;
      z-index: 3;
    `,
    filhosGrid: css`
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
      margin-top: 6px;
      align-content: start;
      width: 100%;
    `,
    filhosGridSingle: css`
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      width: 100%;
      height: 100%;
      margin-top: 0;
    `,
    filhoCard: css`
      display: flex;
      flex-direction: column;
      justify-content: center;
      background-color: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      padding: ${theme.spacing(0.75)};
      overflow: hidden;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      z-index: 3;
      height: 52px;
      max-height: 52px;
      min-height: 52px;
    `,
    filhoCardSingle: css`
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      background-color: transparent;
      border-radius: 0;
      padding: 0;
      min-height: 0;
      height: 100%;
      width: 100%;
      overflow: hidden;
      z-index: 3;
    `,
    filhoDestaque: css`
      grid-column: span 3;
    `,
    filhoNormal: css`
      grid-column: span 2;
    `,
    filhoLabel: css`
      color: ${labelColor};
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      display: block;
    `,
    filhoValueDestaque: css`
      color: ${valueTextColor};
      font-size: 18px;
      font-weight: ${theme.typography.fontWeightBold};
      margin-top: 2px;
      line-height: 1.2;
    `,
    filhoValueNormal: css`
      color: ${valueTextColor};
      font-weight: ${theme.typography.fontWeightBold};
      margin-top: 0px;
    `,
    filhoValueSingle: css`
      color: ${valueTextColor};
      font-size: 24px;
      font-weight: ${theme.typography.fontWeightBold};
      margin-top: 2px;
      line-height: 1.1;
    `,
    horizontalGrid: css`
      display: flex;
      flex-wrap: nowrap;
      gap: 6px;
      align-items: stretch;
      overflow: hidden;
      height: 100%;
      margin-top: 8px;
      flex-grow: 1;
    `,
    horizontalChild: css`
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      container-type: inline-size;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      background-color: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      padding: ${theme.spacing(1)};
      z-index: 3;
      height: 52px;
      max-height: 52px;
      min-height: 52px;
      box-sizing: border-box;
    `,
    horizontalLabel: css`
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
      text-align: left;
      color: ${labelColor};
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      display: block;
      width: 100%;
    `,
    horizontalValue: css`
      font-weight: bold;
      text-align: left;
      width: 100%;
    `,
  };
};

// ─── Componente principal ──────────────────────────────────────────────────
export const SimplePanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id, replaceVariables }) => {
  const theme = useTheme2();
  const accent = resolveColor(theme, options.defaultColor);
  const styles = useStyles2((t) => getStyles(t, accent, options));

  const statusBar = options.viewMode === 'status_bar' || options.displayMode === 'statusBar';
  const metrics = useMemo(
    () => selectMetrics(data.series, statusBar ? { ...options, metricMode: 'configured' } : options),
    [data.series, options, statusBar]
  );
  const availableMetrics = useMemo(() => listMetrics(data.series), [data.series]);

  if (options.displayMode === 'nestedGroups') {
    return <NestedGroupPanel {...{ options, data, width, height, fieldConfig, id, replaceVariables } as any} />;
  }

  if (metrics.length === 0 && !statusBar && options.viewMode !== 'macro_cards' && (options.viewMode as string) !== 'card') {
    return options.metricMode === 'configured' ? (
      <div role="status">Adicione métricas nas opções do painel.</div>
    ) : (
      <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />
    );
  }

  const resolveTemplate = (value?: string) => (value ? replaceVariables?.(value) ?? value : '');
  const resolveStatus = (source: MetricSource | undefined, label: string | undefined, healthyLabel: string, unhealthyLabel: string) => {
    const metric = matchMetric(availableMetrics, source);
    const noDataColor = theme.isDark ? '#8e96a5' : '#6e7687';

    if (!metric?.field) {
      return {
        label: label || source?.fieldName || 'STATUS',
        text: 'SEM DADOS',
        color: noDataColor,
      };
    }

    const raw = getLastNonNullValue(metric.field);
    const healthy = raw === undefined ? undefined : isHealthy(raw);

    if (healthy === undefined) {
      return {
        label: label || metric.label || source?.fieldName || 'STATUS',
        text: 'SEM DADOS',
        color: noDataColor,
      };
    }

    const display = formatFieldValue(raw, metric.field, theme);
    const exceededColor = getExceededColor(metric.field, display.color, theme);
    const statusColor = exceededColor || (display.color ? resolveColor(theme, display.color, accent) : accent);
    const finalLabel = label || metric.label || source?.fieldName || 'STATUS';

    return {
      label: finalLabel,
      text: display.text || (healthy ? healthyLabel : unhealthyLabel),
      color: statusColor,
    };
  };

  const extractMetricDisplay = (source: MetricSource | undefined) => {
    if (!source) return { text: '-', color: undefined };
    const metric = matchMetric(availableMetrics, source);
    if (!metric?.field) return { text: '-', color: undefined };
    
    const raw = getLastNonNullValue(metric.field);
    if (raw === undefined || raw === null) return { text: 'N/A', color: undefined };
    
    const display = formatFieldValue(raw, metric.field, theme);
    const exceededColor = getExceededColor(metric.field, display.color, theme);
    
    return {
      text: display.text,
      color: exceededColor,
    };
  };

  const macroCardsConfig = useMemo(() => {
    if (options.viewMode !== 'macro_cards' && (options.viewMode as string) !== 'card') return [];
    
    const limit = 5;
    const count = Math.min(Math.max(options.macroCardsCount || 1, 1), limit);
    
    const cards = [];
    for (let i = 1; i <= count; i++) {
      const title = options[`mc${i}_title`] || `Card Pai ${i}`;
      const subtitle = options[`mc${i}_subtitle`] || '';
      const icon = options[`mc${i}_icon`] || 'server';
      const iconStyle = options[`mc${i}_iconStyle`] || 'contained';
      
      const source = options[`mc${i}_statusSource`] as MetricSource | undefined;
      const metric = matchMetric(availableMetrics, source);
      
      const noDataColor = theme.isDark ? '#8e96a5' : '#6e7687';
      let statusColor = accent;
      let statusText = 'SEM DADOS';
      let hasViolation = false;
      
      if (metric?.field) {
        const raw = getLastNonNullValue(metric.field);
        const healthy = raw === undefined ? undefined : isHealthy(raw);
        
        if (healthy === undefined) {
          statusColor = noDataColor;
          statusText = 'SEM DADOS';
        } else {
          const display = formatFieldValue(raw, metric.field, theme);
          const exceededColor = getExceededColor(metric.field, display.color, theme);
          statusColor = exceededColor || accent;
          statusText = display.text || (healthy ? 'NORMAL' : 'ALERTA');
          hasViolation = exceededColor !== undefined || healthy === false;
        }
      } else {
        statusColor = noDataColor;
        statusText = 'SEM DADOS';
      }

      const children = [];
      const layoutType = options[`mc${i}_layoutType`] || 'grid';
      const maxCount = options[`mc${i}_childrenCount`] ?? 5;
      const childrenCount = layoutType === 'horizontal' ? Math.min(maxCount, 4) : maxCount;
      
      for (let j = 1; j <= childrenCount; j++) {
        const childLabel = options[`mc${i}_child${j}_label`];
        const childSource = options[`mc${i}_child${j}_source`];
        
        const displayData = extractMetricDisplay(childSource as MetricSource | undefined);
        const childMetric = matchMetric(availableMetrics, childSource as MetricSource | undefined);
        let defaultLabel = childMetric?.label || (childSource as MetricSource | undefined)?.fieldName || 'Sem Nome';
        if (defaultLabel.toLowerCase() === 'value' || defaultLabel.toLowerCase() === 'valor') {
          defaultLabel = childMetric?.frame?.name || (childSource as MetricSource | undefined)?.frameName || defaultLabel;
        }
        const finalLabel = childLabel || defaultLabel;
        
        children.push({
          id: j,
          label: replaceVariables ? replaceVariables(finalLabel) : finalLabel,
          source: childSource,
          hasConfig: !!(childLabel || childSource),
          displayValue: displayData.text,
          thresholdColor: displayData.color,
        });
      }

      cards.push({
        id: i,
        title: replaceVariables ? replaceVariables(title) : title,
        subtitle: replaceVariables ? replaceVariables(subtitle) : subtitle,
        icon: resolveCardIconName(icon),
        iconStyle,
        statusColor,
        statusText,
        hasViolation,
        layoutType,
        children,
      });
    }
    return cards;
  }, [options, replaceVariables, availableMetrics, theme]);

  if (options.viewMode === 'macro_cards' || (options.viewMode as string) === 'card') {
    const isSingleCardPanel = (options.macroCardsCount || 1) === 1;
    const parentThresholdTarget = options.parentThresholdTarget || 'both';
    const childThresholdTarget = options.childThresholdTarget || 'value';

    return (
      <div 
        className={isSingleCardPanel ? styles.avoContainerSingle : styles.avoContainer} 
        style={{ width, height }}
      >
        <div className={isSingleCardPanel ? styles.gridPaisSingle : styles.gridPais}>
          {macroCardsConfig.map((card) => {
            const hasParentViolation = card.hasViolation;
            const applyParentBg = (parentThresholdTarget === 'background' || parentThresholdTarget === 'both') && hasParentViolation;
            const applyParentIcon = parentThresholdTarget === 'icon' || parentThresholdTarget === 'both';
            
            const parentBgColor = card.statusColor;
            const parentIconColor = applyParentIcon ? card.statusColor : accent;
            
            const configuredChildren = card.children.filter((c) => c.hasConfig).length;
            const isSingleChild = configuredChildren === 1 || card.children.length === 1;
            const hasHeader = options.showParentHeader !== false;

            return (
              <div
                key={card.id}
                className={styles.paiCard}
                style={{
                  padding: !hasHeader && isSingleChild ? '6px 10px' : isSingleChild ? '8px 10px' : hasHeader ? '10px 12px' : '8px 10px',
                  gap: hasHeader ? '6px' : '0px',
                  height: '100%',
                  justifyContent: !hasHeader && isSingleChild ? 'center' : 'flex-start',
                  boxSizing: 'border-box',
                  ...(applyParentBg ? {
                    backgroundColor: `color-mix(in srgb, ${parentBgColor} 8%, transparent)`,
                    boxShadow: `inset 0 0 10px color-mix(in srgb, ${parentBgColor} 15%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${parentBgColor} 20%, transparent)`,
                    backgroundImage: 'none',
                  } : {})
                }}
              >
                {hasHeader && (
                  <div className={styles.paiHeader}>
                    <div style={getIconContainerStyle(card.iconStyle, parentIconColor, 28, 6)}>
                      <Icon name={card.icon} size={card.iconStyle === 'clean' ? 'md' : 'sm'} />
                    </div>
                    <div className={styles.paiTitleWrap}>
                      <div className={cx(styles.paiTitle, styles.textEllipsis)}>{card.title}</div>
                      {card.subtitle && <div className={cx(styles.paiSubtitle, styles.textEllipsis)}>{card.subtitle}</div>}
                    </div>
                    <div
                      className={styles.paiStatusBadge}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${card.statusColor} 15%, transparent)`,
                        color: card.statusColor,
                        border: `1px solid color-mix(in srgb, ${card.statusColor} 40%, transparent)`,
                      }}
                    >
                      {card.statusText}
                    </div>
                  </div>
                )}

                {card.layoutType === 'horizontal' ? (
                  <div className={styles.horizontalGrid} style={{ marginTop: hasHeader ? '6px' : '0px' }}>
                    {card.children.map((child) => {
                      if (!child.hasConfig) {
                        return <div key={child.id} className={styles.horizontalChild} />;
                      }

                      const hasChildViolation = Boolean(child.thresholdColor);
                      const applyChildBg = childThresholdTarget === 'background' || childThresholdTarget === 'both';
                      const applyChildValue = childThresholdTarget === 'value' || childThresholdTarget === 'both';

                      const baseValueColor = theme.isDark ? '#f4f6fb' : theme.colors.text.primary;
                      const childValueColor = applyChildValue ? (child.thresholdColor || baseValueColor) : baseValueColor;
                      
                      const typoStyle = getDynamicSubMetricStyle(child.displayValue, options.subMetricFontSize);

                      const childBgStyle: React.CSSProperties = (applyChildBg && hasChildViolation)
                        ? {
                            backgroundColor: `color-mix(in srgb, ${child.thresholdColor} 8%, transparent)`,
                            boxShadow: `inset 0 0 10px color-mix(in srgb, ${child.thresholdColor} 15%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${child.thresholdColor} 20%, transparent)`,
                          }
                        : {
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.04)',
                          };

                      return (
                        <div 
                          key={child.id} 
                          className={styles.horizontalChild}
                          style={childBgStyle}
                        >
                          <div 
                            className={styles.horizontalLabel} 
                            style={getAdaptiveLabelStyle(child.label)}
                            title={child.label}
                          >
                            {child.label}
                          </div>
                          <div 
                            className={styles.horizontalValue}
                            style={{ color: childValueColor, ...typoStyle }}
                          >
                            {child.displayValue}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : isSingleChild && !hasHeader ? (
                  <div className={styles.filhosGridSingle}>
                    {card.children.map((child) => {
                      const hasChildViolation = Boolean(child.thresholdColor);
                      const applyChildBg = childThresholdTarget === 'background' || childThresholdTarget === 'both';
                      const applyChildValue = childThresholdTarget === 'value' || childThresholdTarget === 'both';

                      const baseValueColor = theme.isDark ? '#f4f6fb' : theme.colors.text.primary;
                      const childValueColor = applyChildValue ? (child.thresholdColor || baseValueColor) : baseValueColor;

                      const childBgStyle: React.CSSProperties = (applyChildBg && hasChildViolation)
                        ? {
                            backgroundColor: `color-mix(in srgb, ${child.thresholdColor} 8%, transparent)`,
                            boxShadow: `inset 0 0 10px color-mix(in srgb, ${child.thresholdColor} 15%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${child.thresholdColor} 20%, transparent)`,
                            borderRadius: '6px',
                            padding: '6px 10px',
                          }
                        : {};

                      return (
                        <div 
                          key={child.id} 
                          className={styles.filhoCardSingle}
                          style={childBgStyle}
                        >
                          <div 
                            className={cx(styles.filhoLabel, styles.textEllipsis)} 
                            style={getAdaptiveLabelStyle(child.label)}
                            title={child.label}
                          >
                            {child.label}
                          </div>
                          <div 
                            className={styles.filhoValueSingle}
                            style={{ color: childValueColor }}
                          >
                            {child.displayValue}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.filhosGrid} style={{ marginTop: hasHeader ? '6px' : '0px' }}>
                    {card.children.map((child, idx) => {
                      const span = getChildGridSpan(idx, card.children.length);
                      const isDestaque = idx < 2 || span >= 3;
                      const cardStyle = cx(styles.filhoCard, css`grid-column: span ${span};`);

                      if (!child.hasConfig) {
                        return <div key={child.id} className={cardStyle} />;
                      }

                      const hasChildViolation = Boolean(child.thresholdColor);
                      const applyChildBg = childThresholdTarget === 'background' || childThresholdTarget === 'both';
                      const applyChildValue = childThresholdTarget === 'value' || childThresholdTarget === 'both';

                      const baseValueColor = theme.isDark ? '#f4f6fb' : theme.colors.text.primary;
                      const childValueColor = applyChildValue ? (child.thresholdColor || baseValueColor) : baseValueColor;
                      
                      const typoStyle = getDynamicSubMetricStyle(child.displayValue, options.subMetricFontSize);

                      const childBgStyle: React.CSSProperties = (applyChildBg && hasChildViolation)
                        ? {
                            backgroundColor: `color-mix(in srgb, ${child.thresholdColor} 8%, transparent)`,
                            boxShadow: `inset 0 0 10px color-mix(in srgb, ${child.thresholdColor} 15%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${child.thresholdColor} 20%, transparent)`,
                          }
                        : {
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.04)',
                          };

                      return (
                        <div 
                          key={child.id} 
                          className={cardStyle}
                          style={childBgStyle}
                        >
                          <div 
                            className={cx(styles.filhoLabel, styles.textEllipsis)} 
                            style={getAdaptiveLabelStyle(child.label)}
                            title={child.label}
                          >
                            {child.label}
                          </div>
                          <div 
                            className={isDestaque ? styles.filhoValueDestaque : styles.filhoValueNormal}
                            style={isDestaque ? { color: childValueColor } : { color: childValueColor, ...typoStyle }}
                          >
                            {child.displayValue}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (statusBar) {
    const title = resolveTemplate(options.headerTitle) || 'Resumo do host';
    const detailMetric = matchMetric(availableMetrics, options.headerDetailSource);
    const detailRaw = getLastNonNullValue(detailMetric?.field);
    const subtitle = detailMetric?.field ? formatFieldValue(detailRaw, detailMetric.field, theme).text : '';

    const statuses: Array<ReturnType<typeof resolveStatus>> = [];
    if (options.indicator1Source) {
      statuses.push(resolveStatus(options.indicator1Source, options.indicator1Label, 'UP', 'DOWN'));
    }
    if (options.indicator2Source) {
      statuses.push(resolveStatus(options.indicator2Source, options.indicator2Label, 'UP', 'DOWN'));
    }

    // Compatibilidade com legacy (caso a pessoa não tenha atualizado ainda)
    if (!options.indicator1Source && !options.indicator2Source) {
      if (options.statusSource) {
        statuses.push(resolveStatus(options.statusSource, options.statusLabel || 'STATUS 1', 'UP', 'DOWN'));
      }
      if (options.agentSource) {
        statuses.push(resolveStatus(options.agentSource, options.agentLabel || 'STATUS 2', 'ATIVO', 'INATIVO'));
      }
    }

    // Slot dedicado de Uptime / Downtime
    let uptimeBadge: { label: string; text: string; color: string } | null = null;
    if (options.statusBar_uptimeMetric) {
      const uptimeSource: MetricSource | undefined =
        typeof options.statusBar_uptimeMetric === 'string'
          ? { fieldName: options.statusBar_uptimeMetric, frameOccurrence: 0, fieldOccurrence: 0 }
          : options.statusBar_uptimeMetric;
      const metric = matchMetric(availableMetrics, uptimeSource);
      const raw = getLastNonNullValue(metric?.field);
      const configuredLabel = resolveTemplate(options.statusBar_uptimeLabel) || options.statusBar_uptimeLabel;
      const finalLabel = configuredLabel || metric?.label || uptimeSource?.fieldName || 'UPTIME';
      const noDataColor = theme.isDark ? '#8e96a5' : '#6e7687';

      if (raw === undefined || raw === null || !metric?.field) {
        uptimeBadge = {
          label: finalLabel,
          text: 'SEM DADOS',
          color: noDataColor,
        };
      } else {
        const display = formatFieldValue(raw, metric.field, theme);
        const exceededColor = getExceededColor(metric.field, display.color, theme);
        const useThreshold = options.badgesFollowThreshold ?? false;
        const finalColor = useThreshold && exceededColor ? exceededColor : (display.color ? resolveColor(theme, display.color, accent) : accent);

        uptimeBadge = {
          label: finalLabel,
          text: display.text,
          color: finalColor,
        };
      }
    }

    const fixedMetricsConfig = [
      { id: '1', source: options.statusBarMetric1Source, label: options.statusBarMetric1Label },
      { id: '2', source: options.statusBarMetric2Source, label: options.statusBarMetric2Label },
      { id: '3', source: options.statusBarMetric3Source, label: options.statusBarMetric3Label },
      { id: '4', source: options.statusBarMetric4Source, label: options.statusBarMetric4Label },
      { id: '5', source: options.statusBarMetric5Source, label: options.statusBarMetric5Label },
    ].filter((m) => m.source);

    // Ícone do host: sempre acompanha a cor do primeiro indicador de status (ex: ICMP Ping)
    const hostIconName = resolveCardIconName(options.defaultIcon || 'server');
    const hostIconStyle = options.iconStyle || 'contained';
    const hostIconColor = statuses.length > 0 ? resolveColor(theme, statuses[0].color, accent) : accent;

    return (
      <div className={styles.statusBar} style={{ width, height, flexWrap: 'nowrap' }}>
        <div className={styles.identity}>
          {options.showIcon !== false && (
            <div className={styles.iconWrapStatusBar} style={getIconContainerStyle(hostIconStyle, hostIconColor, 44, 10)}>
              <Icon name={hostIconName} size="xl" />
            </div>
          )}
          <div className={styles.identityText}>
            <div className={styles.identityTitleRow}>
              <div className={styles.identityTitle}>{title}</div>
              {(statuses.length > 0 || uptimeBadge) && (
                <div className={styles.statusGroup}>
                  {statuses.map((status) => (
                    <div
                      className={styles.health}
                      key={status.label}
                      style={{ 
                        backgroundColor: `color-mix(in srgb, ${status.color} 15%, transparent)`, 
                        color: status.color,
                        border: `1px solid color-mix(in srgb, ${status.color} 40%, transparent)`
                      }}
                      title={status.label}
                    >
                      {status.label}: {status.text}
                    </div>
                  ))}
                  {uptimeBadge && (
                    <div
                      className={styles.health}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${uptimeBadge.color} 15%, transparent)`,
                        color: uptimeBadge.color,
                        border: `1px solid color-mix(in srgb, ${uptimeBadge.color} 40%, transparent)`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title={uptimeBadge.label}
                    >
                      <Icon name={isIconName('clock-nine') ? 'clock-nine' : (isIconName('history') ? 'history' : 'info-circle')} size="xs" />
                      <span>{uptimeBadge.label}: {uptimeBadge.text}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {subtitle && <div className={styles.identitySubtitle}>{subtitle}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', alignContent: 'center', gap: theme.spacing(5), flex: '0 1 auto', flexWrap: 'nowrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
          {fixedMetricsConfig.map((config) => {
            const metric = matchMetric(availableMetrics, config.source);
            const field = metric?.field;
            const lastValue = getLastNonNullValue(field);
            const display = field ? formatFieldValue(lastValue, field, theme) : { text: '—', color: undefined };
            const label = config.label || metric?.label || config.source?.fieldName || 'Métrica';
            const customCfg = (field?.config?.custom as CustomFieldConfig) || {};
            const useThreshold = options.metricsFollowThreshold ?? false;
            const shouldShowIcon = customCfg?.showIcon ?? options.showIcon ?? true;
            const iconName = resolveCardIconName(customCfg.icon || options.defaultIcon || 'server');
            const iconStyle = customCfg.iconStyle || options.iconStyle || 'contained';
            const iconFollowThreshold = customCfg.iconFollowThreshold === 'auto' || customCfg.iconFollowThreshold === undefined 
              ? (options.iconFollowThreshold ?? false) 
              : customCfg.iconFollowThreshold;
            
            const exceededColor = getExceededColor(field, display.color, theme);
            const iconColor = iconFollowThreshold && exceededColor ? resolveColor(theme, exceededColor, accent) : accent;
            return (
              <div className={styles.metricCompact} key={config.id}>
                <span 
                  className={styles.metricCompactLabel} 
                  style={{ display: 'flex', alignItems: 'center', gap: 6, ...getAdaptiveLabelStyle(label, 10) }}
                  title={label}
                >
                  {shouldShowIcon !== false && (
                    <span style={getIconContainerStyle(iconStyle, iconColor, 22, 6)}>
                      <Icon name={iconName} size="xs" />
                    </span>
                  )}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                </span>
                <span className={styles.metricCompactValue} style={{ color: useThreshold && exceededColor ? exceededColor : undefined }}>
                  {display.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};
