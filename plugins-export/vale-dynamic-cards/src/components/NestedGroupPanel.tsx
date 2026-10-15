import React, { useMemo } from 'react';
import { PanelProps, formattedValueToString, getDisplayProcessor } from '@grafana/data';
import { SimpleOptions, NestedRowMetricConfig } from '../types';
import { listMetrics, AvailableMetric, getLastNonNullValue } from '../metrics';
import { css, cx } from '@emotion/css';
import { useStyles2, Icon, useTheme2 } from '@grafana/ui';
import { THEME_COLORS } from './SimplePanel';

interface Props extends PanelProps<SimpleOptions> {}

const getStyles = (theme: ReturnType<typeof useTheme2>, accent: string, options: SimpleOptions) => {
  const baseBg = theme.colors.background.primary;
  const borderColor = theme.colors.border.weak;
  const labelColor = theme.colors.text.secondary;
  const valueTextColor = theme.colors.text.primary;
  
  return {
    container: css`
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px;
      overflow: auto;
      height: 100%;
    `,
    box: css`
      display: flex;
      flex-direction: column;
      background-color: ${baseBg};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      overflow: hidden;
      position: relative;
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
    boxHeader: css`
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid ${borderColor};
      background: rgba(0,0,0,0.2);
      z-index: 3;
    `,
    boxIcon: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background-color: ${accent}25;
      color: ${accent};
    `,
    boxTitle: css`
      font-size: ${theme.typography.h5.fontSize};
      font-weight: ${theme.typography.fontWeightBold};
      color: ${valueTextColor};
      flex: 1;
    `,
    boxCount: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${labelColor};
      background: ${theme.colors.background.secondary};
      padding: 2px 8px;
      border-radius: 12px;
    `,
    rowList: css`
      display: flex;
      flex-direction: column;
      z-index: 3;
    `,
    row: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid ${theme.colors.border.weak};
      &:last-child {
        border-bottom: none;
      }
      &:hover {
        background: rgba(255,255,255,0.02);
      }
    `,
    rowName: css`
      font-size: ${theme.typography.body.fontSize};
      font-weight: ${theme.typography.fontWeightMedium};
      color: ${valueTextColor};
      width: 150px;
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,
    rowMetrics: css`
      display: flex;
      align-items: center;
      gap: 24px;
      flex: 1;
      justify-content: flex-end;
    `,
    metricCol: css`
      display: flex;
      flex-direction: column;
      min-width: 80px;
      align-items: flex-end;
    `,
    metricLabel: css`
      font-size: 10px;
      color: ${labelColor};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    `,
    metricValue: css`
      font-size: 14px;
      font-weight: ${theme.typography.fontWeightBold};
      color: ${valueTextColor};
    `,
    progressBarContainer: css`
      width: 100px;
      height: 6px;
      background: ${theme.colors.background.secondary};
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    `,
    progressBarFill: css`
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    `,
    badge: css`
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: bold;
      color: #fff;
    `,
    triggerArea: css`
      padding: 12px 16px;
      background: rgba(224, 47, 68, 0.1);
      border-top: 1px solid rgba(224, 47, 68, 0.2);
      color: #e02f44;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 3;
    `
  };
};

export const NestedGroupPanel: React.FC<Props> = ({ options, data, width, height }) => {
  const theme = useTheme2();
  const { accent } = THEME_COLORS[options.theme] ?? THEME_COLORS.vale;
  const styles = useStyles2((t) => getStyles(t, accent, options));
  
  const availableMetrics = useMemo(() => listMetrics(data.series), [data.series]);
  
  // Agrupamento dos dados
  const groups = useMemo(() => {
    const grps = new Map<string, Map<string, AvailableMetric[]>>();
    const groupLabelKey = options.nestedGroupByLabel?.trim() || 'group';
    const rowLabelKey = options.nestedRowNameLabel?.trim() || 'name';

    for (const metric of availableMetrics) {
      const groupName = metric.field.labels?.[groupLabelKey] ?? 'Default';
      const rowName = metric.field.labels?.[rowLabelKey] ?? metric.label ?? 'Default Row';
      
      if (!grps.has(groupName)) {
        grps.set(groupName, new Map());
      }
      const groupMap = grps.get(groupName)!;
      
      if (!groupMap.has(rowName)) {
        groupMap.set(rowName, []);
      }
      groupMap.get(rowName)!.push(metric);
    }
    return grps;
  }, [availableMetrics, options.nestedGroupByLabel, options.nestedRowNameLabel]);

  const renderMetric = (config: NestedRowMetricConfig, rowMetrics: AvailableMetric[]) => {
    // Busca a métrica correspondente. Em Zabbix/Prometheus, podemos parear pelo refId.
    const metric = rowMetrics.find(m => m.source.refId === config.source?.refId && m.source.fieldName === config.source?.fieldName) 
                || rowMetrics.find(m => m.source.refId === config.source?.refId);
    
    if (!metric) {
      return <div className={styles.metricCol}>-</div>;
    }

    const field = metric.field;
    const raw = getLastNonNullValue(field);
    const displayProc = getDisplayProcessor({ field, theme });
    const display = displayProc(raw);
    const text = formattedValueToString(display);
    const color = display.color || accent;
    const label = config.label || field.name;

    if (config.displayMode === 'progressBar') {
      const min = field.config.min ?? 0;
      const max = field.config.max ?? 100;
      const pct = Math.max(0, Math.min(100, ((Number(raw) - min) / (max - min || 1)) * 100));
      return (
        <div className={styles.metricCol} key={config.id}>
          <div className={styles.metricLabel}>{label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={styles.metricValue}>{text}</span>
            <div className={styles.progressBarContainer}>
              <div className={styles.progressBarFill} style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
          </div>
        </div>
      );
    }

    if (config.displayMode === 'statusBadge') {
      return (
        <div className={styles.metricCol} key={config.id}>
          <div className={styles.metricLabel}>{label}</div>
          <div className={styles.badge} style={{ backgroundColor: color }}>
            {text}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.metricCol} key={config.id}>
        <div className={styles.metricLabel}>{label}</div>
        <div className={styles.metricValue} style={{ color }}>{text}</div>
      </div>
    );
  };

  return (
    <div className={styles.container} style={{ width, height }}>
      {Array.from(groups.entries()).map(([groupName, rowsMap]) => {
        
        // Verifica trigger neste grupo
        let triggerActive = false;
        let triggerText = '';
        if (options.nestedTriggerSource) {
          const tRef = options.nestedTriggerSource.refId;
          const allGroupMetrics = Array.from(rowsMap.values()).flat();
          const triggerMetric = allGroupMetrics.find(m => m.source.refId === tRef);
          if (triggerMetric) {
            const raw = getLastNonNullValue(triggerMetric.field);
            if (raw === 1 || raw === true || (typeof raw === 'string' && raw.length > 0 && raw !== '0' && raw.toLowerCase() !== 'ok')) {
              triggerActive = true;
              triggerText = String(raw);
            }
          }
        }

        return (
          <div className={styles.box} key={groupName}>
            <div className={styles.boxHeader}>
              <div className={styles.boxIcon}>
                <Icon name={options.icon as any || 'apps'} size="lg" />
              </div>
              <div className={styles.boxTitle}>{groupName}</div>
              <div className={styles.boxCount}>{rowsMap.size} item(s)</div>
            </div>
            
            <div className={styles.rowList}>
              {Array.from(rowsMap.entries()).map(([rowName, metrics]) => (
                <div className={styles.row} key={rowName}>
                  <div className={styles.rowName} title={rowName}>{rowName}</div>
                  <div className={styles.rowMetrics}>
                    {options.nestedRowMetrics?.map(config => renderMetric(config, metrics))}
                  </div>
                </div>
              ))}
            </div>

            {triggerActive && (
              <div className={styles.triggerArea}>
                <Icon name="exclamation-triangle" />
                <span>Alerta ativo: {triggerText}</span>
              </div>
            )}
          </div>
        );
      })}
      
      {groups.size === 0 && (
        <div style={{ padding: 16 }}>Nenhum dado encontrado para os labels configurados.</div>
      )}
    </div>
  );
};
