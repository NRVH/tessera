#!/usr/bin/env node
// =============================================================================
// Prueba de decidirVistaBotonAgentes y textoAccion: cuándo se ve el botón de los
// agentes nativos, qué punto lleva y qué dice (V1-V17, V9b).
// (node src/renderer/src/features/agentes/test-vista-boton-agentes.mts)
// Ningún punto en un botón invisible, rojo pegajoso y verde que se retira, nada sin
// proyecto nativo ni con un resumen abortado; el sistema sólo se nombra con `nombres`
// (centinelas y los reales de las dos plataformas).
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import type { EstadoAgentesNativos, EstadoCli, SesionNativa } from '../../../../shared/agentes-nativos-ipc.ts'
import { nombresSistema, type NombresSistema } from '../../../../shared/nombresSistema.ts'
import { planificar } from './actualizacionNativa.ts'
import type { FaseActualizacion, ResumenActualizacion } from './tipos.ts'
import {
  decidirVistaBotonAgentes,
  textoAccion,
  type EntradaVistaBotonAgentes,
  type VistaBotonAgentes
} from './vistaBotonAgentes.ts'

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
// Fixtures
// ---------------------------------------------------------------------------
const CENTINELA: NombresSistema = {
  sistema: 'SISTEMA-CENTINELA',
  tuEquipo: 'EQUIPO-CENTINELA',
  gestorArchivos: 'GESTOR-CENTINELA',
  shellNativa: 'SHELL-CENTINELA',
  almacenSecretos: 'ALMACEN-CENTINELA'
}
/** Lo que no puede aparecer escrito a mano (con nombres centinela, no aparece nunca). */
const PROHIBIDOS = ['Windows', 'macOS', 'Mac', 'PowerShell', 'Finder', 'Explorador']

function cli(agente: AgentKind, extra: Partial<EstadoCli> = {}): EstadoCli {
  return {
    agente,
    instalada: '1.0.0',
    ultima: '1.0.0',
    canal: null,
    metodo: 'npm',
    instalable: true,
    requiereParar: false,
    ordenManual: null,
    hayNueva: false,
    bloqueadores: [],
    error: null,
    comprobadoEn: 0,
    ...extra
  }
}
function sesion(sessionId: string, agente: AgentKind, extra: Partial<SesionNativa> = {}): SesionNativa {
  return {
    sessionId,
    profileId: 'perfil',
    projectHostPath: 'C:/p',
    agente,
    versionLanzada: '1.0.0',
    atrasada: false,
    trabajando: false,
    esperandoRespuesta: false,
    puedeTenerTextoSinEnviar: false,
    ...extra
  }
}
function estado(extra: Partial<EstadoAgentesNativos> = {}): EstadoAgentesNativos {
  return { plataforma: 'windows', claude: cli('claude-code'), codex: cli('codex'), sesiones: [], instalando: null, ...extra }
}

const AL_DIA = estado({ sesiones: [sesion('k1', 'claude-code')] })
const CODEX_NUEVO = estado({
  codex: cli('codex', { instalada: '0.156.0', ultima: '0.156.1', hayNueva: true, requiereParar: true }),
  sesiones: [sesion('c1', 'codex'), sesion('c2', 'codex')]
})
const ATRASADA = estado({ sesiones: [sesion('k1', 'claude-code', { versionLanzada: '2.1.280', atrasada: true })] })
const MANUAL = estado({
  codex: cli('codex', { instalada: '0.156.0', ultima: '0.157.0', hayNueva: true, instalable: false, ordenManual: 'x' })
})

const RESUMEN_OK: ResumenActualizacion = {
  ok: true,
  abortado: null,
  instalaciones: [{ ok: true, agente: 'codex', antes: '0.156.0', despues: '0.156.1', detenidas: ['c1'] }],
  sesiones: [{ sessionId: 'c1', agente: 'codex', profileId: 'perfil', projectHostPath: 'C:/p', resultado: 'relanzada' }]
}
const RESUMEN_ERROR: ResumenActualizacion = {
  ok: false,
  abortado: null,
  instalaciones: [{ ok: false, agente: 'codex', antes: '0.156.0', despues: '0.156.0', motivo: 'fallo', detenidas: ['c1'] }],
  sesiones: [{ sessionId: 'c1', agente: 'codex', profileId: 'perfil', projectHostPath: 'C:/p', resultado: 'fallo', motivo: 'x' }]
}
const RESUMEN_ABORTADO: ResumenActualizacion = { ok: false, abortado: 'Espera: 1 agente trabajando', instalaciones: [], sesiones: [] }

