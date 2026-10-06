// =============================================================================
// Puente al host para el modo Docker: el contenedor nunca toca la base. `tdb` dentro del contenedor deja
// una petición en un buzón bind-monteado por perfil; esto la recoge, ejecuta el `tdb` real en el host
// (con sus Instant Clients y la VPN del usuario) y deja la respuesta. Ámbito y secretos salen siempre del
// token; el SQL viaja en la petición, nunca como ruta. Cliente: `src/tdb/tdb-container.cjs`. Otros
// dominios registran aquí su programa (`tssh`: `src/main/ssh/controlador/buzonTssh.ts`).
// Decisiones: docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
// `readdirSync` sigue aquí para `barrer`, que corre una vez al preparar un perfil; el del sondeo es asíncrono.
import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

/** Tope de la respuesta. 8 MiB de JSON por 9p ya es lento y no aporta: el CLI
 *  limita a 50 filas por defecto, y para volcados grandes está `--limit`. */
const MAX_RESPUESTA = 8 * 1024 * 1024

/** Peticiones/respuestas más viejas que esto son basura de una sesión muerta. */
const HUERFANA_MS = 10 * 60 * 1000

/**
 * Cada cuánto se repasa la carpeta. `fs.watch` SÍ dispara en este lado (el buzón es
 * NTFS y las escrituras del contenedor acaban siendo escrituras NTFS reales), pero
 * "debería" no es "siempre": el sondeo de respaldo convierte un fallo intermitente
 * y desesperante en, como mucho, un cuarto de segundo de latencia.
 */
const SONDEO_MS = 250

/** Cada cuánto se refresca el centinela que el cliente comprueba. */
const CENTINELA_MS = 30_000

