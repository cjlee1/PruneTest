export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Skippr
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem', lineHeight: 1.6 }}>
        An open-source CI tool that uses semantic analysis and ML to skip tests that
        are provably unaffected by a pull request — cutting CI time without sacrificing safety.
      </p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <a
          href="https://github.com/cjlee1/Skippr"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            backgroundColor: '#1f2937',
            color: '#fff',
            padding: '0.625rem 1.25rem',
            borderRadius: '6px',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          ★ Star on GitHub
        </a>
        <a
          href="https://github.com/cjlee1/Skippr"
          style={{
            display: 'inline-block',
            backgroundColor: '#6366f1',
            color: '#fff',
            padding: '0.625rem 1.25rem',
            borderRadius: '6px',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Enterprise inquiry →
        </a>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '1.5rem 0' }} />

      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Your dashboard
      </h2>
      <p style={{ color: '#374151' }}>
        Enter your token URL: <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>/p/&lt;your-token&gt;</code>
      </p>
    </main>
  )
}
