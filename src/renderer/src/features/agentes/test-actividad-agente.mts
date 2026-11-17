#!/usr/bin/env node
// =============================================================================
// Prueba del modelo del inspector de progreso (actividadAgente).
// (node src/renderer/src/features/agentes/test-actividad-agente.mts)
// -----------------------------------------------------------------------------
// PURO (sin React): corre bajo node. Cubre la mecánica de `unseen` (terminó sin
// ver), su limpieza al ver o al re-trabajar, y la poda.
// =============================================================================

import {
  estadoActividadVacio,
  aplicarActividad,
  marcarVisto,
  podarActividad,
  limpiarClavesActividad,
  dejarDeVer,
  sincronizarActividad,
  estaTrabajando,
  turnoEnMarcha
} from './actividadAgente.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const A = 'perfilA|C:\\p\\1|claude-code'
const B = 'perfilA|C:\\p\\2|codex'

// (1) 'done' en un target NO activo => queda en unseen (listo por revisar).
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  check('(1a) trabajando no marca unseen', !s.sinVer.has(A) && estaTrabajando(s, A), `unseen=${[...s.sinVer]}`)
  s = aplicarActividad(s, A, 'done', false)
  check('(1b) done en target inactivo => unseen', s.sinVer.has(A), `unseen=${[...s.sinVer]}`)
}

// (2) 'done' en el target ACTIVO (lo estás viendo) => NO unseen.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', true)
  s = aplicarActividad(s, A, 'done', true)
  check('(2) done en target activo => NO unseen', !s.sinVer.has(A), `unseen=${[...s.sinVer]}`)
}

// (3) marcarVisto limpia (visitaste el proyecto terminado).
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, A, 'done', false)
  s = marcarVisto(s, A)
  check('(3) marcarVisto saca de unseen', !s.sinVer.has(A), `unseen=${[...s.sinVer]}`)
}

// (4) volver a trabajar limpia unseen (ya no es "terminado por revisar").
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, A, 'done', false)
  s = aplicarActividad(s, A, 'working', false)
  check('(4) re-trabajar limpia unseen', !s.sinVer.has(A) && estaTrabajando(s, A), `unseen=${[...s.sinVer]}`)
}

// (5) el cierre SILENCIOSO ('idle') apaga el indicador pero NUNCA avisa: es la
//     diferencia clave con la v1 (donde todo working->idle fabricaba un verde).
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'idle', false)
  check('(5a) idle sin working previo => NO unseen', !s.sinVer.has(A), `unseen=${[...s.sinVer]}`)
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, A, 'idle', false)
  check(
    '(5b) working->idle (turno trivial/cierre de sesión) => NO unseen',
    !s.sinVer.has(A) && !estaTrabajando(s, A),
    `unseen=[${[...s.sinVer]}] raw=${s.crudo[A]}`
  )
}

// (6) varios targets independientes: A terminó (unseen), B sigue trabajando.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, B, 'working', false)
  s = aplicarActividad(s, A, 'done', false)
  check(
    '(6) A unseen y B aún trabajando (independientes)',
    s.sinVer.has(A) && !s.sinVer.has(B) && estaTrabajando(s, B),
    `unseen=${[...s.sinVer]} B=${s.crudo[B]}`
  )
}

// (7) poda: cerrar B lo elimina de raw y unseen.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, B, 'working', false)
  s = aplicarActividad(s, B, 'done', false)
  s = podarActividad(s, new Set([A]))
  check('(7) poda deja solo A', !(B in s.crudo) && !s.sinVer.has(B) && A in s.crudo, `raw=${Object.keys(s.crudo)}`)
}

// (8) identidad estable: aplicar el MISMO estado no crea objeto nuevo.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  const igual = aplicarActividad(s, A, 'working', false)
  check('(8) mismo estado => misma referencia (sin re-render)', igual === s, `same=${igual === s}`)
}

// (9) limpiarClavesActividad: hibernar limpia el 'working' pegado SIN marcar unseen.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false) // A trabajando
  s = aplicarActividad(s, B, 'working', false)
  s = aplicarActividad(s, B, 'done', false) // B terminó -> unseen
  // Hibernan A (sigue 'working'): se limpia su estado, NO se marca terminado.
  s = limpiarClavesActividad(s, new Set([A]))
  check(
    '(9) limpiarClavesActividad quita A de raw y NO lo mete en unseen',
    !(A in s.crudo) && !s.sinVer.has(A) && s.sinVer.has(B),
    `raw=${Object.keys(s.crudo)} unseen=[${[...s.sinVer]}]`
  )
}

// (10) limpiarClavesActividad con set vacío o sin coincidencias => misma referencia.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  const igual = limpiarClavesActividad(s, new Set(['otro']))
  check('(10) clear sin coincidencias => misma referencia', igual === s, `same=${igual === s}`)
}

