import React, { useState, useEffect } from 'react';
import { StandardEditorProps, SelectableValue } from '@grafana/data';
import { Select, Input, ColorPicker, RadioButtonGroup, useTheme2 } from '@grafana/ui';
import {
  TimeSeriesOverrideConfig,
  BadgeOverrideConfig,
  ProgressOverrideConfig,
  TextOverrideConfig,
  DeltaOverrideConfig,
  AlertOverrideConfig,
  LineInterpolation,
  TimeSeriesValueMode,
  BadgeSize,
  BadgeVisual,
  ProgressHeight,
  ProgressColorMode,
  ThresholdComparisonMode,
  DeltaValueFormat,
} from '../types';

// ─── Estilos utilitários compartilhados para os cards de Aba em Overrides ─────

const VALE_DEFAULT_ACCENT = '#00B59B';

const getCardContainerStyle = (isDark: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '12px',
  borderRadius: '6px',
  background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)',
  border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
  marginTop: '4px',
  marginBottom: '4px',
});

const getSectionHeaderStyle = (isDark: boolean, accentColor = VALE_DEFAULT_ACCENT): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingBottom: '6px',
  marginBottom: '2px',
  borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.07)' : '1px solid rgba(0, 0, 0, 0.07)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: accentColor,
});

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  minHeight: '30px',
};

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const getLabelStyle = (isDark: boolean): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 500,
  color: isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.85)',
  lineHeight: 1.3,
});

const getDescStyle = (isDark: boolean): React.CSSProperties => ({
  fontSize: '11px',
  color: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
  lineHeight: 1.25,
});

/**
 * Evita que o <label> externo do Grafana (Field wrapper em Override Properties)
 * intercepte cliques e jogue o foco para o primeiro <Select>/<Input> do card.
 */
const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
  const target = e.target as HTMLElement;
  if (target && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
};

/**
 * Toggle Switch customizado baseado em <button type="button"> para evitar
 * o bug de <label> aninhado do Grafana em Override Properties (que desviava
 * o clique do Switch para o primeiro campo do card).
 */
const OverrideToggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  accentColor?: string;
}> = ({ checked, onChange, accentColor = VALE_DEFAULT_ACCENT }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
      style={{
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '999px',
        border: checked
          ? `1px solid ${accentColor}`
          : '1px solid rgba(255, 255, 255, 0.22)',
        backgroundColor: checked ? accentColor : 'rgba(255, 255, 255, 0.12)',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        outline: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '18px' : '2px',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
          transition: 'left 0.15s ease',
        }}
      />
    </button>
  );
};

/**
 * Input numérico que permite digitar e apagar livremente sem travar no min/max
 * a cada tecla, aplicando validação apenas ao finalizar (onBlur / Enter) ou quando válido.
 */
const NumericOverrideInput: React.FC<{
  value: number | undefined;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  onChange: (val: number | undefined) => void;
}> = ({
  value,
  defaultValue,
  min,
  max,
  step = 1,
  allowEmpty = false,
  placeholder,
  onChange,
}) => {
  const resolvedProp = value !== undefined ? String(value) : (allowEmpty ? '' : String(defaultValue ?? ''));
  const [text, setText] = useState<string>(resolvedProp);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(value !== undefined ? String(value) : (allowEmpty ? '' : String(defaultValue ?? '')));
    }
  }, [value, defaultValue, allowEmpty, isFocused]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (allowEmpty) {
        setText('');
        onChange(undefined);
      } else {
        const fallback = defaultValue ?? min ?? 0;
        setText(String(fallback));
        onChange(fallback);
      }
      return;
    }
    let num = parseFloat(trimmed);
    if (isNaN(num)) {
      if (allowEmpty) {
        setText('');
        onChange(undefined);
      } else {
        const fallback = defaultValue ?? min ?? 0;
        setText(String(fallback));
        onChange(fallback);
      }
      return;
    }
    if (min !== undefined) num = Math.max(min, num);
    if (max !== undefined) num = Math.min(max, num);
    setText(String(num));
    onChange(num);
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setText(raw);
        const trimmed = raw.trim();
        if (!trimmed && allowEmpty) {
          onChange(undefined);
          return;
        }
        const num = parseFloat(trimmed);
        if (!isNaN(num)) {
          const aboveMin = min === undefined || num >= min;
          const belowMax = max === undefined || num <= max;
          if (aboveMin && belowMax) {
            onChange(num);
          }
        }
      }}
      onBlur={(e) => {
        setIsFocused(false);
        commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit((e.currentTarget as HTMLInputElement).value);
        }
      }}
    />
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ABA COMPLETA: GRÁFICO (TIME SERIES / SPARKLINE)
// ═══════════════════════════════════════════════════════════════════════════════

