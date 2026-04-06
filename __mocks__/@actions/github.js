// __mocks__/@actions/github.js
// Jest manual mock stub for @actions/github.
// jest.mock('@actions/github', ...) in tests will override this, but Jest needs
// the module to be resolvable before the factory override takes effect.

module.exports = {
  context: {
    eventName: 'push',
    repo: { owner: '', repo: '' },
    issue: { number: 0 },
  },
  getOctokit: () => ({
    rest: {
      issues: {
        createComment: async () => ({}),
      },
    },
  }),
}
