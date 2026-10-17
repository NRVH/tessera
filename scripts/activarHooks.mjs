#!/usr/bin/env node
// =============================================================================
// `npm install` apunta git a los hooks versionados de `.githooks/` (el `pre-commit` corre
// `scripts/calidad/antesDelCommit.mjs`), para que valgan igual en cualquier clon y máquina.
// Fuera de un repo de git, o sin la carpeta, no hace nada: no puede romper una instalación.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (existsSync('.githooks') && existsSync('.git')) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  } catch {
    // Sin git en el PATH no hay hooks que activar.
  }
}
