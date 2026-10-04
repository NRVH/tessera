// =============================================================================
// Encuentra las JVM instaladas en el equipo (registro, carpetas conocidas por plataforma,
// JAVA_HOME, PATH), las sondea con `java -version` de forma perezosa y acotada, recuerda el
// resultado con una huella del entorno y elige para cada motor la mayor que cumple su requisito.
// Depende de `javaVersion.ts` para parsear y decidir. Lo compone `JavaService`.
// Decisiones: docs/decisiones/java/deteccion-de-jvm-y-eleccion-de-motor.md
// =============================================================================

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import * as os from 'node:os'
import { esMac, esWindows } from '../../shared/plataforma.ts'
import * as path from 'node:path'
import type { EstadoJava, JavaVisible, MotorDisponible, OrigenJava } from '../../shared/java-ipc.ts'
import {
  REQUIERE_MAJOR,
  VERSION_MOTOR,
  dedupePorRuta,
  majorDeVersion,
  mejorJvmPara,
  ordenarJvms,
  primeraLineaVersion
} from './javaVersion.ts'

/** Tope de espera de un sondeo. `java -version` está medido en ~100 ms. */
const SONDEO_TIMEOUT_MS = 5_000
/** Tope de espera de un `reg query`. */
const REG_TIMEOUT_MS = 3_000
/**
 * Cuántas JVM se sondean a la vez.
 *
 * 4, y NO más, con medición detrás: cada `java -version` arranca una JVM de verdad y
 * en este Windows tarda ~2 s de mediana (Defender). Subirlo no acorta el total —12
 * candidatos: 10,9 s con 4, 9,6 s con 16— pero SÍ hace que compitan entre ellos: la
 * mediana por sondeo pasa de 2,0 s a 5,1 s y varios superan SONDEO_TIMEOUT_MS, así
 * que se PIERDEN JVM (12 detectadas con 4, solo 7 con 16). Más paralelismo aquí es
 * peor, no mejor.
 */
const CONCURRENCIA_SONDEO = 4

/** Claves del registro donde los instaladores de Java apuntan su JavaHome. */
const CLAVES_REGISTRO = [
  'HKLM\\SOFTWARE\\JavaSoft\\JDK',
  'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
  'HKLM\\SOFTWARE\\JavaSoft\\JRE',
  'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment'
]

