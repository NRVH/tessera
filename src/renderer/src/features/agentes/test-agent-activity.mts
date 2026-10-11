#!/usr/bin/env node
// =============================================================================
// Prueba del modelo del inspector de progreso (agentActivity).
// (node src/renderer/src/features/agentes/test-agent-activity.mts)
// -----------------------------------------------------------------------------
// PURO (sin React): corre bajo node. Cubre la mecánica de `unseen` (terminó sin
// ver), su limpieza al ver o al re-trabajar, y la poda.
// =============================================================================

import {
  emptyActivityState,
  applyActivity,
  markSeen,
  pruneActivity,
  clearActivityKeys,
  dejarDeVer,
  sincronizarActividad,
  isWorking
} from './agentActivity.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const A = 'perfilA|C:\\p\\1|claude-code'
const B = 'perfilA|C:\\p\\2|codex'

// (1) 'done' en un target NO activo => queda en unseen (listo por revisar).
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  check('(1a) trabajando no marca unseen', !s.unseen.has(A) && isWorking(s, A), `unseen=${[...s.unseen]}`)
  s = applyActivity(s, A, 'done', false)
  check('(1b) done en target inactivo => unseen', s.unseen.has(A), `unseen=${[...s.unseen]}`)
}

// (2) 'done' en el target ACTIVO (lo estás viendo) => NO unseen.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', true)
  s = applyActivity(s, A, 'done', true)
  check('(2) done en target activo => NO unseen', !s.unseen.has(A), `unseen=${[...s.unseen]}`)
}

// (3) markSeen limpia (visitaste el proyecto terminado).
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, A, 'done', false)
  s = markSeen(s, A)
  check('(3) markSeen saca de unseen', !s.unseen.has(A), `unseen=${[...s.unseen]}`)
}

// (4) volver a trabajar limpia unseen (ya no es "terminado por revisar").
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, A, 'done', false)
  s = applyActivity(s, A, 'working', false)
  check('(4) re-trabajar limpia unseen', !s.unseen.has(A) && isWorking(s, A), `unseen=${[...s.unseen]}`)
}

// (5) el cierre SILENCIOSO ('idle') apaga el indicador pero NUNCA avisa: es la
//     diferencia clave con la v1 (donde todo working->idle fabricaba un verde).
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'idle', false)
  check('(5a) idle sin working previo => NO unseen', !s.unseen.has(A), `unseen=${[...s.unseen]}`)
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, A, 'idle', false)
  check(
    '(5b) working->idle (turno trivial/cierre de sesión) => NO unseen',
    !s.unseen.has(A) && !isWorking(s, A),
    `unseen=[${[...s.unseen]}] raw=${s.raw[A]}`
  )
}

// (6) varios targets independientes: A terminó (unseen), B sigue trabajando.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, B, 'working', false)
  s = applyActivity(s, A, 'done', false)
  check(
    '(6) A unseen y B aún trabajando (independientes)',
    s.unseen.has(A) && !s.unseen.has(B) && isWorking(s, B),
    `unseen=${[...s.unseen]} B=${s.raw[B]}`
  )
}

// (7) poda: cerrar B lo elimina de raw y unseen.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, B, 'working', false)
  s = applyActivity(s, B, 'done', false)
  s = pruneActivity(s, new Set([A]))
  check('(7) poda deja solo A', !(B in s.raw) && !s.unseen.has(B) && A in s.raw, `raw=${Object.keys(s.raw)}`)
}

// (8) identidad estable: aplicar el MISMO estado no crea objeto nuevo.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  const same = applyActivity(s, A, 'working', false)
  check('(8) mismo estado => misma referencia (sin re-render)', same === s, `same=${same === s}`)
}

// (9) clearActivityKeys: hibernar limpia el 'working' pegado SIN marcar unseen.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false) // A trabajando
  s = applyActivity(s, B, 'working', false)
  s = applyActivity(s, B, 'done', false) // B terminó -> unseen
  // Hibernan A (sigue 'working'): se limpia su estado, NO se marca terminado.
  s = clearActivityKeys(s, new Set([A]))
  check(
    '(9) clearActivityKeys quita A de raw y NO lo mete en unseen',
    !(A in s.raw) && !s.unseen.has(A) && s.unseen.has(B),
    `raw=${Object.keys(s.raw)} unseen=[${[...s.unseen]}]`
  )
}

