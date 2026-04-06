/**
 * success-page.test.tsx
 *
 * The success page now covers self-serve token provisioning (not Stripe subscription).
 */

import SuccessPage from '../app/success/page'
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

describe('SuccessPage', () => {
  it('renders without throwing', () => {
    expect(() => SuccessPage()).not.toThrow()
  })

  it('mentions TESTSELECTOR_TOKEN env var', () => {
    const output = SuccessPage()
    const text = flatText(output)
    expect(text).toContain('TESTSELECTOR_TOKEN')
  })

  it('contains "token" in the copy', () => {
    const output = SuccessPage()
    const text = flatText(output)
    expect(text.toLowerCase()).toContain('token')
  })

  it('contains home link', () => {
    const json = JSON.stringify(SuccessPage())
    expect(json).toContain('"/"')
  })
})