/** Carpetas donde suelen vivir los JDK en Windows. */
function carpetasConocidas(): string[] {
  const home = os.homedir()

  // Las dos que son iguales en todas partes, porque las crean herramientas
  // multiplataforma y no el sistema: `.jdks` la escriben los IDE al descargar un JDK
  // desde ellos mismos, y `.sdkman` es SDKMAN!. Van en las dos ramas.
  const comunes = [path.join(home, '.jdks'), path.join(home, '.sdkman', 'candidates', 'java')]

  if (esMac()) {
    // EN macOS LOS JDK NO SON CARPETAS, SON BUNDLES. Lo que hay dentro de estas rutas
    // es `<jdk>/Contents/Home/bin/java`, con una capa `Contents/Home` de más que en
    // Windows no existe; de eso se encarga `ejecutable()`, y sin ella la etapa 2
    // encontraba CERO JDK aunque hubiera tres instalados.
    return [
      // La ubicación oficial de Apple. La del usuario primero: es donde dejan los JDK
      // los IDE y los instaladores modernos, y no necesita administrador.
      path.join(home, 'Library', 'Java', 'JavaVirtualMachines'),
      '/Library/Java/JavaVirtualMachines',
      // Homebrew: `openjdk` y sus versiones fijadas (`openjdk@17`, `openjdk@21`). Se
      // listan las dos raíces porque un Mac Intel usa `/usr/local` y uno con Apple
      // Silicon `/opt/homebrew`, y una instalación migrada puede tener las dos.
      '/opt/homebrew/opt',
      '/usr/local/opt',
      ...comunes
    ]
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  return [
    path.join(programFiles, 'Java'),
    path.join(programFiles, 'Eclipse Adoptium'),
    path.join(programFiles, 'Microsoft'),
    path.join(programFiles, 'Amazon Corretto'),
    path.join(programFiles, 'Zulu'),
    ...comunes,
    path.join(localAppData, 'Programs', 'Eclipse Adoptium')
  ]
}

/**
 * Huella barata del entorno de Java. Mientras no cambie, lo recordado sigue valiendo.
 *
 * Instalar o borrar un JDK mueve al menos una de estas tres cosas: `JAVA_HOME`, el
 * `PATH`, o el mtime de la carpeta que lo aloja (crear `jdk-21` dentro de
 * `Program Files\Java` reescribe el directorio padre). Calcular la huella cuesta un
 * `stat` por carpeta conocida —microsegundos— frente a los ~18 s del sondeo entero.
 *
 * Se probó fiarse de lo recordado a secas, con solo un `existsSync` por ruta, y se
 * retiró: convertía la lista de la PRIMERA sesión en permanente. Un equipo que
 * entonces solo tenía un JDK 8 seguía diciendo "el más nuevo que se encontró es 8"
 * en todas las sesiones siguientes, aunque el usuario instalara un JDK 21 después;
 * la única cura era borrar java-runtime.json a mano. Recordar no puede significar
 * no volver a mirar JAMÁS.
 */
async function selloEntorno(jvms: readonly JavaVisible[]): Promise<string> {
  const partes = [process.env.JAVA_HOME ?? '', process.env.PATH ?? '']
  for (const base of carpetasConocidas()) {
    try {
      partes.push(`${base}=${(await fsp.stat(base)).mtimeMs}`)
    } catch {
      // No existe (lo normal en la mayoría): su ausencia también forma parte de la
      // huella, porque crearla es justo lo que hace un instalador de JDK.
      partes.push(`${base}=-`)
    }
  }
  // Y los propios java.exe recordados, por tamaño y fecha. Es lo que cubre el caso
  // que las carpetas NO ven: un JDK actualizado EN SU SITIO, con la misma ruta y el
  // mismo nombre de carpeta. Con solo `existsSync` la ruta seguía existiendo y
  // Tessera seguía anunciando el major VIEJO: elegía esa JVM para lanzar un motor
  // que ya no soporta, o descartaba Vineflower creyendo que no llega a 17 cuando
  // ahora sí. Ordenado por ruta para que la huella no dependa del orden de la lista.
  for (const j of [...jvms].sort((a, b) => a.ruta.localeCompare(b.ruta))) {
    try {
      const st = await fsp.stat(j.ruta)
      partes.push(`${j.ruta}=${j.major}=${st.size}=${st.mtimeMs}`)
    } catch {
      partes.push(`${j.ruta}=-`)
    }
  }
  return createHash('sha1').update(partes.join('\u0000')).digest('hex')
}

interface Candidato {
  ruta: string
  origen: OrigenJava
}

/** Nombre del ejecutable según la plataforma. */
const EXE = esWindows() ? 'java.exe' : 'java'

/**
 * El `java` de un JAVA_HOME… que en macOS puede estar una capa más adentro.
 *
 * En Windows y Linux un JDK es una carpeta con `bin/java` dentro y no hay más. En
 * macOS un JDK es un BUNDLE: lo que se instala en
 * `~/Library/Java/JavaVirtualMachines/openjdk-24` es un paquete cuyo home real es
 * `openjdk-24/Contents/Home`, y el ejecutable cuelga de ahí.
 *
 * Sin esta capa, la etapa 2 recorría las carpetas correctas, hacía `existsSync` de
 * `<jdk>/bin/java` —que no existe— y concluía que no había NINGÚN JDK instalado, con
 * tres perfectamente instalados. Abrir un `.class` fallaba con "no se encontró una
 * JVM", que es cierto pero por el motivo equivocado.
 *
 * Devuelve la ruta DIRECTA si ninguna de las dos existe: los llamadores ya comprueban
 * con `existsSync`, y así el valor de retorno sigue siendo la ruta "canónica" para los
 * mensajes de error.
 */
function ejecutable(javaHome: string): string {
  const directo = path.join(javaHome, 'bin', EXE)
  // El `esMac()` evita un `existsSync` inútil por candidato en Windows, donde este
  // layout no existe; la etapa 2 llama a esto una vez por subcarpeta.
  if (!esMac() || existsSync(directo)) return directo
  const bundle = path.join(javaHome, 'Contents', 'Home', 'bin', EXE)
  return existsSync(bundle) ? bundle : directo
}

/** Lanza un proceso corto y devuelve su salida; nunca rechaza. */
function correr(
  cmd: string,
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ok: !err })
      }
    )
  })
}

