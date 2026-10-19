'use client';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from 'recharts';

function compactMoney(minor: number, currency: string) {
  const v = minor / 100;
  if (currency !== 'INR')
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v);
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${v.toFixed(0)}`;
}

const axis = { stroke: 'var(--faint)', fontSize: 12 };
const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  fontSize: 12.5,
  color: 'var(--ink)',
};

export function TrendChart({
  data,
  currency = 'INR',
}: {
  data: Array<{ date: string; leads: number; qualified: number; spend: number | null }>;
  currency?: string;
}) {
  const fmt = (v: number) => compactMoney(v, currency);
  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label="Daily leads, qualified leads and ad spend over the selected period"
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            tick={axis}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <YAxis
            yAxisId="r"
            orientation="right"
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={fmt}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, n) => (n === 'Spend' ? (v == null ? 'No data' : fmt(Number(v))) : v)}
          />
          <Legend wrapperStyle={{ fontSize: 12.5 }} />
          <Bar
            isAnimationActive={false}
            yAxisId="l"
            dataKey="leads"
            name="Leads"
            fill="var(--accent)"
            radius={[2, 2, 0, 0]}
            maxBarSize={18}
          />
          <Bar
            isAnimationActive={false}
            yAxisId="l"
            dataKey="qualified"
            name="Qualified"
            fill="var(--ok)"
            radius={[2, 2, 0, 0]}
            maxBarSize={18}
          />
          <Line
            isAnimationActive={false}
            yAxisId="r"
            dataKey="spend"
            name="Spend"
            stroke="var(--warn)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpendLeadsChart({
  data,
  currency = 'INR',
}: {
  data: Array<{ date: string; spend: number; crmLeads: number; platformLeads: number | null }>;
  currency?: string;
}) {
  const fmt = (v: number) => compactMoney(v, currency);
  return (
    <div className="h-64 w-full" role="img" aria-label="Daily spend with platform and CRM leads">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            tick={axis}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <YAxis
            yAxisId="r"
            orientation="right"
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={fmt}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, n) => (n === 'Spend' ? fmt(Number(v)) : v == null ? 'No data' : v)}
          />
          <Legend wrapperStyle={{ fontSize: 12.5 }} />
          <Bar
            isAnimationActive={false}
            yAxisId="r"
            dataKey="spend"
            name="Spend"
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            maxBarSize={16}
          />
          <Line
            isAnimationActive={false}
            yAxisId="l"
            dataKey="platformLeads"
            name="Platform leads"
            stroke="var(--info)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            isAnimationActive={false}
            yAxisId="l"
            dataKey="crmLeads"
            name="CRM leads"
            stroke="var(--ok)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBar({
  data,
  valueLabel,
}: {
  data: Array<{ label: string; value: number; secondary?: number }>;
  valueLabel: string;
}) {
  return (
    <div
      className="w-full"
      style={{ height: Math.max(120, data.length * 34 + 40) }}
      role="img"
      aria-label={valueLabel}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar
            isAnimationActive={false}
            dataKey="value"
            name={valueLabel}
            fill="var(--accent)"
            radius={[0, 3, 3, 0]}
            maxBarSize={18}
          />
          {data.some((d) => d.secondary != null) ? (
            <Bar
              dataKey="secondary"
              name="Qualified"
              fill="var(--ok)"
              radius={[0, 3, 3, 0]}
              maxBarSize={18}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
