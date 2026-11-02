// =============================================================================
// Composición de las reglas del perfil para los agentes, parte de la raíz de composición de la app: el
// almacén de propuestas en `userData`, las operaciones de `tctx` (las suyas y las de otros dominios) en el
// puente de `tdb` y su programa en el buzón de Docker, sus atajos en `bin/s<N>` y los canales de las propuestas. Lo llama `src/main/index.ts`
// tras las conexiones SSH; el borrado de un perfil quita su propuesta con lo que devuelve.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { app, type IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ReferenciasApp } from '../app/referencias'
import type { PerfilesVivos } from '../profiles/types'
import type { PuertaPuente, RespuestaOperacion, SesionDelPuente } from '../db/dbBridge'
import type { PuertaBuzon } from '../db/dockerBridge'
import { dbLog } from '../db/dbLog'
import { REGLAS_CHANNELS, type AvisoPropuesta } from '../../shared/reglas-ipc'
import { emisorDeVentana } from '../util/emisorEventos'
import { escribirArchivosDeAtajo } from '../util/escrituraAtajos'
import { generarAtajosPrograma } from '../util/atajosPrograma'
import { programaTctx } from './buzonTctx'
import { registrarIpcReglas } from './ipc'
import { OperacionesReglas } from './operacionesReglas'
import { PropuestasReglas } from './propuestasReglas'

/** Lo que la composición de las reglas recibe de `index.ts`. */
export interface DepsReglas {
  refs: ReferenciasApp
  ipc: IpcMain
  perfiles: PerfilesVivos
  /** El puente de `tdb`: `tctx` registra en él sus operaciones. */
  puente: PuertaPuente | null
  /** El buzón de Docker del puente: `tctx` registra en él su programa para los proyectos en modo Docker. */
  buzon: PuertaBuzon | null
  /** De quién es un token de sesión del puente (el buzón lo resuelve sin lanzar ningún proceso). */
  sesionDeToken: (token: string) => SesionDelPuente | null
  /** La carpeta de los atajos de `tdb` (`bin/s<N>`), donde van también los de `tctx`. */
  binDir: string
  /** Las operaciones de `tctx` de otros dominios (`ctx.traspaso`, `ctx.buscar`), con token de sesión: por el puente y por el buzón. */
  otrasOperaciones?: ReadonlyArray<OperacionTctx>
}

/** Una operación de `tctx` que atiende otro dominio; con una promesa, el puente y el buzón la esperan. */
export interface OperacionTctx {
  op: string
  manejar: (peticion: Readonly<Record<string, unknown>>, sesion: SesionDelPuente) => RespuestaOperacion | Promise<RespuestaOperacion>
}

/** Lo que deja compuesto: el almacén, para que el borrado de un perfil quite su propuesta. */
export interface ComposicionReglas {
  propuestas: PropuestasReglas
}

/** Los atajos `tctx` junto a los de `tdb`, reescritos en cada arranque; si no se puede, queda en el registro. */
function prepararAtajosTctx(binDir: string): void {
  const script = join(app.getAppPath(), 'src', 'tctx', 'tctx.cjs')
  if (!existsSync(script)) dbLog('reglas', 'falta src/tctx/tctx.cjs: el atajo tctx no podrá arrancar')
  try {
    const atajos = generarAtajosPrograma({ nombre: 'tctx', variable: 'TESSERA_TCTX' }, { exe: process.execPath, script, sello: new Date().toISOString(), env: process.env })
    escribirArchivosDeAtajo(binDir, atajos)
  } catch (err) {
    dbLog('reglas', `ERROR al escribir los atajos de tctx en ${binDir}: ${String(err)}`)
  }
}

/** Almacén, operaciones de `tctx` (puente y buzón), atajos y canales de las propuestas. */
export function componerReglas(deps: DepsReglas): ComposicionReglas {
  const { refs, ipc, perfiles } = deps
  const eventos = emisorDeVentana(() => refs.ventana)
  const propuestas = new PropuestasReglas({
    ruta: join(app.getPath('userData'), 'reglas-propuestas.json'),
    // La lista se reasigna al guardar perfiles: se lee al usarse.
    idsVivos: () => perfiles.lista.map((p) => p.id),
    log: (m) => dbLog('reglas', m),
    alResolver: (profileId) => eventos.emitir(REGLAS_CHANNELS.RESUELTA, { profileId } satisfies AvisoPropuesta)
  })
  const operaciones = new OperacionesReglas({
    reglasDe: (id) => {
      const p = perfiles.lista.find((x) => x.id === id)
      return p ? (p.reglas ?? '') : null
    },
    propuestas,
    alProponer: (profileId) => eventos.emitir(REGLAS_CHANNELS.PROPUESTA, { profileId } satisfies AvisoPropuesta),
    log: (m) => dbLog('reglas', m)
  })
  operaciones.registrar(deps.puente)
  const otras = deps.otrasOperaciones ?? []
  for (const o of otras) deps.puente?.registrarOperacion(o.op, { token: 'sesion', manejar: (p, s) => o.manejar(p, s) })
  // El buzón tiene un solo programa `tctx`: atiende las de las reglas y las de los otros dominios.
  const atenderTodas = {
    atender: (op: unknown, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): RespuestaOperacion | Promise<RespuestaOperacion> =>
      otras.find((o) => o.op === op)?.manejar(p, s) ?? operaciones.atender(op, p, s)
  }
  if (deps.puente && deps.buzon) {
    try {
      deps.buzon.registrarPrograma(programaTctx({ dirTctx: join(app.getAppPath(), 'src', 'tctx'), sesionDeToken: deps.sesionDeToken, operaciones: atenderTodas, log: (m) => dbLog('reglas', m) }))
    } catch (err) {
      dbLog('reglas', `no se pudo registrar tctx en el buzón de Docker: ${String(err)}`)
    }
  }
  prepararAtajosTctx(deps.binDir)
  registrarIpcReglas({ ipc, propuestas, perfiles: () => perfiles.lista })
  return { propuestas }
}
