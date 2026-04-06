import type { Config } from 'drizzle-kit'

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.NEON_DATABASE_URL!,
  },
} satisfies Config

// If NEON_DATABASE_URL is not set in the environment, apply the schema change manually:
// ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS stripe_session_id TEXT UNIQUE;
