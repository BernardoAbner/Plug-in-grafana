import React, { useState, useMemo, useLayoutEffect, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon } from '@grafana/ui';

export type FilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface ColumnFilterConfig {
  operator?: FilterOperator | null;
  operatorValue?: string;
  selectedValues?: string[];
}

export interface ColumnFilterModalProps {
  colKey: string;
  colTitle: string;
  anchorRect: DOMRect;
  currentFilter?: ColumnFilterConfig;
  uniqueValues: string[];
  theme: GrafanaTheme2;
  onApply: (colKey: string, filter: ColumnFilterConfig | null) => void;
  onClose: () => void;
  onExpand?: () => void;
}

const OPERATOR_OPTIONS: Array<{ op: FilterOperator; label: string; desc: string }> = [
  { op: '=', label: '=', desc: 'Igual a' },
  { op: '!=', label: '!=', desc: 'Diferente de' },
  { op: '>', label: '>', desc: 'Maior que' },
  { op: '>=', label: '>=', desc: 'Maior ou igual' },
  { op: '<', label: '<', desc: 'Menor que' },
  { op: '<=', label: '<=', desc: 'Menor ou igual' },
];

// Registro global de popups de filtro abertos para evitar sobreposição
const openFilterPopupRegistry: HTMLElement[] = [];

/**
 * Avalia se um valor textual da lista atende à condição do operador selecionado
 */
function matchesOperatorCondition(itemStr: string, op: FilterOperator, targetRaw: string): boolean {
  const targetStr = targetRaw.trim();
  if (!targetStr) {
    return true;
  }
  const cleanItemNum = parseFloat(itemStr.replace(',', '.'));
  const cleanTargetNum = parseFloat(targetStr.replace(',', '.'));
  const bothNumeric = !isNaN(cleanItemNum) && !isNaN(cleanTargetNum);

  if (bothNumeric) {
    if (op === '=') {
      return Math.abs(cleanItemNum - cleanTargetNum) < 1e-4;
    }
    if (op === '!=') {
      return Math.abs(cleanItemNum - cleanTargetNum) >= 1e-4;
    }
    if (op === '>') {
      return cleanItemNum > cleanTargetNum;
    }
    if (op === '>=') {
      return cleanItemNum >= cleanTargetNum;
    }
    if (op === '<') {
      return cleanItemNum < cleanTargetNum;
    }
    if (op === '<=') {
      return cleanItemNum <= cleanTargetNum;
    }
  }

  const a = itemStr.toLowerCase();
  const b = targetStr.toLowerCase();
  if (op === '=') {
    return a === b;
  }
  if (op === '!=') {
    return a !== b;
  }
  const cmp = itemStr.localeCompare(targetStr, undefined, { numeric: true });
  if (op === '>') {
    return cmp > 0;
  }
  if (op === '>=') {
    return cmp >= 0;
  }
  if (op === '<') {
    return cmp < 0;
  }
  if (op === '<=') {
    return cmp <= 0;
  }
  return true;
}

/**
 * Aba Lateral Esquerda (Left Side Drawer) para Filtro — paleta industrial ISA-101 do plugin
 */
