// =============================================================================
// Las preguntas sobre la AUTENTICACIÓN de una conexión (`sql` o `ntlm`), como `switch` que cierran
// con `nunca`: un valor nuevo de `DbAutenticacion` obliga a decidir cada pregunta.
// Hoja (solo `import type` y `nunca`); `src/tdb/sqlserverComun.cjs` lleva su copia CJS, cruzada por
// `test-sqlserver-comun`. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-descriptor.md
// =============================================================================

import type { DbAutenticacion } from '../db-ipc.ts'
import { nunca } from '../nunca.ts'

/** Los valores de `DbAutenticacion`, en el orden en que se ofrecen. */
export const AUTENTICACIONES: readonly DbAutenticacion[] = ['sql', 'ntlm']

/** ¿Es un valor de `DbAutenticacion`? (lo que llega por IPC o del disco se valida con esto). */
export function esAutenticacion(x: unknown): x is DbAutenticacion {
  return typeof x === 'string' && (AUTENTICACIONES as readonly string[]).indexOf(x) >= 0
}

/** La autenticación efectiva de una conexión: la guardada o, sin ella, 'sql'. */
export function autenticacionDe(x: DbAutenticacion | null | undefined): DbAutenticacion {
  return x === null || x === undefined ? 'sql' : x
}

/** ¿Pide esta autenticación el DOMINIO de la cuenta? */
export function pideDominio(a: DbAutenticacion): boolean {
  switch (a) {
    case 'sql':
      return false
    case 'ntlm':
      return true
    default:
      return nunca(a, 'pideDominio')
  }
}
