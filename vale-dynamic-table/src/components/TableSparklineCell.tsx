import React, { useEffect, useRef, useCallback, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Field, GrafanaTheme2, getDisplayProcessor } from '@grafana/data';
import { getChartStyles } from './chartStyles';
import { parseColorToRgba } from './UplotChart';
import { NativeThresholdsConfig } from '../types';
import { AlertEpisode } from './SimplePanel';

export interface SparklineSeries {
  name: string;
  field: Field;
  values: Array<number | null>;
  color: string;
  lineWidth?: number;
  areaOpacity?: number; // 0..100
  lineOpacity?: number; // 10..100
  lineInterpolation?: 'smooth' | 'straight' | 'stepBefore' | 'stepAfter';
  binaryStepHighlight?: boolean;
  episodes?: AlertEpisode[];
  thresholds?: NativeThresholdsConfig;
}

export interface TableSparklineCellProps {
  width?: number;
  height?: number;
  /** Timestamps em milissegundos correspondentes aos valores */
  times: number[];
  series: SparklineSeries[];
  theme: GrafanaTheme2;
  showXAxis?: boolean;
  timeRange?: { from: number; to: number }; // Janela temporal global (ms)
  /** Callback acionado ao selecionar uma faixa temporal com o mouse */
  onChangeTimeRange?: (range: { from: number; to: number }) => void;
}

