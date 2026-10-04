// =============================================================================
// Convierte un .class en código Java lanzando un motor externo (CFR o Vineflower) como subproceso
// corto y endurecido: extrae a un temporal la clase y sus internas con su ruta de paquete, lanza
// la JVM con el argv y el entorno de `decompilerArgs.ts`, recoge la fuente y la cachea por
// contenido. Nunca rechaza por un fallo del motor: devuelve `estado` y `mensaje`. Depende de
// `JarService` (los bytes) y `JavaRuntime` (qué JVM arranca cada motor).
// Decisiones: docs/decisiones/java/descompilacion-con-motores-externos.md
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type {
  DescompilarResult,
  EstadoDescompilacion,
  MotorDescompilador,
  MotorPedido
} from '../../shared/java-ipc.ts'
import {
  componerRutaArchivo,
  esRutaVirtual,
  nombreDeRuta,
  parseRutaArchivo,
  plataformaDeMajor
} from '../../shared/jarPath.ts'
import { VERSION_MOTOR, elegirMotor } from './javaVersion.ts'
import { argvMotor, envLimpio, pareceFuenteJava } from './decompilerArgs.ts'
import type { JavaRuntime } from './JavaRuntime.ts'
import type { JarService } from './JarService.ts'

/**
 * Las clases HERMANAS de la que se va a descompilar: los `Foo$*.class` que viven
 * junto a ella. Los nombres van SIEMPRE relativos a la carpeta de la clase
 * (`Foo$1.class`), vengan de un jar, de una carpeta o de un buffer, para que el
 * filtro de internas —que tiene dos reglas ganadas a base de bugs— se escriba UNA
 * vez y no una por origen.
 */
export interface HermanasDeClase {
  nombres: readonly string[]
  leer(nombre: string): Promise<Buffer>
  /**
   * Huella de una hermana para la clave de caché: algo que cambie cuando cambie su
   * contenido. Un jar da su CRC32 (ya parseado, cero lecturas) y el disco su
   * mtime+tamaño. Sin esto, dos revisiones cuya clase EXTERNA sea byte-idéntica
   * pero con una interna distinta compartirían resultado, y el diff diría "sin
   * cambios" enseñando código viejo — justo cuando se están comparando dos
   * revisiones a propósito.
   */
  sello(nombre: string): string
}

/** De dónde salen los bytes de la clase: una unión y no una ruta opcional, a propósito (ver el ADR). */
export type OrigenClase =
  | {
      tipo: 'disco'
      /** Ruta absoluta del contenedor (o del propio .class), validada por FileService. */
      absContenedor: string
    }
  | { tipo: 'bytes'; bytes: Buffer; hermanas: HermanasDeClase }

/** Origen sin hermanas: la degradación cuando no se pudo listar el vecindario. */
const SIN_HERMANAS: HermanasDeClase = {
  nombres: [],
  leer: () => Promise.reject(new Error('sin hermanas')),
  sello: () => ''
}

/** Tope de espera de un motor. Medido: CFR ~300 ms, Vineflower ~700 ms por clase.
 *  60 s es "algo va muy mal", no un presupuesto (mismo criterio que PS_TIMEOUT_MS). */
const DECOMP_TIMEOUT_MS = 60_000

/** Tope de salida acumulada. Molde: TDB_MAX_BUFFER = 32 MiB. */
const DECOMP_MAX_OUTPUT = 16 * 1024 * 1024

/** JVM simultáneas. Bajo a propósito: cada una son cientos de MB de RSS, así que el
 *  8 de DOCKER_CONCURRENCY aquí tumbaría el equipo. */
const DECOMP_CONCURRENCIA = 2

/** Tope del fuente que se manda al editor. El MISMO que el del editor de texto:
 *  un solo criterio de truncado en toda la app. */
const MAX_FUENTE_BYTES = 2 * 1024 * 1024

/** Entradas de fuente en caché (memoria). */
const CACHE_MAX = 64

/** Prefijo de los temporales, para poder barrerlos al arrancar. */
const PREFIJO_TMP = 'tessera-decomp-'

/** Edad mínima para que el barrido toque un temporal. Ver `barrerTemporales`. */
const EDAD_MINIMA_BARRIDO_MS = 30 * 60_000