/** Lo que el puente de Docker recibe: dónde está el buzón, el cliente a copiar y quién ejecuta `tdb`. */
export interface DockerBridgeDeps {
  /** Raíz del buzón: `<userData>/dbbridge`. Debajo cuelga una carpeta por perfil. */
  raiz: string
  /** Ruta del cliente que se copia al buzón (`src/tdb/tdb-container.cjs`). */
  clienteOrigen: string
  /**
   * Ejecuta el `tdb` REAL en Windows con el ámbito y los secretos del token dado.
   * Devuelve lo que haya que escribir en la respuesta. `entrada` es el SQL que el cliente
   * leyó dentro del contenedor (`--stdin`/`--file`), para la entrada estándar del `tdb`.
   */
  ejecutar: (
    token: string,
    argv: string[],
    entrada?: string
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  log?: (msg: string) => void
}

/** Tope del SQL que acepta una petición (el mismo que pone el cliente, `MAX_ENTRADA`). */
const MAX_ENTRADA = 8 * 1024 * 1024

/** Tope del archivo de una petición, sea del programa que sea: lo que cabe de verdad lo decide cada uno. */
const MAX_PETICION = 64 * 1024 * 1024

/** Nombre de un programa del buzón y de sus archivos: sin barras ni nada que el lanzador `sh` tenga que citar. */
const NOMBRE_PROGRAMA = /^[a-z][a-z0-9-]{0,31}$/
const NOMBRE_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Escribe un archivo del buzón SIN seguir lo que hubiera en su sitio: el contenedor escribe en esta carpeta, y
 * un enlace suyo con ese nombre haría que el host pisara el archivo del usuario al que apunta. Se quita lo que
 * haya (el enlace, no su destino) y se crea en exclusiva (`wx`): si el contenedor lo vuelve a poner entre
 * medias, falla en vez de seguirlo. El modo va por el descriptor, que tampoco sigue enlaces.
 */
function escribirEnBuzon(ruta: string, datos: string | Buffer, modo = 0o644): void {
  rmSync(ruta, { force: true })
  const fd = openSync(ruta, 'wx', modo)
  try {
    writeSync(fd, typeof datos === 'string' ? Buffer.from(datos, 'utf-8') : datos)
    fchmodSync(fd, modo)
  } finally {
    closeSync(fd)
  }
}

/** Lo que contesta un programa del buzón: su código, su salida de errores y los campos que lea su cliente. */
export interface RespuestaPrograma {
  exitCode: number
  stderr: string
  [campo: string]: unknown
}

/**
 * Otro programa que el buzón sirve además de `tdb` (hoy `tssh`), que registra su dominio: sus archivos se
 * copian al buzón en cada preparación, su lanzador se escribe como el de `tdb` y sus peticiones (`prog` = su
 * nombre) las atiende él. El token viaja dentro y lo resuelve quien atiende, nunca este puente.
 */
export interface ProgramaBuzon {
  nombre: string
  /** Archivos que se copian al buzón: nombre en el buzón -> ruta en el host. */
  archivos: Readonly<Record<string, string>>
  /** El de `archivos` que arranca el lanzador con el `node` del contenedor. */
  cliente: string
  /** Tope de la respuesta serializada: por encima se contesta con un error. */
  maxRespuesta: number
  atender: (peticion: Readonly<Record<string, unknown>>) => Promise<RespuestaPrograma>
}

/** Lo que otros dominios ven del buzón: registrar su programa. */
export interface PuertaBuzon {
  registrarPrograma(programa: ProgramaBuzon): void
}

/** La petición de `tdb`, o null si no tiene su forma (`entrada` es opcional y con tope). */
function peticionTdb(p: Record<string, unknown>): { token: string; argv: string[]; entrada?: string } | null {
  if (p.v !== 1 || typeof p.token !== 'string' || !Array.isArray(p.argv)) return null
  if (p.entrada !== undefined && (typeof p.entrada !== 'string' || p.entrada.length > MAX_ENTRADA)) return null
  return {
    token: p.token,
    argv: p.argv.map((a) => String(a)),
    ...(typeof p.entrada === 'string' ? { entrada: p.entrada } : {})
  }
}

/**
 * Por qué NO se ejecuta una argv que llega por el buzón, o null si se puede. Hoy, un
 * `--file`: su ruta sería del HOST (ver el ADR). El cliente del contenedor ya lo
 * convierte en `--stdin` con el contenido; una petición que lo traiga no viene de él.
 */
export function motivoRechazoArgv(argv: readonly string[]): string | null {
  if (argv.includes('--file')) {
    return (
      '\n  ✗ --file no llega por el puente: la ruta sería del equipo anfitrión, no de tu carpeta.\n' +
      '    El tdb del contenedor lee el archivo y manda su SQL; recarga la terminal para\n' +
      "    usarlo, o pásalo por la entrada estándar:  tdb query <base> --stdin <<'SQL'\n\n"
    )
  }
  return null
}

/** Lo que devuelve una ejecución de `tdb` (lo que se escribe en la respuesta del buzón). */
export interface ResultadoTdb {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Lanza `tdb` y recoge su salida. La ENTRADA ESTÁNDAR SE ESCRIBE Y SE CIERRA SIEMPRE (con
 * `entrada`, o vacía): un `tdb --stdin` lee hasta el fin de su entrada, y con ella abierta
 * esperaba hasta el `timeoutMs` (ver el ADR). Un `tdb` que sale sin leerla hace que la
 * escritura dé EPIPE: se ignora (sin oyente de `error`, tumbaría el main).
 *
 * El código de salida importa: es el que el `tdb` del contenedor propaga a su shell, y de
 * él dependen los `&&` de cualquier script del agente. Si el proceso se corta por el tope de
 * tiempo, se dice en `stderr` en vez de devolver un fallo mudo.
 */
export function ejecutarTdb(o: {
  ejecutable: string
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  entrada?: string
  timeoutMs: number
  maxBuffer: number
}): Promise<ResultadoTdb> {
  return new Promise((resolve) => {
    const hijo = execFile(
      o.ejecutable,
      [...o.argv],
      { env: o.env, timeout: o.timeoutMs, maxBuffer: o.maxBuffer, windowsHide: true },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null
        const code = e && typeof e.code === 'number' ? e.code : e ? 1 : 0
        let errTexto = String(stderr ?? '')
        if (e && e.killed) {
          errTexto += `\n  ✗ tdb no terminó en ${Math.round(o.timeoutMs / 1000)} s y se cortó.\n\n`
        }
        resolve({ exitCode: code, stdout: String(stdout ?? ''), stderr: errTexto })
      }
    )
    if (hijo.stdin) {
      hijo.stdin.on('error', () => {
        // EPIPE: `tdb` terminó sin leer su entrada (no la pedía). No es un fallo.
      })
      hijo.stdin.end(o.entrada ?? '', 'utf-8')
    }
  })
}

/** Puente al host para el modo Docker: recoge las peticiones del buzón de cada perfil y responde. */
export class DockerBridge implements PuertaBuzon {
  private readonly deps: DockerBridgeDeps
  private readonly log: (msg: string) => void
  private temporizador: NodeJS.Timeout | null = null
  private latido: NodeJS.Timeout | null = null
  /** Ids ya cogidos, para no atender dos veces la misma petición. */
  private readonly enCurso = new Set<string>()
  private readonly perfiles = new Set<string>()
  /** Los programas registrados además de `tdb`, por nombre. */
  private readonly programas = new Map<string, ProgramaBuzon>()

