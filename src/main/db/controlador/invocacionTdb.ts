// =============================================================================
// Ejecución de `tdb` como subproceso desde el main: «Probar conexión» y las órdenes que llegan
// del buzón de un contenedor. Toda invocación pasa por `colaTdb`, que limita cuántas hay vivas.
// Depende de `dockerBridge.ts` (`ejecutarTdb`), `hostEnv.ts` (`variablesDeSecreto`) y del puente.
// Decisiones: docs/decisiones/bd/conexiones-tdb-como-subproceso.md
// =============================================================================
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ENV_DRIVERS,
  ENV_MODO,
  ENV_PERFIL,
  ENV_PIPE,
  ENV_REGISTRO,
  ENV_SESION,
  type DbConnection
} from '../../../shared/db-ipc.ts'
import { ColaConcurrencia } from '../../../shared/colaConcurrencia.ts'
import type { DbBridge } from '../dbBridge.ts'
import { ejecutarTdb, type ResultadoTdb } from '../dockerBridge.ts'
import type { ConnectionStore } from '../ConnectionStore.ts'
import type { DriverManager } from '../DriverManager.ts'
import { variablesDeSecreto } from '../hostEnv.ts'
import type { CtxDrivers } from '../explorador/protocoloTrabajador.ts'

/** Tope de espera de una invocación de `tdb` (conectar por VPN + consulta). */
const TDB_TIMEOUT_MS = 90_000
/** Tope de salida capturada, por si una consulta devuelve una barbaridad. */
const TDB_MAX_BUFFER = 32 * 1024 * 1024
/** Invocaciones de `tdb` vivas a la vez en todo el proceso: cada una es un Electron entero. */
const TDB_CONCURRENCIA = 4

/** Cola compartida por TODAS las invocaciones de `tdb` del proceso. */
const colaTdb = new ColaConcurrencia(TDB_CONCURRENCIA)

/**
 * Lo que enseña «Probar» cuando `tdb` no llegó a responder: la causa por los campos del error,
 * que no llevan rutas del host; el detalle completo va al log de bases de datos.
 */
export function mensajeFalloTdb(
  err: { code?: unknown; signal?: unknown; killed?: unknown } | null,
  conDetalle: boolean,
  topeMs: number
): string {
  const codigo = err?.code
  const senal = err?.signal
  const causa =
    err === null
      ? 'terminó sin dar respuesta'
      : err.killed === true && typeof senal === 'string'
        ? `no respondió en ${Math.round(topeMs / 1000)} s y se detuvo`
        : codigo === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? 'su salida pasó del tope y se detuvo'
          : typeof codigo === 'string'
            ? `no arrancó (${codigo})`
            : typeof codigo === 'number'
              ? `terminó con el código ${codigo} sin dar respuesta`
              : typeof senal === 'string'
                ? `se detuvo (${senal}) sin dar respuesta`
                : 'terminó sin dar respuesta'
  return `No se pudo ejecutar tdb: ${causa}.${conDetalle ? ' El detalle queda en el log de bases de datos (logs/db.log).' : ''}`
}

/**
 * Contexto de drivers para el mensaje `abrir` del proceso de sesión: lo mismo que `tdb.cjs` arma
 * para sí. Se lee del disco en cada llamada porque `DriverManager` republica el catálogo.
 */
export function contextoDeDrivers(driversDir: string): CtxDrivers {
  let packs: unknown[] = []
  let externos: Record<string, string> = {}
  try {
    const doc = JSON.parse(readFileSync(path.join(driversDir, 'catalogo.json'), 'utf-8')) as {
      packs?: unknown
      externos?: unknown
    }
    if (Array.isArray(doc?.packs)) packs = doc.packs
    if (typeof doc?.externos === 'object' && doc.externos !== null) {
      externos = doc.externos as Record<string, string>
    }
  } catch {
    // Sin catálogo (primer arranque o JSON roto): igual que `tdb`, se sigue sin packs.
  }
  return {
    packs,
    externos,
    driversDir,
    usuarioWindows: process.env.USERNAME || process.env.USER || 'tessera'
  }
}

/** Lo que el invocador necesita del resto del subsistema. */
export interface DependenciasInvocacion {
  puente: DbBridge
  connections: Pick<ConnectionStore, 'registryPath' | 'secretOf'>
  drivers: Pick<DriverManager, 'driversDir'>
  /** Ruta del CLI `tdb.cjs`. */
  tdbScript: string
  log: (msg: string) => void
}

