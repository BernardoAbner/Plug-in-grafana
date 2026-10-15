import { FieldType, toDataFrame } from '@grafana/data';
import { bounded, listMetrics, selectMetrics, matchMetric } from './metrics';
import { SimpleOptions } from './types';

const frames = () =>
  ['A', 'B'].map((refId) =>
    toDataFrame({
      refId,
      fields: [
        { name: 'time', type: FieldType.time, values: [1] },
        { name: 'CPU', type: FieldType.number, values: [refId === 'A' ? 10 : 90] },
      ],
    })
  );

test('automatic mode extracts all frame fields', () => {
  const result = selectMetrics(frames(), {} as SimpleOptions);
  expect(result).toHaveLength(2);
  expect(result[0].metric?.field.values[0]).toBe(10);
  expect(result[1].metric?.field.values[0]).toBe(90);
});

test('configured selection preserves order and query identity after frames reorder', () => {
  const data = frames();
  const available = listMetrics(data);
  const options = {
    metricMode: 'configured',
    metrics: [
      { id: 'b', source: available[1].source },
      { id: 'a', source: available[0].source },
    ],
  } as SimpleOptions;
  expect(selectMetrics(data.reverse(), options).map((m) => m.metric?.field.values[0])).toEqual([90, 10]);
});

test('missing fields keep their configured slot without substituting another metric', () => {
  const available = listMetrics(frames());
  const result = selectMetrics([], {
    metricMode: 'configured',
    metrics: [{ id: 'b', source: available[1].source }],
  } as SimpleOptions);
  expect(result).toHaveLength(1);
  expect(result[0].metric).toBeUndefined();
});

test('duplicate frame names and field names can be selected separately', () => {
  const data = [0, 1].map(() =>
    toDataFrame({
      name: 'same',
      fields: [
        { name: 'value', type: FieldType.number, values: [1] },
        { name: 'value', type: FieldType.number, values: [2] },
      ],
    })
  );
  const available = listMetrics(data);
  const selected = selectMetrics(data, {
    metricMode: 'configured',
    metrics: [{ id: 'x', source: available[3].source }],
  } as SimpleOptions);
  expect(selected[0].metric?.frame).toBe(data[1]);
  expect(selected[0].metric?.field).toBe(data[1].fields[1]);
});

test('empty configured list does not revert to automatic mode', () => {
  expect(selectMetrics(frames(), { metricMode: 'configured', metrics: [] } as unknown as SimpleOptions)).toEqual([]);
});

test('layout limits reject nonfinite values and clamp extremes', () => {
  expect(bounded(NaN, 16, 0, 100)).toBe(16);
  expect(bounded(-1, 16, 0, 100)).toBe(0);
  expect(bounded(101, 16, 0, 100)).toBe(100);
});

test('matchMetric resolves Zabbix metric transitioning from history (Value) to trends ([avg] with avg field)', () => {
  // Métrica salva durante range de 3h (history mode)
  const savedSource = {
    refId: 'A',
    frameName: 'ICMP ping',
    frameOccurrence: 0,
    fieldName: 'Value',
    fieldOccurrence: 0,
  };

  // Dados recebidos durante range de 6h (trends mode: frame ganha [avg] e campo vira avg)
  const trendsData = [
    toDataFrame({
      refId: 'A',
      name: 'ICMP ping [avg]',
      fields: [
        { name: 'time', type: FieldType.time, values: [1] },
        { name: 'avg', type: FieldType.number, values: [1] },
      ],
    }),
  ];

  const available = listMetrics(trendsData);
  const matched = matchMetric(available, savedSource);

  expect(matched).toBeDefined();
  expect(matched?.field.name).toBe('avg');
  expect(matched?.field.values[0]).toBe(1);
});

test('matchMetric resolves metric when host prefix is added or removed across time ranges', () => {
  const savedSource = {
    refId: 'B',
    frameName: 'ICMP ping',
    frameOccurrence: 0,
    fieldName: 'Value',
    fieldOccurrence: 0,
  };

  const prefixedData = [
    toDataFrame({
      refId: 'B',
      name: 'srv-01: ICMP ping',
      fields: [
        { name: 'time', type: FieldType.time, values: [1] },
        { name: 'Value', type: FieldType.number, values: [20] },
      ],
    }),
  ];

  const available = listMetrics(prefixedData);
  const matched = matchMetric(available, savedSource);

  expect(matched).toBeDefined();
  expect(matched?.field.values[0]).toBe(20);
});
