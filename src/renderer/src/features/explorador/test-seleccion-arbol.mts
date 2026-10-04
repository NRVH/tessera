#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de SELECCIÓN MÚLTIPLE del explorador
// (node src/renderer/src/features/explorador/test-seleccion-arbol.mts)
// -----------------------------------------------------------------------------
// Fija qué queda seleccionado tras cada combinación de modificadores, qué sobrevive a
// un refresco y qué rutas se mandan al main al soltar (carpetas compactadas y la
// frontera '!/' de los .jar incluidas).
// =============================================================================

import {
  SELECCION_VACIA,
  aplazarAlSoltar,
  efectoDeDragOver,
  lineasFantasma,
  medidasFantasma,
  minimizarPorPrefijo,
  olvidarDeSeleccion,
  origenesAMover,
  podarSeleccion,
  puedeSoltar,
  puedeSoltarN,
  rangoEntre,
  resolverClic,
  resolverClicDerecho,
  rutasLegibles,
  rutasMovibles,
  seleccionarTodo,
  type EstadoSeleccion,
  type FilaNodo
} from './seleccionArbol.ts'

let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

/** Claves de un estado, ordenadas, para comparar sin depender del orden del Set. */
const cl = (e: EstadoSeleccion): string => [...e.claves].sort().join(',')
const est = (claves: string[], ancla: string | null, lider: string | null): EstadoSeleccion => ({
  claves: new Set(claves),
  ancla,
  lider
})
const NADA = { mod: false, shift: false }
const MOD = { mod: true, shift: false }
const SHIFT = { mod: false, shift: true }
const MOD_SHIFT = { mod: true, shift: true }

/** Fila de nodo mínima, con `entry` y `leaf` distintos si se pasa `entry`. */
function fila(leafPath: string, opts: Partial<FilaNodo> & { entryPath?: string } = {}): FilaNodo {
  const entryPath = opts.entryPath ?? leafPath
  const nombre = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  return {
    kind: 'node',
    key: leafPath,
    entry: { path: entryPath, name: nombre(entryPath), kind: opts.isDir === false ? 'file' : 'dir' },
    segments: [],
    leaf: { path: leafPath, name: nombre(leafPath), kind: opts.isDir === false ? 'file' : 'dir' },
    depth: 0,
    isDir: opts.isDir ?? true,
    esContenedor: opts.esContenedor ?? false,
    esVirtual: opts.esVirtual ?? false,
    isExpanded: false
  }
}
function indice(filas: FilaNodo[]): ReadonlyMap<string, FilaNodo> {
  return new Map(filas.map((f) => [f.key, f]))
}

// Árbol de ejemplo, en orden de pintado:
//   src · src/main · src/main/App.tsx · docs · docs/guia.md · lib/x.jar
const CLAVES = ['src', 'src/main', 'src/main/App.tsx', 'docs', 'docs/guia.md', 'lib/x.jar']

// -----------------------------------------------------------------------------
hr('1. Clic sin modificadores: reemplaza y mueve ancla y líder')

{
  const r = resolverClic(est(['docs', 'src'], 'docs', 'docs'), CLAVES, 'src/main', NADA)
  check('1a', cl(r) === 'src/main', 'un clic deja SOLO la fila clicada')
  check('1b', r.ancla === 'src/main' && r.lider === 'src/main', 'ancla y líder van a la fila clicada')
}

// -----------------------------------------------------------------------------
hr('2. Ctrl/Cmd+clic: alterna, y mueve ancla y líder')

{
  const a = resolverClic(est(['src'], 'src', 'src'), CLAVES, 'docs', MOD)
  check('2a', cl(a) === 'docs,src', 'añade sin perder lo anterior')
  check('2b', a.ancla === 'docs', 'el ancla se muda a lo último tocado')
  const b = resolverClic(a, CLAVES, 'src', MOD)
  check('2c', cl(b) === 'docs', 'un segundo Ctrl+clic sobre la misma fila la QUITA')
  const c = resolverClic(est(['src'], 'src', 'src'), CLAVES, 'src', MOD)
  check('2d', c.claves.size === 0, 'Ctrl+clic sobre la única seleccionada deja la selección vacía')
}

// -----------------------------------------------------------------------------
hr('3. Shift+clic: rango que REEMPLAZA, con el ancla quieta')

