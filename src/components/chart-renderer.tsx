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

// Color palette for pie charts
const PIE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#a855f7', // purple
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
            const color = idx === 0 ? '#10b981' : idx === 1 ? '#ef4444' : '#94a3b8';
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
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="spendingGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: '13px', fontFamily: 'inherit' }} />
          <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'inherit' }} />
          {spec.series.map((s, idx) => {
            const color = idx === 0 ? '#10b981' : '#ef4444';
            const gradient = idx === 0 ? 'url(#incomeGradient)' : 'url(#spendingGradient)';
            return (
              <Area
                key={s.label}
                dataKey={s.label}
                fill={gradient}
                name={s.label}
                stroke={color}
                strokeWidth={2}
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
            const color = idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#94a3b8';
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
            stroke="#fff"
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
