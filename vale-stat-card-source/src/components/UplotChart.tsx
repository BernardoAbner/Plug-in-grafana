import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartType, LineInterpolation, LinePattern, ThresholdMode } from '../types';

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
          show: showPoints,
          size: pointSize * 2, // pointSize was radius in SVG
          fill: color,
        },
        fill: (u, seriesIdx) => {
          if (chartType !== 'area') return 'rgba(0,0,0,0)';
          return `color-mix(in srgb, ${color} ${areaOpacity * 100}%, transparent)`;
        }
      });
    });

    const opts: uPlot.Options = {
      width,
      height,
      padding: [4, 4, 0, 4],
      cursor: {
        points: {
          show: true,
          size: (u, seriesIdx) => pointSize * 2 + 4,
          fill: (u, seriesIdx) => getSeriesColor(seriesInfos[seriesIdx - 1]),
          stroke: theme.isDark ? '#000000' : '#ffffff',
          width: 2,
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
            if (u.cursor.idx == null || u.cursor.idx < 0) {
              onHover(null, null, 0, 0);
              return;
            }
            const ts = times[u.cursor.idx];
            const px = u.cursor.left ?? 0;
            const py = u.cursor.top ?? 0;
            const points = seriesInfos.map((s, idx) => ({
              name: s.name,
              value: s.values[u.cursor.idx!], // format outside
              color: getSeriesColor(s),
              rawVal: s.values[u.cursor.idx!]
            }));
            onHover(ts, points, px, py);
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
      ref={containerRef} 
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} 
      onDoubleClick={onDoubleClick}
    />
  );
};