{
  const base = est(['src'], 'src', 'src')
  const abajo = resolverClic(base, CLAVES, 'docs', SHIFT)
  check('3a', cl(abajo) === 'docs,src,src/main,src/main/App.tsx', 'rango hacia abajo, ambos extremos incluidos')
  check('3b', abajo.ancla === 'src', 'el ancla NO se mueve con Shift (permite ampliar y reducir)')
  check('3c', abajo.lider === 'docs', 'el líder sí va a la fila clicada')
  const reducido = resolverClic(abajo, CLAVES, 'src/main', SHIFT)
  check('3d', cl(reducido) === 'src,src/main', 'un segundo Shift+clic REEMPLAZA el rango, no lo acumula')
  const arriba = resolverClic(est(['docs/guia.md'], 'docs/guia.md', 'docs/guia.md'), CLAVES, 'src/main', SHIFT)
  check('3e', cl(arriba) === 'docs,docs/guia.md,src/main,src/main/App.tsx', 'el rango funciona hacia arriba')
}

// -----------------------------------------------------------------------------
hr('4. Ctrl+Shift+clic: AÑADE el rango (dos rangos disjuntos)')

{
  const primero = resolverClic(est(['src'], 'src', 'src'), CLAVES, 'src/main', SHIFT)
  // Ctrl+clic para llevar el ancla al segundo bloque sin perder el primero.
  const salto = resolverClic(primero, CLAVES, 'docs', MOD)
  const segundo = resolverClic(salto, CLAVES, 'docs/guia.md', MOD_SHIFT)
  check('4a', cl(segundo) === 'docs,docs/guia.md,src,src/main', 'los dos rangos conviven')
  check('4b', segundo.ancla === 'docs', 'Ctrl+Shift tampoco mueve el ancla')
}

// -----------------------------------------------------------------------------
hr('5. Shift degrada a clic normal cuando el ancla no sirve')

{
  const sinAncla = resolverClic(SELECCION_VACIA, CLAVES, 'docs', SHIFT)
  check('5a', cl(sinAncla) === 'docs' && sinAncla.ancla === 'docs', 'sin ancla, Shift+clic es un clic normal')
  const anclaMuerta = resolverClic(est(['x'], 'borrado.txt', 'x'), CLAVES, 'docs', SHIFT)
  check('5b', cl(anclaMuerta) === 'docs', 'con un ancla que ya no existe, tampoco cuelga: clic normal')
  check('5c', rangoEntre(CLAVES, 'src', 'no-existe') === null, 'rangoEntre devuelve null si un extremo falta')
  check('5d', (rangoEntre(CLAVES, 'src', 'src') ?? []).join(',') === 'src', 'rango de un solo elemento')
}

// -----------------------------------------------------------------------------
hr('6. El clic APLAZADO (lo que hace posible arrastrar un grupo)')

{
  const tres = est(['src', 'docs', 'lib/x.jar'], 'src', 'src')
  check('6a', aplazarAlSoltar(tres, 'docs', NADA), 'clic sin modificadores sobre una fila YA seleccionada: se aplaza')
  check('6b', !aplazarAlSoltar(tres, 'src/main', NADA), 'sobre una fila de fuera NO se aplaza: colapsa ya')
  check('6c', !aplazarAlSoltar(tres, 'docs', MOD), 'con Ctrl nunca se aplaza')
  check('6d', !aplazarAlSoltar(est(['src'], 'src', 'src'), 'src', NADA), 'con una sola seleccionada no hay grupo que arrastrar')
}

// -----------------------------------------------------------------------------
hr('7. Clic DERECHO: respeta la selección si la fila está dentro')

{
  const tres = est(['src', 'docs'], 'src', 'src')
  const dentro = resolverClicDerecho(tres, 'docs')
  check('7a', cl(dentro) === 'docs,src', 'fila marcada: la selección no se toca')
  check('7b', dentro.lider === 'docs', 'pero el líder sí se mueve a la fila clicada')
  const fuera = resolverClicDerecho(tres, 'lib/x.jar')
  check('7c', cl(fuera) === 'lib/x.jar', 'fila sin marcar: la selección pasa a ser sólo ella')
}

// -----------------------------------------------------------------------------
hr('8. Colapsar: la poda es la que deselecciona (ver la cabecera del módulo)')