function entrada(extra: Partial<EntradaVistaBotonAgentes> = {}): EntradaVistaBotonAgentes {
  return {
    estado: AL_DIA,
    plan: null,
    enCurso: null,
    resumen: null,
    resumenVisto: false,
    hayProyectoNativo: true,
    nombres: CENTINELA,
    ...extra
  }
}
function fmt(v: VistaBotonAgentes): string {
  return `visible=${v.visible} punto=${v.punto} anillo=${v.anillo} etiqueta=${JSON.stringify(v.etiqueta)}`
}

/** Todas las combinaciones que importan, para las invariantes. */
function combinaciones(nombres: NombresSistema): EntradaVistaBotonAgentes[] {
  const estados: Array<EstadoAgentesNativos | null> = [null, AL_DIA, CODEX_NUEVO, ATRASADA, MANUAL]
  const fases: Array<FaseActualizacion | null> = [null, 'comprobando', 'instalando', 'deteniendo', 'relanzando', 'terminado']
  const resumenes: Array<ResumenActualizacion | null> = [null, RESUMEN_OK, RESUMEN_ERROR, RESUMEN_ABORTADO]
  const out: EntradaVistaBotonAgentes[] = []
  for (const est of estados)
    for (const enCurso of fases)
      for (const resumen of resumenes)
        for (const resumenVisto of [false, true])
          for (const hayProyectoNativo of [false, true])
            out.push({
              estado: est,
              plan: est ? planificar(est) : null,
              enCurso,
              resumen,
              resumenVisto,
              hayProyectoNativo,
              nombres
            })
  return out
}

