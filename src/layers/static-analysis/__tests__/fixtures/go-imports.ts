// src/layers/static-analysis/__tests__/fixtures/go-imports.ts
// Fixture constants for Go import parser tests.

/**
 * Raw Go source content covering all import forms handled by parseGoImports.
 * Includes: single import, grouped import, blank-alias import, named-alias import,
 * and a duplicate (for dedup testing).
 */
export const GO_IMPORTS_FIXTURE = `
package main

import "fmt"

import (
	"os/exec"
	"fmt"
)

import _ "github.com/lib/pq"

import myalias "pkg"
`.trim();

/**
 * Expected sorted output from parseGoImports when parsing GO_IMPORTS_FIXTURE.
 * "fmt" appears twice but is deduplicated; all forms extract the path string only.
 */
export const GO_IMPORTS_EXPECTED_SORTED = ['fmt', 'github.com/lib/pq', 'os/exec', 'pkg'];
