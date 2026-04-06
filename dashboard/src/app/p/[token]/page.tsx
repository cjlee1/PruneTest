import { notFound } from 'next/navigation'
import { hashToken, lookupToken } from '@/lib/token'
import { getShadowProgress, ShadowProgress, getRecentRuns, RecentRunRow } from '@/lib/queries'

interface PageProps {
  params: { token: string }
}

const SHADOW_THRESHOLD = 50

export default async function TokenPage({ params }: PageProps) {
  const hash = hashToken(params.token)
  const row = await lookupToken(hash)

  if (!row || !row.active) {
    notFound()
  }

  const data: ShadowProgress = await getShadowProgress(row.repoId)
  const recentRuns: RecentRunRow[] = await getRecentRuns(row.repoId)

  const progress = Math.min((data.run_count / SHADOW_THRESHOLD) * 100, 100)

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Repository: {row.repoId}
      </h1>

      {data.run_count === 0 ? (
        <p style={{ color: '#6b7280', marginTop: '1rem' }}>
          No runs yet — data will appear once runs are ingested
        </p>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <div
              style={{
                flex: 1,
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#f9fafb',
              }}
            >
              <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 0.25rem 0' }}>Shadow Runs</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{data.run_count}</p>
            </div>
            <div
              style={{
                flex: 1,
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#f9fafb',
              }}
            >
              <p style={{ fontWeight: 600, color: '#374151', margin: '0 0 0.25rem 0' }}>Avg Skip %</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                {Math.round(data.avg_skip_pct * 100)}%
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: '1.5rem' }}>
            <div
              style={{
                width: '100%',
                height: '12px',
                backgroundColor: '#e5e7eb',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  backgroundColor: '#6366f1',
                  borderRadius: '9999px',
                }}
              />
            </div>
            <p style={{ marginTop: '0.5rem', color: '#374151' }}>
              {data.run_count} / {SHADOW_THRESHOLD} shadow runs complete
            </p>
          </div>
        </>
      )}

      {/* Recent PR table */}
      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>Recent Runs</h2>
        {recentRuns.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No recent runs</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem' }}>PR #</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>SHA</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Mode</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Skip %</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>Failures</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={`${r.pr_number}-${r.sha}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{r.pr_number}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>{r.sha.slice(0, 7)}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{r.mode}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{r.created_at.slice(0, 10)}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>{(r.skip_pct * 100).toFixed(1)}%</td>
                  <td
                    style={{
                      padding: '0.5rem 0.75rem',
                      color: r.failure_count > 0 ? '#dc2626' : undefined,
                    }}
                  >
                    {r.failure_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: '1.5rem' }}>
        <a href={`/p/${params.token}/flaky`}>View flaky test leaderboard →</a>
      </p>
      <p style={{ marginTop: '0.5rem' }}>
        <a href={`/p/${params.token}/accuracy`}>View accuracy trend →</a>
      </p>
      <p style={{ marginTop: '0.5rem' }}>
        <a href={`/p/${params.token}/savings`}>View CI savings →</a>
      </p>
      <p style={{ marginTop: '0.5rem' }}>
        <a href="/upgrade">Support &amp; Enterprise →</a>
      </p>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '2rem 0 1rem' }} />
      <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
        Powered by{' '}
        <a
          href="https://github.com/cjlee1/Skippr"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#6366f1' }}
        >
          Skippr
        </a>{' '}
        — open source, MIT licence.{' '}
        <a href="https://github.com/sponsors/cjlee1" target="_blank" rel="noopener noreferrer" style={{ color: '#db2777' }}>
          ♥ Sponsor
        </a>
      </p>
    </main>
  )
}
