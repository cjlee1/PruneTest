// src/layers/static-analysis/__tests__/fixtures/rb-imports.ts
// Fixture constants for Ruby import parser tests.

/**
 * Raw Ruby source content covering all import forms handled by parseRubyImports.
 * Includes: require with single quotes, require_relative, require with parens,
 * a non-require call (puts), and a duplicate require (for dedup testing).
 */
export const RB_IMPORTS_FIXTURE = `
require 'rails'
require_relative './utils'
require('json')
puts 'hello'
require 'rails'
`.trim();

/**
 * Expected sorted output from parseRubyImports when parsing RB_IMPORTS_FIXTURE.
 * 'rails' is deduplicated; 'puts' is skipped; results are sorted alphabetically.
 */
export const RB_IMPORTS_EXPECTED_SORTED = ['./utils', 'json', 'rails'];
