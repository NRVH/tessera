// =============================================================================
// Regenera las capturas del README (`assets/capturas/`) con `e2e/capturas-readme.spec.ts`.
// Pone `TESSERA_CAPTURAS_README=1` (el spec no corre sin ella) de forma portable, sin
// `cross-env`. Hace falta el paquete: `npm run pack:dir` (Windows) o `npm run pack:mac:dir`.
// =============================================================================

import { spawnSync } from 'node:child_process'

const r = spawnSync('npx', ['playwright', 'test', 'e2e/capturas-readme.spec.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TESSERA_CAPTURAS_README: '1' }
})
process.exit(r.status ?? 1)
