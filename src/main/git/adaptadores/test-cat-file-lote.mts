#!/usr/bin/env node
// =============================================================================
// Prueba del parser de `git cat-file --batch` (npm run test:cat-file-lote). Los cortes del flujo
// los decide la prueba, que es lo que permite el caso del fallo: el contenido acaba justo en el
// límite de un trozo y el salto separador llega en el siguiente. Cubre también trozo único, byte
// a byte, cabecera partida, «missing» intermedio, objeto sobre el tope (`cortado`), objeto vacío,
// flujo a medias (error) y cabecera ilegible.
// =============================================================================

import { ParserCatFile, type EstadoParser } from './catFileLote.ts'

// ---------------------------------------------------------------------------
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

const SHA = 'a'.repeat(40)

/** La respuesta de git para un objeto: cabecera, contenido y el salto separador. */
function respuesta(contenido: Buffer | string): Buffer {
  const bytes = typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : contenido
  const cabecera = Buffer.from(`${SHA} blob ${bytes.length}\n`, 'utf8')
  return Buffer.concat([cabecera, bytes, Buffer.from('\n', 'utf8')])
}
function faltante(rev: string): Buffer {
  return Buffer.from(`${rev} missing\n`, 'utf8')
}

/** Alimenta el parser con los trozos que se le den y devuelve el último estado. */
function alimentar(parser: ParserCatFile, trozos: readonly Buffer[]): EstadoParser {
  let estado: EstadoParser = { tipo: 'sigue' }
  for (const t of trozos) {
    estado = parser.trozo(t)
    if (estado.tipo !== 'sigue') return estado
  }
  return estado
}

/** Parte un buffer en trozos de `n` bytes. */
function partir(buf: Buffer, n: number): Buffer[] {
  const out: Buffer[] = []
  for (let i = 0; i < buf.length; i += n) out.push(buf.subarray(i, Math.min(i + n, buf.length)))
  return out
}

