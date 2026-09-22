import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartType, LineInterpolation, LinePattern, ThresholdMode } from '../types';
import { getDisplayProcessor, formattedValueToString } from '@grafana/data';
import { css } from '@emotion/css';

const getTooltipStyles = (theme: any) => ({
  tooltip: css`
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 100;
    background: ${theme.isDark ? 'rgba(17,24,39,0.96)' : 'rgba(255,255,255,0.97)'};
    border: 1px solid ${theme.isDark ? 'rgba(255,255,255,0.12)' : theme.colors.border.weak};
    border-radius: 6px;
    padding: 8px 12px;
    min-width: 140px;
    backdrop-filter: blur(8px);
  `,
  marker: css`
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 99;
    box-shadow: 0 0 0 2px ${theme.isDark ? '#181b24' : '#ffffff'};
  `,
  crosshairY: css`
    position: absolute;
    width: 100%;
    height: 1px;
    border-top: 1px dashed ${theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'};
    pointer-events: none;
    z-index: 98;
  `,
  time: css`
    font-size: 11px;
    color: ${theme.isDark ? 'rgba(255,255,255,0.5)' : theme.colors.text.secondary};
    margin-bottom: 6px;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  `,
  dot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  label: css`
    flex: 1;
    color: ${theme.isDark ? 'rgba(255,255,255,0.5)' : theme.colors.text.secondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    font-size: 12px;
  `,
  value: css`
    font-size: 12px;
    font-weight: 600;
    font-family: ${theme.typography.fontFamilyMonospace};
    flex-shrink: 0;
    color: ${theme.isDark ? '#e2e8f0' : theme.colors.text.primary};
  `
});

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatTooltipTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}


export interface UplotChartProps {
  width: number;
  height: number;
  seriesInfos: any[]; // will hold data
  times: number[];
  timeRange: { from: number; to: number };
  chartType: ChartType;
  lineInterpolation: LineInterpolation;
  linePattern: LinePattern;
  lineWidth: number;
  areaOpacity: number;
  showPoints: boolean;
  pointSize: number;
  showGrid: boolean;
  showYAxis: boolean;
  showXAxis: boolean;
  yLo: number;
  yHi: number;
  theme: any;
  thresholdMode: ThresholdMode;
  useThreshold: boolean;
  getSeriesColor: (s: any) => string;
  axisTextColor: string;
  axisLineColor: string;
  gridLineColor: string;
  onHover: (ts: number | null, points: any[] | null, px: number, py: number) => void;
  onClickTimeRange?: (from: number, to: number) => void;
  onDoubleClick?: () => void;
}

