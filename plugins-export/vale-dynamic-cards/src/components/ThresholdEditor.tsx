import React, { useCallback } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { css } from '@emotion/css';
import { useTheme2 } from '@grafana/ui';
import { NativeThresholdsConfig, ThresholdStep } from '../types';

// ─── Paleta de cores padrão para novos steps ──────────────────────────────
const PRESET_COLORS = [
  '#73bf69', // green
  '#fade2a', // yellow
  '#f2495c', // red
  '#5794f2', // blue
  '#b877d9', // purple
  '#ff9830', // orange
  '#37872d', // dark green
  '#c4162a', // dark red
];

// ─── Padrão vazio ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG: NativeThresholdsConfig = {
  mode: 'absolute',
  steps: [
    { value: null, color: '#73bf69' }, // base
  ],
};

type Props = StandardEditorProps<NativeThresholdsConfig>;

export const ThresholdEditor: React.FC<Props> = ({ value, onChange }) => {
  const theme = useTheme2();
  const cfg: NativeThresholdsConfig = value ?? DEFAULT_CONFIG;

  const isDark = theme.isDark;
  const borderColor   = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
  const surfaceBg     = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const textColor     = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
  const subTextColor  = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const btnBg         = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const btnHover      = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
  const inputBg       = isDark ? 'rgba(0,0,0,0.25)' : '#fff';
  const activeModeBtn = isDark ? '#5794f2' : '#1f60c4';

  const styles = {
    root: css`
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      font-family: ${theme.typography.fontFamily};
      color: ${textColor};
    `,
    modeRow: css`
      display: flex;
      gap: 4px;
      margin-bottom: 4px;
    `,
    modeBtn: css`
      flex: 1;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid ${borderColor};
      background: ${btnBg};
      color: ${textColor};
      cursor: pointer;
      font-size: 11px;
      text-align: center;
      transition: background 0.15s;
      &:hover { background: ${btnHover}; }
    `,
    modeBtnActive: css`
      background: ${activeModeBtn};
      border-color: ${activeModeBtn};
      color: #fff;
      &:hover { background: ${activeModeBtn}; }
    `,
    stepRow: css`
      display: flex;
      align-items: center;
      gap: 6px;
      background: ${surfaceBg};
      border: 1px solid ${borderColor};
      border-radius: 6px;
      padding: 5px 8px;
    `,
    colorSwatch: css`
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: 1px solid ${borderColor};
      cursor: pointer;
      flex-shrink: 0;
      position: relative;
      overflow: hidden;
    `,
    colorInput: css`
      position: absolute;
      inset: -2px;
      opacity: 0;
      cursor: pointer;
      width: 28px;
      height: 28px;
    `,
    valueInput: css`
      flex: 1;
      background: ${inputBg};
      border: 1px solid ${borderColor};
      border-radius: 4px;
      color: ${textColor};
      padding: 3px 6px;
      font-size: 12px;
      min-width: 0;
      font-family: ${theme.typography.fontFamilyMonospace};
      &:focus { outline: none; border-color: ${activeModeBtn}; }
    `,
    baseLabel: css`
      color: ${subTextColor};
      font-size: 11px;
      flex: 1;
      font-style: italic;
    `,
    removeBtn: css`
      background: transparent;
      border: none;
      color: ${subTextColor};
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
      &:hover { color: #f2495c; }
    `,
    addBtn: css`
      width: 100%;
      padding: 5px;
      background: ${btnBg};
      border: 1px dashed ${borderColor};
      border-radius: 6px;
      color: ${textColor};
      cursor: pointer;
      font-size: 12px;
      text-align: center;
      margin-top: 2px;
      transition: background 0.15s;
      &:hover { background: ${btnHover}; }
    `,
  };

  const setMode = useCallback((mode: 'absolute' | 'percentage') => {
    onChange({ ...cfg, mode });
  }, [cfg, onChange]);

  const setColor = useCallback((idx: number, color: string) => {
    const steps = [...cfg.steps];
    steps[idx] = { ...steps[idx], color };
    onChange({ ...cfg, steps });
  }, [cfg, onChange]);

  const setValue = useCallback((idx: number, raw: string) => {
    if (idx === 0) { return; } // base não tem value
    const num = parseFloat(raw);
    const steps = [...cfg.steps];
    steps[idx] = { ...steps[idx], value: isNaN(num) ? 0 : num };
    onChange({ ...cfg, steps });
  }, [cfg, onChange]);

  const addStep = useCallback(() => {
    const lastVal = cfg.steps.filter((s) => s.value !== null).reduce((m, s) => Math.max(m, s.value ?? 0), 0);
    const color = PRESET_COLORS[cfg.steps.length % PRESET_COLORS.length] ?? '#f2495c';
    const steps: ThresholdStep[] = [...cfg.steps, { value: lastVal + 10, color }];
    // mantém ordenado por value (null primeiro)
    steps.sort((a, b) => {
      if (a.value === null) { return -1; }
      if (b.value === null) { return 1; }
      return a.value - b.value;
    });
    onChange({ ...cfg, steps });
  }, [cfg, onChange]);

  const removeStep = useCallback((idx: number) => {
    if (idx === 0) { return; } // não remove base
    const steps = cfg.steps.filter((_, i) => i !== idx);
    onChange({ ...cfg, steps });
  }, [cfg, onChange]);

  // Ordena: base (null) primeiro, depois por value crescente
  const sorted = [...cfg.steps].sort((a, b) => {
    if (a.value === null) { return -1; }
    if (b.value === null) { return 1; }
    return a.value - b.value;
  });

  return (
    <div className={styles.root}>
      {/* Modo */}
      <div className={styles.modeRow}>
        <button
          className={`${styles.modeBtn} ${cfg.mode === 'absolute' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('absolute')}
        >Absoluto</button>
        <button
          className={`${styles.modeBtn} ${cfg.mode === 'percentage' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('percentage')}
        >Percentual</button>
      </div>

      {/* Steps */}
      {sorted.map((step, si) => {
        // índice original no cfg.steps (para edição correta)
        const origIdx = cfg.steps.indexOf(step);
        const isBase  = step.value === null;
        return (
          <div key={si} className={styles.stepRow}>
            {/* Swatch + color picker nativo */}
            <div
              className={styles.colorSwatch}
              style={{ backgroundColor: step.color }}
              title="Clique para mudar a cor"
            >
              <input
                type="color"
                className={styles.colorInput}
                value={step.color.length === 7 ? step.color : '#73bf69'}
                onChange={(e) => setColor(origIdx, e.target.value)}
              />
            </div>

            {isBase ? (
              <span className={styles.baseLabel}>Base (padrão)</span>
            ) : (
              <input
                className={styles.valueInput}
                type="number"
                value={step.value ?? ''}
                onChange={(e) => setValue(origIdx, e.target.value)}
                placeholder="valor"
              />
            )}

            {!isBase && (
              <button className={styles.removeBtn} onClick={() => removeStep(origIdx)} title="Remover">×</button>
            )}
          </div>
        );
      })}

      {/* Adicionar step */}
      <button className={styles.addBtn} onClick={addStep}>
        + Adicionar threshold
      </button>
    </div>
  );
};
