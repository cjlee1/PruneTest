"use client"

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { SavingsRow } from '@/lib/queries'

interface SavingsChartProps {
  rows: SavingsRow[]
}

export default function SavingsChart({ rows }: SavingsChartProps) {
  if (rows.length === 0) {
    return <p style={{ color: '#6b7280' }}>No savings data yet</p>
  }

  const chartData = rows.map((row) => ({
    week: row.week,
    minutes_saved: row.minutes_saved,
    dollars_saved: row.minutes_saved / 60 * 50,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="minutes_saved" fill="#6366f1" />
      </BarChart>
    </ResponsiveContainer>
  )
}