export const UplotChart: React.FC<UplotChartProps> = ({
  width, height, seriesInfos, times, timeRange, chartType, lineInterpolation, linePattern,
  lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis,
  yLo, yHi, theme, thresholdMode, useThreshold, getSeriesColor,
  axisTextColor, axisLineColor, gridLineColor, onHover, onClickTimeRange, onDoubleClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const crosshairYRef = useRef<HTMLDivElement>(null);
  const tooltipStyles = getTooltipStyles(theme);

  useEffect(() => {
    if (!containerRef.current || times.length === 0) return;

    // Prepare data array for uPlot: [x_values, y1_values, y2_values, ...]
    // Note: uPlot requires timestamps in seconds, not ms
    const data: uPlot.AlignedData = [
      times.map(t => t / 1000)
    ];

    seriesInfos.forEach(s => {
      data.push(s.values);
    });

    const getPaths = () => {
      if (lineInterpolation === 'smooth') return uPlot.paths.spline!();
      if (lineInterpolation === 'stepBefore') return uPlot.paths.stepped!({ align: 1 });
      if (lineInterpolation === 'stepAfter') return uPlot.paths.stepped!({ align: -1 });
      return uPlot.paths.linear!();
    };

    const seriesConfig: uPlot.Series[] = [
      {} // x-axis series
    ];

    seriesInfos.forEach((s, idx) => {
      const color = getSeriesColor(s);

      const dash = linePattern === 'dashed' ? [6, 4] : [];

      seriesConfig.push({
        show: true,
        spanGaps: false,
        stroke: (u, seriesIdx) => {
          if (useThreshold && thresholdMode === 'schema') {
             // Basic schema: we'll just use the series color for now
             // A true schema gradient requires more complex logic to map values to stops
             return color;
          }
          return color;
        },
        width: lineWidth,
        dash,
        paths: chartType === 'bar' ? uPlot.paths.bars!() : getPaths(),
        points: {
          show: showPoints || undefined,
          size: pointSize * 2, // pointSize was radius in SVG
          fill: color,
        },
        fill: (u, seriesIdx) => {
          if (chartType !== 'area') return 'rgba(0,0,0,0)';
          const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
          // Mantém a cor mais forte na maior parte e só apaga no finalzinho
          gradient.addColorStop(0, `color-mix(in srgb, ${color} ${areaOpacity * 100}%, transparent)`);
          gradient.addColorStop(0.7, `color-mix(in srgb, ${color} ${areaOpacity * 80}%, transparent)`);
          gradient.addColorStop(1, `color-mix(in srgb, ${color} 5%, transparent)`);
          return gradient;
        }
      });
    });

    const opts: uPlot.Options = {
      width,
      height,
      padding: [4, 4, 0, 4],
      cursor: {
        x: true,
        y: false,
        points: {
          show: false, // Desabilitado para usar a bolinha customizada em div
        },
        drag: { setScale: false, x: true, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true, range: [timeRange.from / 1000, timeRange.to / 1000] },
        y: { range: [yLo, yHi] }
      },
      axes: [
        {
          show: showXAxis,
          size: 26,
          space: 90, // Aumentado para não espremer textos de data grandes (DD/MM HH:MM)
          stroke: axisTextColor,
          grid: { show: showGrid, stroke: gridLineColor },
          ticks: { show: showXAxis, stroke: axisLineColor },
          values: (u, splits) => {
            if (!u.scales.x.min || !u.scales.x.max) return splits.map(v => String(v));
            const minDate = new Date(u.scales.x.min * 1000);
            const maxDate = new Date(u.scales.x.max * 1000);
            const spansDays = minDate.getDate() !== maxDate.getDate() || 
                              minDate.getMonth() !== maxDate.getMonth() || 
                              minDate.getFullYear() !== maxDate.getFullYear();
            
            return splits.map(v => {
              const d = new Date(v * 1000);
              const hours = String(d.getHours()).padStart(2, '0');
              const mins = String(d.getMinutes()).padStart(2, '0');
              const timeStr = `${hours}:${mins}`;
              
              if (spansDays) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                return `${day}/${month} ${timeStr}`;
              }
              return timeStr;
            });
          }
        },
        {
          show: showYAxis,
          space: 20, // Força mais valores no eixo Y mesmo quando a altura do painel for curta
          stroke: axisTextColor,
          grid: { show: showGrid, stroke: gridLineColor },
          ticks: { show: showYAxis, stroke: axisLineColor },
        }
      ],
      series: seriesConfig,
      hooks: {
        setCursor: [
          (u) => {
            const el = tooltipRef.current;
            const markerEl = markerRef.current;
            const crosshairYEl = crosshairYRef.current;
            if (!el || !markerEl || !crosshairYEl) return;

            const idx = u.cursor.idx;

            if (idx == null || idx < 0) {
              el.style.display = 'none';
              markerEl.style.display = 'none';
              crosshairYEl.style.display = 'none';
              onHover(null, null, 0, 0); // Limpa o hover no pai para não conflitar
              return;
            }

            const ts = times[idx];
            
            const timeEl = el.querySelector('.tooltipTime');
            if (timeEl) timeEl.textContent = formatTooltipTime(ts);

            const rowsEl = el.querySelector('.tooltipRows');
            if (rowsEl) {
              rowsEl.innerHTML = '';
              seriesInfos.forEach((s) => {
                const val = s.values[idx];
                const displayProcessor = s.field.display || getDisplayProcessor({ field: s.field, theme });
                const display = displayProcessor(val);
                const formatted = formattedValueToString(display);
                const color = getSeriesColor(s);

                const row = document.createElement('div');
                row.className = tooltipStyles.row;

                const dot = document.createElement('span');
                dot.className = tooltipStyles.dot;
                dot.style.backgroundColor = color;
                row.appendChild(dot);

                const label = document.createElement('span');
                label.className = tooltipStyles.label;
                label.textContent = s.name;
                row.appendChild(label);

                const valEl = document.createElement('span');
                valEl.className = tooltipStyles.value;
                valEl.textContent = formatted;
                row.appendChild(valEl);

                rowsEl.appendChild(row);
              });
            }

            // 1 & 2. CONVERTER VALOR PARA PIXELS (A Mágica)
            const xVal = u.data[0][idx];
            const yVal = u.data[1][idx]; // Assumindo que a métrica é a série 1
            const cx = u.valToPos(xVal, 'x');
            let cy = u.cursor.top || 0; // fallback caso yVal seja nulo
            if (yVal != null) {
              cy = u.valToPos(yVal, 'y');
            }

            // 3. ANCORAR A BOLINHA E O TOOLTIP
            markerEl.style.backgroundColor = seriesInfos.length > 0 ? getSeriesColor(seriesInfos[0]) : '#fff';
            markerEl.style.left = `${u.bbox.left + cx}px`;
            markerEl.style.top = `${u.bbox.top + cy}px`;
            markerEl.style.display = yVal != null ? 'block' : 'none';

            let x = u.bbox.left + cx + 15;
            let y = u.bbox.top + cy + 15;
            
            // Impede que a tooltip saia para a direita do card
            const maxX = u.bbox.width - el.offsetWidth - 8;
            if (x > maxX) x = u.bbox.left + cx - el.offsetWidth - 15;
            if (y < 0) y = 4;

            el.style.transform = `translate(${x}px, ${y}px)`;
            el.style.display = 'block';

            // 4. ANCORAR A LINHA HORIZONTAL (Crosshair Y) customizada
            if (yVal != null) {
              crosshairYEl.style.left = `${u.bbox.left}px`;
              crosshairYEl.style.width = `${u.bbox.width}px`;
              crosshairYEl.style.top = `${u.bbox.top + cy}px`;
              crosshairYEl.style.display = 'block';
            } else {
              crosshairYEl.style.display = 'none';
            }

            // Pass null points para desabilitar tooltip do painel antigo e parar de re-renderizar
            onHover(ts, null, cx, cy);
          }
        ],
        setSelect: [
          (u) => {
            if (u.select.width > 0 && onClickTimeRange) {
              const min = u.posToVal(u.select.left, 'x');
              const max = u.posToVal(u.select.left + u.select.width, 'x');
              onClickTimeRange(min * 1000, max * 1000);
              u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false); // reset
            }
          }
        ]
      }
    };

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }
    
    uplotRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [width, height, times, timeRange, seriesInfos, chartType, lineInterpolation, linePattern, lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis, yLo, yHi, theme, thresholdMode, useThreshold, getSeriesColor, axisTextColor, axisLineColor, gridLineColor]);

  // Update size without recreating instance if only dimensions change
  useEffect(() => {
    if (uplotRef.current) {
      uplotRef.current.setSize({ width, height });
    }
  }, [width, height]);

  return (
    <div 
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} 
      onDoubleClick={onDoubleClick}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div ref={crosshairYRef} className={tooltipStyles.crosshairY} style={{ display: 'none' }} />
      <div ref={markerRef} className={tooltipStyles.marker} style={{ display: 'none' }} />
      <div ref={tooltipRef} className={tooltipStyles.tooltip} style={{ display: 'none' }}>
        <div className={`tooltipTime ${tooltipStyles.time}`}></div>
        <div className="tooltipRows"></div>
      </div>
    </div>
  );
};