const FilterLeftDrawer: React.FC<{
  colKey: string;
  colTitle: string;
  currentFilter?: ColumnFilterConfig;
  uniqueValues: string[];
  onApply: (colKey: string, filter: ColumnFilterConfig | null) => void;
  onCollapse: () => void;
  onClose: () => void;
}> = ({
  colKey,
  colTitle,
  currentFilter,
  uniqueValues,
  onApply,
  onCollapse,
  onClose,
}) => {
  const [entered, setEntered] = useState(false);

  const [draftOperator, setDraftOperator] = useState<FilterOperator | null>(
    currentFilter?.operator ?? null
  );
  const [inputText, setInputText] = useState<string>(
    currentFilter?.operator ? (currentFilter?.operatorValue ?? '') : ''
  );
  const [draftSelectedValues, setDraftSelectedValues] = useState<string[]>(
    currentFilter?.selectedValues && currentFilter.selectedValues.length > 0
      ? currentFilter.selectedValues
      : uniqueValues
  );
  const [isOpMenuOpen, setIsOpMenuOpen] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isOpMenuOpen) {
          setIsOpMenuOpen(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, isOpMenuOpen]);

  const visibleItems = useMemo(() => {
    const q = inputText.trim();
    if (!q) {
      return uniqueValues;
    }
    if (draftOperator) {
      return uniqueValues.filter((v) => matchesOperatorCondition(v, draftOperator, q));
    }
    const lower = q.toLowerCase();
    return uniqueValues.filter((v) => v.toLowerCase().includes(lower));
  }, [uniqueValues, inputText, draftOperator]);

  const isAllVisibleSelected = useMemo(() => {
    if (visibleItems.length === 0) {
      return false;
    }
    return visibleItems.every((v) => draftSelectedValues.includes(v));
  }, [visibleItems, draftSelectedValues]);

  const handleToggleItem = (val: string) => {
    setDraftSelectedValues((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const handleSelectAllVisible = () => {
    setDraftSelectedValues((prev) => {
      const set = new Set(prev);
      visibleItems.forEach((v) => set.add(v));
      return Array.from(set);
    });
  };

  const handleDeselectAllVisible = () => {
    setDraftSelectedValues((prev) => prev.filter((v) => !visibleItems.includes(v)));
  };

  const isFilterCurrentlyActive = Boolean(
    (draftOperator && inputText.trim() !== '') ||
      (draftSelectedValues.length > 0 && draftSelectedValues.length < uniqueValues.length)
  );

  const handleApply = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const isOpActive = Boolean(draftOperator && inputText.trim() !== '');
    const isSelectionCustom =
      draftSelectedValues.length > 0 && draftSelectedValues.length < uniqueValues.length;

    if (!isOpActive && !isSelectionCustom) {
      onApply(colKey, null);
    } else {
      onApply(colKey, {
        operator: isOpActive ? draftOperator : null,
        operatorValue: isOpActive ? inputText.trim() : '',
        selectedValues:
          draftSelectedValues.length === uniqueValues.length ? undefined : draftSelectedValues,
      });
    }
    onClose();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onApply(colKey, null);
    onClose();
  };

  const iconBtnStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer',
    opacity: 0.75,
    padding: 0,
    transition: 'opacity 0.15s ease, background-color 0.15s ease',
    flexShrink: 0,
  };

  return createPortal(
    <div
      data-alert-left-drawer="true"
      data-alert-popup="true"
      onClick={(e) => {
        e.stopPropagation();
        if (isOpMenuOpen) {
          setIsOpMenuOpen(false);
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 390,
        maxWidth: '90vw',
        zIndex: 99999,
        background: 'linear-gradient(180deg, #0d1720 0%, #0c141d 55%, #0b121a 100%)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '12px 0 36px rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        color: 'rgba(255, 255, 255, 0.88)',
        fontSize: 12,
        lineHeight: 1.5,
        pointerEvents: 'all',
        transform: entered ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* 1. Header da Aba Lateral */}
      <div
        style={{
          flexShrink: 0,
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.015)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Icon name="filter" size="sm" style={{ color: 'rgba(255, 255, 255, 0.7)', flexShrink: 0 }} />
            <span
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.92)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={colTitle}
            >
              {colTitle}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 11,
                color: 'rgba(255, 255, 255, 0.72)',
                padding: '1px 7px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {draftSelectedValues.length}/{uniqueValues.length}
            </span>
            <button
              type="button"
              title="Recolher para pop-up flutuante"
              style={iconBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
            >
              <Icon name="arrow-left" size="sm" />
            </button>
            <button
              type="button"
              title="Fechar (Esc)"
              style={{ ...iconBtnStyle, fontSize: 16, fontWeight: 600, lineHeight: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
          <span>Filtro de coluna</span>
          <span>{isFilterCurrentlyActive ? 'Filtro personalizado' : 'Todos exibidos'}</span>
        </div>
      </div>

      {/* 2. Corpo com Busca (com botão de Condição integrado) e Lista de Opções */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Barra de Busca com botão de Condição de Comparação dentro */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 6px 5px 10px',
              borderRadius: 6,
              background: 'rgba(0, 0, 0, 0.28)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
            }}
          >
            <Icon name="search" size="xs" style={{ color: 'rgba(255, 255, 255, 0.45)', flexShrink: 0 }} />
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                draftOperator
                  ? `Comparar (${draftOperator}) com valor...`
                  : 'Buscar na lista...'
              }
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 12,
                minWidth: 0,
              }}
            />
            {inputText && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setInputText('');
                }}
                style={{
                  cursor: 'pointer',
                  color: 'rgba(255, 255, 255, 0.45)',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: '0 2px',
                }}
                title="Limpar texto"
              >
                ×
              </span>
            )}

            {/* Botão de Condição de Comparação dentro da barra de busca */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpMenuOpen((prev) => !prev);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 4,
                border: draftOperator
                  ? '1px solid rgba(255, 255, 255, 0.28)'
                  : '1px solid rgba(255, 255, 255, 0.1)',
                background: draftOperator
                  ? 'rgba(255, 255, 255, 0.14)'
                  : 'rgba(255, 255, 255, 0.05)',
                color: draftOperator ? '#ffffff' : 'rgba(255, 255, 255, 0.65)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title="Selecionar condição de comparação (=, !=, >, >=, <, <=)"
            >
              <span>{draftOperator || 'Condição'}</span>
              <Icon name={isOpMenuOpen ? 'angle-up' : 'angle-down'} size="xs" />
            </button>
          </div>

          {/* Lista Vertical de Operadores ao clicar no botão */}
          {isOpMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                width: 175,
                zIndex: 30,
                background: '#0d1720',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                boxShadow: '0 10px 28px rgba(0, 0, 0, 0.8)',
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setDraftOperator(null);
                  setIsOpMenuOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: draftOperator === null ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  color: draftOperator === null ? '#ffffff' : 'rgba(255, 255, 255, 0.68)',
                  fontSize: 11,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>Busca livre</span>
                <span style={{ opacity: 0.45, fontSize: 10 }}>Texto</span>
              </button>
              <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />
              {OPERATOR_OPTIONS.map((item) => {
                const isSelected = draftOperator === item.op;
                return (
                  <button
                    key={item.op}
                    type="button"
                    onClick={() => {
                      setDraftOperator(item.op);
                      setIsOpMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: isSelected ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                      color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                      fontSize: 11,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontWeight: 700, minWidth: 24 }}>{item.label}</span>
                    <span style={{ opacity: 0.6, fontSize: 10.5 }}>{item.desc}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra Selecionar Todos + Contador */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            type="button"
            onClick={isAllVisibleSelected ? handleDeselectAllVisible : handleSelectAllVisible}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.85)',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {isAllVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
            {visibleItems.length} {visibleItems.length === 1 ? 'opção visível' : 'opções visíveis'}
          </span>
        </div>

        {/* Lista rolável de opções */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '6px',
            borderRadius: 6,
            background: 'rgba(0, 0, 0, 0.22)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            boxSizing: 'border-box',
            width: '100%',
          }}
        >
          {visibleItems.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.45)',
                fontSize: 11.5,
              }}
            >
              Nenhuma opção corresponde ao critério.
            </div>
          ) : (
            visibleItems.map((val) => {
              const isChecked = draftSelectedValues.includes(val);
              return (
                <label
                  key={val}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: isChecked ? 'rgba(255, 255, 255, 0.055)' : 'transparent',
                    border: isChecked
                      ? '1px solid rgba(255, 255, 255, 0.08)'
                      : '1px solid transparent',
                    boxSizing: 'border-box',
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleItem(val)}
                    style={{ cursor: 'pointer', accentColor: '#94a3b8', margin: 0, flexShrink: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 11.5,
                      fontWeight: isChecked ? 500 : 400,
                      color: isChecked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.55)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                    title={val}
                  >
                    {val}
                  </span>
                </label>
              );
            })
          )}
        </div>

      </div>

      {/* 3. Rodapé Fixo com Limpar, Cancelar e OK */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.015)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={handleClearAll}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            color: 'rgba(255, 255, 255, 0.65)',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Limpar
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              border: '1px solid rgba(255, 255, 255, 0.22)',
              background: 'rgba(255, 255, 255, 0.14)',
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/**
 * Portal do Pop-up de Filtro: utiliza a mesma arquitetura de Portal e posicionamento inteligente
 * do AlertPopupPortal, com dimensões ampliadas, paleta industrial escura do plugin e seletor
 * de condição vertical embutido dentro da barra "Buscar na lista".
 */
