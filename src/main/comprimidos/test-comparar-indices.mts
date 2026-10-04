#!/usr/bin/env node
// =============================================================================
// Prueba del COMPARADOR DE ÍNDICES ZIP (npm run test:comparar-indices), el corazón del diff de
// comprimidos: marcar de más (un jar recompilado sin cambios enseña 2.000 entradas) y marcar de
// menos (el cambio buscado no aparece) son caros de formas distintas. Cubre A/M/D e idéntica,
// mismo CRC con fecha distinta, mismo CRC con tamaño distinto, un lado nulo, los registros de
// directorio, los nombres duplicados, la marca `contenedor` y el orden estable con `truncado`.
// =============================================================================

import {
  compararIndices,
  MAX_ENTRADAS_CAMBIADAS
} from './compararIndices.ts'
import type { EntradaZip, IndiceZip } from '../java/zipRandom.ts'

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

/** Entrada de zip con lo mínimo que mira el comparador. */
function ent(
  nombre: string,
  crc32: number,
  tamano: number,
  extra: Partial<EntradaZip> = {}
): EntradaZip {
  return {
    nombre,
    tamano,
    tamanoComprimido: Math.max(1, Math.round(tamano / 2)),
    metodo: 8,
    crc32,
    offsetLocal: 0,
    modificado: 1_700_000_000_000,
    esDir: nombre.endsWith('/'),
    utf8: true,
    ...extra
  }
}
function indice(entradas: EntradaZip[]): IndiceZip {
  return { entradas, totalDeclarado: entradas.length, truncado: false, avisos: [] }
}
/** Busca una entrada del resultado por su nombre. */
function fila(
  res: ReturnType<typeof compararIndices>,
  nombre: string
): (typeof res.entradas)[number] | undefined {
  return res.entradas.find((e) => e.nombre === nombre)
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Alta, modificación, borrado e idéntica')
  {
    const antes = indice([
      ent('META-INF/MANIFEST.MF', 0xaaaa, 110),
      ent('com/ejemplo/Servicio.class', 0xbbbb, 4200),
      ent('com/ejemplo/Viejo.class', 0xcccc, 900),
      ent('recursos/mensajes.properties', 0xdddd, 300)
    ])
    const despues = indice([
      ent('META-INF/MANIFEST.MF', 0xeeee, 108),
      ent('com/ejemplo/Servicio.class', 0xbbbb, 4200),
      ent('com/ejemplo/Nuevo.class', 0xffff, 2100),
      ent('recursos/mensajes.properties', 0xdddd, 300)
    ])
    const res = compararIndices(antes, despues)

    check('sólo se devuelven las cambiadas (3 de 5)', res.entradas.length === 3, `${res.entradas.length}`)
    check('las idénticas se cuentan (2)', res.iguales === 2, `iguales=${res.iguales}`)
    check(
      'MANIFEST.MF -> M con los dos tamaños',
      fila(res, 'META-INF/MANIFEST.MF')?.estado === 'M' &&
        fila(res, 'META-INF/MANIFEST.MF')?.tamanoAntes === 110 &&
        fila(res, 'META-INF/MANIFEST.MF')?.tamanoDespues === 108,
      '110 -> 108'
    )
    check(
      'Nuevo.class -> A con tamanoAntes 0',
      fila(res, 'com/ejemplo/Nuevo.class')?.estado === 'A' &&
        fila(res, 'com/ejemplo/Nuevo.class')?.tamanoAntes === 0,
      'A, 0 -> 2100'
    )
    check(
      'Viejo.class -> D con tamanoDespues 0',
      fila(res, 'com/ejemplo/Viejo.class')?.estado === 'D' &&
        fila(res, 'com/ejemplo/Viejo.class')?.tamanoDespues === 0,
      'D, 900 -> 0'
    )
    check(
      'Servicio.class (mismo CRC y tamaño) NO aparece',
      fila(res, 'com/ejemplo/Servicio.class') === undefined,
      'ausente'
    )
    check('nada truncado', !res.truncado, 'false')
  }

  // -------------------------------------------------------------------------
  hr('(2) EL CASO FRECUENTE: reempaquetado sin cambios (fecha nueva, mismo CRC)')
  {
    const antes = indice([
      ent('a/A.class', 0x1111, 100, { modificado: 1_600_000_000_000 }),
      ent('a/B.class', 0x2222, 200, { modificado: 1_600_000_000_000 })
    ])
    const despues = indice([
      ent('a/A.class', 0x1111, 100, { modificado: 1_800_000_000_000 }),
      ent('a/B.class', 0x2222, 200, { modificado: 1_800_000_000_000 })
    ])
    const res = compararIndices(antes, despues)
    check(
      'jar recompilado sin tocar el código -> CERO cambios',
      res.entradas.length === 0 && res.iguales === 2,
      `cambiadas=${res.entradas.length}, iguales=${res.iguales}`
    )
  }
  {
    // Y el simétrico: el tamaño comprimido puede cambiar (otro nivel de deflate)
    // sin que el contenido cambie. Tampoco cuenta.
    const antes = indice([ent('a/A.class', 0x1111, 100, { tamanoComprimido: 80 })])
    const despues = indice([ent('a/A.class', 0x1111, 100, { tamanoComprimido: 61 })])
    const res = compararIndices(antes, despues)
    check(
      'otro nivel de compresión (mismo CRC y tamaño real) -> idéntica',
      res.entradas.length === 0 && res.iguales === 1,
      'sin cambios'
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) Mismo CRC pero distinto tamaño -> modificada')
  {
    const res = compararIndices(
      indice([ent('x.txt', 0x1234, 10)]),
      indice([ent('x.txt', 0x1234, 11)])
    )
    check(
      'el tamaño desempata aunque el CRC coincida',
      res.entradas.length === 1 && res.entradas[0].estado === 'M',
      'M'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) Un lado nulo: alta o borrado del contenedor entero')
  {
    const dos = indice([ent('a.txt', 1, 10), ent('b.txt', 2, 20)])
    const alta = compararIndices(null, dos)
    check(
      'contenedor dado de alta -> todo A',
      alta.entradas.length === 2 && alta.entradas.every((e) => e.estado === 'A'),
      'A, A'
    )
    check('y no hay ninguna igual', alta.iguales === 0, '0')

    const borrado = compararIndices(dos, null)
    check(
      'contenedor borrado -> todo D',
      borrado.entradas.length === 2 && borrado.entradas.every((e) => e.estado === 'D'),
      'D, D'
    )

    const nada = compararIndices(null, null)
    check('los dos lados nulos -> lista vacía, sin reventar', nada.entradas.length === 0, 'vacía')
  }

  // -------------------------------------------------------------------------
  hr('(5) Los registros de DIRECTORIO no se comparan')
  {
    const antes = indice([ent('com/', 0, 0), ent('com/A.class', 1, 10)])
    const despues = indice([ent('com/A.class', 1, 10)])
    const res = compararIndices(antes, despues)
    check(
      'quitar el registro de carpeta no es un cambio (Ant vs Maven)',
      res.entradas.length === 0,
      'sin cambios'
    )
    check('y tampoco cuenta como igual', res.iguales === 1, 'iguales=1 (sólo el archivo)')
  }

  // -------------------------------------------------------------------------
  hr('(6) Nombres duplicados: gana la PRIMERA, igual que en leerIndice')
  {
    // `leerIndice` ya los filtra conservando la primera; esto fija que si alguna
    // llegara, el desempate va en la MISMA dirección y no inventa un cambio.
    const antes = indice([ent('dup.txt', 0xaa, 10), ent('dup.txt', 0xbb, 20)])
    const despues = indice([ent('dup.txt', 0xaa, 10)])
    const res = compararIndices(antes, despues)
    check(
      'la primera aparición es la que vale',
      res.entradas.length === 0 && res.iguales === 1,
      'sin cambios'
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) La marca de contenedor: se puede ENTRAR en un jar anidado')
  {
    const res = compararIndices(
      indice([ent('lib/cliente.jar', 1, 100), ent('lib/notas.txt', 1, 100)]),
      indice([ent('lib/cliente.jar', 2, 120), ent('lib/notas.txt', 2, 120)])
    )
    check('lib/cliente.jar se marca como contenedor', fila(res, 'lib/cliente.jar')?.contenedor === true, 'true')
    check('lib/notas.txt no', fila(res, 'lib/notas.txt')?.contenedor === false, 'false')
  }

  // -------------------------------------------------------------------------
  hr('(8) Orden estable y tope')
  {
    const res = compararIndices(
      indice([ent('z.txt', 1, 1), ent('a.txt', 1, 1), ent('m/n.txt', 1, 1)]),
      indice([ent('z.txt', 2, 2), ent('a.txt', 2, 2), ent('m/n.txt', 2, 2)])
    )
    check(
      'las entradas salen ordenadas por nombre',
      res.entradas.map((e) => e.nombre).join(',') === 'a.txt,m/n.txt,z.txt',
      res.entradas.map((e) => e.nombre).join(',')
    )

    const muchas: EntradaZip[] = []
    for (let i = 0; i < MAX_ENTRADAS_CAMBIADAS + 5; i++) {
      muchas.push(ent(`e/${String(i).padStart(6, '0')}.txt`, i + 1, 10))
    }
    const grande = compararIndices(null, indice(muchas))
    check(
      `tope de ${MAX_ENTRADAS_CAMBIADAS} y marca truncado`,
      grande.entradas.length === MAX_ENTRADAS_CAMBIADAS && grande.truncado,
      `${grande.entradas.length}, truncado=${grande.truncado}`
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
