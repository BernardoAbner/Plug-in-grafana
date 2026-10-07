import React from 'react';
import { Combobox, Field } from '@grafana/ui';
import { StandardEditorProps } from '@grafana/data';
import { MetricSource } from '../types';
import { listMetrics, sourceKey, matchMetric } from '../metrics';

/** Selects one metric while preserving its stable data-frame identity. */
export const MetricSelectorEditor = ({ value, onChange, context }: StandardEditorProps<MetricSource | undefined>) => {
  const available = listMetrics(context.data ?? []);
  
  // Encontra a métrica combinando de forma segura (ignorando frameName volátil se necessário)
  const matched = matchMetric(available, value);
  const selectedValue = matched ? sourceKey(matched.source) : sourceKey(value);

  const options = [
    { value: '', label: 'Não configurado' },
    ...available.map((item) => ({
      value: sourceKey(item.source),
      label: `${item.frame.refId ?? ''} / ${item.frame.name ?? ''} / ${item.label}`,
    })),
  ];

  // Se o usuário salvou uma métrica que sumiu dos dados atuais, injeta na lista para não ser apagada no onBlur/mount
  if (value && !matched) {
    options.push({
      value: sourceKey(value),
      label: `(Ausente) ${value.refId ?? ''} / ${value.fieldName ?? ''}`,
    });
  }

  return (
    <Field label="Campo">
      <Combobox
        aria-label="Campo"
        value={selectedValue}
        options={options}
        onChange={(item) => {
          if (!item.value) {
            onChange(undefined);
            return;
          }
          // Encontra a métrica na lista real ou preserva o objeto salvo
          const found = available.find((entry) => sourceKey(entry.source) === item.value)?.source;
          onChange(found || value);
        }}
      />
    </Field>
  );
};
