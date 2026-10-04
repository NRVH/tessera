#!/usr/bin/env node
// =============================================================================
// Prueba de zipRandom (npm run test:zip-random), el lector de ZIP por RANGOS. Los zips se FABRICAN
// byte a byte para construir los casos hostiles que ninguna herramienta produce; el caso feliz se
// contrasta con fflate. Cubre el EOCD con comentario largo, STORED y DEFLATE, nombres en latin1 y
// con el bit 11, longitudes del cabecero LOCAL distintas de las del central, el método desconocido,
// la zip bomb que miente sobre su tamaño, ZIP64, nombres tóxicos y duplicados, el jar anidado
// desde un buffer y los archivos vacíos, basura o truncados.
// =============================================================================

import zlib from 'node:zlib'
import { zipSync } from 'fflate'
import {
  ErrorZip,
  MAX_ENTRADAS_INDICE,
  abrirLectorDeArchivo,
  lectorDeBuffer,
  leerEntrada,
  leerIndice,
  type EntradaZip
} from './zipRandom.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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

// ---------------------------------------------------------------------------
// Constructor de ZIP a medida (lo que permite fabricar los casos hostiles)
// ---------------------------------------------------------------------------

const NUL = String.fromCharCode(0)

interface EntradaFabricada {
  nombre: string
  datos: Buffer
  /** 0 stored, 8 deflate. Cualquier otro se escribe tal cual (para el caso (6)). */
  metodo?: number
  /** Bytes "extra" SOLO del cabecero local (para probar el gotcha (5)). */
  extraLocal?: Buffer
  /** Bytes "extra" SOLO del registro central. */
  extraCentral?: Buffer
  /** Marca el bit 11 (nombre en UTF-8). */
  utf8?: boolean
  /** Codificación con la que escribir el nombre en los bytes del zip. */
  encoding?: BufferEncoding
  /** Miente sobre el tamaño descomprimido (para la bomba del caso (7)). */
  tamanoDeclarado?: number
  /** Fuerza ZIP64 A NIVEL DE ENTRADA: 0xFFFFFFFF en el central + extra 0x0001. */
  zip64?: boolean
}

interface OpcionesZip {
  comentario?: string
  /**
   * Fuerza ZIP64 A NIVEL DE ARCHIVO: escribe el registro EOCD64 y su localizador,
   * y pone centinelas en el EOCD clásico. Es lo que produce de verdad una
   * herramienta cuando el zip pasa de 65 535 entradas o de 4 GB, y es distinto del
   * `zip64` por entrada: sin esto, la rama ZIP64 del parser NO se ejecuta nunca.
   */
  zip64Eocd?: boolean
}

