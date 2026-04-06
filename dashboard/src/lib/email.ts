/**
 * Email sender dependency type — shared by alerts.ts and any future
 * notification layer. Injected for testability.
 *
 * The open-source build wires this via SMTP (nodemailer) or leaves it
 * as a console-only no-op when SMTP_HOST is not configured.
 */

export type EmailSenderDep = (params: {
  from: string
  to: string
  subject: string
  html: string
}) => Promise<{ error: Error | null }>

/**
 * Build an EmailSenderDep that sends via SMTP using the fetch-based
 * MailChannels Workers API, or falls back to console-only logging.
 *
 * Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / ALERT_FROM_EMAIL
 * in .env.local to enable real email delivery. When those vars are absent
 * the sender logs to console (useful for dev/OSS self-hosted installs).
 */
export function makeConsoleFallbackEmailSender(): EmailSenderDep {
  return async (params) => {
    const smtpHost = process.env.SMTP_HOST
    const fromAddress = process.env.ALERT_FROM_EMAIL ?? 'noreply@testselector.local'

    if (!smtpHost) {
      // No SMTP configured — log and succeed (open-source default)
      console.log(
        `[email] SMTP not configured — would have sent "${params.subject}" to ${params.to}`,
      )
      return { error: null }
    }

    // Minimal SMTP via nodemailer if installed, otherwise log
    try {
      // Dynamic require so nodemailer is optional (not a hard dep)
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const nodemailer = require('nodemailer') as any
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
      await transporter.sendMail({
        from: params.from || fromAddress,
        to: params.to,
        subject: params.subject,
        html: params.html,
      })
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }
}
