// =============================================================================
// Prueba del ORDEN de conexiones (npm run test:db-orden). Lógica pura extraída del
// store: mismo criterio de ordenación y misma reasignación de posiciones.
// -----------------------------------------------------------------------------
// Lo que protege: que reordenar arrastrando no PIERDA conexiones ni las mueva de
// perfil. El fallo caro no es un orden raro —eso se ve y se corrige arrastrando otra
// vez— sino que una conexión desaparezca de la lista porque el reordenamiento la
// dejó fuera; eso parecería un borrado y no hay deshacer.
// =============================================================================

interface Fila {
  id: string
  profileId: string
  alias: string
  orden?: number
}

/** Copia EXACTA del criterio de `ConnectionStore.list`. */
function ordenar(filas: Fila[], profileId: string): Fila[] {
  return filas
    .filter((c) => c.profileId === profileId)
    .slice()
    .sort((a, b) => {
      const oa = a.orden ?? Number.MAX_SAFE_INTEGER
      const ob = b.orden ?? Number.MAX_SAFE_INTEGER
      return oa !== ob ? oa - ob : a.alias.localeCompare(b.alias)
    })
}

/** Copia EXACTA de `ConnectionStore.reorder` (muta `filas`, como el original). */
function reordenar(filas: Fila[], profileId: string, ids: string[]): void {
  const delPerfil = filas.filter((c) => c.profileId === profileId)
  const validos = ids.filter((id) => delPerfil.some((c) => c.id === id))
  if (validos.length === 0) return
  const restantes = delPerfil.filter((c) => !validos.includes(c.id)).map((c) => c.id)
  const finales = [...validos, ...restantes]
  finales.forEach((id, i) => {
    const c = delPerfil.find((x) => x.id === id)
    if (c) c.orden = i
  })
}

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}
const alias = (fs: Fila[]): string => fs.map((f) => f.alias).join(',')

console.log('\norden de conexiones\n')

// --- Ordenación --------------------------------------------------------------
{
  const filas: Fila[] = [
    { id: '3', profileId: 'alfa', alias: 'C', orden: 2 },
    { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
    { id: '2', profileId: 'alfa', alias: 'B', orden: 1 }
  ]
  comprobar('respeta la posición fijada', alias(ordenar(filas, 'alfa')) === 'A,B,C')
}
{
  // Registros de una versión anterior: sin posición, al final y por alias.
  const filas: Fila[] = [
    { id: '1', profileId: 'alfa', alias: 'Zeta' },
    { id: '2', profileId: 'alfa', alias: 'Alfa' },
    { id: '3', profileId: 'alfa', alias: 'Puesta', orden: 0 }
  ]
  comprobar('las sin posición van al final, por alias', alias(ordenar(filas, 'alfa')) === 'Puesta,Alfa,Zeta')
}

// --- Reordenar ---------------------------------------------------------------
{
  const filas: Fila[] = [
    { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
    { id: '2', profileId: 'alfa', alias: 'B', orden: 1 },
    { id: '3', profileId: 'alfa', alias: 'C', orden: 2 }
  ]
  reordenar(filas, 'alfa', ['3', '1', '2'])
  comprobar('aplica el orden pedido', alias(ordenar(filas, 'alfa')) === 'C,A,B')
  comprobar('no pierde ninguna', ordenar(filas, 'alfa').length === 3)
}
{
  // Vista desfasada: la UI no vio una conexión creada entre medias. NO debe perderse.
  const filas: Fila[] = [
    { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
    { id: '2', profileId: 'alfa', alias: 'B', orden: 1 },
    { id: 'nueva', profileId: 'alfa', alias: 'N', orden: 2 }
  ]
  reordenar(filas, 'alfa', ['2', '1'])
  const r = ordenar(filas, 'alfa')
  comprobar('conserva las que la UI no mencionó', r.length === 3, alias(r))
  comprobar('y las deja detrás', alias(r) === 'B,A,N', alias(r))
}
{
  // Ids de OTRO perfil en el payload: se ignoran y no tocan nada suyo.
  const filas: Fila[] = [
    { id: '1', profileId: 'alfa', alias: 'A', orden: 0 },
    { id: 'x', profileId: 'cliente', alias: 'X', orden: 0 }
  ]
  reordenar(filas, 'alfa', ['x', '1'])
  comprobar('ignora ids de otro perfil', alias(ordenar(filas, 'alfa')) === 'A')
  comprobar('no descoloca el otro perfil', ordenar(filas, 'cliente')[0].orden === 0)
}
{
  const filas: Fila[] = [{ id: '1', profileId: 'alfa', alias: 'A', orden: 0 }]
  reordenar(filas, 'alfa', [])
  comprobar('lista vacía no hace nada', filas[0].orden === 0)
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
