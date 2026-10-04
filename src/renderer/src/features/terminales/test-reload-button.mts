#!/usr/bin/env node
// =============================================================================
// Prueba de `botonReinicio`: qué ofrece el botón en cada estado del pane.
// (node src/renderer/src/features/terminales/test-reload-button.mts)
// Protege el arranque en frío fallido (habilitado y ofrece ABRIR), las tres guardas
// (hibernado, sin condiciones para abrir, recuperación en vuelo), las etiquetas de
// progreso y el aviso de sesión atrasada.
// Decisiones: docs/decisiones/terminales/boton-de-reinicio-una-sola-verdad.md
// =============================================================================

import { botonReinicio, type EntradaBotonReinicio } from './reloadButton.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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

// ---------------------------------------------------------------------------
// Fixtures: el pane del agente y el de la terminal, con sus etiquetas.
// ---------------------------------------------------------------------------
function agente(extra: Partial<EntradaBotonReinicio> = {}): EntradaBotonReinicio {
  return {
    status: 'live',
    sessionId: 'sess-1',
    reloading: false,
    etiquetaNormal: 'Reiniciar',
    etiquetaProgreso: 'Reiniciando…',
    ...extra
  }
}
function shell(extra: Partial<EntradaBotonReinicio> = {}): EntradaBotonReinicio {
  return {
    status: 'live',
    sessionId: 'term-1',
    reloading: false,
    // La terminal decía "Recargar" y pasó a "Reiniciar": es la misma acción que en el
    // pane del agente, y con dos nombres el tooltip y la etiqueta desplegable del
    // botón se contradecían.
    etiquetaNormal: 'Reiniciar',
    etiquetaProgreso: 'Reiniciando…',
    ...extra
  }
}
/** El estado exacto tras un open() que falló por Docker apagado. */
const ARRANQUE_FALLIDO: Partial<EntradaBotonReinicio> = { status: 'error', sessionId: null }

function fmt(r: ReturnType<typeof botonReinicio>): string {
  return `habilitado=${r.habilitado} etiqueta=${JSON.stringify(r.etiqueta)} accion=${r.accion}`
}