{
  // Aquí vivía `colapsarSeleccion`, que SUBÍA la selección a la carpeta cerrada.
  // Se retiró porque dejaba armado un `Supr` sobre la carpeta entera. Lo que queda
  // es la poda, y esto fija que hace el trabajo: al colapsar, las filas de dentro
  // salen del aplanado y con ellas su marca.
  const e = est(['src/main', 'src/main/App.tsx', 'docs'], 'src/main', 'src/main/App.tsx')
  const trasColapsar = podarSeleccion(e, new Set(['src', 'docs', 'lib/x.jar']))
  check('8a', cl(trasColapsar) === 'docs', 'lo que deja de verse deja de estar seleccionado')
  check('8b', trasColapsar.ancla === null && trasColapsar.lider === null, 'y el ancla y el líder que vivían dentro se van con ellas')
  check(
    '8c',
    !trasColapsar.claves.has('src'),
    'la carpeta colapsada NO se selecciona sola: cerrar una carpeta es navegar, no marcar'
  )
}

hr('9. Poda al refrescar: intersecta, nunca vacía por si acaso')

{
  const e = est(['src', 'docs', 'borrado.txt'], 'docs', 'borrado.txt')
  const r = podarSeleccion(e, new Set(['src', 'docs']))
  check('9a', cl(r) === 'docs,src', 'lo que ya no existe cae; lo demás sobrevive')
  check('9b', r.lider === null, 'un líder muerto se pone a null')
  check('9c', r.ancla === 'docs', 'un ancla viva se conserva')
  const igual = podarSeleccion(r, new Set(['src', 'docs']))
  check('9d', igual === r, 'si no cayó nada devuelve el MISMO objeto (evita el bucle de render)')
}

// -----------------------------------------------------------------------------
hr('10. Olvidar lo movido/borrado (por prefijo)')

{
  const e = est(['src/main', 'src/main/App.tsx', 'docs'], 'src/main', 'docs')
  const r = olvidarDeSeleccion(e, ['src'])
  check('10a', cl(r) === 'docs', 'cae la carpeta y todo lo que colgaba de ella')
  check('10b', r.ancla === null && r.lider === 'docs', 'el ancla afectada muere; el líder ileso se queda')
  check('10c', olvidarDeSeleccion(e, ['otro']) === e, 'sin nada afectado, mismo objeto')
}

// -----------------------------------------------------------------------------
hr('11. Minimizar por prefijo: lo que de verdad se manda al main')

{
  const a = minimizarPorPrefijo(['src', 'src/main', 'src/main/App.tsx', 'otro.ts'])
  check('11a', a.join(',') === 'otro.ts,src', 'si va la carpeta, sus descendientes sobran')
  const b = minimizarPorPrefijo(['lib/x.jar!/com/A.class', 'lib/x.jar'])
  check('11b', b.join(',') === 'lib/x.jar', "la frontera '!/' se reduce igual que '/'")
  const c = minimizarPorPrefijo(['src', 'srcx', 'src2.ts'])
  check('11c', c.join(',') === 'src,src2.ts,srcx', 'un prefijo de TEXTO no es un prefijo de RUTA: srcx no cuelga de src')
  // El caso que rompe el atajo de "comparar sólo con el último superviviente":
  // '!' (0x21) ordena antes que '/' (0x2F), así que `src!notas` se cuela en medio.
  const d = minimizarPorPrefijo(['src', 'src!notas', 'src/main'])
  check('11d', d.join(',') === 'src,src!notas', 'un hermano con "!" en el nombre no rompe la reducción')
  check('11e', minimizarPorPrefijo(['a', 'a']).join(',') === 'a', 'duplicados fuera')
  check('11f', minimizarPorPrefijo([]).length === 0, 'lista vacía')
  // Sube por TODOS los ancestros, no sólo por el padre: con el abuelo marcado y el
  // padre sin marcar, el nieto tiene que caer igual.
  const g = minimizarPorPrefijo(['a', 'a/b/c/d.ts', 'z.ts'])
  check('11g', g.join(',') === 'a,z.ts', 'un ancestro LEJANO también reduce (no basta con mirar al padre)')
  // Y la frontera '!/' se cruza a media subida: `lib/x.jar!/com/A.class` sube a
  // `lib/x.jar!/com`, luego a `lib/x.jar` — que es el que está marcado.
  const h = minimizarPorPrefijo(['lib/x.jar', 'lib/x.jar!/com/ejemplo/A.class'])
  check('11h', h.join(',') === 'lib/x.jar', "la subida cruza la frontera '!/' hasta el contenedor")
  // Rendimiento: 3 000 hermanos planos. Con la versión cuadrática esto eran ~4,5M
  // comparaciones; aquí es una subida de ancestros por ruta. Se afirma el resultado
  // y que no tarde una eternidad, que es la queja que motivó el cambio.
  const muchos = Array.from({ length: 3000 }, (_, i) => `plana/f${String(i).padStart(4, '0')}.ts`)
  const t0 = process.hrtime.bigint()
  const r = minimizarPorPrefijo(muchos)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  check('11i', r.length === 3000 && ms < 500, `3 000 hermanos sin ancestro común: los 3 000 sobreviven, en ${ms.toFixed(0)} ms`)
}

