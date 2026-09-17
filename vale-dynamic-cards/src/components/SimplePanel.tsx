import React, { useMemo } from 'react';
import { PanelProps, Field, formattedValueToString, GrafanaTheme2, getDisplayProcessor } from '@grafana/data';
import { SimpleOptions, CardTheme, MetricSource } from '../types';
import { bounded, listMetrics, selectMetrics, sourceKey } from '../metrics';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';

interface Props extends PanelProps<SimpleOptions> {}

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

function resolveIconName(icon?: string): string {
  if (!icon) {return 'apps';}
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
    card: css`
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1 1 ${isVertical ? 'auto' : '300px'};
      min-width: min(100%, ${bounded(options.minCardWidth, 250, 80, 1000)}px);
      box-sizing: border-box;
      border-radius: ${bounded(options.borderRadius, 12, 0, 100)}px;
      background-color: ${baseBg};
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
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(0, 0, 0, 0.1) 100%);
        pointer-events: none;
        border-radius: inherit;
        z-index: 2;
      }
    `,
    header: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1.5)};
      z-index: 3;
      margin-bottom: ${options.showValue ? theme.spacing(1.5) : 0};
    `,
    iconWrap: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      flex-shrink: 0;
      svg {
        width: 14px;
        height: 14px;
      }
    `,
    label: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: ${labelColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      font-weight: ${theme.typography.fontWeightMedium};
    `,
    valueWrap: css`
      display: flex;
      align-items: baseline;
      z-index: 3;
    `,
    value: css`
      font-size: ${options.valueFontSize}px;
      font-weight: ${theme.typography.fontWeightBold};
      color: ${valueTextColor};
      line-height: 1.1;
      letter-spacing: -0.02em;
      word-break: break-word;
    `,
    statusBar: css`
      display: flex;
      align-items: stretch;
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
      padding: 4px 8px;
      border-radius: 6px;
      color: #fff;
      font-size: ${theme.typography.bodySmall.fontSize};
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
  const { accent } = THEME_COLORS[options.theme] ?? THEME_COLORS.vale;
  const styles = useStyles2((t) => getStyles(t, accent, options));

  const statusBar = options.displayMode === 'statusBar';
  const metrics = useMemo(
    () => selectMetrics(data.series, statusBar ? { ...options, metricMode: 'configured' } : options),
    [data.series, options, statusBar]
  );
  const availableMetrics = useMemo(() => listMetrics(data.series), [data.series]);
  const grouped = options.cardLayout === 'grouped';

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
    const customCfg = metric?.field?.config?.custom || {};
    const useThreshold = customCfg.useThreshold ?? false;
    const finalLabel = label || metric?.label || source?.fieldName || 'STATUS';
    return {
      label: finalLabel,
      text: healthy === undefined ? 'SEM DADOS' : display?.text || (healthy ? healthyLabel : unhealthyLabel),
      color: useThreshold && display?.color ? display.color : accent,
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


    return (
      <div className={styles.statusBar} style={{ width, height, flexWrap: 'nowrap' }}>
        <div className={styles.identity}>
          {options.showIcon !== false && (
            <div className={styles.iconWrap} style={{ color: accent, backgroundColor: `${accent}25` }}>
              <Icon name={resolveIconName(options.icon) as any} size="sm" />
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
        <div style={{ display: 'flex', alignItems: 'stretch', alignContent: 'center', gap: theme.spacing(5), flex: '0 1 auto', flexWrap: 'nowrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
          {fixedMetricsConfig.map((config) => {
            const metric = availableMetrics.find((item) => sourceKey(item.source) === sourceKey(config.source));
            const field = metric?.field;
            const lastValue = field && field.values.length ? field.values[field.values.length - 1] : null;
            const display = field ? formatFieldValue(lastValue, field, theme) : { text: '—', color: undefined };
            const label = config.label || metric?.label || config.source?.fieldName || 'Métrica';
            const customCfg = field?.config?.custom || {};
            const useThreshold = customCfg.useThreshold ?? false;
            const shouldShowIcon = customCfg?.showIcon ?? options.showIcon ?? true;
            const iconName = resolveIconName(customCfg?.icon || options.icon);
            return (
              <div className={styles.metricCompact} key={config.id}>
                <span className={styles.metricCompactLabel}>
                  {shouldShowIcon !== false && <Icon name={iconName as any} size="xs" style={{ marginRight: 4, color: useThreshold && display.color ? display.color : accent }} />}
                  {label}
                </span>
                <span className={styles.metricCompactValue} style={{ color: useThreshold ? display.color : undefined }}>
                  {display.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        styles.container,
        css`
          width: ${width}px;
          height: ${height}px;
        `
      )}
      style={
        grouped
          ? {
              background: theme.colors.background.secondary,
              border: `1px solid ${theme.colors.border.weak}`,
              borderRadius: bounded(options.borderRadius, 12, 0, 100),
              padding: bounded(options.cardPadding, 16, 0, 100),
            }
          : undefined
      }
    >
      {metrics.map(({ config, metric }) => {
        const field = metric?.field;
        const lastValue = field && field.values.length ? field.values[field.values.length - 1] : null;
        const display = field ? formatFieldValue(lastValue, field, theme) : { text: '—', color: undefined };
        const fieldName = config.label || metric?.label || config.source?.fieldName || 'Selecione um campo';
        const customCfg = field?.config.custom;
        const iconName = resolveIconName(config.icon || customCfg?.icon || options.icon);
        const horizontal = config.horizontalAlign ?? options.horizontalAlign ?? 'left';
        const vertical = config.verticalAlign ?? options.verticalAlign ?? 'center';
        const align = { left: 'flex-start', center: 'center', right: 'flex-end' }[horizontal];
        const justify = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[vertical];
        const badge = config.badgeMode === 'value' ? display.text : config.badgeMode === 'text' ? config.badgeText : '';

        const useThreshold = customCfg.useThreshold ?? false;
        const colorMode = customCfg.colorMode ?? 'text';

        let bgColor = '';
        let borderColor = '';
        let textColor = '';
        let iconColor = accent;

        // Aplica a lógica de cores
        if (useThreshold && display.color) {
          if (colorMode === 'background') {
            bgColor = `${display.color}15`; // Fundo com 15% de opacidade
            borderColor = `${display.color}40`; // Borda com 40% de opacidade
            textColor = display.color;
            iconColor = display.color;
          } else {
            // Apenas texto
            textColor = display.color;
            iconColor = display.color;
          }
        }

        return (
          <div
            key={config.id}
            className={styles.card}
            style={{
              backgroundColor: bgColor || undefined,
              borderColor: borderColor || undefined,
              justifyContent: justify,
              textAlign: horizontal,
              ...(grouped
                ? { backgroundColor: bgColor || 'transparent', border: 'none', borderRadius: 0, padding: 0 }
                : {}),
            }}
          >
            <div className={styles.header} style={{ justifyContent: align }}>
              {(customCfg?.showIcon ?? config.showIcon ?? options.showIcon) !== false && (
                <div
                  className={styles.iconWrap}
                  style={{
                    color: iconColor,
                    backgroundColor: `${iconColor}25`,
                  }}
                >
                  <Icon name={iconName as any} size="sm" />
                </div>
              )}
              {options.showLabel !== false && (
                <div
                  className={styles.label}
                  style={{
                    color: colorMode === 'background' ? textColor : undefined,
                    flex: horizontal === 'left' ? 1 : '0 1 auto',
                  }}
                >
                  {fieldName}
                </div>
              )}
            </div>
            {options.showValue !== false && (
              <div className={styles.valueWrap} style={{ justifyContent: align }}>
                <span className={styles.value} style={{ color: textColor || undefined }}>
                  {display.text ?? '—'}
                </span>
              </div>
            )}
            {badge && (
              <span
                style={{
                  alignSelf: align,
                  position: 'relative',
                  zIndex: 3,
                  marginTop: 8,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid currentColor',
                  color: useThreshold && display.color ? display.color : accent,
                  maxWidth: '100%',
                  overflowWrap: 'anywhere',
                }}
              >
                {badge}
              </span>
            )}
            {!metric && <span role="status">Campo indisponível</span>}
          </div>
        );
      })}
    </div>
  );
};
