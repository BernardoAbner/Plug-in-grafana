import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getChartStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    position: relative;
    width: 100%;
    height: 100%;
    overflow: visible;

    /* Caixa de seleção/arraste temporal nativa do uPlot */
    .u-select {
      background: rgba(56, 189, 248, 0.15);
      outline: 1px solid rgba(56, 189, 248, 0.45);
      outline-offset: -1px;
      position: absolute;
      pointer-events: none;
      z-index: 10;
    }

    /* Oculta os pontos padrão nativos do uPlot (usamos nossos próprios markers) */
    .u-cursor-pt {
      display: none !important;
    }
  `,

  tooltip: css`
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 1000;
    background: ${theme.isDark ? 'rgba(15, 17, 23, 0.95)' : 'rgba(255, 255, 255, 0.97)'};
    border: 1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
    border-radius: 6px;
    padding: 6px 10px;
    min-width: 130px;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font-size: 11px;
    line-height: 1.4;
  `,

  time: css`
    font-size: 10px;
    color: ${theme.isDark ? 'rgba(255, 255, 255, 0.55)' : theme.colors.text.secondary};
    margin-bottom: 4px;
    font-family: ${theme.typography.fontFamilyMonospace};
    border-bottom: 1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'};
    padding-bottom: 3px;
  `,

  row: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  `,

  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  `,

  label: css`
    flex: 1;
    color: ${theme.isDark ? 'rgba(255, 255, 255, 0.65)' : theme.colors.text.secondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 90px;
  `,

  value: css`
    font-weight: 600;
    font-family: ${theme.typography.fontFamilyMonospace};
    flex-shrink: 0;
    color: ${theme.isDark ? '#e2e8f0' : theme.colors.text.primary};
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
});
