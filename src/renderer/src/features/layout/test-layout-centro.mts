#!/usr/bin/env node
// =============================================================================
// Prueba de layoutCentro (npm run test:layout-centro).
// Recorre las 2304 combinaciones de entrada y fija que nunca queda el centro vacío,
// la paridad de 'files' y 'git' con las fórmulas de referencia (copiadas abajo) salvo
// «oculto manda sobre maximizado», el comportamiento de 'db' y del mosaico, la franja
// inferior, la coherencia de divisores, `maximizadoCoherente` (con el camino real
// simulado paso a paso), la franja a pantalla completa (Git·Log y la terminal), qué hacen ahí
// las aperturas desde Git y cuándo son del agente de la terminal la columna y el conmutador. Solo `layoutCentro.ts`.
// Decisiones: docs/decisiones/layout/oculto-manda-sobre-maximizado.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import {
  RAZON_GITLOG_PANTALLA_COMPLETA,
  RAZON_MOSAICO,
  RAZON_SIN_PERFIL_DB,
  aperturaDesdeGit,
  derivarLayoutCentro,
  maximizadoCoherente,
  pantallaCompletaCoherente,
  type EntradaLayoutCentro,
  type PanelInferiorCentro,
  type SalidaLayoutCentro,
  type VistaCentro
} from './layoutCentro.ts'

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

// ---------------------------------------------------------------------------
// Todas las combinaciones
// ---------------------------------------------------------------------------
const VISTAS: VistaCentro[] = ['files', 'git', 'db']
const PANELES: Array<PanelInferiorCentro | null> = [null, 'terminal', 'gitlog']
const BOOLS = [
  'mosaico',
  'hayPestanasEditor',
  'ccExpandido',
  'ccOculto',
  'vistaDividida',
  'agenteDbVisible',
  'espacioAbierto',
  'hayPerfil'
] as const