function main(): void {
  hr('Invariantes sobre todas las combinaciones')

  const todas = combinaciones(CENTINELA)
  {
    const rotas = todas.filter((c) => {
      const v = decidirVistaBotonAgentes(c)
      return (v.punto !== null || v.anillo) && !v.visible
    })
    check('(V1) punto o anillo ⇒ visible, siempre', rotas.length === 0, `combinaciones=${todas.length} rotas=${rotas.length}`)
  }
  {
    const rotas = todas.filter((c) => {
      const v = decidirVistaBotonAgentes(c)
      const corriendo = c.enCurso !== null && c.enCurso !== 'terminado'
      return corriendo !== v.anillo || (corriendo && v.etiqueta !== 'Actualizando…')
    })
    check('(V2) en curso ⇔ anillo, y dice «Actualizando…» («terminado» ya no corre)', rotas.length === 0, `rotas=${rotas.length}`)
  }
  {
    const conNombre = todas.flatMap((c) => {
      const v = decidirVistaBotonAgentes(c)
      return PROHIBIDOS.filter((p) => v.etiqueta.includes(p) || v.titulo.includes(p)).map((p) => `${p} en ${JSON.stringify(v)}`)
    })
    const sinCentinela = todas.filter((c) => {
      const v = decidirVistaBotonAgentes(c)
      return !v.anillo && !v.etiqueta.includes('EQUIPO-CENTINELA')
    })
    check('(V3) ningún texto nombra el sistema a mano', conNombre.length === 0, conNombre[0] ?? 'ninguno')
    check('(V3b) la etiqueta en reposo sale de `nombres.tuEquipo`', sinCentinela.length === 0, `sin centinela=${sinCentinela.length}`)
  }
  {
    const win = decidirVistaBotonAgentes(entrada({ nombres: nombresSistema('windows') }))
    const mac = decidirVistaBotonAgentes(entrada({ nombres: nombresSistema('mac') }))
    check(
      '(V3c) con los nombres reales: «…de tu Windows» / «…de tu Mac»',
      win.etiqueta === 'Actualizar los agentes de tu Windows' && mac.etiqueta === 'Actualizar los agentes de tu Mac',
      `${win.etiqueta} | ${mac.etiqueta}`
    )
  }
  {
    const v = decidirVistaBotonAgentes(entrada())
    check(
      '(V4) nunca hay estado deshabilitado (la salida ni tiene el campo)',
      !('deshabilitado' in v) && !('habilitado' in v),
      Object.keys(v).join(',')
    )
  }

  hr('El punto')

  {
    const visto = decidirVistaBotonAgentes(entrada({ resumen: RESUMEN_ERROR, resumenVisto: true }))
    const sinProyecto = decidirVistaBotonAgentes(entrada({ resumen: RESUMEN_ERROR, resumenVisto: true, hayProyectoNativo: false, estado: null }))
    check(
      '(V5) error PEGAJOSO: sigue rojo aunque se haya visto, también sin proyecto nativo',
      visto.punto === 'error' && sinProyecto.punto === 'error' && sinProyecto.visible && visto.titulo.includes('no se pudo actualizar Codex'),
      `${fmt(visto)} | ${fmt(sinProyecto)} | ${visto.titulo}`
    )
  }
  {
    const sinVer = decidirVistaBotonAgentes(entrada({ resumen: RESUMEN_OK, hayProyectoNativo: false }))
    const visto = decidirVistaBotonAgentes(entrada({ resumen: RESUMEN_OK, resumenVisto: true, hayProyectoNativo: false }))
    check(
      '(V6) ok sin ver → verde y visible; visto → se retira (y sin proyecto nativo, se va)',
      sinVer.punto === 'ok' && sinVer.visible && visto.punto === null && !visto.visible && sinVer.titulo.includes('Codex 0.156.0 → 0.156.1'),
      `${fmt(sinVer)} | ${fmt(visto)} | ${sinVer.titulo}`
    )
  }
  {
    const con = decidirVistaBotonAgentes(entrada({ estado: CODEX_NUEVO, plan: planificar(CODEX_NUEVO) }))
    const sin = decidirVistaBotonAgentes(entrada({ estado: CODEX_NUEVO, plan: planificar(CODEX_NUEVO), hayProyectoNativo: false }))
    check(
      '(V7) versión nueva instalable → aviso; sin proyecto nativo no se pinta (ni se ve)',
      con.punto === 'aviso' && con.visible && sin.punto === null && !sin.visible,
      `${fmt(con)} | ${fmt(sin)}`
    )
    check('(V7b) el título dice qué hay nuevo', con.titulo.includes('Codex 0.156.0 → 0.156.1'), con.titulo)
  }
  {
    const v = decidirVistaBotonAgentes(entrada({ estado: ATRASADA }))
    const m = decidirVistaBotonAgentes(entrada({ estado: MANUAL }))
    check(
      '(V8) una sesión atrasada avisa; un CLI que se instala a mano no (pero el título lo cuenta)',
      v.punto === 'aviso' && v.titulo.includes('1 sesión corre una versión anterior') && m.punto === null && m.titulo.includes('a mano'),
      `${fmt(v)} ${v.titulo} | ${fmt(m)} ${m.titulo}`
    )
  }
  {
    const trabajando = estado({
      codex: CODEX_NUEVO.codex,
      sesiones: [sesion('c1', 'codex', { trabajando: true }), sesion('c2', 'codex', { trabajando: true })]
    })
    const v = decidirVistaBotonAgentes(entrada({ estado: trabajando, plan: planificar(trabajando) }))
    check(
      '(V9) con agentes trabajando el botón sigue abriendo y el título dice por qué esperar',
      v.punto === 'aviso' && v.visible && v.titulo.includes('Espera: 2 agentes trabajando'),
      v.titulo
    )
  }
  {
    const esperando = estado({
      codex: CODEX_NUEVO.codex,
      sesiones: [sesion('c1', 'codex', { esperandoRespuesta: true }), sesion('c2', 'codex')]
    })
    const v = decidirVistaBotonAgentes(entrada({ estado: esperando, plan: planificar(esperando) }))
    check(
      '(V9b) una que espera tu respuesta también lo dice en el título, con su propio motivo',
      v.punto === 'aviso' && v.visible && v.titulo.includes('Espera: 1 agente espera tu respuesta.'),
      v.titulo
    )
  }
  {
    const v = decidirVistaBotonAgentes(entrada({ estado: CODEX_NUEVO, resumen: RESUMEN_ABORTADO }))
    const sinProyecto = decidirVistaBotonAgentes(entrada({ estado: AL_DIA, resumen: RESUMEN_ABORTADO, hayProyectoNativo: false }))
    check(
      '(V10) un resumen abortado no pinta rojo ni verde (manda lo que haya: aquí, el aviso)',
      v.punto === 'aviso' && sinProyecto.punto === null && !sinProyecto.visible,
      `${fmt(v)} | ${fmt(sinProyecto)}`
    )
  }
  {
    const v = decidirVistaBotonAgentes(entrada({ enCurso: 'instalando', resumen: RESUMEN_ERROR, hayProyectoNativo: false }))
    check(
      '(V11) en curso manda sobre un rojo anterior: anillo sin punto, y visible sin proyecto nativo',
      v.anillo && v.punto === null && v.visible && v.titulo.includes('instalando'),
      `${fmt(v)} ${v.titulo}`
    )
  }

  hr('El rótulo de la acción (textoAccion)')

  {
    const est = estado({
      codex: CODEX_NUEVO.codex,
      sesiones: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => sesion(id, 'codex'))
    })
    const plan = planificar(est)
    const t = textoAccion(plan)
    check(
      '(V12) instalar 1 CLI y reiniciar 5 → nombra el CLI y cuenta las sesiones',
      t === 'Actualizar Codex y reiniciar 5 sesiones' && plan.instalar.length === 1 && plan.reiniciar.length === 5,
      JSON.stringify(t)
    )
  }
  {
    const est = estado({
      claude: cli('claude-code', { instalada: '2.1.280', ultima: '2.1.281', hayNueva: true }),
      codex: CODEX_NUEVO.codex,
      sesiones: [sesion('k1', 'claude-code'), sesion('c1', 'codex')]
    })
    const plan = planificar(est)
    const t = textoAccion(plan)
    const alReves = textoAccion({ ...plan, instalar: [...plan.instalar].reverse() })
    check(
      '(V13) 2 CLIs → los dos, en el orden de plan.instalar',
      t === 'Actualizar Claude Code y Codex y reiniciar 2 sesiones' &&
        alReves === 'Actualizar Codex y Claude Code y reiniciar 2 sesiones',
      `${JSON.stringify(t)} | al revés ${JSON.stringify(alReves)}`
    )
  }
  {
    const est = estado({ codex: CODEX_NUEVO.codex, sesiones: [] })
    const plan = planificar(est)
    const t = textoAccion(plan)
    check(
      '(V14) sólo instalar (ninguna sesión que reiniciar) → sin «reiniciar»',
      t === 'Actualizar Codex' && plan.reiniciar.length === 0,
      JSON.stringify(t)
    )
  }
  {
    const plan = planificar(ATRASADA)
    const t = textoAccion(plan)
    check(
      '(V15) sólo reiniciar 1 (sesión atrasada, nada que instalar) → singular',
      t === 'Reiniciar 1 sesión' && plan.instalar.length === 0,
      JSON.stringify(t)
    )
  }
  {
    const plan = planificar(AL_DIA)
    const t = textoAccion(plan)
    check(
      '(V16) nada que hacer → el rótulo genérico',
      t === 'Actualizar y reiniciar' && plan.instalar.length === 0 && plan.reiniciar.length === 0,
      JSON.stringify(t)
    )
  }
  {
    const todas = combinaciones(CENTINELA).flatMap((c) => (c.plan ? [textoAccion(c.plan)] : []))
    const conNombre = todas.filter((t) => PROHIBIDOS.some((p) => t.includes(p)))
    check('(V17) el rótulo de la acción no nombra el sistema', conNombre.length === 0, conNombre[0] ?? `rótulos=${todas.length}`)
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
