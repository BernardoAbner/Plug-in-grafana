import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, LoadingState, PanelProps, toDataFrame } from '@grafana/data';
import { SimplePanel } from './SimplePanel';
import { SimpleOptions } from '../types';
import { listMetrics } from '../metrics';

jest.mock('@grafana/runtime', () => ({ PanelDataErrorView: () => <div>No data</div> }));

const data = toDataFrame({ refId: 'A', fields: [{ name: 'CPU', type: FieldType.number, values: [10, 20] }] });
const options: SimpleOptions = {
  theme: 'vale',
  layoutOrientation: 'horizontal',
  colorMode: 'text',
  valueFontSize: 26,
  useThreshold: false,
  icon: 'cpu',
  showIcon: false,
  showLabel: true,
  showValue: true,
};
const props = {
  options,
  data: { series: [data], state: LoadingState.Done },
  width: 800,
  height: 200,
  fieldConfig: { defaults: {}, overrides: [] },
  id: 1,
} as unknown as PanelProps<SimpleOptions>;

test('legacy panel shows the latest value and label', () => {
  render(<SimplePanel {...props} />);
  expect(screen.getByText('CPU')).toBeInTheDocument();
  expect(screen.getByText('20')).toBeInTheDocument();
});

test('configured metric renders label, badge and alignments', () => {
  render(
    <SimplePanel
      {...props}
      options={{
        ...options,
        metricMode: 'configured',
        cardLayout: 'grouped',
        metrics: [
          {
            id: 'one',
            source: listMetrics([data])[0].source,
            label: 'Processador',
            horizontalAlign: 'right',
            verticalAlign: 'bottom',
            badgeMode: 'text',
            badgeText: 'ATIVO',
            showIcon: false,
          },
        ],
      }}
    />
  );
  expect(screen.getByText('ATIVO')).toBeInTheDocument();
  expect(screen.getByText('Processador').parentElement?.parentElement).toHaveStyle({
    textAlign: 'right',
    justifyContent: 'flex-end',
  });
  expect(screen.getByText('20')).toBeInTheDocument();
});

test('missing source is explicit even while other data is available', () => {
  render(<SimplePanel {...props} options={{ ...options, metricMode: 'configured', metrics: [{ id: 'missing' }] }} />);
  expect(screen.getByText('Campo indisponível')).toBeInTheDocument();
  expect(screen.queryByText('20')).not.toBeInTheDocument();
});

test('status bar resolves the dashboard hostname and shows both health indicators', () => {
  const source = listMetrics([data])[0].source;
  render(
    <SimplePanel
      {...props}
      replaceVariables={(value) => value.replace('${hostname}', 'srv-interserver')}
      options={{
        ...options,
        displayMode: 'statusBar',
        headerTitle: '${hostname}',
        headerDetailSource: source,
        statusBadges: [
          { id: 'ping', source, label: 'PING' },
          { id: 'agent', source, label: 'AGENTE' },
        ],
        metricMode: 'configured',
        metrics: [{ id: 'cpu', source, label: 'Processador' }],
      }}
    />
  );

  expect(screen.getByText('srv-interserver')).toBeInTheDocument();
  expect(screen.getByText('PING: 20')).toBeInTheDocument();
  expect(screen.getByText('AGENTE: 20')).toBeInTheDocument();
  expect(screen.getByText('Processador')).toBeInTheDocument();
});
