// =============================================================================
// El cupo de contenedores: antes de crear el contenedor de una cuenta con el límite alcanzado, se
// para otro según la política del usuario (`shared/semaforoContenedores.ts`): primero uno sin
// agentes, después el que diga la política; nunca uno a la vista. `pararPor` es la parada común
// con la saturación: salida por agente, aviso con la regla y constancia. Sin ninguno que parar, la
// apertura se rechaza con su motivo. Los de perfil (la terminal) cuentan, pero no se paran.
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

import type { Agente, Profile } from '../../profiles/types'
import {
  SIN_LIMITE,
  elegirAParar,
  hayCupo,
  type ContenedorCandidato,
  type PoliticaCupo
} from '../../../shared/semaforoContenedores'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgenteHibernado,
  type AgentExitMessage,
  type AgentExitReason,
  type MotivoParada,
  type ParadaPorLimite,
  type ProyectoParado
} from '../../../shared/agent-terminal-ipc'
import { cfgRefKey, contenedorDe, releaseConfigRef } from './credenciales'
import { soltarSesion } from './cierre'
import { matarEnSegundoPlano } from './hibernacion'
import { alinearChatConAncla, sinChatDesde } from './turnos'
import type { NucleoAgente, OpenAgentSession } from './tipos'
import { txAgentes } from '../textos.ts'

/** Tope de contenedores que una sola apertura puede parar: el límite pudo bajar con muchos abiertos. */
const TOPE_PARADAS = 16

/** Las sesiones de contenedor que corren en `id`. */
function sesionesEn(n: NucleoAgente, id: string): OpenAgentSession[] {
  return [...n.sessions.values()].filter((s) => {
    if (s.host) return false
    const perfil = n.profiles.get(s.profileId)
    return perfil !== undefined && contenedorDe(perfil, s.agente, s.accountId).id === id
  })
}

/**
 * Contenedores con una apertura en curso (id -> cuántas). Entre que su contenedor existe y su sesión
 * se registra parecen vacíos: sin esto, otra apertura simultánea lo pararía por ser «sin agentes».
 */
const abriendo = new Map<string, number>()

/** Corre la apertura de un agente en `id` con su contenedor protegido mientras dura, salga bien o mal. */
export async function mientrasSeAbre<T>(id: string, abrir: () => Promise<T>): Promise<T> {
  abriendo.set(id, (abriendo.get(id) ?? 0) + 1)
  try {
    return await abrir()
  } finally {
    const quedan = (abriendo.get(id) ?? 1) - 1
    if (quedan > 0) abriendo.set(id, quedan)
    else abriendo.delete(id)
  }
}

/** ¿Se ve ahora algún proyecto con una sesión en este contenedor? Lo que se mira no se para. */
function aLaVista(n: NucleoAgente, sesiones: readonly OpenAgentSession[]): boolean {
  const vistos = n.vigia.config?.enPantalla ?? []
  return sesiones.some((s) => vistos.some((v) => v.profileId === s.profileId && v.projectHostPath === s.projectHostPath))
}

/** Lo que se sabe de cada contenedor de cuenta vivo; los de perfil no son candidatos. */
export function candidatos(n: NucleoAgente, vivos: readonly string[] = n.sandbox.contenedoresVivos()): ContenedorCandidato[] {
  return vivos
    .filter((id) => n.sandbox.esDeCuenta(id) && !parandose.has(id))
    .map((id) => {
      const s = sesionesEn(n, id)
      return {
        id,
        abiertoEn: s.length > 0 ? Math.min(...s.map((x) => x.lanzadaEn)) : null,
        ultimaActividad: s.length > 0 ? Math.max(...s.map((x) => x.ultimaEsAt)) : null,
        trabajando: s.some((x) => x.activity.state() === 'working'),
        protegido: abriendo.has(id) || s.some((x) => x.manual !== null) || aLaVista(n, s)
      }
    })
}

/** Los proyectos y agentes que corren en el contenedor `id`: lo que el aviso dice que se parará. */
export function proyectosEn(n: NucleoAgente, id: string): ProyectoParado[] {
  const porProyecto = new Map<string, ProyectoParado>()
  for (const s of sesionesEn(n, id)) {
    const clave = `${s.profileId}\n${s.projectHostPath}`
    const p = porProyecto.get(clave) ?? { profileId: s.profileId, projectHostPath: s.projectHostPath, agentes: [] }
    p.agentes.push(s.agente)
    porProyecto.set(clave, p)
  }
  return [...porProyecto.values()]
}