  constructor(deps: DockerBridgeDeps) {
    this.deps = deps
    this.log = deps.log ?? (() => {})
  }

  /**
   * Registra otro programa del buzón. Los perfiles ya preparados lo reciben en su siguiente preparación (la
   * de cada `ensureContainer`); los dominios lo registran al componerse, antes de abrir ningún contenedor.
   */
  registrarPrograma(programa: ProgramaBuzon): void {
    const nombres = [programa.cliente, ...Object.keys(programa.archivos)]
    if (!NOMBRE_PROGRAMA.test(programa.nombre) || programa.nombre === 'tdb' || !nombres.every((n) => NOMBRE_ARCHIVO.test(n))) {
      throw new Error(`programa de buzón con un nombre no válido: ${programa.nombre}`)
    }
    if (!(programa.cliente in programa.archivos)) throw new Error(`el cliente de ${programa.nombre} no está entre sus archivos`)
    this.programas.set(programa.nombre, programa)
  }

  /** Carpeta del buzón de un perfil en el HOST. */
  buzonDe(profileId: string): string {
    return path.join(this.deps.raiz, profileId)
  }

  /**
   * Prepara el buzón de un perfil: crea la carpeta, copia el cliente y barre lo que
   * hubiera quedado de una sesión anterior. Idempotente — se llama en cada
   * `ensureContainer`, que es lo que hace que el puente sobreviva a que Docker
   * recree el contenedor.
   */
  prepararPerfil(profileId: string): string {
    const dir = this.buzonDe(profileId)
    mkdirSync(dir, { recursive: true })
    // El cliente se COPIA (no se enlaza) en cada preparación: así se actualiza con
    // Tessera sin rehornear la imagen del sandbox, que es un `docker build --no-cache`
    // de varios minutos.
    try {
      escribirEnBuzon(path.join(dir, 'tdb-cliente.cjs'), readFileSync(this.deps.clienteOrigen))
      this.escribirLanzador(dir)
    } catch (err) {
      this.log(`no se pudo copiar el cliente al buzón de "${profileId}": ${String(err)}`)
    }
    for (const programa of this.programas.values()) this.copiarPrograma(dir, programa, profileId)
    this.barrer(dir)
    this.tocarCentinela(dir)
    this.perfiles.add(profileId)
    this.arrancar()
    return dir
  }

  /**
   * Simétrico de `prepararPerfil`: deja de sondear el buzón de un perfil cuyo
   * contenedor ya no existe. Lo llama `SandboxManager.stopContainer`, o sea al
   * hibernar el perfil, al eliminarlo y al cerrar la app.
   *
   * POR QUÉ EXISTE. `perfiles` solo crecía: un perfil entraba al tocarlo y no salía
   * nunca, así que el sondeo seguía haciendo un `readdir` cada 250 ms contra el
   * buzón de un contenedor MUERTO —que por definición ya no puede escribir nada—
   * hasta cerrar la app. Con todos los perfiles hibernados los dos temporizadores
   * seguían corriendo para nadie. Lo que estaba mal era el ÁMBITO (a quién se
   * sondea), no la frecuencia: `SONDEO_MS` y el no usar `fs.watch` siguen siendo
   * correctos por los motivos de sus comentarios.
   *
   * Al quedarse sin perfiles se paran los temporizadores del todo. Es seguro porque
   * `arrancar()` es idempotente y lo vuelve a llamar el siguiente `prepararPerfil`.
   * `enCurso` no se toca: una petición en vuelo se limpia sola en el `finally` de
   * `atender`, y su respuesta debe escribirse aunque el perfil ya no se sondee.
   *
   * LÍMITE: si un contenedor muere por su cuenta (crash del daemon) sin pasar por
   * `stopContainer`, su perfil sigue aquí hasta el próximo stop o el cierre.
   * Detectarlo pediría un `docker inspect` periódico, más caro que el `readdir` que
   * ahorraría.
   */
  olvidarPerfil(profileId: string): void {
    if (!this.perfiles.delete(profileId)) return
    if (this.perfiles.size === 0) this.stop()
  }

