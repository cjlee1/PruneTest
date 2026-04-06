/**
 * upgrade-page.test.tsx
 *
 * The upgrade page is now the open-source community / enterprise page.
 * We invoke the default export directly and inspect the rendered JSX tree.
 */

import UpgradePage from '../app/upgrade/page'
import React from 'react'

function flatText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatText).join('')
  const el = node as React.ReactElement
  if (el.props) {
    const children = el.props.children
    return flatText(children)
  }
  return ''
}

describe('UpgradePage', () => {
  it('renders without throwing', () => {
    expect(() => UpgradePage()).not.toThrow()
  })

  it('mentions open-source', () => {
    const output = UpgradePage()
    const text = flatText(output)
    expect(text.toLowerCase()).toContain('open source')
  })

  it('contains sponsor / donate link', () => {
    const json = JSON.stringify(UpgradePage())
    expect(json).toContain('github.com/sponsors')
  })

  it('contains enterprise card heading', () => {
    const output = UpgradePage()
    const text = flatText(output)
    expect(text.toLowerCase()).toContain('enterprise')
  })

  it('contains enterprise contact link pointing to GitHub repo', () => {
    const json = JSON.stringify(UpgradePage())
    expect(json).toContain('github.com/cjlee1/Skippr')
  })

  it('contains attribution section', () => {
    const output = UpgradePage()
    const text = flatText(output)
    expect(text.toLowerCase()).toContain('attribution')
  })

  it('contains MIT licence mention', () => {
    const output = UpgradePage()
    const text = flatText(output)
    expect(text.toLowerCase()).toContain('mit')
  })
})