/** Lo parado, como lo guarda la constancia. */
function proyectosDe(hibernados: readonly AgenteHibernado[]): ProyectoParado[] {
  return hibernados.map((h) => ({ profileId: h.profileId, projectHostPath: h.projectHostPath, agentes: h.sesiones.map((s) => s.agente) }))
}

/** Cómo se cuenta una parada: lo que se para y por qué. */
export interface ParadaContenedor {
  motivo: MotivoParada
  politica: Omit<PoliticaCupo, 'limite'>
  /** `limite`: el límite aplicado. */
  limite?: number
  /** `saturacion`: el porcentaje medido y el umbral del usuario. */
  porcentaje?: number
  umbralPct?: number
}

/**
 * Contenedores que se están parando: hasta que Docker termine siguen vivos y sin sesiones, y el
 * límite y la saturación los elegirían otra vez.
 */
const parandose = new Map<string, Promise<void>>()

/**
 * Para el contenedor de cuenta `id` por `motivo`: suelta sus agentes, lo avisa (`PARADA_POR_LIMITE`),
 * lo para y deja constancia con la regla. Lanza si Docker no lo para (y entonces no hay constancia).
 */
export async function pararPor(n: NucleoAgente, id: string, p: ParadaContenedor): Promise<void> {
  const parada = soltarYParar(n, id, p)
  parandose.set(id, parada)
  try {
    await parada
  } finally {
    parandose.delete(id)
  }
}

async function soltarYParar(n: NucleoAgente, id: string, p: ParadaContenedor): Promise<void> {
  const hibernados = soltarParaHacerSitio(n, id, p.motivo === 'limite' ? 'parado-por-limite' : 'parado-por-saturacion')
  const parada: ParadaPorLimite = {
    motivo: p.motivo,
    hibernados,
    limite: p.limite ?? SIN_LIMITE,
    primero: p.politica.primero,
    sinAgentes: hibernados.length === 0,
    ...(p.porcentaje !== undefined ? { porcentaje: p.porcentaje } : {})
  }
  // Los agentes ya se soltaron: el aviso va aunque Docker falle al parar; la constancia, solo si paró.
  n.eventos.emitir(AGENT_TERMINAL_CHANNELS.PARADA_POR_LIMITE, parada)
  await pararContenedor(n, id)
  n.registroParadas.anotar({
    en: Date.now(),
    motivo: p.motivo,
    proyectos: proyectosDe(hibernados),
    primero: p.politica.primero,
    protegerTrabajando: p.politica.protegerTrabajando,
    ...(p.limite !== undefined ? { limite: p.limite } : {}),
    ...(p.porcentaje !== undefined ? { porcentaje: p.porcentaje } : {}),
    ...(p.umbralPct !== undefined ? { umbralPct: p.umbralPct } : {})
  })
}

/**
 * Suelta los agentes del contenedor y avisa a CADA UNO por su sesión (`reason`): su panel lo dice y
 * «Reabrir» retoma la conversación, sin tocar los demás agentes de su proyecto, que pueden ser de
 * otra cuenta. Se avisa ANTES de parar el contenedor: si Docker falla al pararlo, ningún panel se
 * queda con una sesión muerta. Devuelve lo parado, para el aviso con la regla.
 */
function soltarParaHacerSitio(n: NucleoAgente, id: string, reason: AgentExitReason): AgenteHibernado[] {
  const porProyecto = new Map<string, AgenteHibernado>()
  for (const open of sesionesEn(n, id)) {
    alinearChatConAncla(n, open)
    const desde = sinChatDesde(n, open)
    soltarSesion(n, open.sessionId)
    matarEnSegundoPlano(n, open.sessionId)
    // El contenedor se va entero: sus credenciales no se desmontan una a una, pero la cuenta sí baja.
    releaseConfigRef(n.configRefs, cfgRefKey(open.profileId, open.agente, open.accountId))
    const salida: AgentExitMessage = { sessionId: open.sessionId, exitCode: null, reason }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, salida)
    const clave = `${open.profileId}\n${open.projectHostPath}`
    const h = porProyecto.get(clave) ?? { profileId: open.profileId, projectHostPath: open.projectHostPath, sesiones: [] }
    h.sesiones.push({
      sessionId: open.sessionId,
      agente: open.agente as Agente,
      resumeSessionId: open.resumeSessionId,
      ...(desde !== undefined ? { nuevaSiNadaDesde: desde } : {})
    })
    porProyecto.set(clave, h)
  }
  return [...porProyecto.values()]
}