const VALUE_MODE_OPTIONS: Array<SelectableValue<TimeSeriesValueMode>> = [
  { value: 'text', label: 'Texto / Valor' },
  { value: 'badge', label: 'Badge / Status' },
  { value: 'hidden', label: 'Oculto' },
];

const INTERPOLATION_OPTIONS: Array<SelectableValue<LineInterpolation>> = [
  { value: 'smooth', label: 'Suave / Arredondado' },
  { value: 'straight', label: 'Reto (Linear)' },
  { value: 'stepBefore', label: 'Degraus (Antes)' },
  { value: 'stepAfter', label: 'Degraus (Depois)' },
];

export const TimeSeriesOverrideEditor: React.FC<StandardEditorProps<TimeSeriesOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: TimeSeriesOverrideConfig = value || {};

  const update = (patch: Partial<TimeSeriesOverrideConfig>) => {
    const next: TimeSeriesOverrideConfig = {
      ...cfg,
      ...patch,
    };
    if ('sparklineHeight' in patch && patch.sparklineHeight === undefined) {
      delete next.sparklineHeight;
    }
    onChange(next);
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, '#00B59B')}>
        <span>📈 Aba de Configuração — Time Series / Sparkline</span>
      </div>

      {/* Exibição do Valor no Gráfico */}
      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Exibição do Valor no Gráfico</span>
        <RadioButtonGroup
          options={VALUE_MODE_OPTIONS}
          value={cfg.timeSeriesValueMode ?? 'text'}
          onChange={(v) => update({ timeSeriesValueMode: v })}
          size="sm"
          fullWidth
        />
      </div>

      {/* Traçado da Linha */}
      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Traçado da Linha</span>
        <Select
          options={INTERPOLATION_OPTIONS}
          value={cfg.lineInterpolation ?? 'smooth'}
          onChange={(v) => update({ lineInterpolation: (v.value as LineInterpolation) ?? 'smooth' })}
        />
      </div>

      {/* Espessura e Altura */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'start' }}>
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Espessura da Linha (px)</span>
          <NumericOverrideInput
            value={cfg.lineWidth}
            defaultValue={1.5}
            min={0.5}
            max={6}
            step={0.5}
            onChange={(v) => update({ lineWidth: v ?? 1.5 })}
          />
          <span style={getDescStyle(isDark)}>Padrão recomendado: 1.5px a 2px</span>
        </div>

        <div style={colStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <span style={getLabelStyle(isDark)}>Altura Customizada (px)</span>
            {cfg.sparklineHeight !== undefined && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  update({ sparklineHeight: undefined });
                }}
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: VALE_DEFAULT_ACCENT,
                  background: 'rgba(0, 181, 155, 0.12)',
                  border: '1px solid rgba(0, 181, 155, 0.35)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
                title="Voltar para altura automática da linha"
              >
                ↺ Auto
              </button>
            )}
          </div>
          <NumericOverrideInput
            value={cfg.sparklineHeight}
            min={14}
            max={250}
            step={2}
            allowEmpty={true}
            placeholder="Automática (ex: 24)"
            onChange={(v) => update({ sparklineHeight: v })}
          />
          <span style={getDescStyle(isDark)}>
            Recomendado: <strong>22px a 28px</strong> (ou vazio p/ Automática)
          </span>
        </div>
      </div>

      {/* Opacidade da Linha e Opacidade da Área */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Opacidade da Linha (%)</span>
          <NumericOverrideInput
            value={cfg.sparklineLineOpacity}
            defaultValue={100}
            min={10}
            max={100}
            step={5}
            onChange={(v) => update({ sparklineLineOpacity: v ?? 100 })}
          />
        </div>

        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Opacidade da Área (%)</span>
          <NumericOverrideInput
            value={cfg.areaOpacity}
            defaultValue={25}
            min={0}
            max={100}
            step={5}
            onChange={(v) => update({ areaOpacity: v ?? 25 })}
          />
        </div>
      </div>

      {/* Cor da Linha */}
      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Cor da Linha do Gráfico</span>
          <span style={getDescStyle(isDark)}>Cor base quando não sobreposta por threshold</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ColorPicker
            color={cfg.lineColor || '#00B59B'}
            onChange={(color) => update({ lineColor: color })}
          />
        </div>
      </div>

      {/* Colorir Linha pelo Threshold */}
      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Linha pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica a cor do threshold ativo à linha inteira e área</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.sparklineFollowThreshold)}
          onChange={(checked) => update({ sparklineFollowThreshold: checked })}
        />
      </div>

      {/* Colorir Cada Parte da Linha pelo Threshold */}
      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Cada Parte pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Colore cada trecho violado com a respectiva cor de alerta</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.binaryStepHighlight)}
          onChange={(checked) => update({ binaryStepHighlight: checked })}
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ABA COMPLETA: BADGE / PÍLULA DE STATUS
// ═══════════════════════════════════════════════════════════════════════════════

