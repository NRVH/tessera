#!/usr/bin/env node
// =============================================================================
// Prueba del lector del POOL DE CONSTANTES de un .class (npm run test:pool-constantes). PURO: las
// clases se FABRICAN byte a byte, que es la única forma de construir los casos hostiles que ningún
// compilador produce. Cubre magic inválido y buffer diminuto, cadenas en orden, pool vacío, Long y
// Double ocupando DOS ranuras, los tags de tamaño fijo y los de Java 7+, el tag desconocido, el
// pool truncado, la longitud que se sale del buffer, los acentos y `formaLegible`.
// =============================================================================

import { cadenasDeClase, formaLegible, pareceClase } from './poolConstantes.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      -> ${evidence}`)
}

// ---------------------------------------------------------------------------
// Constructor de .class de mentira. Solo la cabecera y el pool: nada más se lee.
// ---------------------------------------------------------------------------

// El discriminador es `texto`/`cuerpo` y no `tag`, porque `tag: number` incluye al
// 1 y TypeScript no puede estrechar la unión por él.
type Entrada = { tag: 1; texto: string; cuerpo?: undefined } | { tag: number; cuerpo: number[]; texto?: undefined }

/** Bytes de una clase con `entradas` en su pool. `count` se calcula solo. */
function clase(entradas: Entrada[], opts: { magic?: number; countExtra?: number } = {}): Buffer {
  const trozos: Buffer[] = []
  // Ranuras ocupadas: Long/Double valen por dos.
  let ranuras = 0
  for (const e of entradas) {
    ranuras += e.tag === 5 || e.tag === 6 ? 2 : 1
    if (e.texto !== undefined) {
      const texto = Buffer.from(e.texto, 'utf8')
      const cab = Buffer.alloc(3)
      cab.writeUInt8(1, 0)
      cab.writeUInt16BE(texto.length, 1)
      trozos.push(cab, texto)
    } else {
      trozos.push(Buffer.from([e.tag, ...(e.cuerpo ?? [])]))
    }
  }
  const cabecera = Buffer.alloc(10)
  cabecera.writeUInt32BE(opts.magic ?? 0xcafebabe, 0)
  cabecera.writeUInt16BE(0, 4) // minor
  cabecera.writeUInt16BE(52, 6) // major (Java 8)
  // constant_pool_count = índice mayor + 1 = ranuras + 1
  cabecera.writeUInt16BE(ranuras + 1 + (opts.countExtra ?? 0), 8)
  return Buffer.concat([cabecera, ...trozos])
}

const utf8 = (texto: string): Entrada => ({ tag: 1, texto })

// ---------------------------------------------------------------------------

hr('Entradas que no son una clase')

check('(1) magic inválido -> []', cadenasDeClase(clase([utf8('hola')], { magic: 0xdeadbeef })).length === 0,
  `pareceClase=${pareceClase(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0, 0, 0]))}`)

{
  const r = cadenasDeClase(Buffer.from([0xca, 0xfe]))
  check('(2) buffer diminuto -> [] sin lanzar', r.length === 0, `n=${r.length}`)
}

hr('Recorrido normal del pool')

{
  const r = cadenasDeClase(clase([utf8('Hola'), utf8('Mundo'), utf8('java/lang/Object')]))
  check('(3) tres cadenas, en orden', r.length === 3 && r[0] === 'Hola' && r[2] === 'java/lang/Object',
    JSON.stringify(r))
}

{
  const r = cadenasDeClase(clase([]))
  check('(4) pool vacío -> []', r.length === 0, `n=${r.length}`)
}

hr('LA TRAMPA: Long y Double ocupan DOS ranuras')

{
  // Sin el salto de 2, el bucle cree que quedan más entradas de las que hay y
  // termina antes o después de tiempo; la cadena de después se pierde.
  const r = cadenasDeClase(
    clase([utf8('antes'), { tag: 5, cuerpo: [0, 0, 0, 0, 0, 0, 0, 7] }, utf8('despues')])
  )
  check('(5a) Long (tag 5) no desincroniza el pool', r.length === 2 && r[1] === 'despues', JSON.stringify(r))
}
{
  const r = cadenasDeClase(
    clase([utf8('a'), { tag: 6, cuerpo: [0, 0, 0, 0, 0, 0, 0, 0] }, utf8('b'), utf8('c')])
  )
  check('(5b) Double (tag 6) tampoco', r.length === 3 && r[2] === 'c', JSON.stringify(r))
}

hr('Tags de tamaño fijo')