/** Para el contenedor de cuenta `id`; lanza si no sabe de qué perfil es (no se reintenta en vano). */
async function pararContenedor(n: NucleoAgente, id: string): Promise<void> {
  const base = n.profiles.get(n.sandbox.idBase(id))
  if (!base) throw new Error(txAgentes().cupo.noSePudoParar(id))
  await n.sandbox.stopContainer({ ...base, id })
}

/** La cola de las aperturas que crean un contenedor con límite: de una en una. */
let cola: Promise<unknown> = Promise.resolve()

/**
 * Lo más que una apertura espera su turno. Pasado, sigue sin esperar: mejor un contenedor de más un
 * momento que un agente que no se abre nunca porque Docker se colgó con el de delante.
 */
const TOPE_ESPERA_TURNO_MS = 180_000

/**
 * Hace sitio y crea el contenedor (`crear`) en un solo turno: dos aperturas a la vez no se cuelan
 * las dos por el último hueco. Sin límite, o con el contenedor ya vivo, no espera a nadie.
 */
export function conSitio<T>(n: NucleoAgente, destino: Profile, cupo: PoliticaCupo | undefined, crear: () => Promise<T>): Promise<T> {
  if (!cupo || cupo.limite === SIN_LIMITE || n.sandbox.estaVivo(destino.id)) return crear()
  const previa = cola
  const turno = esperarConTope(previa, TOPE_ESPERA_TURNO_MS).then(async () => {
    await hacerSitio(n, destino, cupo)
    return crear()
  })
  cola = turno.catch(() => undefined)
  return turno
}

function esperarConTope(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
    void p.then(
      () => {
        clearTimeout(t)
        resolve()
      },
      () => {
        clearTimeout(t)
        resolve()
      }
    )
  })
}

/**
 * Hace sitio para `destino` si su contenedor aún no corre y el límite está alcanzado. Lanza, con
 * el motivo para el usuario, si no hay ninguno que se pueda parar.
 */
export async function hacerSitio(n: NucleoAgente, destino: Profile, cupo: PoliticaCupo | undefined): Promise<void> {
  if (!cupo || cupo.limite === SIN_LIMITE || n.sandbox.estaVivo(destino.id)) return
  for (let i = 0; i < TOPE_PARADAS; i++) {
    // Una parada en curso (de la saturación) libera su hueco al acabar: se espera antes de elegir otro.
    if (parandose.size > 0) await Promise.allSettled([...parandose.values()])
    const vivos = n.sandbox.contenedoresVivos()
    if (hayCupo(vivos.length, cupo.limite)) return
    const lista = candidatos(n, vivos)
    const victima = elegirAParar(lista, cupo, destino.id)
    if (victima === null) throw new Error(motivoSinSitio(lista, cupo.limite))
    n.log(`cupo: paro "${victima}" para abrir "${destino.id}" (límite ${cupo.limite}, ${cupo.primero})`)
    await pararPor(n, victima, { motivo: 'limite', politica: cupo, limite: cupo.limite })
  }
  if (!hayCupo(n.sandbox.contenedoresVivos().length, cupo.limite)) throw new Error(txAgentes().cupo.sinSitio(cupo.limite))
}

/**
 * Por qué no hay sitio, dicho como es: sin ningún contenedor de cuenta que parar, lo que ocupa el cupo
 * son contenedores de perfil (las terminales Docker); si no, todos están trabajando o son manuales.
 */
function motivoSinSitio(lista: readonly ContenedorCandidato[], limite: number): string {
  return lista.length === 0 ? txAgentes().cupo.ocupadoPorTerminales(limite) : txAgentes().cupo.sinSitio(limite)
}
