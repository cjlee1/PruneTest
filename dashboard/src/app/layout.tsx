import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Skippr Dashboard',
  description: 'Dashboard for Skippr — ML-backed CI test selection',
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
