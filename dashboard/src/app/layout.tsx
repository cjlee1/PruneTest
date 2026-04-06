import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'PruneTest Dashboard',
  description: 'Dashboard for PruneTest — ML-backed CI test selection',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