// (11) RESINCRONIZACIÓN con la foto del main. El caso que la justifica es el que NO
//      viene en la foto: una sesión murió mientras su aviso se perdía (ventana
//      destruida, recarga del renderer). Aplicar solo lo que la foto trae dejaría ese
//      target 'working' para siempre —el dot respirando con el agente parado—, que es
//      justo el fallo que esta resincronización existe para curar.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  s = aplicarActividad(s, B, 'working', false)
  s = aplicarActividad(s, B, 'done', false) // B dejó un aviso pendiente
  // La foto solo trae A, y ya no trabaja. B ni siquiera existe: su sesión murió.
  s = sincronizarActividad(s, { [A]: 'idle' })
  check(
    '(11) la foto apaga lo que trae Y quita lo que ya no está, sin tocar los avisos',
    s.crudo[A] === 'idle' && !(B in s.crudo) && s.sinVer.has(B),
    `raw=${JSON.stringify(s.crudo)} unseen=[${[...s.sinVer]}]`
  )
}

// (12) Identidad estable: la foto se pide al montar y en CADA foco de la ventana, así
//      que no puede provocar un re-render cuando no cambia nada.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', false)
  const igual = sincronizarActividad(s, { [A]: 'working' })
  check('(12) foto idéntica => misma referencia', igual === s, `same=${igual === s}`)
}

// (13) era la de `markAllSeen` —«mirar el inspector es revisarlo»—, y se fue con el
// inspector: hoy el aviso se apaga target por target (marcarVisto, caso 5), que es
//      lo que hacen las dos vistas que quedan.

// (14) 'blocked' (el agente te espera): avisa como 'done' y además queda en `esperando`
//      hasta que el agente diga otra cosa; dejar de mirarlo sin contestar vuelve a avisar.
{
  let s = estadoActividadVacio
  s = aplicarActividad(s, A, 'working', true)
  s = aplicarActividad(s, A, 'blocked', true, 'question')
  check('(14a) blocked mirándolo: espera, sin halo (lo tienes delante)', s.esperando.get(A) === 'question' && !s.sinVer.has(A) && !estaTrabajando(s, A), `esperando=${[...s.esperando]}`)
  s = dejarDeVer(s, A)
  check('(14b) dejas de mirarlo sin contestar: vuelve a avisar', s.sinVer.has(A), `unseen=${[...s.sinVer]}`)
  s = marcarVisto(s, A)
  check('(14c) volver a mirarlo apaga el halo pero sigue esperando', !s.sinVer.has(A) && s.esperando.has(A), '')
  s = aplicarActividad(s, A, 'working', true)
  check('(14d) contestada (vuelve a trabajar): ya no espera', !s.esperando.has(A) && estaTrabajando(s, A), '')
  check('(14e) dejar de mirar algo que no espera no avisa', dejarDeVer(s, A) === s, '')
  s = aplicarActividad(s, B, 'blocked', false, null)
  check('(14f) blocked sin mirarlo: halo y espera (sin motivo)', s.sinVer.has(B) && s.esperando.has(B) && s.esperando.get(B) === null, '')
  const igual = aplicarActividad(s, B, 'blocked', false, null)
  check('(14g) el mismo blocked otra vez => misma referencia', igual === s, '')
  s = aplicarActividad(s, B, 'idle', false)
  check('(14h) idle (Esc o cierre) quita la espera y su aviso: no terminó nada', !s.esperando.has(B) && !s.sinVer.has(B), `unseen=${[...s.sinVer]}`)
  s = aplicarActividad(s, B, 'blocked', false, 'permission')
  check('(14i) la poda y la hibernación la quitan', !podarActividad(s, new Set([A])).esperando.has(B) && !limpiarClavesActividad(s, new Set([B])).esperando.has(B), '')
  const foto = sincronizarActividad(s, { [B]: 'idle' }, new Map())
  check('(14j) la foto del main manda sobre la espera (una colgada se apaga)', !foto.esperando.has(B) && foto.sinVer.has(B), `esperando=${[...foto.esperando]}`)
  const repuesta = sincronizarActividad(estadoActividadVacio, { [B]: 'idle' }, new Map([[B, 'auth']]))
  check('(14k) y la repone tras recargar', repuesta.esperando.get(B) === 'auth', '')
}

// (15) Turno en marcha: trabajando o esperando una respuesta; ocioso o terminado, no.
{
  let s = aplicarActividad(estadoActividadVacio, A, 'working', false)
  check('(15a) trabajando: turno en marcha', turnoEnMarcha(s, A), '')
  s = aplicarActividad(s, A, 'blocked', false, 'permission')
  check('(15b) esperando una respuesta: turno en marcha', turnoEnMarcha(s, A) && !estaTrabajando(s, A), '')
  s = aplicarActividad(s, A, 'done', false)
  check('(15c) terminado: no', !turnoEnMarcha(s, A), '')
  check('(15d) un target sin actividad: no', !turnoEnMarcha(estadoActividadVacio, B), '')
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
