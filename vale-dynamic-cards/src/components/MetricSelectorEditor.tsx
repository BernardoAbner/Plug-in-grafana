import React from 'react';
import { Combobox, Field } from '@grafana/ui';
import { StandardEditorProps } from '@grafana/data';
import { MetricSource } from '../types';
import { listMetrics, sourceKey } from '../metrics';

/** Selects one metric while preserving its stable data-frame identity. */
export const MetricSelectorEditor = ({ value, onChange, context }: StandardEditorProps<MetricSource | undefined>) => {
  const available = listMetrics(context.data ?? []);
  const selected = sourceKey(value);

  return (
    <Field label="Campo">
      <Combobox
        aria-label="Campo"
        value={selected}
        options={[
          { value: '', label: 'Não configurado' },
          ...available.map((item) => ({
            value: sourceKey(item.source),
            label: `${item.frame.refId ?? ''} / ${item.frame.name ?? ''} / ${item.label}`,
          })),
        ]}
        onChange={(item) => onChange(available.find((entry) => sourceKey(entry.source) === item.value)?.source)}
      />
    </Field>
  );
};
