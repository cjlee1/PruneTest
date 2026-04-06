import { chClient } from './clickhouse'

export interface RunInsert {
  id: string
  repo_id: string
  pr_number: number
  sha: string
  predicted_skip: string[]
  actual_failures: string[]
  all_tests: string[]
  mode: string
  time_saved_minutes: number
  created_at: string
}

/**
 * Checks whether a run with the given id and repo_id already exists in ClickHouse.
 * Fails open — returns false on any error so that the caller can proceed with insertion.
 */
export async function checkRunExists(id: string, repoId: string): Promise<boolean> {
  try {
    const result = await chClient.query({
      query: 'SELECT id FROM runs FINAL WHERE id = {run_id:String} AND repo_id = {repo_id:String} LIMIT 1',
      query_params: { run_id: id, repo_id: repoId },
      format: 'JSONEachRow',
    })
    const rows = await result.json<{ id: string }>()
    return rows.length > 0
  } catch (err) {
    console.error('[runs] dedup check error:', err)
    return false
  }
}

/**
 * Inserts a run record into ClickHouse.
 * Throws on error — the caller is responsible for handling the 500 response.
 */
export async function insertRun(run: RunInsert): Promise<void> {
  try {
    await chClient.insert({
      table: 'runs',
      values: [run],
      format: 'JSONEachRow',
    })
  } catch (err) {
    console.error('[runs] insert error:', err)
    throw err
  }
}