function main(): void {
  hr('Docker apagado ANTES de abrir (el bug)')

  {
    const r = botonReinicio(agente(ARRANQUE_FALLIDO))
    check('(1) habilitado, "Reintentar" y accion open', r.habilitado && r.etiqueta === 'Reintentar' && r.accion === 'open', fmt(r))
    check('(2) el tooltip habla de reintentar el arranque', r.titulo.includes('Reintentar el arranque'), JSON.stringify(r.titulo))
  }

  hr('Las tres guardas: cuándo NO debe abrir')

  {
    const r = botonReinicio(agente({ ...ARRANQUE_FALLIDO, hibernated: true }))
    check('(3) perfil hibernado', !r.habilitado && r.accion === 'nada', fmt(r))
  }
  {
    const r = botonReinicio(agente({ ...ARRANQUE_FALLIDO, puedeAbrir: false }))
    check('(4) sin cuenta (puedeAbrir=false)', !r.habilitado && r.accion === 'nada', fmt(r))
  }
  {
    const r = botonReinicio(agente({ status: 'booting', sessionId: null }))
    check('(5) booting', !r.habilitado && r.accion === 'nada', fmt(r))
  }

  hr('Caminos que ya existían (no deben cambiar)')

  {
    const r = botonReinicio(agente())
    check('(6) sesión viva', r.habilitado && r.etiqueta === 'Reiniciar' && r.accion === 'reload', fmt(r))
  }
  {
    const r = botonReinicio(agente({ status: 'exited' }))
    check('(7) salida normal', r.habilitado && r.etiqueta === 'Reabrir' && r.accion === 'reload', fmt(r))
  }
  {
    const r = botonReinicio(agente({ status: 'booting', faseRecuperacion: 'recovering', intentoRecuperacion: 1, maxIntentos: 2 }))
    check('(8) recuperando por fase', !r.habilitado && r.etiqueta === 'Recuperando… (1/2)', fmt(r))
  }
  {
    // El ref es SÍNCRONO y el estado aún no se ha commiteado: sin este dato el
    // botón se vería habilitado durante esa ventana y al pulsarlo no haría nada.
    const r = botonReinicio(agente({ recuperando: true }))
    check('(9) recuperando por ref (estado sin commitear)', !r.habilitado && r.accion === 'nada', fmt(r))
  }
  {
    const caido = botonReinicio(agente({ status: 'exited', faseRecuperacion: 'docker-down' }))
    const agotado = botonReinicio(agente({ status: 'exited', faseRecuperacion: 'failed' }))
    check(
      '(10) docker-down y failed en caliente',
      caido.habilitado && caido.etiqueta === 'Reintentar' && agotado.habilitado && agotado.etiqueta === 'Reintentar',
      `${fmt(caido)} | ${fmt(agotado)}`
    )
  }

  hr('Etiquetas en vuelo y variante de la terminal')

  {
    const normal = botonReinicio(agente({ reloading: true }))
    const reabriendo = botonReinicio(agente({ status: 'exited', reloading: true }))
    const reintentando = botonReinicio(agente({ ...ARRANQUE_FALLIDO, reloading: true }))
    check(
      '(11) gerundios y deshabilitado',
      normal.etiqueta === 'Reiniciando…' &&
        reabriendo.etiqueta === 'Reabriendo…' &&
        reintentando.etiqueta === 'Reintentando…' &&
        !normal.habilitado &&
        !reabriendo.habilitado &&
        !reintentando.habilitado,
      `${normal.etiqueta} | ${reabriendo.etiqueta} | ${reintentando.etiqueta}`
    )
  }
  {
    // EL ESTADO REAL A MITAD DE UN REINTENTO EN FRÍO: al pulsar "Reintentar",
    // abrirSesion pone status 'booting' y sessionId sigue null, así que `accionBase`
    // cae a 'nada' y el botón decía "Reiniciando…" durante todo el reintento —
    // contradiciendo lo que acabas de pulsar. Es un caso REAL, no hipotético.
    const enVuelo = botonReinicio(agente({ status: 'booting', sessionId: null, reloading: true }))
    const enVueloShell = botonReinicio(shell({ status: 'booting', sessionId: null, reloading: true }))
    check(
      '(11b) reintento en frío EN VUELO sigue diciendo "Reintentando…"',
      enVuelo.etiqueta === 'Reintentando…' && enVueloShell.etiqueta === 'Reintentando…',
      `${fmt(enVuelo)} | ${fmt(enVueloShell)}`
    )
    check(
      '(11c) …y su tooltip no se cambia por el de "reinicio robusto"',
      enVuelo.titulo.includes('Reintentar el arranque'),
      JSON.stringify(enVuelo.titulo)
    )
  }
  {
    const vivo = botonReinicio(shell())
    const cargando = botonReinicio(shell({ reloading: true }))
    const fallido = botonReinicio(shell(ARRANQUE_FALLIDO))
    check(
      '(12) la terminal dice Reiniciar/Reiniciando… y también reintenta',
      vivo.etiqueta === 'Reiniciar' && cargando.etiqueta === 'Reiniciando…' && fallido.etiqueta === 'Reintentar' && fallido.accion === 'open',
      `${vivo.etiqueta} | ${cargando.etiqueta} | ${fmt(fallido)}`
    )
  }

  hr('Icono solo vs icono + etiqueta')

  {
    // La regla: el botón es de ICONO en reposo (la flecha circular ya dice
    // "reiniciar"), y CRECE una etiqueta justo cuando tiene algo que el icono no
    // puede decir — que algo falló, que la sesión murió, o cuánto lleva de
    // recuperación. Esconder eso detrás de un hover es esconder la única señal.
    //
    // OJO al leer esto desde la interfaz: el botón TAMBIÉN despliega su nombre
    // ("Reiniciar agente" / "Reiniciar terminal") al pasar el ratón, pero eso es CSS
    // puro y sólo se renderiza cuando `soloIcono` es true. Lo de aquí es lo otro: lo
    // que va FIJO porque no puede depender de que alguien apunte con el ratón.
    check(
      '(14) en reposo va SOLO el icono',
      botonReinicio(agente()).soloIcono && botonReinicio(shell()).soloIcono,
      `agente=${botonReinicio(agente()).etiqueta} shell=${botonReinicio(shell()).etiqueta}`
    )
    const conTexto: [string, EntradaBotonReinicio][] = [
      ['arranque fallido', agente(ARRANQUE_FALLIDO)],
      ['recargando', agente({ reloading: true })],
      ['sesión muerta', agente({ status: 'exited' })],
      ['recuperando', agente({ faseRecuperacion: 'recovering', intentoRecuperacion: 1 })],
      ['docker caído', agente({ faseRecuperacion: 'docker-down' })],
      ['recuperación agotada', agente({ faseRecuperacion: 'failed' })]
    ]
    const mudos = conTexto.filter(([, c]) => botonReinicio(c).soloIcono).map(([n]) => n)
    check(
      '(15) todo lo que NO es reposo lleva su etiqueta',
      mudos.length === 0,
      mudos.length === 0
        ? conTexto.map(([n, c]) => `${n}="${botonReinicio(c).etiqueta}"`).join(' · ')
        : `sin etiqueta: ${mudos.join(', ')}`
    )
    // El día que alguien pase `etiquetaNormal: 'Reintentar'`, comparar la etiqueta
    // con la normal daría "solo icono" en un estado que SÍ tiene algo que decir.
    check(
      '(16) `soloIcono` no sale de comparar la etiqueta con la normal',
      !botonReinicio(agente({ ...ARRANQUE_FALLIDO, etiquetaNormal: 'Reintentar' })).soloIcono,
      'con etiquetaNormal="Reintentar" y arranque fallido sigue llevando texto'
    )
  }

  // ---------------------------------------------------------------------------
  hr('Actualizar los agentes de tu equipo')

  {
    // El pane pasa `reloading: reloading || actualizando` y su propio gerundio: no
    // hay un estado nuevo que pueda discrepar de `reloading`.
    const r = botonReinicio(agente({ reloading: true, etiquetaProgreso: 'Actualizando…' }))
    check(
      '(17) preparado para actualizar: «Actualizando…», deshabilitado y con etiqueta',
      r.etiqueta === 'Actualizando…' && !r.habilitado && r.accion === 'nada' && !r.soloIcono,
      fmt(r)
    )
  }
  const ATRASADA = { lanzada: '2.1.280', instalada: '2.1.281' }
  const NORMAL = botonReinicio(agente()).titulo
  {
    const r = botonReinicio(agente({ versiones: ATRASADA }))
    check(
      '(18) atrasada: «corre 2.1.280 · instalada 2.1.281: reinicia para usarla», y sigue siendo sólo icono',
      r.titulo === 'corre 2.1.280 · instalada 2.1.281: reinicia para usarla' &&
        r.habilitado &&
        r.accion === 'reload' &&
        r.soloIcono &&
        r.etiqueta === 'Reiniciar',
      `${fmt(r)} titulo=${JSON.stringify(r.titulo)}`
    )
  }
  {
    const iguales = botonReinicio(agente({ versiones: { lanzada: '2.1.281', instalada: '2.1.281' } }))
    // Canal `stable`: la instalada puede ir por DETRÁS de la que corre; no es atraso.
    const detras = botonReinicio(agente({ versiones: { lanzada: '2.1.281', instalada: '2.1.273' } }))
    const sinSonda = botonReinicio(agente({ versiones: { lanzada: null, instalada: '2.1.281' } }))
    const sinInstalada = botonReinicio(agente({ versiones: { lanzada: '2.1.280', instalada: null } }))
    const nulo = botonReinicio(agente({ versiones: null }))
    const titulos = [iguales, detras, sinSonda, sinInstalada, nulo].map((r) => r.titulo)
    check(
      '(19) iguales, instalada por detrás o alguna desconocida → tooltip de siempre',
      titulos.every((t) => t === NORMAL),
      titulos.join(' | ')
    )
  }
  {
    const actualizando = botonReinicio(agente({ versiones: ATRASADA, reloading: true, etiquetaProgreso: 'Actualizando…' }))
    const recuperando = botonReinicio(agente({ versiones: ATRASADA, recuperando: true }))
    const muerta = botonReinicio(agente({ versiones: ATRASADA, status: 'exited' }))
    check(
      '(20) con el botón inerte o en «Reabrir» no se pide reiniciar',
      !actualizando.titulo.startsWith('corre ') && !recuperando.titulo.startsWith('corre ') && muerta.titulo.startsWith('Reabrir'),
      `${actualizando.titulo} | ${recuperando.titulo} | ${muerta.titulo}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('Invariante')

  {
    const casos: EntradaBotonReinicio[] = [
      agente(),
      agente(ARRANQUE_FALLIDO),
      agente({ ...ARRANQUE_FALLIDO, hibernated: true }),
      agente({ ...ARRANQUE_FALLIDO, puedeAbrir: false }),
      agente({ status: 'booting', sessionId: null }),
      agente({ reloading: true }),
      agente({ recuperando: true }),
      agente({ status: 'exited' }),
      agente({ reloading: true, etiquetaProgreso: 'Actualizando…' }),
      agente({ versiones: { lanzada: '2.1.280', instalada: '2.1.281' }, reloading: true }),
      shell(),
      shell(ARRANQUE_FALLIDO)
    ]
    const rotos = casos.filter((c) => {
      const r = botonReinicio(c)
      return !r.habilitado && r.accion !== 'nada'
    })
    check('(13) deshabilitado => accion nada, siempre', rotos.length === 0, `casos=${casos.length} rotos=${rotos.length}`)
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
