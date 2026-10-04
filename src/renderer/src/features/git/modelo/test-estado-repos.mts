#!/usr/bin/env node
// =============================================================================
// Prueba del ESTADO DE REPOS (npm run test:estado-repos). Fija que por debajo del
// umbral se piden todos y por encima solo lo visible sin repetir lo pedido, que la
// GENERACIÓN descarta lo que llega tarde, que un goteo idéntico devuelve el MISMO
// objeto, que el orden lo manda el escaneo y que una ráfaga del watcher solo invalida
// el repo tocado.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

import {
  ESTADO_REPOS_VACIO,
  MARGEN_VECINOS,
  UMBRAL_PEREZOSO,
  aplicarParcial,
  aplicarTanda,
  listaOrdenada,
  marcarPedidos,
  mismaListaEstados,
  desmarcarPedidos,
  estadoAlDia,
  invalidarRepos,
  nuevaGeneracion,
  reposAPedir,
  reposTocados
} from './estadoRepos.ts'
import type { RepoStatus } from '../../../../../shared/git-ipc.ts'

// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const st = (repo: string, branch = 'main', n = 0): RepoStatus => ({
  repo,
  branch,
  changes: Array.from({ length: n }, (_, i) => ({
    path: `${repo}/f${i}.txt`,
    indexStatus: '.' as const,
    worktreeStatus: 'M' as const
  }))
})

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) POR DEBAJO DEL UMBRAL no cambia nada: se piden todos')
  {
    const todos = Array.from({ length: 14 }, (_, i) => `r${i}`) // la contenedora real
    const pedir = reposAPedir(todos, ['r3'], new Set())
    check(
      'con 14 repos se piden los 14 (el flujo normal no se toca)',
      pedir.length === 14,
      `${pedir.length} de ${todos.length}`
    )
    const justo = Array.from({ length: UMBRAL_PEREZOSO }, (_, i) => `r${i}`)
    check(
      `justo en el umbral (${UMBRAL_PEREZOSO}) todavía se piden todos`,
      reposAPedir(justo, [], new Set()).length === UMBRAL_PEREZOSO,
      'todos'
    )
  }

  // -------------------------------------------------------------------------
  hr('2) POR ENCIMA solo lo visible, y el scroll no repite lo ya pedido')
  {
    const todos = Array.from({ length: 1000 }, (_, i) => `r${i}`)
    const visibles = todos.slice(0, 20)
    const primera = reposAPedir(todos, visibles, new Set())
    check(
      'con 1000 repos NO se piden 1000: solo los visibles',
      primera.length === 20,
      `${primera.length} de 1000`
    )
    let estado = marcarPedidos(ESTADO_REPOS_VACIO, primera)
    // El usuario baja: la ventana se solapa con la anterior.
    const segunda = reposAPedir(todos, todos.slice(10, 30), estado.pedidos)
    check(
      'al hacer scroll solo se piden los NUEVOS (los 10 solapados no se repiten)',
      segunda.length === 10 && segunda[0] === 'r20',
      `${segunda.length} nuevos, empieza en ${segunda[0]}`
    )
    estado = marcarPedidos(estado, segunda)
    check(
      'volver a la misma ventana no pide NADA',
      reposAPedir(todos, todos.slice(0, 30), estado.pedidos).length === 0,
      'cero'
    )
    check(
      'un visible que ya no está en la lista de repos se ignora (lista vieja)',
      reposAPedir(todos, ['r5', 'borrado-hace-un-rato'], new Set()).every((r) => r !== 'borrado-hace-un-rato'),
      'filtrado contra el universo'
    )
    check('el margen de vecinos está declarado', MARGEN_VECINOS > 0, `${MARGEN_VECINOS}`)
  }

  // -------------------------------------------------------------------------
  hr('3) LA GENERACIÓN descarta lo que llega tarde (el bug entre perfiles)')
  {
    let estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'proyectoA') // gen 1
    estado = aplicarParcial(estado, 1, st('repoA'))
    check('un parcial de la generación vigente se acumula', estado.mapa.has('repoA'), 'acumulado')
    const genA = estado.gen
    estado = nuevaGeneracion(estado, 'proyectoB') // gen 2: cambió de proyecto
    check(
      'cambiar de proyecto vacía lo sabido (no se enseña el estado del anterior)',
      estado.mapa.size === 0 && estado.gen === genA + 1,
      `mapa vacío, gen ${estado.gen}`
    )
    const trasTardio = aplicarParcial(estado, genA, st('repoA'))
    check(
      'un parcial del proyecto ANTERIOR que llega tarde se TIRA',
      trasTardio === estado && !trasTardio.mapa.has('repoA'),
      'ignorado, mismo objeto'
    )
    const trasTanda = aplicarTanda(estado, genA, [st('repoA'), st('repoB')])
    check(
      'una tanda entera del anterior también se tira',
      trasTanda === estado && trasTanda.mapa.size === 0,
      'ignorada'
    )
  }

  // -------------------------------------------------------------------------
  hr('4) UN GOTEO QUE NO CAMBIA NADA devuelve el mismo objeto (sin re-render)')
  {
    let estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'k')
    estado = aplicarParcial(estado, estado.gen, st('r1', 'main', 2))
    const antes = estado
    // El mismo contenido, pero objetos NUEVOS: es lo que llega por IPC cada vez.
    estado = aplicarParcial(estado, estado.gen, st('r1', 'main', 2))
    check(
      'mismo contenido -> MISMO objeto de estado (no dispara render)',
      estado === antes,
      'identidad conservada'
    )
    const conCambio = aplicarParcial(estado, estado.gen, st('r1', 'main', 3))
    check('un cambio real SÍ produce estado nuevo', conCambio !== estado, 'objeto nuevo')
    const otraRama = aplicarParcial(estado, estado.gen, st('r1', 'feature/x', 2))
    check('cambiar de rama cuenta como cambio', otraRama !== estado, 'objeto nuevo')
    const tandaIgual = aplicarTanda(estado, estado.gen, [st('r1', 'main', 2)])
    check('una tanda sin novedades tampoco re-renderiza', tandaIgual === estado, 'identidad conservada')
  }

  // -------------------------------------------------------------------------
  hr('5) EL ORDEN lo manda el escaneo, no el orden de llegada')
  {
    const todos = ['a', 'b', 'c', 'd']
    let estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'k')
    // Contestan al revés, que es lo normal: cada repo tarda lo suyo.
    for (const r of ['d', 'b', 'a']) estado = aplicarParcial(estado, estado.gen, st(r))
    const lista = listaOrdenada(estado, todos)
    check(
      'las filas salen en el orden del escaneo aunque contesten desordenadas',
      lista.map((s) => s.repo).join(',') === 'a,b,d',
      lista.map((s) => s.repo).join(',')
    )
    check(
      'un repo del que aún no se sabe nada simplemente no sale (no hay hueco)',
      lista.length === 3 && !lista.some((s) => s.repo === 'c'),
      '3 de 4, sin "c"'
    )
  }

  // -------------------------------------------------------------------------
  hr('6) UNA RÁFAGA DEL WATCHER solo invalida los repos donde pasó algo')
  {
    const repos = [
      { repoHostPath: '/c/proyecto-b', name: 'proyecto-b', isRoot: true },
      { repoHostPath: '/c/proyecto-b/admdemo', name: 'admdemo', isRoot: false },
      { repoHostPath: '/c/proyecto-b/servicios', name: 'servicios', isRoot: false }
    ]
    // Lo que pasa de verdad: un `mvn package` reescribe medio `target/` de UN repo.
    const target = Array.from({ length: 300 }, (_, i) => `admdemo/target/classes/C${i}.class`)
    const tocados = reposTocados(target, false, repos)
    check(
      'un mvn package en un repo NO invalida los otros trece',
      tocados !== null && tocados.size === 1 && tocados.has('/c/proyecto-b/admdemo'),
      `${tocados?.size} repo(s)`
    )
    const dos = reposTocados(['admdemo/a.java', 'servicios/b.java'], false, repos)
    check(
      'tocar dos repos invalida exactamente esos dos',
      dos !== null && dos.size === 2,
      `${dos?.size} repos`
    )
    const raiz = reposTocados(['README.md'], false, repos)
    check(
      'un archivo suelto en la raíz cae en el repo de la propia contenedora',
      raiz !== null && raiz.size === 1 && raiz.has('/c/proyecto-b'),
      [...(raiz ?? [])].join(',')
    )
    check(
      'una carpeta que NO es repo cae también en la contenedora (no se pierde)',
      reposTocados(['docs/notas.md'], false, repos)?.has('/c/proyecto-b') === true,
      'a la contenedora'
    )
    check(
      'una ráfaga PARCIAL (lista truncada) devuelve null = revísalo todo',
      reposTocados(['admdemo/a.java'], true, repos) === null,
      'null'
    )
    // Y la invalidación en sí.
    let estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'k')
    estado = marcarPedidos(estado, ['/c/proyecto-b/admdemo', '/c/proyecto-b/servicios'])
    estado = aplicarParcial(estado, estado.gen, st('/c/proyecto-b/admdemo'))
    estado = aplicarParcial(estado, estado.gen, st('/c/proyecto-b/servicios'))
    const genAntes = estado.gen
    const tras = invalidarRepos(estado, new Set(['/c/proyecto-b/admdemo']))
    check(
      'invalidar uno lo saca de "ya pedidos" y deja al otro en paz',
      !tras.pedidos.has('/c/proyecto-b/admdemo') && tras.pedidos.has('/c/proyecto-b/servicios'),
      `${tras.pedidos.size} siguen pedidos`
    )
    check(
      'no sube la generación (no es un cambio de proyecto)',
      tras.gen === genAntes,
      `gen ${tras.gen}`
    )
    check(
      'lo ya sabido se CONSERVA mientras llega la respuesta (sin parpadeo)',
      tras.mapa.has('/c/proyecto-b/admdemo'),
      'se sigue viendo'
    )
    check(
      'invalidar un conjunto vacío no cambia nada',
      invalidarRepos(estado, new Set()) === estado,
      'mismo objeto'
    )
  }

  // -------------------------------------------------------------------------
  hr('7) LA CLAVE evita el abanico DUPLICADO al cambiar de proyecto')
  {
    // El fallo: el efecto que resetea la generación y el que pide corren en el MISMO
    // commit de React, así que el segundo veía el estado de antes del reset, lanzaba
    // la petición entera con una generación caducada y la repetía tras el re-render.
    const estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'proyectoA')
    check(
      'el estado sabe DE QUÉ es',
      estadoAlDia(estado, 'proyectoA') && !estadoAlDia(estado, 'proyectoB'),
      'al día con A, no con B'
    )
    check(
      'pedir la generación de la clave que YA corre no tira lo cargado',
      nuevaGeneracion(estado, 'proyectoA') === estado,
      'mismo objeto'
    )
    const otra = nuevaGeneracion(estado, 'proyectoB')
    check(
      'una clave distinta sí abre generación nueva y vacía',
      otra.gen === estado.gen + 1 && otra.mapa.size === 0 && otra.clave === 'proyectoB',
      `gen ${otra.gen}`
    )
  }

  // -------------------------------------------------------------------------
  hr('8) UNA PETICIÓN QUE FALLA se puede reintentar')
  {
    // Los repos se apuntan como pedidos ANTES de llamar; si el IPC falla y no se
    // desapuntan, quedan en blanco para siempre dentro de esa generación.
    let estado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'k')
    estado = marcarPedidos(estado, ['a', 'b', 'c'])
    const tras = desmarcarPedidos(estado, ['a', 'b'])
    check(
      'desmarcar deja los fallidos pedibles otra vez y no toca al resto',
      !tras.pedidos.has('a') && !tras.pedidos.has('b') && tras.pedidos.has('c'),
      `quedan ${tras.pedidos.size}`
    )
    check(
      'tras el fallo, volver a preguntar los devuelve como pendientes',
      reposAPedir(['a', 'b', 'c'], ['a', 'b', 'c'], tras.pedidos).join(',') === 'a,b',
      'a,b'
    )
    check(
      'desmarcar algo que no estaba pedido no cambia nada',
      desmarcarPedidos(tras, ['z']) === tras,
      'mismo objeto'
    )
  }

  // -------------------------------------------------------------------------
  // LA SIEMBRA de `nuevaGeneracion`: volver a un objetivo ya visitado enseña lo
  // último que se supo mientras se vuelve a preguntar, en vez de un esqueleto.
  // Antes, cambiar de perfil pintaba: datos del viejo -> esqueleto -> datos del
  // nuevo, y ese esqueleto era medio parpadeo.
  // -------------------------------------------------------------------------
  hr('SIEMBRA de la generación nueva')
  {
    // (s1) SIN semilla se comporta EXACTAMENTE como antes. Es el test de
    // no-regresión de la firma: el parámetro es opcional y no cambia nada.
    const sinSemilla = nuevaGeneracion(ESTADO_REPOS_VACIO, 'obj|A')
    check(
      '(s1) sin semilla, el mapa arranca VACÍO (como siempre)',
      sinSemilla.mapa.size === 0 && sinSemilla.pedidos.size === 0 && sinSemilla.gen === 1,
      `size=${sinSemilla.mapa.size} gen=${sinSemilla.gen}`
    )

    // (s2) CON semilla: se ve lo de antes, pero `pedidos` sigue vacío, así que se
    // vuelve a preguntar TODO. Esto es lo que separa "no parpadea" de "no refresca".
    const semilla = new Map([['r1', st('r1', 'main', 2)]])
    const conSemilla = nuevaGeneracion(sinSemilla, 'obj|B', semilla)
    check(
      '(s2) con semilla se ve lo sabido, pero `pedidos` arranca vacío (se re-pide todo)',
      conSemilla.mapa.get('r1')?.changes.length === 2 && conSemilla.pedidos.size === 0,
      `mapa=${conSemilla.mapa.size} pedidos=${conSemilla.pedidos.size}`
    )

    // (s3) La semilla se COPIA. Si se guardara la referencia, `aplicarParcial`
    // —que construye un `Map` nuevo— seguiría funcionando, pero cualquier
    // escritura futura sobre el mapa recordado se filtraría a la generación viva.
    semilla.set('r2', st('r2'))
    check(
      '(s3) la semilla se copia, no se referencia',
      !conSemilla.mapa.has('r2'),
      `mapa=${[...conSemilla.mapa.keys()].join(',')}`
    )

    // (s4) La idempotencia por clave sigue intacta: repetir la clave viva devuelve
    // el MISMO objeto, aunque se pase una semilla. Si no, un re-render de más
    // tiraría lo que se acaba de cargar y lo sustituiría por lo recordado.
    const otraSemilla = new Map([['r9', st('r9')]])
    check(
      '(s4) idempotente por clave AUNQUE se pase semilla (no pisa lo ya cargado)',
      nuevaGeneracion(conSemilla, 'obj|B', otraSemilla) === conSemilla,
      'mismo objeto'
    )

    // (s5) Un repo que ya no existe en el objetivo no se cuela por la semilla: la
    // lista que consume la UI la ordena `listaOrdenada` contra los repos actuales.
    const sembrado = nuevaGeneracion(conSemilla, 'obj|C', new Map([['viejo', st('viejo')]]))
    check(
      '(s5) un repo sembrado que ya no está en el objetivo no se pinta',
      listaOrdenada(sembrado, ['r1']).length === 0,
      `lista=${JSON.stringify(listaOrdenada(sembrado, ['r1']).map((s) => s.repo))}`
    )
  }

  // -------------------------------------------------------------------------
  hr('mismaListaEstados: una tanda que no cambió nada no publica otra lista')
  {
    const a = st('r1')
    const b = st('r2')
    check('(m1) null y null: la misma', mismaListaEstados(null, null), 'true')
    check('(m2) null y lista: distintas, en los dos sentidos', !mismaListaEstados(null, [a]) && !mismaListaEstados([a], null), 'false')
    check('(m3) otra lista con los MISMOS objetos: la misma', mismaListaEstados([a, b], [a, b]), 'true')
    check('(m4) un objeto distinto con igual contenido: distinta', !mismaListaEstados([a], [st('r1')]), 'false')
    check('(m5) otra longitud: distinta', !mismaListaEstados([a], [a, b]), 'false')
    check('(m6) otro orden: distinta', !mismaListaEstados([a, b], [b, a]), 'false')
    // El caso real: `listaOrdenada` sobre un estado al que solo se le marcaron pedidos.
    const cargado = nuevaGeneracion(ESTADO_REPOS_VACIO, 'obj|M', new Map([['r1', a], ['r2', b]]))
    const remarcado = marcarPedidos(cargado, ['r1', 'r2'])
    const antes = listaOrdenada(cargado, ['r1', 'r2'])
    const despues = listaOrdenada(remarcado, ['r1', 'r2'])
    check(
      '(m7) tras `marcarPedidos`, la lista ordenada es OTRO array con la misma lista',
      antes !== despues && despues.length === 2 && mismaListaEstados(antes, despues),
      `n=${despues.length}`
    )
  }

  // -------------------------------------------------------------------------
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