  /** Perfiles que se están sondeando ahora mismo. Para las pruebas. */
  get perfilesActivos(): number {
    return this.perfiles.size
  }

  /** Si el sondeo está en marcha. Para las pruebas. */
  get sondeando(): boolean {
    return this.temporizador !== null
  }

  /**
   * Lanzador `sh` al que apunta `/usr/local/bin/tdb` dentro del contenedor.
   *
   * Hace falta un lanzador y no un enlace directo al `.cjs` por dos motivos que se
   * juntan: un `.cjs` no es ejecutable por sí solo (necesita shebang), y un shebang
   * no sobreviviría al viaje — el repo tiene `core.autocrlf=true`, así que el
   * archivo llega al árbol de trabajo en CRLF y `#!/usr/bin/env node` + CR se
   * convierte en un intérprete llamado "node\r" que no existe. Este lanzador lo
   * ESCRIBE el host en tiempo de ejecución con LF explícito, así que git nunca lo
   * toca.
   */
  private escribirLanzador(dir: string): void {
    const lineas = [
      '#!/bin/sh',
      '# Generado por Tessera. Reenvia `tdb` al host por el buzon; no lo edites.',
      '# La ruta del cliente NO puede salir de "$0": `tdb` se invoca por un enlace en',
      '# /usr/local/bin, asi que dirname daria /usr/local/bin y no el buzon. Se usa la',
      '# misma variable que ya lleva el pty, con el valor por defecto como respaldo.',
      'exec node "${TESSERA_DB_BRIDGE:-/agent-config/dbbridge}/tdb-cliente.cjs" "$@"',
      ''
    ]
    // LF explícito, no `os.EOL`: el intérprete de esto es `sh` dentro de un Linux,
    // no Windows, y un CR aquí sería el mismo fallo que se acaba de describir.
    // Bit de ejecución explícito, no redundante: en Windows el `chmod` es un no-op y el bind aparece como
    // `root:root 777`, pero en macOS virtiofs conserva el modo real (0644 según la umask) y el contenedor
    // vería `exec /usr/local/bin/tdb: permission denied`, un error que apunta al enlace y no al archivo.
    escribirEnBuzon(path.join(dir, 'tdb'), lineas.join('\n'), 0o755)
  }

  /** Los archivos de un programa y su lanzador, como los de `tdb` (LF explícito y bit de ejecución). */
  private copiarPrograma(dir: string, programa: ProgramaBuzon, profileId: string): void {
    try {
      for (const [nombre, origen] of Object.entries(programa.archivos)) escribirEnBuzon(path.join(dir, nombre), readFileSync(origen))
      const lineas = [
        '#!/bin/sh',
        `# Generado por Tessera. Reenvia \`${programa.nombre}\` al host por el buzon; no lo edites.`,
        `exec node "\${TESSERA_DB_BRIDGE:-/agent-config/dbbridge}/${programa.cliente}" "$@"`,
        ''
      ]
      escribirEnBuzon(path.join(dir, programa.nombre), lineas.join('\n'), 0o755)
    } catch (err) {
      this.log(`no se pudo copiar ${programa.nombre} al buzón de "${profileId}": ${String(err)}`)
    }
  }

  /** Arranca el sondeo y el latido si no estaban ya. */
  private arrancar(): void {
    if (!this.temporizador) {
      this.temporizador = setInterval(() => void this.repasar(), SONDEO_MS)
      this.temporizador.unref?.()
    }
    if (!this.latido) {
      this.latido = setInterval(() => {
        for (const id of this.perfiles) this.tocarCentinela(this.buzonDe(id))
      }, CENTINELA_MS)
      this.latido.unref?.()
    }
  }

  stop(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    if (this.latido) clearInterval(this.latido)
    this.temporizador = null
    this.latido = null
  }

