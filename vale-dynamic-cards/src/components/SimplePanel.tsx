import React, { useMemo } from 'react';
import { PanelProps, Field, formattedValueToString, GrafanaTheme2, getDisplayProcessor, isIconName } from '@grafana/data';
import { SimpleOptions, CardTheme, MetricSource, CustomFieldConfig } from '../types';
import { bounded, listMetrics, selectMetrics, sourceKey } from '../metrics';
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

// ─── Estilos ───────────────────────────────────────────────────────────────
const getStyles = (theme: GrafanaTheme2, accent: string, options: SimpleOptions) => {
  const baseBg = theme.isDark ? '#0c101b' : theme.colors.background.primary;
  const borderColor = theme.isDark ? 'rgba(255,255,255,0.06)' : theme.colors.border.weak;
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
      background-image: linear-gradient(180deg, ${accent}12 0%, ${accent}02 100%);
      border: 1px solid ${borderColor};
      border-radius: ${bounded(options.borderRadius, 12, 0, 100)}px;
      padding: ${bounded(options.cardPadding, 16, 0, 100)}px;
      position: relative;
      
      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%);
        pointer-events: none;
        border-radius: inherit;
        z-index: 2;
      }
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
      background-image: linear-gradient(180deg, ${accent}12 0%, ${accent}02 100%);
      border: 1px solid ${borderColor};
      overflow: hidden;
      font-family: ${theme.typography.fontFamily};
      padding: ${bounded(options.cardPadding, 16, 0, 100)}px;
      justify-content: center;
      transition:
        background-color 0.2s ease,
        border-color 0.2s ease;

      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%);
        pointer-events: none;
        border-radius: inherit;
        z-index: 2;
      }
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
      background-color: ${theme.isDark ? '#0c101b' : theme.colors.background.primary};
      background-image: linear-gradient(180deg, ${accent}12 0%, ${accent}02 100%);
      border-radius: 12px;
      font-family: ${theme.typography.fontFamily};
      position: relative;
      
      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%);
        pointer-events: none;
        border-radius: 11px;
        z-index: 2;
      }
      
      /* Make sure children stay above the pseudo-element */
      > * {
        position: relative;
        z-index: 3;
      }
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
    `,
    metricCompactValue: css`
      color: ${valueTextColor};
      font-size: ${theme.typography.body.fontSize};
      font-weight: ${theme.typography.fontWeightBold};
      margin-top: 2px;
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
  const grouped = options.cardLayout === 'grouped';

  if (options.displayMode === 'nestedGroups') {
    return <NestedGroupPanel {...{ options, data, width, height, fieldConfig, id, replaceVariables } as any} />;
  }

  if (metrics.length === 0 && !statusBar) {
    return options.metricMode === 'configured' ? (
      <div role="status">Adicione métricas nas opções do painel.</div>
    ) : (
      <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />
    );
  }

  const resolveTemplate = (value?: string) => (value ? replaceVariables?.(value) ?? value : '');
  const resolveStatus = (source: MetricSource | undefined, label: string | undefined, healthyLabel: string, unhealthyLabel: string) => {
    const metric = availableMetrics.find((item) => sourceKey(item.source) === sourceKey(source));
    const raw = metric?.field.values.length ? metric.field.values[metric.field.values.length - 1] : undefined;
    const healthy = raw === undefined ? undefined : isHealthy(raw);
    const display = metric?.field ? formatFieldValue(raw, metric.field, theme) : undefined;
    const useThreshold = options.badgesFollowThreshold ?? false;
    const finalLabel = label || metric?.label || source?.fieldName || 'STATUS';
    const exceededColor = getExceededColor(metric?.field, display?.color, theme);
    
    return {
      label: finalLabel,
      text: healthy === undefined ? 'SEM DADOS' : display?.text || (healthy ? healthyLabel : unhealthyLabel),
      color: useThreshold && exceededColor ? exceededColor : accent,
    };
  };

  if (statusBar) {
    const title = resolveTemplate(options.headerTitle) || 'Resumo do host';
    const detailMetric = availableMetrics.find((item) => sourceKey(item.source) === sourceKey(options.headerDetailSource));
    const detailRaw = detailMetric?.field.values.length ? detailMetric.field.values[detailMetric.field.values.length - 1] : undefined;
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

    const fixedMetricsConfig = [
      { id: '1', source: options.statusBarMetric1Source, label: options.statusBarMetric1Label },
      { id: '2', source: options.statusBarMetric2Source, label: options.statusBarMetric2Label },
      { id: '3', source: options.statusBarMetric3Source, label: options.statusBarMetric3Label },
      { id: '4', source: options.statusBarMetric4Source, label: options.statusBarMetric4Label },
      { id: '5', source: options.statusBarMetric5Source, label: options.statusBarMetric5Label },
    ].filter((m) => m.source);


    // Ícone do host: usa as opções globais; com 'seguir threshold', acompanha a cor do primeiro indicador
    const hostIconName = resolveCardIconName(options.defaultIcon || 'server');
    const hostIconStyle = options.iconStyle || 'contained';
    const hostIconColor =
      options.iconFollowThreshold && statuses.length > 0 ? resolveColor(theme, statuses[0].color, accent) : accent;

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
              {statuses.length > 0 && (
                <div className={styles.statusGroup}>
                  {statuses.map((status) => (
                    <div
                      className={styles.health}
                      key={status.label}
                      style={{ 
                        backgroundColor: `${status.color}15`, 
                        color: status.color,
                        border: `1px solid ${status.color}40`
                      }}
                      title={status.label}
                    >
                      {status.label}: {status.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {subtitle && <div className={styles.identitySubtitle}>{subtitle}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', alignContent: 'center', gap: theme.spacing(5), flex: '0 1 auto', flexWrap: 'nowrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
          {fixedMetricsConfig.map((config) => {
            const metric = availableMetrics.find((item) => sourceKey(item.source) === sourceKey(config.source));
            const field = metric?.field;
            const lastValue = field && field.values.length ? field.values[field.values.length - 1] : null;
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
                <span className={styles.metricCompactLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {shouldShowIcon !== false && (
                    <span style={getIconContainerStyle(iconStyle, iconColor, 22, 6)}>
                      <Icon name={iconName} size="xs" />
                    </span>
                  )}
                  {label}
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

  // Um único item: layout horizontal dedicado
  const singleCard = metrics.length === 1;

  if (!singleCard) {
    const groupedFields: Record<string, import('@grafana/data').Field[]> = {};
    metrics.forEach(({ metric }) => {
      if (!metric || !metric.field) return;
      const field = metric.field;
      const groupKey = field.labels ? (field.labels['host'] || field.labels['name'] || field.labels['interface'] || field.name) : field.name;
      if (!groupedFields[groupKey]) {
        groupedFields[groupKey] = [];
      }
      groupedFields[groupKey].push(field);
    });

    return (
      <div style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '16px',
        padding: '8px',
        boxSizing: 'border-box'
      }}>
        {Object.entries(groupedFields).map(([groupName, groupFields], idx) => {
          // Determina a cor base do Macro-Card usando o primeiro field do grupo como referência principal
          const mainField = groupFields[0];
          const rawVal = mainField.values.length ? mainField.values[mainField.values.length - 1] : undefined;
          const displayResult = mainField.display ? mainField.display(rawVal) : { color: options.defaultColor || '#32D1A7' };
          
          let cardColor = options.defaultColor || '#32D1A7';
          if (displayResult.color) {
            try { cardColor = theme.visualization.getColorByName(displayResult.color); }
            catch (e) { cardColor = displayResult.color; }
          }

          return (
            <div key={idx} style={{
              backgroundColor: 'rgba(15, 23, 42, 0.4)', // Fundo escuro azulado estilo painel NOC
              border: `1px solid color-mix(in srgb, ${cardColor} 40%, transparent)`,
              boxShadow: `inset 0 0 20px color-mix(in srgb, ${cardColor} 10%, transparent)`,
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              {/* Header Base (Será refinado e estruturado no Passo 3.2) */}
              <div style={{ color: '#fff', fontSize: '16px', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                {groupName}
              </div>

              {/* Sub-métricas Base (Serão refinadas na malha de blocos no Passo 3.3) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                 {groupFields.map((f, i) => (
                   <div key={i} style={{ color: '#9CA3AF', fontSize: '12px' }}>{f.name}</div>
                 ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cx(
        grouped ? styles.containerGrouped : styles.container,
        css`
          width: ${width}px;
          height: ${height}px;
          box-sizing: border-box;
          overflow: hidden;
          padding: 0;
        `
      )}
    >
      {metrics.map(({ config, metric }) => {
        const field = metric?.field;
        const lastValue = field && field.values.length ? field.values[field.values.length - 1] : null;
        const display = field ? formatFieldValue(lastValue, field, theme) : { text: '—', color: undefined };
        const customCfg = field?.config.custom;
        const custom = (field?.config?.custom as CustomFieldConfig) || {};
        const fieldName = custom.label || config.label || metric?.label || config.source?.fieldName || 'Selecione um campo';
        const iconName = resolveCardIconName(custom.icon || config.icon || options.defaultIcon || 'server');
        const iconStyle = custom.iconStyle || options.iconStyle || 'contained';
        const iconFollowThreshold = custom.iconFollowThreshold === 'auto' || custom.iconFollowThreshold === undefined 
          ? (options.iconFollowThreshold ?? false)
          : custom.iconFollowThreshold;
        const horizontal = (config.horizontalAlign ?? options.horizontalAlign ?? 'left') as 'left' | 'center' | 'right';
        const vertical = (config.verticalAlign ?? options.verticalAlign ?? 'center') as 'top' | 'center' | 'bottom';
        const align = { left: 'flex-start', center: 'center', right: 'flex-end' }[horizontal];
        const justify = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[vertical];
        const badge = config.badgeMode === 'value' ? display.text : config.badgeMode === 'text' ? config.badgeText : '';

        const useThreshold = customCfg?.useThreshold ?? (options.useThreshold ?? false);
        const colorMode = customCfg?.colorMode ?? (options.colorMode ?? 'text');

        let bgColor = '';
        let borderColor = '';
        
        const exceededColor = getExceededColor(field, display.color, theme);
        const metricColor = exceededColor ? resolveColor(theme, exceededColor, accent) : accent;
        const textColor = metricColor;
        const iconColor = iconFollowThreshold ? metricColor : accent;

        if (useThreshold && colorMode === 'background' && exceededColor) {
          bgColor = `color-mix(in srgb, ${metricColor} 15%, transparent)`;
          borderColor = `color-mix(in srgb, ${metricColor} 40%, transparent)`;
        }

        const showCardIcon = (customCfg?.showIcon ?? config.showIcon ?? options.showIcon) !== false;

        // ── Card único: layout horizontal (ícone + título à esquerda, valor à direita) ──
        return (
          <div
              key={config.id}
              className={grouped ? styles.cardGrouped : styles.card}
              style={{
                backgroundColor: bgColor || undefined,
                borderColor: borderColor || undefined,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: '1 1 auto',
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                overflow: 'hidden',
                margin: 0,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                {showCardIcon && (
                  <div 
                    className={iconStyle === 'clean' ? styles.iconClean : styles.iconWrap} 
                    style={{ 
                      color: iconColor, 
                      backgroundColor: iconStyle === 'clean' ? 'transparent' : `color-mix(in srgb, ${iconColor} 20%, transparent)`,
                      border: iconStyle === 'clean' ? 'none' : `1px solid color-mix(in srgb, ${iconColor} 30%, transparent)`
                    }}
                  >
                    <Icon name={iconName} size={iconStyle === 'clean' ? 'lg' : 'sm'} />
                  </div>
                )}
                {options.showLabel !== false && (
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#D1D5DB',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    {fieldName}
                  </div>
                )}
              </div>
              
              {(options.showValue !== false || badge) && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    flexShrink: 0,
                    marginLeft: '16px',
                    zIndex: 3,
                  }}
                >
                  {options.showValue !== false && (
                    <span 
                      style={{ 
                        color: textColor, 
                        whiteSpace: 'nowrap',
                        fontSize: options.valueFontSize || '24px',
                        fontWeight: 700,
                      }}
                    >
                      {display.text ?? '—'}
                    </span>
                  )}
                  {badge && (
                    <span
                      style={{
                        marginTop: 6,
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: '1px solid currentColor',
                        color: metricColor,
                        maxWidth: '100%',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </div>
              )}
              {!metric && <span role="status">Campo indisponível</span>}
            </div>
        );
      })}
    </div>
  );
};
