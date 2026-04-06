/**
 * Unit tests for alerts.ts (getAlertState, upsertAlertState, checkAndFireAlerts)
 * and queries.ts#getRecentRecall.
 *
 * Mocks @clickhouse/client-web and ../lib/db/index to avoid real network calls.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks (must precede all imports)
// ---------------------------------------------------------------------------

const mockQuery = jest.fn()

jest.mock('@clickhouse/client-web', () => ({
  createClient: jest.fn(() => ({
    query: mockQuery,
  })),
}))

// Drizzle select chain mock
const mockSelect = jest.fn()

// Drizzle insert chain mock — supports .values().onConflictDoUpdate()
const mockOnConflictDoUpdate = jest.fn()
const mockValues = jest.fn()
const mockInsert = jest.fn()

jest.mock('../lib/db/index', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
  schema: {},
}))

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((_col: unknown, val: unknown) => val),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getRecentRecall } from '../lib/queries'
import { getAlertState, upsertAlertState, checkAndFireAlerts } from '../lib/alerts'
import type { AlertState, NewAlertState } from '../lib/alerts'
import type { EmailSenderDep } from '../lib/email'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake Drizzle SELECT builder chain that resolves to the given rows. */
function makeSelectChain(result: unknown[]) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  }
}

afterEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getRecentRecall
// ---------------------------------------------------------------------------

