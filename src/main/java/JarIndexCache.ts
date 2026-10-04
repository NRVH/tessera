// =============================================================================
// LRU con DOBLE TOPE (número de entradas y bytes) para los índices de contenedores ya leídos y
// los buffers de los jars anidados. La clave lleva `(ruta, mtime, size)`: un jar reconstruido
// deja de casar solo, sin depender del watcher. `Map` conserva el orden de inserción, así que
// `delete` + `set` en cada acierto ES el LRU. Lo usan `JarService` y `ComprimidosService`.
// Decisiones: docs/decisiones/comprimidos/contenedores-como-carpetas.md
// =============================================================================

import type { IndiceZip } from './zipRandom.ts'

/**
 * Cuántas entradas GIGANTES (las que ellas solas se pasan de `maxBytes`) quedan a
 * salvo del tope de bytes. Ver `podar`.
 *
 * DOS, y el número está razonado. Con UNA, alternar entre dos jars anidados enormes
 * del mismo .war vuelve a ser el ping-pong que la protección existe para evitar:
 * cada ida y vuelta re-infla 100 MiB. Con TODAS, el consumo real deja de tener tope
 * útil (~3 GiB). Dos cubre el caso realista —comparar dos dependencias gordas— y
 * deja el techo en `maxBytes` + 2 × MAX_JAR_ANIDADO_BYTES. Alternar entre TRES
 * gigantes sí thrashea, y es el precio aceptado: un jar anidado de más de 96 MiB ya
 * es raro, y tres a la vez no se ha visto.
 */
const GIGANTES_PROTEGIDAS = 2

/** Lo que se guarda por clave: el índice y, si es un anidado, sus bytes inflados. */
export interface EntradaCacheJar {
  indice: IndiceZip
  /** Bytes del contenedor, solo para anidados (los de disco se releen por rangos). */
  buffer?: Buffer
  /** Coste contabilizado en el presupuesto de bytes. */
  bytes: number
}

export interface OpcionesCacheJar {
  /** Máximo de contenedores distintos en caché. */
  maxEntradas: number
  /** Máximo de bytes sumados (índices + buffers de anidados). */
  maxBytes: number
}

export class JarIndexCache {
  private readonly mapa = new Map<string, EntradaCacheJar>()
  private readonly maxEntradas: number
  private readonly maxBytes: number
  private bytesUsados = 0

  constructor(opciones: OpcionesCacheJar) {
    this.maxEntradas = opciones.maxEntradas
    this.maxBytes = opciones.maxBytes
  }

  /**
   * Clave de un contenedor de DISCO. El mtime y el tamaño son lo que convierte a
   * esta caché en correcta: un jar reconstruido no puede colisionar con el viejo.
   */
  static claveDisco(abs: string, mtimeMs: number, size: number): string {
    return `${abs.toLowerCase()}|${mtimeMs}|${size}`
  }

  /** Clave de un contenedor ANIDADO: cuelga de la de su padre. */
  static claveAnidada(clavePadre: string, entrada: string): string {
    return `${clavePadre}>${entrada}`
  }

  get(clave: string): EntradaCacheJar | undefined {
    const valor = this.mapa.get(clave)
    if (valor === undefined) return undefined
    // Rejuvenece: `Map` conserva el orden de inserción, así que reinsertar lo manda
    // al final y el primero del iterador es siempre el menos usado.
    this.mapa.delete(clave)
    this.mapa.set(clave, valor)
    return valor
  }

  set(clave: string, valor: EntradaCacheJar): void {
    const previo = this.mapa.get(clave)
    if (previo !== undefined) {
      this.bytesUsados -= previo.bytes
      this.mapa.delete(clave)
    }
    this.mapa.set(clave, valor)
    this.bytesUsados += valor.bytes
    this.podar()
  }

  /**
   * Olvida todo lo que cuelga de un contenedor (él y sus anidados). Se usa cuando el
   * watcher avisa de que ese fichero cambió: la clave ya no casaría, pero dejar la
   * entrada vieja ocupando presupuesto no tiene sentido.
   */
  invalidarPorRuta(abs: string): void {
    const prefijo = `${abs.toLowerCase()}|`
    for (const [clave, valor] of this.mapa) {
      if (clave.startsWith(prefijo)) {
        this.bytesUsados -= valor.bytes
        this.mapa.delete(clave)
      }
    }
  }

  vaciar(): void {
    this.mapa.clear()
    this.bytesUsados = 0
  }

  /** Diagnóstico (y lo que comprueba el test). */
  get entradas(): number {
    return this.mapa.size
  }
  get bytes(): number {
    return this.bytesUsados
  }

