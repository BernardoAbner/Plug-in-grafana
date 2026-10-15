import React, { useMemo } from 'react';
import { PanelProps, FieldType, formattedValueToString, getActiveThreshold, Field } from '@grafana/data';
import { SimpleOptions, ColumnDisplayType, ValueAlignment } from '../types';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { THEME_COLORS } from './SimplePanel';

interface Props extends PanelProps<SimpleOptions> {}

interface CellData {
  display: string;
  content?: unknown;
  displayType: ColumnDisplayType;
  alignment: ValueAlignment;
  color?: string;
  fieldMin?: number | null;
  fieldMax?: number | null;
  thresholdColor?: string;
}

interface RowData {
  cells: CellData[];
}

function parseToRgba(color: string): { r: number; g: number; b: number; a: number } {
  const fallback = { r: 0, g: 126, b: 122, a: 1 };
  if (!color) {
    return fallback;
  }
  color = color.trim().toLowerCase();

  if (color.startsWith('#')) {
    let hex = color.substring(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
    return {
      r: parseInt(hex.substring(0, 2), 16) || 0,
      g: parseInt(hex.substring(2, 4), 16) || 0,
      b: parseInt(hex.substring(4, 6), 16) || 0,
      a: 1,
    };
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  return fallback;
}

function adjustLuminosity(color: string, amount: number): string {
  const { r, g, b, a } = parseToRgba(color);
  const nr = Math.min(255, Math.round(r + (255 - r) * amount));
  const ng = Math.min(255, Math.round(g + (255 - g) * amount));
  const nb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgba(${nr}, ${ng}, ${nb}, ${a})`;
}

/**
 * 9.2/9.7: mescla a cor do accent com o fundo escuro (#0c101b)
 * para produzir uma cor sólida de zebrado que funcione com qualquer tema
 * (cores claras como blue/green são escurecidas automaticamente).
 */
function blendWithDark(accentHex: string, opacity: number): string {
  const { r, g, b } = parseToRgba(accentHex);
  const darkR = 12, darkG = 16, darkB = 27; // #0c101b
  const nr = Math.round(darkR + (r - darkR) * opacity);
  const ng = Math.round(darkG + (g - darkG) * opacity);
  const nb = Math.round(darkB + (b - darkB) * opacity);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

// 9.7: sem parâmetro backgroundColor — fundo fixo por tema
const getStyles = (
  baseColor: string,
  altColor: string,
  themeAccent: string
) => {
  const baseBg = '#0c101b';
  const themeGradient = `linear-gradient(180deg, ${themeAccent}12 0%, ${themeAccent}02 100%)`;

  return {
    wrapper: css`
      position: relative;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      overflow: hidden;
      background-color: ${baseBg};
      background-image: ${themeGradient};
      font-family: inherit;

      &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, rgba(0, 0, 0, 0.15) 100%);
        pointer-events: none;
        border-radius: 11px;
        z-index: 2;
      }
    `,
    inner: css`
      width: 100%;
      height: 100%;
      overflow: auto;
      box-sizing: border-box;
      position: relative;
      z-index: 3;

      /* Firefox */
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.18) transparent;

      /* Chrome / Edge / Safari */
      &::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }
      &::-webkit-scrollbar-track {
        background: transparent;
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.18);
        border-radius: 2px;
      }
      &::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.30);
      }
    `,
    table: css`
      position: relative;
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      line-height: 1.35;
      color: rgba(255, 255, 255, 0.85);
    `,
    th: css`
      position: sticky;
      top: 0;
      z-index: 4;
      padding: 5px 8px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.55);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      background: ${baseBg};
      white-space: nowrap;
      font-weight: 600;
    `,
    tdOdd: css`
      padding: 3px 8px;
      background: ${baseColor};
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
      transition: background-color 0.15s ease;
    `,
    tdEven: css`
      padding: 3px 8px;
      background: ${altColor};
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
      transition: background-color 0.15s ease;
    `,
    tr: css`
      &:hover td {
        background-image: linear-gradient(rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04));
      }
    `,
    alignLeft: css`
      text-align: left;
    `,
    alignCenter: css`
      text-align: center;
    `,
    alignRight: css`
      text-align: right;
    `,
    badge: css`
      display: inline-block;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.5;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      position: relative;
      overflow: hidden;
      z-index: 1;
    `,
    badgeBg: css`
      position: absolute;
      inset: 0;
      opacity: 0.12;
      z-index: -1;
    `,
    progressTrack: css`
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 90px;
    `,
    progressFill: css`
      display: inline-block;
      height: 5px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.15);
      overflow: hidden;
      flex: 1;
      min-width: 40px;
    `,
    progressInner: css`
      height: 100%;
      border-radius: 3px;
    `,
    progressText: css`
      font-size: 10px;
      color: rgba(255, 255, 255, 0.7);
      font-variant-numeric: tabular-nums;
    `,
  };
};

export const TableView: React.FC<Props> = ({ options, data, width, height }) => {
  const { accent } = THEME_COLORS[options.theme] ?? THEME_COLORS.vale;
  // 9.2/9.7: zebrado derivado do accent do tema (não mais tableBaseColor separado)
  // Mescla accent com fundo escuro a 35% para produzir cor de fundo sólida e escura
  const baseColor = blendWithDark(accent, 0.35);
  const evenColor = adjustLuminosity(baseColor, 0.10);
  const styles = useStyles2(() => getStyles(baseColor, evenColor, accent));

  const { rows, fieldHeaders } = useMemo(() => {
    const series = data.series[0];
    if (!series) {
      return { rows: [] as RowData[], fieldHeaders: [] as any[] };
    }

    interface FieldHeader {
      name: string;
      field: Field;
      kind: 'time' | 'number' | 'string';
      displayType: ColumnDisplayType;
      alignment: ValueAlignment;
    }

    const fieldHeaders: FieldHeader[] = [];
    const timeField = series.fields.find((f) => f.type === FieldType.time);
    if (timeField) {
      fieldHeaders.push({
        name: 'Tempo',
        field: timeField,
        kind: 'time',
        displayType: timeField.config?.custom?.displayType ?? 'text',
        alignment: timeField.config?.custom?.alignment ?? 'left',
      });
    }
    for (const f of series.fields) {
      if (f.type === FieldType.number) {
        fieldHeaders.push({
          name: f.name,
          field: f,
          kind: 'number',
          displayType: f.config?.custom?.displayType ?? 'text',
          // 9.2: sem tableValueAlignment — alinhamento vem do field config ou default 'right'
          alignment: f.config?.custom?.alignment ?? 'right',
        });
      }
    }
    for (const f of series.fields) {
      if (f.type === FieldType.string) {
        fieldHeaders.push({
          name: f.name,
          field: f,
          kind: 'string',
          displayType: f.config?.custom?.displayType ?? 'text',
          alignment: f.config?.custom?.alignment ?? 'left',
        });
      }
    }
    const rows: RowData[] = [];
    const maxLen = series.length;

    for (let i = 0; i < maxLen; i++) {
      const cells: CellData[] = [];
      for (const fh of fieldHeaders) {
        const rawValue = (fh.field.values as any)[i];

        if (fh.kind === 'time') {
          const d = new Date(rawValue);
          cells.push({
            display: d.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }),
            displayType: fh.displayType,
            alignment: fh.alignment,
          });
          continue;
        }

        if (fh.kind === 'number') {
          // 9.1: usar display processor nativo para respeitar Unit/Decimals
          const displayInfo = fh.field.display ? fh.field.display(rawValue) : null;
          const display = displayInfo ? formattedValueToString(displayInfo) : String(rawValue);
          const color = displayInfo?.color;

          let thresholdColor: string | undefined;
          if (
            fh.displayType === 'colorByThreshold' &&
            typeof rawValue === 'number' &&
            fh.field.config?.thresholds?.steps
          ) {
            const t = getActiveThreshold(rawValue, fh.field.config.thresholds.steps);
            if (t?.color) {
              thresholdColor = t.color;
            }
          }
          cells.push({
            display,
            content: rawValue,
            displayType: fh.displayType,
            alignment: fh.alignment,
            color,
            fieldMin: fh.field.config?.min,
            fieldMax: fh.field.config?.max,
            thresholdColor,
          });
        } else {
          // String field
          const displayInfo = fh.field.display ? fh.field.display(rawValue) : null;
          const display = displayInfo ? formattedValueToString(displayInfo) : String(rawValue);
          const color = displayInfo?.color; // Cor do Value Mapping nativo

          cells.push({
            display,
            content: rawValue,
            displayType: fh.displayType,
            alignment: fh.alignment,
            color,
          });
        }
      }
      rows.push({ cells });
    }
    return { rows, fieldHeaders };
  }, [data]);

  const getAlignClass = (align: ValueAlignment) => {
    if (align === 'left') {
      return styles.alignLeft;
    }
    if (align === 'center') {
      return styles.alignCenter;
    }
    return styles.alignRight;
  };

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      <div className={styles.inner}>
        <table className={styles.table}>
          <thead>
            <tr>
              {fieldHeaders.map((fh, i) => (
                <th key={i} className={`${styles.th} ${getAlignClass(fh.alignment)}`}>
                  {fh.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={styles.tr}>
                {row.cells.map((cell, ci) => {
                  const cellClass = ri % 2 === 0 ? styles.tdOdd : styles.tdEven;
                  const alignStyle = getAlignClass(cell.alignment);

                  if (cell.displayType === 'badge') {
                    const badgeColor = cell.color || 'rgba(255, 255, 255, 0.4)';
                    return (
                      <td key={ci} className={`${cellClass} ${alignStyle}`}>
                        <span className={styles.badge} style={{ color: badgeColor }}>
                          <span className={styles.badgeBg} style={{ backgroundColor: badgeColor }} />
                          {cell.display}
                        </span>
                      </td>
                    );
                  }

                  if (cell.displayType === 'progressBar' && typeof cell.content === 'number') {
                    const val = cell.content;
                    const min = cell.fieldMin ?? 0;
                    const max = cell.fieldMax ?? 100;
                    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min || 1)) * 100));
                    return (
                      <td key={ci} className={`${cellClass} ${alignStyle}`}>
                        <span className={styles.progressTrack}>
                          <span className={styles.progressFill}>
                            <span
                              className={styles.progressInner}
                              style={{ width: `${pct}%`, backgroundColor: accent }}
                            />
                          </span>
                          <span className={styles.progressText}>{cell.display}</span>
                        </span>
                      </td>
                    );
                  }

                  if (cell.displayType === 'colorByThreshold' && cell.thresholdColor) {
                    return (
                      <td key={ci} className={`${cellClass} ${alignStyle}`} style={{ color: cell.thresholdColor, fontWeight: 600 }}>
                        {cell.display}
                      </td>
                    );
                  }

                  return (
                    <td key={ci} className={`${cellClass} ${alignStyle}`}>
                      {cell.display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
