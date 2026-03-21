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

// Friedrik muted, monochrome-forward palette for pie / multi-category charts
const PIE_COLORS = [
  '#9a7a58', // cognac  (accent)
  '#9a9690', // warm gray
  '#6a6660', // darker gray
  '#7a8a7a', // muted sage
  '#8a7a6a', // warm tan
  '#6a7a8a', // cool steel
  '#8a6a7a', // muted mauve
  '#7a7a6a', // olive gray
  '#6a6a7a', // slate purple
  '#8a8a7a', // khaki gray
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
              <stop offset="5%" stopColor="#6a9a68" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6a9a68" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="spendingGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#6a6660" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6a6660" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: '13px', fontFamily: 'inherit' }} />
          <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'inherit' }} />
          {spec.series.map((s, idx) => {
            const color = idx === 0 ? '#6a9a68' : '#6a6660';
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
