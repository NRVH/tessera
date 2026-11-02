// =============================================================================
// `tctx` en los proyectos en modo Docker: el programa que el dominio de las reglas registra en el buzón del
// puente de `tdb`. Atiende en el host lo que deja el cliente del contenedor (`src/tctx/tctx-container.cjs`)
// sin lanzar ningún proceso: resuelve la sesión con el token (el perfil sale de ahí, nunca de la petición)
// y contesta con la misma respuesta que daría el puente, que el cliente lee igual que en nativo.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
import path from 'node:path'
import type { RespuestaOperacion, SesionDelPuente } from '../db/dbBridge.ts'
import type { ProgramaBuzon, RespuestaPrograma } from '../db/dockerBridge.ts'
import type { OperacionesReglas } from './operacionesReglas.ts'

/** Lo que necesita. */
export interface DepsBuzonTctx {
  /** `src/tctx`: de ahí salen el cliente y los módulos que se copian al buzón. */
  dirTctx: string
  /** De quién es un token de sesión (`DbBridge.sesionDeToken`), o `null`. */
  sesionDeToken: (token: string) => SesionDelPuente | null
  /** Quien atiende por nombre: las de las reglas y las de otros dominios, que pueden contestar con una promesa. */
  operaciones: { atender: (...a: Parameters<OperacionesReglas['atender']>) => RespuestaOperacion | Promise<RespuestaOperacion> }
  log?: (mensaje: string) => void
}

/** La respuesta de la operación dentro de la del buzón: el código del proceso lo decide el cliente. */
function conRespuesta(respuesta: RespuestaOperacion): RespuestaPrograma {
  return { exitCode: 0, stderr: '', respuesta }
}

/** Atiende una petición del cliente del contenedor. */
export async function atenderTctx(p: Readonly<Record<string, unknown>>, d: DepsBuzonTctx): Promise<RespuestaPrograma> {
  const sesion = d.sesionDeToken(typeof p.token === 'string' ? p.token : '')
  if (!sesion) return conRespuesta({ ok: false, error: 'no autorizado' })
  try {
    return conRespuesta(await d.operaciones.atender(p.op, p, sesion))
  } catch (err) {
    d.log?.(`tctx por el buzón falló: ${err instanceof Error ? err.message : String(err)}`)
    return conRespuesta({ ok: false, error: 'error interno' })
  }
}

/** El programa `tctx` del buzón: sus archivos, su cliente y quién atiende. */
export function programaTctx(d: DepsBuzonTctx): ProgramaBuzon {
  const de = (nombre: string): string => path.join(d.dirTctx, nombre)
  return {
    nombre: 'tctx',
    archivos: {
      'tctx-cliente.cjs': de('tctx-container.cjs'),
      'tctxArgumentos.cjs': de('tctxArgumentos.cjs'),
      'tctxEntrada.cjs': de('tctxEntrada.cjs'),
      'tctxOrdenes.cjs': de('tctxOrdenes.cjs'),
      'tctxSalida.cjs': de('tctxSalida.cjs'),
      'textosTctx.cjs': de('textosTctx.cjs')
    },
    cliente: 'tctx-cliente.cjs',
    // Unas reglas enteras, o veinte trozos de una búsqueda, con su respuesta: nada se acerca a esto.
    maxRespuesta: 1024 * 1024,
    atender: (p) => atenderTctx(p, d)
  }
}
