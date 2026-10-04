// =============================================================================
// Comprobación de los agentes nativos (sondas, últimas, método y bloqueadores de la
// vista previa) y su cadencia: primera diferida, periódica y al recuperar el foco, con
// un `setTimeout` que se re-arma tras cada comprobación (nunca `setInterval`).
// Un agente con el candado tomado se salta y conserva lo que había.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import type { EstadoAgentesNativos, ProcesoBloqueador } from '../../../shared/agentes-nativos-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../shared/etiquetasAgente.ts'
import { debeChequearAlRecuperarFoco, decidirProximoChequeo, type Periodos } from '../../update/cadencia.ts'
import { procesosQueBloquean } from '../procesosBloqueo.ts'
import { detectarClaude, detectarCodex, leerCanalClaude, sondear } from './deteccion.ts'
import { emitirAhora, estado, hayNueva, ordenPara } from './emision.ts'
import { ultimaClaude, ultimaCodex, ultimaCodexBrew } from './ultimas.ts'
import { AGENTES } from './urls.ts'
import { errMsg, type InfoCli, type NucleoNativos } from './tipos.ts'

/**
 * Lo vivo bajo las raíces de bloqueo de `i`, sin lo que cuelga de `pidsTessera`.
 * null = no se pudo leer la tabla de procesos (se registra y se sigue).
 */
export async function bloqueadoresAhora(
  e: NucleoNativos,
  i: InfoCli,
  pidsTessera: readonly number[]
): Promise<ProcesoBloqueador[] | null> {
  try {
    const todos = await e.deps.listarProcesos()
    return procesosQueBloquean(todos, i.raicesBloqueo, e.deps.plataforma, pidsTessera, {
      porLineaComando: i.bloqueoPorLineaComando
    })
  } catch (err) {
    e.deps.log(`agentes nativos: no se pudo listar los procesos: ${errMsg(err)}`)
    return null
  }
}

/**
 * Procesos ajenos que bloquearían la instalación, para avisar antes de parar nada: solo
 * en Windows, con orden que exige parar y con algo que instalar. Excluye los ptys de ESE
 * agente, que el flujo para; los del otro agente no.
 */
async function bloqueadoresVistaPrevia(e: NucleoNativos, agente: AgentKind): Promise<ProcesoBloqueador[]> {
  const i = e.info[agente]
  const orden = ordenPara(e, agente)
  if (e.deps.plataforma !== 'windows' || i.raicesBloqueo.length === 0) return []
  if (orden === null || orden.tipo !== 'auto' || !orden.requiereParar) return []
  if (!hayNueva(e, agente, e.sondas[agente].valor)) return []
  return (await bloqueadoresAhora(e, i, e.deps.pidsTessera(agente))) ?? []
}

async function refrescarCodex(e: NucleoNativos): Promise<void> {
  // La fuente de la última depende del método (Homebrew lleva la suya): la red espera a
  // la detección, y la sonda de la instalada corre en paralelo con las dos.
  const [, { det, ult }] = await Promise.all([
    sondear(e, 'codex'),
    detectarCodex(e).then(async (d) => ({
      det: d,
      ult: d.metodo === 'brew' ? await ultimaCodexBrew(e, d.raiz) : await ultimaCodex(e)
    }))
  ])
  const i = e.info.codex
  i.metodo = det.metodo
  i.raicesBloqueo = det.raicesBloqueo
  i.bloqueoPorLineaComando = false
  i.canal = null
  i.ultima = ult.ultima
  i.binarioPublicado = ult.binarioPublicado
  i.error = ult.error
  i.comprobadoEn = e.deps.ahora()
  i.bloqueadores = await bloqueadoresVistaPrevia(e, 'codex')
}

async function refrescarClaude(e: NucleoNativos): Promise<void> {
  const [, det, canal] = await Promise.all([sondear(e, 'claude-code'), detectarClaude(e), leerCanalClaude(e)])
  const ult = await ultimaClaude(e, det.metodo, canal)
  const i = e.info['claude-code']
  i.metodo = det.metodo
  i.raicesBloqueo = det.raicesBloqueo
  // Por línea de comandos solo Claude (el `node.exe <raiz>\cli.js`).
  i.bloqueoPorLineaComando = det.raicesBloqueo.length > 0
  i.canal = canal
  i.ultima = ult.ultima
  i.binarioPublicado = true
  i.error = ult.error
  i.comprobadoEn = e.deps.ahora()
  i.bloqueadores = await bloqueadoresVistaPrevia(e, 'claude-code')
}