export const ColumnFilterModal: React.FC<ColumnFilterModalProps> = ({
  colKey,
  colTitle,
  anchorRect,
  currentFilter,
  uniqueValues,
  onApply,
  onClose,
  onExpand,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; opacity: number; maxHeight: number }>({
    top: 0,
    left: 0,
    opacity: 0,
    maxHeight: 480,
  });

  // Rascunho local (aplicado ao clicar em OK)
  const [draftOperator, setDraftOperator] = useState<FilterOperator | null>(
    currentFilter?.operator ?? null
  );
  const [inputText, setInputText] = useState<string>(
    currentFilter?.operator ? (currentFilter?.operatorValue ?? '') : ''
  );
  const [draftSelectedValues, setDraftSelectedValues] = useState<string[]>(
    currentFilter?.selectedValues && currentFilter.selectedValues.length > 0
      ? currentFilter.selectedValues
      : uniqueValues
  );
  const [isOpMenuOpen, setIsOpMenuOpen] = useState(false);

  // Registro de montagem do popup para coordenação de não-sobreposição
  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!el) {
      return;
    }
    if (!openFilterPopupRegistry.includes(el)) {
      openFilterPopupRegistry.push(el);
    }
    return () => {
      const idx = openFilterPopupRegistry.indexOf(el);
      if (idx !== -1) {
        openFilterPopupRegistry.splice(idx, 1);
      }
    };
  }, []);

  // Cálculo de posição idêntico ao AlertPopupPortal, priorizando abrir ACIMA do botão trigger
  useLayoutEffect(() => {
    if (!popupRef.current) {
      return;
    }
    const popup = popupRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;
    const GAP = 8;

    const availableAbove = anchorRect.top - GAP - MARGIN;
    const availableBelow = vh - anchorRect.bottom - GAP - MARGIN;
    const targetMaxH = Math.min(500, Math.max(320, Math.floor(Math.max(availableAbove, availableBelow, 320))));

    popup.style.maxHeight = `${targetMaxH}px`;
    const popupW = popup.offsetWidth;
    const popupH = popup.offsetHeight;

    const clampHoriz = (l: number) => Math.max(MARGIN, Math.min(l, Math.max(MARGIN, vw - popupW - MARGIN)));
    const clampVert = (t: number) => Math.max(MARGIN, Math.min(t, Math.max(MARGIN, vh - popupH - MARGIN)));

    const prefAboveTop = anchorRect.top - popupH - GAP;
    const prefBelowTop = anchorRect.bottom + GAP;
    const prefRightLeft = anchorRect.right - popupW;

    const myIdx = openFilterPopupRegistry.indexOf(popup);
    const priorPopups = (myIdx > 0 ? openFilterPopupRegistry.slice(0, myIdx) : [])
      .filter((el) => el !== popup && document.body.contains(el) && el.offsetWidth > 0 && el.offsetHeight > 0)
      .map((el) => el.getBoundingClientRect());

    document.querySelectorAll('[data-alert-popup="true"]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl !== popup && !openFilterPopupRegistry.includes(htmlEl) && htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0) {
        priorPopups.push(htmlEl.getBoundingClientRect());
      }
    });

    const getOverlapArea = (t: number, l: number, rects: DOMRect[], pad = 0): number => {
      let area = 0;
      for (const r of rects) {
        const xOverlap = Math.max(0, Math.min(l + popupW + pad, r.right + pad) - Math.max(l, r.left));
        const yOverlap = Math.max(0, Math.min(t + popupH + pad, r.bottom + pad) - Math.max(t, r.top));
        area += xOverlap * yOverlap;
      }
      return area;
    };

    const rawCandidates: Array<{ top: number; left: number }> = [];

    // 1. Acima do botão (prioridade máxima — transcende a tabela para cima)
    if (prefAboveTop >= MARGIN) {
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(anchorRect.left) });
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(prefRightLeft) });
      rawCandidates.push({ top: prefAboveTop, left: clampHoriz(anchorRect.left + anchorRect.width / 2 - popupW / 2) });
    }

    // 2. À esquerda ou direita do botão, ancorado o mais para cima possível
    const sideTopUpward = clampVert(Math.min(MARGIN, anchorRect.bottom - popupH));
    const sideTopAlignedBottom = clampVert(anchorRect.bottom - popupH);
    if (anchorRect.right + GAP + popupW <= vw - MARGIN) {
      rawCandidates.push({ top: sideTopAlignedBottom, left: anchorRect.right + GAP });
      rawCandidates.push({ top: sideTopUpward, left: anchorRect.right + GAP });
    }
    if (anchorRect.left - popupW - GAP >= MARGIN) {
      rawCandidates.push({ top: sideTopAlignedBottom, left: anchorRect.left - popupW - GAP });
      rawCandidates.push({ top: sideTopUpward, left: anchorRect.left - popupW - GAP });
    }

    // 3. Abaixo do botão
    if (prefBelowTop + popupH <= vh - MARGIN) {
      rawCandidates.push({ top: prefBelowTop, left: clampHoriz(anchorRect.left) });
      rawCandidates.push({ top: prefBelowTop, left: clampHoriz(prefRightLeft) });
    }

    // 4. Fallbacks clampados
    rawCandidates.push(
      { top: clampVert(prefAboveTop), left: clampHoriz(anchorRect.left) },
      { top: clampVert(sideTopAlignedBottom), left: clampHoriz(anchorRect.right + GAP) },
      { top: clampVert(sideTopAlignedBottom), left: clampHoriz(anchorRect.left - popupW - GAP) },
      { top: clampVert(prefBelowTop), left: clampHoriz(anchorRect.left) }
    );

    let best = rawCandidates[0];
    let bestScore = Infinity;
    const idealTop = Math.max(MARGIN, prefAboveTop);

    for (const cand of rawCandidates) {
      const c = { top: clampVert(cand.top), left: clampHoriz(cand.left) };
      const triggerOverlap = getOverlapArea(c.top, c.left, [anchorRect], 6);
      const priorOverlap = getOverlapArea(c.top, c.left, priorPopups, GAP);
      const dist = Math.hypot(c.top - idealTop, c.left - anchorRect.left);
      const belowTriggerPx = Math.max(0, (c.top + popupH) - anchorRect.bottom);
      const chartCoverPenalty = (c.top >= anchorRect.bottom ? 50000 : 0) + belowTriggerPx * 40;

      const score =
        (triggerOverlap > 0 ? 10000000 + triggerOverlap * 1000 : 0) +
        priorOverlap * 10000 +
        chartCoverPenalty +
        dist;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    setPos({ top: best.top, left: best.left, opacity: 1, maxHeight: targetMaxH });
  }, [anchorRect]);

  // Fechar com Escape ou clique fora
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isOpMenuOpen) {
          setIsOpMenuOpen(false);
        } else {
          onClose();
        }
      }
    };
    const handleMouseDownOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouseDownOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouseDownOutside);
    };
  }, [onClose, isOpMenuOpen]);

  // Filtra as opções visíveis conforme o texto digitado (ou condição de comparação ativa)
  const visibleItems = useMemo(() => {
    const q = inputText.trim();
    if (!q) {
      return uniqueValues;
    }
    if (draftOperator) {
      return uniqueValues.filter((v) => matchesOperatorCondition(v, draftOperator, q));
    }
    const lower = q.toLowerCase();
    return uniqueValues.filter((v) => v.toLowerCase().includes(lower));
  }, [uniqueValues, inputText, draftOperator]);

  const isAllVisibleSelected = useMemo(() => {
    if (visibleItems.length === 0) {
      return false;
    }
    return visibleItems.every((v) => draftSelectedValues.includes(v));
  }, [visibleItems, draftSelectedValues]);

  const handleToggleItem = (val: string) => {
    setDraftSelectedValues((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const handleSelectAllVisible = () => {
    setDraftSelectedValues((prev) => {
      const set = new Set(prev);
      visibleItems.forEach((v) => set.add(v));
      return Array.from(set);
    });
  };

  const handleDeselectAllVisible = () => {
    setDraftSelectedValues((prev) => prev.filter((v) => !visibleItems.includes(v)));
  };

  const handleApply = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const isOpActive = Boolean(draftOperator && inputText.trim() !== '');
    const isSelectionCustom =
      draftSelectedValues.length > 0 && draftSelectedValues.length < uniqueValues.length;

    if (!isOpActive && !isSelectionCustom) {
      onApply(colKey, null);
    } else {
      onApply(colKey, {
        operator: isOpActive ? draftOperator : null,
        operatorValue: isOpActive ? inputText.trim() : '',
        selectedValues:
          draftSelectedValues.length === uniqueValues.length ? undefined : draftSelectedValues,
      });
    }
    onClose();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onApply(colKey, null);
    onClose();
  };

  const iconBtnStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer',
    opacity: 0.7,
    padding: 0,
    transition: 'opacity 0.15s ease, background-color 0.15s ease',
    flexShrink: 0,
  };

  return createPortal(
    <div
      ref={popupRef}
      data-alert-popup="true"
      onClick={(e) => {
        e.stopPropagation();
        if (isOpMenuOpen) {
          setIsOpMenuOpen(false);
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        opacity: pos.opacity,
        transition: 'opacity 0.15s ease',
        zIndex: 99999,
        width: 380,
        minWidth: 360,
        maxWidth: 440,
        maxHeight: pos.maxHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, rgba(13, 23, 32, 0.98) 0%, rgba(12, 20, 29, 0.98) 55%, rgba(11, 18, 26, 0.98) 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.78), 0 0 0 1px rgba(255,255,255,0.04)',
        color: 'rgba(255, 255, 255, 0.88)',
        fontSize: '12px',
        lineHeight: 1.5,
        pointerEvents: 'all',
      }}
    >
      {/* Bloco 1: Header Fixo (mesma estrutura do AlertPopupPortal com as cores neutras do plugin) */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 14px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          background: 'rgba(255,255,255,0.015)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ color: 'rgba(255, 255, 255, 0.92)', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Icon name="filter" size="sm" style={{ color: 'rgba(255, 255, 255, 0.65)', flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={colTitle}>
              {colTitle}
            </span>
          </div>

          {/* Botões de ação minimalistas (22x22px) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {onExpand && (
              <button
                type="button"
                title="Expandir na aba lateral"
                style={iconBtnStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand();
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.7';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
              >
                <Icon name="columns" size="sm" />
              </button>
            )}
            <button
              type="button"
              title="Fechar (Esc)"
              style={{ ...iconBtnStyle, fontSize: 15, fontWeight: 600, lineHeight: 1 }}
              onClick={handleCancel}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.7';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 10.5, color: 'rgba(255, 255, 255, 0.5)' }}>
          <span>
            {visibleItems.length} {visibleItems.length === 1 ? 'opção listada' : 'opções listadas'}
          </span>
          <span>
            <strong style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{draftSelectedValues.length}</strong> de {uniqueValues.length} selecionados
          </span>
        </div>
      </div>

      {/* Bloco 2: Corpo com Busca (contendo botão de Condição vertical) e Lista Ampliada */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.07)',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
            width: '100%',
          }}
        >
          {/* Barra "Buscar na lista" com o botão de Condição de Comparação integrado */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 6px 5px 9px',
                borderRadius: 5,
                background: 'rgba(0, 0, 0, 0.28)',
                border: '1px solid rgba(255, 255, 255, 0.09)',
              }}
            >
              <Icon name="search" size="xs" style={{ color: 'rgba(255,255,255,0.42)', flexShrink: 0 }} />
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  draftOperator
                    ? `Comparar (${draftOperator}) com valor...`
                    : 'Buscar na lista...'
                }
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontSize: 11.5,
                  minWidth: 0,
                }}
              />
              {inputText && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setInputText('');
                  }}
                  style={{
                    cursor: 'pointer',
                    color: 'rgba(255, 255, 255, 0.45)',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                  title="Limpar texto"
                >
                  ×
                </span>
              )}

              {/* Botão de Condição de Comparação dentro da barra de busca */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpMenuOpen((prev) => !prev);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 4,
                  border: draftOperator
                    ? '1px solid rgba(255, 255, 255, 0.26)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  background: draftOperator
                    ? 'rgba(255, 255, 255, 0.14)'
                    : 'rgba(255, 255, 255, 0.05)',
                  color: draftOperator ? '#ffffff' : 'rgba(255, 255, 255, 0.65)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background 0.12s ease',
                }}
                title="Condição de comparação (=, !=, >, >=, <, <=)"
              >
                <span>{draftOperator || 'Condição'}</span>
                <Icon name={isOpMenuOpen ? 'angle-up' : 'angle-down'} size="xs" />
              </button>
            </div>

            {/* Menu Vertical de Condições de Comparação */}
            {isOpMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  width: 175,
                  zIndex: 40,
                  background: '#0d1720',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 6,
                  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.82)',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDraftOperator(null);
                    setIsOpMenuOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '5px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: draftOperator === null ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                    color: draftOperator === null ? '#ffffff' : 'rgba(255, 255, 255, 0.68)',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span>Busca livre</span>
                  <span style={{ opacity: 0.45, fontSize: 10 }}>Texto</span>
                </button>
                <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />
                {OPERATOR_OPTIONS.map((item) => {
                  const isSelected = draftOperator === item.op;
                  return (
                    <button
                      key={item.op}
                      type="button"
                      onClick={() => {
                        setDraftOperator(item.op);
                        setIsOpMenuOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: 4,
                        border: 'none',
                        background: isSelected ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                        color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                        fontSize: 11,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontWeight: 700, minWidth: 24 }}>{item.label}</span>
                      <span style={{ opacity: 0.6, fontSize: 10.5 }}>{item.desc}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Botão Selecionar Todos + Contador */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={isAllVisibleSelected ? handleDeselectAllVisible : handleSelectAllVisible}
              style={{
                padding: '3px 9px',
                borderRadius: 4,
                fontSize: 10.5,
                fontWeight: 500,
                cursor: 'pointer',
                color: 'rgba(255, 255, 255, 0.82)',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {isAllVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            <span style={{ fontSize: 10.5, color: 'rgba(255, 255, 255, 0.48)' }}>
              {draftSelectedValues.length}/{uniqueValues.length} marcados
            </span>
          </div>

          {/* Lista rolável de checkboxes ampliada */}
          <div
            style={{
              flex: 1,
              minHeight: 70,
              maxHeight: 220,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '5px 6px',
              borderRadius: 5,
              background: 'rgba(0, 0, 0, 0.22)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              boxSizing: 'border-box',
              width: '100%',
            }}
          >
            {visibleItems.length === 0 ? (
              <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 11, color: 'rgba(255, 255, 255, 0.45)' }}>
                Nenhuma opção encontrada
              </div>
            ) : (
              visibleItems.map((val) => {
                const isChecked = draftSelectedValues.includes(val);
                return (
                  <label
                    key={val}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: isChecked ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                      boxSizing: 'border-box',
                      width: '100%',
                      minWidth: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleItem(val)}
                      style={{ cursor: 'pointer', accentColor: '#94a3b8', margin: 0, flexShrink: 0 }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: 11.5,
                        fontWeight: isChecked ? 500 : 400,
                        color: isChecked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.55)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                      title={val}
                    >
                      {val}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bloco 3: Rodapé Fixo com Limpar, Cancelar e OK */}
      <div
        style={{
          flexShrink: 0,
          padding: '9px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.015)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={handleClearAll}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            color: 'rgba(255, 255, 255, 0.65)',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          title="Remover filtro desta coluna"
        >
          Limpar
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              border: '1px solid rgba(255, 255, 255, 0.22)',
              background: 'rgba(255, 255, 255, 0.14)',
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/**
 * Botão de Filtro (FilterBadgePopover): sem círculo em volta, exibindo apenas o símbolo de filtro
 * limpo ao lado esquerdo do rótulo da coluna, abrindo ESTRITAMENTE ao clicar.
 */
export const FilterBadgePopover: React.FC<{
  colKey: string;
  colTitle: string;
  currentFilter?: ColumnFilterConfig;
  getUniqueValues: () => string[];
  theme: GrafanaTheme2;
  onApply: (colKey: string, filter: ColumnFilterConfig | null) => void;
  size?: number;
}> = ({
  colKey,
  colTitle,
  currentFilter,
  getUniqueValues,
  theme,
  onApply,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [uniqueValues, setUniqueValues] = useState<string[]>([]);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isHoveredIcon, setIsHoveredIcon] = useState(false);

  const isFilterActive = Boolean(
    currentFilter &&
      ((currentFilter.operator && currentFilter.operatorValue) ||
        (currentFilter.selectedValues && currentFilter.selectedValues.length > 0))
  );

  const iconColor =
    isOpen || isDrawerOpen || isFilterActive
      ? 'rgba(255, 255, 255, 0.95)'
      : isHoveredIcon
      ? 'rgba(255, 255, 255, 0.8)'
      : 'rgba(255, 255, 255, 0.45)';

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setIsDrawerOpen(false);
  }, []);

  const handleExpandToDrawer = useCallback(() => {
    setIsOpen(false);
    setIsDrawerOpen(true);
  }, []);

  const handleCollapseFromDrawer = useCallback(() => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setIsDrawerOpen(false);
    setIsOpen(true);
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setUniqueValues(getUniqueValues());
    if (isOpen || isDrawerOpen) {
      setIsOpen(false);
      setIsDrawerOpen(false);
    } else {
      setIsOpen(true);
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        position: 'relative',
        zIndex: isOpen ? 100005 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {/* Símbolo de Filtro: quando ativo, destaca o ícone e inclui botão '×' discreto sem retângulo */}
      {isFilterActive ? (
        <div
          ref={triggerRef}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px',
            background: 'transparent',
            border: 'none',
            flexShrink: 0,
          }}
        >
          {/* Ícone de filtro ativo: clique abre para editar */}
          <div
            onClick={handleClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.95)',
              transition: 'transform 0.15s ease, opacity 0.15s ease',
              transform: isOpen || isDrawerOpen ? 'scale(1.1)' : 'scale(1)',
            }}
            title={`Filtro ativo em ${colTitle} — clique para editar`}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = '0.75';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = '1';
            }}
          >
            <Icon name="filter" size="xs" />
          </div>

          {/* Botão × discreto e limpo para desfazer o filtro sem retângulo */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onApply(colKey, null);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.45)',
              fontSize: '13px',
              fontWeight: 500,
              lineHeight: 1,
              padding: '0 2px',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#f87171';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'rgba(255, 255, 255, 0.45)';
            }}
            title={`Desfazer filtro de ${colTitle}`}
          >
            ×
          </div>
        </div>
      ) : (
        <div
          ref={triggerRef}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px',
            color: iconColor,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 0.15s ease, transform 0.15s ease',
            transform: isOpen || isDrawerOpen ? 'scale(1.1)' : 'scale(1)',
          }}
          onMouseEnter={() => setIsHoveredIcon(true)}
          onMouseLeave={() => setIsHoveredIcon(false)}
          onClick={handleClick}
          title={
            isOpen
              ? 'Clique para fechar'
              : `Filtrar ${colTitle}`
          }
        >
          <Icon name="filter" size="xs" style={{ color: iconColor }} />
        </div>
      )}

      {/* Portal do Pop-up Flutuante: renderizado fora do DOM do painel, direto no body */}
      {isOpen && triggerRect && (
        <ColumnFilterModal
          colKey={colKey}
          colTitle={colTitle}
          anchorRect={triggerRect}
          currentFilter={currentFilter}
          uniqueValues={uniqueValues}
          theme={theme}
          onApply={onApply}
          onClose={handleClose}
          onExpand={handleExpandToDrawer}
        />
      )}

      {/* Portal da Aba Lateral (Left Side Drawer) */}
      {isDrawerOpen && (
        <FilterLeftDrawer
          colKey={colKey}
          colTitle={colTitle}
          currentFilter={currentFilter}
          uniqueValues={uniqueValues}
          onApply={onApply}
          onCollapse={handleCollapseFromDrawer}
          onClose={handleClose}
        />
      )}
    </div>
  );
};