/** Semáforo mínimo: el patrón de `runDocker`, sin la dependencia. */
class Semaforo {
  private activos = 0
  private readonly cola: Array<() => void> = []
  constructor(private readonly max: number) {}
  async adquirir(): Promise<void> {
    if (this.activos < this.max) {
      this.activos++
      return
    }
    return new Promise<void>((resolve) => this.cola.push(resolve))
  }
  liberar(): void {
    const siguiente = this.cola.shift()
    if (siguiente) siguiente()
    else this.activos--
  }
}

export interface DecompilerOptions {
  jar: JarService
  runtime: JavaRuntime
  /** Carpeta con los jars de los motores (`<appPath>/vendor/java`, igual en dev y empaquetado por `asar: false`). */
  dirMotores: string
  log?: (msg: string) => void
}

export class Decompiler {
  private readonly jar: JarService
  private readonly runtime: JavaRuntime
  private readonly dirMotores: string
  private readonly log: (msg: string) => void
  private readonly sem = new Semaforo(DECOMP_CONCURRENCIA)
  private readonly cache = new Map<string, DescompilarResult>()
  /** Procesos vivos, para matarlos al cerrar la app y no dejar java.exe huérfanos. */
  private readonly vivos = new Set<ChildProcess>()
  private cerrado = false

  constructor(o: DecompilerOptions) {
    this.jar = o.jar
    this.runtime = o.runtime
    this.dirMotores = o.dirMotores
    this.log = o.log ?? ((m) => console.log(`[decompiler] ${m}`))
  }

  /** Mata lo que quede vivo y vacía la caché. */
  dispose(): void {
    this.cerrado = true
    for (const p of this.vivos) {
      try {
        p.kill('SIGKILL')
      } catch {
        // ya murió
      }
    }
    this.vivos.clear()
    this.cache.clear()
  }

  /**
   * Borra los temporales que dejó una ejecución anterior que no cerró limpio.
   *
   * Solo los que llevan un buen rato parados: si hay OTRA instancia de Tessera
   * descompilando ahora mismo (o esta arrancó mientras la anterior aún cerraba),
   * borrarle su carpeta a media ejecución haría que su motor saliera con error y el
   * usuario vería 'motor-fallo' en una clase perfectamente sana. Una descompilación
   * dura menos de un segundo; media hora de margen es de sobra.
   */
  async barrerTemporales(): Promise<void> {
    const base = os.tmpdir()
    const limite = Date.now() - EDAD_MINIMA_BARRIDO_MS
    try {
      for (const nombre of await fs.readdir(base)) {
        if (!nombre.startsWith(PREFIJO_TMP)) continue
        const dir = path.join(base, nombre)
        try {
          const stat = await fs.stat(dir)
          if (stat.mtimeMs > limite) continue
          await fs.rm(dir, { recursive: true, force: true })
        } catch {
          // Otro proceso lo está usando o ya lo borró: se deja en paz.
        }
      }
    } catch {
      // Sin acceso al temporal: no es motivo para tumbar el arranque.
    }
  }