// (10) clearActivityKeys con set vacío o sin coincidencias => misma referencia.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  const same = clearActivityKeys(s, new Set(['otro']))
  check('(10) clear sin coincidencias => misma referencia', same === s, `same=${same === s}`)
}

// (11) RESINCRONIZACIÓN con la foto del main. El caso que la justifica es el que NO
//      viene en la foto: una sesión murió mientras su aviso se perdía (ventana
//      destruida, recarga del renderer). Aplicar solo lo que la foto trae dejaría ese
//      target 'working' para siempre —el dot respirando con el agente parado—, que es
//      justo el fallo que esta resincronización existe para curar.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  s = applyActivity(s, B, 'working', false)
  s = applyActivity(s, B, 'done', false) // B dejó un aviso pendiente
  // La foto solo trae A, y ya no trabaja. B ni siquiera existe: su sesión murió.
  s = sincronizarActividad(s, { [A]: 'idle' })
  check(
    '(11) la foto apaga lo que trae Y quita lo que ya no está, sin tocar los avisos',
    s.raw[A] === 'idle' && !(B in s.raw) && s.unseen.has(B),
    `raw=${JSON.stringify(s.raw)} unseen=[${[...s.unseen]}]`
  )
}

// (12) Identidad estable: la foto se pide al montar y en CADA foco de la ventana, así
//      que no puede provocar un re-render cuando no cambia nada.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', false)
  const igual = sincronizarActividad(s, { [A]: 'working' })
  check('(12) foto idéntica => misma referencia', igual === s, `same=${igual === s}`)
}

// (13) era la de `markAllSeen` —«mirar el inspector es revisarlo»—, y se fue con el
//      inspector: hoy el aviso se apaga target por target (markSeen, caso 5), que es
//      lo que hacen las dos vistas que quedan.

// (14) 'blocked' (el agente te espera): avisa como 'done' y además queda en `esperando`
//      hasta que el agente diga otra cosa; dejar de mirarlo sin contestar vuelve a avisar.
{
  let s = emptyActivityState
  s = applyActivity(s, A, 'working', true)
  s = applyActivity(s, A, 'blocked', true, 'question')
  check('(14a) blocked mirándolo: espera, sin halo (lo tienes delante)', s.esperando.get(A) === 'question' && !s.unseen.has(A) && !isWorking(s, A), `esperando=${[...s.esperando]}`)
  s = dejarDeVer(s, A)
  check('(14b) dejas de mirarlo sin contestar: vuelve a avisar', s.unseen.has(A), `unseen=${[...s.unseen]}`)
  s = markSeen(s, A)
  check('(14c) volver a mirarlo apaga el halo pero sigue esperando', !s.unseen.has(A) && s.esperando.has(A), '')
  s = applyActivity(s, A, 'working', true)
  check('(14d) contestada (vuelve a trabajar): ya no espera', !s.esperando.has(A) && isWorking(s, A), '')
  check('(14e) dejar de mirar algo que no espera no avisa', dejarDeVer(s, A) === s, '')
  s = applyActivity(s, B, 'blocked', false, null)
  check('(14f) blocked sin mirarlo: halo y espera (sin motivo)', s.unseen.has(B) && s.esperando.has(B) && s.esperando.get(B) === null, '')
  const igual = applyActivity(s, B, 'blocked', false, null)
  check('(14g) el mismo blocked otra vez => misma referencia', igual === s, '')
  s = applyActivity(s, B, 'idle', false)
  check('(14h) idle (Esc o cierre) quita la espera y su aviso: no terminó nada', !s.esperando.has(B) && !s.unseen.has(B), `unseen=${[...s.unseen]}`)
  s = applyActivity(s, B, 'blocked', false, 'permission')
  check('(14i) la poda y la hibernación la quitan', !pruneActivity(s, new Set([A])).esperando.has(B) && !clearActivityKeys(s, new Set([B])).esperando.has(B), '')
  const foto = sincronizarActividad(s, { [B]: 'idle' }, new Map())
  check('(14j) la foto del main manda sobre la espera (una colgada se apaga)', !foto.esperando.has(B) && foto.unseen.has(B), `esperando=${[...foto.esperando]}`)
  const repuesta = sincronizarActividad(emptyActivityState, { [B]: 'idle' }, new Map([[B, 'auth']]))
  check('(14k) y la repone tras recargar', repuesta.esperando.get(B) === 'auth', '')
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