// -----------------------------------------------------------------------------
hr('12. De claves de FILA a rutas MOVIBLES (el caso de la carpeta compactada)')

{
  const filas = [
    // Cadena compactada "com/ejemplo/app": la clave es la hoja, lo movible es `com`.
    fila('com/ejemplo/app', { entryPath: 'com' }),
    fila('docs/guia.md', { isDir: false }),
    fila('lib/x.jar!/com/A.class', { isDir: false, esVirtual: true })
  ]
  const idx = indice(filas)
  const a = rutasMovibles(['com/ejemplo/app'], idx)
  check('12a', a.join(',') === 'com', 'de una cadena compactada se mueve el PRIMER segmento, no la hoja')
  const b = rutasMovibles(['com/ejemplo/app', 'docs/guia.md'], idx)
  check('12b', b.join(',') === 'com,docs/guia.md', 'lo demás pasa tal cual')
  const c = rutasMovibles(['lib/x.jar!/com/A.class', 'docs/guia.md'], idx)
  check('12c', c.join(',') === 'docs/guia.md', 'lo que vive dentro de un .jar no se mueve: se descarta')
  const d = rutasMovibles(['no-existe'], idx)
  check('12d', d.length === 0, 'una clave sin fila (murió en un refresco) simplemente no aporta ruta')
  // LA OTRA CARA, la que decide qué se BORRA y qué se CORTA: la HOJA. Vivía copiada
  // en Sidebar.tsx, donde ningún test podía tocarla.
  const e = rutasMovibles(['com/ejemplo/app'], idx, 'hoja')
  check('12e', e.join(',') === 'com/ejemplo/app', 'con cara "hoja" se opera sobre la carpeta VISIBLE, no sobre el primer segmento')
  const f = rutasMovibles(['lib/x.jar!/com/A.class', 'docs/guia.md'], idx, 'hoja')
  check('12f', f.join(',') === 'docs/guia.md', 'y también descarta lo que vive dentro de un .jar')

  // LA TERCERA LISTA, la de las acciones que sólo LEEN: «Copiar ruta» NO escribe, y
  // la ruta de una clase dentro de un .jar SÍ existe como localizador. Con el filtro
  // de las otras dos, una selección MIXTA dejaba fuera la virtual, el objetivo se
  // quedaba en un elemento y el menú copiaba la ruta del archivo EQUIVOCADO.
  const g = rutasLegibles(['lib/x.jar!/com/A.class', 'docs/guia.md'], idx)
  check('12g', g.join(',') === 'docs/guia.md,lib/x.jar!/com/A.class', `las virtuales SÍ se copian: ${JSON.stringify(g)}`)
  const h = rutasLegibles(['lib/x.jar!/com/A.class'], idx)
  check('12h', h.join(',') === 'lib/x.jar!/com/A.class', 'y una virtual sola no se queda en nada')
  check('12i', rutasLegibles(['no-existe'], idx).length === 0, 'una clave sin fila sigue sin aportar ruta')
}

// -----------------------------------------------------------------------------
hr('13. ¿Se puede soltar? Singular')

{
  check('13a', puedeSoltar('src/App.tsx', 'docs'), 'archivo a otra carpeta: sí')
  check('13b', !puedeSoltar('src/App.tsx', 'src'), 'a su propia carpeta: no (no-op)')
  check('13c', !puedeSoltar('src', 'src'), 'sobre sí misma: no')
  check('13d', !puedeSoltar('src', 'src/main'), 'dentro de un descendiente: no (ciclo)')
  check('13e', !puedeSoltar('lib/x.jar!/A.class', 'docs'), 'origen dentro de un .jar: no')
  check('13f', !puedeSoltar('docs/guia.md', 'lib/x.jar!'), 'destino degenerado "x.jar!": no')
  check('13g', !puedeSoltar('', 'docs'), 'sin origen: no')
  check('13h', puedeSoltar('src/App.tsx', ''), 'a la raíz: sí')
  check('13i', !puedeSoltar('App.tsx', ''), 'de la raíz a la raíz: no (no-op)')
}