/** Lanza `tdb` como subproceso para el botón «Probar» y para las órdenes de un contenedor. */
export class InvocadorTdb {
  private readonly d: DependenciasInvocacion

  constructor(deps: DependenciasInvocacion) {
    this.d = deps
  }

  /**
   * Ejecuta el `tdb` real en nombre de un contenedor, con el mismo token y pipe que una terminal
   * nativa: no hay una segunda forma de resolver credenciales.
   */
  ejecutarParaContenedor(token: string, argv: string[], entrada?: string): Promise<ResultadoTdb> {
    const perfil = this.d.puente.perfilDeToken(token)
    if (!perfil || !this.d.puente.listo) {
      return Promise.resolve({
        exitCode: 2,
        stdout: '',
        stderr:
          '\n  ✗ Esta sesión ya no está autorizada.\n' +
            '    Recarga la terminal para que Tessera vuelva a emitir sus credenciales.\n\n'
      })
    }
    return colaTdb.correr(() => this.lanzarParaContenedor(perfil, token, argv, entrada))
  }

  /** Ejecuta `tdb ... --json` y devuelve el objeto que imprimió. */
  ejecutarParaConexion(con: DbConnection, args: string[]): Promise<Record<string, unknown>> {
    return colaTdb.correr(() => this.lanzarParaConexion(con, args))
  }

  private lanzarParaContenedor(perfil: string, token: string, argv: string[], entrada?: string): Promise<ResultadoTdb> {
    // `ejecutarTdb` cierra siempre la entrada estándar: sin eso, un `--stdin` esperaba los 90 s del tope.
    return ejecutarTdb({
      ejecutable: process.execPath,
      argv: [this.d.tdbScript, ...argv],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        [ENV_PERFIL]: perfil,
        [ENV_REGISTRO]: this.d.connections.registryPath,
        [ENV_DRIVERS]: this.d.drivers.driversDir,
        [ENV_MODO]: 'pipe',
        [ENV_PIPE]: this.d.puente.pipe,
        [ENV_SESION]: token
      },
      entrada,
      timeoutMs: TDB_TIMEOUT_MS,
      maxBuffer: TDB_MAX_BUFFER
    })
  }

  private lanzarParaConexion(con: DbConnection, args: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [this.d.tdbScript, ...args, '--json'],
        {
          env: this.entornoDe(con),
          timeout: TDB_TIMEOUT_MS,
          maxBuffer: TDB_MAX_BUFFER,
          windowsHide: true
        },
        (err, stdout, stderr) => {
          // `tdb --json` imprime siempre una línea JSON, también al fallar: el código de salida no basta.
          const linea = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop()
          if (linea) {
            try {
              return resolve(JSON.parse(linea) as Record<string, unknown>)
            } catch {
              // Cae al camino de error de abajo.
            }
          }
          // No llegó a responder: el detalle lleva rutas del host, así que va entero al log y al
          // renderer solo la causa.
          const errores = String(stderr || '').trim()
          const detalle = err ? err.message.trim() : errores
          if (detalle !== '') this.d.log(`tdb ${args[0] ?? ''} sin respuesta: ${detalle.slice(0, 2000)}`)
          resolve({ ok: false, error: mensajeFalloTdb(err, errores !== '', TDB_TIMEOUT_MS) })
        }
      )
    })
  }

  /** Entorno de un `tdb` invocado desde el main: token de un solo uso con el puente vivo, o el secreto. */
  private entornoDe(con: DbConnection): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      [ENV_PERFIL]: con.profileId,
      [ENV_REGISTRO]: this.d.connections.registryPath,
      [ENV_DRIVERS]: this.d.drivers.driversDir
    }
    if (this.d.puente.listo) {
      return {
        ...base,
        [ENV_MODO]: 'pipe',
        [ENV_PIPE]: this.d.puente.pipe,
        [ENV_SESION]: this.d.puente.mintUnaVez(con.id, con.profileId)
      }
    }
    // Sin puente, la contraseña con la huella del destino, por la misma función que las terminales.
    const secreto = this.d.connections.secretOf(con.id)
    return {
      ...base,
      [ENV_MODO]: 'env',
      ...(secreto !== null ? variablesDeSecreto(con, secreto) : {})
    }
  }
}
