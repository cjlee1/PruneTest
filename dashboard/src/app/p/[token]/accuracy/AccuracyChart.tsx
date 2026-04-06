"use client"

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { AccuracyRow } from '@/lib/queries'

interface AccuracyChartProps {
  rows: AccuracyRow[]
}

export default function AccuracyChart({ rows }: AccuracyChartProps) {
  if (rows.length === 0) {
    return <p style={{ color: '#6b7280' }}>No accuracy data yet</p>
  }

  const chartData = rows.map((row) => ({
    week: row.week,
    accuracy:
      row.total_failures === 0
        ? 100
        : (1 - row.missed_failures / row.total_failures) * 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke="#6366f1"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