// -----------------------------------------------------------------------------
hr('14. ¿Se puede soltar? Plural: el no-op se descarta, el ciclo tumba el gesto')

{
  check('14a', puedeSoltarN(['src/a.ts', 'src/b.ts'], 'docs'), 'dos archivos a otra carpeta')
  check(
    '14b',
    puedeSoltarN(['docs/ya.md', 'src/b.ts'], 'docs'),
    'uno ya vive en el destino: se descarta él, el gesto sigue valiendo'
  )
  check('14c', !puedeSoltarN(['docs/a.md', 'docs/b.md'], 'docs'), 'si TODOS son no-op, no se enciende nada')
  check('14d', !puedeSoltarN(['src', 'docs/a.md'], 'src/main'), 'un solo ciclo tumba el gesto entero')
  check('14e', !puedeSoltarN(['lib/x.jar!/A.class', 'docs/a.md'], 'src'), 'una sola ruta virtual lo tumba')
  check('14f', !puedeSoltarN([], 'docs'), 'sin orígenes: no')
  check('14g', origenesAMover(['docs/ya.md', 'src/b.ts'], 'docs').join(',') === 'src/b.ts', 'origenesAMover filtra los no-op')
}

// -----------------------------------------------------------------------------
hr('15. Seleccionar todo, y las líneas del fantasma')

{
  const t = seleccionarTodo(CLAVES)
  check('15a', t.claves.size === CLAVES.length, 'Ctrl+A alcanza a todas las filas visibles')
  check('15b', t.ancla === 'src' && t.lider === 'lib/x.jar', 'ancla en la primera, líder en la última')
  check('15c', seleccionarTodo([]) === SELECCION_VACIA, 'sin filas, selección vacía')

  const items = Array.from({ length: 10 }, (_, i) => ({ nombre: `f${i}.ts`, isDir: false }))
  const corto = lineasFantasma(items.slice(0, 3))
  check('15d', corto.lineas.length === 3 && corto.resto === 0, 'por debajo del tope se listan todos')
  const largo = lineasFantasma(items)
  check('15e', largo.lineas.length === 7 && largo.resto === 3, 'por encima del tope se corta y se cuenta el resto')
  check('15f', lineasFantasma(items, 2).resto === 8, 'el tope es configurable')

  // Las MEDIDAS del fantasma: las usa el canvas del arrastre NATIVO (varios archivos
  // hacia el sistema), que necesita una imagen y no un nodo del DOM. Salen de aquí
  // para que las dos direcciones del arrastre midan con la misma regla.
  const m = medidasFantasma(3, 0, 20)
  check('15g', m.alto === 66 && m.altoResto === 0, `3 filas de 20 sin resto: ${JSON.stringify(m)}`)
  const m2 = medidasFantasma(7, 4, 20)
  check('15h', m2.altoResto > 0 && m2.alto > m.alto, `con resto reserva su franja: ${JSON.stringify(m2)}`)
  const m3 = medidasFantasma(3, 0, 31)
  check('15i', m3.alto > m.alto, 'y con la densidad grande el fantasma crece igual que las filas')
}

// -----------------------------------------------------------------------------
hr('16. Efecto del cursor al sobrevolar una fila')

{
  const base = { esVirtual: false, arrastrados: [] as string[], destino: 'docs', externo: false }
  check('16a', efectoDeDragOver({ ...base, arrastrados: ['src/a.ts'] }) === 'move', 'arrastre propio válido: mover')
  check('16b', efectoDeDragOver({ ...base, externo: true }) === 'copy', 'archivos del sistema: copiar')
  check(
    '16c',
    efectoDeDragOver({ ...base, arrastrados: ['src/a.ts'], externo: true }) === 'move',
    'el arrastre propio manda sobre los archivos del sistema (arrastre nativo de varios)'
  )
  check(
    '16d',
    efectoDeDragOver({ ...base, arrastrados: ['docs/a.md'], externo: true }) === null,
    'propio y no-op: se rechaza, no cae en la rama de archivos del sistema'
  )
  check('16e', efectoDeDragOver({ ...base, arrastrados: ['src/a.ts'], esVirtual: true }) === null, 'dentro de un contenedor no se acepta')
  check('16f', efectoDeDragOver({ ...base, externo: true, esVirtual: true }) === null, 'ni siquiera desde el sistema')
  check('16g', efectoDeDragOver(base) === null, 'un arrastre ajeno sin archivos no se acepta')
}

// -----------------------------------------------------------------------------
const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : `${failed} FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
