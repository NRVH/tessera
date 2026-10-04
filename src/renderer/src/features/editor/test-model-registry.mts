#!/usr/bin/env node
// =============================================================================
// Prueba del registro de buffers compartidos (node src/renderer/src/features/editor/test-model-registry.mts).
// Ejercita el núcleo puro (`modelRegistryCore.ts`) con un modelo falso, lo que permite observar
// que el modelo no se dispone, que su identidad se conserva tras recargar y que `write` no se llama.
// Solo Node core: sin Monaco, sin DOM, sin React.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import {
  createRegistry,
  esArchivoInexistente,
  ModelSaveBlocked,
  type LoadedText,
  type RegistryDeps,
  type SharedTextModel,
  type WriteOutcome
} from './modelRegistryCore.ts'

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que test-editor-tabs.mts)
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
interface FakeModel {
  id: number
  text: string
  lang: string
  eol: 'CRLF' | 'LF'
  version: number
  disposed: boolean
  subs: Set<() => void>
}

interface Harness {
  deps: RegistryDeps<FakeModel>
  /** Llamadas a load, por ruta. */
  loads: string[]
  /** Preguntas de EXISTENCIA, por ruta (el camino del buffer sucio: no lee). */
  existencias: string[]
  /** Escrituras registradas: [ruta, contenido, encoding]. */
  writes: Array<[string, string, string]>
  /** Modelos creados, en orden (para comprobar disposes). */
  created: FakeModel[]
  /** Fija lo que devolverá la próxima carga de esa ruta. */
  setFile(path: string, file: Partial<LoadedText> & { content: string }): void
  /** Borra la ruta: las cargas siguientes fallan con un ENOENT como el real. */
  borrarArchivo(path: string): void
  /** La devuelve a la existencia. */
  recrearArchivo(path: string, content?: string): void
  /** Edita el modelo como haría el usuario (mueve la versión y notifica). */
  type(model: FakeModel, text: string): void
  /** Hace que las cargas queden EN VUELO hasta llamar a flushLoads(). */
  holdLoads(): void
  flushLoads(): Promise<void>
  /** Hace que la pregunta de existencia FALLE (IPC caído, ruta rechazada). */
  romperExistencia(roto: boolean): void
}

function makeHarness(): Harness {
  const files = new Map<string, LoadedText>()
  const borrados = new Set<string>()
  const loads: string[] = []
  const existencias: string[] = []
  const writes: Array<[string, string, string]> = []
  const created: FakeModel[] = []
  let nextId = 1
  let held: Array<() => void> | null = null
  let falloExistencia = false

  const fileOf = (path: string): LoadedText =>
    files.get(path) ?? {
      content: `contenido de ${path}\n`,
      language: 'plaintext',
      encoding: 'utf8',
      truncated: false,
      binary: false
    }

  const deps: RegistryDeps<FakeModel> = {
    createModel(text, language) {
      const m: FakeModel = {
        id: nextId++,
        text,
        lang: language,
        eol: 'LF',
        version: 1,
        disposed: false,
        subs: new Set()
      }
      created.push(m)
      return m
    },
    disposeModel(model) {
      model.disposed = true
    },
    setValue(model, text) {
      model.text = text
      model.version++
      for (const s of [...model.subs]) s()
    },
    setLanguage(model, language) {
      model.lang = language
    },
    getEol(model) {
      return model.eol
    },
    setEol(model, eol) {
      model.eol = eol
      model.version++
      for (const s of [...model.subs]) s()
    },
    versionId(model) {
      return model.version
    },
    getValue(model) {
      return model.text
    },
    observe(model, onChange) {
      model.subs.add(onChange)
      return () => {
        model.subs.delete(onChange)
      }
    },
    async load(path) {
      loads.push(path)
      if (borrados.has(path)) {
        // El texto es el que de verdad llega: el `fs` del main envuelto por el IPC
        // de Electron, que se come el `code` y deja sólo el mensaje.
        throw new Error(
          `Error invoking remote method 'files:readFile': Error: ENOENT: no such file or directory, stat '${path}'`
        )
      }
      if (held !== null) {
        await new Promise<void>((resolve) => held!.push(resolve))
      }
      return fileOf(path)
    },
    async existe(path) {
      existencias.push(path)
      if (falloExistencia) throw new Error('el IPC de existencia se cayó')
      return !borrados.has(path)
    },
    async write(path, content, encoding): Promise<WriteOutcome> {
      writes.push([path, content, encoding])
      return { bytesWritten: Buffer.byteLength(content, 'utf8') }
    }
  }

  return {
    deps,
    loads,
    existencias,
    writes,
    created,
    romperExistencia(roto) {
      falloExistencia = roto
    },
    borrarArchivo(path) {
      borrados.add(path)
    },
    recrearArchivo(path, content) {
      borrados.delete(path)
      if (content !== undefined) {
        files.set(path, {
          content,
          language: 'plaintext',
          encoding: 'utf8',
          truncated: false,
          binary: false
        })
      }
    },
    setFile(path, file) {
      files.set(path, {
        language: 'plaintext',
        encoding: 'utf8',
        truncated: false,
        binary: false,
        ...file
      })
    },
    type(model, text) {
      model.text = text
      model.version++
      for (const s of [...model.subs]) s()
    },
    holdLoads() {
      held = []
    },
    async flushLoads() {
      const pending = held ?? []
      held = null
      for (const resolve of pending) resolve()
      // Deja asentar las continuaciones encadenadas de las cargas liberadas.
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
    }
  }
}