const BADGE_SIZE_OPTIONS: Array<SelectableValue<BadgeSize>> = [
  { value: 'sm', label: 'Pequeno (sm)' },
  { value: 'md', label: 'Médio (md)' },
  { value: 'lg', label: 'Grande (lg)' },
];

const BADGE_STYLE_OPTIONS: Array<SelectableValue<BadgeVisual>> = [
  { value: 'subtle', label: 'Sutil (Translúcido)' },
  { value: 'solid', label: 'Sólido (Preenchido)' },
  { value: 'outline', label: 'Contorno (Borda)' },
];

export const BadgeOverrideEditor: React.FC<StandardEditorProps<BadgeOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: BadgeOverrideConfig = value || {};

  const update = (patch: Partial<BadgeOverrideConfig>) => {
    onChange({
      ...cfg,
      ...patch,
    });
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, VALE_DEFAULT_ACCENT)}>
        <span>🏷️ Aba de Configuração — Badge / Status</span>
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Tamanho do Badge</span>
        <RadioButtonGroup
          options={BADGE_SIZE_OPTIONS}
          value={cfg.badgeSize ?? 'sm'}
          onChange={(v) => update({ badgeSize: v })}
          size="sm"
          fullWidth
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Estilo Visual do Badge</span>
        <RadioButtonGroup
          options={BADGE_STYLE_OPTIONS}
          value={cfg.badgeStyle ?? 'subtle'}
          onChange={(v) => update({ badgeStyle: v })}
          size="sm"
          fullWidth
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Badge pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica cores de threshold ao status do badge</span>
        </div>
        <OverrideToggle
          checked={cfg.useThresholdColors ?? true}
          onChange={(checked) => update({ useThresholdColors: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ABA COMPLETA: BARRAS DE PROGRESSO E VU INDUSTRIAL
// ═══════════════════════════════════════════════════════════════════════════════

const BAR_TYPE_OPTIONS: Array<SelectableValue<'progressBar' | 'segmentedBar'>> = [
  { value: 'progressBar', label: 'Barra Contínua' },
  { value: 'segmentedBar', label: 'VU Industrial (10 Barras)' },
];

const PROGRESS_HEIGHT_OPTIONS: Array<SelectableValue<ProgressHeight>> = [
  { value: '6px', label: 'Fina (6px)' },
  { value: '8px', label: 'Média (8px)' },
  { value: '12px', label: 'Alta (12px)' },
];

const PROGRESS_COLOR_MODE_OPTIONS: Array<SelectableValue<ProgressColorMode>> = [
  { value: 'gradient', label: 'Gradual (Gradiente)' },
  { value: 'threshold', label: 'Toda a Barra (Threshold Atual)' },
];

export const ProgressOverrideEditor: React.FC<StandardEditorProps<ProgressOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: ProgressOverrideConfig = value || {};
  const barType = cfg.barType ?? 'progressBar';

  const update = (patch: Partial<ProgressOverrideConfig>) => {
    onChange({
      ...cfg,
      ...patch,
    });
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, VALE_DEFAULT_ACCENT)}>
        <span>📊 Aba de Configuração — Barras e VU Industrial</span>
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Tipo de Visualização</span>
        <RadioButtonGroup
          options={BAR_TYPE_OPTIONS}
          value={barType}
          onChange={(v) => update({ barType: v })}
          size="sm"
          fullWidth
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Mínimo da Escala</span>
          <NumericOverrideInput
            value={cfg.progressMin}
            defaultValue={0}
            onChange={(v) => update({ progressMin: v ?? 0 })}
          />
        </div>

        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Máximo da Escala</span>
          <NumericOverrideInput
            value={cfg.progressMax}
            defaultValue={100}
            onChange={(v) => update({ progressMax: v ?? 100 })}
          />
        </div>
      </div>

      {barType === 'progressBar' && (
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Altura da Barra de Progresso</span>
          <RadioButtonGroup
            options={PROGRESS_HEIGHT_OPTIONS}
            value={cfg.progressHeight ?? '6px'}
            onChange={(v) => update({ progressHeight: v })}
            size="sm"
            fullWidth
          />
        </div>
      )}

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Cor Base da Barra</span>
          <span style={getDescStyle(isDark)}>Cor padrão quando saudável / sem threshold</span>
        </div>
        <ColorPicker
          color={cfg.lineColor || '#00B59B'}
          onChange={(color) => update({ lineColor: color })}
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Exibir Valor Numérico</span>
          <span style={getDescStyle(isDark)}>Mostra o valor formatado ao lado da barra ou VU</span>
        </div>
        <OverrideToggle
          checked={cfg.showProgressValue ?? true}
          onChange={(checked) => update({ showProgressValue: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      {(cfg.showProgressValue ?? true) && (
        <div style={rowStyle}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={getLabelStyle(isDark)}>Colorir Valor Numérico pelo Threshold</span>
            <span style={getDescStyle(isDark)}>Aplica a cor do threshold ativo também ao texto numérico ao lado da barra</span>
          </div>
          <OverrideToggle
            checked={Boolean(cfg.colorValueByThreshold)}
            onChange={(checked) => update({ colorValueByThreshold: checked })}
            accentColor={VALE_DEFAULT_ACCENT}
          />
        </div>
      )}

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica a cor do threshold violado na barra</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.useThresholdColors)}
          onChange={(checked) => update({ useThresholdColors: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      {Boolean(cfg.useThresholdColors) && (
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Modo de Cor do Preenchimento</span>
          <span style={getDescStyle(isDark)}>Escolha entre degradê gradual pela escala ou preencher a barra toda com a cor do threshold ativo</span>
          <RadioButtonGroup
            options={PROGRESS_COLOR_MODE_OPTIONS}
            value={cfg.progressColorMode ?? 'gradient'}
            onChange={(v) => update({ progressColorMode: v })}
            size="sm"
            fullWidth
          />
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ABA COMPLETA: TEXTO E TIPOGRAFIA
// ═══════════════════════════════════════════════════════════════════════════════

const TEXT_FONT_SIZE_OPTIONS: Array<SelectableValue<string>> = [
  { value: '10px', label: '10px' },
  { value: '11.5px', label: '11.5px' },
  { value: '13px', label: '13px' },
  { value: '15px', label: '15px' },
];

const TEXT_WEIGHT_OPTIONS: Array<SelectableValue<string>> = [
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Médio' },
  { value: '600', label: 'Semi-Bold' },
  { value: '700', label: 'Negrito' },
];

export const TextOverrideEditor: React.FC<StandardEditorProps<TextOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: TextOverrideConfig = value || {};

  const update = (patch: Partial<TextOverrideConfig>) => {
    onChange({
      ...cfg,
      ...patch,
    });
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, VALE_DEFAULT_ACCENT)}>
        <span>🔤 Aba de Configuração — Texto e Tipografia</span>
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Tamanho da Fonte</span>
        <RadioButtonGroup
          options={TEXT_FONT_SIZE_OPTIONS}
          value={cfg.textFontSize ?? '11.5px'}
          onChange={(v) => update({ textFontSize: v })}
          size="sm"
          fullWidth
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Peso da Fonte</span>
        <RadioButtonGroup
          options={TEXT_WEIGHT_OPTIONS}
          value={cfg.textWeight ?? '500'}
          onChange={(v) => update({ textWeight: v })}
          size="sm"
          fullWidth
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Texto pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica a cor do threshold ativo ao valor textual</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.useThresholdColors)}
          onChange={(checked) => update({ useThresholdColors: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ABA COMPLETA: TENDÊNCIA DELTA (VS MÉDIA)
// ═══════════════════════════════════════════════════════════════════════════════

const DELTA_COLOR_MODE_OPTIONS: Array<SelectableValue<'proximity' | 'direction' | 'threshold' | 'neutral'>> = [
  { value: 'proximity', label: 'Proximidade do Threshold' },
  { value: 'direction', label: 'Direção (Subida / Descida)' },
  { value: 'threshold', label: 'Apenas em Violação Ativa' },
  { value: 'neutral', label: 'Neutro' },
];

const DELTA_REF_MODE_OPTIONS: Array<SelectableValue<'mean' | 'first' | 'prev'>> = [
  { value: 'mean', label: 'Média do Período (Padrão ISA-101)' },
  { value: 'first', label: 'Primeiro Valor da Série Temporal' },
  { value: 'prev', label: 'Valor Imediatamente Anterior' },
];

const DELTA_COMP_DIR_OPTIONS: Array<SelectableValue<ThresholdComparisonMode>> = [
  { value: 'gte', label: 'Maior é Pior / Alarme Superior (>=)' },
  { value: 'lte', label: 'Menor é Pior / Alarme Inferior (<=)' },
];

const DELTA_VALUE_FORMAT_OPTIONS: Array<SelectableValue<DeltaValueFormat>> = [
  { value: 'percent', label: 'Percentual (%) — Padrão' },
  { value: 'absolute', label: 'Absoluto' },
  { value: 'both', label: 'Ambos (Absoluto + %)' },
];

export const DeltaOverrideEditor: React.FC<StandardEditorProps<DeltaOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: DeltaOverrideConfig = value || {};

  const update = (patch: Partial<DeltaOverrideConfig>) => {
    onChange({
      ...cfg,
      ...patch,
    });
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, VALE_DEFAULT_ACCENT)}>
        <span>📐 Aba de Configuração — Tendência Delta</span>
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Exibir Valor do Delta (Diferença)</span>
          <span style={getDescStyle(isDark)}>Exibe a variação numérica ao lado do símbolo de tendência (▲/▼/●)</span>
        </div>
        <OverrideToggle
          checked={cfg.showDeltaValue ?? true}
          onChange={(checked) => update({ showDeltaValue: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Cálculo de Referência (Base do Delta)</span>
        <span style={getDescStyle(isDark)}>Define o valor base contra o qual o valor atual é comparado</span>
        <Select
          options={DELTA_REF_MODE_OPTIONS}
          value={cfg.deltaReferenceMode ?? 'mean'}
          onChange={(v) => update({ deltaReferenceMode: (v.value as any) ?? 'mean' })}
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Formato do Valor da Tendência</span>
        <span style={getDescStyle(isDark)}>Exibe a magnitude em percentual, absoluto ou ambos</span>
        <Select
          options={DELTA_VALUE_FORMAT_OPTIONS}
          value={cfg.deltaValueFormat ?? 'percent'}
          onChange={(v) => update({ deltaValueFormat: (v.value as any) ?? 'percent' })}
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Direção Crítica do Alarme</span>
        <span style={getDescStyle(isDark)}>Indica se valores crescentes ou decrescentes representam piora operacional</span>
        <Select
          options={DELTA_COMP_DIR_OPTIONS}
          value={cfg.deltaComparisonDirection ?? 'gte'}
          onChange={(v) => update({ deltaComparisonDirection: (v.value as any) ?? 'gte' })}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Zona de Proximidade (%)</span>
          <span style={getDescStyle(isDark)}>Margem preventiva (Padrão: 20%)</span>
          <NumericOverrideInput
            value={cfg.deltaProximityPct}
            defaultValue={20}
            min={1}
            max={100}
            step={1}
            onChange={(v) => update({ deltaProximityPct: v ?? 20 })}
          />
        </div>

        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Zona Morta / Deadband (%)</span>
          <span style={getDescStyle(isDark)}>Variações estáveis (●) (Padrão: 1%)</span>
          <NumericOverrideInput
            value={cfg.deltaDeadbandPct}
            defaultValue={1}
            min={0}
            max={20}
            step={0.5}
            onChange={(v) => update({ deltaDeadbandPct: v ?? 1 })}
          />
        </div>
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Destacar Alívio / Recuperação em Verde</span>
          <span style={getDescStyle(isDark)}>Sinaliza em verde suave quando a métrica recua ou se afasta do perigo</span>
        </div>
        <OverrideToggle
          checked={cfg.deltaHighlightRelief ?? true}
          onChange={(checked) => update({ deltaHighlightRelief: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Modo de Cor da Tendência</span>
        <Select
          options={DELTA_COLOR_MODE_OPTIONS}
          value={cfg.deltaTrendColorMode ?? 'proximity'}
          onChange={(v) => update({ deltaTrendColorMode: (v.value as any) ?? 'proximity' })}
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica matriz ISA-101 de alertas preventivos e violações ativas</span>
        </div>
        <OverrideToggle
          checked={cfg.useThresholdColors ?? true}
          onChange={(checked) => update({ useThresholdColors: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ABA COMPLETA: ALERTA, THRESHOLD E POP-UP (!)
// ═══════════════════════════════════════════════════════════════════════════════

const COMPARISON_MODE_OPTIONS: Array<SelectableValue<ThresholdComparisonMode>> = [
  { value: 'gte', label: 'Maior ou Igual (>=)' },
  { value: 'eq', label: 'Exatamente Igual (==)' },
  { value: 'lte', label: 'Menor ou Igual (<=)' },
];

const POPUP_DISPLAY_OPTIONS: Array<SelectableValue<'always' | 'alertOnly'>> = [
  { value: 'always', label: 'Em qualquer alerta (Ativo ou Histórico)' },
  { value: 'alertOnly', label: 'Apenas quando em alerta ativo' },
];

export const AlertOverrideEditor: React.FC<StandardEditorProps<AlertOverrideConfig>> = ({
  value,
  onChange,
}) => {
  const theme = useTheme2();
  const isDark = theme.isDark;
  const cfg: AlertOverrideConfig = value || {};
  const enablePopup = cfg.enableAlertPopup ?? true;

  const update = (patch: Partial<AlertOverrideConfig>) => {
    onChange({
      ...cfg,
      ...patch,
    });
  };

  return (
    <div style={getCardContainerStyle(isDark)} onClick={handleCardClick}>
      <div style={getSectionHeaderStyle(isDark, VALE_DEFAULT_ACCENT)}>
        <span>🚨 Aba de Configuração — Alerta e Pop-up (!)</span>
      </div>

      <div style={colStyle}>
        <span style={getLabelStyle(isDark)}>Modo de Comparação do Threshold</span>
        <Select
          options={COMPARISON_MODE_OPTIONS}
          value={cfg.thresholdComparisonMode ?? 'gte'}
          onChange={(v) => update({ thresholdComparisonMode: (v.value as ThresholdComparisonMode) ?? 'gte' })}
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Métrica pelo Threshold</span>
          <span style={getDescStyle(isDark)}>Aplica cores de threshold no valor e status desta métrica</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.useThresholdColors)}
          onChange={(checked) => update({ useThresholdColors: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Colorir Ícone pelo Threshold</span>
          <span style={getDescStyle(isDark)}>O ícone desta métrica assume a cor do threshold ativo</span>
        </div>
        <OverrideToggle
          checked={Boolean(cfg.colorIconByThreshold)}
          onChange={(checked) => update({ colorIconByThreshold: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      <div style={rowStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={getLabelStyle(isDark)}>Habilitar Botão / Pop-up de Alerta (!)</span>
          <span style={getDescStyle(isDark)}>Exibe o botão interativo (!) quando houver violação</span>
        </div>
        <OverrideToggle
          checked={enablePopup}
          onChange={(checked) => update({ enableAlertPopup: checked })}
          accentColor={VALE_DEFAULT_ACCENT}
        />
      </div>

      {enablePopup && (
        <div style={colStyle}>
          <span style={getLabelStyle(isDark)}>Modo de Exibição do Botão (!)</span>
          <Select
            options={POPUP_DISPLAY_OPTIONS}
            value={cfg.alertPopupDisplayMode ?? 'always'}
            onChange={(v) => update({ alertPopupDisplayMode: (v.value as 'always' | 'alertOnly') ?? 'always' })}
          />
        </div>
      )}
    </div>
  );
};
