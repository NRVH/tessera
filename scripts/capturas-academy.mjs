// =============================================================================
// Regenera las capturas de Tessera Academy (`src/renderer/src/features/academy/capturas/`) con
// `e2e/capturas-readme.spec.ts`, una pasada en español y otra en inglés. No toca las del README.
// Hace falta el paquete (`npm run pack:dir`) y Docker para la base de datos de demostración.
// =============================================================================

import { spawnSync } from 'node:child_process'

for (const idioma of ['es', 'en']) {
  const r = spawnSync('npx', ['playwright', 'test', 'e2e/capturas-readme.spec.ts'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TESSERA_CAPTURAS_README: '1', TESSERA_CAPTURAS_ACADEMY: '1', TESSERA_CAPTURAS_IDIOMA: idioma }
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