const KEY_A = 'perfil1|C:/proy/a\u0000src/index.ts'
const KEY_B = 'perfil1|C:/proy/b\u0000src/index.ts'

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  hr('(1) DOS titulares de la misma key comparten UN buffer')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)

    const s1 = await reg.acquire(KEY_A, 'src/index.ts')
    const s2 = await reg.acquire(KEY_A, 'src/index.ts')

    check(
      '(1a) una sola lectura de disco para dos adquisiciones',
      h.loads.length === 1,
      `loads=${JSON.stringify(h.loads)}`
    )
    check(
      '(1b) ambos titulares reciben EL MISMO objeto de modelo (identidad ===)',
      s1.model !== null && s1.model === s2.model,
      `id1=${s1.model?.id} id2=${s2.model?.id}`
    )
    check('(1c) refCount = 2', reg.refCount(KEY_A) === 2, `refCount=${reg.refCount(KEY_A)}`)
  }

  // ---------------------------------------------------------------------------
  hr('(2) El modelo se dispone SOLO cuando lo suelta el ÚLTIMO titular')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const s = await reg.acquire(KEY_A, 'src/index.ts')
    await reg.acquire(KEY_A, 'src/index.ts')

    reg.release(KEY_A)
    check(
      '(2a) tras el primer release (2->1) el modelo SIGUE vivo',
      s.model !== null && !s.model.disposed && reg.refCount(KEY_A) === 1,
      `disposed=${s.model?.disposed} refCount=${reg.refCount(KEY_A)}`
    )

    reg.release(KEY_A)
    check(
      '(2b) tras el segundo release (1->0) el modelo se dispone',
      s.model !== null && s.model.disposed,
      `disposed=${s.model?.disposed}`
    )
    check(
      '(2c) la entrada sale del registro (peek null, refCount 0)',
      reg.peek(KEY_A) === null && reg.refCount(KEY_A) === 0,
      `peek=${reg.peek(KEY_A)} refCount=${reg.refCount(KEY_A)}`
    )

    // Defensa contra el doble cleanup de React: no debe re-disponer ni lanzar.
    reg.release(KEY_A)
    reg.release(KEY_A)
    check(
      '(2d) releases de más son no-op (no lanzan, no re-disponen)',
      h.created.filter((m) => m.disposed).length === 1,
      `dispuestos=${h.created.filter((m) => m.disposed).length}/${h.created.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) Carreras con la carga EN VUELO')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    h.holdLoads()

    // Dos adquisiciones en el MISMO tick, antes de que la carga resuelva.
    const p1 = reg.acquire(KEY_A, 'src/index.ts')
    const p2 = reg.acquire(KEY_A, 'src/index.ts')
    check(
      '(3a) el refcount sube SÍNCRONO: 2 aunque la carga siga en vuelo',
      reg.refCount(KEY_A) === 2,
      `refCount=${reg.refCount(KEY_A)}`
    )

    await h.flushLoads()
    const [a, b] = await Promise.all([p1, p2])
    check(
      '(3b) las dos adquisiciones concurrentes comparten modelo y solo hubo 1 lectura',
      a.model === b.model && a.model !== null && h.loads.length === 1,
      `mismo=${a.model === b.model} loads=${h.loads.length}`
    )
  }
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    h.holdLoads()

    const p = reg.acquire(KEY_A, 'src/index.ts')
    reg.release(KEY_A) // el pane se desmonta ANTES de que la carga termine
    await h.flushLoads()
    const s = await p

    check(
      '(3c) release durante la carga: no publica nada y no deja la entrada colgada',
      s.model === null && reg.peek(KEY_A) === null && reg.refCount(KEY_A) === 0,
      `model=${s.model} peek=${reg.peek(KEY_A)}`
    )
    check(
      '(3d) release durante la carga: si llegó a crearse un modelo, se dispuso (cero fugas)',
      h.created.every((m) => m.disposed),
      `creados=${h.created.length} vivos=${h.created.filter((m) => !m.disposed).length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(4) Aislamiento por key: la misma RUTA en dos proyectos son buffers distintos')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const a = await reg.acquire(KEY_A, 'src/index.ts')
    const b = await reg.acquire(KEY_B, 'src/index.ts')
    check(
      '(4a) dos keys distintas -> dos modelos distintos, dos lecturas',
      a.model !== b.model && h.loads.length === 2,
      `id_a=${a.model?.id} id_b=${b.model?.id} loads=${h.loads.length}`
    )
    reg.release(KEY_A)
    check(
      '(4b) cerrar uno no toca el otro',
      b.model !== null && !b.model.disposed && reg.refCount(KEY_B) === 1,
      `b.disposed=${b.model?.disposed} refCount_B=${reg.refCount(KEY_B)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(5) Estado sucio repartido a los N titulares')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const s = await reg.acquire(KEY_A, 'src/index.ts')
    await reg.acquire(KEY_A, 'src/index.ts')

    const vistos1: boolean[] = []
    const vistos2: boolean[] = []
    reg.subscribeDirty(KEY_A, (d) => vistos1.push(d))
    reg.subscribeDirty(KEY_A, (d) => vistos2.push(d))
    check(
      '(5a) al suscribirse se emite el estado ACTUAL (limpio)',
      vistos1.length === 1 && vistos1[0] === false && vistos2[0] === false,
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )

    h.type(s.model!, 'editado por el usuario\n')
    check(
      '(5b) una edición ensucia y avisa a los DOS titulares',
      vistos1.at(-1) === true && vistos2.at(-1) === true && reg.isDirty(KEY_A),
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )

    const antes = vistos1.length
    h.type(s.model!, 'editado otra vez\n')
    check(
      '(5c) seguir escribiendo NO reemite (solo se avisa cuando el estado cambia)',
      vistos1.length === antes,
      `emisiones=${vistos1.length} (antes ${antes})`
    )

    await reg.save(KEY_A)
    check(
      '(5d) guardar limpia a los DOS titulares (un Ctrl+S desde el diff limpia la pestaña)',
      vistos1.at(-1) === false && vistos2.at(-1) === false && !reg.isDirty(KEY_A),
      `v1=${JSON.stringify(vistos1)} v2=${JSON.stringify(vistos2)}`
    )
    check(
      '(5e) se escribió el contenido ACTUAL con la codificación de la entrada',
      h.writes.length === 1 && h.writes[0][1] === 'editado otra vez\n' && h.writes[0][2] === 'utf8',
      JSON.stringify(h.writes)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) Guardar: no-op en limpio, y edición DURANTE la escritura')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire(KEY_A, 'src/index.ts')
    const res = await reg.save(KEY_A)
    check(
      '(6a) guardar un buffer limpio devuelve null y NO escribe (no bumpea el mtime)',
      res === null && h.writes.length === 0,
      `res=${res} writes=${h.writes.length}`
    )
  }
  {
    const h = makeHarness()
    // `write` se queda en vuelo para poder teclear en medio.
    let liberar: (() => void) | null = null
    const original = h.deps.write
    h.deps.write = async (p, c, e) => {
      await new Promise<void>((resolve) => {
        liberar = resolve
      })
      return original(p, c, e)
    }

    const reg = createRegistry(h.deps)
    const s = await reg.acquire(KEY_A, 'src/index.ts')
    h.type(s.model!, 'version 1\n')

    const guardando = reg.save(KEY_A)
    await new Promise((r) => setImmediate(r))
    h.type(s.model!, 'version 2 escrita MIENTRAS se guardaba\n')
    liberar!()
    await guardando

    check(
      '(6b) editar durante el await del guardado deja el buffer SUCIO (lo escrito ya no es lo que hay)',
      reg.isDirty(KEY_A),
      `dirty=${reg.isDirty(KEY_A)} escrito=${JSON.stringify(h.writes[0]?.[1])}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) Guardas de pérdida de datos: truncado y binario')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    h.setFile('grande.txt', { content: 'solo el principio\n', truncated: true })
    const reg = createRegistry(h.deps)
    const key = 'p|c\u0000grande.txt'
    const s = await reg.acquire(key, 'grande.txt')
    h.type(s.model!, 'editado\n')

    let bloqueado = false
    let mensaje = ''
    try {
      await reg.save(key)
    } catch (err) {
      bloqueado = err instanceof ModelSaveBlocked
      mensaje = err instanceof Error ? err.message : String(err)
    }
    check(
      '(7a) guardar un TRUNCADO se rechaza con ModelSaveBlocked y NO escribe',
      bloqueado && h.writes.length === 0,
      `${mensaje} | writes=${h.writes.length}`
    )
  }
  {
    const h = makeHarness()
    h.setFile('logo.png', { content: '', binary: true })
    const reg = createRegistry(h.deps)
    const key = 'p|c\u0000logo.png'
    const s = await reg.acquire(key, 'logo.png')
    check('(7b) un binario no tiene modelo que compartir', s.model === null && s.binary, `model=${s.model}`)

    let bloqueado = false
    try {
      await reg.save(key)
    } catch (err) {
      bloqueado = err instanceof ModelSaveBlocked
    }
    check(
      '(7c) guardar un BINARIO se rechaza con ModelSaveBlocked y NO escribe',
      bloqueado && h.writes.length === 0,
      `bloqueado=${bloqueado} writes=${h.writes.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(8) Recargar MUTA el modelo, nunca lo reemplaza (la prueba anti-swap)')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    h.setFile('src/index.ts', { content: 'original\n' })
    const reg = createRegistry(h.deps)
    const s = await reg.acquire(KEY_A, 'src/index.ts')
    await reg.acquire(KEY_A, 'src/index.ts')
    const antes = s.model!

    const vistos: boolean[] = []
    reg.subscribeDirty(KEY_A, (d) => vistos.push(d))
    h.type(s.model!, 'cambios sin guardar\n')

    h.setFile('src/index.ts', { content: 'contenido revertido desde disco\n' })
    const tras = await reg.reload(KEY_A)

    check(
      '(8a) el modelo es EL MISMO objeto tras recargar (si se reemplazara, el otro titular quedaría muerto)',
      tras.model === antes && !antes.disposed,
      `mismo=${tras.model === antes} disposed=${antes.disposed}`
    )
    check(
      '(8b) el contenido se sustituyó por el de disco',
      antes.text === 'contenido revertido desde disco\n',
      JSON.stringify(antes.text)
    )
    check(
      '(8c) tras recargar el buffer queda LIMPIO y se avisa a los titulares',
      !reg.isDirty(KEY_A) && vistos.at(-1) === false,
      `dirty=${reg.isDirty(KEY_A)} vistos=${JSON.stringify(vistos)}`
    )
  }
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire(KEY_A, 'src/index.ts')
    const cargasIniciales = h.loads.length

    // Dos recargas en el mismo tick: descartar cambios con la pestaña Y el diff abiertos.
    const [r1, r2] = await Promise.all([reg.reload(KEY_A), reg.reload(KEY_A)])
    check(
      '(8d) dos recargas en el mismo tick = UNA sola lectura de disco (single-flight)',
      h.loads.length === cargasIniciales + 1 && r1.model === r2.model,
      `loads=${h.loads.length} (antes ${cargasIniciales})`
    )

    await reg.reload(KEY_A)
    check(
      '(8e) una recarga POSTERIOR sí vuelve a leer (el single-flight no se queda pegado)',
      h.loads.length === cargasIniciales + 2,
      `loads=${h.loads.length}`
    )
  }
  {
    // EL ECO DEL PROPIO GUARDADO. Desde que el watcher dispara recargas, tu Ctrl+S
    // vuelve por ese camino: `files.write` no silencia el watcher, así que el
    // guardado emite su propio aviso 200-600 ms después, con el buffer YA LIMPIO (y
    // por tanto sin la guarda del dirty que protege las ediciones a medias). Si esa
    // recarga llamara a `setValue`, se llevaría por delante la pila de deshacer en
    // CADA guardado: escribir, guardar, esperar un segundo y Ctrl+Z no haría nada.
    // Aquí se fija que un contenido idéntico no toca el modelo. La versión del modelo
    // falso solo sube en `setValue`, así que es el testigo exacto.
    const h = makeHarness()
    h.setFile('src/index.ts', { content: 'igual que en disco\n' })
    const reg = createRegistry(h.deps)
    const s = await reg.acquire(KEY_A, 'src/index.ts')
    const m = s.model!
    const versionAntes = m.version

    await reg.reload(KEY_A)
    check(
      '(8f) recargar con el MISMO contenido NO toca el modelo (conserva el deshacer)',
      m.version === versionAntes && m.text === 'igual que en disco\n',
      `version ${versionAntes} -> ${m.version}`
    )
    check(
      '(8g) …y aun así el buffer queda LIMPIO (el punto limpio se re-ancla igual)',
      !reg.isDirty(KEY_A),
      `dirty=${reg.isDirty(KEY_A)}`
    )

    // Y lo que NO puede cambiar: cuando el contenido difiere de verdad, manda disco.
    h.setFile('src/index.ts', { content: 'reescrito por el agente\n' })
    await reg.reload(KEY_A)
    check(
      '(8h) cuando el contenido DIFIERE, la recarga sí sustituye (el descarte sigue mandando)',
      m.text === 'reescrito por el agente\n' && m.version > versionAntes,
      `texto=${JSON.stringify(m.text)} version=${m.version}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(9) Reabrir con codificación y convertir')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    h.setFile('acentos.txt', { content: 'mojibake\n', encoding: 'utf8' })
    const reg = createRegistry(h.deps)
    const key = 'p|c\u0000acentos.txt'
    await reg.acquire(key, 'acentos.txt')

    h.setFile('acentos.txt', { content: 'función café\n', encoding: 'windows1252' })
    await reg.reload(key, { forcedEncoding: 'windows1252' })
    check(
      '(9a) reabrir con codificación actualiza la codificación de la entrada',
      reg.peek(key)?.encoding === 'windows1252',
      `encoding=${reg.peek(key)?.encoding}`
    )

    const s = reg.peek(key)!
    h.type(s.model!, 'función café editado\n')
    await reg.save(key)
    check(
      '(9b) el guardado siguiente usa ESA codificación (no vuelve a utf8)',
      h.writes.length === 1 && h.writes[0][2] === 'windows1252',
      JSON.stringify(h.writes)
    )
  }
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire(KEY_A, 'src/index.ts')

    const noop = await reg.convert(KEY_A, { encodingId: 'utf8', eol: 'LF' })
    check(
      '(9c) convertir a lo que YA tiene devuelve null y no escribe',
      noop === null && h.writes.length === 0,
      `res=${noop} writes=${h.writes.length}`
    )

    const res = await reg.convert(KEY_A, { eol: 'CRLF' })
    check(
      '(9d) convertir el EOL escribe y deja el buffer limpio',
      res !== null && h.writes.length === 1 && !reg.isDirty(KEY_A),
      `res=${JSON.stringify(res)} dirty=${reg.isDirty(KEY_A)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(10) peek / refCount no tienen efectos secundarios')
  // ---------------------------------------------------------------------------
  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const antesPeek = reg.peek(KEY_A)
    const antesRef = reg.refCount(KEY_A)
    check(
      '(10a) consultar una key no adquirida no dispara carga ni crea entrada',
      antesPeek === null && antesRef === 0 && h.loads.length === 0,
      `peek=${antesPeek} refCount=${antesRef} loads=${h.loads.length}`
    )

    await reg.acquire(KEY_A, 'src/index.ts')
    reg.peek(KEY_A)
    reg.peek(KEY_A)
    check(
      '(10b) consultar una key adquirida no toca el refcount ni relee',
      reg.refCount(KEY_A) === 1 && h.loads.length === 1,
      `refCount=${reg.refCount(KEY_A)} loads=${h.loads.length}`
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
    const h = makeHarness()
    let fallar = true
    const original = h.deps.load
    h.deps.load = async (p, enc) => {
      if (fallar) {
        fallar = false
        throw new Error('EACCES: permission denied')
      }
      return original(p, enc)
    }
    const reg = createRegistry(h.deps)

    let lanzo = false
    try {
      await reg.acquire(KEY_A, 'src/index.ts')
    } catch {
      lanzo = true
    }
    reg.release(KEY_A) // el pane suelta en su cleanup aunque la carga fallara

    const s = await reg.acquire(KEY_A, 'src/index.ts')
    check(
      '(11a) tras un fallo de lectura, el siguiente acquire REINTENTA y funciona',
      lanzo && s.model !== null,
      `lanzo=${lanzo} model=${s.model?.id}`
    )
  }

  {
    // ABRIR algo que YA NO ESTÁ: pasa al restaurar las pestañas en el arranque
    // después de que el archivo desapareciera con Tessera cerrada (`git checkout` de
    // otra rama, una sincronización, otra máquina). No es un error: es el mismo
    // estado que el borrado con la pestaña abierta, y se pinta igual.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    h.borrarArchivo('src/App.java')
    let lanzo = false
    let s: SharedTextModel<FakeModel> | null = null
    try {
      s = await reg.acquire('k:java', 'src/App.java')
    } catch {
      lanzo = true
    }
    check(
      '(11b) abrir un archivo inexistente NO revienta: nace vacío y MARCADO',
      !lanzo && s?.model?.text === '' && reg.estaBorrado('k:java'),
      `lanzo=${lanzo} texto=${JSON.stringify(s?.model?.text)} borrado=${reg.estaBorrado('k:java')}`
    )
    check(
      '(11c) y NO nace sucio: no has escrito nada todavía',
      !reg.isDirty('k:java'),
      `isDirty=${reg.isDirty('k:java')}`
    )
    check(
      '(11d) el lenguaje sale del NOMBRE, que es lo único que hay',
      s?.language === 'java',
      `language=${s?.language}`
    )
    // Y el Ctrl+S lo crea: la guarda de `save` pasa por `borrado` aunque esté limpio.
    const res = await reg.save('k:java')
    check(
      '(11e) Ctrl+S lo CREA en disco y quita la marca',
      res !== null && h.writes.at(-1)?.[0] === 'src/App.java' && !reg.estaBorrado('k:java'),
      `writes=${JSON.stringify(h.writes.at(-1))}`
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
    const h = makeHarness()
    const esperas: Array<() => void> = []
    let n = 0
    h.deps.load = () =>
      new Promise((resolve, reject) => {
        n++
        const mia = n
        esperas.push(() =>
          mia === 1
            ? reject(new Error('ENOENT: no such file'))
            : resolve({
                content: 'contenido bueno\n',
                language: 'plaintext',
                encoding: 'utf8',
                truncated: false,
                binary: false
              })
        )
      })

    const reg = createRegistry(h.deps)
    const p1 = reg.acquire(KEY_A, 'src/index.ts')
    reg.release(KEY_A) // suelta con la primera carga aun en vuelo
    const p2 = reg.acquire(KEY_A, 'src/index.ts') // titular NUEVO, entrada nueva

    esperas[0]() // ahora falla la lectura VIEJA
    await p1.catch(() => {})
    esperas[1]() // y resuelve la del titular nuevo
    const s2 = await p2

    check(
      '(12a) el titular nuevo conserva su entrada en el registro',
      reg.peek(KEY_A) !== null && reg.refCount(KEY_A) === 1,
      `peek=${reg.peek(KEY_A) === null ? 'null' : 'ok'} refCount=${reg.refCount(KEY_A)}`
    )

    const vistos: boolean[] = []
    reg.subscribeDirty(KEY_A, (d) => vistos.push(d))
    if (s2.model) h.type(s2.model, 'editado por el usuario\n')
    check(
      '(12b) su estado sucio sigue vivo (el dot no se queda mudo)',
      vistos.at(-1) === true && reg.isDirty(KEY_A),
      `vistos=${JSON.stringify(vistos)} dirty=${reg.isDirty(KEY_A)}`
    )

    let guardo = false
    let err = ''
    try {
      await reg.save(KEY_A)
      guardo = true
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
    check(
      '(12c) su Ctrl+S sigue funcionando (no "Buffer no adquirido")',
      guardo && h.writes.length === 1,
      guardo ? `escrito=${JSON.stringify(h.writes[0])}` : `LANZO: ${err}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(13) BORRAR el archivo con la pestaña abierta: se marca, NO se rompe, y Ctrl+S lo recrea')

  {
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    h.setFile('src/env', { content: 'A=1\n' })
    await reg.acquire('k:src/env', 'src/env')

    const vistos: boolean[] = []
    const off = reg.subscribeBorrado('k:src/env', (b) => vistos.push(b))
    check(
      '(13a) al suscribirse emite el estado actual (no borrado)',
      vistos.length === 1 && vistos[0] === false,
      `vistos=${JSON.stringify(vistos)}`
    )

    // Alguien lo borra por fuera y el watcher dispara la recarga.
    h.borrarArchivo('src/env')
    const shared = await reg.reload('k:src/env')
    check(
      '(13b) la recarga NO lanza: un archivo que ya no está no es un fallo que reportar',
      shared.key === 'k:src/env',
      'devolvió el snapshot en vez de rechazar'
    )
    check('(13c) queda marcado como borrado', reg.estaBorrado('k:src/env'), 'estaBorrado=true')
    check(
      '(13d) y los titulares se enteran',
      vistos.length === 2 && vistos[1] === true,
      `vistos=${JSON.stringify(vistos)}`
    )
    const modelo = reg.peek('k:src/env')?.model
    check(
      '(13e) EL CONTENIDO SIGUE VIVO (es lo que el usuario tiene delante)',
      modelo !== null && modelo !== undefined && modelo.text === 'A=1\n',
      `texto=${JSON.stringify(modelo?.text)}`
    )

    // Ctrl+S sobre un buffer LIMPIO: sin la marca esto sería un no-op y el usuario
    // se quedaría sin forma de recuperar el archivo.
    const antes = h.writes.length
    const res = await reg.save('k:src/env')
    check(
      '(13f) Ctrl+S RECREA el archivo aunque el buffer esté limpio',
      res !== null && h.writes.length === antes + 1 && h.writes[antes][1] === 'A=1\n',
      `writes=${JSON.stringify(h.writes.slice(antes))}`
    )
    check(
      '(13g) y tras guardarlo deja de estar borrado',
      !reg.estaBorrado('k:src/env') && vistos[vistos.length - 1] === false,
      `estaBorrado=${reg.estaBorrado('k:src/env')} vistos=${JSON.stringify(vistos)}`
    )

    // Un segundo Ctrl+S sin cambios vuelve a ser no-op: la marca no se queda pegada.
    const antes2 = h.writes.length
    const res2 = await reg.save('k:src/env')
    check(
      '(13h) el siguiente Ctrl+S vuelve a ser no-op (no se bumpea el mtime en vano)',
      res2 === null && h.writes.length === antes2,
      `res2=${JSON.stringify(res2)}`
    )
    off()
  }

  {
    // Y el camino de vuelta: si el archivo REAPARECE (un `git checkout`, alguien lo
    // recrea), la marca se quita sola en la siguiente recarga.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    h.setFile('a.txt', { content: 'uno\n' })
    await reg.acquire('k:a', 'a.txt')
    h.borrarArchivo('a.txt')
    await reg.reload('k:a')
    check('(13i) marcado tras el borrado', reg.estaBorrado('k:a'), 'estaBorrado=true')
    h.recrearArchivo('a.txt', 'dos\n')
    await reg.reload('k:a')
    check('(13j) al reaparecer se desmarca sola', !reg.estaBorrado('k:a'), 'estaBorrado=false')
    check(
      '(13k) y el contenido de disco vuelve a mandar',
      reg.peek('k:a')?.model?.text === 'dos\n',
      `texto=${JSON.stringify(reg.peek('k:a')?.model?.text)}`
    )
  }

  {
    // Un fallo que NO es «no existe» SÍ tiene que subir: ahí el cartel dice la verdad.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire('k:b', 'b.txt')
    const original = h.deps.load
    h.deps.load = async () => {
      throw new Error('EACCES: permission denied')
    }
    let lanzo = false
    try {
      await reg.reload('k:b')
    } catch {
      lanzo = true
    }
    h.deps.load = original
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
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const compartido = await reg.acquire('k:a', 'a.txt')
    h.type(compartido.model as FakeModel, 'MIS CAMBIOS\n')
    check('(15a) el buffer está sucio', reg.isDirty('k:a'), 'isDirty=true')

    const antesDeLoads = h.loads.length
    h.borrarArchivo('a.txt')
    const marcado = await reg.revisarBorrado('k:a')
    check('(15b) se marca como borrado sin releer', marcado && reg.estaBorrado('k:a'), 'estaBorrado=true')
    check(
      '(15c) y NO se leyó el archivo: solo se preguntó si existe',
      h.loads.length === antesDeLoads && h.existencias.at(-1) === 'a.txt',
      `loads=${h.loads.length - antesDeLoads} existencias=${JSON.stringify(h.existencias)}`
    )
    check(
      '(15d) las ediciones siguen intactas',
      compartido.model?.text === 'MIS CAMBIOS\n' && reg.isDirty('k:a'),
      `texto=${JSON.stringify(compartido.model?.text)}`
    )

    // Reaparece por fuera: la marca se va sola, y el buffer sucio SIGUE sucio (no se
    // recarga; lo de disco no manda sobre unas ediciones sin guardar).
    h.recrearArchivo('a.txt', 'otra cosa\n')
    await reg.revisarBorrado('k:a')
    check('(15e) al reaparecer se desmarca', !reg.estaBorrado('k:a'), 'estaBorrado=false')
    check(
      '(15f) y las ediciones NO se pisan con lo de disco',
      compartido.model?.text === 'MIS CAMBIOS\n',
      `texto=${JSON.stringify(compartido.model?.text)}`
    )

    // Y el Ctrl+S de un buffer sucio Y borrado escribe LO EDITADO.
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    const res = await reg.save('k:a')
    check(
      '(15g) Ctrl+S recrea el archivo con lo editado',
      res !== null && h.writes.at(-1)?.[1] === 'MIS CAMBIOS\n',
      `writes=${JSON.stringify(h.writes.at(-1))}`
    )
    check('(15h) y la pestaña queda limpia y sin marca', !reg.isDirty('k:a') && !reg.estaBorrado('k:a'), '')
  }

  {
    // Los avisadores: una key que no existe, y un fallo de la propia pregunta.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    check('(15i) una key no adquirida responde false sin reventar', (await reg.revisarBorrado('k:nada')) === false, '')

    await reg.acquire('k:a', 'a.txt')
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
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire('k:a', 'a.txt')
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    check('(15m) marcada por la ventana del checkout', reg.estaBorrado('k:a'), 'estaBorrado=true')

    // El archivo YA está de vuelta (lo escribió git), pero la marca sigue puesta.
    h.recrearArchivo('a.txt', 'LO QUE ESCRIBIÓ GIT\n')
    const escrituras = h.writes.length
    const res = await reg.save('k:a')
    check(
      '(15n) Ctrl+S NO machaca el archivo que volvió',
      res === null && h.writes.length === escrituras,
      `res=${res} escrituras nuevas=${h.writes.length - escrituras}`
    )
    check('(15o) y la marca falsa se retira', !reg.estaBorrado('k:a'), `estaBorrado=${reg.estaBorrado('k:a')}`)
  }

  {
    // Pero con el buffer SUCIO se escribe SIN preguntar: ahí mandan tus ediciones,
    // exista el archivo o no. Es lo que el estándar promete y no se puede ablandar.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    const s = await reg.acquire('k:a', 'a.txt')
    h.type(s.model as FakeModel, 'MIS CAMBIOS\n')
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    h.recrearArchivo('a.txt', 'LO QUE ESCRIBIÓ GIT\n') // reapareció, marca aún puesta
    const preguntas = h.existencias.length
    const res = await reg.save('k:a')
    check(
      '(15p) un buffer SUCIO se guarda igual, y sin preguntar',
      res !== null && h.writes.at(-1)?.[1] === 'MIS CAMBIOS\n' && h.existencias.length === preguntas,
      `writes=${JSON.stringify(h.writes.at(-1))} preguntas nuevas=${h.existencias.length - preguntas}`
    )
    check('(15q) y queda limpio y sin marca', !reg.isDirty('k:a') && !reg.estaBorrado('k:a'), '')
  }

  {
    // Y el caso legítimo sigue funcionando: limpio, marcado y el archivo NO está.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire('k:a', 'a.txt')
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    const res = await reg.save('k:a')
    check(
      '(15r) borrado DE VERDAD: Ctrl+S sigue recreándolo',
      res !== null && h.writes.at(-1)?.[0] === 'a.txt',
      `writes=${JSON.stringify(h.writes.at(-1))}`
    )
  }

  {
    // Si la pregunta falla no se puede concluir nada, y aquí se decide a favor del
    // gesto: el usuario pulsó Ctrl+S, así que se escribe.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire('k:a', 'a.txt')
    h.borrarArchivo('a.txt')
    await reg.revisarBorrado('k:a')
    h.romperExistencia(true)
    const res = await reg.save('k:a')
    h.romperExistencia(false)
    check(
      '(15s) con la pregunta caída, el Ctrl+S se respeta',
      res !== null && h.writes.at(-1)?.[0] === 'a.txt',
      `writes=${JSON.stringify(h.writes.at(-1))}`
    )
  }

  {
    // Guarda post-await: la key se recicla para OTRO archivo mientras se pregunta.
    const h = makeHarness()
    const reg = createRegistry(h.deps)
    await reg.acquire('k:a', 'viejo.txt')
    h.borrarArchivo('viejo.txt')
    const enVuelo = reg.revisarBorrado('k:a')
    reg.release('k:a')
    await reg.acquire('k:a', 'nuevo.txt')
    await enVuelo
    check(
      '(15l) la respuesta del inquilino VIEJO no marca al NUEVO',
      !reg.estaBorrado('k:a'),
      `estaBorrado=${reg.estaBorrado('k:a')} path=${reg.peek('k:a')?.path}`
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
