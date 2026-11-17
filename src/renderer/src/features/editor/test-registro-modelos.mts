#!/usr/bin/env node
// =============================================================================
// Prueba del registro de buffers compartidos (node src/renderer/src/features/editor/test-registro-modelos.mts).
// Ejercita el núcleo puro (`registroModelosCore.ts`) con un modelo falso, lo que permite observar
// que el modelo no se dispone, que su identidad se conserva tras recargar y que `write` no se llama.
// Solo Node core: sin Monaco, sin DOM, sin React.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import {
  crearRegistro,
  esArchivoInexistente,
  GuardadoModeloBloqueado,
  type TextoCargado,
  type DependenciasRegistro,
  type RutaArchivo,
  type ModeloTextoCompartido,
  type ResultadoEscritura
} from './registroModelosCore.ts'

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-pestanas-editor.mts)
// =============================================================================
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

// =============================================================================
// Modelo falso + dependencias instrumentadas
// =============================================================================
interface ModeloFalso {
  id: number
  texto: string
  lenguaje: string
  eol: 'CRLF' | 'LF'
  version: number
  liberado: boolean
  suscriptores: Set<() => void>
}

interface Arnes {
  deps: DependenciasRegistro<ModeloFalso>
  /** Llamadas a load, por ruta. */
  cargas: string[]
  /** Preguntas de EXISTENCIA, por ruta (el camino del buffer sucio: no lee). */
  existencias: string[]
  /** Escrituras registradas: [ruta, contenido, encoding]. */
  escrituras: Array<[string, string, string]>
  /** El proyecto (`raiz`) de cada escritura, en el mismo orden que `writes`. */
  raicesEscritas: string[]
  /** Modelos creados, en orden (para comprobar disposes). */
  creados: ModeloFalso[]
  /** Fija lo que devolverá la próxima carga de esa ruta. */
  fijarArchivo(ruta: string, archivo: Partial<TextoCargado> & { contenido: string }): void
  /** Borra la ruta: las cargas siguientes fallan con un ENOENT como el real. */
  borrarArchivo(ruta: string): void
  /** La devuelve a la existencia. */
  recrearArchivo(ruta: string, contenido?: string): void
  /** Edita el modelo como haría el usuario (mueve la versión y notifica). */
  teclear(modelo: ModeloFalso, texto: string): void
  /** Hace que las cargas queden EN VUELO hasta llamar a vaciarCargas(). */
  retenerCargas(): void
  vaciarCargas(): Promise<void>
  /** Hace que la pregunta de existencia FALLE (IPC caído, ruta rechazada). */
  romperExistencia(roto: boolean): void
}

function crearArnes(): Arnes {
  const archivos = new Map<string, TextoCargado>()
  const borrados = new Set<string>()
  const cargas: string[] = []
  const existencias: string[] = []
  const escrituras: Array<[string, string, string]> = []
  const raicesEscritas: string[] = []
  const creados: ModeloFalso[] = []
  let siguienteId = 1
  let held: Array<() => void> | null = null
  let falloExistencia = false

  const textoCargadoDe = (ruta: string): TextoCargado =>
    archivos.get(ruta) ?? {
      contenido: `contenido de ${ruta}\n`,
      lenguaje: 'plaintext',
      encoding: 'utf8',
      truncado: false,
      binario: false
    }

  const deps: DependenciasRegistro<ModeloFalso> = {
    crearModelo(texto, lenguaje) {
      const m: ModeloFalso = {
        id: siguienteId++,
        texto,
        lenguaje,
        eol: 'LF',
        version: 1,
        liberado: false,
        suscriptores: new Set()
      }
      creados.push(m)
      return m
    },
    liberarModelo(modelo) {
      modelo.liberado = true
    },
    fijarValor(modelo, texto) {
      modelo.texto = texto
      modelo.version++
      for (const s of [...modelo.suscriptores]) s()
    },
    fijarLenguaje(modelo, lenguaje) {
      modelo.lenguaje = lenguaje
    },
    obtenerEol(modelo) {
      return modelo.eol
    },
    fijarEol(modelo, eol) {
      modelo.eol = eol
      modelo.version++
      for (const s of [...modelo.suscriptores]) s()
    },
    versionId(modelo) {
      return modelo.version
    },
    obtenerValor(modelo) {
      return modelo.texto
    },
    observar(modelo, onCambio) {
      modelo.suscriptores.add(onCambio)
      return () => {
        modelo.suscriptores.delete(onCambio)
      }
    },
    async cargar({ ruta }) {
      cargas.push(ruta)
      if (borrados.has(ruta)) {
        // El texto es el que de verdad llega: el `fs` del main envuelto por el IPC
        // de Electron, que se come el `code` y deja sólo el mensaje.
        throw new Error(
          `Error invoking remote method 'files:readFile': Error: ENOENT: no such file or directory, stat '${ruta}'`
        )
      }
      if (held !== null) {
        await new Promise<void>((resolver) => held!.push(resolver))
      }
      return textoCargadoDe(ruta)
    },
    async existe({ ruta }) {
      existencias.push(ruta)
      if (falloExistencia) throw new Error('el IPC de existencia se cayó')
      return !borrados.has(ruta)
    },
    async escribir({ raiz, ruta }, contenido, encoding): Promise<ResultadoEscritura> {
      escrituras.push([ruta, contenido, encoding])
      raicesEscritas.push(raiz)
      return { bytesEscritos: Buffer.byteLength(contenido, 'utf8') }
    }
  }

  return {
    deps,
    cargas,
    existencias,
    escrituras,
    raicesEscritas,
    creados,
    romperExistencia(roto) {
      falloExistencia = roto
    },
    borrarArchivo(ruta) {
      borrados.add(ruta)
    },
    recrearArchivo(ruta, contenido) {
      borrados.delete(ruta)
      if (contenido !== undefined) {
        archivos.set(ruta, {
          contenido,
          lenguaje: 'plaintext',
          encoding: 'utf8',
          truncado: false,
          binario: false
        })
      }
    },
    fijarArchivo(ruta, archivo) {
      archivos.set(ruta, {
        lenguaje: 'plaintext',
        encoding: 'utf8',
        truncado: false,
        binario: false,
        ...archivo
      })
    },
    teclear(modelo, texto) {
      modelo.texto = texto
      modelo.version++
      for (const s of [...modelo.suscriptores]) s()
    },
    retenerCargas() {
      held = []
    },
    async vaciarCargas() {
      const pendientes = held ?? []
      held = null
      for (const resolver of pendientes) resolver()
      // Deja asentar las continuaciones encadenadas de las cargas liberadas.
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
    }
  }
}

