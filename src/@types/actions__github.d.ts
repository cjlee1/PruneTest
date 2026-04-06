// src/@types/actions__github.d.ts
// Minimal type shim for @actions/github — provides just the surface used by
// src/comment.ts. Replaced by the real package (@actions/github@6.0.1) in T02.

declare module '@actions/github' {
  export interface RepoContext {
    owner: string
    repo: string
  }

  export interface GitHubContext {
    eventName: string
    repo: RepoContext
    issue: { number: number }
  }

  /** The current Actions run context. */
  export const context: GitHubContext

  /** Returns an Octokit client authenticated with the provided token. */
  export function getOctokit(token: string): {
    rest: {
      issues: {
        createComment(params: {
          owner: string
          repo: string
          issue_number: number
          body: string
        }): Promise<unknown>
      }
    }
  }
}
