import { DataFrame, Field, FieldType, getFieldDisplayName, reduceField, ReducerID } from '@grafana/data';
import { MetricConfig, MetricSource, SimpleOptions } from './types';

export interface AvailableMetric {
  source: MetricSource;
  field: Field;
  frame: DataFrame;
  label: string;
}

export function listMetrics(frames: DataFrame[]): AvailableMetric[] {
  const frameCounts = new Map<string, number>();
  return frames.flatMap((frame) => {
    const key = JSON.stringify([frame.refId, frame.name]);
    const frameOccurrence = frameCounts.get(key) ?? 0;
    frameCounts.set(key, frameOccurrence + 1);
    const fieldCounts = new Map<string, number>();
    return frame.fields.flatMap((field) => {
      const fieldOccurrence = fieldCounts.get(field.name) ?? 0;
      fieldCounts.set(field.name, fieldOccurrence + 1);
      if (field.type === FieldType.time || field.name.toLowerCase() === 'time') {
        return [];
      }

      return [
        {
          source: {
            refId: frame.refId,
            frameName: frame.name,
            frameOccurrence,
            fieldName: field.name,
            fieldOccurrence,
          },
          field,
          frame,
          label: getFieldDisplayName(field, frame, frames),
        },
      ];
    });
  });
}

export function sourceKey(source?: MetricSource): string {
  return source
    ? JSON.stringify([source.refId, source.frameName, source.frameOccurrence, source.fieldName, source.fieldOccurrence])
    : '';
}

/**
 * Encontra a métrica salva com alta resiliência contra mudanças de Time Range,
 * reordenação assíncrona de DataFrames e variações em rótulos do Zabbix/Prometheus.
 */
export function matchMetric(available: AvailableMetric[], savedSource?: MetricSource): AvailableMetric | undefined {
  if (!savedSource) return undefined;
  
  // 1. Match exato com todas as chaves (refId, frameName, occurrences, fieldName)
  const exact = available.find(item => sourceKey(item.source) === sourceKey(savedSource));
  if (exact) return exact;

  // 2. Match por refId, nome do frame e nome do campo (ignora variações de contagem/ordem de ocorrência)
  if (savedSource.frameName) {
    const byRefAndFrameName = available.find(item =>
      item.source.refId === savedSource.refId &&
      (item.source.frameName === savedSource.frameName || item.frame.name === savedSource.frameName) &&
      item.source.fieldName === savedSource.fieldName
    );
    if (byRefAndFrameName) return byRefAndFrameName;

    // 3. Match por nome do frame e nome do campo (caso o refId tenha mudado ou seja dinâmico)
    const byFrameAndField = available.find(item =>
      (item.source.frameName === savedSource.frameName || item.frame.name === savedSource.frameName) &&
      item.source.fieldName === savedSource.fieldName
    );
    if (byFrameAndField) return byFrameAndField;

    // 4. Match por nome do frame exclusivamente (muito comum em Zabbix onde fieldName é sempre 'Value')
    const byFrameOnly = available.find(item =>
      item.source.frameName === savedSource.frameName || item.frame.name === savedSource.frameName
    );
    if (byFrameOnly) return byFrameOnly;

    // 5. Match pelo label/displayName gerado pelo Grafana
    const byLabel = available.find(item =>
      item.label === savedSource.frameName || (savedSource.frameName ? item.label.includes(savedSource.frameName) : false)
    );
    if (byLabel) return byLabel;
  }

  // 6. Fallback resiliente: Match por refId e fieldName
  const byRefAndField = available.find(item => 
    item.source.refId === savedSource.refId && 
    item.source.fieldName === savedSource.fieldName
  );
  if (byRefAndField) return byRefAndField;

  // 7. Fallback final: Match apenas por refId se houver
  if (savedSource.refId) {
    const byRef = available.find(item => item.source.refId === savedSource.refId);
    if (byRef) return byRef;
  }

  return undefined;
}

/**
 * Extrai o último valor não nulo e não indefinido de um field.
 * Emula com precisão cirúrgica o comportamento "Last (not null)" do Grafana.
 */
export function getLastNonNullValue(field: Field | undefined): unknown {
  if (!field) return undefined;

  // 1. Tenta pegar do cache do próprio Grafana (o mesmo usado pelo Stat/Card nativo)
  if (field.state?.calcs?.lastNotNull !== undefined && field.state?.calcs?.lastNotNull !== null) {
    return field.state.calcs.lastNotNull;
  }

  // 2. Executa a função oficial do Grafana que o Stat Panel roda internamente
  try {
    const calcs = reduceField({ field, reducers: [ReducerID.lastNotNull] });
    const val = calcs[ReducerID.lastNotNull];
    if (val !== undefined && val !== null && !(typeof val === 'number' && Number.isNaN(val))) {
      return val;
    }
  } catch (e) {
    // Se falhar o reduceField por qualquer motivo interno, segue para o laço manual
  }

  // 3. Fallback de alta performance: percorre de trás para frente no array de valores
  const values = field.values;
  if (!values || values.length === 0) return undefined;

  const length = values.length;
  const isVector = typeof (values as any).get === 'function';

  for (let i = length - 1; i >= 0; i--) {
    const val = isVector ? (values as any).get(i) : values[i];
    if (val !== null && val !== undefined && !(typeof val === 'number' && Number.isNaN(val))) {
      return val;
    }
  }

  return undefined;
}

export function selectMetrics(
  frames: DataFrame[],
  options: SimpleOptions
): Array<{ config: MetricConfig; metric?: AvailableMetric }> {
  if (options.metricMode !== 'configured') {
    return listMetrics(frames).map((metric, i) => ({ config: { id: `auto-${i}` }, metric }));
  }
  const available = listMetrics(frames);
  return (options.metrics ?? []).map((config) => ({
    config,
    metric: matchMetric(available, config.source),
  }));
}

export function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
