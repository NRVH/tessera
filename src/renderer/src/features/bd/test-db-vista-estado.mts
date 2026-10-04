#!/usr/bin/env node
// =============================================================================
// Prueba del estado en memoria de la vista de BD (npm run test:db-vista): el mapa
// por perfil con identidad estable en los no-ops, las operaciones de la vista,
// `revelarPane` con su token, y las podas (perfiles exacta, conexión solo en su
// perfil, conexiones por perfil presente, consolas muertas). Nada se persiste.
// Decisiones: docs/decisiones/bd/ui-area-estado-de-la-vista.md
// =============================================================================

import { claveBd } from './arbolBd.ts'
import { idDbPane, paneKeyDb, type DbPane } from './dbTabsModel.ts'
import * as vista from './dbVistaEstado.ts'
import {
  MAPA_VISTA_VACIO,
  VISTA_PERFIL_VACIA,
  abrirEnVista,
  activarEnVista,
  actualizarPerfil,
  alternarExpandido,
  cerrarEnVista,
  fijarSeleccion,
  moverEnVista,
  plegarTodo,
  podarConexion,
  podarConexiones,
  podarConsolas,
  podarPerfiles,
  revelarPane,
  todasLasPestanas,
  vistaDe,
  type DbVistaMapa,
  type DbVistaPerfil
} from './dbVistaEstado.ts'

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
const j = (v: unknown): string => JSON.stringify(v)
const legible = (k: string): string => k.split('\u0000').join('/')

const tabla = (conexionId: string, objeto: string): DbPane => ({
  kind: 'datos',
  conexionId,
  esquema: 'E',
  objeto,
  tipo: 'tabla'
})
const consola = (conexionId: string, consolaId: string): DbPane => ({ kind: 'consola', conexionId, consolaId })

/** Perfil p1 con pestañas y árbol en c1 y c2; perfil p2 con una pestaña en c1. */
function mapaDePrueba(): DbVistaMapa {
  let m: DbVistaMapa = MAPA_VISTA_VACIO
  m = actualizarPerfil(m, 'p1', (v) => {
    let x = abrirEnVista(v, tabla('c1', 'A'))
    x = abrirEnVista(x, consola('c1', 'k1'))
    x = abrirEnVista(x, tabla('c2', 'B'))
    x = abrirEnVista(x, consola('c2', 'k2'))
    x = alternarExpandido(x, claveBd.conexion('c1'))
    x = alternarExpandido(x, claveBd.esquema('c1', 'E'))
    x = alternarExpandido(x, claveBd.conexion('c2'))
    x = fijarSeleccion(x, claveBd.objeto('c1', 'E', 'tabla', 'A'))
    return x
  })
  m = actualizarPerfil(m, 'p2', (v) => abrirEnVista(v, tabla('c1', 'Z')))
  return m
}