export interface JavaRuntimeOptions {
  log?: (msg: string) => void
  /** java.exe apuntado a mano por el usuario (persistido por quien nos construye). */
  elegido?: string | null
  /**
   * JVM detectadas en una sesión ANTERIOR, para no repetir el sondeo completo.
   *
   * La detección desde cero está medida en ~18 s con 12 JDK instalados, y eso lo
   * pagaba entero la primera clase que se abriera. Como las JVM no aparecen ni
   * desaparecen solas, se reutiliza lo que ya se supo y solo se comprueba que los
   * ejecutables sigan existiendo (un `existsSync` por ruta, microsegundos).
   *
   * Reutilizar SOLO vale mientras el entorno de Java no se haya movido: ver
   * `selloEntorno` y `selloPrevio`. Sin esa condición, recordar se convertía en no
   * volver a mirar jamás.
   */
  detectadasPrevias?: readonly JavaVisible[]
  /**
   * Huella del entorno cuando se detectaron `detectadasPrevias`. Si no coincide con
   * la de ahora, lo recordado se descarta y se sondea de verdad.
   */
  selloPrevio?: string | null
  /** Se llama con las JVM recién detectadas y la huella de este entorno, para persistirlas. */
  onDetectado?: (jvms: readonly JavaVisible[], sello: string) => void
}

export class JavaRuntime {
  private readonly log: (msg: string) => void
  private elegido: string | null
  private cache: EstadoJava | null = null
  private enVuelo: Promise<EstadoJava> | null = null
  /** Sube en cada invalidación: una detección vieja no puede pisar una caché nueva. */
  private generacion = 0
  private readonly onDetectado: (jvms: readonly JavaVisible[], sello: string) => void
  /** JVM de la sesión anterior cuyo ejecutable sigue existiendo. */
  private previas: readonly JavaVisible[]
  /** Huella del entorno cuando se detectaron `previas`. Ver `selloEntorno`. */
  private selloPrevio: string | null

  constructor(opciones: JavaRuntimeOptions = {}) {
    this.log = opciones.log ?? ((m) => console.log(`[java] ${m}`))
    this.elegido = opciones.elegido ?? null
    this.onDetectado = opciones.onDetectado ?? (() => {})
    this.previas = (opciones.detectadasPrevias ?? []).filter((j) => existsSync(j.ruta))
    this.selloPrevio = opciones.selloPrevio ?? null
  }

  /**
   * Estado cacheado; detecta la primera vez.
   *
   * `barridoCompleto` viaja como PARÁMETRO hasta el sondeo, y no como campo de la
   * instancia, porque puede haber dos detecciones a la vez (dos clics en "Volver a
   * detectar Java", o una redetección mientras la del arranque sigue sondeando).
   * Con un campo compartido, el `finally` de la primera lo apagaba mientras la
   * segunda seguía dentro de `sondearPorEtapas`: el corte temprano se reactivaba a
   * media detección, la lista salía truncada y —peor— se persistía con un sello
   * fresco, que es exactamente lo que el sello existe para evitar.
   */
  async estado(barridoCompleto = false): Promise<EstadoJava> {
    if (this.cache !== null) return this.cache
    if (this.enVuelo !== null) return this.enVuelo
    const mia = this.enVuelo = this.detectar(barridoCompleto)
    void this.enVuelo.finally(() => {
      // Solo la limpia si sigue siendo LA suya (una invalidación pudo reemplazarla).
      if (this.enVuelo === mia) this.enVuelo = null
    })
    return this.enVuelo
  }