const CLAVE_A = 'perfil1|C:/proy/a\u0000src/index.ts'
const CLAVE_B = 'perfil1|C:/proy/b\u0000src/index.ts'
/** Un archivo del proyecto `raiz` (de serie, el de CLAVE_A). */
const en = (ruta: string, raiz = 'C:/proy/a'): RutaArchivo => ({ raiz, ruta })
const EN_A = en('src/index.ts')
const EN_B = en('src/index.ts', 'C:/proy/b')

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  hr('(1) DOS titulares de la misma key comparten UN buffer')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)

    const s1 = await reg.adquirir(CLAVE_A, EN_A)
    const s2 = await reg.adquirir(CLAVE_A, EN_A)

    check(
      '(1a) una sola lectura de disco para dos adquisiciones',
      h.cargas.length === 1,
      `loads=${JSON.stringify(h.cargas)}`
    )
    check(
      '(1b) ambos titulares reciben EL MISMO objeto de modelo (identidad ===)',
      s1.modelo !== null && s1.modelo === s2.modelo,
      `id1=${s1.modelo?.id} id2=${s2.modelo?.id}`
    )
    check('(1c) contarRefs = 2', reg.contarRefs(CLAVE_A) === 2, `contarRefs=${reg.contarRefs(CLAVE_A)}`)
  }

  // ---------------------------------------------------------------------------
  hr('(2) El modelo se dispone SOLO cuando lo suelta el ÚLTIMO titular')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir(CLAVE_A, EN_A)
    await reg.adquirir(CLAVE_A, EN_A)

    reg.release(CLAVE_A)
    check(
      '(2a) tras el primer release (2->1) el modelo SIGUE vivo',
      s.modelo !== null && !s.modelo.liberado && reg.contarRefs(CLAVE_A) === 1,
      `disposed=${s.modelo?.liberado} contarRefs=${reg.contarRefs(CLAVE_A)}`
    )

    reg.release(CLAVE_A)
    check(
      '(2b) tras el segundo release (1->0) el modelo se dispone',
      s.modelo !== null && s.modelo.liberado,
      `disposed=${s.modelo?.liberado}`
    )
    check(
      '(2c) la entrada sale del registro (peek null, contarRefs 0)',
      reg.consultar(CLAVE_A) === null && reg.contarRefs(CLAVE_A) === 0,
      `peek=${reg.consultar(CLAVE_A)} contarRefs=${reg.contarRefs(CLAVE_A)}`
    )

    // Defensa contra el doble cleanup de React: no debe re-disponer ni lanzar.
    reg.release(CLAVE_A)
    reg.release(CLAVE_A)
    check(
      '(2d) releases de más son no-op (no lanzan, no re-disponen)',
      h.creados.filter((m) => m.liberado).length === 1,
      `dispuestos=${h.creados.filter((m) => m.liberado).length}/${h.creados.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) Carreras con la carga EN VUELO')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    h.retenerCargas()

    // Dos adquisiciones en el MISMO tick, antes de que la carga resuelva.
    const p1 = reg.adquirir(CLAVE_A, EN_A)
    const p2 = reg.adquirir(CLAVE_A, EN_A)
    check(
      '(3a) el refcount sube SÍNCRONO: 2 aunque la carga siga en vuelo',
      reg.contarRefs(CLAVE_A) === 2,
      `contarRefs=${reg.contarRefs(CLAVE_A)}`
    )

    await h.vaciarCargas()
    const [a, b] = await Promise.all([p1, p2])
    check(
      '(3b) las dos adquisiciones concurrentes comparten modelo y solo hubo 1 lectura',
      a.modelo === b.modelo && a.modelo !== null && h.cargas.length === 1,
      `mismo=${a.modelo === b.modelo} loads=${h.cargas.length}`
    )
  }
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    h.retenerCargas()

    const p = reg.adquirir(CLAVE_A, EN_A)
    reg.release(CLAVE_A) // el pane se desmonta ANTES de que la carga termine
    await h.vaciarCargas()
    const s = await p

    check(
      '(3c) release durante la carga: no publica nada y no deja la entrada colgada',
      s.modelo === null && reg.consultar(CLAVE_A) === null && reg.contarRefs(CLAVE_A) === 0,
      `model=${s.modelo} peek=${reg.consultar(CLAVE_A)}`
    )
    check(
      '(3d) release durante la carga: si llegó a crearse un modelo, se dispuso (cero fugas)',
      h.creados.every((m) => m.liberado),
      `creados=${h.creados.length} vivos=${h.creados.filter((m) => !m.liberado).length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(4) Aislamiento por key: la misma RUTA en dos proyectos son buffers distintos')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const a = await reg.adquirir(CLAVE_A, EN_A)
    const b = await reg.adquirir(CLAVE_B, EN_B)
    check(
      '(4a) dos keys distintas -> dos modelos distintos, dos lecturas',
      a.modelo !== b.modelo && h.cargas.length === 2,
      `id_a=${a.modelo?.id} id_b=${b.modelo?.id} loads=${h.cargas.length}`
    )
    // Pérdida de datos: con la misma ruta relativa, cada buffer escribe en SU proyecto, no en el anclado.
    h.teclear(a.modelo!, 'de a\n')
    h.teclear(b.modelo!, 'de b\n')
    await reg.guardar(CLAVE_A)
    await reg.guardar(CLAVE_B)
    check(
      '(4c) cada buffer guarda con la contenedora de su proyecto',
      h.raicesEscritas.join(',') === 'C:/proy/a,C:/proy/b' && h.escrituras.every(([p]) => p === 'src/index.ts'),
      `raices=${JSON.stringify(h.raicesEscritas)}`
    )
    reg.release(CLAVE_A)
    check(
      '(4b) cerrar uno no toca el otro',
      b.modelo !== null && !b.modelo.liberado && reg.contarRefs(CLAVE_B) === 1,
      `b.disposed=${b.modelo?.liberado} refCount_B=${reg.contarRefs(CLAVE_B)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(5) Estado sucio repartido a los N titulares')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir(CLAVE_A, EN_A)
    await reg.adquirir(CLAVE_A, EN_A)

    const vistos1: boolean[] = []
    const vistos2: boolean[] = []
    reg.suscribirSucio(CLAVE_A, (d) => vistos1.push(d))
    reg.suscribirSucio(CLAVE_A, (d) => vistos2.push(d))
    check(
      '(5a) al suscribirse se emite el estado ACTUAL (limpio)',
      vistos1.length === 1 && vistos1[0] === false && vistos2[0] === false,
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )

    h.teclear(s.modelo!, 'editado por el usuario\n')
    check(
      '(5b) una edición ensucia y avisa a los DOS titulares',
      vistos1.at(-1) === true && vistos2.at(-1) === true && reg.estaSucio(CLAVE_A),
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )

    const antes = vistos1.length
    h.teclear(s.modelo!, 'editado otra vez\n')
    check(
      '(5c) seguir escribiendo NO reemite (solo se avisa cuando el estado cambia)',
      vistos1.length === antes,
      `emisiones=${vistos1.length} (antes ${antes})`
    )

    await reg.guardar(CLAVE_A)
    check(
      '(5d) guardar limpia a los DOS titulares (un Ctrl+S desde el diff limpia la pestaña)',
      vistos1.at(-1) === false && vistos2.at(-1) === false && !reg.estaSucio(CLAVE_A),
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )
    check(
      '(5e) se escribió el contenido ACTUAL con la codificación de la entrada',
      h.escrituras.length === 1 && h.escrituras[0][1] === 'editado otra vez\n' && h.escrituras[0][2] === 'utf8',
      JSON.stringify(h.escrituras)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) Guardar: no-op en limpio, y edición DURANTE la escritura')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir(CLAVE_A, EN_A)
    const res = await reg.guardar(CLAVE_A)
    check(
      '(6a) guardar un buffer limpio devuelve null y NO escribe (no bumpea el mtime)',
      res === null && h.escrituras.length === 0,
      `res=${res} writes=${h.escrituras.length}`
    )
  }
  {
    const h = crearArnes()
    // `write` se queda en vuelo para poder teclear en medio.
    let liberar: (() => void) | null = null
    const original = h.deps.escribir
    h.deps.escribir = async (p, c, e) => {
      await new Promise<void>((resolver) => {
        liberar = resolver
      })
      return original(p, c, e)
    }

    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir(CLAVE_A, EN_A)
    h.teclear(s.modelo!, 'version 1\n')

    const guardando = reg.guardar(CLAVE_A)
    await new Promise((r) => setImmediate(r))
    h.teclear(s.modelo!, 'version 2 escrita MIENTRAS se guardaba\n')
    liberar!()
    await guardando

    check(
      '(6b) editar durante el await del guardado deja el buffer SUCIO (lo escrito ya no es lo que hay)',
      reg.estaSucio(CLAVE_A),
      `dirty=${reg.estaSucio(CLAVE_A)} escrito=${JSON.stringify(h.escrituras[0]?.[1])}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) Guardas de pérdida de datos: truncado y binario')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    h.fijarArchivo('grande.txt', { contenido: 'solo el principio\n', truncado: true })
    const reg = crearRegistro(h.deps)
    const clave = 'p|c\u0000grande.txt'
    const s = await reg.adquirir(clave, en('grande.txt'))
    h.teclear(s.modelo!, 'editado\n')

    let bloqueado = false
    let mensaje = ''
    try {
      await reg.guardar(clave)
    } catch (err) {
      bloqueado = err instanceof GuardadoModeloBloqueado
      mensaje = err instanceof Error ? err.message : String(err)
    }
    check(
      '(7a) guardar un TRUNCADO se rechaza con GuardadoModeloBloqueado y NO escribe',
      bloqueado && h.escrituras.length === 0,
      `${mensaje} | writes=${h.escrituras.length}`
    )
  }
  {
    const h = crearArnes()
    h.fijarArchivo('logo.png', { contenido: '', binario: true })
    const reg = crearRegistro(h.deps)
    const clave = 'p|c\u0000logo.png'
    const s = await reg.adquirir(clave, en('logo.png'))
    check('(7b) un binario no tiene modelo que compartir', s.modelo === null && s.binario, `model=${s.modelo}`)

    let bloqueado = false
    try {
      await reg.guardar(clave)
    } catch (err) {
      bloqueado = err instanceof GuardadoModeloBloqueado
    }
    check(
      '(7c) guardar un BINARIO se rechaza con GuardadoModeloBloqueado y NO escribe',
      bloqueado && h.escrituras.length === 0,
      `bloqueado=${bloqueado} writes=${h.escrituras.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(8) Recargar MUTA el modelo, nunca lo reemplaza (la prueba anti-swap)')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    h.fijarArchivo('src/index.ts', { contenido: 'original\n' })
    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir(CLAVE_A, EN_A)
    await reg.adquirir(CLAVE_A, EN_A)
    const antes = s.modelo!

    const vistos: boolean[] = []
    reg.suscribirSucio(CLAVE_A, (d) => vistos.push(d))
    h.teclear(s.modelo!, 'cambios sin guardar\n')

    h.fijarArchivo('src/index.ts', { contenido: 'contenido revertido desde disco\n' })
    const tras = await reg.recargar(CLAVE_A)

    check(
      '(8a) el modelo es EL MISMO objeto tras recargar (si se reemplazara, el otro titular quedaría muerto)',
      tras.modelo === antes && !antes.liberado,
      `mismo=${tras.modelo === antes} disposed=${antes.liberado}`
    )
    check(
      '(8b) el contenido se sustituyó por el de disco',
      antes.texto === 'contenido revertido desde disco\n',
      JSON.stringify(antes.texto)
    )
    check(
      '(8c) tras recargar el buffer queda LIMPIO y se avisa a los titulares',
      !reg.estaSucio(CLAVE_A) && vistos.at(-1) === false,
      `dirty=${reg.estaSucio(CLAVE_A)} vistos=${JSON.stringify(vistos)}`
    )
  }
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir(CLAVE_A, EN_A)
    const cargasIniciales = h.cargas.length

    // Dos recargas en el mismo tick: descartar cambios con la pestaña Y el diff abiertos.
    const [r1, r2] = await Promise.all([reg.recargar(CLAVE_A), reg.recargar(CLAVE_A)])
    check(
      '(8d) dos recargas en el mismo tick = UNA sola lectura de disco (single-flight)',
      h.cargas.length === cargasIniciales + 1 && r1.modelo === r2.modelo,
      `loads=${h.cargas.length} (antes ${cargasIniciales})`
    )

    await reg.recargar(CLAVE_A)
    check(
      '(8e) una recarga POSTERIOR sí vuelve a leer (el single-flight no se queda pegado)',
      h.cargas.length === cargasIniciales + 2,
      `loads=${h.cargas.length}`
    )
  }
  {
    // EL ECO DEL PROPIO GUARDADO. Desde que el watcher dispara recargas, tu Ctrl+S
    // vuelve por ese camino: `files.escribirArchivo` no silencia el watcher, así que el
    // guardado emite su propio aviso 200-600 ms después, con el buffer YA LIMPIO (y
    // por tanto sin la guarda del dirty que protege las ediciones a medias). Si esa
    // recarga llamara a `setValue`, se llevaría por delante la pila de deshacer en
    // CADA guardado: escribir, guardar, esperar un segundo y Ctrl+Z no haría nada.
    // Aquí se fija que un contenido idéntico no toca el modelo. La versión del modelo
    // falso solo sube en `setValue`, así que es el testigo exacto.
    const h = crearArnes()
    h.fijarArchivo('src/index.ts', { contenido: 'igual que en disco\n' })
    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir(CLAVE_A, EN_A)
    const m = s.modelo!
    const versionAntes = m.version

    await reg.recargar(CLAVE_A)
    check(
      '(8f) recargar con el MISMO contenido NO toca el modelo (conserva el deshacer)',
      m.version === versionAntes && m.texto === 'igual que en disco\n',
      `version ${versionAntes} -> ${m.version}`
    )
    check(
      '(8g) …y aun así el buffer queda LIMPIO (el punto limpio se re-ancla igual)',
      !reg.estaSucio(CLAVE_A),
      `dirty=${reg.estaSucio(CLAVE_A)}`
    )

    // Y lo que NO puede cambiar: cuando el contenido difiere de verdad, manda disco.
    h.fijarArchivo('src/index.ts', { contenido: 'reescrito por el agente\n' })
    await reg.recargar(CLAVE_A)
    check(
      '(8h) cuando el contenido DIFIERE, la recarga sí sustituye (el descarte sigue mandando)',
      m.texto === 'reescrito por el agente\n' && m.version > versionAntes,
      `texto=${JSON.stringify(m.texto)} version=${m.version}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(9) Reabrir con codificación y convertir')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    h.fijarArchivo('acentos.txt', { contenido: 'mojibake\n', encoding: 'utf8' })
    const reg = crearRegistro(h.deps)
    const clave = 'p|c\u0000acentos.txt'
    await reg.adquirir(clave, en('acentos.txt'))

    h.fijarArchivo('acentos.txt', { contenido: 'función café\n', encoding: 'windows1252' })
    await reg.recargar(clave, { encodingForzado: 'windows1252' })
    check(
      '(9a) reabrir con codificación actualiza la codificación de la entrada',
      reg.consultar(clave)?.encoding === 'windows1252',
      `encoding=${reg.consultar(clave)?.encoding}`
    )

    const s = reg.consultar(clave)!
    h.teclear(s.modelo!, 'función café editado\n')
    await reg.guardar(clave)
    check(
      '(9b) el guardado siguiente usa ESA codificación (no vuelve a utf8)',
      h.escrituras.length === 1 && h.escrituras[0][2] === 'windows1252',
      JSON.stringify(h.escrituras)
    )
  }
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir(CLAVE_A, EN_A)

    const sinCambio = await reg.convertir(CLAVE_A, { encodingId: 'utf8', eol: 'LF' })
    check(
      '(9c) convertir a lo que YA tiene devuelve null y no escribe',
      sinCambio === null && h.escrituras.length === 0,
      `res=${sinCambio} writes=${h.escrituras.length}`
    )

    const res = await reg.convertir(CLAVE_A, { eol: 'CRLF' })
    check(
      '(9d) convertir el EOL escribe y deja el buffer limpio',
      res !== null && h.escrituras.length === 1 && !reg.estaSucio(CLAVE_A),
      `res=${JSON.stringify(res)} dirty=${reg.estaSucio(CLAVE_A)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(10) peek / contarRefs no tienen efectos secundarios')
  // ---------------------------------------------------------------------------
  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const entradaAntes = reg.consultar(CLAVE_A)
    const antesRef = reg.contarRefs(CLAVE_A)
    check(
      '(10a) consultar una key no adquirida no dispara carga ni crea entrada',
      entradaAntes === null && antesRef === 0 && h.cargas.length === 0,
      `peek=${entradaAntes} contarRefs=${antesRef} loads=${h.cargas.length}`
    )

    await reg.adquirir(CLAVE_A, EN_A)
    reg.consultar(CLAVE_A)
    reg.consultar(CLAVE_A)
    check(
      '(10b) consultar una key adquirida no toca el refcount ni relee',
      reg.contarRefs(CLAVE_A) === 1 && h.cargas.length === 1,
      `contarRefs=${reg.contarRefs(CLAVE_A)} loads=${h.cargas.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(11) Un fallo de lectura no deja la entrada cacheada en estado de error')
  // ---------------------------------------------------------------------------
  {
    // El fallo simulado es un EACCES y NO un ENOENT a propósito: «no existe» ya no es
    // un fallo de lectura sino un estado (ver (11b)), así que usarlo aquí probaría
    // otra cosa. Lo que este caso protege es el fallo DE VERDAD: que la promesa
    // rechazada no se quede cacheada y el siguiente acquire reintente.
    const h = crearArnes()
    let fallar = true
    const original = h.deps.cargar
    h.deps.cargar = async (p, enc) => {
      if (fallar) {
        fallar = false
        throw new Error('EACCES: permission denied')
      }
      return original(p, enc)
    }
    const reg = crearRegistro(h.deps)

    let lanzo = false
    try {
      await reg.adquirir(CLAVE_A, EN_A)
    } catch {
      lanzo = true
    }
    reg.release(CLAVE_A) // el pane suelta en su cleanup aunque la carga fallara

    const s = await reg.adquirir(CLAVE_A, EN_A)
    check(
      '(11a) tras un fallo de lectura, el siguiente acquire REINTENTA y funciona',
      lanzo && s.modelo !== null,
      `lanzo=${lanzo} model=${s.modelo?.id}`
    )
  }

  {
    // ABRIR algo que YA NO ESTÁ: pasa al restaurar las pestañas en el arranque
    // después de que el archivo desapareciera con Tessera cerrada (`git checkout` de
    // otra rama, una sincronización, otra máquina). No es un error: es el mismo
    // estado que el borrado con la pestaña abierta, y se pinta igual.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    h.borrarArchivo('src/App.java')
    let lanzo = false
    let s: ModeloTextoCompartido<ModeloFalso> | null = null
    try {
      s = await reg.adquirir('k:java', en('src/App.java'))
    } catch {
      lanzo = true
    }
    check(
      '(11b) abrir un archivo inexistente NO revienta: nace vacío y MARCADO',
      !lanzo && s?.modelo?.texto === '' && reg.estaBorrado('k:java'),
      `lanzo=${lanzo} texto=${JSON.stringify(s?.modelo?.texto)} borrado=${reg.estaBorrado('k:java')}`
    )
    check(
      '(11c) y NO nace sucio: no has escrito nada todavía',
      !reg.estaSucio('k:java'),
      `estaSucio=${reg.estaSucio('k:java')}`
    )
    check(
      '(11d) el lenguaje sale del NOMBRE, que es lo único que hay',
      s?.lenguaje === 'java',
      `language=${s?.lenguaje}`
    )
    // Y el Ctrl+S lo crea: la guarda de `save` pasa por `borrado` aunque esté limpio.
    const res = await reg.guardar('k:java')
    check(
      '(11e) Ctrl+S lo CREA en disco y quita la marca',
      res !== null && h.escrituras.at(-1)?.[0] === 'src/App.java' && !reg.estaBorrado('k:java'),
      `writes=${JSON.stringify(h.escrituras.at(-1))}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(12) Un fallo de lectura TARDIO no debe llevarse por delante al titular nuevo')
  // ---------------------------------------------------------------------------
  {
    // Secuencia exacta: se suelta MIENTRAS carga (React en modo estricto monta, desmonta
    // y vuelve a montar), se re-adquiere la MISMA clave, y solo ENTONCES rechaza la
    // lectura vieja. Si su limpieza borrase la entrada por clave y no por identidad, se
    // llevaría por delante el buffer del titular NUEVO: su pane parecería vivo (Monaco
    // pinta el texto) pero el punto de "sin guardar" dejaría de aparecer y el Ctrl+S
    // fallaría con "Buffer no adquirido".
    const h = crearArnes()
    const esperas: Array<() => void> = []
    let n = 0
    h.deps.cargar = () =>
      new Promise((resolver, rechazar) => {
        n++
        const mia = n
        esperas.push(() =>
          mia === 1
            ? rechazar(new Error('ENOENT: no such file'))
            : resolver({
                contenido: 'contenido bueno\n',
                lenguaje: 'plaintext',
                encoding: 'utf8',
                truncado: false,
                binario: false
              })
        )
      })

    const reg = crearRegistro(h.deps)
    const p1 = reg.adquirir(CLAVE_A, EN_A)
    reg.release(CLAVE_A) // suelta con la primera carga aun en vuelo
    const p2 = reg.adquirir(CLAVE_A, EN_A) // titular NUEVO, entrada nueva

    esperas[0]() // ahora falla la lectura VIEJA
    await p1.catch(() => {})
    esperas[1]() // y resuelve la del titular nuevo
    const s2 = await p2

    check(
      '(12a) el titular nuevo conserva su entrada en el registro',
      reg.consultar(CLAVE_A) !== null && reg.contarRefs(CLAVE_A) === 1,
      `peek=${reg.consultar(CLAVE_A) === null ? 'null' : 'ok'} contarRefs=${reg.contarRefs(CLAVE_A)}`
    )

    const vistos: boolean[] = []
    reg.suscribirSucio(CLAVE_A, (d) => vistos.push(d))
    if (s2.modelo) h.teclear(s2.modelo, 'editado por el usuario\n')
    check(
      '(12b) su estado sucio sigue vivo (el dot no se queda mudo)',
      vistos.at(-1) === true && reg.estaSucio(CLAVE_A),
      `vistos=${JSON.stringify(vistos)} dirty=${reg.estaSucio(CLAVE_A)}`
    )

    let guardo = false
    let err = ''
    try {
      await reg.guardar(CLAVE_A)
      guardo = true
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
    check(
      '(12c) su Ctrl+S sigue funcionando (no "Buffer no adquirido")',
      guardo && h.escrituras.length === 1,
      guardo ? `escrito=${JSON.stringify(h.escrituras[0])}` : `LANZO: ${err}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(13) BORRAR el archivo con la pestaña abierta: se marca, NO se rompe, y Ctrl+S lo recrea')

  {
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    h.fijarArchivo('src/env', { contenido: 'A=1\n' })
    await reg.adquirir('k:src/env', en('src/env'))

    const vistos: boolean[] = []
    const off = reg.suscribirBorrado('k:src/env', (b) => vistos.push(b))
    check(
      '(13a) al suscribirse emite el estado actual (no borrado)',
      vistos.length === 1 && vistos[0] === false,
      `vistos=${JSON.stringify(vistos)}`
    )

    // Alguien lo borra por fuera y el watcher dispara la recarga.
    h.borrarArchivo('src/env')
    const shared = await reg.recargar('k:src/env')
    check(
      '(13b) la recarga NO lanza: un archivo que ya no está no es un fallo que reportar',
      shared.clave === 'k:src/env',
      'devolvió el snapshot en vez de rechazar'
    )
    check('(13c) queda marcado como borrado', reg.estaBorrado('k:src/env'), 'estaBorrado=true')
    check(
      '(13d) y los titulares se enteran',
      vistos.length === 2 && vistos[1] === true,
      `vistos=${JSON.stringify(vistos)}`
    )
    const modelo = reg.consultar('k:src/env')?.modelo
    check(
      '(13e) EL CONTENIDO SIGUE VIVO (es lo que el usuario tiene delante)',
      modelo !== null && modelo !== undefined && modelo.texto === 'A=1\n',
      `texto=${JSON.stringify(modelo?.texto)}`
    )

    // Ctrl+S sobre un buffer LIMPIO: sin la marca esto sería un no-op y el usuario
    // se quedaría sin forma de recuperar el archivo.
    const antes = h.escrituras.length
    const res = await reg.guardar('k:src/env')
    check(
      '(13f) Ctrl+S RECREA el archivo aunque el buffer esté limpio',
      res !== null && h.escrituras.length === antes + 1 && h.escrituras[antes][1] === 'A=1\n',
      `writes=${JSON.stringify(h.escrituras.slice(antes))}`
    )
    check(
      '(13g) y tras guardarlo deja de estar borrado',
      !reg.estaBorrado('k:src/env') && vistos[vistos.length - 1] === false,
      `estaBorrado=${reg.estaBorrado('k:src/env')} vistos=${JSON.stringify(vistos)}`
    )

    // Un segundo Ctrl+S sin cambios vuelve a ser no-op: la marca no se queda pegada.
    const antes2 = h.escrituras.length
    const res2 = await reg.guardar('k:src/env')
    check(
      '(13h) el siguiente Ctrl+S vuelve a ser no-op (no se bumpea el mtime en vano)',
      res2 === null && h.escrituras.length === antes2,
      `res2=${JSON.stringify(res2)}`
    )
    off()
  }

  {
    // Y el camino de vuelta: si el archivo REAPARECE (un `git checkout`, alguien lo
    // recrea), la marca se quita sola en la siguiente recarga.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    h.fijarArchivo('a.txt', { contenido: 'uno\n' })
    await reg.adquirir('k:a', en('a.txt'))
    h.borrarArchivo('a.txt')
    await reg.recargar('k:a')
    check('(13i) marcado tras el borrado', reg.estaBorrado('k:a'), 'estaBorrado=true')
    h.recrearArchivo('a.txt', 'dos\n')
    await reg.recargar('k:a')
    check('(13j) al reaparecer se desmarca sola', !reg.estaBorrado('k:a'), 'estaBorrado=false')
    check(
      '(13k) y el contenido de disco vuelve a mandar',
      reg.consultar('k:a')?.modelo?.texto === 'dos\n',
      `texto=${JSON.stringify(reg.consultar('k:a')?.modelo?.texto)}`
    )
  }

  {
    // Un fallo que NO es «no existe» SÍ tiene que subir: ahí el cartel dice la verdad.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir('k:b', en('b.txt'))
    const original = h.deps.cargar
    h.deps.cargar = async () => {
      throw new Error('EACCES: permission denied')
    }
    let lanzo = false
    try {
      await reg.recargar('k:b')
    } catch {
      lanzo = true
    }
    h.deps.cargar = original
    check('(13l) un EACCES sigue subiendo como error', lanzo, 'reload rechazó')
    check('(13m) y NO se marca como borrado', !reg.estaBorrado('k:b'), 'estaBorrado=false')
  }

  hr('(14) esArchivoInexistente: qué mensajes cuentan como «ya no está»')

  check(
    '(14a) el ENOENT real del IPC de Electron',
    esArchivoInexistente(
      new Error(
        "Error invoking remote method 'files:readFile': Error: ENOENT: no such file or directory, stat 'D:\\proyecto\\src\\env'"
      )
    ),
    'es el mensaje literal que se vio en la app'
  )
  check('(14b) el texto en claro, sin el código', esArchivoInexistente(new Error('no such file or directory')), '')
  check(
    '(14c) ENOTDIR: borraron la CARPETA que lo contenía, y para el usuario es lo mismo',
    esArchivoInexistente(new Error('ENOTDIR: not a directory')),
    ''
  )
  check('(14d) un EACCES NO cuenta', !esArchivoInexistente(new Error('EACCES: permission denied')), '')
  check('(14e) ni un fallo cualquiera', !esArchivoInexistente(new Error('algo se rompió')), '')
  check('(14f) ni un no-Error', !esArchivoInexistente(null) && !esArchivoInexistente(undefined), '')

  hr('(15) revisarBorrado: el camino del buffer SUCIO, que no puede releer')

  {
    // EL CASO QUE FALTABA, y era el peor de todos: te borran el archivo cuyo único
    // ejemplar son tus cambios sin guardar. La detección vivía dentro de `reload`, y
    // `reload` no toca los buffers sucios (destruiría el trabajo), así que la
    // pestaña no se tachaba justo cuando más importaba.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const compartido = await reg.adquirir('k:a', en('a.txt'))
    h.teclear(compartido.modelo as ModeloFalso, 'MIS CAMBIOS\n')
    check('(15a) el buffer está sucio', reg.estaSucio('k:a'), 'estaSucio=true')

    const cargasAntes = h.cargas.length
    h.borrarArchivo('a.txt')
    const marcado = await reg.revisarBorrado('k:a')
    check('(15b) se marca como borrado sin releer', marcado && reg.estaBorrado('k:a'), 'estaBorrado=true')
    check(
      '(15c) y NO se leyó el archivo: solo se preguntó si existe',
      h.cargas.length === cargasAntes && h.existencias.at(-1) === 'a.txt',
      `loads=${h.cargas.length - cargasAntes} existencias=${JSON.stringify(h.existencias)}`
    )
    check(
      '(15d) las ediciones siguen intactas',
      compartido.modelo?.texto === 'MIS CAMBIOS\n' && reg.estaSucio('k:a'),
      `texto=${JSON.stringify(compartido.modelo?.texto)}`
    )

    // Reaparece por fuera: la marca se va sola, y el buffer sucio SIGUE sucio (no se
    // recarga; lo de disco no manda sobre unas ediciones sin guardar).
    h.recrearArchivo('a.txt', 'otra cosa\n')
    await reg.revisarBorrado('k:a')
    check('(15e) al reaparecer se desmarca', !reg.estaBorrado('k:a'), 'estaBorrado=false')
    check(
      '(15f) y las ediciones NO se pisan con lo de disco',
      compartido.modelo?.texto === 'MIS CAMBIOS\n',
      `texto=${JSON.stringify(compartido.modelo?.texto)}`
    )

    // Y el Ctrl+S de un buffer sucio Y borrado escribe LO EDITADO.
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    const res = await reg.guardar('k:a')
    check(
      '(15g) Ctrl+S recrea el archivo con lo editado',
      res !== null && h.escrituras.at(-1)?.[1] === 'MIS CAMBIOS\n',
      `writes=${JSON.stringify(h.escrituras.at(-1))}`
    )
    check('(15h) y la pestaña queda limpia y sin marca', !reg.estaSucio('k:a') && !reg.estaBorrado('k:a'), '')
  }

  {
    // Los avisadores: una key que no existe, y un fallo de la propia pregunta.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    check('(15i) una key no adquirida responde false sin reventar', (await reg.revisarBorrado('k:nada')) === false, '')

    await reg.adquirir('k:a', en('a.txt'))
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    check('(15j) marcada', reg.estaBorrado('k:a'), 'estaBorrado=true')
    // Si la pregunta falla no se puede concluir nada: la marca se queda como estaba.
    // Moverla sería tachar (o destachar) una pestaña por un fallo de programación.
    h.romperExistencia(true)
    const tras = await reg.revisarBorrado('k:a')
    check('(15k) un fallo de la pregunta NO mueve la marca', tras && reg.estaBorrado('k:a'), 'sigue marcada')
    h.romperExistencia(false)
  }

  {
    // LA MARCA PUEDE SER UN FALSO POSITIVO, y con el buffer limpio escribir sería
    // PERDER DATOS: `git checkout` desenlaza y recrea, así que una recarga caída en
    // esa ventana marca la entrada sobre un archivo que git acaba de escribir.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir('k:a', en('a.txt'))
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    check('(15m) marcada por la ventana del checkout', reg.estaBorrado('k:a'), 'estaBorrado=true')

    // El archivo YA está de vuelta (lo escribió git), pero la marca sigue puesta.
    h.recrearArchivo('a.txt', 'LO QUE ESCRIBIÓ GIT\n')
    const escrituras = h.escrituras.length
    const res = await reg.guardar('k:a')
    check(
      '(15n) Ctrl+S NO machaca el archivo que volvió',
      res === null && h.escrituras.length === escrituras,
      `res=${res} escrituras nuevas=${h.escrituras.length - escrituras}`
    )
    check('(15o) y la marca falsa se retira', !reg.estaBorrado('k:a'), `estaBorrado=${reg.estaBorrado('k:a')}`)
  }

  {
    // Pero con el buffer SUCIO se escribe SIN preguntar: ahí mandan tus ediciones,
    // exista el archivo o no. Es lo que el estándar promete y no se puede ablandar.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    const s = await reg.adquirir('k:a', en('a.txt'))
    h.teclear(s.modelo as ModeloFalso, 'MIS CAMBIOS\n')
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    h.recrearArchivo('a.txt', 'LO QUE ESCRIBIÓ GIT\n') // reapareció, marca aún puesta
    const preguntas = h.existencias.length
    const res = await reg.guardar('k:a')
    check(
      '(15p) un buffer SUCIO se guarda igual, y sin preguntar',
      res !== null && h.escrituras.at(-1)?.[1] === 'MIS CAMBIOS\n' && h.existencias.length === preguntas,
      `writes=${JSON.stringify(h.escrituras.at(-1))} preguntas nuevas=${h.existencias.length - preguntas}`
    )
    check('(15q) y queda limpio y sin marca', !reg.estaSucio('k:a') && !reg.estaBorrado('k:a'), '')
  }

  {
    // Y el caso legítimo sigue funcionando: limpio, marcado y el archivo NO está.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir('k:a', en('a.txt'))
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    const res = await reg.guardar('k:a')
    check(
      '(15r) borrado DE VERDAD: Ctrl+S sigue recreándolo',
      res !== null && h.escrituras.at(-1)?.[0] === 'a.txt',
      `writes=${JSON.stringify(h.escrituras.at(-1))}`
    )
  }

  {
    // Si la pregunta falla no se puede concluir nada, y aquí se decide a favor del
    // gesto: el usuario pulsó Ctrl+S, así que se escribe.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir('k:a', en('a.txt'))
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    h.romperExistencia(true)
    const res = await reg.guardar('k:a')
    h.romperExistencia(false)
    check(
      '(15s) con la pregunta caída, el Ctrl+S se respeta',
      res !== null && h.escrituras.at(-1)?.[0] === 'a.txt',
      `writes=${JSON.stringify(h.escrituras.at(-1))}`
    )
  }

  {
    // Guarda post-await: la key se recicla para OTRO archivo mientras se pregunta.
    const h = crearArnes()
    const reg = crearRegistro(h.deps)
    await reg.adquirir('k:a', en('viejo.txt'))
    h.borrarArchivo('viejo.txt')
    const enVuelo = reg.revisarBorrado('k:a')
    reg.release('k:a')
    await reg.adquirir('k:a', en('nuevo.txt'))
    await enVuelo
    check(
      '(15l) la respuesta del inquilino VIEJO no marca al NUEVO',
      !reg.estaBorrado('k:a'),
      `estaBorrado=${reg.estaBorrado('k:a')} path=${reg.consultar('k:a')?.ruta}`
    )
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