function main(): void {
  hr('(1) Mapa por perfil')
  check('vistaDe de un perfil desconocido: la vacía', vistaDe(MAPA_VISTA_VACIO, 'nadie') === VISTA_PERFIL_VACIA, 'constante')
  const m = mapaDePrueba()
  check('actualizarPerfil crea la entrada', m.size === 2 && vistaDe(m, 'p1').pestanas.tabs.length === 4, `${m.size} perfiles`)
  check('actualizarPerfil sin cambios: MISMO mapa', actualizarPerfil(m, 'p1', (v) => v) === m, 'identidad')
  const sinP2 = actualizarPerfil(m, 'p2', (v) => cerrarEnVista(v, v.pestanas.tabs.map((t) => t.id)))
  check('una vista que queda vacía se borra del mapa', !sinP2.has('p2') && sinP2.has('p1'), [...sinP2.keys()].join(','))
  check(
    'dejar vacío un perfil que no existía: MISMO mapa',
    actualizarPerfil(m, 'p9', (v) => plegarTodo(v)) === m,
    'identidad'
  )
  const todas = todasLasPestanas(m)
  check(
    'todasLasPestanas: las de todos los perfiles, con su paneKey',
    todas.length === 5 &&
      todas[4].perfilId === 'p2' &&
      todas[4].paneKey === paneKeyDb('p2', idDbPane(tabla('c1', 'Z'))),
    todas.map((t) => `${t.perfilId}:${legible(t.paneKey).length}`).join(',')
  )

  hr('(2) Operaciones de la vista')
  const v0 = VISTA_PERFIL_VACIA
  const v1 = abrirEnVista(v0, tabla('c1', 'A'))
  check('abrir crea pestaña activa', v1.pestanas.activeId === idDbPane(tabla('c1', 'A')), `${v1.pestanas.tabs.length}`)
  check('abrir lo ya activo: MISMA vista', abrirEnVista(v1, tabla('c1', 'A')) === v1, 'identidad')
  check('activar lo activo: MISMA vista', activarEnVista(v1, idDbPane(tabla('c1', 'A'))) === v1, 'identidad')
  check('cerrar nada: MISMA vista', cerrarEnVista(v1, []) === v1 && cerrarEnVista(v1, ['x']) === v1, 'identidad')
  const v2 = abrirEnVista(v1, tabla('c1', 'B'))
  const movida = moverEnVista(v2, idDbPane(tabla('c1', 'B')), idDbPane(tabla('c1', 'A')))
  check(
    'mover (arrastre de la tira): B antes de A, sin cambiar la activa',
    movida.pestanas.tabs.map((t) => t.pane.kind === 'datos' ? t.pane.objeto : '').join(',') === 'B,A' &&
      movida.pestanas.activeId === v2.pestanas.activeId,
    movida.pestanas.tabs.map((t) => t.id).join(' | ')
  )
  check('mover a su propio sitio: MISMA vista', moverEnVista(v2, idDbPane(tabla('c1', 'B')), null) === v2, 'identidad')
  const k = claveBd.conexion('c1')
  const e1 = alternarExpandido(v0, k)
  const e2 = alternarExpandido(e1, k)
  check('alternarExpandido abre y cierra', e1.expandidos.has(k) && !e2.expandidos.has(k), `${e1.expandidos.size}/${e2.expandidos.size}`)
  check(
    'alternarExpandido con `abierto` ya cumplido: MISMA vista',
    alternarExpandido(e1, k, true) === e1 && alternarExpandido(v0, k, false) === v0,
    'identidad'
  )
  check('alternarExpandido no muta el conjunto previo', v0.expandidos.size === 0 && e1.expandidos.size === 1, 'ok')
  check('plegarTodo', plegarTodo(e1).expandidos.size === 0 && plegarTodo(v0) === v0, 'ok')
  check('fijarSeleccion igual: MISMA vista', fijarSeleccion(v0, null) === v0 && fijarSeleccion(v0, 'x').seleccion === 'x', 'ok')

  hr('(3) revelarPane')
  const pane: DbPane = { kind: 'fuente', conexionId: 'c1', esquema: 'HR', objeto: 'PKG', tipo: 'paquete' }
  const r1 = revelarPane(v0, pane)
  check(
    'expande conexión, esquema y carpeta; selecciona la fila; token 1',
    j([...r1.expandidos].map(legible)) === j(['conexion/c1', 'esquema/c1/HR', 'carpeta/c1/HR/paquete']) &&
      r1.seleccion === claveBd.objeto('c1', 'HR', 'paquete', 'PKG') &&
      r1.revelar?.clave === r1.seleccion &&
      r1.revelar?.token === 1,
    j({ exp: [...r1.expandidos].map(legible), token: r1.revelar?.token })
  )
  const r2 = revelarPane(r1, pane)
  check(
    'pedirlo otra vez: el token crece y el conjunto de expandidos se reutiliza',
    r2.revelar?.token === 2 && r2.expandidos === r1.expandidos && r2 !== r1,
    `token ${r2.revelar?.token}`
  )

  hr('(4) podarPerfiles')
  check('todos vivos: MISMO mapa', podarPerfiles(m, ['p1', 'p2', 'p3']) === m, 'identidad')
  const soloP1 = podarPerfiles(m, new Set(['p1']))
  check('quita los muertos', soloP1.size === 1 && soloP1.has('p1') && soloP1.get('p1') === m.get('p1'), [...soloP1.keys()].join(','))
  check('lista vacía: todo fuera (la guarda es del hook)', podarPerfiles(m, []).size === 0, '0')
  check('el mapa de entrada no se muta', m.size === 2, `${m.size}`)

  hr('(5) podarConexion')
  // La activa de p1 es una tabla de c1, para ver a dónde pasa al podar.
  const conActivaEnC1 = actualizarPerfil(m, 'p1', (v) => activarEnVista(v, idDbPane(tabla('c1', 'A'))))
  const sinC1 = podarConexion(conActivaEnC1, 'c1', 'p1')
  const p1 = vistaDe(sinC1, 'p1')
  check(
    'fuera sus pestañas (datos y consolas); la activa pasa a la superviviente de su derecha',
    p1.pestanas.tabs.every((t) => t.pane.conexionId === 'c2') &&
      p1.pestanas.tabs.length === 2 &&
      p1.pestanas.activeId === idDbPane(tabla('c2', 'B')),
    p1.pestanas.tabs.map((t) => t.id).join(' ')
  )
  check(
    'fuera sus claves expandidas; las de otras conexiones se quedan',
    j([...p1.expandidos].map(legible)) === j(['conexion/c2']),
    j([...p1.expandidos].map(legible))
  )
  check('la selección que apuntaba a ella se limpia', p1.seleccion === null, `${p1.seleccion}`)
  // Ceñida al perfil: la misma copia pegada en dos perfiles
  // comparte id, y borrar la de p1 no puede cerrarle a p2 las pestañas de la suya.
  check(
    'NEGATIVO: el OTRO perfil con el mismo id queda intacto (su misma vista)',
    sinC1.get('p2') === conActivaEnC1.get('p2') && vistaDe(sinC1, 'p2').pestanas.tabs.length === 1,
    [...sinC1.keys()].join(',')
  )
  const sinC1EnP2 = podarConexion(m, 'c1', 'p2')
  check(
    'podada en p2 (que solo tenía c1): desaparece del mapa, y p1 queda intacto',
    !sinC1EnP2.has('p2') && sinC1EnP2.get('p1') === m.get('p1'),
    [...sinC1EnP2.keys()].join(',')
  )
  check('una conexión que no está en ningún sitio: MISMO mapa', podarConexion(m, 'c9', 'p1') === m, 'identidad')
  check('un perfil que no está en el mapa: MISMO mapa', podarConexion(m, 'c1', 'p9') === m, 'identidad')
  const conRevelar = actualizarPerfil(m, 'p1', (v) => revelarPane(v, tabla('c1', 'A')))
  check(
    'revelar pendiente de la conexión borrada: se descarta',
    vistaDe(podarConexion(conRevelar, 'c1', 'p1'), 'p1').revelar === null,
    'null'
  )

  hr('(6) podarConexiones')
  const porPerfil = new Map<string, readonly string[]>([['p1', ['c2']]])
  const podado = podarConexiones(m, porPerfil)
  check(
    'poda solo los perfiles del mapa; p2 (ausente) intacto',
    vistaDe(podado, 'p1').pestanas.tabs.every((t) => t.pane.conexionId === 'c2') && podado.get('p2') === m.get('p2'),
    `${vistaDe(podado, 'p1').pestanas.tabs.length} pestañas en p1`
  )
  check(
    'todas vivas: MISMO mapa',
    podarConexiones(m, new Map([['p1', ['c1', 'c2']], ['p2', ['c1']]])) === m,
    'identidad'
  )

  hr('(7) podarConsolas')
  const conSel = actualizarPerfil(m, 'p1', (v) => fijarSeleccion(v, claveBd.consola('c1', 'k1')))
  const sinK1 = podarConsolas(conSel, 'p1', ['k2'])
  const vk = vistaDe(sinK1, 'p1')
  check(
    'fuera la pestaña de la consola muerta; tablas y la otra consola se quedan',
    vk.pestanas.tabs.length === 3 && !vk.pestanas.tabs.some((t) => t.pane.kind === 'consola' && t.pane.consolaId === 'k1'),
    vk.pestanas.tabs.map((t) => t.id).join(' ')
  )
  check('la selección de la consola muerta se limpia', vk.seleccion === null, `${vk.seleccion}`)
  check(
    'una selección que NO es de consola no se toca',
    vistaDe(podarConsolas(m, 'p1', []), 'p1').seleccion === vistaDe(m, 'p1').seleccion,
    legible(vistaDe(m, 'p1').seleccion ?? '')
  )
  check('las expandidas no se tocan', vk.expandidos === vistaDe(conSel, 'p1').expandidos, 'identidad')
  check('todas vivas: MISMO mapa', podarConsolas(m, 'p1', ['k1', 'k2']) === m, 'identidad')
  check('perfil desconocido: MISMO mapa', podarConsolas(m, 'p9', []) === m, 'identidad')

  hr('(8) Solo memoria')
  const exportados = Object.keys(vista)
  check(
    'el módulo no exporta nada para guardar/hidratar (las pestañas NO se persisten)',
    !exportados.some((n) => /serializ|hidrat|guardad|persist/i.test(n)),
    exportados.join(',')
  )
  const vacia: DbVistaPerfil = VISTA_PERFIL_VACIA
  check('la vista vacía no tiene pestañas ni selección', vacia.pestanas.tabs.length === 0 && vacia.seleccion === null, 'ok')

  hr('RESULTADO (PASS/FAIL)')
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
