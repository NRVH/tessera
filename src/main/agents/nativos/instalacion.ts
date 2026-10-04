// =============================================================================
// Instalación de la versión nueva de un CLI nativo, en orden: candado → revalidar →
// parar el lote (atómico) → esperar bloqueadores (Windows) → orden → re-sondear →
// soltar el candado en el `finally`. Nunca rechaza; «sigue en la misma versión» es fallo.
// Mientras el candado está tomado, aperturas y reinicios nativos de ese agente esperan.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import type {
  InstalarRequest,
  InstalarResultado,
  MotivoFalloInstalar,
  ProcesoBloqueador
} from '../../../shared/agentes-nativos-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../shared/etiquetasAgente.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import { compararVersiones, esVersionExacta, hayVersionNueva } from '../../../shared/versionesCli.ts'
import {
  clasificarErrorInstalacion,
  ordenActualizacion,
  type MotivoErrorInstalacion,
  type OrdenActualizacion
} from '../comandoActualizacion.ts'
import type { ResultadoEjecucion } from '../ejecutorShell.ts'
import { sondear } from './deteccion.ts'
import { emitirAhora, hayNueva, progreso } from './emision.ts'
import { bloqueadoresAhora, refrescarAgente } from './refresco.ts'
import { BINARIO } from './urls.ts'
import { errMsg, type InfoCli, type NucleoNativos } from './tipos.ts'

const MOTIVO_FALLO: Readonly<Record<MotivoErrorInstalacion, MotivoFalloInstalar>> = {
  tope: 'tope',
  bloqueado: 'bloqueado',
  permisos: 'fallo',
  red: 'fallo',
  fallo: 'fallo'
}

/** Lo que el `catch` de `instalar` necesita saber de las fases: se actualiza en cada una. */
interface Curso {
  agente: AgentKind
  nombre: string
  antes: string | null
  detenidas: string[]
}

/** Resuelve cuando no hay una instalación de `agente` en curso. */
export async function esperarCandado(e: NucleoNativos, agente: AgentKind): Promise<void> {
  for (;;) {
    const c = e.candados.get(agente)
    if (!c) return
    await c.promesa
  }
}

function tomarCandado(e: NucleoNativos, agente: AgentKind): void {
  let soltar: () => void = () => {}
  const promesa = new Promise<void>((r) => {
    soltar = r
  })
  e.candados.set(agente, { promesa, soltar })
  e.instalando = agente
}

function soltarCandado(e: NucleoNativos, agente: AgentKind): void {
  const c = e.candados.get(agente)
  e.candados.delete(agente)
  if (e.instalando === agente) e.instalando = null
  c?.soltar()
}

/**
 * Espera a que no quede NADA vivo bajo las raíces (tras parar no se excluye ningún pid de
 * Tessera). Devuelve lo que siga vivo al agotar el presupuesto; [] si se vació o si la
 * tabla no se pudo leer (entonces decide npm).
 */
async function esperarSinBloqueadores(e: NucleoNativos, i: InfoCli): Promise<ProcesoBloqueador[]> {
  const inicio = e.deps.ahora()
  for (;;) {
    const quedan = await bloqueadoresAhora(e, i, [])
    if (quedan === null || quedan.length === 0) return []
    if (e.deps.ahora() - inicio >= e.t.presupuestoBloqueoMs) return quedan
    await e.esperar(e.t.intervaloBloqueoMs)
  }
}

function detalleSinVersion(e: NucleoNativos, agente: AgentKind, instalada: string | null): string {
  const nombre = ETIQUETA_AGENTE[agente]
  const i = e.info[agente]
  if (!esVersionExacta(i.ultima)) {
    return `No se sabe cuál es la última versión de ${nombre}${i.error ? `: ${i.error}` : '.'}`
  }
  if (instalada === null) return `No se pudo leer la versión instalada de ${nombre}.`
  if (agente === 'codex' && hayVersionNueva(instalada, i.ultima) && !i.binarioPublicado) {
    const { sistema } = nombresSistema(e.deps.plataforma)
    return `Codex ${i.ultima} aún no tiene publicado el binario para ${sistema}: vuelve a intentarlo en unos minutos.`
  }
  return `${nombre} ya está al día (${instalada}).`
}