function construirZip(entradas: EntradaFabricada[], opciones: OpcionesZip = {}): Buffer {
  const comentario = opciones.comentario ?? ''
  const trozos: Buffer[] = []
  const centrales: Buffer[] = []
  let offset = 0

  for (const e of entradas) {
    const metodo = e.metodo ?? 8
    const encoding = e.encoding ?? (e.utf8 ? 'utf8' : 'latin1')
    const nombreBytes = Buffer.from(e.nombre, encoding)
    const comprimidos =
      metodo === 0 ? e.datos : metodo === 8 ? zlib.deflateRawSync(e.datos) : e.datos
    const extraLocal = e.extraLocal ?? Buffer.alloc(0)
    const extraCentral = e.extraCentral ?? Buffer.alloc(0)
    const flags = e.utf8 ? 0x800 : 0
    const tamano = e.tamanoDeclarado ?? e.datos.length

    // --- cabecero local ---
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(0x6000, 10) // hora
    local.writeUInt16LE(0x2c21, 12) // fecha (2002-01-01 aprox)
    local.writeUInt32LE(0, 14) // crc (no se verifica)
    local.writeUInt32LE(comprimidos.length, 18)
    local.writeUInt32LE(tamano, 22)
    local.writeUInt16LE(nombreBytes.length, 26)
    local.writeUInt16LE(extraLocal.length, 28)

    const offsetLocal = offset
    for (const b of [local, nombreBytes, extraLocal, comprimidos]) {
      trozos.push(b)
      offset += b.length
    }

    // --- registro central ---
    let extraCentralFinal = extraCentral
    if (e.zip64) {
      // Extra 0x0001 con los tres valores en el orden que manda la especificación.
      const bloque = Buffer.alloc(24)
      bloque.writeBigUInt64LE(BigInt(tamano), 0)
      bloque.writeBigUInt64LE(BigInt(comprimidos.length), 8)
      bloque.writeBigUInt64LE(BigInt(offsetLocal), 16)
      const cab = Buffer.alloc(4)
      cab.writeUInt16LE(0x0001, 0)
      cab.writeUInt16LE(bloque.length, 2)
      extraCentralFinal = Buffer.concat([cab, bloque])
    }

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(metodo, 10)
    central.writeUInt16LE(0x6000, 12)
    central.writeUInt16LE(0x2c21, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(e.zip64 ? 0xffffffff : comprimidos.length, 20)
    central.writeUInt32LE(e.zip64 ? 0xffffffff : tamano, 24)
    central.writeUInt16LE(nombreBytes.length, 28)
    central.writeUInt16LE(extraCentralFinal.length, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(e.zip64 ? 0xffffffff : offsetLocal, 42)
    centrales.push(Buffer.concat([central, nombreBytes, extraCentralFinal]))
  }

  const centralBuf = Buffer.concat(centrales)
  const offsetCentral = offset
  const comentarioBytes = Buffer.from(comentario, 'latin1')

  // --- ZIP64 a nivel de ARCHIVO: EOCD64 + localizador, justo detrás del central ---
  const bloquesZip64: Buffer[] = []
  if (opciones.zip64Eocd) {
    const eocd64 = Buffer.alloc(56)
    eocd64.writeUInt32LE(0x06064b50, 0)
    eocd64.writeBigUInt64LE(BigInt(56 - 12), 4) // tamaño del registro menos sus 12 primeros bytes
    eocd64.writeUInt16LE(45, 12)
    eocd64.writeUInt16LE(45, 14)
    eocd64.writeUInt32LE(0, 16)
    eocd64.writeUInt32LE(0, 20)
    eocd64.writeBigUInt64LE(BigInt(entradas.length), 24)
    eocd64.writeBigUInt64LE(BigInt(entradas.length), 32)
    eocd64.writeBigUInt64LE(BigInt(centralBuf.length), 40)
    eocd64.writeBigUInt64LE(BigInt(offsetCentral), 48)

    const localizador = Buffer.alloc(20)
    localizador.writeUInt32LE(0x07064b50, 0)
    localizador.writeUInt32LE(0, 4)
    // El EOCD64 empieza justo donde acaba el directorio central.
    localizador.writeBigUInt64LE(BigInt(offsetCentral + centralBuf.length), 8)
    localizador.writeUInt32LE(1, 16)

    bloquesZip64.push(eocd64, localizador)
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  // Con ZIP64 de archivo, el EOCD clásico lleva CENTINELAS: los valores buenos
  // están en el EOCD64.
  eocd.writeUInt16LE(opciones.zip64Eocd ? 0xffff : entradas.length, 8)
  eocd.writeUInt16LE(opciones.zip64Eocd ? 0xffff : entradas.length, 10)
  eocd.writeUInt32LE(opciones.zip64Eocd ? 0xffffffff : centralBuf.length, 12)
  eocd.writeUInt32LE(opciones.zip64Eocd ? 0xffffffff : offsetCentral, 16)
  eocd.writeUInt16LE(comentarioBytes.length, 20)

  return Buffer.concat([...trozos, centralBuf, ...bloquesZip64, eocd, comentarioBytes])
}

function buscar(entradas: EntradaZip[], nombre: string): EntradaZip | undefined {
  return entradas.find((e) => e.nombre === nombre)
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) Caso feliz, contrastado contra fflate')
  // -------------------------------------------------------------------------
  const conFflate = Buffer.from(
    zipSync({
      'META-INF/MANIFEST.MF': Buffer.from('Manifest-Version: 1.0\r\n'),
      'com/ejemplo/Nota.class': Buffer.from('cafebabe-falso'),
      'com/ejemplo/': new Uint8Array(0)
    })
  )
  const idx1 = await leerIndice(lectorDeBuffer(conFflate))
  check(
    'lee las 3 entradas que escribió fflate',
    idx1.entradas.length === 3,
    `${idx1.entradas.length} entradas: ${idx1.entradas.map((e) => e.nombre).join(', ')}`
  )
  const manifest = buscar(idx1.entradas, 'META-INF/MANIFEST.MF')
  const contenido = manifest ? await leerEntrada(lectorDeBuffer(conFflate), manifest) : Buffer.alloc(0)
  check(
    'el contenido descomprimido coincide',
    contenido.toString('utf8') === 'Manifest-Version: 1.0\r\n',
    JSON.stringify(contenido.toString('utf8'))
  )
  check(
    'detecta el registro de directorio por la barra final',
    buscar(idx1.entradas, 'com/ejemplo/')?.esDir === true,
    'esDir=true'
  )

  // -------------------------------------------------------------------------
  hr('(2) EOCD con comentario largo (la firma no está en posición fija)')
  // -------------------------------------------------------------------------
  const comentarioLargo = 'x'.repeat(40_000)
  const conComentario = construirZip([{ nombre: 'a.txt', datos: Buffer.from('hola') }], {
    comentario: comentarioLargo
  })
  const idx2 = await leerIndice(lectorDeBuffer(conComentario))
  check(
    'encuentra el EOCD con 40 000 bytes de comentario detrás',
    idx2.entradas.length === 1 && idx2.entradas[0].nombre === 'a.txt',
    `${idx2.entradas.length} entrada, comentario de ${comentarioLargo.length} bytes`
  )

  // -------------------------------------------------------------------------
  hr('(3) STORED y DEFLATE')
  // -------------------------------------------------------------------------
  const textoLargo = 'linea repetida para que comprima\n'.repeat(200)
  const dosMetodos = construirZip([
    { nombre: 'stored.txt', datos: Buffer.from(textoLargo), metodo: 0 },
    { nombre: 'deflate.txt', datos: Buffer.from(textoLargo), metodo: 8 }
  ])
  const lec3 = lectorDeBuffer(dosMetodos)
  const idx3 = await leerIndice(lec3)
  const st = buscar(idx3.entradas, 'stored.txt')!
  const df = buscar(idx3.entradas, 'deflate.txt')!
  check('método de la entrada stored es 0', st.metodo === 0, `metodo=${st.metodo}`)
  check('método de la entrada deflate es 8', df.metodo === 8, `metodo=${df.metodo}`)
  check(
    'STORED se devuelve tal cual',
    (await leerEntrada(lec3, st)).toString('utf8') === textoLargo,
    `${textoLargo.length} bytes`
  )
  check(
    'DEFLATE se infla correctamente',
    (await leerEntrada(lec3, df)).toString('utf8') === textoLargo,
    `comprimido ${df.tamanoComprimido} -> ${df.tamano} bytes`
  )

  // -------------------------------------------------------------------------
  hr('(4) Codificación del NOMBRE: bit 11')
  // -------------------------------------------------------------------------
  const conAcentos = construirZip([
    { nombre: 'recursos/configuración.properties', datos: Buffer.from('a=1'), utf8: false, encoding: 'latin1' },
    { nombre: 'recursos/año.properties', datos: Buffer.from('b=2'), utf8: true, encoding: 'utf8' }
  ])
  const idx4 = await leerIndice(lectorDeBuffer(conAcentos))
  check(
    'nombre SIN bit 11 se decodifica como latin1',
    buscar(idx4.entradas, 'recursos/configuración.properties') !== undefined,
    idx4.entradas[0].nombre
  )
  check(
    'nombre CON bit 11 se decodifica como UTF-8',
    buscar(idx4.entradas, 'recursos/año.properties') !== undefined,
    idx4.entradas[1].nombre
  )
  check(
    'la marca utf8 viaja en la entrada',
    idx4.entradas[0].utf8 === false && idx4.entradas[1].utf8 === true,
    'false / true'
  )

  // -------------------------------------------------------------------------
  hr('(5) GOTCHA: las longitudes del cabecero LOCAL mandan')
  // -------------------------------------------------------------------------
  // Local con 12 bytes de extra, central con 0: si el lector usara las del central,
  // empezaría a leer 12 bytes antes y produciría basura (o un error de inflate).
  const desalineado = construirZip([
    {
      nombre: 'firmado/Clase.class',
      datos: Buffer.from('contenido correcto'),
      extraLocal: Buffer.alloc(12, 0x41),
      extraCentral: Buffer.alloc(0)
    }
  ])
  const lec5 = lectorDeBuffer(desalineado)
  const idx5 = await leerIndice(lec5)
  const leido5 = await leerEntrada(lec5, idx5.entradas[0])
  check(
    'extra local (12 B) != extra central (0 B): el contenido sale intacto',
    leido5.toString('utf8') === 'contenido correcto',
    JSON.stringify(leido5.toString('utf8'))
  )

  // -------------------------------------------------------------------------
  hr('(6) Método de compresión desconocido')
  // -------------------------------------------------------------------------
  const raro = construirZip([{ nombre: 'raro.bin', datos: Buffer.from('xxxx'), metodo: 99 }])
  const lec6 = lectorDeBuffer(raro)
  const idx6 = await leerIndice(lec6)
  let mensaje6 = ''
  try {
    await leerEntrada(lec6, idx6.entradas[0])
  } catch (err) {
    mensaje6 = err instanceof Error ? err.message : String(err)
  }
  check(
    'lanza ErrorZip con mensaje en español, no un err(14)',
    mensaje6.includes('compresión que Tessera no sabe leer') && mensaje6.includes('99'),
    mensaje6
  )
  check('el índice SÍ la lista (solo falla al abrirla)', idx6.entradas.length === 1, '1 entrada')

  // -------------------------------------------------------------------------
  hr('(7) Anti zip-bomb: la entrada miente sobre su tamaño')
  // -------------------------------------------------------------------------
  const bomba = construirZip([
    {
      nombre: 'bomba.bin',
      datos: Buffer.alloc(8 * 1024 * 1024, 0), // 8 MB de ceros: comprime a casi nada
      tamanoDeclarado: 100 // ...pero declara 100 bytes
    }
  ])
  const lec7 = lectorDeBuffer(bomba)
  const idx7 = await leerIndice(lec7)
  check(
    'el índice se cree el tamaño declarado (por eso no basta con mirarlo)',
    idx7.entradas[0].tamano === 100,
    `tamano declarado=${idx7.entradas[0].tamano}, comprimido=${idx7.entradas[0].tamanoComprimido}`
  )
  let mensaje7 = ''
  try {
    await leerEntrada(lec7, idx7.entradas[0], { maxBytes: 4096 })
  } catch (err) {
    mensaje7 = err instanceof Error ? err.message : String(err)
  }
  check(
    'maxOutputLength LANZA en vez de reservar 8 MB',
    mensaje7.includes('No se pudo descomprimir') && mensaje7.includes('bomba.bin'),
    mensaje7
  )
  let mensaje7b = ''
  try {
    await leerEntrada(lec7, { ...idx7.entradas[0], tamano: 999_999_999 }, { maxBytes: 4096 })
  } catch (err) {
    mensaje7b = err instanceof Error ? err.message : String(err)
  }
  check(
    'y si el tamaño declarado ya se pasa, ni se lee del disco',
    mensaje7b.includes('supera el máximo'),
    mensaje7b
  )

  // -------------------------------------------------------------------------
  hr('(8) ZIP64')
  // -------------------------------------------------------------------------
  const z64 = construirZip([
    { nombre: 'grande/Clase.class', datos: Buffer.from('contenido zip64'), zip64: true }
  ])
  const lec8 = lectorDeBuffer(z64)
  const idx8 = await leerIndice(lec8)
  check(
    'los campos saturados se resuelven por el extra 0x0001',
    idx8.entradas[0].tamano === 'contenido zip64'.length &&
      idx8.entradas[0].offsetLocal === 0 &&
      idx8.entradas[0].tamanoComprimido !== 0xffffffff,
    `tamano=${idx8.entradas[0].tamano}, offset=${idx8.entradas[0].offsetLocal}`
  )
  check(
    'y la entrada se puede leer',
    (await leerEntrada(lec8, idx8.entradas[0])).toString('utf8') === 'contenido zip64',
    'contenido zip64'
  )

  // ZIP64 DE ARCHIVO: el EOCD clásico lleva centinelas y los valores buenos están
  // en el registro EOCD64. Es lo que produce una herramienta real cuando el zip
  // pasa de 65 535 entradas (uber-jars sombreados, .war gordos), y es la rama que
  // el caso anterior NO ejercitaba: sin un EOCD64 de verdad, `necesitaZip64` era
  // false y el parser nunca entraba ahí.
  const z64Archivo = construirZip(
    [
      { nombre: 'com/acme/Uno.class', datos: Buffer.from('uno') },
      { nombre: 'com/acme/Dos.class', datos: Buffer.from('dos') },
      { nombre: 'META-INF/MANIFEST.MF', datos: Buffer.from('Manifest-Version: 1.0\r\n') }
    ],
    { zip64Eocd: true }
  )
  const lec8b = lectorDeBuffer(z64Archivo)
  const idx8b = await leerIndice(lec8b)
  check(
    'ZIP64 de archivo: se listan las 3 entradas (antes salía VACÍO en silencio)',
    idx8b.entradas.length === 3,
    `${idx8b.entradas.length} entradas: ${idx8b.entradas.map((e) => e.nombre).join(', ') || '(ninguna)'}`
  )
  check(
    'ZIP64 de archivo: el total sale del EOCD64, no del centinela 0xFFFF',
    idx8b.totalDeclarado === 3,
    `totalDeclarado=${idx8b.totalDeclarado}`
  )
  const uno = buscar(idx8b.entradas, 'com/acme/Uno.class')
  check(
    'ZIP64 de archivo: y su contenido se lee bien',
    uno !== undefined && (await leerEntrada(lec8b, uno)).toString('utf8') === 'uno',
    uno ? 'uno' : '(no se encontró la entrada)'
  )

  // Y con comentario detrás, que desplaza el EOCD clásico respecto del EOCD64.
  const z64ConComentario = construirZip([{ nombre: 'a.txt', datos: Buffer.from('hola') }], {
    zip64Eocd: true,
    comentario: 'x'.repeat(3000)
  })
  const idx8c = await leerIndice(lectorDeBuffer(z64ConComentario))
  check(
    'ZIP64 de archivo + comentario largo',
    idx8c.entradas.length === 1 && idx8c.entradas[0].nombre === 'a.txt',
    `${idx8c.entradas.length} entrada`
  )

  // -------------------------------------------------------------------------
  hr('(9) Nombres tóxicos y duplicados')
  // -------------------------------------------------------------------------
  const toxico = construirZip([
    { nombre: 'bueno.txt', datos: Buffer.from('1') },
    { nombre: `mal${NUL}o.txt`, datos: Buffer.from('2') },
    { nombre: '../fuera.txt', datos: Buffer.from('3') },
    { nombre: '/absoluto.txt', datos: Buffer.from('4') },
    { nombre: 'bueno.txt', datos: Buffer.from('duplicado') }
  ])
  const idx9 = await leerIndice(lectorDeBuffer(toxico))
  const nombres9 = idx9.entradas.map((e) => e.nombre)
  check(
    'solo sobrevive la entrada legítima',
    idx9.entradas.length === 1 && nombres9[0] === 'bueno.txt',
    `[${nombres9.join(', ')}]`
  )
  check(
    'el NUL en el nombre se descarta (rompería las claves compuestas del renderer)',
    !nombres9.some((n) => n.includes(NUL)),
    'sin NUL'
  )
  check('zip-slip ".." descartado', !nombres9.includes('../fuera.txt'), 'descartado')
  check('nombre absoluto descartado', !nombres9.some((n) => n.startsWith('/')), 'descartado')
  check(
    'el duplicado se descarta conservando el PRIMERO',
    idx9.avisos.some((a) => a.includes('repetida')),
    idx9.avisos.find((a) => a.includes('repetida')) ?? '(sin aviso)'
  )
  check(
    'los descartes se avisan en español, no en silencio',
    idx9.avisos.length >= 2 && idx9.avisos.every((a) => a.length > 0),
    `${idx9.avisos.length} avisos`
  )
  check(
    'totalDeclarado conserva lo que decía el EOCD (5), aunque se listen menos',
    idx9.totalDeclarado === 5,
    `declarado=${idx9.totalDeclarado}, listadas=${idx9.entradas.length}`
  )

  // -------------------------------------------------------------------------
  hr('(10) Jar ANIDADO: se navega sin escribir nada a disco')
  // -------------------------------------------------------------------------
  const interno = construirZip([{ nombre: 'com/acme/Interna.class', datos: Buffer.from('bytes internos') }])
  const externo = construirZip([
    { nombre: 'WEB-INF/lib/dep.jar', datos: interno, metodo: 0 },
    { nombre: 'WEB-INF/web.xml', datos: Buffer.from('<web-app/>') }
  ])
  const lecExterno = lectorDeBuffer(externo)
  const idxExterno = await leerIndice(lecExterno)
  const dep = buscar(idxExterno.entradas, 'WEB-INF/lib/dep.jar')!
  const bytesDep = await leerEntrada(lecExterno, dep)
  const idxInterno = await leerIndice(lectorDeBuffer(bytesDep))
  check(
    'el índice del jar anidado se lee del buffer inflado, sin tocar el disco',
    idxInterno.entradas.length === 1 && idxInterno.entradas[0].nombre === 'com/acme/Interna.class',
    idxInterno.entradas[0]?.nombre ?? '(nada)'
  )
  const bytesInterna = await leerEntrada(lectorDeBuffer(bytesDep), idxInterno.entradas[0])
  check(
    'y su contenido también',
    bytesInterna.toString('utf8') === 'bytes internos',
    JSON.stringify(bytesInterna.toString('utf8'))
  )

  // -------------------------------------------------------------------------
  hr('(11) Archivos que no son zips válidos')
  // -------------------------------------------------------------------------
  for (const [etiqueta, bytes] of [
    ['vacío', Buffer.alloc(0)],
    ['demasiado corto', Buffer.from('PK')],
    ['basura', Buffer.alloc(500, 0x41)]
  ] as Array<[string, Buffer]>) {
    let msg = ''
    try {
      await leerIndice(lectorDeBuffer(bytes))
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err)
    }
    check(
      `${etiqueta}: ErrorZip con mensaje humano`,
      msg.length > 0 && !msg.includes('undefined') && !/^[A-Z_]+:/.test(msg),
      msg
    )
  }
  // Un central truncado a mitad de registro no debe tumbar el listado entero.
  const sano = construirZip([
    { nombre: 'a.txt', datos: Buffer.from('1') },
    { nombre: 'b.txt', datos: Buffer.from('2') }
  ])
  const recortado = Buffer.concat([sano.subarray(0, sano.length - 22 - 20), sano.subarray(sano.length - 22)])
  let sobrevivio = false
  try {
    const idx11 = await leerIndice(lectorDeBuffer(recortado))
    sobrevivio = idx11.truncado || idx11.entradas.length < 2
  } catch {
    sobrevivio = true // fallar con ErrorZip también es aceptable
  }
  check('un directorio central recortado no cuelga ni devuelve basura', sobrevivio, 'truncado o ErrorZip')

  // -------------------------------------------------------------------------
  hr('(12) Lector de ARCHIVO: mismo resultado que el de buffer')
  // -------------------------------------------------------------------------
  const os = await import('node:os')
  const path = await import('node:path')
  const fsp = await import('node:fs/promises')
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tessera-zip-test-'))
  const ruta = path.join(dir, 'prueba.jar')
  try {
    await fsp.writeFile(ruta, dosMetodos)
    const lecArchivo = await abrirLectorDeArchivo(ruta)
    try {
      const idxArchivo = await leerIndice(lecArchivo)
      const stArchivo = buscar(idxArchivo.entradas, 'stored.txt')!
      check(
        'leído desde disco por rangos, idéntico al de memoria',
        idxArchivo.entradas.length === 2 &&
          (await leerEntrada(lecArchivo, stArchivo)).toString('utf8') === textoLargo,
        `${idxArchivo.entradas.length} entradas, tamaño del fichero ${lecArchivo.tamano} B`
      )
      let msgRango = ''
      try {
        await lecArchivo.leer(lecArchivo.tamano - 1, 100)
      } catch (err) {
        msgRango = err instanceof Error ? err.message : String(err)
      }
      check(
        'leer más allá del final da ErrorZip, no una lectura corta silenciosa',
        msgRango.includes('incompleto o dañado'),
        msgRango
      )
    } finally {
      await lecArchivo.cerrar()
      await lecArchivo.cerrar() // idempotente: no debe lanzar
    }
    check('cerrar() es idempotente', true, 'dos cerrar() seguidos sin lanzar')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }

  check(
    'MAX_ENTRADAS_INDICE es un tope explícito, no un número mágico suelto',
    MAX_ENTRADAS_INDICE > 0 && Number.isInteger(MAX_ENTRADAS_INDICE),
    `${MAX_ENTRADAS_INDICE.toLocaleString('es')}`
  )
  check('ErrorZip se distingue por su name', new ErrorZip('x').name === 'ErrorZip', 'ErrorZip')

  // ---------------------------------------------------------------------------
  // Reporte final
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

main().catch((err) => {
  console.error('El test lanzó una excepción no controlada:', err)
  process.exit(1)
})
