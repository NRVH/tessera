// =============================================================================
// La cara de la descompilación hacia el resto del main: compone `JarService` (los bytes),
// `JavaRuntime` (qué JVM hay) y `Decompiler` (la ejecución), recuerda el java elegido a mano en
// `java-runtime.json` (con respaldo `.bak`) y barre los temporales la primera vez que hace falta.
// Las rutas de datos y de los motores las inyecta `src/main/index.ts`; los canales se registran
// en `ipc.ts`.
// Decisiones: docs/decisiones/java/descompilacion-con-motores-externos.md
// =============================================================================

import { promises as fs, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { esWindows } from '../../shared/plataforma.ts'
import {
  type DescompilarRequest,
  type DescompilarResult,
  type EstadoJava,
  type JavaVisible
} from '../../shared/java-ipc.ts'
import { contenedorEnDiscoDe, esNombreContenedor, esRutaVirtual } from '../../shared/jarPath.ts'
import { Decompiler } from './Decompiler.ts'
import { JavaRuntime } from './JavaRuntime.ts'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import type { JarService } from './JarService.ts'
import { elegirConDialogo } from '../util/adaptadores/dialogosNativos.ts'

/** Jars de contexto que se pasan como máximo (el resto se ignora). */
const MAX_CONTEXTO = 64

export interface JavaServiceOptions {
  jar: JarService
  /** Traduce una ruta del proyecto a ruta del host (la de FileService). */
  resolver: (relPosix: string) => string
  /** Carpeta de datos de la app (`userData`), donde vive `java-runtime.json`. */
  rutaDatos: string
  /** Carpeta con los jars de los motores (`<appPath>/vendor/java`). */
  dirMotores: string
  log?: (msg: string) => void
}

export class JavaService {
  private readonly jar: JarService
  private readonly resolver: (relPosix: string) => string
  private readonly log: (msg: string) => void
  private readonly rutaAjustes: string
  private readonly runtime: JavaRuntime
  private readonly decompiler: Decompiler
  /** Ver `barrerUnaVez`: el barrido de temporales es perezoso, no de arranque. */
  private barridoLanzado = false

  constructor(o: JavaServiceOptions) {
    this.jar = o.jar
    this.resolver = o.resolver
    this.log = o.log ?? ((m) => console.log(`[java] ${m}`))
    this.rutaAjustes = path.join(o.rutaDatos, 'java-runtime.json')
    const ajustes = this.leerAjustes()
    this.runtime = new JavaRuntime({
      log: this.log,
      elegido: ajustes.elegido,
      detectadasPrevias: ajustes.detectadas,
      selloPrevio: ajustes.sello,
      onDetectado: (jvms, sello) => this.guardarAjustes({ detectadas: [...jvms], sello })
    })
    this.decompiler = new Decompiler({
      jar: this.jar,
      runtime: this.runtime,
      dirMotores: o.dirMotores,
      log: this.log
    })
  }

  /**
   * Lo que se recuerda del runtime entre sesiones.
   *
   * Cae al respaldo `.bak` que `writeFileAtomicSync` deja, como el resto de stores
   * del repo. Sin eso, un corte de luz a mitad de escritura no solo perdía el
   * java.exe elegido a mano: la primera escritura posterior SELLABA la pérdida,
   * porque `guardarAjustes` mezcla sobre lo que `leerAjustes` devuelva.
   */
  private leerAjustes(): { elegido: string | null; detectadas: JavaVisible[]; sello: string | null } {
    return this.leerAjustesDe(this.rutaAjustes) ?? this.leerAjustesDe(`${this.rutaAjustes}.bak`) ?? {
      elegido: null,
      detectadas: [],
      sello: null
    }
  }

  /** Un intento de lectura. null si falta o es ilegible, para que el llamador siga. */
  private leerAjustesDe(
    ruta: string
  ): { elegido: string | null; detectadas: JavaVisible[]; sello: string | null } | null {
    try {
      const doc = JSON.parse(readFileSync(ruta, 'utf-8')) as {
        elegido?: unknown
        detectadas?: unknown
        sello?: unknown
      }
      const elegido = typeof doc.elegido === 'string' && doc.elegido !== '' ? doc.elegido : null
      const detectadas = Array.isArray(doc.detectadas)
        ? (doc.detectadas.filter(
            (j) => typeof j?.ruta === 'string' && typeof j?.major === 'number'
          ) as JavaVisible[])
        : []
      const sello = typeof doc.sello === 'string' && doc.sello !== '' ? doc.sello : null
      return { elegido, detectadas, sello }
    } catch {
      // No hay ajustes todavía (lo normal), o están ilegibles.
      return null
    }
  }

  /**
   * Recuerda el java.exe elegido ENTRE SESIONES. Sin esto, alguien con el JDK en una
   * ruta que la detección no cubre tendría que volver a navegar el diálogo nativo en
   * cada arranque de Tessera, y "Olvidar" no tendría nada real que olvidar.
   */
  private guardarElegido(elegido: string | null): void {
    this.guardarAjustes({ elegido })
  }

  /** Mezcla y persiste: nunca pierde el campo que no se le pasa. */
  private guardarAjustes(parcial: {
    elegido?: string | null
    detectadas?: JavaVisible[]
    sello?: string
  }): void {
    try {
      const actual = this.leerAjustes()
      const doc = {
        version: 1,
        elegido: parcial.elegido !== undefined ? parcial.elegido : actual.elegido,
        detectadas: parcial.detectadas !== undefined ? parcial.detectadas : actual.detectadas,
        sello: parcial.sello !== undefined ? parcial.sello : actual.sello
      }
      writeFileAtomicSync(this.rutaAjustes, JSON.stringify(doc, null, 2) + '\n')
    } catch (err) {
      // Que no se pueda persistir no invalida nada de ESTA sesión.
      this.log(`no se pudieron guardar los ajustes de Java: ${String(err)}`)
    }
  }

  dispose(): void {
    this.decompiler.dispose()
  }

  /**
   * El motor de descompilación, para quien traiga los bytes por su cuenta — hoy, el
   * diff de comprimidos, que saca la clase de un .jar que sólo existe como blob de
   * git y para el que no hay ninguna ruta del proyecto que valga.
   *
   * Se comparte la INSTANCIA y no se crea otra a propósito: el semáforo que limita
   * las JVM simultáneas y la caché de fuentes por contenido son de ella. Con dos
   * instancias habría el doble de `java.exe` a la vez y la clase que acabas de ver
   * en el visor no estaría cacheada para el diff.
   */
  get descompilador(): Decompiler {
    return this.decompiler
  }

  /** `java:runtimes`: las JVM detectadas y la elegida. */
  estado(): Promise<EstadoJava> {
    return this.runtime.estado()
  }

  /** `java:redetect`: vuelve a sondear el equipo. */
  redetectar(): Promise<EstadoJava> {
    return this.runtime.redetectar()
  }

  /** `java:forgetJava`: olvida el java elegido a mano, también entre sesiones. */
  olvidarJava(): Promise<EstadoJava> {
    this.guardarElegido(null)
    return this.runtime.usarElegido(null)
  }

  /**
   * Barre los temporales de una sesión que no cerró limpio, UNA vez y a demanda.
   *
   * Estaba en el constructor, y ahí lo pagaba todo el mundo: un `readdir` de %TEMP%
   * en cada arranque de Tessera por una herramienta que la mayoría de los proyectos
   * —front, o Java moderno— no usa nunca. Los temporales que barre los crea la
   * descompilación, así que la primera descompilación es el momento exacto en que
   * empieza a importar que estén ahí.
   */
  private barrerUnaVez(): void {
    if (this.barridoLanzado) return
    this.barridoLanzado = true
    void this.decompiler.barrerTemporales()
  }

  /** `java:decompile`. Nunca rechaza: un fallo vuelve como `estado` y `mensaje`. */
  async descompilar(req: DescompilarRequest): Promise<DescompilarResult> {
    this.barrerUnaVez()
    // La ruta del contenedor de disco (o la del propio .class suelto). resolveSafe
    // sigue siendo el único que traduce a Windows y valida el traversal.
    const enDisco = esRutaVirtual(req.path) ? contenedorEnDiscoDe(req.path) : req.path
    let absContenedor: string
    try {
      absContenedor = this.resolver(enDisco)
    } catch (err) {
      // El contrato promete que este canal NUNCA rechaza: `resolver` sí puede lanzar
      // (sin proyecto activo, ruta fuera del proyecto), y si se dejara salir, el
      // pane se quedaría colgado en "Descompilando…" sin nada que enseñar.
      return {
        path: req.path,
        targetKey: req.targetKey,
        token: req.token,
        estado: 'entrada-no-soportada',
        fuente: '',
        truncado: false,
        motor: null,
        motorVersion: '',
        javaMajor: 0,
        bytecode: null,
        sinNombresLocales: false,
        ms: 0,
        mensaje: err instanceof Error ? err.message : String(err),
        diagnostico: ''
      }
    }
    const contexto = await this.contextoDe(enDisco, absContenedor)

    return this.decompiler.descompilar({
      path: req.path,
      motor: req.motor,
      targetKey: req.targetKey,
      token: req.token,
      ignorarCache: req.ignorarCache,
      origen: { tipo: 'disco', absContenedor },
      contexto
    })
  }

  /**
   * Jars hermanos del que se está mirando, como classpath de contexto: con ellos los motores
   * resuelven genéricos y jerarquías que de otro modo salen como `Object`, y medido no cuesta
   * nada (CFR 278 ms con contexto frente a 304 sin él). Incluye el propio contenedor, donde
   * están la mayoría de los tipos que la clase usa. Es una lectura de directorio, no una
   * búsqueda recursiva: los jars que importan son los que están junto al que se abre.
   */
  private async contextoDe(relEnDisco: string, absContenedor: string): Promise<string[]> {
    const salida: string[] = []
    if (esNombreContenedor(relEnDisco)) salida.push(absContenedor)
    try {
      const dir = path.dirname(absContenedor)
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        if (!d.isFile() || !esNombreContenedor(d.name)) continue
        const abs = path.join(dir, d.name)
        if (abs !== absContenedor) salida.push(abs)
        if (salida.length >= MAX_CONTEXTO) break
      }
    } catch {
      // Sin hermanos: se descompila igual, solo con menos tipos resueltos.
    }
    return salida
  }

  /** `java:pickJava`: diálogo NATIVO para apuntar un `java` a mano. Corre en el main a propósito. */
  async elegirJava(): Promise<EstadoJava> {
    // Dónde abre, y que lo recuerde aunque el binario luego no valga:
    // `util/adaptadores/dialogosNativos.ts`.
    const r = await elegirConDialogo('java', {
      // El nombre del binario cambia con el sistema y el título lo dice: pedir
      // "java.exe" en un Mac manda al usuario a buscar un archivo que no existe.
      title: esWindows() ? 'Elige el ejecutable de Java (java.exe)' : 'Elige el ejecutable de Java (java)',
      properties: ['openFile'],
      filters: esWindows()
        ? [{ name: 'Ejecutable de Java', extensions: ['exe'] }]
        : [{ name: 'Ejecutable de Java', extensions: ['*'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return this.runtime.estado()

    const elegido = r.filePaths[0]
    const validacion = await this.runtime.validarJavaExe(elegido)
    if (!validacion.ok) {
      const estado = await this.runtime.estado()
      return { ...estado, mensaje: validacion.mensaje }
    }
    this.log(`java elegido a mano: ${elegido} (major ${validacion.major})`)
    this.guardarElegido(elegido)
    return this.runtime.usarElegido(elegido)
  }
}
