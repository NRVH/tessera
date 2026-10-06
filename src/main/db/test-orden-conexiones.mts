// =============================================================================
// Prueba del ORDEN de conexiones (npm run test:db-orden) sobre el `ConnectionStore` REAL (`list` y
// `reorder`) con un registro en un temporal y un cifrado de mentira: antes probaba una copia de la
// lógica que ya se había separado de la del store (no sabía de las posiciones de las ajenas).
// Lo que protege: que reordenar arrastrando no PIERDA conexiones ni las mueva de perfil. Perder
// una parecería un borrado, y no hay deshacer.
// =============================================================================

import { register } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// El store importa sin extensión (lo compila Vite): este gancho le añade `.ts` bajo `node`.
const resolverTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolverTs))
const { ConnectionStore } = await import('./ConnectionStore.ts')

/** Sin secretos en esta prueba: el cifrado no se llega a usar. */
const cifradoFalso = {
  disponible: () => true,
  cifrar: (s: string) => Buffer.from(s, 'utf-8'),
  descifrar: (b: Buffer) => Buffer.from(b).toString('utf-8')
}

interface Fila {
  id: string
  profileId: string
  alias: string
  orden?: number
  motor?: string
}

const dir = mkdtempSync(path.join(tmpdir(), 'tessera-orden-'))
let n = 0

/** Un store real sobre un registro con estas filas (de PostgreSQL salvo que digan otro motor). */
function storeCon(filas: Fila[]): { store: InstanceType<typeof ConnectionStore>; ruta: string } {
  const ruta = path.join(dir, `registro-${++n}.json`)
  const connections = filas.map((f) => ({ motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: true, ...f }))
  writeFileSync(ruta, JSON.stringify({ version: 2, connections }))
  return { store: new ConnectionStore({ storePath: ruta, cifrado: cifradoFalso }), ruta }
}

/** La posición guardada de cada conexión, por id: lo que queda en el registro (el DTO no la expone). */
function ordenesEnDisco(ruta: string): Record<string, number | undefined> {
  const doc = JSON.parse(readFileSync(ruta, 'utf-8')) as { connections: Array<{ id: string; orden?: number }> }
  return Object.fromEntries(doc.connections.map((c) => [c.id, c.orden]))
}

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}
const alias = (s: InstanceType<typeof ConnectionStore>, perfil: string): string => s.list(perfil).map((c) => c.alias).join(',')

console.log('\norden de conexiones (ConnectionStore real)\n')

try {
  // --- Ordenación ------------------------------------------------------------
  {
    const { store } = storeCon([
      { id: '3', profileId: 'alfa', alias: 'C', orden: 2 },
      { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
      { id: '2', profileId: 'alfa', alias: 'B', orden: 1 }
    ])
    comprobar('respeta la posición fijada', alias(store, 'alfa') === 'A,B,C', alias(store, 'alfa'))
  }
  {
    // Registros de una versión anterior: sin posición, al final y por alias.
    const { store } = storeCon([
      { id: '1', profileId: 'alfa', alias: 'Zeta' },
      { id: '2', profileId: 'alfa', alias: 'Alfa' },
      { id: '3', profileId: 'alfa', alias: 'Puesta', orden: 0 }
    ])
    comprobar('las sin posición van al final, por alias', alias(store, 'alfa') === 'Puesta,Alfa,Zeta', alias(store, 'alfa'))
  }

  // --- Reordenar -------------------------------------------------------------
  {
    const { store, ruta } = storeCon([
      { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
      { id: '2', profileId: 'alfa', alias: 'B', orden: 1 },
      { id: '3', profileId: 'alfa', alias: 'C', orden: 2 }
    ])
    store.reorder('alfa', ['3', '1', '2'])
    comprobar('aplica el orden pedido', alias(store, 'alfa') === 'C,A,B', alias(store, 'alfa'))
    comprobar('no pierde ninguna', store.list('alfa').length === 3)
    const releido = new ConnectionStore({ storePath: ruta, cifrado: cifradoFalso })
    comprobar('y el orden queda guardado en el registro', alias(releido, 'alfa') === 'C,A,B', alias(releido, 'alfa'))
  }
  {
    // Vista desfasada: la UI no vio una conexión creada entre medias. NO debe perderse.
    const { store } = storeCon([
      { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
      { id: '2', profileId: 'alfa', alias: 'B', orden: 1 },
      { id: 'nueva', profileId: 'alfa', alias: 'N', orden: 2 }
    ])
    store.reorder('alfa', ['2', '1'])
    comprobar('conserva las que la UI no mencionó', store.list('alfa').length === 3, alias(store, 'alfa'))
    comprobar('y las deja detrás', alias(store, 'alfa') === 'B,A,N', alias(store, 'alfa'))
  }
  {
    // Ids de OTRO perfil en el payload: se ignoran y no tocan nada suyo.
    const { store, ruta } = storeCon([
      { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
      { id: 'x', profileId: 'cliente', alias: 'X', orden: 0 }
    ])
    store.reorder('alfa', ['x', '1'])
    comprobar('ignora ids de otro perfil', alias(store, 'alfa') === 'A', alias(store, 'alfa'))
    comprobar('no descoloca el otro perfil', ordenesEnDisco(ruta).x === 0, JSON.stringify(ordenesEnDisco(ruta)))
  }
  {
    const { store, ruta } = storeCon([{ id: '1', profileId: 'alfa', alias: 'A', orden: 0 }])
    store.reorder('alfa', [])
    comprobar('lista vacía no hace nada', ordenesEnDisco(ruta)['1'] === 0, JSON.stringify(ordenesEnDisco(ruta)))
  }
  {
    // Lo que la copia de antes no sabía: una conexión de un motor que esta versión no conoce
    // conserva su posición, y las que se reordenan ocupan los huecos libres sin pisarla.
    const { store, ruta } = storeCon([
      { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
      { id: 'ajena', profileId: 'alfa', alias: 'Duck', orden: 1, motor: 'duckdb' },
      { id: '2', profileId: 'alfa', alias: 'B', orden: 2 }
    ])
    store.reorder('alfa', ['2', '1'])
    const ordenes = ordenesEnDisco(ruta)
    comprobar('reordenar salta la posición de una ajena del perfil', ordenes['2'] === 0 && ordenes['1'] === 2 && ordenes.ajena === 1, JSON.stringify(ordenes))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
