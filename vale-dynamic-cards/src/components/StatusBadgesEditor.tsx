import React from 'react';
import { Button, Combobox, Field, Input } from '@grafana/ui';
import { StandardEditorProps } from '@grafana/data';
import { StatusBadgeConfig } from '../types';
import { listMetrics, sourceKey } from '../metrics';

/** Configures optional status badges shown beside the hostname. */
export const StatusBadgesEditor = ({ value = [], onChange, context }: StandardEditorProps<StatusBadgeConfig[]>) => {
  const available = listMetrics(context.data ?? []);
  const update = (index: number, patch: Partial<StatusBadgeConfig>) =>
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  return (
    <div>
      {value.map((badge, index) => (
        <fieldset key={badge.id} style={{ padding: 8, marginBottom: 8 }}>
          <legend>Indicador {index + 1}</legend>
          <Field label="Campo">
            <Combobox
              aria-label={`Campo do indicador ${index + 1}`}
              value={sourceKey(badge.source)}
              options={[
                ...available.map((item) => ({
                  value: sourceKey(item.source),
                  label: `${item.frame.refId ?? ''} / ${item.frame.name ?? ''} / ${item.label}`,
                })),
              ]}
              onChange={(item) => update(index, { source: available.find((entry) => sourceKey(entry.source) === item.value)?.source })}
            />
          </Field>
          <Field label="Título">
            <Input value={badge.label ?? ''} placeholder="Ex.: Ping" onChange={(event) => update(index, { label: event.currentTarget.value })} />
          </Field>
          <Button size="sm" variant="destructive" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
            Remover
          </Button>
        </fieldset>
      ))}
      <Button onClick={() => onChange([...value, { id: crypto.randomUUID(), source: available[0]?.source }])}>Adicionar indicador</Button>
    </div>
  );
};