{
  const r = cadenasDeClase(
    clase([
      utf8('com/ejemplo/Foo'),
      { tag: 7, cuerpo: [0, 1] }, // Class -> #1
      { tag: 12, cuerpo: [0, 1, 0, 1] }, // NameAndType
      { tag: 10, cuerpo: [0, 2, 0, 3] }, // Methodref
      utf8('isBlank')
    ])
  )
  check('(6) Class/NameAndType/Methodref no rompen el recorrido',
    r.length === 2 && r[1] === 'isBlank', JSON.stringify(r))
}

{
  const r = cadenasDeClase(
    clase([
      utf8('primera'),
      { tag: 15, cuerpo: [6, 0, 2] }, // MethodHandle (Java 7)
      { tag: 18, cuerpo: [0, 0, 0, 1] }, // InvokeDynamic (Java 7)
      { tag: 16, cuerpo: [0, 1] }, // MethodType
      utf8('ultima')
    ])
  )
  check('(7) tags de Java 7+ no cortan el recorrido',
    r.length === 2 && r[1] === 'ultima', JSON.stringify(r))
}

hr('Entradas hostiles: se para, no se inventa')

{
  // tag 42 no existe. A partir de ahí no se sabe dónde empieza la siguiente.
  const r = cadenasDeClase(clase([utf8('buena'), { tag: 42, cuerpo: [1, 2] }, utf8('nunca')]))
  check('(8) tag desconocido -> devuelve lo leído y para',
    r.length === 1 && r[0] === 'buena', JSON.stringify(r))
}

{
  // Se corta el buffer a mitad de la segunda cadena.
  const completa = clase([utf8('entera'), utf8('cortada-por-la-mitad')])
  const r = cadenasDeClase(completa.subarray(0, completa.length - 8))
  check('(9) pool truncado -> lo leído, sin lanzar',
    r.length === 1 && r[0] === 'entera', JSON.stringify(r))
}

{
  // count MIENTE (declara una entrada de más) y no hay bytes para ella.
  const r = cadenasDeClase(clase([utf8('sola')], { countExtra: 3 }))
  check('(10) count que promete más de lo que hay -> lo leído',
    r.length === 1 && r[0] === 'sola', JSON.stringify(r))
}

{
  const r = cadenasDeClase(clase([utf8('validación de documentós')]))
  check('(11) acentos (UTF-8) sobreviven',
    r[0] === 'validación de documentós', JSON.stringify(r))
}

hr('formaLegible: el nombre interno se busca también con puntos')

check('(12) forma interna -> con puntos',
  formaLegible('com/ejemplo/comunes/StringUtils') === 'com.ejemplo.comunes.StringUtils',
  String(formaLegible('com/ejemplo/comunes/StringUtils')))

check('(13a) sin barras -> null', formaLegible('isBlank') === null, String(formaLegible('isBlank')))
check('(13b) una URL no es un nombre de tipo',
  formaLegible('http://example.com/x') === null, String(formaLegible('http://example.com/x')))
check('(13c) una ruta absoluta tampoco',
  formaLegible('/etc/passwd') === null, String(formaLegible('/etc/passwd')))
check('(13d) con espacios tampoco',
  formaLegible('dd/MM/yyyy HH:mm') === null, String(formaLegible('dd/MM/yyyy HH:mm')))

hr('El caso de uso: ¿esta clase menciona StringUtils?')

{
  // Lo que de verdad hay en el pool de una clase que la usa.
  const bytes = clase([
    utf8('com/ejemplo/digitalizacionswg/servidor/dao/DigitalizacionSWGDAO'),
    utf8('com/ejemplo/digitalizacionswg/comunes/StringUtils'),
    { tag: 7, cuerpo: [0, 2] },
    utf8('isBlank'),
    utf8('(Ljava/lang/String;)Z'),
    { tag: 10, cuerpo: [0, 3, 0, 4] }
  ])
  const cadenas = cadenasDeClase(bytes)
  const casaCorta = cadenas.some((c) => c.includes('StringUtils'))
  const legibles = cadenas.map(formaLegible).filter((x): x is string => x !== null)
  const casaLarga = legibles.some((c) => c.includes('com.ejemplo.digitalizacionswg.comunes.StringUtils'))
  check('(14a) "StringUtils" casa en la forma interna', casaCorta, `cadenas=${cadenas.length}`)
  check('(14b) el nombre CUALIFICADO con puntos también casa', casaLarga, JSON.stringify(legibles))
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(78))
console.log(
  `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
