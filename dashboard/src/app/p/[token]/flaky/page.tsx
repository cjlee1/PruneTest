import { notFound } from 'next/navigation'
import { hashToken, lookupToken } from '@/lib/token'
import { getFlakyLeaderboard, FlakyRow } from '@/lib/queries'

interface PageProps {
  params: { token: string }
}

export default async function FlakyPage({ params }: PageProps) {
  const hash = hashToken(params.token)
  const row = await lookupToken(hash)

  if (!row || !row.active) {
    notFound()
  }

  const rows: FlakyRow[] = await getFlakyLeaderboard(row.repoId)

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <p style={{ marginBottom: '1rem' }}>
        <a href={`/p/${params.token}`}>← Back to dashboard</a>
      </p>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Flaky Test Leaderboard
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
        Repository: {row.repoId}
      </p>

      {rows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>
          No flaky tests detected yet (needs &gt;5 runs per test)
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0', color: '#374151' }}>Test Path</th>
              <th style={{ padding: '0.5rem 1rem', color: '#374151' }}>Flake Score</th>
              <th style={{ padding: '0.5rem 0 0.5rem 1rem', color: '#374151' }}>Total Runs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.test_path}
                style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}
              >
                <td style={{ padding: '0.5rem 1rem 0.5rem 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {r.test_path}
                </td>
                <td style={{ padding: '0.5rem 1rem', color: r.flake_score >= 0.5 ? '#dc2626' : '#d97706' }}>
                  {(r.flake_score * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '0.5rem 0 0.5rem 1rem', color: '#374151' }}>
                  {r.total_runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