describe('getRecentRecall', () => {
  it('happy path: computes recall correctly from ClickHouse rows', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '2', total_failures: '20' }]),
    })

    const result = await getRecentRecall('org/repo')
    // recall = (20 - 2) / 20 = 0.9
    expect(result).toEqual({ recall: 0.9, total_failures: 20 })
    expect(typeof result.recall).toBe('number')
    expect(typeof result.total_failures).toBe('number')
  })

  it('no failures: returns recall=1.0 (not NaN) when total_failures=0', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '0', total_failures: '0' }]),
    })

    const result = await getRecentRecall('org/repo')
    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
    expect(Number.isNaN(result.recall)).toBe(false)
  })

  it('empty result: returns recall=1.0, total_failures=0', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([]),
    })

    const result = await getRecentRecall('org/repo')
    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
  })

  it('ClickHouse error: fails open, returns { recall: 1.0, total_failures: 0 }, logs correct prefix', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ClickHouse connection refused'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getRecentRecall('org/repo')

    expect(result).toEqual({ recall: 1.0, total_failures: 0 })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[queries] getRecentRecall error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('passes custom n parameter to the query', async () => {
    mockQuery.mockResolvedValueOnce({
      json: jest.fn().mockResolvedValueOnce([{ missed: '1', total_failures: '10' }]),
    })

    await getRecentRecall('org/repo', 50)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: expect.objectContaining({ n: 50 }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// getAlertState
// ---------------------------------------------------------------------------

describe('getAlertState', () => {
  const fakeState: AlertState = {
    repoId: 'org/repo',
    alertFiredAt: new Date('2024-01-01T00:00:00Z'),
    recoveredAt: null,
    alertEmail: 'eng@example.com',
    slackWebhookUrl: null,
  }

  it('found: returns the AlertState row', async () => {
    mockSelect.mockReturnValue(makeSelectChain([fakeState]))

    const result = await getAlertState('org/repo')
    expect(result).toEqual(fakeState)
  })

  it('not found: returns null when query returns empty array', async () => {
    mockSelect.mockReturnValue(makeSelectChain([]))

    const result = await getAlertState('org/repo')
    expect(result).toBeNull()
  })

  it('DB error: fails open, returns null, logs with correct prefix', async () => {
    mockSelect.mockImplementation(() => {
      throw new Error('DB unavailable')
    })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await getAlertState('org/repo')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      '[alerts] getAlertState error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// upsertAlertState
// ---------------------------------------------------------------------------

describe('upsertAlertState', () => {
  const newState: NewAlertState = {
    repoId: 'org/repo',
    alertFiredAt: new Date('2024-01-01T00:00:00Z'),
    recoveredAt: null,
    alertEmail: 'eng@example.com',
    slackWebhookUrl: null,
  }

  it('happy path: calls insert → values → onConflictDoUpdate once', async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce(undefined)
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
    mockInsert.mockReturnValue({ values: mockValues })

    await upsertAlertState(newState)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockValues).toHaveBeenCalledWith(newState)
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          alertFiredAt: newState.alertFiredAt,
          recoveredAt: newState.recoveredAt,
          alertEmail: newState.alertEmail,
          slackWebhookUrl: newState.slackWebhookUrl,
        }),
      }),
    )
  })

  it('DB error: fails open, logs with correct prefix, does not throw', async () => {
    mockInsert.mockImplementation(() => {
      throw new Error('DB write failed')
    })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(upsertAlertState(newState)).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith(
      '[alerts] upsertAlertState error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// checkAndFireAlerts
// ---------------------------------------------------------------------------

describe('checkAndFireAlerts', () => {
  // Helpers to build injected deps
  function makeGetRecall(recall: number) {
    return jest.fn().mockResolvedValue({ recall, total_failures: 10 })
  }

  function makeGetState(state: AlertState | null) {
    return jest.fn().mockResolvedValue(state)
  }

  function makeUpsertState() {
    return jest.fn().mockResolvedValue(undefined)
  }

  function makeEmailSender(error: Error | null = null): jest.MockedFunction<EmailSenderDep> {
    return jest.fn<ReturnType<EmailSenderDep>, Parameters<EmailSenderDep>>().mockResolvedValue({ error })
  }

  const repoId = 'org/testrepo'

  it('recall ≥ 0.95, no prior alert → no email sent, no state write', async () => {
    const getRecall = makeGetRecall(0.97)
    const getState = makeGetState(null)
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).not.toHaveBeenCalled()
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('recall < 0.95, no prior alert, alertEmail set → degradation email sent, upsertState called with alertFiredAt', async () => {
    const getRecall = makeGetRecall(0.80)
    const getState = makeGetState({
      repoId,
      alertFiredAt: null,
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: null,
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).toHaveBeenCalledTimes(1)
    expect(emailSender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'eng@example.com',
        subject: `TestSelector: Accuracy alert for ${repoId}`,
      }),
    )
    expect(upsertState).toHaveBeenCalledTimes(1)
    const upsertArg = upsertState.mock.calls[0][0] as NewAlertState
    expect(upsertArg.alertFiredAt).toBeInstanceOf(Date)
    expect(upsertArg.recoveredAt).toBeNull()
    expect(upsertArg.repoId).toBe(repoId)
  })

  it('recall < 0.95, alertFiredAt already set, recoveredAt null → dedup: no email, logs [alerts] alert already fired:', async () => {
    const getRecall = makeGetRecall(0.80)
    const getState = makeGetState({
      repoId,
      alertFiredAt: new Date('2024-01-01T00:00:00Z'),
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: null,
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).not.toHaveBeenCalled()
    expect(upsertState).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[alerts] alert already fired:'),
    )
    consoleSpy.mockRestore()
  })

  it('recall ≥ 0.98, alertFiredAt set, recoveredAt null → recovery email sent, upsertState called with recoveredAt set', async () => {
    const firedAt = new Date('2024-01-01T00:00:00Z')
    const getRecall = makeGetRecall(0.99)
    const getState = makeGetState({
      repoId,
      alertFiredAt: firedAt,
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: null,
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).toHaveBeenCalledTimes(1)
    expect(emailSender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'eng@example.com',
        subject: `TestSelector: Accuracy recovered for ${repoId}`,
      }),
    )
    expect(upsertState).toHaveBeenCalledTimes(1)
    const upsertArg = upsertState.mock.calls[0][0] as NewAlertState
    expect(upsertArg.recoveredAt).toBeInstanceOf(Date)
    expect(upsertArg.alertFiredAt).toBe(firedAt) // preserves original firedAt
  })

  it('recall ≥ 0.98, alertFiredAt set, recoveredAt already set → no duplicate recovery email', async () => {
    const getRecall = makeGetRecall(0.99)
    const getState = makeGetState({
      repoId,
      alertFiredAt: new Date('2024-01-01T00:00:00Z'),
      recoveredAt: new Date('2024-01-02T00:00:00Z'),
      alertEmail: 'eng@example.com',
      slackWebhookUrl: null,
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).not.toHaveBeenCalled()
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('no alertEmail configured → email dep NOT called', async () => {
    const getRecall = makeGetRecall(0.80)
    const getState = makeGetState({
      repoId,
      alertFiredAt: null,
      recoveredAt: null,
      alertEmail: null,
      slackWebhookUrl: null,
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender })

    expect(emailSender).not.toHaveBeenCalled()
    // upsertState IS still called to record the degradation
    expect(upsertState).toHaveBeenCalledTimes(1)
  })

  it('Slack URL set → slackPost called with text containing repoId', async () => {
    const getRecall = makeGetRecall(0.80)
    const getState = makeGetState({
      repoId,
      alertFiredAt: null,
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: 'https://hooks.slack.com/test',
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()
    const slackPost = jest.fn().mockResolvedValue(undefined)

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender, slackPost })

    expect(slackPost).toHaveBeenCalledTimes(1)
    expect(slackPost).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.stringContaining(repoId),
    )
  })

  it('getRecall throws → fail-open: no crash, no email sent', async () => {
    const getRecall = jest.fn().mockRejectedValue(new Error('ClickHouse exploded'))
    const getState = makeGetState(null)
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender }),
    ).resolves.toBeUndefined()

    expect(emailSender).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      '[alerts] checkAndFireAlerts error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('Slack recovery: recall ≥ 0.98, alertFiredAt set, recoveredAt null, slackWebhookUrl set → slackPost called with text containing "recovered"', async () => {
    const firedAt = new Date('2024-01-01T00:00:00Z')
    const getRecall = makeGetRecall(0.99)
    const getState = makeGetState({
      repoId,
      alertFiredAt: firedAt,
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: 'https://hooks.slack.com/test',
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()
    const slackPost = jest.fn().mockResolvedValue(undefined)

    await checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender, slackPost })

    expect(slackPost).toHaveBeenCalledTimes(1)
    expect(slackPost).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.stringContaining('recovered'),
    )
    expect(upsertState).toHaveBeenCalledTimes(1)
    const upsertArg = upsertState.mock.calls[0][0] as NewAlertState
    expect(upsertArg.recoveredAt).toBeInstanceOf(Date)
  })

  it('Slack error on recovery swallowed: slackPost throws → no crash, upsertState still called with recoveredAt set', async () => {
    const firedAt = new Date('2024-01-01T00:00:00Z')
    const getRecall = makeGetRecall(0.99)
    const getState = makeGetState({
      repoId,
      alertFiredAt: firedAt,
      recoveredAt: null,
      alertEmail: 'eng@example.com',
      slackWebhookUrl: 'https://hooks.slack.com/test',
    })
    const upsertState = makeUpsertState()
    const emailSender = makeEmailSender()
    const slackPost = jest.fn().mockRejectedValue(new Error('slack down'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      checkAndFireAlerts(repoId, { getRecall, getState, upsertState, emailSender, slackPost }),
    ).resolves.toBeUndefined()

    expect(upsertState).toHaveBeenCalledTimes(1)
    const upsertArg = upsertState.mock.calls[0][0] as NewAlertState
    expect(upsertArg.recoveredAt).toBeInstanceOf(Date)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[alerts] Slack webhook error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})
