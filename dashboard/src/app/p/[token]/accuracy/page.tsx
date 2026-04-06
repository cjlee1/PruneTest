import { notFound } from 'next/navigation'
import { hashToken, lookupToken } from '@/lib/token'
import { getAccuracyTrend, AccuracyRow } from '@/lib/queries'
import AccuracyChart from './AccuracyChart'

interface PageProps {
  params: { token: string }
}

export default async function AccuracyPage({ params }: PageProps) {
  const hash = hashToken(params.token)
  const row = await lookupToken(hash)

  if (!row || !row.active) {
    notFound()
  }

  const rows: AccuracyRow[] = await getAccuracyTrend(row.repoId)

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <p style={{ marginBottom: '1rem' }}>
        <a href={`/p/${params.token}`}>← Back to dashboard</a>
      </p>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Accuracy Trend
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
        Repository: {row.repoId}
      </p>

      <AccuracyChart rows={rows} />
    </main>
  )
}