/** Fallo sin instalar: `despues` es `antes`, y los campos extra van antes de `detenidas`. */
function fallo(
  c: Curso,
  motivo: MotivoFalloInstalar,
  detalle: string,
  extra: Partial<Pick<InstalarResultado, 'rechazos' | 'bloqueadores' | 'detenidas'>> = {}
): InstalarResultado {
  return {
    ok: false,
    agente: c.agente,
    antes: c.antes,
    despues: c.antes,
    motivo,
    detalle,
    ...extra,
    detenidas: extra.detenidas ?? []
  }
}

/** Fase 1: con el binario de AHORA, ¿hay versión nueva y orden automática? */
async function revalidar(
  e: NucleoNativos,
  c: Curso
): Promise<{ info: InfoCli; orden: Extract<OrdenActualizacion, { tipo: 'auto' }> } | InstalarResultado> {
  const { agente } = c
  const s = e.sondas[agente]
  // Una sonda en vuelo de antes del candado mediría la versión vieja: se deja terminar.
  if (s.enVuelo) await s.enVuelo
  if (e.info[agente].comprobadoEn === null) {
    await refrescarAgente(e, agente, true)
    c.antes = s.valor
  } else {
    c.antes = await sondear(e, agente)
  }
  const info = e.info[agente]
  const ultima = info.ultima
  if (!esVersionExacta(ultima) || !hayNueva(e, agente, c.antes)) {
    return fallo(c, 'sin-version', detalleSinVersion(e, agente, c.antes))
  }
  const orden = ordenActualizacion({ agente, metodo: info.metodo, plataforma: e.deps.plataforma, version: ultima })
  if (orden.tipo !== 'auto') {
    return fallo(c, 'no-instalable', orden.orden ? `${orden.motivo}. A mano: ${orden.orden}` : `${orden.motivo}.`)
  }
  return { info, orden }
}

/** Fase 2: parar el lote en el controlador (todas o ninguna). */
async function pararLote(e: NucleoNativos, c: Curso, detener: string[]): Promise<InstalarResultado | null> {
  if (detener.length === 0) return null
  const d = await e.deps.detenerVarias(detener)
  if (!d.ok) {
    const n = d.rechazos.length
    return fallo(
      c,
      'trabajando',
      `No se paró nada: ${n === 1 ? 'una sesión no se podía parar' : `${n} sesiones no se podían parar`} (trabajando, esperando tu respuesta o ya no disponibles).`,
      { rechazos: d.rechazos.map((r) => ({ sessionId: r.sessionId, causa: r.causa })) }
    )
  }
  c.detenidas = [...d.detenidas]
  return null
}

/** Fase 3 (Windows): lo que siga vivo bajo las raíces tras parar bloquea la instalación. */
async function comprobarBloqueo(e: NucleoNativos, c: Curso, info: InfoCli): Promise<InstalarResultado | null> {
  const quedan = await esperarSinBloqueadores(e, info)
  if (quedan.length === 0) return null
  const lista = quedan.map((b) => `${b.nombre} (pid ${b.pid}${b.esDemonio ? ', el servicio app-server' : ''})`).join(', ')
  const detalle =
    `${c.nombre} sigue abierto fuera de las sesiones que se pararon: ${lista}. ` +
    'Ciérralo (tu editor u otra terminal) y vuelve a intentarlo.'
  progreso(e, c.agente, detalle, 'error')
  return fallo(c, 'bloqueado', detalle, { bloqueadores: quedan, detenidas: c.detenidas })
}

