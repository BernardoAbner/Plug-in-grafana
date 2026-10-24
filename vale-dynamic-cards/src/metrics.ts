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

const VALUE_FIELD_NAMES = new Set(['value', 'avg', 'min', 'max', 'trend', 'val', 'valor', 'last', 'mean', 'sum', 'count']);

/**
 * Normaliza um identificador de métrica ou frame para um formato canônico limpo,
 * eliminando sufixos e agregadores voláteis do Zabbix/Prometheus/Grafana.
 * Ex: "ICMP ping [avg]" -> "icmpping"
 */
export function cleanMetricString(name?: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[\s\-_/:]*(\(|\[|\b)(avg|average|max|maximum|min|minimum|sum|count|trend|trends|history|last|delta)(\)|\]|\b)/gi, '')
    .replace(/[()[\]{}:_\-\\/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toAlphaNumeric(str?: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function areEquivalentFieldNames(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (VALUE_FIELD_NAMES.has(a.toLowerCase()) && VALUE_FIELD_NAMES.has(b.toLowerCase())) {
    return true; // Ambos são a coluna de dados da série temporal (ex: 'Value' em History e 'avg' em Trends)
  }
  return false;
}

function namesMatch(nameA?: string, nameB?: string): boolean {
  if (!nameA || !nameB) return false;
  const trimmedA = nameA.trim().toLowerCase();
  const trimmedB = nameB.trim().toLowerCase();
  if (trimmedA === trimmedB) return true;
  
  const cleanA = cleanMetricString(nameA);
  const cleanB = cleanMetricString(nameB);
  if (cleanA && cleanB && cleanA === cleanB) return true;
  
  const alphaA = toAlphaNumeric(cleanA);
  const alphaB = toAlphaNumeric(cleanB);
  if (alphaA && alphaB && alphaA === alphaB) return true;
  
  // Verifica se um contém o outro (para casos como "Host: ICMP ping" vs "ICMP ping")
  if (alphaA && alphaB && alphaA.length >= 4 && alphaB.length >= 4) {
    if (alphaA.includes(alphaB) || alphaB.includes(alphaA)) {
      return true;
    }
  }

  return false;
}

function getMetricCandidateNames(item: AvailableMetric): string[] {
  const names: string[] = [];
  if (item.frame.name) names.push(item.frame.name);
  if (item.source.frameName) names.push(item.source.frameName);
  if (item.label) names.push(item.label);
  if (item.field.name && !VALUE_FIELD_NAMES.has(item.field.name.toLowerCase())) {
    names.push(item.field.name);
  }
  if (item.field.config?.displayName) names.push(item.field.config.displayName);
  if (item.field.state?.displayName) names.push(item.field.state.displayName);
  if (item.field.labels) {
    for (const val of Object.values(item.field.labels)) {
      if (typeof val === 'string') names.push(val);
    }
  }
  return Array.from(new Set(names.filter(Boolean)));
}

function getSavedSourceCandidateNames(source: MetricSource): string[] {
  const names: string[] = [];
  if (source.frameName) names.push(source.frameName);
  if (source.fieldName && !VALUE_FIELD_NAMES.has(source.fieldName.toLowerCase())) {
    names.push(source.fieldName);
  }
  return Array.from(new Set(names.filter(Boolean)));
}

/**
 * Encontra a métrica salva com alta resiliência contra mudanças de Time Range,
 * alternância entre History e Trends no Zabbix, reordenação assíncrona de DataFrames,
 * variações de sufixos como [avg] e diferenças de formato Wide vs Multi-frame.
 */
export function matchMetric(available: AvailableMetric[], savedSource?: MetricSource): AvailableMetric | undefined {
  if (!savedSource) return undefined;
  if (!available || available.length === 0) return undefined;
  
  // 1. Match exato com todas as chaves (refId, frameName, occurrences, fieldName)
  const exact = available.find(item => sourceKey(item.source) === sourceKey(savedSource));
  if (exact) return exact;

  const savedNames = getSavedSourceCandidateNames(savedSource);

  // 2. Match por refId + Nome Canônico (resolve sufixos de trends tipo [avg], (avg), etc.)
  if (savedSource.refId && savedNames.length > 0) {
    const byRefAndName = available.find(item => {
      if (item.source.refId !== savedSource.refId) return false;
      const candidateNames = getMetricCandidateNames(item);
      return savedNames.some(sName => candidateNames.some(cName => namesMatch(sName, cName)));
    });
    if (byRefAndName) return byRefAndName;
  }

  // 3. Match por Nome Canônico Global (independente de refId)
  if (savedNames.length > 0) {
    const byName = available.find(item => {
      const candidateNames = getMetricCandidateNames(item);
      return savedNames.some(sName => candidateNames.some(cName => namesMatch(sName, cName)));
    });
    if (byName) return byName;
  }

  // 4. Match por refId + nome do frame literal ou displayName
  if (savedSource.frameName) {
    const byRefAndFrameName = available.find(item =>
      item.source.refId === savedSource.refId &&
      (item.source.frameName === savedSource.frameName || item.frame.name === savedSource.frameName) &&
      (item.source.fieldName === savedSource.fieldName || areEquivalentFieldNames(item.source.fieldName, savedSource.fieldName))
    );
    if (byRefAndFrameName) return byRefAndFrameName;

    const byFrameOnly = available.find(item =>
      item.source.frameName === savedSource.frameName || item.frame.name === savedSource.frameName
    );
    if (byFrameOnly) return byFrameOnly;

    const byLabel = available.find(item =>
      item.label === savedSource.frameName || (savedSource.frameName ? item.label.includes(savedSource.frameName) : false)
    );
    if (byLabel) return byLabel;

    // Se a métrica salva possui um frameName específico (ou nome canônico identificado),
    // NÃO devemos cair em fallbacks genéricos por refId/fieldName ("Value"), pois em queries
    // multi-frame (ex: Zabbix com regex /.*/ na mesma query refId="A"), se a métrica ausentar
    // no período selecionado, o fallback genérico capturaria outra métrica qualquer (ex: Uptime).
    return undefined;
  }

  // Se havia nomes candidatos (ex: fieldName específico não-genérico como "CPU") e nenhum
  // frame/field bateu nos passos 1 a 3, não substitui por outra métrica da mesma query.
  if (savedNames.length > 0) {
    return undefined;
  }

  // 5. Match por refId + fieldName equivalente na mesma ocorrência (apenas quando sem frameName específico)
  if (savedSource.refId) {
    const byRefAndField = available.find(item => 
      item.source.refId === savedSource.refId && 
      (item.source.fieldName === savedSource.fieldName || areEquivalentFieldNames(item.source.fieldName, savedSource.fieldName)) &&
      item.source.frameOccurrence === savedSource.frameOccurrence &&
      !item.source.frameName && !item.frame.name
    );
    if (byRefAndField) return byRefAndField;
  }

  // 6. Fallback final: apenas se nem a métrica salva nem os candidatos possuírem nome identificador
  if (savedSource.refId) {
    const unnamedSameRef = available.filter(
      item => item.source.refId === savedSource.refId && !item.source.frameName && !item.frame.name
    );
    if (unnamedSameRef.length === 1) {
      return unnamedSameRef[0];
    }
    const byOccur = unnamedSameRef.find(item => item.source.frameOccurrence === savedSource.frameOccurrence);
    if (byOccur) return byOccur;
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
