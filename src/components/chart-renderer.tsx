import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartSpec } from '@/lib/types';
import { Card, CardContent, CardHeader } from './ui/card';

type Props = {
  spec: ChartSpec;
};

// Friedrik muted palette — distinct hues at low saturation for pie / multi-category charts
export const PIE_COLORS = [
  '#9a7a58', // cognac (accent)
  '#7a9ec4', // slate blue
  '#6a9e78', // sage green
  '#b87a74', // dusty rose
  '#a89a5c', // olive gold
  '#9a7eb8', // muted lavender
  '#6a9e96', // teal
  '#b8916a', // warm tan
  '#7a7eb8', // periwinkle
  '#c08aa0', // mauve pink
];

export function ChartRenderer({ spec }: Props) {
  const merged = mergeSeries(spec.series);
  const primary = spec.series[0];
  const pieData = primary?.data ?? [];

  const chartContent = (
    <ResponsiveContainer height="100%" width="100%">
      {spec.type === 'line' && (
        <LineChart data={merged}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: '13px', fontFamily: 'inherit' }} />
          {spec.series.map((s, idx) => {
            const color = idx === 0 ? '#6a9a68' : idx === 1 ? '#6a6660' : '#9a7a58';
            return (
              <Line
                key={s.label}
                dataKey={s.label}
                dot={false}
                name={s.label}
                stroke={color}
                strokeWidth={2}
                type="monotone"
              />
            );
          })}
        </LineChart>
      )}
      {spec.type === 'area' && (
        <AreaChart data={merged}>
          <defs>
            <linearGradient id="incomeGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#9a7a58" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#9a7a58" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="spendingGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#6a6660" stopOpacity={0.06} />
              <stop offset="95%" stopColor="#6a6660" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid-line)" strokeDasharray="none" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="x"
            tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            tickLine={false}
            width={45}
          />
          <Tooltip
            contentStyle={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-hover)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}
            formatter={(value: number | undefined) =>
              value !== undefined ? [`$${value.toLocaleString()}`, undefined] : ['$0', undefined]
            }
            labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
          />
          {spec.series.map((s, idx) => {
            const color = idx === 0 ? '#9a7a58' : '#6a6660';
            const gradient = idx === 0 ? 'url(#incomeGradient)' : 'url(#spendingGradient)';
            return (
              <Area
                key={s.label}
                dataKey={s.label}
                fill={gradient}
                name={s.label}
                stroke={color}
                strokeDasharray={idx === 1 ? '4 3' : undefined}
                strokeWidth={1.5}
                type="monotone"
              />
            );
          })}
        </AreaChart>
      )}
      {spec.type === 'bar' && (
        <BarChart data={merged}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: '13px', fontFamily: 'inherit' }} />
          {spec.series.map((s, idx) => {
            const color = idx === 0 ? '#9a7a58' : idx === 1 ? '#6a6660' : '#9a9690';
            return <Bar key={s.label} dataKey={s.label} fill={color} />;
          })}
        </BarChart>
      )}
      {spec.type === 'pie' && (
        <PieChart>
          <Tooltip
            contentStyle={{ fontSize: '13px', fontFamily: 'inherit' }}
            formatter={(value: number | undefined) =>
              value !== undefined ? `$${value.toLocaleString()}` : '$0'
            }
          />
          <Legend
            align="right"
            layout="vertical"
            verticalAlign="middle"
            wrapperStyle={{ fontSize: '12px', fontFamily: 'inherit', lineHeight: '1.6' }}
          />
          <Pie
            data={pieData}
            dataKey="y"
            innerRadius="25%"
            label={false}
            nameKey="x"
            outerRadius="70%"
            stroke="var(--bg-primary)"
            strokeWidth={2}
          >
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      )}
    </ResponsiveContainer>
  );

  // Only wrap in Card if there's a title (standalone mode)
  if (spec.title) {
    return (
      <Card>
        <CardHeader>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{spec.title}</div>
        </CardHeader>
        <CardContent className="h-64">{chartContent}</CardContent>
      </Card>
    );
  }

  // No wrapper - for embedding in existing cards
  return chartContent;
}

function mergeSeries(series: ChartSpec['series']) {
  const byX: Record<string, Record<string, any>> = {};
  series.forEach((s) => {
    s.data.forEach((point) => {
      const key = String(point.x);
      byX[key] = byX[key] ?? { x: point.x };
      byX[key][s.label] = point.y;
    });
  });
  return Object.values(byX);
}