  async descompilar(req: {
    /**
     * Ruta CANÓNICA de la clase (`lib/x.jar!/com/A.class`), sin marca de revisión.
     * Entra en la clave de caché, así que dos peticiones de la MISMA clase con los
     * mismos bytes tienen que traer la misma ruta para compartir acierto: si el
     * llamador le pegara el hash del commit, ir y volver entre dos revisiones
     * volvería a arrancar una JVM cada vez.
     */
    path: string
    motor: MotorPedido
    targetKey: string
    token: number
    ignorarCache?: boolean
    /** De dónde salen los bytes: un archivo del proyecto o un buffer suelto. */
    origen: OrigenClase
    /** Jars hermanos que se pasan como contexto de tipos. */
    contexto: readonly string[]
  }): Promise<DescompilarResult> {
    const base = {
      path: req.path,
      targetKey: req.targetKey,
      token: req.token,
      fuente: '',
      truncado: false,
      motor: null as MotorDescompilador | null,
      motorVersion: '',
      javaMajor: 0,
      bytecode: null as DescompilarResult['bytecode'],
      sinNombresLocales: false,
      ms: 0,
      mensaje: '',
      diagnostico: ''
    }
    const t0 = Date.now()

    // --- 1. Bytes de la clase -------------------------------------------------
    let bytes: Buffer
    try {
      if (req.origen.tipo === 'bytes') {
        bytes = req.origen.bytes
      } else {
        bytes = esRutaVirtual(req.path)
          ? await this.jar.leerBytes(req.origen.absContenedor, req.path)
          : await fs.readFile(req.origen.absContenedor)
      }
    } catch (err) {
      return {
        ...base,
        estado: 'entrada-no-soportada',
        ms: Date.now() - t0,
        mensaje: err instanceof Error ? err.message : String(err)
      }
    }

    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0xcafebabe) {
      return {
        ...base,
        estado: 'entrada-no-soportada',
        ms: Date.now() - t0,
        mensaje: 'Este archivo no es una clase de Java (le falta la firma 0xCAFEBABE).'
      }
    }
    const minor = bytes.readUInt16BE(4)
    const major = bytes.readUInt16BE(6)
    const bytecode = { major, minor, plataforma: plataformaDeMajor(major) }

    // --- 2. Motor y JVM -------------------------------------------------------
    const estadoJava = await this.runtime.estado()
    if (!estadoJava.disponible) {
      return { ...base, bytecode, estado: 'sin-java', ms: Date.now() - t0, mensaje: estadoJava.mensaje }
    }
    const { motor, degradado } = elegirMotor(req.motor, major, estadoJava.paraVineflower !== undefined)
    if (motor === null) {
      const vf = estadoJava.motores.find((m) => m.motor === 'vineflower')
      return {
        ...base,
        bytecode,
        estado: 'motor-no-soportado',
        ms: Date.now() - t0,
        mensaje: vf?.motivo ?? 'Ese motor no se puede usar con las versiones de Java que hay en el equipo.'
      }
    }
    const jvm = motor === 'vineflower' ? estadoJava.paraVineflower! : estadoJava.paraCfr!

    // --- 3. Caché -------------------------------------------------------------
    // Las hermanas se resuelven ANTES de mirar la caché porque entran en su clave
    // (ver `HermanasDeClase.sello`), y eso mueve un poco de E/S a un camino que antes
    // no la tenía: en un jar es el índice YA CACHEADO (gratis), pero en un `.class`
    // suelto es un `readdir` de su carpeta de paquete —más un `stat` por cada
    // interna— también cuando el resultado iba a salir de la caché. Se paga a
    // propósito: sin los sellos, dos revisiones con la clase externa byte-idéntica y
    // una interna distinta compartirían resultado, y el diff diría "sin cambios"
    // enseñando código viejo. El coste es una carpeta de paquete (decenas de
    // archivos), no el árbol de salida entero.
    const hermanas = await this.hermanasDe(req.path, req.origen)
    const clave = createHash('sha256')
      .update(req.path)
      .update('|')
      .update(createHash('sha256').update(bytes).digest('hex'))
      .update(`|${motor}|${VERSION_MOTOR[motor]}|${jvm.major}`)
      .update('|')
      .update(this.huellaHermanas(req.path, hermanas))
      .update('|')
      // El contexto CAMBIA la salida (resuelve tipos, genéricos y supertipos) y no
      // estaba en la clave: la misma clase con distintos jars al lado devolvía el
      // resultado de la primera vez. Se nota justo aquí, donde un lado trae
      // contexto de disco y el otro, que sale de un blob, no trae ninguno.
      // Separador NUL ESCRITO COMO ESCAPE (`test:fuentes-limpias` vigila que no se
      // pegue el byte crudo). Es el separador correcto para juntar rutas en un
      // hash: no puede aparecer dentro de ninguna.
      .update(req.contexto.join('\u0000'))
      .digest('hex')
    if (req.ignorarCache !== true) {
      const hit = this.cache.get(clave)
      if (hit !== undefined) {
        // Rejuvenece (Map conserva el orden de inserción = LRU en dos líneas).
        this.cache.delete(clave)
        this.cache.set(clave, hit)
        return { ...hit, targetKey: req.targetKey, token: req.token, estado: 'cache', ms: Date.now() - t0 }
      }
    }

