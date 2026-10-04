#!/usr/bin/env node
// =============================================================================
// Prueba de layoutCentro (npm run test:layout-centro).
// Recorre las 2304 combinaciones de entrada y fija que nunca queda el centro vacío,
// la paridad de 'files' y 'git' con las fórmulas de referencia (copiadas abajo) salvo
// «oculto manda sobre maximizado», el comportamiento de 'db' y del mosaico, la franja
// inferior, la coherencia de divisores, `maximizadoCoherente` (con el camino real
// simulado paso a paso), Git·Log a pantalla completa y qué hacen ahí las aperturas en el
// editor (`aperturaDesdeGit`). Depende solo de `layoutCentro.ts`.
// Decisiones: docs/decisiones/layout/oculto-manda-sobre-maximizado.md
// =============================================================================

import {
  RAZON_MOSAICO,
  RAZON_SIN_PERFIL_DB,
  aperturaDesdeGit,
  derivarLayoutCentro,
  maximizadoCoherente,
  pantallaCompletaGitCoherente,
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

/** El modo pedido + la entrada, ya corregido como lo hace `usePantallaCompletaGit`. */
function coherenteDe(pedida: boolean, e: EntradaLayoutCentro): boolean {
  return pantallaCompletaGitCoherente({ pedida, franja: derivarLayoutCentro(e).franja, mosaico: e.mosaico })
}

/** (10) Git·Log a pantalla completa: la regla en todas las combinaciones y el camino real. */
function pantallaCompletaGit(entradas: EntradaLayoutCentro[]): void {
  hr('(10) Git·Log a pantalla completa')
  check(
    'vale EXACTAMENTE con pedida + Git·Log en la franja + fuera de db + sin mosaico (2 vistas x 128 = 256)',
    entradas.filter((e) => coherenteDe(true, e)).length === 256 &&
      entradas.every(
        (e) => coherenteDe(true, e) === (e.vista !== 'db' && e.panelInferior === 'gitlog' && !e.mosaico)
      ),
    `${entradas.filter((e) => coherenteDe(true, e)).length} combinaciones`
  )
  check(
    'NEGATIVO: nunca se enciende sola, ni con terminal, ni sin franja, ni en db, ni en el mosaico',
    entradas.every((e) => !coherenteDe(false, e)) &&
      entradas
        .filter((e) => e.vista === 'db' || e.mosaico || e.panelInferior !== 'gitlog')
        .every((e) => !coherenteDe(true, e)),
    '2304 combinaciones sin pedirla y todas las que no enseñan Git·Log'
  )
  check(
    'es un punto fijo: corregir dos veces es corregir una (el hook la aplica en cada render)',
    entradas.every((e) => coherenteDe(coherenteDe(true, e), e) === coherenteDe(true, e)),
    '2304 combinaciones'
  )

  // App en miniatura: el modo es GLOBAL y efímero; la franja es del PERFIL (`panelPorPerfil`).
  const app = { pedida: false, perfil: 'A', mosaico: false, vista: 'files' as VistaCentro }
  const panel: Record<string, PanelInferiorCentro | null> = { A: 'gitlog', B: 'terminal' }
  const render = (): boolean => {
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
  app.pedida = true
  const alPulsar = render()
  // Cambiar de PROYECTO no toca ni la vista ni la franja del perfil: la entrada es la misma.
  const trasCambiarProyecto = render()
  app.perfil = 'B'
  const enB = render()
  app.perfil = 'A'
  const deVueltaEnA = render()
  check(
    'pulsar la enciende; cambiar de proyecto la conserva; un perfil sin Git·Log la apaga y al volver Git está en la franja',
    alPulsar && trasCambiarProyecto && !enB && !deVueltaEnA,
    j({ alPulsar, trasCambiarProyecto, enB, deVueltaEnA })
  )
  panel.B = 'gitlog'
  app.pedida = true
  render()
  app.perfil = 'B'
  const enBConGit = render()
  check(
    'pasar a un perfil que TAMBIÉN enseña Git·Log la conserva (Git sigue al objetivo, como con el proyecto)',
    enBConGit,
    j({ enBConGit })
  )
  panel.B = null
  const trasCerrar = render()
  panel.B = 'gitlog'
  const alReabrir = render()
  app.pedida = true
  render()
  app.mosaico = true
  const enMosaico = render()
  app.mosaico = false
  const trasMosaico = render()
  app.pedida = true
  render()
  app.vista = 'db'
  const enDb = render()
  app.vista = 'files'
  const trasDb = render()
  check(
    'la X, el mosaico y la vista de datos la apagan, y Git vuelve en la franja (no resucita el modo)',
    !trasCerrar && !alReabrir && !enMosaico && !trasMosaico && !enDb && !trasDb,
    j({ trasCerrar, alReabrir, enMosaico, trasMosaico, enDb, trasDb })
  )
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

  pantallaCompletaGit(entradas)
  aperturasDesdeGit()

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