  /** Fuerza una detección nueva (el usuario instaló un JDK sin reiniciar Tessera). */
  async redetectar(): Promise<EstadoJava> {
    // Un re-sondeo de verdad: es el botón que se pulsa justo después de instalar un
    // JDK, así que recordar lo de antes sería exactamente lo contrario de lo pedido.
    this.previas = []
    this.invalidar()
    return this.estado(true)
  }

  /** Registra un java.exe elegido a mano. Devuelve el estado nuevo. */
  async usarElegido(rutaJavaExe: string | null): Promise<EstadoJava> {
    this.elegido = rutaJavaExe
    this.invalidar()
    return this.estado()
  }

  /**
   * Tira la caché Y SUELTA la detección en vuelo.
   *
   * Soltar `enVuelo` es lo importante: sin eso, una redetección lanzada mientras la
   * primera aún sondeaba devolvía el resultado VIEJO —calculado antes de que el
   * usuario eligiera su java.exe— y encima lo re-cacheaba al terminar. El caso real
   * es exactamente el que hay que soportar: abrir un .class, ver "no hay Java",
   * pulsar "Elegir java.exe…" y elegirlo mientras algún sondeo sigue colgado.
   *
   * La promesa antigua no se puede cancelar, pero al perder la referencia su
   * resultado ya no lo espera nadie; el `if` de `detectar` impide que reescriba una
   * caché más nueva.
   */
  private invalidar(): void {
    this.cache = null
    this.enVuelo = null
    this.generacion++
  }

  /**
   * Sondea POR ETAPAS, de lo barato a lo caro, y para en cuanto tiene bastante.
   *
   * Está medido en este equipo, y el reparto es muy desigual:
   *   · reunir candidatos de JAVA_HOME + PATH + carpetas conocidas:      6 ms
   *   · consultar las 8 claves del registro (en paralelo):            6 300 ms
   *   · sondear 12 candidatos con `java -version`:                   10 900 ms
   *
   * Barrerlo todo son ~18 s, y eso lo pagaba entero la primera clase que se abriera.
   * Pero para descompilar solo hacen falta DOS cosas: una JVM cualquiera (CFR) y una
   * de 17 o más (Vineflower). En cuanto aparece una de 17+ ya están las dos cubiertas
   * y no hay ninguna razón para seguir arrancando JVM.
   *
   * Por eso: primero JAVA_HOME y el PATH —donde está la JVM que el usuario usa de
   * verdad—, y solo si eso no basta se pagan las carpetas conocidas y el registro.
   * `redetectar()` sí barre entero: es el botón que se pulsa tras instalar un JDK,
   * y ahí la lista completa es justo lo que se está pidiendo.
   */
  private async sondearPorEtapas(barridoCompleto: boolean): Promise<JavaVisible[]> {
    const encontradas: JavaVisible[] = []
    const yaSondeadas = new Set<string>()

    const etapa = async (candidatos: readonly Candidato[]): Promise<void> => {
      const nuevos = candidatos.filter((c) => !yaSondeadas.has(c.ruta.toLowerCase()))
      for (const c of nuevos) yaSondeadas.add(c.ruta.toLowerCase())
      encontradas.push(...(await this.sondear(nuevos)))
    }
    /** Con una JVM 17+ están cubiertos los dos motores: no hace falta seguir. */
    const yaBasta = (): boolean =>
      !barridoCompleto && mejorJvmPara(encontradas, 'vineflower') !== undefined

    await etapa(this.candidatosRapidos())
    if (yaBasta()) return encontradas

    await etapa(await this.candidatosDeCarpetas())
    if (yaBasta()) return encontradas

    await etapa(await this.candidatosDeRegistro())
    return encontradas
  }