function todasLasEntradas(): EntradaLayoutCentro[] {
  const out: EntradaLayoutCentro[] = []
  for (const vista of VISTAS) {
    for (const panelInferior of PANELES) {
      for (let m = 0; m < 1 << BOOLS.length; m++) {
        const b = (i: number): boolean => (m & (1 << i)) !== 0
        out.push({
          vista,
          panelInferior,
          mosaico: b(0),
          hayPestanasEditor: b(1),
          ccExpandido: b(2),
          ccOculto: b(3),
          vistaDividida: b(4),
          agenteDbVisible: b(5),
          espacioAbierto: b(6),
          hayPerfil: b(7)
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// REFERENCIA: las fórmulas de App.tsx ANTES del explorador de BD, copiadas tal
// cual (líneas 1610-1648, 3675-3683, 4224, 4241-4254, 4279, 4294, 4386, 4409-4415)
// con sus nombres originales. NO se refactoriza: su valor es ser una copia.
// ---------------------------------------------------------------------------
interface ReferenciaApp {
  editorOculto: boolean
  cc: { hidden: boolean; grow: boolean; canExpand: boolean }
  divisorAgente: 'editor' | null
  agente: 'proyecto' | 'espacio'
  franja: { divisor: boolean; gitlog: boolean; terminalVisible: boolean }
  barraEstado: { ccVisible: boolean; razonBloqueo: string | null; accion: 'cc' }
}
function referenciaApp(e: EntradaLayoutCentro): ReferenciaApp {
  const activeView = e.vista
  const editorTabs = { tabs: { length: e.hayPestanasEditor ? 1 : 0 } }
  const ccExpanded = e.ccExpandido
  const mosaicoActivo = e.mosaico
  const ccHidden = e.ccOculto
  const toggleCcBloqueado = e.vistaDividida
  const panelInferior = e.panelInferior
  const terminalVisible = panelInferior === 'terminal'
  const tabs = { activeProfile: e.hayPerfil ? { id: 'p' } : null }
  const espaciosAbiertos = new Set(e.espacioAbierto ? ['p'] : [])

  const enConexiones = activeView === 'db'
  const editorAreaOculta = editorTabs.tabs.length === 0 || ccExpanded || enConexiones || mosaicoActivo
  const espacioActivoAbierto = Boolean(tabs.activeProfile && espaciosAbiertos.has(tabs.activeProfile.id))
  const activeTargetKeyEfectivo: 'espacio' | 'proyecto' =
    enConexiones && espacioActivoAbierto && tabs.activeProfile ? 'espacio' : 'proyecto'
  const conexionesVacio = enConexiones && !espacioActivoAbierto
  const canHideCc = editorTabs.tabs.length > 0
  const ccHiddenEffective = ccHidden && canHideCc
  const razonBloqueoCc = !canHideCc
    ? 'Abre un archivo para poder ocultar la columna del agente'
    : toggleCcBloqueado
      ? 'En vista dividida la columna del agente se esconde para dejar sitio a los dos paneles. Cambia el modo del archivo para recuperarla.'
      : null
  const splitter = editorTabs.tabs.length > 0 && !ccExpanded && !ccHiddenEffective && !enConexiones && !mosaicoActivo
  return {
    editorOculto: editorAreaOculta,
    cc: {
      grow: editorAreaOculta,
      canExpand: editorTabs.tabs.length > 0,
      hidden: !mosaicoActivo && (ccHiddenEffective || conexionesVacio)
    },
    divisorAgente: splitter ? 'editor' : null,
    agente: activeTargetKeyEfectivo,
    franja: {
      divisor: panelInferior !== null && !conexionesVacio && !mosaicoActivo,
      gitlog: panelInferior === 'gitlog' && !conexionesVacio,
      terminalVisible: terminalVisible && !conexionesVacio
    },
    barraEstado: {
      ccVisible: mosaicoActivo || !ccHiddenEffective,
      razonBloqueo: mosaicoActivo
        ? 'En el mosaico de agentes las terminales ocupan toda la ventana. Sal del mosaico para ocultar la columna.'
        : razonBloqueoCc,
      accion: 'cc'
    }
  }
}

/** Algo crece en el centro: el editor, el área de BD o la columna del agente. */
function centroOcupado(s: { editorOculto: boolean; dbAreaOculta?: boolean; cc: { hidden: boolean; grow: boolean } }): boolean {
  return !s.editorOculto || s.dbAreaOculta === false || (!s.cc.hidden && s.cc.grow)
}
/**
 * El hueco que tenía la fórmula antigua de 'files'/'git' (agente maximizado y oculto a
 * la vez): el ÚNICO sitio donde la salida nueva se aparta, a sabiendas, de la
 * referencia (oculto manda sobre maximizado; ver la cabecera de `layoutCentro.ts`).
 */
function esHuecoAntiguo(e: EntradaLayoutCentro): boolean {
  return e.vista !== 'db' && !e.mosaico && e.ccExpandido && e.ccOculto && e.hayPestanasEditor
}
function describir(e: EntradaLayoutCentro): string {
  return j(e)
}
/** Proyección de la salida nueva a la forma de la referencia (sin `dbAreaOculta`). */
function proyectar(s: SalidaLayoutCentro): unknown {
  return {
    editorOculto: s.editorOculto,
    cc: { hidden: s.cc.hidden, grow: s.cc.grow, canExpand: s.cc.canExpand },
    divisorAgente: s.divisorAgente,
    agente: s.agente,
    franja: s.franja,
    barraEstado: s.barraEstado
  }
}
function proyectarRef(r: ReferenciaApp): unknown {
  return {
    editorOculto: r.editorOculto,
    cc: { hidden: r.cc.hidden, grow: r.cc.grow, canExpand: r.cc.canExpand },
    divisorAgente: r.divisorAgente,
    agente: r.agente,
    franja: r.franja,
    barraEstado: r.barraEstado
  }
}

/** Los paneles de la franja que se pueden pedir a pantalla completa. */
const PEDIBLES: PanelInferiorCentro[] = ['gitlog', 'terminal']

/** El modo pedido + la entrada, ya corregido como lo hace `usePantallaCompletaFranja`. */
function coherenteDe(pedida: PanelInferiorCentro | null, e: EntradaLayoutCentro): PanelInferiorCentro | null {
  return pantallaCompletaCoherente({ pedida, franja: derivarLayoutCentro(e).franja, mosaico: e.mosaico })
}

/** (10) La regla de la franja a pantalla completa en todas las combinaciones, para los dos paneles. */
function reglaDeLaFranja(entradas: EntradaLayoutCentro[]): void {
  hr('(10) La franja a pantalla completa: Git·Log y la terminal')
  for (const panel of PEDIBLES) {
    const valen = entradas.filter((e) => coherenteDe(panel, e) === panel)
    check(
      `${panel} vale EXACTAMENTE con pedida + ese panel en la franja + fuera de db + sin mosaico (2 vistas x 128 = 256)`,
      valen.length === 256 &&
        entradas.every(
          (e) => (coherenteDe(panel, e) === panel) === (e.vista !== 'db' && e.panelInferior === panel && !e.mosaico)
        ),
      `${valen.length} combinaciones`
    )
    check(
      `NEGATIVO: ${panel} nunca vale con el otro panel, sin franja, en db ni en el mosaico`,
      entradas
        .filter((e) => e.vista === 'db' || e.mosaico || e.panelInferior !== panel)
        .every((e) => coherenteDe(panel, e) === null),
      'todas las combinaciones que no enseñan ese panel'
    )
  }
  check(
    'NEGATIVO: sin pedirla no se enciende nunca, en ninguna de las 2304 combinaciones',
    entradas.every((e) => coherenteDe(null, e) === null),
    '2304 combinaciones'
  )
  check(
    'los dos paneles no se cruzan: pedir uno nunca pinta el otro, y con uno a la vista el otro no vale',
    entradas.every((e) => {
      const git = coherenteDe('gitlog', e)
      const terminal = coherenteDe('terminal', e)
      return (git === null || git === 'gitlog') && (terminal === null || terminal === 'terminal') && (git === null || terminal === null)
    }),
    '2304 combinaciones'
  )
  check(
    'es un punto fijo: corregir dos veces es corregir una (el hook la aplica en cada render)',
    entradas.every((e) => [null, ...PEDIBLES].every((p) => coherenteDe(coherenteDe(p, e), e) === coherenteDe(p, e))),
    '2304 combinaciones x 3 valores pedidos'
  )
}

/** (10b) El camino real en miniatura: el modo es GLOBAL y efímero; la franja es del PERFIL (`panelPorPerfil`). */
function caminoRealDeLaFranja(): void {
  const app = { pedida: null as PanelInferiorCentro | null, perfil: 'A', mosaico: false, vista: 'files' as VistaCentro }
  const panel: Record<string, PanelInferiorCentro | null> = { A: 'gitlog', B: 'terminal', C: null }
  const render = (): PanelInferiorCentro | null => {
    const e: EntradaLayoutCentro = {
      vista: app.vista,
      mosaico: app.mosaico,
      hayPestanasEditor: true,
      ccExpandido: false,
      ccOculto: false,
      vistaDividida: false,
      agenteDbVisible: false,
      espacioAbierto: false,
      hayPerfil: true,
      panelInferior: panel[app.perfil] ?? null
    }
    app.pedida = coherenteDe(app.pedida, e)
    return app.pedida
  }
  /** Pulsar el botón de maximizar del panel y que el hook corrija en el render siguiente. */
  const pulsar = (p: PanelInferiorCentro): PanelInferiorCentro | null => {
    app.pedida = p
    return render()
  }
  // El perfil que enseña cada panel y el que enseña el otro.
  const perfiles = { gitlog: { propio: 'A', ajeno: 'B' }, terminal: { propio: 'B', ajeno: 'A' } }
  for (const p of PEDIBLES) {
    const { propio, ajeno } = perfiles[p]
    const otro: PanelInferiorCentro = p === 'gitlog' ? 'terminal' : 'gitlog'
    app.perfil = propio
    const alPulsar = pulsar(p)
    // Cambiar de PROYECTO no toca ni la vista ni la franja del perfil: la entrada es la misma.
    const trasCambiarProyecto = render()
    app.perfil = ajeno
    const enElAjeno = render()
    app.perfil = propio
    const deVuelta = render()
    app.perfil = 'C'
    const sinFranja = pulsar(p)
    check(
      `${p}: pulsar la enciende; cambiar de proyecto la conserva; un perfil que enseña OTRO panel o ninguno la apaga y al volver el panel está en la franja`,
      alPulsar === p && trasCambiarProyecto === p && enElAjeno === null && deVuelta === null && sinFranja === null,
      j({ alPulsar, trasCambiarProyecto, enElAjeno, deVuelta, sinFranja })
    )

    panel[ajeno] = p
    app.perfil = propio
    pulsar(p)
    app.perfil = ajeno
    const enElQueTambien = render()
    panel[ajeno] = otro
    check(
      `${p}: pasar a un perfil que TAMBIÉN enseña ese panel la conserva (sigue al objetivo, como con el proyecto)`,
      enElQueTambien === p,
      j({ enElQueTambien })
    )

    // La X, el cambio de panel en el mismo perfil, el mosaico y la vista de datos: apagan y no resucitan.
    app.perfil = propio
    panel[propio] = p
    const encendidas: Array<PanelInferiorCentro | null> = []
    const apagadas: Array<PanelInferiorCentro | null> = []
    encendidas.push(pulsar(p))
    panel[propio] = null
    apagadas.push(render())
    panel[propio] = p
    apagadas.push(render())
    encendidas.push(pulsar(p))
    panel[propio] = otro
    apagadas.push(render())
    panel[propio] = p
    apagadas.push(render())
    encendidas.push(pulsar(p))
    app.mosaico = true
    apagadas.push(render())
    app.mosaico = false
    apagadas.push(render())
    encendidas.push(pulsar(p))
    app.vista = 'db'
    apagadas.push(render())
    app.vista = 'files'
    apagadas.push(render())
    check(
      `${p}: la X, cambiar de panel, el mosaico y la vista de datos la apagan, y al volver el panel está en la franja (no resucita)`,
      encendidas.every((v) => v === p) && apagadas.every((v) => v === null),
      j({ encendidas, apagadas })
    )
  }
}

/** (11) Las aperturas en el editor que pide Git·Log, dentro y fuera de pantalla completa. */
function aperturasDesdeGit(): void {
  hr('(11) Aperturas desde Git·Log y pantalla completa')
  const fueraManual = aperturaDesdeGit({ origen: 'manual', pantallaCompleta: false })
  const fueraAuto = aperturaDesdeGit({ origen: 'auto', pantallaCompleta: false })
  check(
    'fuera del modo TODO abre igual que antes y nada toca el modo (manual y auto)',
    fueraManual.abrir && !fueraManual.salirDePantallaCompleta && fueraAuto.abrir && !fueraAuto.salirDePantallaCompleta,
    j({ fueraManual, fueraAuto })
  )
  const dentroManual = aperturaDesdeGit({ origen: 'manual', pantallaCompleta: true })
  check(
    'a pantalla completa, el gesto explícito (clic/doble clic/Enter, historial, saltar al fuente) sale y abre',
    dentroManual.abrir && dentroManual.salirDePantallaCompleta,
    j(dentroManual)
  )
  const dentroAuto = aperturaDesdeGit({ origen: 'auto', pantallaCompleta: true })
  check(
    'NEGATIVO: a pantalla completa, la vista previa al moverse ni abre ni sale (ni colapsa el agente)',
    !dentroAuto.abrir && !dentroAuto.salirDePantallaCompleta,
    j(dentroAuto)
  )

  // Camino real en miniatura: el modo + las pestañas que abre el editor + el agente colapsado.
  const app = { modo: true, pestanas: [] as string[], agenteColapsado: false }
  const abrirDesdeGit = (origen: 'manual' | 'auto', diff: string): void => {
    const d = aperturaDesdeGit({ origen, pantallaCompleta: app.modo })
    if (d.salirDePantallaCompleta) app.modo = false
    if (!d.abrir) return
    app.pestanas.push(diff)
    app.agenteColapsado = true
  }
  abrirDesdeGit('auto', 'commit-1')
  abrirDesdeGit('auto', 'commit-2')
  const trasMoverse = { ...app, pestanas: [...app.pestanas] }
  // Restaurar con el botón no abre lo que se saltó: el token de la petición ya se consumió.
  app.modo = false
  const alRestaurar = { ...app, pestanas: [...app.pestanas] }
  check(
    'moverse por los commits a pantalla completa no deja nada: sigue el modo y al restaurar no hay pestañas ni colapso',
    trasMoverse.modo && trasMoverse.pestanas.length === 0 && !trasMoverse.agenteColapsado &&
      alRestaurar.pestanas.length === 0 && !alRestaurar.agenteColapsado,
    j({ trasMoverse, alRestaurar })
  )
  app.modo = true
  abrirDesdeGit('manual', 'archivo-a')
  const trasManual = { ...app, pestanas: [...app.pestanas] }
  abrirDesdeGit('auto', 'commit-3')
  check(
    'el clic en un archivo sale y abre; después, ya fuera, la vista previa vuelve a abrir como siempre',
    !trasManual.modo && j(trasManual.pestanas) === j(['archivo-a']) && j(app.pestanas) === j(['archivo-a', 'commit-3']),
    j({ trasManual, despues: app })
  )
}

/** Las 2304 entradas cruzadas con lo que decide el agente de la terminal: pantalla completa pedida, preferencia y abierto. */
function conAgenteTerminal(entradas: EntradaLayoutCentro[]): EntradaLayoutCentro[] {
  const out: EntradaLayoutCentro[] = []
  for (const e of entradas) {
    for (const pantallaCompletaPedida of [null, ...PEDIBLES]) {
      for (const agenteTerminalVisible of [false, true]) {
        for (const agenteTerminalAbierto of [false, true]) {
          out.push({ ...e, pantallaCompletaPedida, agenteTerminalVisible, agenteTerminalAbierto })
        }
      }
    }
  }
  return out
}

/** La misma entrada sin lo del agente de la terminal: la salida de antes de esta fase. */
function sinAgenteTerminal(e: EntradaLayoutCentro): EntradaLayoutCentro {
  const { pantallaCompletaPedida: _p, agenteTerminalVisible: _v, agenteTerminalAbierto: _a, ...resto } = e
  return resto
}

/** (12) El agente de la terminal: la columna es suya EXACTAMENTE con la terminal a pantalla completa. */
function agenteDeLaTerminal(entradas: EntradaLayoutCentro[]): void {
  hr('(12) El agente de la terminal, a la derecha de la terminal a pantalla completa')
  const todas = conAgenteTerminal(entradas)
  /** La terminal a pantalla completa (la coherente) con perfil: ahí el conmutador de la barra es del agente de la terminal. */
  const gobierna = (e: EntradaLayoutCentro): boolean => coherenteDe(e.pantallaCompletaPedida ?? null, e) === 'terminal' && e.hayPerfil
  const debe = (e: EntradaLayoutCentro): boolean =>
    gobierna(e) && e.agenteTerminalVisible === true && e.agenteTerminalAbierto === true
  const suyas = todas.filter((e) => derivarLayoutCentro(e).agente === 'terminal')
  check(
    "'terminal' EXACTAMENTE con la terminal a pantalla completa (la coherente) + perfil + pedido + abierto (2 vistas x 64 = 128)",
    suyas.length === 128 && todas.every((e) => (derivarLayoutCentro(e).agente === 'terminal') === debe(e)),
    `${suyas.length} de ${todas.length} combinaciones`
  )
  check(
    'entonces la columna se ve sin crecer ni maximizarse, con su divisor y el conmutador del agente de la terminal',
    suyas.every((e) => {
      const s = derivarLayoutCentro(e)
      return (
        j(s.cc) === j({ hidden: false, grow: false, canExpand: false }) &&
        s.divisorAgente === 'terminal' &&
        j(s.barraEstado) === j({ ccVisible: true, razonBloqueo: null, accion: 'agente-terminal' })
      )
    }),
    `${suyas.length} combinaciones`
  )
  check(
    'y el resto de campos (editor, área de BD y franja) no cambia: lo esconde el CSS sin desmontar nada',
    suyas.every((e) => {
      const s = derivarLayoutCentro(e)
      const antes = derivarLayoutCentro(sinAgenteTerminal(e))
      return s.editorOculto === antes.editorOculto && s.dbAreaOculta === antes.dbAreaOculta && j(s.franja) === j(antes.franja)
    }),
    'editorOculto, dbAreaOculta y franja iguales'
  )
  check(
    'NEGATIVO: nunca con Git·Log a pantalla completa, en la vista de BD ni en el mosaico',
    todas
      .filter((e) => e.pantallaCompletaPedida === 'gitlog' || e.vista === 'db' || e.mosaico)
      .every((e) => derivarLayoutCentro(e).agente !== 'terminal'),
    'ninguna'
  )
  check(
    'NEGATIVO: pedida la terminal pero con Git·Log en la franja (incoherente) tampoco',
    todas
      .filter((e) => e.pantallaCompletaPedida === 'terminal' && e.panelInferior !== 'terminal')
      .every((e) => derivarLayoutCentro(e).agente !== 'terminal'),
    'ninguna'
  )
  const delConmutador = todas.filter(gobierna)
  check(
    'el conmutador de la barra es del agente de la terminal EXACTAMENTE con la terminal a pantalla completa (la coherente) + perfil, lo tenga a la vista o no (2 vistas x 64 x 4 = 512)',
    delConmutador.length === 512 &&
      todas.every((e) => (derivarLayoutCentro(e).barraEstado.accion === 'agente-terminal') === gobierna(e)),
    `${delConmutador.length} de ${todas.length} combinaciones`
  )
  check(
    'ahí está pulsado EXACTAMENTE si el agente está pedido, y nunca bloqueado (ni sin archivo abierto ni en vista dividida)',
    delConmutador.every((e) => {
      const b = derivarLayoutCentro(e).barraEstado
      return b.ccVisible === (e.agenteTerminalVisible === true) && b.razonBloqueo === null
    }),
    `${delConmutador.length} combinaciones`
  )
  check(
    'con el agente oculto o preparándose solo cambia la barra: la columna, el divisor, el editor, el área de BD y la franja son los de siempre',
    delConmutador
      .filter((e) => !debe(e))
      .every((e) => {
        const { barraEstado: _b, ...ahora } = derivarLayoutCentro(e)
        const { barraEstado: _a, ...antes } = derivarLayoutCentro(sinAgenteTerminal(e))
        return j(ahora) === j(antes)
      }),
    `${delConmutador.length - suyas.length} combinaciones`
  )
  check(
    'NEGATIVO: fuera de ese caso (sin perfil, sin pantalla completa de la terminal, en db o en el mosaico; Git·Log a pantalla completa va aparte, en (12c)) las entradas nuevas no cambian NADA de la salida de antes',
    todas
      .filter((e) => !gobierna(e) && coherenteDe(e.pantallaCompletaPedida ?? null, e) !== 'gitlog')
      .every((e) => j(derivarLayoutCentro(e)) === j(derivarLayoutCentro(sinAgenteTerminal(e)))),
    'combinaciones idénticas'
  )
  check(
    'sin las entradas nuevas (lo de siempre) la columna nunca es del agente de la terminal',
    entradas.every((e) => derivarLayoutCentro(e).agente !== 'terminal'),
    '2304 combinaciones'
  )
  caminoRealDelAgenteTerminal()
  conmutadorConGitLogAPantallaCompleta(todas)
}

/** (12c) Con Git·Log a pantalla completa (la coherente) la columna está tapada: el conmutador se bloquea con su motivo. */
function conmutadorConGitLogAPantallaCompleta(todas: EntradaLayoutCentro[]): void {
  hr('(12c) Git·Log a pantalla completa: el conmutador de la barra, bloqueado con su motivo')
  const enGit = todas.filter((e) => coherenteDe(e.pantallaCompletaPedida ?? null, e) === 'gitlog')
  check(
    'con Git·Log a pantalla completa (la coherente) el conmutador queda bloqueado con RAZON_GITLOG_PANTALLA_COMPLETA, con y sin perfil',
    enGit.length > 0 &&
      enGit.every((e) => derivarLayoutCentro(e).barraEstado.razonBloqueo === RAZON_GITLOG_PANTALLA_COMPLETA) &&
      enGit.some((e) => e.hayPerfil) &&
      enGit.some((e) => !e.hayPerfil),
    `${enGit.length} combinaciones`
  )
  check(
    'el motivo dice que no hay columna del agente y cómo salir (Restaurar)',
    /no hay columna del agente/.test(RAZON_GITLOG_PANTALLA_COMPLETA) && /Restaurar/.test(RAZON_GITLOG_PANTALLA_COMPLETA),
    RAZON_GITLOG_PANTALLA_COMPLETA
  )
  check(
    'lo único que cambia respecto a no pedirla es el motivo: la acción del conmutador y el resto de la salida son los mismos',
    enGit.every((e) => {
      const { barraEstado: b, ...ahora } = derivarLayoutCentro(e)
      const { barraEstado: a, ...antes } = derivarLayoutCentro({ ...e, pantallaCompletaPedida: null })
      return j(ahora) === j(antes) && b.accion === a.accion && b.ccVisible === a.ccVisible
    }),
    'cc, divisor, editor, área de BD y franja iguales'
  )
  check(
    'NEGATIVO: Git·Log pedido pero incoherente (en db, en el mosaico o sin Git·Log en la franja) NO bloquea por esta razón',
    todas
      .filter((e) => e.pantallaCompletaPedida === 'gitlog' && coherenteDe('gitlog', e) !== 'gitlog')
      .every((e) => derivarLayoutCentro(e).barraEstado.razonBloqueo !== RAZON_GITLOG_PANTALLA_COMPLETA),
    'ninguna'
  )
  check(
    'NEGATIVO: ni la terminal a pantalla completa ni la franja normal se bloquean por esta razón',
    todas
      .filter((e) => coherenteDe(e.pantallaCompletaPedida ?? null, e) !== 'gitlog')
      .every((e) => derivarLayoutCentro(e).barraEstado.razonBloqueo !== RAZON_GITLOG_PANTALLA_COMPLETA),
    'ninguna'
  )
}

/** (12b) El camino real: salir de pantalla completa lo OCULTA sin tocar la preferencia, y volver lo enseña. */
function caminoRealDelAgenteTerminal(): void {
  const base: EntradaLayoutCentro = {
    vista: 'files',
    mosaico: false,
    hayPestanasEditor: true,
    ccExpandido: false,
    ccOculto: false,
    vistaDividida: false,
    agenteDbVisible: false,
    espacioAbierto: false,
    hayPerfil: true,
    panelInferior: 'terminal',
    pantallaCompletaPedida: 'terminal',
    agenteTerminalVisible: true,
    agenteTerminalAbierto: true
  }
  const agente = (cambios: Partial<EntradaLayoutCentro>): SalidaLayoutCentro['agente'] =>
    derivarLayoutCentro({ ...base, ...cambios }).agente
  const pasos = {
    aPantallaCompleta: agente({}),
    alRestaurar: agente({ pantallaCompletaPedida: null }),
    alVolver: agente({}),
    oculto: agente({ agenteTerminalVisible: false }),
    preparandose: agente({ agenteTerminalAbierto: false }),
    conGitLog: agente({ panelInferior: 'gitlog', pantallaCompletaPedida: 'gitlog' }),
    enElMosaico: agente({ mosaico: true }),
    sinPerfil: agente({ hayPerfil: false })
  }
  check(
    'a pantalla completa es suyo; al restaurar vuelve el del proyecto y al volver otra vez el suyo; oculto, preparándose, con Git·Log, en el mosaico o sin perfil, no',
    pasos.aPantallaCompleta === 'terminal' &&
      pasos.alRestaurar === 'proyecto' &&
      pasos.alVolver === 'terminal' &&
      pasos.oculto === 'proyecto' &&
      pasos.preparandose === 'proyecto' &&
      pasos.conGitLog === 'proyecto' &&
      pasos.enElMosaico === 'proyecto' &&
      pasos.sinPerfil === 'proyecto',
    j(pasos)
  )

  const barra = (cambios: Partial<EntradaLayoutCentro>): SalidaLayoutCentro['barraEstado'] =>
    derivarLayoutCentro({ ...base, ...cambios }).barraEstado
  const barras = {
    aPantallaCompleta: barra({}),
    alRestaurar: barra({ pantallaCompletaPedida: null }),
    alVolver: barra({}),
    oculto: barra({ agenteTerminalVisible: false }),
    ocultoSinArchivo: barra({ agenteTerminalVisible: false, hayPestanasEditor: false }),
    preparandose: barra({ agenteTerminalAbierto: false }),
    conGitLog: barra({ panelInferior: 'gitlog', pantallaCompletaPedida: 'gitlog' }),
    enElMosaico: barra({ mosaico: true }),
    sinPerfil: barra({ hayPerfil: false })
  }
  const delAgente = (b: SalidaLayoutCentro['barraEstado'], pulsado: boolean): boolean =>
    j(b) === j({ ccVisible: pulsado, razonBloqueo: null, accion: 'agente-terminal' })
  check(
    'a pantalla completa el conmutador es del agente de la terminal en los dos sentidos: pulsado a la vista y suelto oculto (también sin archivo abierto); preparándose, pulsado',
    delAgente(barras.aPantallaCompleta, true) &&
      delAgente(barras.alVolver, true) &&
      delAgente(barras.oculto, false) &&
      delAgente(barras.ocultoSinArchivo, false) &&
      delAgente(barras.preparandose, true),
    j(barras)
  )
  const deSiempre = [barras.alRestaurar, barras.conGitLog, barras.enElMosaico, barras.sinPerfil]
  check(
    'al restaurar, con Git·Log, en el mosaico o sin perfil el conmutador es el de siempre: el de la columna del proyecto',
    deSiempre.every((b) => b.accion === 'cc'),
    j(deSiempre)
  )

  // Cada pulsación hace lo de `alternar` (useAgenteTerminal): oculta si está pedido y, si no, lo prepara y lo
  // muestra. La barra tiene que seguirlo sin desfase, también la primera vez (cuando aún no está preparado).
  const modelo = { visible: false, abierto: false }
  const alternar = (): void => {
    if (modelo.visible) modelo.visible = false
    else Object.assign(modelo, { visible: true, abierto: true })
  }
  const verlo = (): { pulsado: boolean; accion: string; columna: SalidaLayoutCentro['agente'] } => {
    const cambios = { agenteTerminalVisible: modelo.visible, agenteTerminalAbierto: modelo.abierto }
    return { pulsado: barra(cambios).ccVisible, accion: barra(cambios).accion, columna: agente(cambios) }
  }
  const secuencia = [verlo()]
  for (let i = 0; i < 3; i++) {
    alternar()
    secuencia.push(verlo())
  }
  check(
    'pulsar el conmutador alterna mostrar y ocultar sin cambiar de acción: sin preparar (columna del proyecto, suelto), a la vista (la del agente, pulsado), oculto y a la vista otra vez',
    secuencia.every((v) => v.accion === 'agente-terminal') &&
      j(secuencia.map((v) => v.pulsado)) === j([false, true, false, true]) &&
      j(secuencia.map((v) => v.columna)) === j(['proyecto', 'terminal', 'proyecto', 'terminal']),
    j(secuencia)
  )
}

function main(): void {
  const entradas = todasLasEntradas()
  check('se recorren 3 x 256 x 3 = 2304 combinaciones', entradas.length === 2304, `${entradas.length}`)

  // -------------------------------------------------------------------------
  hr('(1) Nunca queda el centro vacío')
  const vacios = entradas.filter((e) => !centroOcupado(derivarLayoutCentro(e)))
  check(
    'NINGUNA de las 2304 combinaciones deja el centro vacío (sin excepciones)',
    vacios.length === 0,
    vacios.length === 0 ? '0 vacíos' : `${vacios.length} vacíos, p.ej. ${describir(vacios[0])}`
  )
  const huecosAntiguos = entradas.filter(esHuecoAntiguo)
  check(
    "el hueco antiguo de 'files'/'git' son 96 combinaciones y la fórmula antigua las dejaba TODAS vacías",
    huecosAntiguos.length === 96 && huecosAntiguos.every((e) => !centroOcupado(referenciaApp(e))),
    `${huecosAntiguos.length} combinaciones; la referencia las deja vacías (el test lo habría visto)`
  )
  check(
    'y fuera de esas 96, la fórmula antigua no dejaba NINGUNA vacía en files/git',
    entradas.filter((e) => e.vista !== 'db' && !esHuecoAntiguo(e)).every((e) => centroOcupado(referenciaApp(e))),
    '1440 combinaciones'
  )
  check(
    'en el hueco antiguo, OCULTO MANDA: se ve el editor, la columna sigue oculta y no crece',
    huecosAntiguos.every((e) => {
      const s = derivarLayoutCentro(e)
      return !s.editorOculto && s.dbAreaOculta && s.cc.hidden && !s.cc.grow && s.divisorAgente === null && !s.barraEstado.ccVisible
    }),
    'editor visible, columna oculta, sin divisor, la barra dice «oculta»'
  )
  const alcanzable: EntradaLayoutCentro = {
    vista: 'files',
    mosaico: false,
    hayPestanasEditor: true,
    ccExpandido: true, // maximizado en el proyecto de antes
    ccOculto: true, // el archivo activo del nuevo está en vista dividida
    vistaDividida: true,
    agenteDbVisible: false,
    espacioAbierto: false,
    hayPerfil: true,
    panelInferior: null
  }
  const sAlcanzable = derivarLayoutCentro(alcanzable)
  check(
    'el camino que App no evitaba (maximizado + pasar a un proyecto con vista dividida): el editor, con la razón de la vista dividida',
    !sAlcanzable.editorOculto && sAlcanzable.cc.hidden && sAlcanzable.barraEstado.razonBloqueo !== null,
    j({ editorOculto: sAlcanzable.editorOculto, cc: sAlcanzable.cc, barra: sAlcanzable.barraEstado })
  )
  check(
    'NEGATIVO: maximizado SIN ocultar sigue escondiendo el editor (el maximizado de siempre)',
    (() => {
      const s = derivarLayoutCentro({ ...alcanzable, ccOculto: false, vistaDividida: false })
      return s.editorOculto && !s.cc.hidden && s.cc.grow
    })(),
    'editorOculto=true, columna visible creciendo'
  )
  check(
    "'db' no tiene NINGÚN hueco, ni siquiera con el agente maximizado y oculto",
    entradas.filter((e) => e.vista === 'db').every((e) => centroOcupado(derivarLayoutCentro(e))),
    '768 combinaciones de db'
  )

  // -------------------------------------------------------------------------
  hr("(2) Paridad literal de 'files' y 'git' con App.tsx")
  let comparadas = 0
  const distintas: string[] = []
  let enHueco = 0
  const huecoMal: string[] = []
  for (const e of entradas) {
    if (e.vista === 'db') continue
    const nuevo = proyectar(derivarLayoutCentro(e)) as { editorOculto: boolean; cc: { grow: boolean } }
    const antes = proyectarRef(referenciaApp(e)) as { editorOculto: boolean; cc: { grow: boolean } }
    if (esHuecoAntiguo(e)) {
      // La desviación a sabiendas: SOLO editorOculto y cc.grow, y de true a false.
      enHueco++
      const esperado = { ...antes, editorOculto: false, cc: { ...antes.cc, grow: false } }
      const bien = antes.editorOculto && antes.cc.grow && j(nuevo) === j(esperado)
      if (!bien) huecoMal.push(`${describir(e)}\n        nuevo: ${j(nuevo)}\n        antes: ${j(antes)}`)
      continue
    }
    comparadas++
    const a = j(nuevo)
    const b = j(antes)
    if (a !== b) distintas.push(`${describir(e)}\n        nuevo: ${a}\n        antes: ${b}`)
  }
  check(
    'files/git: salida idéntica a la fórmula antigua en las 1440 combinaciones fuera del hueco',
    comparadas === 1440 && distintas.length === 0,
    distintas.length === 0 ? `${comparadas} iguales` : `${distintas.length} distintas; la primera: ${distintas[0]}`
  )
  check(
    'files/git: en las 96 del hueco solo cambian editorOculto y cc.grow (de true a false); todo lo demás igual',
    enHueco === 96 && huecoMal.length === 0,
    huecoMal.length === 0 ? `${enHueco} con la diferencia exacta` : `${huecoMal.length} mal; la primera: ${huecoMal[0]}`
  )
  check(
    "files/git: el área de BD siempre oculta",
    entradas.filter((e) => e.vista !== 'db').every((e) => derivarLayoutCentro(e).dbAreaOculta),
    'dbAreaOculta=true'
  )
  check(
    "files/git: las entradas propias de 'db' no cambian nada",
    entradas
      .filter((e) => e.vista !== 'db')
      .every((e) => {
        const base = j(derivarLayoutCentro({ ...e, agenteDbVisible: false, espacioAbierto: false, hayPerfil: true }))
        return j(derivarLayoutCentro(e)) === base
      }),
    'agenteDbVisible/espacioAbierto/hayPerfil son irrelevantes fuera de db'
  )

  // -------------------------------------------------------------------------
  hr("(3) 'db' por defecto: agente oculto")
  const base: EntradaLayoutCentro = {
    vista: 'db',
    mosaico: false,
    hayPestanasEditor: false,
    ccExpandido: false,
    ccOculto: false,
    vistaDividida: false,
    agenteDbVisible: false,
    espacioAbierto: false,
    hayPerfil: true,
    panelInferior: null
  }
  const def = derivarLayoutCentro(base)
  check(
    'db por defecto: área de BD visible, editor oculto, columna oculta, sin divisor ni target',
    !def.dbAreaOculta &&
      def.editorOculto &&
      def.cc.hidden &&
      !def.cc.grow &&
      def.divisorAgente === null &&
      def.agente === null,
    j(def)
  )
  check(
    'db por defecto: el conmutador de la barra se puede pulsar y es el del agente de datos',
    def.barraEstado.razonBloqueo === null && def.barraEstado.accion === 'agente-db' && !def.barraEstado.ccVisible,
    j(def.barraEstado)
  )
  const sinPedir = entradas.filter((e) => e.vista === 'db' && !e.mosaico && !e.agenteDbVisible)
  check(
    'db sin pedir el agente: oculto en TODAS las combinaciones (pestañas, pestillo, espacio…)',
    sinPedir.every((e) => {
      const s = derivarLayoutCentro(e)
      return s.cc.hidden && s.divisorAgente === null && s.agente === null && !s.barraEstado.ccVisible
    }),
    `${sinPedir.length} combinaciones`
  )
  const sinPerfil = derivarLayoutCentro({ ...base, hayPerfil: false, agenteDbVisible: true, espacioAbierto: true })
  check(
    'db sin perfil: conmutador bloqueado con su razón y agente oculto',
    sinPerfil.barraEstado.razonBloqueo === RAZON_SIN_PERFIL_DB && sinPerfil.cc.hidden && sinPerfil.agente === null,
    j(sinPerfil.barraEstado)
  )
  check(
    'db: nunca se puede maximizar el agente (canExpand=false)',
    entradas.filter((e) => e.vista === 'db').every((e) => !derivarLayoutCentro(e).cc.canExpand),
    'canExpand=false'
  )

  // -------------------------------------------------------------------------
  hr("(4) 'db' con el agente pedido")
  const pedidoNoListo = derivarLayoutCentro({ ...base, agenteDbVisible: true, espacioAbierto: false })
  check(
    'pedido pero el espacio no está listo: sigue oculto (sin columna vacía ni parpadeo)',
    pedidoNoListo.cc.hidden && pedidoNoListo.divisorAgente === null && pedidoNoListo.agente === null,
    j(pedidoNoListo)
  )
  const listo = derivarLayoutCentro({ ...base, agenteDbVisible: true, espacioAbierto: true })
  check(
    'pedido y listo: columna visible, divisor db, target del espacio, crece el área de BD',
    !listo.cc.hidden &&
      !listo.cc.grow &&
      listo.divisorAgente === 'db' &&
      listo.agente === 'espacio' &&
      !listo.dbAreaOculta &&
      listo.barraEstado.ccVisible,
    j(listo)
  )
  const dbNoMosaico = entradas.filter((e) => e.vista === 'db' && !e.mosaico)
  check(
    'db: el divisor db aparece SI Y SOLO SI el agente está listo (perfil + pedido + espacio)',
    dbNoMosaico.every((e) => {
      const s = derivarLayoutCentro(e)
      const listoDb = e.hayPerfil && e.agenteDbVisible && e.espacioAbierto
      return (s.divisorAgente === 'db') === listoDb && s.cc.hidden === !listoDb && (s.agente === 'espacio') === listoDb
    }),
    `${dbNoMosaico.length} combinaciones`
  )
  check(
    'db: el pestillo, la vista dividida y el maximizado del proyecto NO afectan al agente de datos',
    dbNoMosaico.every((e) => {
      const neutro = derivarLayoutCentro({ ...e, ccOculto: false, vistaDividida: false, ccExpandido: false, hayPestanasEditor: false })
      return j(derivarLayoutCentro(e)) === j(neutro)
    }),
    'solo cuentan perfil, preferencia y espacio'
  )

  // -------------------------------------------------------------------------
  hr('(5) El bug de la vista antigua')
  const bug: EntradaLayoutCentro = {
    ...base,
    hayPestanasEditor: true,
    ccOculto: true,
    espacioAbierto: true,
    agenteDbVisible: false
  }
  check(
    'la fórmula ANTIGUA dejaba el centro vacío en este caso (el test lo habría visto)',
    !centroOcupado(referenciaApp(bug)),
    j(referenciaApp(bug))
  )
  const arreglado = derivarLayoutCentro(bug)
  check(
    'ahora el centro es el área de BD',
    centroOcupado(arreglado) && !arreglado.dbAreaOculta,
    j({ dbAreaOculta: arreglado.dbAreaOculta, cc: arreglado.cc })
  )

  // -------------------------------------------------------------------------
  hr("(6) Franja inferior apagada en 'db'")
  check(
    'db: ni divisor, ni Git·Log, ni terminal, con cualquier panel guardado',
    entradas
      .filter((e) => e.vista === 'db')
      .every((e) => {
        const f = derivarLayoutCentro(e).franja
        return !f.divisor && !f.gitlog && !f.terminalVisible
      }),
    '768 combinaciones'
  )
  const filesTerminal = derivarLayoutCentro({ ...base, vista: 'files', panelInferior: 'terminal' })
  const gitLog = derivarLayoutCentro({ ...base, vista: 'git', panelInferior: 'gitlog' })
  check(
    'files/git: la franja sigue funcionando',
    filesTerminal.franja.terminalVisible && filesTerminal.franja.divisor && gitLog.franja.gitlog && gitLog.franja.divisor,
    j({ filesTerminal: filesTerminal.franja, gitLog: gitLog.franja })
  )

  // -------------------------------------------------------------------------
  hr('(7) Mosaico')
  const enMosaico = entradas.filter((e) => e.mosaico)
  check(
    'mosaico (cualquier vista): editor y área de BD ocultos, columna visible y creciendo, sin divisor',
    enMosaico.every((e) => {
      const s = derivarLayoutCentro(e)
      return s.editorOculto && s.dbAreaOculta && !s.cc.hidden && s.cc.grow && s.divisorAgente === null && !s.franja.divisor
    }),
    `${enMosaico.length} combinaciones`
  )
  check(
    'mosaico: conmutador bloqueado con la razón del mosaico y el agente es el del PROYECTO',
    enMosaico.every((e) => {
      const s = derivarLayoutCentro(e)
      return s.barraEstado.razonBloqueo === RAZON_MOSAICO && s.barraEstado.ccVisible && s.agente === 'proyecto'
    }),
    'también entrando desde db'
  )
  const salirDelMosaico = derivarLayoutCentro({ ...base, agenteDbVisible: true, espacioAbierto: true })
  const dentroDelMosaico = derivarLayoutCentro({ ...base, agenteDbVisible: true, espacioAbierto: true, mosaico: true })
  check(
    'mosaico desde db: al salir, el estado es el de antes (depende solo de la entrada)',
    dentroDelMosaico.agente === 'proyecto' && salirDelMosaico.agente === 'espacio' && salirDelMosaico.divisorAgente === 'db',
    j({ dentro: dentroDelMosaico.agente, fuera: salirDelMosaico.agente })
  )

  // -------------------------------------------------------------------------
  hr('(8) Coherencia interna')
  const incoherentes = entradas.filter((e) => {
    const s = derivarLayoutCentro(e)
    if (s.divisorAgente !== null && s.cc.hidden) return true // divisor junto a una columna oculta
    if (s.divisorAgente === 'editor' && s.editorOculto) return true // divisor sin grower al otro lado
    if (s.divisorAgente === 'db' && s.dbAreaOculta) return true
    if (s.divisorAgente === 'db' && e.vista !== 'db') return true
    if (s.divisorAgente === 'editor' && e.vista === 'db') return true
    if (s.barraEstado.ccVisible !== (e.mosaico || !s.cc.hidden)) return true
    if (!s.editorOculto && !s.dbAreaOculta) return true // dos centros a la vez
    if (!s.cc.hidden && s.cc.grow && (!s.editorOculto || !s.dbAreaOculta)) return true // dos growers
    return false
  })
  check(
    'divisor solo con columna visible y grower al otro lado; un solo centro; un solo grower',
    incoherentes.length === 0,
    incoherentes.length === 0 ? '0 incoherentes' : `${incoherentes.length}, p.ej. ${describir(incoherentes[0])}`
  )
  check(
    'la función es pura: misma entrada, misma salida, y no muta la entrada',
    (() => {
      const e = { ...base, agenteDbVisible: true, espacioAbierto: true }
      const antes = j(e)
      const a = j(derivarLayoutCentro(e))
      const b = j(derivarLayoutCentro(e))
      return a === b && j(e) === antes
    })(),
    'ok'
  )

  // -------------------------------------------------------------------------
  hr('(9) El origen: ocultar cancela el maximizado')
  const coherente = (e: EntradaLayoutCentro): EntradaLayoutCentro => ({ ...e, ccExpandido: maximizadoCoherente(e) })
  const cambian = entradas.filter((e) => maximizadoCoherente(e) !== e.ccExpandido)
  check(
    'solo cambia con maximizado + oculto + pestañas (3 vistas x 3 franjas x 32 = 288), y siempre de true a false',
    cambian.length === 288 &&
      cambian.every((e) => e.ccExpandido && e.ccOculto && e.hayPestanasEditor && !maximizadoCoherente(e)),
    cambian.length === 288 ? '288 combinaciones, todas true -> false' : `${cambian.length}, p.ej. ${describir(cambian[0])}`
  )
  check(
    'NEGATIVO: nunca enciende el maximizado, ni lo apaga con la columna a la vista o sin pestañas',
    entradas.every((e) =>
      !e.ccExpandido ? !maximizadoCoherente(e) : !(e.ccOculto && e.hayPestanasEditor) ? maximizadoCoherente(e) : true
    ),
    'sin maximizar -> false; maximizado sin oculto efectivo -> se queda'
  )
  check(
    'es un punto fijo: aplicarla dos veces es aplicarla una (App la llama en cada render sin bucle)',
    entradas.every((e) => maximizadoCoherente(coherente(e)) === maximizadoCoherente(e)),
    '2304 combinaciones'
  )
  const filesGit = entradas.filter((e) => e.vista !== 'db')
  const paridadCoherente = filesGit.filter((e) => {
    const c = coherente(e)
    return j(proyectar(derivarLayoutCentro(c))) !== j(proyectarRef(referenciaApp(c)))
  })
  check(
    'con la entrada ya coherente (lo que App pinta), la paridad con la fórmula antigua es TOTAL en files/git',
    paridadCoherente.length === 0,
    paridadCoherente.length === 0
      ? `${filesGit.length} iguales, sin excepciones`
      : `${paridadCoherente.length} distintas, p.ej. ${describir(paridadCoherente[0])}`
  )
  check(
    'y con ella ni la fórmula antigua deja el centro vacío: el hueco solo existía con la entrada incoherente',
    filesGit.every((e) => centroOcupado(referenciaApp(coherente(e)))),
    `${filesGit.length} combinaciones`
  )
  check(
    'la defensa y el origen dicen lo mismo: derivar de la entrada incoherente = derivar de la corregida',
    entradas.every((e) => j(derivarLayoutCentro(e)) === j(derivarLayoutCentro(coherente(e)))),
    '2304 combinaciones'
  )

  // App en miniatura: `ccExpanded` es de la ventana; el pestillo también; la vista
  // dividida es del archivo activo del proyecto activo. `render` hace lo que App: si
  // `conArreglo`, corrige el estado con `maximizadoCoherente` antes de derivar (el
  // ajuste durante el render); si no, deriva con el estado tal cual (solo la defensa).
  type ModoSim = 'codigo' | 'dividida'
  interface ProyectoSim {
    pestanas: Record<string, ModoSim>
    activa: string | null
  }
  interface AppSim {
    proyectos: Record<string, ProyectoSim>
    activo: string
    ccExpanded: boolean
    pestillo: boolean
  }
  const render = (s: AppSim, conArreglo: boolean): SalidaLayoutCentro => {
    const p = s.proyectos[s.activo]
    const hay = Object.keys(p.pestanas).length > 0
    const dividida = p.activa !== null && p.pestanas[p.activa] === 'dividida'
    const ccHidden = s.pestillo || dividida
    if (conArreglo) {
      const c = maximizadoCoherente({ ccExpandido: s.ccExpanded, ccOculto: ccHidden, hayPestanasEditor: hay })
      if (c !== s.ccExpanded) s.ccExpanded = c
    }
    return derivarLayoutCentro({
      vista: 'files',
      mosaico: false,
      hayPestanasEditor: hay,
      ccExpandido: s.ccExpanded,
      ccOculto: ccHidden,
      vistaDividida: dividida,
      agenteDbVisible: false,
      espacioAbierto: false,
      hayPerfil: true,
      panelInferior: null
    })
  }
  const nuevaApp = (): AppSim => ({
    proyectos: {
      A: { pestanas: { 'a.ts': 'codigo' }, activa: 'a.ts' },
      B: { pestanas: { 'LEEME.md': 'dividida', 'b.ts': 'codigo' }, activa: 'LEEME.md' },
      C: { pestanas: { 'c.ts': 'codigo' }, activa: 'c.ts' }
    },
    activo: 'A',
    ccExpanded: false,
    pestillo: false
  })
  /** El editor normal: a la vista, con la columna al lado y su divisor. */
  const editorNormal = (s: SalidaLayoutCentro): boolean =>
    !s.editorOculto && !s.cc.hidden && !s.cc.grow && s.divisorAgente === 'editor'
  /** El agente maximizado de siempre: editor escondido, columna creciendo. */
  const maximizado = (s: SalidaLayoutCentro): boolean => s.editorOculto && !s.cc.hidden && s.cc.grow

  // Camino 1: maximizar en A, pasar a B (dividido), clic en otra pestaña de B.
  const recorrerCamino1 = (conArreglo: boolean): { pasos: SalidaLayoutCentro[]; app: AppSim } => {
    const app = nuevaApp()
    const pasos: SalidaLayoutCentro[] = []
    app.ccExpanded = true // botón de maximizar en la cabecera del agente, en A
    pasos.push(render(app, conArreglo))
    app.activo = 'B' // pestaña de proyecto B: su archivo activo está en vista dividida
    pasos.push(render(app, conArreglo))
    app.proyectos.B.activa = 'b.ts' // clic en otra pestaña del editor de B
    pasos.push(render(app, conArreglo))
    app.activo = 'A' // de vuelta al proyecto donde se maximizó
    pasos.push(render(app, conArreglo))
    return { pasos, app }
  }
  const sinArreglo = recorrerCamino1(false).pasos
  check(
    'SIN el arreglo de origen (solo la defensa), el clic en otra pestaña de B escondía el editor (el test lo habría visto)',
    maximizado(sinArreglo[0]) && !sinArreglo[1].editorOculto && sinArreglo[2].editorOculto,
    j({ clic: { editorOculto: sinArreglo[2].editorOculto, cc: sinArreglo[2].cc } })
  )
  const conArreglo = recorrerCamino1(true)
  const [p0, p1, p2, p3] = conArreglo.pasos
  check(
    'camino 1, paso 1: maximizar en A es el maximizado de siempre',
    maximizado(p0),
    j({ editorOculto: p0.editorOculto, cc: p0.cc })
  )
  check(
    'camino 1, paso 2: al pasar a B (dividido) se ve el editor, la columna oculta y el maximizado queda CANCELADO',
    !p1.editorOculto && p1.cc.hidden && !p1.cc.grow && p1.barraEstado.razonBloqueo !== null,
    j({ editorOculto: p1.editorOculto, cc: p1.cc })
  )
  check(
    'camino 1, paso 3: el clic en otra pestaña de B deja el editor a la vista, con la columna al lado',
    editorNormal(p2),
    j({ editorOculto: p2.editorOculto, cc: p2.cc, divisor: p2.divisorAgente })
  )
  check(
    'camino 1, paso 4 (el precio, a sabiendas): al volver a A el agente ya no está maximizado, como tras ocultarlo a mano',
    editorNormal(p3) && !conArreglo.app.ccExpanded,
    j({ editorOculto: p3.editorOculto, ccExpanded: conArreglo.app.ccExpanded })
  )

  // Camino 2: la otra forma de quitar la dividida — pasar el archivo a Código.
  {
    const app = nuevaApp()
    app.ccExpanded = true
    render(app, true)
    app.activo = 'B'
    render(app, true)
    app.proyectos.B.pestanas['LEEME.md'] = 'codigo' // modo del archivo, en la cabecera del editor
    const s = render(app, true)
    const appSin = nuevaApp()
    appSin.ccExpanded = true
    render(appSin, false)
    appSin.activo = 'B'
    render(appSin, false)
    appSin.proyectos.B.pestanas['LEEME.md'] = 'codigo'
    const sSin = render(appSin, false)
    check(
      'camino 2: pasar el archivo dividido a Código deja el editor a la vista (sin el arreglo, desaparecía)',
      editorNormal(s) && sSin.editorOculto,
      j({ con: { editorOculto: s.editorOculto, cc: s.cc }, sin: { editorOculto: sSin.editorOculto } })
    )
  }

  // Camino 3, dentro del MISMO proyecto: con A maximizado se cierra su pestaña activa
  // desde fuera del editor (descartar en Cambios un archivo nuevo abierto) y la que
  // queda activa está dividida.
  {
    const app = nuevaApp()
    app.proyectos.A = { pestanas: { 'nuevo.ts': 'codigo', 'NOTAS.md': 'dividida', 'x.ts': 'codigo' }, activa: 'nuevo.ts' }
    app.ccExpanded = true
    const antes = render(app, true)
    delete app.proyectos.A.pestanas['nuevo.ts']
    app.proyectos.A.activa = 'NOTAS.md'
    const trasCerrar = render(app, true)
    app.proyectos.A.activa = 'x.ts'
    const trasClic = render(app, true)
    check(
      'camino 3 (mismo proyecto): cerrar la activa y caer en una dividida cancela el maximizado; el clic siguiente no lo resucita',
      maximizado(antes) && !trasCerrar.editorOculto && trasCerrar.cc.hidden && editorNormal(trasClic),
      j({ trasCerrar: { editorOculto: trasCerrar.editorOculto, cc: trasCerrar.cc }, trasClic: trasClic.cc })
    )
  }

  // NEGATIVO: sin pasar por una dividida, el maximizado sigue siendo de la ventana.
  {
    const app = nuevaApp()
    app.ccExpanded = true
    render(app, true)
    app.activo = 'C'
    const enC = render(app, true)
    app.activo = 'A'
    const deVuelta = render(app, true)
    check(
      'NEGATIVO: maximizar en A y pasar a C (sin dividir) sigue maximizado, y al volver a A también (lo de siempre)',
      maximizado(enC) && maximizado(deVuelta) && app.ccExpanded,
      j({ enC: enC.cc, deVuelta: deVuelta.cc })
    )
  }

  reglaDeLaFranja(entradas)
  caminoRealDeLaFranja()
  aperturasDesdeGit()
  agenteDeLaTerminal(entradas)

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