  /**
   * Centinela con mtime fresco. El cliente lo mira ANTES de escribir nada: si falta
   * o está rancio sabe que el bind se perdió (contenedor recreado) y falla en un
   * segundo, en vez de dejar la petición en una carpeta que nadie lee y esperar el
   * timeout largo. Ese caso, sin centinela, es de los peores de diagnosticar.
   */
  private tocarCentinela(dir: string): void {
    const ruta = path.join(dir, '.alive')
    try {
      // Solo se le cambia la hora a un archivo de verdad: un enlace del contenedor se sustituye, no se sigue.
      let esArchivo = false
      try {
        esArchivo = lstatSync(ruta).isFile()
      } catch {
        // No existe.
      }
      if (esArchivo) {
        const ahora = new Date()
        utimesSync(ruta, ahora, ahora)
      } else {
        escribirEnBuzon(ruta, 'tessera')
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * Recoge las peticiones nuevas de todos los perfiles preparados.
   *
   * EL LISTADO ES ASÍNCRONO A PROPÓSITO. Esto corre cada 250 ms y por CADA perfil
   * VIVO, aunque nunca se use `tdb`. Con un `readdirSync` eran 4 syscalls
   * BLOQUEANTES por segundo y por perfil clavadas en el hilo main, que es el mismo que
   * atiende todo el IPC. El problema era el `Sync`, no la frecuencia: 4 `readdir`
   * asíncronos sobre una carpeta vacía no se notan.
   *
   * "Vivo" es la palabra importante y no siempre lo fue: antes un perfil entraba al
   * tocarlo y no salía nunca, así que esto seguía sondeando buzones de contenedores
   * hibernados. Ahora `olvidarPerfil` los saca (ver su comentario).
   *
   * NO SE CAMBIA EL SONDEO POR UN `fs.watch`, aunque sea lo primero que se piensa: el
   * buzón lo escribe el contenedor a través del bind mount de WSL2, y
   * `ReadDirectoryChangesW` no garantiza esos eventos en Windows. Sería cambiar unas
   * syscalls baratas por un `tdb` que a veces no responde nunca.
   */
  private async repasar(): Promise<void> {
    for (const profileId of this.perfiles) {
      const dir = this.buzonDe(profileId)
      let entradas: string[]
      try {
        entradas = await readdir(dir)
      } catch {
        continue
      }
      for (const nombre of entradas) {
        if (!nombre.endsWith('.req.json')) continue
        const id = nombre.slice(0, -'.req.json'.length)
        const clave = `${profileId}/${id}`
        if (this.enCurso.has(clave)) continue
        this.enCurso.add(clave)
        void this.atender(dir, id, clave)
      }
    }
  }

  private async atender(dir: string, id: string, clave: string): Promise<void> {
    const rutaPeticion = path.join(dir, `${id}.req.json`)
    try {
      const cruda = this.leerPeticion(rutaPeticion)
      // La petición se borra ANTES de ejecutar: si `tdb` tardase y el repaso volviera
      // a pasar, no debe atenderse dos veces (el `enCurso` ya lo evita en memoria,
      // pero el archivo también tiene que desaparecer para no acumular basura).
      try {
        rmSync(rutaPeticion, { force: true })
      } catch {
        /* se recogerá por antigüedad */
      }
      // Sin `prog` (o `tdb`) es de `tdb`, como las de un cliente de antes.
      if (cruda && cruda.prog !== undefined && cruda.prog !== 'tdb') {
        await this.atenderPrograma(dir, id, cruda)
        return
      }
      const peticion = cruda ? peticionTdb(cruda) : null
      if (!peticion) {
        this.responder(dir, id, { exitCode: 2, stdout: '', stderr: 'petición ilegible\n' })
        return
      }
      // Un `--file` por el buzón no se ejecuta (ver `motivoRechazoArgv` y el ADR).
      const rechazo = motivoRechazoArgv(peticion.argv)
      if (rechazo !== null) {
        this.responder(dir, id, { exitCode: 2, stdout: '', stderr: rechazo })
        return
      }
      // ÁMBITO Y SECRETOS SIEMPRE DEL TOKEN, nunca de lo que venga en el archivo.
      const r = await this.deps.ejecutar(peticion.token, peticion.argv, peticion.entrada)
      this.responder(dir, id, r)
    } catch (err) {
      this.responder(dir, id, { exitCode: 2, stdout: '', stderr: `${String(err)}\n` })
    } finally {
      this.enCurso.delete(clave)
    }
  }

  /** Una petición de otro programa: la atiende quien la registró, con su tope de respuesta. */
  private async atenderPrograma(dir: string, id: string, cruda: Record<string, unknown>): Promise<void> {
    const programa = typeof cruda.prog === 'string' ? this.programas.get(cruda.prog) : undefined
    if (!programa || cruda.v !== 1 || typeof cruda.token !== 'string') {
      const que = typeof cruda.prog === 'string' ? cruda.prog.slice(0, 32) : '?'
      this.escribirRespuesta(dir, id, { exitCode: 2, stderr: `\n  ✗ Esta Tessera no sabe atender «${que}» por el buzón: reiníciala o actualízala.\n\n` })
      return
    }
    const r = await programa.atender(cruda)
    const texto = JSON.stringify({ ...r, v: 1 })
    if (texto.length <= programa.maxRespuesta) {
      this.escribirRespuesta(dir, id, texto)
      return
    }
    // Truncar en silencio haría creer que se vio todo, que es peor que un error.
    const mib = Math.round(programa.maxRespuesta / (1024 * 1024))
    this.escribirRespuesta(dir, id, { exitCode: 1, stderr: `\n  ✗ La respuesta superó los ${mib} MiB que admite el puente al host y se descartó.\n\n` })
  }

  /** El JSON de una petición (de cualquier programa), o null si no se puede leer o pasa del tope. */
  private leerPeticion(ruta: string): Record<string, unknown> | null {
    // Reintentos cortos: sobre 9p la entrada de directorio puede aparecer un
    // instante antes que el contenido (ver la nota simétrica en el cliente).
    for (let intento = 0; intento < 3; intento++) {
      try {
        // Un enlace del contenedor no se lee: apuntaría a un archivo del equipo.
        const st = lstatSync(ruta)
        if (!st.isFile() || st.size > MAX_PETICION) return null
        const texto = readFileSync(ruta, 'utf-8')
        if (!texto.trim()) continue
        const p = JSON.parse(texto) as unknown
        return p !== null && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
      } catch {
        /* siguiente intento */
      }
    }
    return null
  }

  private responder(
    dir: string,
    id: string,
    r: { exitCode: number; stdout: string; stderr: string }
  ): void {
    let { stdout, stderr } = r
    if (stdout.length > MAX_RESPUESTA) {
      // Truncar en silencio haría creer que se vio todo, que es peor que un error.
      stdout = ''
      stderr =
        `La respuesta superó los ${Math.round(MAX_RESPUESTA / (1024 * 1024))} MiB y se descartó.\n` +
        `Acota la consulta (por ejemplo con --limit).\n`
      r = { ...r, exitCode: 1 }
    }
    this.escribirRespuesta(dir, id, JSON.stringify({ v: 1, exitCode: r.exitCode, stdout, stderr }))
  }

  /** Escribe la respuesta a `.tmp` y renombra: el cliente nunca lee una a medias. */
  private escribirRespuesta(dir: string, id: string, r: string | RespuestaPrograma): void {
    const destino = path.join(dir, `${id}.res.json`)
    const tmp = `${destino}.tmp`
    try {
      escribirEnBuzon(tmp, typeof r === 'string' ? r : JSON.stringify({ v: 1, ...r }))
      renameSync(tmp, destino)
    } catch (err) {
      this.log(`no se pudo escribir la respuesta ${id}: ${String(err)}`)
    }
  }

  /**
   * Barre peticiones y respuestas huérfanas: las deja un contenedor que murió a
   * mitad, o un `tdb` que se rindió por timeout. Sin esto, el buzón crece sin fin.
   */
  private barrer(dir: string): void {
    const limite = Date.now() - HUERFANA_MS
    let barridas = 0
    try {
      for (const nombre of readdirSync(dir)) {
        if (!/\.(req|res)\.json(\.tmp)?$/.test(nombre)) continue
        const ruta = path.join(dir, nombre)
        try {
          if (statSync(ruta).mtimeMs > limite) continue
          rmSync(ruta, { force: true })
          barridas++
        } catch {
          /* siguiente */
        }
      }
    } catch {
      return
    }
    if (barridas > 0) this.log(`barridas ${barridas} entrada(s) huérfana(s) de ${dir}`)
  }
}