  /**
   * Sondea SOLO el java.exe elegido a mano, para el camino rápido.
   *
   * Cuando se reutilizan las JVM recordadas, el elegido puede no estar entre ellas
   * —se acaba de elegir justo ahora— y sin esto quedaría fuera de la lista pese a
   * ser la decisión más explícita del usuario.
   */
  private async sondearElegido(): Promise<JavaVisible | null> {
    if (this.elegido === null || !existsSync(this.elegido)) return null
    if (this.previas.some((j) => j.ruta.toLowerCase() === this.elegido!.toLowerCase())) return null
    const r = await correr(this.elegido, ['-version'], SONDEO_TIMEOUT_MS)
    const texto = r.stderr + r.stdout
    const major = majorDeVersion(texto)
    if (major === 0) return null
    return { ruta: this.elegido, version: primeraLineaVersion(texto), major, origen: 'elegido' }
  }

  /** Valida que una ruta sea de verdad un java.exe utilizable. */
  async validarJavaExe(rutaJavaExe: string): Promise<{ ok: boolean; mensaje: string; major: number }> {
    if (!existsSync(rutaJavaExe)) {
      return { ok: false, mensaje: 'Ese archivo no existe.', major: 0 }
    }
    const r = await correr(rutaJavaExe, ['-version'], SONDEO_TIMEOUT_MS)
    // STDERR, no stdout: `java -version` escribe ahí en todas las JVM (ver el ADR).
    const salida = r.stderr + r.stdout
    const major = majorDeVersion(salida)
    if (major === 0) {
      return {
        ok: false,
        mensaje: `Eso no parece un java.exe: al ejecutarlo no devolvió una versión de Java.`,
        major: 0
      }
    }
    return { ok: true, mensaje: '', major }
  }

  private async detectar(barridoCompleto: boolean): Promise<EstadoJava> {
    const t0 = Date.now()
    const generacionPropia = this.generacion
    /**
     * LOCAL, no campo: dos detecciones pueden solaparse (ver `estado`). Con un
     * campo compartido, la que terminara primero decidía si la OTRA persistía sus
     * JVM o no.
     */
    let usandoPrevias: boolean
    // Camino rápido: lo que ya se supo en otra sesión, pero SOLO si el entorno de
    // Java sigue siendo el mismo. La huella es lo que separa "recordar" de "no
    // volver a mirar jamás": ver `selloEntorno`.
    // La huella se calcula sobre las JVM RECORDADAS, que son las que se sellaron la
    // última vez: si algo se movió —incluido un java.exe reemplazado en su sitio— no
    // coincidirá y se vuelve a sondear.
    const sello = await selloEntorno(this.previas)
    let jvms: readonly JavaVisible[]
    if (this.previas.length > 0 && sello === this.selloPrevio) {
      usandoPrevias = true
      this.log(`${this.previas.length} JVM recordadas de la sesión anterior (sin re-sondear)`)
      // El elegido a mano puede no estar entre las recordadas (se acaba de elegir).
      const extra = await this.sondearElegido()
      jvms = extra === null ? this.previas : [extra, ...this.previas]
    } else {
      usandoPrevias = false
      if (this.previas.length > 0) {
        this.log('el entorno de Java cambió desde la última sesión: se vuelve a sondear')
      }
      jvms = await this.sondearPorEtapas(barridoCompleto)
    }
    const ordenadas = ordenarJvms(dedupePorRuta(jvms))

    const paraCfr = mejorJvmPara(ordenadas, 'cfr')
    const paraVineflower = mejorJvmPara(ordenadas, 'vineflower')

    const motores: MotorDisponible[] = (['cfr', 'vineflower'] as const).map((motor) => {
      const jvm = motor === 'cfr' ? paraCfr : paraVineflower
      const disponible = jvm !== undefined
      let motivo = ''
      if (!disponible) {
        motivo =
          ordenadas.length === 0
            ? 'No se encontró ninguna instalación de Java en el equipo.'
            : `Necesita un JDK ${REQUIERE_MAJOR[motor]} o superior; el más nuevo que se encontró es ${ordenadas[0].major}.`
      }
      return { motor, version: VERSION_MOTOR[motor], requiereMajor: REQUIERE_MAJOR[motor], disponible, motivo }
    })

    const estado: EstadoJava = {
      disponible: paraCfr !== undefined,
      paraCfr,
      paraVineflower,
      detectadas: ordenadas,
      elegidoAMano: this.elegido !== null,
      motores,
      mensaje:
        paraCfr !== undefined
          ? ''
          : 'No se encontró Java en este equipo. Para ver el código de una clase hace falta una instalación de Java ' +
            '(cualquiera desde la 6). Si tienes una en una ruta poco habitual, elígela con "Elegir java.exe…".'
    }
    // Si alguien invalidó mientras se sondeaba, este resultado ya es viejo: se
    // devuelve a quien lo pidió, pero NO se cachea.
    if (generacionPropia !== this.generacion) return estado
    // Solo se persiste lo SONDEADO de verdad; recordar lo recordado no aporta. Se
    // guarda junto a la huella con la que se sondeó: es la que la próxima sesión
    // comparará para decidir si fiarse.
    if (!usandoPrevias) {
      // Se RE-SELLA con la lista recién detectada: el sello y las JVM que describe
      // tienen que viajar siempre juntos, o la próxima sesión compararía la huella
      // de un conjunto contra otro y no se fiaría nunca (o peor, se fiaría de más).
      const selloNuevo = await selloEntorno(ordenadas)
      this.previas = ordenadas
      this.selloPrevio = selloNuevo
      this.onDetectado(ordenadas, selloNuevo)
    }
    this.log(
      `detección${usandoPrevias ? ' (recordada)' : ''}: ${ordenadas.length} JVM en ${Date.now() - t0} ms` +
        (ordenadas.length > 0 ? ` (${ordenadas.map((j) => j.major).join(', ')})` : '')
    )
    this.cache = estado
    return estado
  }

