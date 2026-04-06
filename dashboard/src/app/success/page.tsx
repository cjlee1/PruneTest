export default function SuccessPage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
        Token ready 🎉
      </h1>
      <p style={{ color: '#374151', lineHeight: 1.6 }}>
        Your API token has been provisioned. Add it to your CI as the{' '}
        <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
          TESTSELECTOR_TOKEN
        </code>{' '}
        environment variable.
      </p>
      <p style={{ marginTop: '1rem', color: '#374151', lineHeight: 1.6 }}>
        If you received the token by email it is shown once — keep it safe.
        If you provisioned it via the admin scripts, copy it from the terminal output.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <a href="/" style={{ color: '#6366f1' }}>Return to home →</a>
      </p>
    </main>
  )
}
