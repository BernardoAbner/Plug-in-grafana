import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Input, Combobox, Field } from '@grafana/ui';
import { NestedRowMetricConfig } from '../types';
import { listMetrics, sourceKey } from '../metrics';

export const NestedMetricsEditor = ({ value = [], onChange, context }: StandardEditorProps<NestedRowMetricConfig[]>) => {
  const available = listMetrics(context.data ?? []);
  const update = (index: number, patch: Partial<NestedRowMetricConfig>) =>
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
          <legend>Sub-métrica {index + 1}</legend>
          <Field label="Campo Referência">
            <Combobox
              aria-label={`Campo referência da sub-métrica ${index + 1}`}
              value={sourceKey(metric.source)}
              options={[
                ...available.map((item) => ({
                  value: sourceKey(item.source),
                  label: `${item.frame.name ?? item.frame.refId ?? ''} / ${item.source.fieldName}`,
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
          <Field label="Rótulo (opcional)">
            <Input value={metric.label ?? ''} onChange={(e) => update(index, { label: e.currentTarget.value })} placeholder="Ex: CPU, Leitura" />
          </Field>
          <Field label="Modo de Exibição">
            <Combobox
              value={metric.displayMode}
              options={[
                { value: 'value', label: 'Valor formatado (Texto)' },
                { value: 'progressBar', label: 'Barra de Progresso' },
                { value: 'statusBadge', label: 'Badge de Status (UP/DOWN)' },
              ]}
              onChange={(item) => update(index, { displayMode: item.value as NestedRowMetricConfig['displayMode'] })}
            />
          </Field>
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
        onClick={() => onChange([...value, { id: crypto.randomUUID(), displayMode: 'value', source: available[0]?.source }])}
      >
        Adicionar sub-métrica
      </Button>
    </div>
  );
};