  /** ETAPA 1 (6 ms medidos): lo elegido a mano, JAVA_HOME y el PATH. */
  private candidatosRapidos(): Candidato[] {
    const out: Candidato[] = []
    const añadir = (javaHome: string, origen: OrigenJava): void => {
      const exe = ejecutable(javaHome)
      if (existsSync(exe)) out.push({ ruta: exe, origen })
    }

    // El elegido a mano manda: es la decisión más explícita del usuario.
    if (this.elegido !== null && existsSync(this.elegido)) {
      out.push({ ruta: this.elegido, origen: 'elegido' })
    }
    const javaHome = process.env.JAVA_HOME
    if (javaHome != null && javaHome !== '') añadir(javaHome, 'JAVA_HOME')

    // Cada directorio del PATH (sin lanzar `where`, que además solo da el primero).
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (dir === '') continue
      const exe = path.join(dir, EXE)
      if (existsSync(exe)) out.push({ ruta: exe, origen: 'PATH' })
    }
    return out
  }

  /** ETAPA 2: cada subcarpeta de las rutas donde suelen instalarse los JDK. */
  private async candidatosDeCarpetas(): Promise<Candidato[]> {
    const out: Candidato[] = []
    for (const base of carpetasConocidas()) {
      try {
        for (const d of await fsp.readdir(base, { withFileTypes: true })) {
          if (!d.isDirectory() && !d.isSymbolicLink()) continue
          const exe = ejecutable(path.join(base, d.name))
          if (existsSync(exe)) out.push({ ruta: exe, origen: 'carpetaConocida' })
        }
      } catch {
        // La carpeta no existe: es lo normal para la mayoría.
      }
    }
    return out
  }

  /**
   * ETAPA 3: preguntarle al SISTEMA qué JVM tiene registradas. La más cara, y por eso
   * la última.
   *
   * Cada plataforma tiene su propio censo de JVM y no se parecen en nada:
   *   · Windows — el REGISTRO (6,3 s medidos, de ahí que vaya la última).
   *   · macOS — `/usr/libexec/java_home -V`, la herramienta de Apple que lista las
   *     JVM instaladas. Es MUCHO más barata que el registro (decenas de ms) pero se
   *     deja igualmente al final: encuentra lo mismo que la etapa 2 en el caso normal
   *     y sólo aporta las instalaciones en rutas no convencionales.
   */
  private async candidatosDeRegistro(): Promise<Candidato[]> {
    if (esMac()) return this.candidatosDeJavaHomeMac()
    if (!esWindows()) return []
    const out: Candidato[] = []
    const leidas = await Promise.all(
      CLAVES_REGISTRO.flatMap((c) => [this.leerRegistro(c, '64'), this.leerRegistro(c, '32')])
    )
    for (const home of leidas.flat()) {
      const exe = ejecutable(home)
      if (existsSync(exe)) out.push({ ruta: exe, origen: 'registro' })
    }
    return out
  }

  /**
   * El censo de JVM de macOS, vía `/usr/libexec/java_home -V`.
   *
   * FORMATO DE SU SALIDA, que es lo que la expresión de abajo tiene que aguantar. Va
   * por STDERR (no por stdout, igual que `java -version`), con una cabecera y una
   * línea por JVM cuyo ÚLTIMO campo es el home:
   *
   *     Matching Java Virtual Machines (3):
   *         24 (arm64) "Oracle Corporation" - "OpenJDK 24" /Users/…/openjdk-24/Contents/Home
   *
   * Se toma la ruta como "el primer `/` hasta el final de la línea" en vez de partir
   * por espacios: el nombre del proveedor lleva espacios y comillas, y una ruta de
   * macOS puede llevarlos también. Lo único garantizado es que el home es lo último.
   *
   * Ese home YA incluye `Contents/Home`, así que aquí NO se vuelve a aplicar la capa
   * del bundle: se le pide directamente su `bin/java`.
   */
  private async candidatosDeJavaHomeMac(): Promise<Candidato[]> {
    const r = await correr('/usr/libexec/java_home', ['-V'], REG_TIMEOUT_MS)
    if (!r.ok) return []
    const out: Candidato[] = []
    // STDERR primero: es donde `java_home -V` escribe la lista.
    for (const linea of (r.stderr + r.stdout).split(/\r?\n/)) {
      const m = linea.match(/\s(\/.+)$/)
      if (!m) continue
      const exe = path.join(m[1].trim(), 'bin', EXE)
      if (existsSync(exe)) out.push({ ruta: exe, origen: 'registro' })
    }
    return out
  }

  /** Lee los `JavaHome` de una clave del registro (cada subclave es una versión). */
  private async leerRegistro(clave: string, bits: '32' | '64'): Promise<string[]> {
    const r = await correr('reg', ['query', clave, '/s', '/v', 'JavaHome', `/reg:${bits}`], REG_TIMEOUT_MS)
    if (!r.ok) return []
    const homes: string[] = []
    for (const linea of r.stdout.split(/\r?\n/)) {
      // "    JavaHome    REG_SZ    C:\Program Files\Java\jdk-17.0.12"
      const m = linea.match(/JavaHome\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i)
      if (m) homes.push(m[1])
    }
    return homes
  }

  /** Ejecuta `java -version` en cada candidato, con concurrencia acotada. */
  private async sondear(candidatos: readonly Candidato[]): Promise<JavaVisible[]> {
    const unicos = dedupePorRuta(candidatos)
    const salida: JavaVisible[] = []
    for (let i = 0; i < unicos.length; i += CONCURRENCIA_SONDEO) {
      const lote = unicos.slice(i, i + CONCURRENCIA_SONDEO)
      const resultados = await Promise.all(
        lote.map(async (c) => {
          const r = await correr(c.ruta, ['-version'], SONDEO_TIMEOUT_MS)
          // STDERR primero: es donde escriben TODAS las JVM (ver cabecera).
          const texto = r.stderr + r.stdout
          const major = majorDeVersion(texto)
          if (major === 0) return null
          return { ruta: c.ruta, version: primeraLineaVersion(texto), major, origen: c.origen }
        })
      )
      for (const r of resultados) if (r !== null) salida.push(r)
    }
    return salida
  }
}
