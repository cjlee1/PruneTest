import { notFound } from 'next/navigation'
import { hashToken, lookupToken } from '@/lib/token'
import { getSavingsTrend, SavingsRow } from '@/lib/queries'
import SavingsChart from './SavingsChart'

interface PageProps {
  params: { token: string }
}

export default async function SavingsPage({ params }: PageProps) {
  const hash = hashToken(params.token)
  const row = await lookupToken(hash)

  if (!row || !row.active) {
    notFound()
  }

  const rows: SavingsRow[] = await getSavingsTrend(row.repoId)

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <p style={{ marginBottom: '1rem' }}>
        <a href={`/p/${params.token}`}>← Back to dashboard</a>
      </p>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        CI Savings
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
        Repository: {row.repoId}
      </p>

      <SavingsChart rows={rows} />

      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '1rem' }}>
        Minutes saved per week. Dollar equivalent assumes $50/hr engineer rate.
      </p>
    </main>
  )
}