  /**
   * Desaloja lo más antiguo hasta caber en los dos topes (entradas y bytes).
   *
   * LA ENTRADA GIGANTE. Una entrada que ella SOLA se pasa de `maxBytes` no se
   * expulsa por el tope de bytes: es alcanzable de verdad —un jar anidado admite
   * hasta MAX_JAR_ANIDADO_BYTES, MAYOR que el tope de la caché— y echarla la obliga
   * a re-inflarse entera en cada pulsación del chevron.
   *
   * Se probó protegerla con `if (this.mapa.size <= 1) break` y se retiró por DOS
   * motivos. Uno: solo la salvaba mientras era la ÚNICA de la caché, y en el flujo
   * normal no lo es ni un instante —la petición siguiente mete el índice de su
   * contenedor padre, `size` pasa a 2 y la gigante, que es la más antigua, sale la
   * primera: ping-pong con 0% de aciertos re-inflando 128 MiB en CADA lectura. Y
   * dos: cortaba el bucle entero, así que ni siquiera desalojaba a los demás.
   *
   * Lo correcto es SALTARLA, no parar: se busca la víctima más antigua que sí se
   * pueda echar. Si no queda ninguna —solo hay gigantes— se para, porque seguir
   * sería girar en vano.
   *
   * PERO NO SE PROTEGEN TODAS, solo las GIGANTES_PROTEGIDAS más recientes. Con la
   * protección abierta el consumo real era `maxBytes` + `maxEntradas` ×
   * MAX_JAR_ANIDADO_BYTES: 96 MiB de presupuesto declarado y hasta ~3 GiB de
   * verdad, alcanzable con un .war que lleve varios jars anidados de 100 MiB.
   * Ninguna de las viejas hacía falta para lo que la protección resuelve, que es
   * que sobreviva la que se está usando AHORA.
   */
  private podar(): void {
    for (;;) {
      const protegidas = this.giganteProtegidas()
      const sobranBytes = this.bytesDesalojables(protegidas) > this.maxBytes
      const sobranEntradas = this.mapa.size > this.maxEntradas
      if (!sobranBytes && !sobranEntradas) return
      const victima = this.elegirVictima(sobranEntradas, sobranBytes, protegidas)
      if (victima === null) return
      const valor = this.mapa.get(victima)
      this.mapa.delete(victima)
      if (valor !== undefined) this.bytesUsados -= valor.bytes
    }
  }

  /**
   * Las gigantes a salvo del tope de bytes: las GIGANTES_PROTEGIDAS más recientes.
   *
   * El Map itera de la más antigua a la más nueva, así que las últimas que pasan el
   * filtro son las de uso más reciente (`get` reinserta al final).
   */
  private giganteProtegidas(): ReadonlySet<string> {
    const gigantes: string[] = []
    for (const [clave, valor] of this.mapa) {
      if (valor.bytes > this.maxBytes) gigantes.push(clave)
    }
    return new Set(gigantes.slice(-GIGANTES_PROTEGIDAS))
  }

  /**
   * Bytes de lo que SÍ se puede desalojar, que es contra lo que se mide el tope.
   *
   * Se probó medir `bytesUsados` a secas y se retiró: con una gigante dentro, el
   * total ya supera `maxBytes` por sí solo, así que el bucle desalojaba TODO lo
   * demás —incluida la entrada que se acababa de insertar, una y otra vez— y la
   * caché se quedaba en la gigante y nada más. El resultado es peor que el problema
   * original: cada uno de los otros jars vuelve a leer su índice en cada operación.
   *
   * El precio explícito de proteger a las gigantes en uso es que el consumo real
   * puede llegar a `maxBytes` + GIGANTES_PROTEGIDAS × MAX_JAR_ANIDADO_BYTES. Las
   * demás sí cuentan, que es lo que impide que se apilen: ver `podar`.
   */
  private bytesDesalojables(protegidas: ReadonlySet<string>): number {
    let total = 0
    for (const [clave, valor] of this.mapa) {
      if (!protegidas.has(clave)) total += valor.bytes
    }
    return total
  }

  /**
   * La entrada más antigua que se puede desalojar, o null si no hay ninguna.
   *
   * El Map itera en orden de inserción, así que la primera que pasa el filtro es la
   * más antigua. Dos matices:
   *
   *   · Con presión de BYTES la primera víctima es la gigante no protegida más
   *     antigua, aunque haya entradas pequeñas más viejas: es ella la que se está
   *     comiendo el presupuesto, y echar veinte índices pequeños antes de llegar a
   *     ella sería tirar veinte aciertos sin arreglar nada.
   *   · Pasarse de ENTRADAS no admite excepción: ese tope existe para acotar cuántos
   *     contenedores se recuerdan, y ahí hasta una gigante protegida cede si no
   *     queda nadie más a quien echar (la más antigua de ellas).
   */
  private elegirVictima(
    sobranEntradas: boolean,
    sobranBytes: boolean,
    protegidas: ReadonlySet<string>
  ): string | null {
    if (sobranBytes) {
      for (const [clave, valor] of this.mapa) {
        if (!protegidas.has(clave) && valor.bytes > this.maxBytes) return clave
      }
    }
    for (const clave of this.mapa.keys()) {
      if (!protegidas.has(clave)) return clave
    }
    if (!sobranEntradas) return null
    return this.mapa.keys().next().value ?? null
  }
}