    // --- 4. Ejecutar ----------------------------------------------------------
    const resultado = await this.ejecutar({
      req,
      bytes,
      hermanas,
      motor,
      jvm,
      bytecode,
      degradado,
      base,
      t0
    })
    if (resultado.estado === 'ok') {
      this.cache.set(clave, resultado)
      while (this.cache.size > CACHE_MAX) {
        const primera = this.cache.keys().next()
        if (primera.done === true) break
        this.cache.delete(primera.value)
      }
    }
    return resultado
  }

  /**
   * Huella de las internas que de verdad se van a extraer (nombre + sello), en
   * orden estable. Se filtra con el MISMO criterio que `prepararEntrada` porque una
   * huella que mirara todo el vecindario invalidaría la caché cada vez que cambia
   * una clase que no tiene nada que ver.
   */
  private huellaHermanas(rutaVirtual: string, hermanas: HermanasDeClase): string {
    const raiz = nombreDeRuta(rutaVirtual).slice(0, -'.class'.length)
    return [...hermanas.nombres]
      .filter((n) => this.esInternaDe(raiz, n))
      .sort()
      .map((n) => `${n}:${hermanas.sello(n)}`)
      .join('|')
  }

  /**
   * ¿`nombre` es una interna de la clase `raiz` en su MISMO nivel? Un nombre como
   * `Bar$baz/Qux.class` pasa el filtro de prefijo pero colgaría de un subdirectorio
   * inexistente, así que la barra descarta.
   */
  private esInternaDe(raiz: string, nombre: string): boolean {
    return nombre.startsWith(`${raiz}$`) && nombre.endsWith('.class') && !nombre.includes('/')
  }

  /**
   * El vecindario de la clase, normalizado a nombres relativos a su carpeta.
   *
   * Tres orígenes y una sola forma de consumirlos: un contenedor (el índice del
   * jar), un `.class` suelto (la carpeta de al lado) o un buffer (el proveedor que
   * trae quien lo pidió). Cualquier fallo degrada a "sin hermanas" y se descompila
   * igual: perder una clase anónima es peor que no enseñar nada, pero no tanto como
   * fallar entero.
   */
  private async hermanasDe(rutaVirtual: string, origen: OrigenClase): Promise<HermanasDeClase> {
    if (origen.tipo === 'bytes') return origen.hermanas

    if (esRutaVirtual(rutaVirtual)) {
      try {
        const indice = await this.jar.indiceDe(origen.absContenedor, rutaVirtual)
        const paquete = this.paqueteDe(rutaVirtual)
        const prefijo = paquete === '' ? '' : `${paquete}/`
        const porNombre = new Map<string, number>()
        for (const e of indice.entradas) {
          if (!e.nombre.startsWith(prefijo)) continue
          porNombre.set(e.nombre.slice(prefijo.length), e.crc32)
        }
        return {
          nombres: [...porNombre.keys()],
          leer: (n) =>
            this.jar.leerBytes(origen.absContenedor, this.rutaHermana(rutaVirtual, prefijo + n)),
          sello: (n) => String(porNombre.get(n) ?? '')
        }
      } catch {
        return SIN_HERMANAS
      }
    }

    const dirOrigen = path.dirname(origen.absContenedor)
    try {
      const nombres = await fs.readdir(dirOrigen)
      const sellos = new Map<string, string>()
      const raiz = nombreDeRuta(rutaVirtual).slice(0, -'.class'.length)
      // El stat sólo de las que van a entrar: en `target/classes` hay miles de
      // archivos y sólo interesan las internas de ESTA clase.
      for (const n of nombres) {
        if (!this.esInternaDe(raiz, n)) continue
        try {
          const st = await fs.stat(path.join(dirOrigen, n))
          sellos.set(n, `${st.mtimeMs}:${st.size}`)
        } catch {
          sellos.set(n, '')
        }
      }
      return {
        nombres,
        leer: (n) => fs.readFile(path.join(dirOrigen, n)),
        sello: (n) => sellos.get(n) ?? ''
      }
    } catch {
      return SIN_HERMANAS
    }
  }

  private async ejecutar(ctx: {
    req: { path: string; contexto: readonly string[] }
    bytes: Buffer
    hermanas: HermanasDeClase
    motor: MotorDescompilador
    jvm: { ruta: string; major: number }
    bytecode: NonNullable<DescompilarResult['bytecode']>
    degradado: boolean
    base: Omit<DescompilarResult, 'estado'>
    t0: number
  }): Promise<DescompilarResult> {
    const { req, motor, jvm, bytecode, base, t0 } = ctx
    this.log(`descompilando ${req.path} con ${motor} (JVM ${jvm.major})`)
    const dirTmp = await fs.mkdtemp(path.join(os.tmpdir(), PREFIJO_TMP))
    try {
      // --- extraer la clase Y SUS INTERNAS conservando la ruta de paquete ---
      const { dirEntrada, claseEntrada, sinNombresLocales } = await this.prepararEntrada(
        dirTmp,
        req.path,
        ctx.hermanas,
        ctx.bytes
      )
      const dirSalida = path.join(dirTmp, 'out')
      await fs.mkdir(dirSalida, { recursive: true })

      const args = argvMotor(motor, {
        jarMotor: path.join(this.dirMotores, motor === 'cfr' ? 'cfr-0.152.jar' : 'vineflower-1.12.0.jar'),
        javaMajor: jvm.major,
        dirEntrada,
        claseEntrada,
        dirSalida,
        contexto: req.contexto
      })

      await this.sem.adquirir()
      let salida: { code: number | null; stdout: Buffer; stderr: string; timeout: boolean; excedido: boolean }
      try {
        salida = await this.spawn(jvm.ruta, args)
      } finally {
        this.sem.liberar()
      }

      const diagnostico = salida.stderr.slice(-4096)
      const comun = {
        ...base,
        bytecode,
        motor,
        motorVersion: VERSION_MOTOR[motor],
        javaMajor: jvm.major,
        sinNombresLocales,
        ms: Date.now() - t0,
        diagnostico
      }

      if (salida.excedido) {
        return {
          ...comun,
          estado: 'salida-excesiva',
          mensaje:
            'El descompilador generó más texto del que Tessera puede mostrar y se detuvo. ' +
            'Suele pasar con clases generadas automáticamente.'
        }
      }
      if (salida.timeout) {
        return {
          ...comun,
          estado: 'timeout',
          mensaje: `El descompilador tardó más de ${DECOMP_TIMEOUT_MS / 1000} s con esta clase y se detuvo.`
        }
      }
      if (salida.code !== 0) {
        return {
          ...comun,
          estado: 'motor-fallo',
          mensaje:
            `${motor === 'cfr' ? 'CFR' : 'Vineflower'} no pudo descompilar esta clase ` +
            `(terminó con código ${salida.code}). Prueba con el otro motor.`
        }
      }

      // --- recoger la fuente ---
      const fuente =
        motor === 'cfr'
          ? salida.stdout.toString('utf8')
          : await this.recogerSalidaVineflower(dirSalida, req.path)

      if (fuente.trim() === '' || !pareceFuenteJava(fuente)) {
        return {
          ...comun,
          estado: 'motor-vacio',
          mensaje:
            `${motor === 'cfr' ? 'CFR' : 'Vineflower'} terminó sin errores pero no produjo código para esta clase. ` +
            'Prueba con el otro motor.'
        }
      }

      const truncado = Buffer.byteLength(fuente, 'utf8') > MAX_FUENTE_BYTES
      const aviso = ctx.degradado
        ? 'Se usó CFR porque no hay ningún JDK 17 o superior instalado para ejecutar Vineflower.'
        : ''
      return {
        ...comun,
        estado: 'ok',
        fuente: truncado ? fuente.slice(0, MAX_FUENTE_BYTES) : fuente,
        truncado,
        mensaje: aviso
      }
    } catch (err) {
      return {
        ...base,
        bytecode,
        estado: 'motor-fallo',
        ms: Date.now() - t0,
        mensaje: err instanceof Error ? err.message : String(err)
      }
    } finally {
      await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /**
   * Deja en el temporal la clase pedida y todas sus internas, con su ruta de paquete
   * completa desde una raíz. Devuelve esa raíz y la ruta del .class principal.
   */
  private async prepararEntrada(
    dirTmp: string,
    rutaVirtual: string,
    hermanas: HermanasDeClase,
    bytes: Buffer
  ): Promise<{ dirEntrada: string; claseEntrada: string; sinNombresLocales: boolean }> {
    const dirEntrada = path.join(dirTmp, 'in')
    const nombre = nombreDeRuta(rutaVirtual)
    const paquete = this.paqueteDe(rutaVirtual)
    const destinoDir = paquete === '' ? dirEntrada : path.join(dirEntrada, ...paquete.split('/'))
    await fs.mkdir(destinoDir, { recursive: true })

    const claseEntrada = path.join(destinoDir, nombre)
    await fs.writeFile(claseEntrada, bytes)

    // Las internas: mismo prefijo + '$'. Sin ellas, CFR pierde las clases anónimas
    // y Vineflower emite referencias inválidas. El vecindario ya viene normalizado
    // (`hermanasDe`), así que el filtro —y sus dos reglas caras— se aplica una sola
    // vez para las tres procedencias.
    const raizNombre = nombre.slice(0, -'.class'.length)
    for (const n of hermanas.nombres) {
      if (!this.esInternaDe(raizNombre, n)) continue
      // El try va DENTRO del bucle a propósito: si estaba fuera, un fallo al
      // escribir UNA interna abortaba el resto y las clases anónimas siguientes
      // desaparecían del fuente sin ningún aviso.
      try {
        await fs.writeFile(path.join(destinoDir, n), await hermanas.leer(n))
      } catch {
        // Esta interna no se pudo extraer; las demás sí.
      }
    }

    return { dirEntrada, claseEntrada, sinNombresLocales: !tieneLocalVariableTable(bytes) }
  }

  /**
   * Ruta virtual de una entrada hermana dentro del MISMO contenedor.
   *
   * Se compone con el parser anclado y no con `lastIndexOf('!/')`: una carpeta
   * dentro del jar llamada literalmente `dir!` haría que el corte crudo cayera
   * detrás de ella y se compusieran rutas que no existen.
   */
  private rutaHermana(rutaVirtual: string, nombreInterno: string): string {
    const partido = parseRutaArchivo(rutaVirtual)
    if (partido === null) return rutaVirtual
    const entradas = [...partido.entradas]
    entradas[entradas.length - 1] = nombreInterno
    return componerRutaArchivo(partido.contenedor, entradas)
  }

  /**
   * El PAQUETE de la clase, es decir la ruta que debe tener bajo la raíz del árbol
   * temporal para que Vineflower reconstruya el árbol de paquetes.
   *
   * Solo se puede deducir de la ruta cuando la clase vive DENTRO de un contenedor:
   * ahí la ruta interna ES la ruta de paquete. Un `.class` suelto en disco puede
   * estar en cualquier sitio (`target/classes/com/x/A.class`, o suelto en el
   * Escritorio), y usar su ruta de disco como paquete —que es lo que hacía el corte
   * crudo— construía un árbol falso: la clase declara `com.x` pero quedaba colgando
   * de `target/classes/com/x`. Para ese caso se devuelve '' y se deja la clase en la
   * raíz del temporal: los dos motores la leen igual, y el fuente se recoge
   * recorriendo la salida entera.
   */
  private paqueteDe(rutaVirtual: string): string {
    const partido = parseRutaArchivo(rutaVirtual)
    if (partido === null) return ''
    const interna = partido.entradas[partido.entradas.length - 1]
    const barra = interna.lastIndexOf('/')
    return barra < 0 ? '' : interna.slice(0, barra)
  }

  /**
   * Junta los .java que produjo Vineflower. El principal primero y, detrás, las
   * clases internas que dejó SUELTAS.
   *
   * Eso pasa de verdad: por debajo del class file 49 los .class de clases anónimas
   * no traen `EnclosingMethod`, Vineflower no puede saber a qué método pertenecen y
   * las emite en su propio fichero, dejando en la externa una referencia
   * `new Foo$1(this)` que ni siquiera compila. Concatenarlas es lo único que permite
   * al usuario leer qué hacía esa clase anónima.
   */
  private async recogerSalidaVineflower(dirSalida: string, rutaVirtual: string): Promise<string> {
    const ficheros: string[] = []
    const recorrer = async (dir: string): Promise<void> => {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name)
        if (d.isDirectory()) await recorrer(p)
        else if (d.name.endsWith('.java')) ficheros.push(p)
      }
    }
    await recorrer(dirSalida).catch(() => undefined)
    if (ficheros.length === 0) return ''

    const principal = nombreDeRuta(rutaVirtual).replace(/\.class$/, '.java')
    ficheros.sort((a, b) => {
      const aEs = path.basename(a) === principal ? 0 : 1
      const bEs = path.basename(b) === principal ? 0 : 1
      return aEs - bEs || a.localeCompare(b, 'es')
    })

    const partes: string[] = []
    for (const [i, f] of ficheros.entries()) {
      const texto = await fs.readFile(f, 'utf8')
      if (i === 0) {
        partes.push(texto)
        continue
      }
      partes.push(
        `\n// ${'='.repeat(74)}\n` +
          `// ${path.basename(f)} — clase interna que el descompilador no pudo plegar dentro\n` +
          `// de su clase externa (este .class no trae EnclosingMethod: se compiló con\n` +
          `// Java 1.4 o anterior).\n` +
          `// ${'='.repeat(74)}\n` +
          texto
      )
    }
    return partes.join('\n')
  }

  /** Lanza el motor con timeout y tope de salida. Nunca rechaza. */
  private spawn(
    exe: string,
    args: string[]
  ): Promise<{ code: number | null; stdout: Buffer; stderr: string; timeout: boolean; excedido: boolean }> {
    return new Promise((resolve) => {
      const hijo = spawn(exe, args, {
        env: envLimpio(process.env),
        windowsHide: true
      })
      this.vivos.add(hijo)

      const trozos: Buffer[] = []
      let bytes = 0
      let stderr = ''
      let resuelto = false
      const acabar = (r: {
        code: number | null
        stdout: Buffer
        stderr: string
        timeout: boolean
        excedido: boolean
      }): void => {
        if (resuelto) return
        resuelto = true
        clearTimeout(temporizador)
        this.vivos.delete(hijo)
        resolve(r)
      }
      const temporizador = setTimeout(() => {
        try {
          hijo.kill('SIGKILL')
        } catch {
          // ya murió
        }
        acabar({ code: null, stdout: Buffer.concat(trozos), stderr, timeout: true, excedido: false })
      }, DECOMP_TIMEOUT_MS)

      hijo.stdout.on('data', (d: Buffer) => {
        bytes += d.length
        if (bytes > DECOMP_MAX_OUTPUT) {
          try {
            hijo.kill('SIGKILL')
          } catch {
            // ya murió
          }
          // Pasarse del tope NO es colgarse: se distingue, o el mensaje mandaría a
          // investigar un cuelgue de 60 s que nunca ocurrió.
          acabar({ code: null, stdout: Buffer.concat(trozos), stderr, timeout: false, excedido: true })
          return
        }
        trozos.push(d)
      })
      hijo.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
      })
      hijo.on('error', (err) => {
        acabar({ code: null, stdout: Buffer.alloc(0), stderr: stderr + String(err), timeout: false, excedido: false })
      })
      hijo.on('close', (code) => {
        acabar({ code, stdout: Buffer.concat(trozos), stderr, timeout: false, excedido: false })
      })

      if (this.cerrado) {
        try {
          hijo.kill('SIGKILL')
        } catch {
          // ya murió
        }
      }
    })
  }
}

/**
 * ¿La clase trae `LocalVariableTable`? Sin él, los nombres de los parámetros y de
 * las variables locales NO están en el .class y el fuente sale con `var1`, `var2`.
 * Se busca la cadena en el pool de constantes, que es donde vive el nombre de todo
 * atributo: es una heurística barata y suficiente para poner el aviso en la barra.
 */
function tieneLocalVariableTable(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from('LocalVariableTable', 'latin1'))
}

export { DECOMP_TIMEOUT_MS, DECOMP_CONCURRENCIA, MAX_FUENTE_BYTES }
export type { EstadoDescompilacion }
