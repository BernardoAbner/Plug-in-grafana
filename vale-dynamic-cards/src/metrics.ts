import { DataFrame, Field, FieldType, getFieldDisplayName } from '@grafana/data';
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
      if (field.type === FieldType.time) {
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

export function matchMetric(available: AvailableMetric[], savedSource?: MetricSource): AvailableMetric | undefined {
  if (!savedSource) return undefined;
  
  // 1. Exact match
  const exact = available.find(item => sourceKey(item.source) === sourceKey(savedSource));
  if (exact) return exact;

  // 2. Resilient fallback: Match by refId and fieldName (ignores volatile frameNames like Prometheus labels)
  return available.find(item => 
    item.source.refId === savedSource.refId && 
    item.source.fieldName === savedSource.fieldName
  );
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