/** Fase 5: el resultado a partir de la orden y de la versión re-sondeada. */
async function resultado(
  e: NucleoNativos,
  c: Curso,
  info: InfoCli,
  orden: string,
  conBloqueo: boolean,
  ej: ResultadoEjecucion,
  despues: string | null
): Promise<InstalarResultado> {
  const { agente, nombre, antes, detenidas } = c
  if (!ej.ok) {
    const bloqueadores = conBloqueo ? ((await bloqueadoresAhora(e, info, [])) ?? []) : []
    const cl = clasificarErrorInstalacion({
      salida: ej.salida || ej.error || '',
      codigo: ej.codigo,
      tope: ej.tope,
      plataforma: e.deps.plataforma,
      bloqueadores,
      agente,
      orden
    })
    info.ordenAyuda = cl.ordenManual ?? null
    progreso(e, agente, cl.detalle, 'error')
    return {
      ok: false,
      agente,
      antes,
      despues,
      motivo: MOTIVO_FALLO[cl.motivo],
      detalle: cl.detalle,
      ...(cl.motivo === 'bloqueado' && bloqueadores.length > 0 ? { bloqueadores } : {}),
      detenidas
    }
  }
  if (despues === null) {
    const detalle = `La instalación dejó ${nombre} sin responder a «${BINARIO[agente]} --version».`
    progreso(e, agente, detalle, 'error')
    return { ok: false, agente, antes, despues, motivo: 'fallo', detalle, detenidas }
  }
  if (antes !== null && compararVersiones(despues, antes) <= 0) {
    const detalle = `La orden terminó sin error, pero ${nombre} sigue en ${despues}.`
    progreso(e, agente, detalle, 'error')
    return { ok: false, agente, antes, despues, motivo: 'fallo', detalle, detenidas }
  }
  info.ordenAyuda = null
  progreso(e, agente, `${nombre} ${antes ?? '?'} → ${despues}`, 'fin')
  return { ok: true, agente, antes, despues, detenidas }
}

/** Fases 1 a 5, con el candado ya tomado. */
async function fases(e: NucleoNativos, c: Curso, detener: string[]): Promise<InstalarResultado> {
  const r = await revalidar(e, c)
  if ('ok' in r) return r
  const { info, orden } = r
  const parada = await pararLote(e, c, detener)
  if (parada) return parada
  const conBloqueo = e.deps.plataforma === 'windows' && orden.requiereParar && info.raicesBloqueo.length > 0
  if (conBloqueo) {
    const bloqueo = await comprobarBloqueo(e, c, info)
    if (bloqueo) return bloqueo
  }
  // Fase 4: la orden, con cada línea al progreso.
  progreso(e, c.agente, `> ${orden.orden}`, 'inicio')
  const ej = await e.deps.ejecutar(orden.orden, {
    plataforma: e.deps.plataforma,
    timeoutMs: e.t.topeOrdenMs,
    modo: 'orden',
    onLinea: (l) => progreso(e, c.agente, l)
  })
  // Nadie más sondea este agente con el candado tomado.
  const despues = await sondear(e, c.agente)
  return resultado(e, c, info, orden.orden, conBloqueo, ej, despues)
}

/**
 * Instala la versión nueva de UN agente. Nunca rechaza: todo fallo va en el resultado, y
 * `detenidas` dice qué sesiones paró de verdad (el renderer las relanza siempre).
 */
export async function instalar(e: NucleoNativos, req: InstalarRequest): Promise<InstalarResultado> {
  const agente = req?.agente
  if (agente !== 'claude-code' && agente !== 'codex') {
    return {
      ok: false,
      agente: agente as AgentKind,
      antes: null,
      despues: null,
      motivo: 'fallo',
      detalle: 'Agente desconocido.',
      detenidas: []
    }
  }
  const nombre = ETIQUETA_AGENTE[agente]
  const detener = Array.isArray(req.detener)
    ? [...new Set(req.detener.filter((id): id is string => typeof id === 'string'))]
    : []
  const s = e.sondas[agente]
  if (e.instalando !== null) {
    return fallo(
      { agente, nombre, antes: s.valor, detenidas: [] },
      'ocupado',
      `Ya hay una actualización de ${ETIQUETA_AGENTE[e.instalando]} en curso.`
    )
  }

  // Candado en síncrono: desde aquí ninguna sesión de este agente arranca.
  tomarCandado(e, agente)
  emitirAhora(e)
  const c: Curso = { agente, nombre, antes: s.valor, detenidas: [] }
  try {
    return await fases(e, c, detener)
  } catch (err) {
    const detalle = `La actualización de ${nombre} falló: ${errMsg(err)}`
    e.deps.log(`agentes nativos: ${detalle}`)
    progreso(e, agente, detalle, 'error')
    return { ok: false, agente, antes: c.antes, despues: s.valor, motivo: 'fallo', detalle, detenidas: c.detenidas }
  } finally {
    soltarCandado(e, agente)
    emitirAhora(e)
  }
}