const texto = (b: Buffer | null): string => (b === null ? '<null>' : b.toString('utf8'))

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Una respuesta simple')
  {
    const p = new ParserCatFile(1, 1024)
    const estado = alimentar(p, [respuesta('hola mundo')])
    check('(1a) queda listo', estado.tipo === 'listo', estado.tipo)
    check(
      '(1b) el contenido llega exacto, sin el salto separador',
      p.resultados.length === 1 && texto(p.resultados[0].bytes) === 'hola mundo',
      JSON.stringify(texto(p.resultados[0].bytes))
    )
  }

  // -------------------------------------------------------------------------
  hr('(2) EL CASO DEL FALLO: el salto separador llega en el trozo siguiente')
  {
    const uno = respuesta('AAAA')
    const dos = respuesta('BBBB')
    const todo = Buffer.concat([uno, dos])
    // Corte JUSTO al final del contenido del primero: su salto separador queda en
    // el trozo siguiente. Es lo que produce un .jar cuyo tamaño cae en el límite.
    const corte = uno.length - 1
    const p = new ParserCatFile(2, 1024)
    const estado = alimentar(p, [todo.subarray(0, corte), todo.subarray(corte)])
    check('(2a) el lote se completa igual', estado.tipo === 'listo', JSON.stringify(estado))
    check(
      '(2b) y las dos respuestas son las correctas',
      texto(p.resultados[0].bytes) === 'AAAA' && texto(p.resultados[1].bytes) === 'BBBB',
      `${texto(p.resultados[0].bytes)} / ${texto(p.resultados[1].bytes)}`
    )
  }
  {
    // La variante fea: el trozo siguiente empieza por el salto Y trae la cabecera
    // partida detrás.
    const uno = respuesta('AAAA')
    const dos = respuesta('BBBB')
    const todo = Buffer.concat([uno, dos])
    const corte = uno.length - 1
    const p = new ParserCatFile(2, 1024)
    const resto = todo.subarray(corte)
    const estado = alimentar(p, [
      todo.subarray(0, corte),
      resto.subarray(0, 3),
      resto.subarray(3, 20),
      resto.subarray(20)
    ])
    check(
      '(2c) con el salto y la cabecera partidos en tres, sigue saliendo bien',
      estado.tipo === 'listo' && texto(p.resultados[1].bytes) === 'BBBB',
      JSON.stringify(estado)
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) El peor corte posible: byte a byte')
  {
    const todo = Buffer.concat([respuesta('uno'), respuesta(''), respuesta('tres')])
    const p = new ParserCatFile(3, 1024)
    const estado = alimentar(p, partir(todo, 1))
    check(
      '(3a) tres respuestas correctas alimentando de uno en uno',
      estado.tipo === 'listo' &&
        texto(p.resultados[0].bytes) === 'uno' &&
        texto(p.resultados[1].bytes) === '' &&
        texto(p.resultados[2].bytes) === 'tres',
      p.resultados.map((r) => JSON.stringify(texto(r.bytes))).join(',')
    )
  }
  {
    // Y con trozos de 2, 3 y 5: los cortes caen en sitios distintos cada vez.
    for (const n of [2, 3, 5, 7]) {
      const todo = Buffer.concat([respuesta('primero'), respuesta('segundo')])
      const p = new ParserCatFile(2, 1024)
      const estado = alimentar(p, partir(todo, n))
      check(
        `(3b) trozos de ${n} bytes`,
        estado.tipo === 'listo' &&
          texto(p.resultados[0].bytes) === 'primero' &&
          texto(p.resultados[1].bytes) === 'segundo',
        estado.tipo
      )
    }
  }

  // -------------------------------------------------------------------------
  hr('(4) Un objeto grande, con el corte en su frontera exacta')
  {
    // 3 MiB: el tamaño al que un .jar de verdad empieza a partirse en decenas de
    // trozos. El corte se pone A PROPÓSITO donde acaba el contenido.
    const grande = Buffer.alloc(3 * 1024 * 1024, 0x61)
    const uno = respuesta(grande)
    const dos = respuesta('detras')
    const todo = Buffer.concat([uno, dos])
    const finContenido = uno.length - 1
    const p = new ParserCatFile(2, 8 * 1024 * 1024)
    const estado = alimentar(p, [
      ...partir(todo.subarray(0, finContenido), 65536),
      todo.subarray(finContenido)
    ])
    check(
      '(4a) 3 MiB leídos enteros y el de detrás en su sitio',
      estado.tipo === 'listo' &&
        p.resultados[0].size === grande.length &&
        texto(p.resultados[1].bytes) === 'detras',
      `${p.resultados[0].size} / ${texto(p.resultados[1].bytes)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(5) Un "missing" en medio no consume el hueco de nadie')
  {
    const todo = Buffer.concat([respuesta('uno'), faltante('deadbeef:x.txt'), respuesta('tres')])
    const p = new ParserCatFile(3, 1024)
    const estado = alimentar(p, partir(todo, 4))
    check(
      '(5a) el del medio sale exists:false y los otros dos intactos',
      estado.tipo === 'listo' &&
        p.resultados[0].exists &&
        !p.resultados[1].exists &&
        texto(p.resultados[2].bytes) === 'tres',
      p.resultados.map((r) => (r.exists ? texto(r.bytes) : '<missing>')).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('(6) El tope: se corta y se dice DÓNDE')
  {
    const todo = Buffer.concat([respuesta('cabe'), respuesta('x'.repeat(5000)), respuesta('detras')])
    const p = new ParserCatFile(3, 1000)
    const estado = alimentar(p, partir(todo, 64))
    check(
      '(6a) el estado dice "cortado" y el índice del culpable',
      estado.tipo === 'cortado' && estado.indice === 1,
      JSON.stringify(estado)
    )
    check(
      '(6b) el que se pasó queda truncado y con su tamaño real',
      p.resultados[1].truncated && p.resultados[1].size === 5000 && p.resultados[1].bytes === null,
      JSON.stringify({ ...p.resultados[1], bytes: undefined })
    )
    check(
      '(6c) y el que iba delante se conserva (la tanda no se tira entera)',
      texto(p.resultados[0].bytes) === 'cabe',
      texto(p.resultados[0].bytes)
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) El flujo que termina a medias es un ERROR, no media respuesta')
  {
    const uno = respuesta('completo')
    const dos = respuesta('a medias')
    const p = new ParserCatFile(2, 1024)
    alimentar(p, [Buffer.concat([uno, dos.subarray(0, dos.length - 4)])])
    const fin = p.fin()
    check(
      '(7a) fin() con una respuesta pendiente -> error',
      fin.tipo === 'error',
      JSON.stringify(fin)
    )
    check(
      '(7b) y NO se coló la respuesta incompleta',
      p.resultados.length === 1,
      `${p.resultados.length} resultado(s)`
    )
  }
  {
    const p = new ParserCatFile(1, 1024)
    alimentar(p, [respuesta('todo bien')])
    check('(7c) fin() con todo completo -> listo', p.fin().tipo === 'listo', 'listo')
  }

  // -------------------------------------------------------------------------
  hr('(8) Cabecera ilegible')
  {
    const p = new ParserCatFile(1, 1024)
    const estado = alimentar(p, [Buffer.from('esto no es una cabecera\n', 'utf8')])
    check(
      '(8a) error con el texto que se vio, para poder diagnosticarlo',
      estado.tipo === 'error' && estado.mensaje.includes('esto no es una cabecera'),
      JSON.stringify(estado)
    )
  }
  {
    const p = new ParserCatFile(1, 1024)
    const estado = alimentar(p, [Buffer.alloc(70 * 1024, 0x41)])
    check(
      '(8b) una cabecera que nunca termina no se acumula sin fin',
      estado.tipo === 'error' && estado.mensaje.includes('sin fin'),
      JSON.stringify(estado)
    )
  }

  // ---------------------------------------------------------------------------
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

main()