/** Refresca un agente; con su candado tomado no hace nada salvo con `ignorarCandado`. */
export async function refrescarAgente(e: NucleoNativos, agente: AgentKind, ignorarCandado = false): Promise<void> {
  if (!ignorarCandado && e.candados.has(agente)) return
  try {
    if (agente === 'codex') await refrescarCodex(e)
    else await refrescarClaude(e)
  } catch (err) {
    e.info[agente].error = `No se pudo comprobar ${ETIQUETA_AGENTE[agente]}: ${errMsg(err)}`
    e.deps.log(`agentes nativos: comprobar ${agente} falló: ${errMsg(err)}`)
  }
}

/** Comprueba los dos CLIs y emite CAMBIO. Nunca rechaza; dos llamadas a la vez comparten una. */
export function comprobar(e: NucleoNativos): Promise<EstadoAgentesNativos> {
  if (e.comprobacionEnVuelo) return e.comprobacionEnVuelo
  const p = (async (): Promise<EstadoAgentesNativos> => {
    try {
      await Promise.all(AGENTES.map((a) => refrescarAgente(e, a)))
    } catch (err) {
      e.deps.log(`agentes nativos: la comprobación falló: ${errMsg(err)}`)
    }
    e.ultimoChequeoMs = e.deps.ahora()
    if (e.arrancado) replanificar(e)
    const est = estado(e)
    emitirAhora(e)
    return est
  })().finally(() => {
    e.comprobacionEnVuelo = null
  })
  e.comprobacionEnVuelo = p
  return p
}

function periodos(e: NucleoNativos): Periodos {
  return {
    primerChequeoMs: e.t.primerChequeoMs,
    enfocadaMs: e.t.periodoMs,
    fondoMs: e.t.periodoMs,
    umbralRefocoMs: e.t.umbralRefocoMs
  }
}

function replanificar(e: NucleoNativos): void {
  if (e.cancelarCadencia) {
    e.cancelarCadencia()
    e.cancelarCadencia = null
  }
  if (!e.arrancado) return
  const d = decidirProximoChequeo({
    ahoraMs: e.deps.ahora(),
    ultimoChequeoMs: e.ultimoChequeoMs,
    // Un solo periodo: el foco no cambia cada cuánto salen versiones de los CLIs.
    enfocada: true,
    suspendido: false,
    reintentoPendiente: false,
    estadoTerminal: false,
    periodos: periodos(e)
  })
  if (d.accion === 'ninguna') return
  const enMs = d.accion === 'chequear' ? 0 : d.enMs
  e.cancelarCadencia = e.programar(() => {
    e.cancelarCadencia = null
    // `comprobar` replanifica al terminar.
    void comprobar(e)
  }, enMs)
}

/** Programa la primera comprobación (diferida) y las periódicas. Idempotente. */
export function start(e: NucleoNativos): void {
  if (e.arrancado) return
  e.arrancado = true
  replanificar(e)
}

/** Cancela los temporizadores (cierre de la app). No interrumpe una instalación. */
export function parar(e: NucleoNativos): void {
  e.arrancado = false
  if (e.cancelarCadencia) {
    e.cancelarCadencia()
    e.cancelarCadencia = null
  }
  if (e.cancelarRebote) {
    e.cancelarRebote()
    e.cancelarRebote = null
  }
}

/** La ventana volvió a tener el foco: comprueba si la última comprobación es vieja. */
export function alRecuperarFoco(e: NucleoNativos): void {
  if (!e.arrancado) return
  const toca = debeChequearAlRecuperarFoco({
    ahoraMs: e.deps.ahora(),
    ultimoChequeoMs: e.ultimoChequeoMs,
    suspendido: false,
    reintentoPendiente: false,
    // Con una instalación en curso se comprobaría a medias: que lo haga el periodo siguiente.
    estadoTerminal: e.instalando !== null,
    periodos: periodos(e)
  })
  if (toca) void comprobar(e)
}
