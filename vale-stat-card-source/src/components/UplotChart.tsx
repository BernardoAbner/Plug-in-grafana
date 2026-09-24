import React, { useEffect, useRef, useCallback } from 'react';
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
  thresholdValue?: number;
  thresholdColor?: string;
  getSeriesColor: (s: any) => string;
  axisTextColor: string;
  axisLineColor: string;
  gridLineColor: string;
  selectedSeriesIndex: number | null;
  onHover: (ts: number | null, points: any[] | null, px: number, py: number) => void;
  onClickTimeRange?: (from: number, to: number) => void;
  onDoubleClick?: () => void;
}

export const UplotChart: React.FC<UplotChartProps> = ({
  width, height, seriesInfos, times, timeRange, chartType, lineInterpolation, linePattern,
  lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis,
  yLo, yHi, theme, thresholdMode, useThreshold, thresholdValue, thresholdColor, getSeriesColor,
  axisTextColor, axisLineColor, gridLineColor, selectedSeriesIndex, onHover, onClickTimeRange, onDoubleClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersContainerRef = useRef<HTMLDivElement>(null);
  // Flag própria e explícita: só vira true com mouseenter REAL do browser,
  // independente de qualquer lógica interna do uPlot.
  const hasRealHoverRef = useRef<boolean>(false);
  const tooltipStyles = getTooltipStyles(theme);

  // Funções de hide/show para marker e tooltip — centralizadas para evitar duplicação
  const hideOverlays = useCallback(() => {
    if (markersContainerRef.current) {
      const children = markersContainerRef.current.children;
      for (let i = 0; i < children.length; i++) {
        (children[i] as HTMLElement).style.display = 'none';
      }
    }
    if (tooltipRef.current) { tooltipRef.current.style.display = 'none'; }
  }, []);

  // Handlers de mouse no wrapper div React (não no uPlot overlay!)
  // Assim eles sobrevivem a recriações do uPlot sem perder o tracking.
  const handleMouseEnter = useCallback(() => {
    hasRealHoverRef.current = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    hasRealHoverRef.current = false;
    hideOverlays();
    onHover(null, null, 0, 0);
  }, [hideOverlays, onHover]);

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
          // IMPORTANTE: false explícito quando não queremos pontos.
          // `showPoints || undefined` é errado porque `false || undefined = undefined`,
          // e undefined faz o uPlot usar o comportamento padrão (mostrar pontos!).
          show: showPoints ? true : false,
          size: showPoints ? pointSize * 2 : 0,
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
      padding: [15, 10, 0, 10], // Força 15px de espaço no topo
      cursor: {
        x: true,
        y: true, // Cruz nativa do uPlot segue o mouse livremente
        points: {
          show: false, // Desabilitado para usar a bolinha customizada em div
        },
        drag: { setScale: false, x: true, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true, range: [timeRange.from / 1000, timeRange.to / 1000] },
        y: { 
          auto: !(seriesInfos[0]?.fieldConfig?.min != null && seriesInfos[0]?.fieldConfig?.max != null),
          range: [
            seriesInfos[0]?.fieldConfig?.min ?? yLo,
            seriesInfos[0]?.fieldConfig?.max ?? yHi
          ]
        }
      },
      axes: [
        {
          show: showXAxis,
          size: 25,
          space: 90, // Aumentado para não espremer textos de data grandes (DD/MM HH:MM)
          stroke: axisTextColor,
          border: { show: false },
          grid: { show: showGrid, stroke: gridLineColor },
          ticks: { show: false, stroke: axisLineColor },
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
        draw: [
          (u) => {
            if (thresholdValue === undefined || thresholdValue === null) return;
            
            const { ctx } = u;
            // Converter o valor do threshold para a coordenada vertical (pixels)
            const cy = u.valToPos(thresholdValue, 'y', true);

            // Proteção: Só desenhar se a linha estiver dentro da área visível do gráfico
            if (cy < u.bbox.top || cy > u.bbox.top + u.bbox.height) return;

            // Desenhar a linha pontilhada
            ctx.save();
            ctx.beginPath();
            // Usar a cor configurada ou um fallback elegante (ex: vermelho translúcido)
            ctx.strokeStyle = thresholdColor || 'rgba(255, 60, 60, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]); // Estilo tracejado premium
            
            // Traçar a linha de ponta a ponta na área do gráfico
            ctx.moveTo(u.bbox.left, cy);
            ctx.lineTo(u.bbox.left + u.bbox.width, cy);
            ctx.stroke();
            ctx.restore();
          }
        ],
        setCursor: [
          (u) => {
            const el = tooltipRef.current;
            const markersContainer = markersContainerRef.current;
            if (!el || !markersContainer) return;

            const idx = u.cursor.idx;

            // CONDIÇÃO DUPLA DE SEGURANÇA:
            // 1. hasRealHoverRef — controlado EXCLUSIVAMENTE por mouseenter/leave no wrapper div React
            // 2. idx válido — o uPlot reporta um índice de dado real
            // Ambas devem ser true para mostrar qualquer coisa.
            const shouldShow = hasRealHoverRef.current === true
              && idx !== undefined && idx !== null && idx >= 0;

            if (!shouldShow) {
              const children = markersContainer.children;
              for (let i = 0; i < children.length; i++) {
                (children[i] as HTMLElement).style.display = 'none';
              }
              el.style.display = 'none';
              onHover(null, null, 0, 0);
              return;
            }

            const ts = times[idx];

            const timeEl = el.querySelector('.tooltipTime');
            if (timeEl) timeEl.textContent = formatTooltipTime(ts);

            const rowsEl = el.querySelector('.tooltipRows');
            if (rowsEl) {
              rowsEl.innerHTML = '';
              seriesInfos.forEach((s, idxSeries) => {
                if (selectedSeriesIndex !== null && selectedSeriesIndex !== idxSeries) return;

                const val = s.values[idx];
                const displayProcessor = s.field.display || getDisplayProcessor({ field: s.field, theme });
                const display = displayProcessor(val);
                const formatted = display.text + (display.suffix ? display.suffix : '');
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

            // Converter o valor do dado para pixels dentro da área de plotagem
            const xVal = u.data[0][idx];
            // cx é coordenada relativa à área interna de desenho (u.bbox)
            const cx = u.valToPos(xVal, 'x');
            
            let firstActiveCy: number | null = null;
            const markerChildren = markersContainer.children;

            // BOLINHAS: posicionar cada uma no pixel exato do dado.
            seriesInfos.forEach((s, idxSeries) => {
              const markerEl = markerChildren[idxSeries] as HTMLElement;
              if (!markerEl) return;

              if (selectedSeriesIndex !== null && selectedSeriesIndex !== idxSeries) {
                markerEl.style.display = 'none';
                return;
              }

              const yVal = u.data[idxSeries + 1][idx];
              if (yVal != null) {
                const cy = u.valToPos(yVal, 'y');
                if (firstActiveCy === null) firstActiveCy = cy;
                
                markerEl.style.display = 'block';
                markerEl.style.left = `${cx + u.bbox.left / window.devicePixelRatio}px`;
                markerEl.style.top = `${cy + u.bbox.top / window.devicePixelRatio}px`;
                markerEl.style.transform = 'translate(-50%, -50%)';
                markerEl.style.backgroundColor = getSeriesColor(s);
              } else {
                markerEl.style.display = 'none';
              }
            });

            // TOOLTIP: Inversão Dinâmica (Collision Detection) ancorado na primeira série ativa
            if (firstActiveCy != null) {
              const cy = firstActiveCy;
              el.style.display = 'block';
              // 1. Ler dimensões reais do tooltip (com fallback seguro)
              const tooltipWidth  = el.offsetWidth  || 200;
              const tooltipHeight = el.offsetHeight || 80;

              // 2. Lógica de Flip no eixo Y (Baixo → Cima)
              // u.bbox usa pixels físicos; cx/cy já estão em px CSS (valToPos retorna CSS px)
              const offsetY = (cy + tooltipHeight + 15 > u.bbox.height / window.devicePixelRatio)
                ? -(tooltipHeight + 15)  // Inverte: tooltip vai para CIMA da bolinha
                : 15;                    // Padrão: tooltip vai para BAIXO da bolinha

              // 3. Lógica de Flip no eixo X (Direita → Esquerda)
              const offsetX = (cx + tooltipWidth + 15 > u.bbox.width / window.devicePixelRatio)
                ? -(tooltipWidth + 15)   // Inverte: tooltip vai para a ESQUERDA da bolinha
                : 15;                    // Padrão: tooltip vai para a DIREITA da bolinha

              // 4. Coordenadas finais absolutas (relativas ao container do gráfico)
              const finalTop  = cy + u.bbox.top  / window.devicePixelRatio + offsetY;
              const finalLeft = cx + u.bbox.left / window.devicePixelRatio + offsetX;

              el.style.transform = `translate(${finalLeft}px, ${finalTop}px)`;
            } else {
              el.style.display = 'none';
            }

            onHover(ts, null, cx, firstActiveCy ?? 0);
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

    // Resetar a flag de hover antes de recriar — a recriação do uPlot
    // pode disparar setCursor internamente, e não queremos que isso
    // herde um hasRealHoverRef=true de um hover anterior.
    hasRealHoverRef.current = false;

    uplotRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [width, height, times, timeRange, seriesInfos, chartType, lineInterpolation, linePattern, lineWidth, areaOpacity, showPoints, pointSize, showGrid, showYAxis, showXAxis, yLo, yHi, theme, thresholdMode, useThreshold, thresholdValue, thresholdColor, getSeriesColor, axisTextColor, axisLineColor, gridLineColor]);

  // Update size without recreating instance if only dimensions change
  useEffect(() => {
    if (uplotRef.current) {
      uplotRef.current.setSize({ width, height });
    }
  }, [width, height]);

  // ── Click-to-Solo: Alternar visibilidade de séries via API nativa do uPlot ──
  // Usa setSeries() para mostrar/esconder séries sem recriar a instância inteira.
  useEffect(() => {
    const u = uplotRef.current;
    if (!u) return;
    u.series.forEach((s, idx) => {
      if (idx === 0) return; // ignora o eixo X (tempo)
      const shouldShow = selectedSeriesIndex === null || selectedSeriesIndex === (idx - 1);
      if (s.show !== shouldShow) {
        u.setSeries(idx, { show: shouldShow });
      }
    });
  }, [selectedSeriesIndex]);

  return (
    <div 
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} 
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={onDoubleClick}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div ref={markersContainerRef} style={{ pointerEvents: 'none', position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {seriesInfos.map((_, i) => (
          <div key={i} className={tooltipStyles.marker} style={{ display: 'none' }} />
        ))}
      </div>
      <div ref={tooltipRef} className={tooltipStyles.tooltip} style={{ display: 'none', pointerEvents: 'none' }}>
        <div className={`tooltipTime ${tooltipStyles.time}`}></div>
        <div className="tooltipRows"></div>
      </div>
    </div>
  );
};

