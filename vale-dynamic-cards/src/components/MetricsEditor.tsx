import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Input, Combobox, Switch, Field } from '@grafana/ui';
import { MetricConfig } from '../types';
import { listMetrics, sourceKey } from '../metrics';

export const MetricsEditor = ({ value = [], onChange, context }: StandardEditorProps<MetricConfig[]>) => {
  const available = listMetrics(context.data ?? []);
  const update = (index: number, patch: Partial<MetricConfig>) =>
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) => {
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return (
    <div>
      {value.map((metric, index) => (
        <fieldset key={metric.id} style={{ padding: 8, marginBottom: 12 }}>
          <legend>Métrica {index + 1}</legend>
          <Field label="Campo">
            <Combobox
              aria-label={`Campo da métrica ${index + 1}`}
              value={sourceKey(metric.source)}
              options={[
                ...available.map((item) => ({
                  value: sourceKey(item.source),
                  label: `${item.frame.refId ?? ''} / ${item.frame.name ?? ''} / ${item.label} (${item.source.frameOccurrence + 1}.${item.source.fieldOccurrence + 1})`,
                })),
                ...(!available.some((item) => sourceKey(item.source) === sourceKey(metric.source)) && metric.source
                  ? [{ value: sourceKey(metric.source), label: `${metric.source.fieldName} (indisponível)` }]
                  : []),
              ]}
              onChange={(item) =>
                update(index, { source: available.find((entry) => sourceKey(entry.source) === item.value)?.source })
              }
            />
          </Field>
          <Field label="Rótulo (vazio usa o nome do campo)">
            <Input value={metric.label ?? ''} onChange={(e) => update(index, { label: e.currentTarget.value })} />
          </Field>
          <Field label="Mostrar ícone">
            <Switch
              value={metric.showIcon ?? true}
              onChange={(e) => update(index, { showIcon: e.currentTarget.checked })}
            />
          </Field>
          <Field label="Ícone">
            <Combobox
              value={metric.icon ?? ''}
              options={[
                { value: '', label: 'Padrão do campo/painel' },
                ...(
                  [
                    'cpu',
                    'server',
                    'database',
                    'hdd',
                    'wifi',
                    'clock',
                    'heart',
                    'shield',
                    'check-circle',
                    'alert',
                  ] as const
                ).map((icon) => ({ value: icon, label: icon })),
              ]}
              onChange={(item) => update(index, { icon: (item.value as MetricConfig['icon']) || undefined })}
            />
          </Field>
          <Field label="Alinhamento horizontal">
            <Combobox
              value={metric.horizontalAlign ?? ''}
              options={[
                { value: '', label: 'Padrão do painel' },
                { value: 'left', label: 'Esquerda' },
                { value: 'center', label: 'Centro' },
                { value: 'right', label: 'Direita' },
              ]}
              onChange={(item) =>
                update(index, { horizontalAlign: (item.value as MetricConfig['horizontalAlign']) || undefined })
              }
            />
          </Field>
          <Field label="Alinhamento vertical">
            <Combobox
              value={metric.verticalAlign ?? ''}
              options={[
                { value: '', label: 'Padrão do painel' },
                { value: 'top', label: 'Topo' },
                { value: 'center', label: 'Centro' },
                { value: 'bottom', label: 'Base' },
              ]}
              onChange={(item) =>
                update(index, { verticalAlign: (item.value as MetricConfig['verticalAlign']) || undefined })
              }
            />
          </Field>
          <Field label="Badge / status">
            <Combobox
              value={metric.badgeMode ?? 'none'}
              options={[
                { value: 'none', label: 'Oculto' },
                { value: 'text', label: 'Texto fixo' },
                { value: 'value', label: 'Valor formatado / mapeado' },
              ]}
              onChange={(item) => update(index, { badgeMode: item.value as MetricConfig['badgeMode'] })}
            />
          </Field>
          {metric.badgeMode === 'text' && (
            <Field label="Texto do badge">
              <Input
                value={metric.badgeText ?? ''}
                onChange={(e) => update(index, { badgeText: e.currentTarget.value })}
              />
            </Field>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Button size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
              Subir
            </Button>
            <Button size="sm" disabled={index === value.length - 1} onClick={() => move(index, 1)}>
              Descer
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              Remover
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        onClick={() => onChange([...value, { id: crypto.randomUUID(), source: available[0]?.source, showIcon: true }])}
      >
        Adicionar métrica
      </Button>
    </div>
  );
};

