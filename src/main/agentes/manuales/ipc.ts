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
  type PeticionAplicarCapa,
  type ResultadoAplicarCapa,
  type PeticionBuscarNativo,
  type ResultadoBuscarNativo,
  type PeticionContextoManual,
  type MensajeProgresoCapa
} from '../../../shared/agentes-manuales-ipc'
import { normalizarDefiniciones } from '../../../shared/agentesManuales'
import { TOPE_LECTURA_BYTES, type LecturaContexto } from '../../../shared/contextoAgenteManual'
import { leerContextoDeSesion, leerFinal, type DependenciasContextoManual, type SesionConContexto } from './contexto'
import { instalacionesDe } from '../../../shared/capaPerfil'
import { txAgentes } from '../textos.ts'
import { plataformaActual } from '../../../shared/plataforma'
import type { Perfil } from '../../perfiles/types'
import type { GestorSandbox } from '../../sandbox/GestorSandbox'
import type { EmisorEventos } from '../../util/emisorEventos'
import type { OpcionesEjecucion, ResultadoEjecucion } from '../ejecutorShell'
import { ordenBuscarPrograma, rutaDeSalida } from './busqueda'
import { contenedorDe } from '../terminalAgente/credenciales'

/** Tope de la búsqueda: la shell de login puede tardar en cargar su perfil. */
const TOPE_BUSQUEDA_MS = 15_000

interface DependenciasIpcAgentesManuales {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: GestorSandbox
  perfiles: () => Perfil[]
  ejecutar: (cmd: string, opciones: OpcionesEjecucion) => Promise<ResultadoEjecucion>
  emisor: EmisorEventos
  /** Enlace tardío: el controlador de los agentes nace después que este IPC. */
  sesionConContexto: (sesionId: unknown) => SesionConContexto | null
}

export function registrarIpcAgentesManuales(deps: DependenciasIpcAgentesManuales): void {
  const { ipc, sandbox, perfiles, ejecutar, emisor } = deps
  ipc.handle(AGENTES_MANUALES_CHANNELS.BUSCAR_NATIVO, async (_e, req: PeticionBuscarNativo): Promise<ResultadoBuscarNativo> => {
    const programa = typeof req?.programa === 'string' ? req.programa.trim() : ''
    if (!programa) return { ruta: null }
    const plataforma = plataformaActual()
    const r = await ejecutar(ordenBuscarPrograma(programa, plataforma), { plataforma, topeMs: TOPE_BUSQUEDA_MS, modo: 'sonda' })
    return { ruta: r.ok ? rutaDeSalida(r.salida, plataforma) : null }
  })
  ipc.handle(AGENTES_MANUALES_CHANNELS.APLICAR_CAPA, async (_e, req: PeticionAplicarCapa): Promise<ResultadoAplicarCapa> => {
    const perfil = perfiles().find((p) => p.id === req?.profileId)
    if (!perfil) return { ok: false, faltan: [], error: `Perfil desconocido: "${String(req?.profileId)}".` }
    // Las definiciones se vuelven a validar aquí: sus órdenes corren como root en el build.
    const inst = instalacionesDe(normalizarDefiniciones(req.definiciones, true))
    return sandbox.aplicarCapa(perfil, inst, (linea) => emisor.emitir(AGENTES_MANUALES_CHANNELS.PROGRESO, { perfilId: perfil.id, linea } satisfies MensajeProgresoCapa))
  })
  registrarContexto(deps)
}

/** Tope de una lectura del contexto: la consulta es periódica y no puede apilarse. */
const TOPE_CONTEXTO_MS = 10_000

function depsContexto(deps: DependenciasIpcAgentesManuales): DependenciasContextoManual {
  const plataforma = plataformaActual()
  return {
    plataforma,
    dirPersonal: os.homedir(),
    ejecutarNativo: async (orden, cwd) => {
      const r = await deps.ejecutar(orden, { plataforma, topeMs: TOPE_CONTEXTO_MS, modo: 'sonda', cwd, topeBytes: TOPE_LECTURA_BYTES })
      return { ok: r.ok, salida: r.salida }
    },
    ejecutarEnContenedor: async (s, orden) => {
      const perfil = deps.perfiles().find((p) => p.id === s.perfilId)
      if (!perfil) return { ok: false, salida: `Perfil desconocido: "${s.perfilId}".` }
      const r = await deps.sandbox.exec(contenedorDe(perfil, s.agente, s.cuentaId), orden, { proyecto: s.rutaHostProyecto })
      return { ok: r.exitCode === 0, salida: r.exitCode === 0 ? r.stdout : r.stderr || r.stdout }
    },
    leerFinal
  }
}

/** CONTEXTO: una lectura en vuelo por sesión; la consulta que llega mientras, espera a esa. */
function registrarContexto(deps: DependenciasIpcAgentesManuales): void {
  const enVuelo = new Map<string, Promise<LecturaContexto>>()
  const d = depsContexto(deps)
  deps.ipc.handle(AGENTES_MANUALES_CHANNELS.CONTEXTO, (_e, req: PeticionContextoManual): Promise<LecturaContexto> => {
    const sesion = deps.sesionConContexto(req?.sesionId)
    if (!sesion) return Promise.resolve({ ok: false, error: txAgentes().contexto.sinFuente })
    const previa = enVuelo.get(req.sesionId)
    if (previa) return previa
    const lectura = leerContextoDeSesion(sesion, d).finally(() => enVuelo.delete(req.sesionId))
    enVuelo.set(req.sesionId, lectura)
    return lectura
  })
}
