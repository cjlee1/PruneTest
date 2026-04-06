export default function UpgradePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Open Source — Free Forever
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem', lineHeight: 1.6 }}>
        PruneTest is free and open-source under the MIT licence.
        Self-host it, fork it, and contribute back.
      </p>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {/* Support card */}
        <div
          style={{
            flex: 1,
            minWidth: '260px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '1.5rem',
            backgroundColor: '#f9fafb',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 0 }}>Support the project</h2>
          <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            If this tool saves your team time, consider sponsoring to keep development active.
          </p>
          <a
            href="https://github.com/sponsors/cjlee1"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              backgroundColor: '#db2777',
              color: '#fff',
              padding: '0.625rem 1.25rem',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            ♥ Sponsor on GitHub
          </a>
        </div>

        {/* Enterprise card */}
        <div
          style={{
            flex: 1,
            minWidth: '260px',
            border: '2px solid #6366f1',
            borderRadius: '8px',
            padding: '1.5rem',
            backgroundColor: '#f5f3ff',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 0 }}>Enterprise</h2>
          <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '0.75rem' }}>
            Running this at scale (1 000+ repos, 50+ engineers, SOC 2 requirements)?
            Let&apos;s talk about a supported deployment.
          </p>
          <ul style={{ paddingLeft: '1.25rem', color: '#374151', marginBottom: '1.5rem' }}>
            <li>Managed cloud hosting</li>
            <li>SLA &amp; dedicated support</li>
            <li>Custom model training</li>
            <li>SSO / audit logs</li>
          </ul>
          <a
            href="https://github.com/cjlee1/PruneTest"
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
            Contact us →
          </a>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '2rem 0' }} />

      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Attribution</h2>
      <p style={{ color: '#374151', lineHeight: 1.6, fontSize: '0.9rem' }}>
        Built by{' '}
        <a href="https://github.com/cjlee1" target="_blank" rel="noopener noreferrer">
          Calvin Lee
        </a>
        . If you use this project in a commercial context, a link back in your{' '}
        <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>README</code>{' '}
        or documentation is appreciated but not required.
      </p>
    </main>
  )
}
