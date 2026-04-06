// src/layers/static-analysis/__tests__/fixtures/py-imports.ts
// Fixture constants for Python import parser tests.

/**
 * Raw Python source content covering all import forms handled by parsePythonImports.
 * Includes: plain import, dotted import, multi-import, from-import, relative import,
 * parent-relative import, and __future__ import (which must be excluded).
 */
export const PY_IMPORTS_FIXTURE = `
import os
import os.path
import os, sys
from os import path
from .utils import foo
from .. import bar
from __future__ import annotations
`.trim();

/**
 * Expected sorted output from parsePythonImports when parsing PY_IMPORTS_FIXTURE.
 * __future__ imports are excluded; relative imports use their dotted text.
 */
export const PY_IMPORTS_EXPECTED_SORTED = ['..', '.utils', 'os', 'os.path', 'sys'];