export const TableSparklineCell: React.FC<TableSparklineCellProps> = ({
  width,
  height,
  times,
  series,
  theme,
  showXAxis = true,
  timeRange,
  onChangeTimeRange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersContainerRef = useRef<HTMLDivElement>(null);

  // Auto-dimensionamento responsivo para células de tabela
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: width && width > 0 ? width : 120,
    height: height && height > 0 ? height : 24,
  });

  useEffect(() => {
    if (width && width > 0 && height && height > 0) {
      setContainerSize({ width, height });
      return;
    }
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 0) {
          setContainerSize({
            width: width && width > 0 ? width : w,
            height: height && height > 0 ? height : (h > 0 ? h : 24),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const effWidth = width && width > 0 ? width : containerSize.width;
  const effHeight = height && height > 0 ? height : containerSize.height;

  // Flag estrita: só consideramos hover quando o cursor REAL estiver sobre o wrapper
  const hasRealHoverRef = useRef<boolean>(false);
  const styles = getChartStyles(theme);

  // Formatador de timestamp para o cabeçalho do tooltip
  const formatTooltipTime = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const handleMouseEnter = useCallback(() => {
    hasRealHoverRef.current = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    hasRealHoverRef.current = false;
    if (tooltipRef.current) {
      tooltipRef.current.style.display = 'none';
    }
    if (markersContainerRef.current) {
      const children = markersContainerRef.current.children;
      for (let i = 0; i < children.length; i++) {
        (children[i] as HTMLElement).style.display = 'none';
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || times.length === 0 || series.length === 0 || effWidth <= 0 || effHeight <= 0) return;

    // 1. Dados alinhados para o uPlot: [x_sec, y1, y2, ...]
    const xSec = times.map((t) => t / 1000);
    const data: uPlot.AlignedData = [
      xSec,
      ...series.map((s) => s.values.map((v) => (v != null && !isNaN(v as any) ? Number(v) : null))),
    ];

    // 2. Configuração das séries do uPlot
    const seriesConfig: uPlot.Series[] = [
      {}, // Série 0 = Eixo X
      ...series.map((s) => {
        const lineOp = Math.min(1, Math.max(0.1, (s.lineOpacity ?? 100) / 100));
        const strokeColor = parseColorToRgba(s.color, lineOp, theme);
        const areaOp = Math.min(1, Math.max(0, (s.areaOpacity ?? 25) / 100));
        const w = s.lineWidth ?? 1.5;

        const getPaths = () => {
          const interp = s.binaryStepHighlight ? 'stepBefore' : (s.lineInterpolation || 'smooth');
          if (interp === 'straight') return uPlot.paths?.linear ? uPlot.paths.linear() : undefined;
          if (interp === 'stepBefore') return uPlot.paths?.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined;
          if (interp === 'stepAfter') return uPlot.paths?.stepped ? uPlot.paths.stepped({ align: -1 }) : undefined;
          // smooth (spline)
          return uPlot.paths?.spline ? uPlot.paths.spline() : (uPlot.paths?.linear ? uPlot.paths.linear() : undefined);
        };

        return {
          stroke: strokeColor,
          width: w,
          paths: getPaths(),
          points: { show: false }, // Marcadores desenhados via div para performance
          fillTo: (u: uPlot) => u.scales.y.min ?? 0,
          fill: (u: uPlot) => {
            if (areaOp <= 0) return 'rgba(0, 0, 0, 0)';
            try {
              const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
              grad.addColorStop(0, parseColorToRgba(s.color, Math.min(1, areaOp), theme));
              grad.addColorStop(0.65, parseColorToRgba(s.color, areaOp * 0.35, theme));
              grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
              return grad;
            } catch {
              return parseColorToRgba(s.color, areaOp * 0.25, theme);
            }
          },
        };
      }),
    ];

    // 3. Opções completas do uPlot
    const opts: uPlot.Options = {
      width: effWidth,
      height: effHeight,
      // Padding mínimo para maximizar o aproveitamento da altura vertical na célula
      padding: showXAxis ? [4, 6, 0, 6] : [2, 4, 2, 4],
      cursor: {
        x: true,
        y: true,
        points: { show: false },
        // Habilita arrasto horizontal para seleção temporal com o mouse
        drag: { setScale: false, x: true, y: false },
      },
      legend: { show: false },
      scales: {
        x: {
          time: true,
          // Se houver timeRange global fornecido, força os limites em segundos:
          range: timeRange ? () => [timeRange.from / 1000, timeRange.to / 1000] : undefined,
        },
        y: {
          auto: false,
          range: (u, dataMin, dataMax) => {
            if (dataMin == null || dataMax == null || isNaN(dataMin) || isNaN(dataMax)) {
              return [0, 1];
            }
            const hasBinary = series.some((s) => s.binaryStepHighlight);
            if (hasBinary && dataMin >= 0 && dataMax <= 1) {
              // 0 fica exatamente na base para que o gradiente seja apenas da linha para baixo
              return [0, 1.05];
            }
            if (dataMin === dataMax) {
              if (dataMin === 0) {
                return [0, 1];
              }
              const delta = Math.abs(dataMin) > 0 ? Math.abs(dataMin) * 0.1 : 1;
              return [dataMin >= 0 ? Math.max(0, dataMin - delta) : dataMin - delta, dataMax + delta];
            }
            // Apenas 3% de folga vertical para aproveitar o MÁXIMO da altura vertical da célula
            const span = dataMax - dataMin;
            const pad = span * 0.03;
            const minBound = dataMin >= 0 ? Math.max(0, dataMin - pad) : dataMin - pad;
            return [minBound, dataMax + pad];
          },
        },
      },
      axes: [
        // ==========================================
        //  PONTO 1: CONFIGURAÇÃO DO EIXO X
        // ==========================================
        {
          show: showXAxis,
          size: showXAxis ? 18 : 0,
          space: 60, // Espaço em px entre cada tick de tempo
          stroke: theme.isDark ? 'rgba(255,255,255,0.45)' : theme.colors.text.secondary,
          grid: { show: false },
          ticks: { show: false },
          // Formatação adaptativa: se a janela cruza dias, mostra DD/MM HH:mm; senão apenas HH:mm
          values: (u, splits) => {
            if (!u.scales.x.min || !u.scales.x.max) return splits.map((v) => String(v));
            const minDate = new Date(u.scales.x.min * 1000);
            const maxDate = new Date(u.scales.x.max * 1000);
            const spansDays =
              minDate.getDate() !== maxDate.getDate() ||
              minDate.getMonth() !== maxDate.getMonth() ||
              minDate.getFullYear() !== maxDate.getFullYear();

            return splits.map((v) => {
              const d = new Date(v * 1000);
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              const timeStr = `${hh}:${mm}`;

              if (spansDays) {
                const dd = String(d.getDate()).padStart(2, '0');
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                return `${dd}/${mo} ${timeStr}`;
              }
              return timeStr;
            });
          },
        },
        // Eixo Y desabilitado para o estilo mini-gráfico/sparkline
        { show: false },
      ],
      series: seriesConfig,
      hooks: {
        draw: [
          (u) => {
            const { ctx, bbox } = u;
            const bottomY = bbox.top + bbox.height;
            for (let sIdx = 0; sIdx < series.length; sIdx++) {
              const s = series[sIdx];
              if (!s.binaryStepHighlight || !s.episodes || s.episodes.length === 0) continue;

              const xData = u.data[0];
              const yData = u.data[sIdx + 1];
              if (!xData || !yData || xData.length === 0) continue;

              const lineOp = Math.min(1, Math.max(0.1, (s.lineOpacity ?? 100) / 100));
              const areaOp = Math.min(1, Math.max(0, (s.areaOpacity ?? 25) / 100));
              const interp = s.binaryStepHighlight ? 'stepBefore' : (s.lineInterpolation || 'smooth');
              const w = s.lineWidth ?? 1.5;

              ctx.save();
              for (const ep of s.episodes) {
                const x0 = Math.max(bbox.left, u.valToPos(ep.startTs / 1000, 'x', true));
                const x1 = Math.min(bbox.left + bbox.width, u.valToPos(ep.endTs / 1000, 'x', true));
                if (x1 <= x0) continue;

                const alertColor = ep.color || '#F2495C';
                const strokeColor = parseColorToRgba(alertColor, lineOp, theme);

                ctx.save();
                ctx.beginPath();
                ctx.rect(x0, bbox.top, x1 - x0, bbox.height);
                ctx.clip();

                // Constrói os vértices do caminho da linha para preencher apenas da linha para baixo
                const pts: Array<{ x: number; y: number }> = [];
                for (let i = 0; i < xData.length; i++) {
                  const val = yData[i];
                  if (val == null || isNaN(val)) continue;
                  const px = u.valToPos(xData[i], 'x', true);
                  const py = u.valToPos(val, 'y', true);

                  if (pts.length > 0) {
                    const prev = pts[pts.length - 1];
                    if (interp === 'stepBefore') {
                      pts.push({ x: px, y: prev.y });
                    } else if (interp === 'stepAfter') {
                      pts.push({ x: prev.x, y: py });
                    }
                  }
                  pts.push({ x: px, y: py });
                }

                // 1. Gradiente de área ESTRITAMENTE para baixo da linha (nunca acima da linha ou acima do 0)
                if (areaOp > 0 && pts.length > 1) {
                  ctx.beginPath();
                  ctx.moveTo(pts[0].x, bottomY);
                  for (let i = 0; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                  }
                  ctx.lineTo(pts[pts.length - 1].x, bottomY);
                  ctx.closePath();

                  const grad = ctx.createLinearGradient(0, bbox.top, 0, bottomY);
                  grad.addColorStop(0, parseColorToRgba(alertColor, Math.min(1, areaOp), theme));
                  grad.addColorStop(0.65, parseColorToRgba(alertColor, areaOp * 0.35, theme));
                  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                  ctx.fillStyle = grad;
                  ctx.fill();
                }

                // 2. Traçado da linha sobre o trecho em alerta
                if (pts.length > 0) {
                  ctx.beginPath();
                  ctx.moveTo(pts[0].x, pts[0].y);
                  for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                  }
                  ctx.strokeStyle = strokeColor;
                  ctx.lineWidth = w;
                  ctx.stroke();
                }

                ctx.restore();
              }
              ctx.restore();
            }
          },
        ],
        // ==========================================
        //  PONTO 2: TOOLTIP CUSTOMIZADO (setCursor)
        // ==========================================
        setCursor: [
          (u) => {
            const el = tooltipRef.current;
            const markersContainer = markersContainerRef.current;
            if (!el || !markersContainer) return;

            const idx = u.cursor.idx;
            const shouldShow = hasRealHoverRef.current && idx != null && idx >= 0;

            if (!shouldShow) {
              el.style.display = 'none';
              const children = markersContainer.children;
              for (let i = 0; i < children.length; i++) {
                (children[i] as HTMLElement).style.display = 'none';
              }
              return;
            }

            // A. Atualiza o cabeçalho de tempo
            const xValSec = u.data[0][idx];
            const ts = Math.round(xValSec * 1000);
            const timeEl = el.querySelector('.tooltipTime');
            if (timeEl) timeEl.textContent = formatTooltipTime(ts);

            // B. Popula as linhas do tooltip com displayProcessor nativo do Grafana
            const rowsEl = el.querySelector('.tooltipRows');
            if (rowsEl) {
              rowsEl.innerHTML = '';
              series.forEach((s, sIdx) => {
                const rawVal = u.data[sIdx + 1]?.[idx];
                if (rawVal == null || isNaN(Number(rawVal))) return;

                const val = Number(rawVal);
                // Utiliza a unidade, decimais e regras do campo configurado no Grafana
                const processor = s.field?.display || (s.field ? getDisplayProcessor({ field: s.field, theme }) : undefined);
                const disp = processor ? processor(val) : { text: String(val), suffix: '' };
                const formatted = (disp.text ?? '') + (disp.suffix ? disp.suffix : '');

                const row = document.createElement('div');
                row.className = styles.row;

                const dot = document.createElement('span');
                dot.className = styles.dot;
                dot.style.backgroundColor = s.color;

                const label = document.createElement('span');
                label.className = styles.label;
                label.textContent = s.name;

                const valSpan = document.createElement('span');
                valSpan.className = styles.value;
                valSpan.textContent = formatted;

                row.appendChild(dot);
                row.appendChild(label);
                row.appendChild(valSpan);
                rowsEl.appendChild(row);
              });
            }

            // C. Posiciona as bolinhas (markers) nas coordenadas exatas
            const cx = u.valToPos(xValSec, 'x');
            let firstActiveCy: number | null = null;
            const markerChildren = markersContainer.children;

            series.forEach((s, sIdx) => {
              const markerEl = markerChildren[sIdx] as HTMLElement;
              if (!markerEl) return;
              const yVal = u.data[sIdx + 1]?.[idx];
              if (yVal != null) {
                const cy = u.valToPos(yVal, 'y');
                if (firstActiveCy === null) firstActiveCy = cy;
                markerEl.style.display = 'block';
                markerEl.style.left = `${cx + u.bbox.left / window.devicePixelRatio}px`;
                markerEl.style.top = `${cy + u.bbox.top / window.devicePixelRatio}px`;
                markerEl.style.backgroundColor = s.color;
              } else {
                markerEl.style.display = 'none';
              }
            });

            // D. Lógica de Anti-Colisão e Inversão Dinâmica do Tooltip
            if (firstActiveCy != null) {
              el.style.display = 'block';
              const tooltipWidth = el.offsetWidth || 140;
              const tooltipHeight = el.offsetHeight || 60;

              const chartLeft = u.bbox.left / window.devicePixelRatio;
              const chartTop = u.bbox.top / window.devicePixelRatio;
              const chartWidth = u.bbox.width / window.devicePixelRatio;
              const chartHeight = u.bbox.height / window.devicePixelRatio;

              const cursorY = firstActiveCy + chartTop;
              const cursorX = cx + chartLeft;

              // 1. Vertical: Preferência para ficar ACIMA da bolinha, permitindo respiro no topo da célula
              const calculatedTop = cursorY - tooltipHeight - 10;
              let safeTop = calculatedTop;
              if (safeTop < 0) {
                // Se cortar no topo da célula, inverte para baixo
                safeTop = cursorY + 12;
              }
              if (safeTop + tooltipHeight > chartTop + chartHeight + 20) {
                safeTop = Math.max(0, chartTop + chartHeight - tooltipHeight);
              }

              // 2. Horizontal: Inversão Direita -> Esquerda se estourar a borda direita
              let calculatedLeft = cursorX + 12;
              if (calculatedLeft + tooltipWidth > chartLeft + chartWidth) {
                calculatedLeft = cursorX - tooltipWidth - 12;
              }
              const safeLeft = Math.max(4, calculatedLeft);

              el.style.transform = `translate(${safeLeft}px, ${safeTop}px)`;
            } else {
              el.style.display = 'none';
            }
          },
        ],

        // ==========================================
        //  PONTO 3: SELEÇÃO TEMPORAL COM MOUSE (setSelect)
        // ==========================================
        setSelect: [
          (u) => {
            // Só dispara se o usuário realmente arrastou uma área maior que 0px
            if (u.select.width > 0 && onChangeTimeRange) {
              // Converte a posição em pixel do uPlot para timestamp em segundos
              const minSec = u.posToVal(u.select.left, 'x');
              const maxSec = u.posToVal(u.select.left + u.select.width, 'x');

              // Converte para milissegundos e envia ao Grafana
              onChangeTimeRange({
                from: Math.round(minSec * 1000),
                to: Math.round(maxSec * 1000),
              });

              // Limpa a caixa de seleção visual do gráfico para não ficar presa na tela
              u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
            }
          },
        ],
      },
    };

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }
    hasRealHoverRef.current = false;
    uplotRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [effWidth, effHeight, times, series, showXAxis, timeRange, theme, onChangeTimeRange]);

  // Redimensionamento rápido sem recriar a instância do uPlot
  useEffect(() => {
    if (uplotRef.current && effWidth > 0 && effHeight > 0) {
      uplotRef.current.setSize({ width: effWidth, height: effHeight });
    }
  }, [effWidth, effHeight]);

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Container onde o canvas do uPlot é montado */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Markers (bolinhas sincronizadas com os pontos) */}
      <div ref={markersContainerRef} style={{ pointerEvents: 'none', position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {series.map((_, i) => (
          <div key={i} className={styles.marker} style={{ display: 'none' }} />
        ))}
      </div>

      {/* Tooltip HTML Customizado */}
      <div ref={tooltipRef} className={styles.tooltip} style={{ display: 'none' }}>
        <div className={`tooltipTime ${styles.time}`}></div>
        <div className="tooltipRows"></div>
      </div>
    </div>
  );
};
