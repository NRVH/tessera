// =============================================================================
// El entorno con el que nace un proceso de sesión del explorador: en Linux, con las carpetas del
// Instant Client instalado en LD_LIBRARY_PATH, que el enlazador solo lee al arrancar el proceso.
// La lógica es la de `tdb` (`src/tdb/bibliotecasOracle.cjs`), cargada en ejecución: el main no
// importa los `.cjs` de `tdb`. Fuera de Linux, el entorno tal cual.
// Decisiones: docs/decisiones/bd/drivers-catalogo-y-matriz-oracle.md
// =============================================================================

import { createRequire } from 'node:module'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../../shared/plataforma.ts'
import type { CtxDrivers } from './protocoloTrabajador.ts'

interface BibliotecasOracle {
  entornoOracle(env: NodeJS.ProcessEnv, ctx: CtxDrivers, plataforma: string): NodeJS.ProcessEnv
}

/** Lo que hace falta saber del registro: el catálogo de drivers y dónde está `tdb`. */
export interface FuenteDrivers {
  ctxDrivers(): CtxDrivers
  tdbScriptDir(): string
}

/** El entorno base con el cliente Oracle a mano; si algo falla, el base (el error al cargar lo explica). */
export function entornoConClienteOracle(
  base: NodeJS.ProcessEnv,
  fuente: FuenteDrivers,
  plataforma: Plataforma = plataformaActual()
): NodeJS.ProcessEnv {
  if (plataforma !== 'linux') return base
  try {
    const b = createRequire(path.join(fuente.tdbScriptDir(), 'tdb.cjs'))('./bibliotecasOracle.cjs') as BibliotecasOracle
    return b.entornoOracle(base, fuente.ctxDrivers(), 'linux')
  } catch {
    return base
  }
}
