// =============================================================================
// IPC de los agentes manuales: buscar su programa con la shell nativa, aplicar la capa de
// imagen de un perfil con Docker (reemitiendo cada línea del build al renderer) y leer el
// contexto de una sesión. La lógica vive en `busqueda.ts`, `contexto.ts`,
// `shared/capaPerfil.ts` y el gestor del sandbox.
// =============================================================================
import type { IpcMain } from 'electron'
import os from 'node:os'
import {
  AGENTES_MANUALES_CHANNELS,
  type AplicarCapaRequest,
  type AplicarCapaResult,
  type BuscarNativoRequest,
  type BuscarNativoResult,
  type ContextoManualRequest
} from '../../../shared/agentes-manuales-ipc'
import { normalizarDefiniciones } from '../../../shared/agentesManuales'
import { TOPE_LECTURA_BYTES, type LecturaContexto } from '../../../shared/contextoAgenteManual'
import { leerContextoDeSesion, leerFinal, type DepsContexto, type SesionConContexto } from './contexto'
import { instalacionesDe } from '../../../shared/capaPerfil'
import { txAgentes } from '../textos.ts'
import { plataformaActual } from '../../../shared/plataforma'
import type { Profile } from '../../profiles/types'
import type { SandboxManager } from '../../sandbox/SandboxManager'
import type { EmisorEventos } from '../../util/emisorEventos'
import type { OpcionesEjecucion, ResultadoEjecucion } from '../ejecutorShell'
import { ordenBuscarPrograma, rutaDeSalida } from './busqueda'
import { contenedorDe } from '../terminalAgente/credenciales'

/** Tope de la búsqueda: la shell de login puede tardar en cargar su perfil. */
const TOPE_BUSQUEDA_MS = 15_000

interface DepsIpc {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: SandboxManager
  perfiles: () => Profile[]
  ejecutar: (cmd: string, opciones: OpcionesEjecucion) => Promise<ResultadoEjecucion>
  emisor: EmisorEventos
  /** Enlace tardío: el controlador de los agentes nace después que este IPC. */
  sesionConContexto: (sessionId: unknown) => SesionConContexto | null
}

export function registrarIpcAgentesManuales(deps: DepsIpc): void {
  const { ipc, sandbox, perfiles, ejecutar, emisor } = deps
  ipc.handle(AGENTES_MANUALES_CHANNELS.BUSCAR_NATIVO, async (_e, req: BuscarNativoRequest): Promise<BuscarNativoResult> => {
    const programa = typeof req?.programa === 'string' ? req.programa.trim() : ''
    if (!programa) return { ruta: null }
    const plataforma = plataformaActual()
    const r = await ejecutar(ordenBuscarPrograma(programa, plataforma), { plataforma, timeoutMs: TOPE_BUSQUEDA_MS, modo: 'sonda' })
    return { ruta: r.ok ? rutaDeSalida(r.salida, plataforma) : null }
  })
  ipc.handle(AGENTES_MANUALES_CHANNELS.APLICAR_CAPA, async (_e, req: AplicarCapaRequest): Promise<AplicarCapaResult> => {
    const perfil = perfiles().find((p) => p.id === req?.profileId)
    if (!perfil) return { ok: false, faltan: [], error: `Perfil desconocido: "${String(req?.profileId)}".` }
    // Las definiciones se vuelven a validar aquí: sus órdenes corren como root en el build.
    const inst = instalacionesDe(normalizarDefiniciones(req.definiciones, true))
    return sandbox.aplicarCapa(perfil, inst, (linea) => emisor.emitir(AGENTES_MANUALES_CHANNELS.PROGRESO, { profileId: perfil.id, linea }))
  })
  registrarContexto(deps)
}

/** Tope de una lectura del contexto: la consulta es periódica y no puede apilarse. */
const TOPE_CONTEXTO_MS = 10_000

function depsContexto(deps: DepsIpc): DepsContexto {
  const plataforma = plataformaActual()
  return {
    plataforma,
    homedir: os.homedir(),
    ejecutarNativo: async (orden, cwd) => {
      const r = await deps.ejecutar(orden, { plataforma, timeoutMs: TOPE_CONTEXTO_MS, modo: 'sonda', cwd, topeBytes: TOPE_LECTURA_BYTES })
      return { ok: r.ok, salida: r.salida }
    },
    ejecutarEnContenedor: async (s, orden) => {
      const perfil = deps.perfiles().find((p) => p.id === s.profileId)
      if (!perfil) return { ok: false, salida: `Perfil desconocido: "${s.profileId}".` }
      const r = await deps.sandbox.exec(contenedorDe(perfil, s.agente, s.accountId), orden, { project: s.projectHostPath })
      return { ok: r.exitCode === 0, salida: r.exitCode === 0 ? r.stdout : r.stderr || r.stdout }
    },
    leerFinal
  }
}

/** CONTEXTO: una lectura en vuelo por sesión; la consulta que llega mientras, espera a esa. */
function registrarContexto(deps: DepsIpc): void {
  const enVuelo = new Map<string, Promise<LecturaContexto>>()
  const d = depsContexto(deps)
  deps.ipc.handle(AGENTES_MANUALES_CHANNELS.CONTEXTO, (_e, req: ContextoManualRequest): Promise<LecturaContexto> => {
    const sesion = deps.sesionConContexto(req?.sessionId)
    if (!sesion) return Promise.resolve({ ok: false, error: txAgentes().contexto.sinFuente })
    const previa = enVuelo.get(req.sessionId)
    if (previa) return previa
    const lectura = leerContextoDeSesion(sesion, d).finally(() => enVuelo.delete(req.sessionId))
    enVuelo.set(req.sessionId, lectura)
    return lectura
  })
}
