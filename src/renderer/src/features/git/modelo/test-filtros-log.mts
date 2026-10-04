#!/usr/bin/env node
// =============================================================================
// Prueba del modelo puro de la barra de filtros del log (npm run test:filtros-log). Cubre:
// `esFiltroVacio` y `claveCommits`, `autoresDe`, `rangoFecha` con `ahora` inyectado, el umbral
// de 6 hex de `interpretarBusqueda`, `aplicarFiltros` por autor, fecha y texto (misma
// referencia si no hay nada que filtrar; una fecha ilegible no descarta), el modo hash por
// prefijo, `indiceDeHash` y `tramosResaltado` (la concatenación reconstruye el original).
// =============================================================================

import {
  FILTROS_VACIOS,
  aplicarFiltros,
  autoresDe,
  claveCommits,
  esFiltroVacio,
  indiceDeHash,
  interpretarBusqueda,
  rangoFecha,
  tramosResaltado
} from './filtrosLog.ts'
import type { Commit } from '../../../../../shared/git-ipc.ts'

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

/** Commit de mentira con los campos que los filtros miran. */
function c(hash: string, autor: string, iso: string, subject: string): Commit {
  return {
    hash,
    parents: [],
    authorName: autor,
    authorEmail: `${autor.toLowerCase().replace(/\s/g, '.')}@example.com`,
    isoDate: iso,
    subject,
    refs: []
  }
}

// Reloj fijo para todo el test: 15 de junio de 2024, 14:30 hora local.
const AHORA = new Date(2024, 5, 15, 14, 30, 0, 0).getTime()
const HOY_TEMPRANO = new Date(2024, 5, 15, 3, 0, 0, 0).toISOString()
const AYER = new Date(2024, 5, 14, 20, 0, 0, 0).toISOString()
const HACE_10_DIAS = new Date(2024, 5, 5, 12, 0, 0, 0).toISOString()
const HACE_60_DIAS = new Date(2024, 3, 16, 12, 0, 0, 0).toISOString()
const HACE_2_ANIOS = new Date(2022, 5, 15, 12, 0, 0, 0).toISOString()

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) esFiltroVacio / claveCommits')
  // -------------------------------------------------------------------------
  check('los filtros vacíos lo son', esFiltroVacio(FILTROS_VACIOS), JSON.stringify(FILTROS_VACIOS))
  check('con rama ya no', !esFiltroVacio({ ...FILTROS_VACIOS, rama: 'main' }), 'rama=main')
  check('con autor ya no', !esFiltroVacio({ ...FILTROS_VACIOS, autor: 'Ana' }), 'autor=Ana')
  check('con fecha ya no', !esFiltroVacio({ ...FILTROS_VACIOS, fecha: 'semana' }), 'fecha=semana')
  check(
    'la clave separa repo y rama con NUL',
    claveCommits('C:/repo', 'main') === 'C:/repo\nmain',
    JSON.stringify(claveCommits('C:/repo', 'main'))
  )
  check(
    'rama null da clave distinta de la rama vacía-literal',
    claveCommits('C:/repo', null) === 'C:/repo\n',
    JSON.stringify(claveCommits('C:/repo', null))
  )
  check(
    'dos repos distintos nunca comparten clave',
    claveCommits('C:/a', 'main') !== claveCommits('C:/b', 'main'),
    'claves distintas'
  )

  // -------------------------------------------------------------------------
  hr('2) autoresDe')
  // -------------------------------------------------------------------------
  {
    const commits = [
      c('1', 'Ana López', AYER, 'x'),
      c('2', 'Bob Smith', AYER, 'y'),
      c('3', 'Ana López', AYER, 'z'),
      c('4', 'Ana López', AYER, 'w'),
      c('5', 'Zoë Müller', AYER, 'v'),
      c('6', 'Bob Smith', AYER, 'u')
    ]
    const autores = autoresDe(commits)
    check('3 autores distintos', autores.length === 3, JSON.stringify(autores.map((a) => a.nombre)))
    check(
      'ordenados por nº de commits (desc)',
      autores[0].nombre === 'Ana López' && autores[0].commits === 3,
      JSON.stringify(autores)
    )
    check('el conteo del segundo es correcto', autores[1].nombre === 'Bob Smith' && autores[1].commits === 2, JSON.stringify(autores[1]))
    check('el autor con acentos aparece intacto', autores[2].nombre === 'Zoë Müller', autores[2].nombre)
    // Desempate alfabético: dos autores con el mismo conteo salen en orden estable.
    const empate = autoresDe([c('1', 'Zoe', AYER, 'x'), c('2', 'Ana', AYER, 'y')])
    check('a igualdad de commits, orden alfabético', empate[0].nombre === 'Ana', JSON.stringify(empate.map((a) => a.nombre)))
    check('lista vacía -> sin autores', autoresDe([]).length === 0, '0')
  }

  // -------------------------------------------------------------------------
  hr('3) rangoFecha')
  // -------------------------------------------------------------------------
  {
    check('"cualquiera" no acota', rangoFecha('cualquiera', AHORA) === null, 'null')
    const hoy = rangoFecha('hoy', AHORA)
    const medianoche = new Date(2024, 5, 15, 0, 0, 0, 0).getTime()
    check('"hoy" arranca en la MEDIANOCHE local', hoy === medianoche, `${hoy} vs ${medianoche}`)
    check(
      '"hoy" NO es "hace 24 h"',
      hoy !== null && hoy > AHORA - 24 * 3600_000,
      `hoy=${hoy} 24h=${AHORA - 24 * 3600_000}`
    )
    const semana = rangoFecha('semana', AHORA)
    check('"semana" son 7 días atrás', semana === AHORA - 7 * 24 * 3600_000, String(semana))
    check('"mes" son 30 días atrás', rangoFecha('mes', AHORA) === AHORA - 30 * 24 * 3600_000, String(rangoFecha('mes', AHORA)))
    check('"año" son 365 días atrás', rangoFecha('anio', AHORA) === AHORA - 365 * 24 * 3600_000, String(rangoFecha('anio', AHORA)))
    check(
      'los límites son crecientes de más viejo a más nuevo',
      (rangoFecha('anio', AHORA) as number) < (rangoFecha('mes', AHORA) as number) &&
        (rangoFecha('mes', AHORA) as number) < (rangoFecha('semana', AHORA) as number),
      'anio < mes < semana'
    )
  }

  // -------------------------------------------------------------------------
  hr('4) interpretarBusqueda')
  // -------------------------------------------------------------------------
  {
    check('cadena vacía -> vacio', interpretarBusqueda('').modo === 'vacio', 'vacio')
    check('solo espacios -> vacio', interpretarBusqueda('   ').modo === 'vacio', 'vacio')
    const h = interpretarBusqueda('7d1431b')
    check('7 hex -> hash', h.modo === 'hash', h.modo)
    check('el hash se normaliza a minúsculas', h.modo === 'hash' && h.hash === '7d1431b', JSON.stringify(h))
    check(
      'un hash en MAYÚSCULAS también',
      (() => {
        const r = interpretarBusqueda('7D1431B')
        return r.modo === 'hash' && r.hash === '7d1431b'
      })(),
      '7D1431B -> 7d1431b'
    )
    check('40 hex -> hash', interpretarBusqueda('a'.repeat(40)).modo === 'hash', 'hash')
    check('41 hex -> texto (no es un sha)', interpretarBusqueda('a'.repeat(41)).modo === 'texto', 'texto')
    // EL UMBRAL: palabras cortas que "parecen" hex deben seguir siendo texto.
    for (const palabra of ['add', 'cafe', 'beef', 'dad', 'fee']) {
      check(
        `"${palabra}" se trata como TEXTO, no como hash`,
        interpretarBusqueda(palabra).modo === 'texto',
        interpretarBusqueda(palabra).modo
      )
    }
    check('"deadbeef" (8 hex) sí es hash', interpretarBusqueda('deadbeef').modo === 'hash', 'hash')
    check(
      'el texto se normaliza a minúsculas',
      (() => {
        const r = interpretarBusqueda('  Corrige EL Bug  ')
        return r.modo === 'texto' && r.texto === 'corrige el bug'
      })(),
      'trim + minúsculas'
    )
  }

  // -------------------------------------------------------------------------
  hr('5-7) aplicarFiltros')
  // -------------------------------------------------------------------------
  {
    const commits = [
      c('a1', 'Ana López', HOY_TEMPRANO, 'Corrige el arranque'),
      c('b2', 'Bob Smith', AYER, 'Añade el buscador'),
      c('c3', 'Ana López', HACE_10_DIAS, 'Refactor del panel'),
      c('d4', 'Bob Smith', HACE_60_DIAS, 'Corrige el cierre'),
      c('e5', 'Ana López', HACE_2_ANIOS, 'Commit antiguo')
    ]
    const vacia = interpretarBusqueda('')

    // (6) MISMA REFERENCIA sin nada que filtrar.
    check(
      'sin filtros devuelve LA MISMA referencia',
      aplicarFiltros(commits, FILTROS_VACIOS, vacia, AHORA) === commits,
      'identidad preservada'
    )
    check(
      'con rama (que filtra el backend) TAMBIÉN devuelve la misma referencia',
      aplicarFiltros(commits, { ...FILTROS_VACIOS, rama: 'main' }, vacia, AHORA) === commits,
      'la rama no se aplica en cliente'
    )

    // (5) autor
    const porAutor = aplicarFiltros(commits, { ...FILTROS_VACIOS, autor: 'Ana López' }, vacia, AHORA)
    check('filtra por autor exacto', porAutor.length === 3, `${porAutor.length}`)
    check(
      'y solo de ese autor',
      porAutor.every((x) => x.authorName === 'Ana López'),
      porAutor.map((x) => x.hash).join(',')
    )

    // (5) fecha
    const hoy = aplicarFiltros(commits, { ...FILTROS_VACIOS, fecha: 'hoy' }, vacia, AHORA)
    check('"hoy" deja solo el de esta madrugada', hoy.length === 1 && hoy[0].hash === 'a1', hoy.map((x) => x.hash).join(','))
    const semana = aplicarFiltros(commits, { ...FILTROS_VACIOS, fecha: 'semana' }, vacia, AHORA)
    check('"semana" deja los dos recientes', semana.length === 2, semana.map((x) => x.hash).join(','))
    const mes = aplicarFiltros(commits, { ...FILTROS_VACIOS, fecha: 'mes' }, vacia, AHORA)
    check('"mes" deja tres', mes.length === 3, mes.map((x) => x.hash).join(','))
    const anio = aplicarFiltros(commits, { ...FILTROS_VACIOS, fecha: 'anio' }, vacia, AHORA)
    check('"año" descarta solo el de hace 2 años', anio.length === 4, anio.map((x) => x.hash).join(','))

    // (5) texto: asunto Y autor
    const porTexto = aplicarFiltros(commits, FILTROS_VACIOS, interpretarBusqueda('corrige'), AHORA)
    check('el texto casa en el asunto', porTexto.length === 2, porTexto.map((x) => x.hash).join(','))
    const porAutorEnTexto = aplicarFiltros(commits, FILTROS_VACIOS, interpretarBusqueda('bob'), AHORA)
    check('el texto casa también en el autor', porAutorEnTexto.length === 2, porAutorEnTexto.map((x) => x.hash).join(','))
    const conAcento = aplicarFiltros(commits, FILTROS_VACIOS, interpretarBusqueda('AÑADE'), AHORA)
    check('case-insensitive y con acentos', conAcento.length === 1 && conAcento[0].hash === 'b2', conAcento.map((x) => x.hash).join(','))

    // (5) combinados: los ejes se acumulan (AND).
    const combinado = aplicarFiltros(
      commits,
      { rama: null, autor: 'Bob Smith', fecha: 'anio' },
      interpretarBusqueda('corrige'),
      AHORA
    )
    check('autor + fecha + texto se combinan con AND', combinado.length === 1 && combinado[0].hash === 'd4', combinado.map((x) => x.hash).join(','))

    // (8) el modo hash filtra por PREFIJO y deja únicamente las coincidencias.
    const porHash = [
      c('deadbeef1111', 'Ana López', AYER, 'El bueno'),
      c('deadbeef2222', 'Bob Smith', AYER, 'El otro con el mismo prefijo corto'),
      c('cafebabe3333', 'Ana López', AYER, 'Nada que ver')
    ]
    const unSolo = aplicarFiltros(porHash, FILTROS_VACIOS, interpretarBusqueda('deadbeef1'), AHORA)
    check(
      'un prefijo que solo casa con uno deja UNA fila',
      unSolo.length === 1 && unSolo[0].hash === 'deadbeef1111',
      unSolo.map((x) => x.hash).join(',')
    )
    const dos = aplicarFiltros(porHash, FILTROS_VACIOS, interpretarBusqueda('deadbeef'), AHORA)
    check(
      'un prefijo compartido deja LAS DOS (verlas es información, no ruido)',
      dos.length === 2,
      dos.map((x) => x.hash).join(',')
    )
    const ninguno = aplicarFiltros(porHash, FILTROS_VACIOS, interpretarBusqueda('999999'), AHORA)
    check(
      'un hash que no existe deja la lista VACÍA, no la lista entera',
      ninguno.length === 0,
      `${ninguno.length} filas`
    )

    // LO QUE PARECE UN HASH Y NO LO ES. `interpretarBusqueda` llama "hash" a
    // cualquier cadena de 6+ hex, y ahí caen números de ticket (123456, 202503) y
    // palabras como "decade" o "facade". Filtrar SOLO por hash le diría al usuario
    // "no hay resultados" sobre un commit que sí está: el modo hash casa por
    // prefijo O por texto.
    const conTicket = [
      c('aaaa111122223333', 'Ana López', AYER, 'PY24-123456 ajusta el cliente'),
      c('bbbb444455556666', 'Bob Smith', AYER, 'Nada que ver')
    ]
    const ticket = aplicarFiltros(conTicket, FILTROS_VACIOS, interpretarBusqueda('123456'), AHORA)
    check(
      'un número de ticket de 6 dígitos encuentra su commit (no dice "sin resultados")',
      ticket.length === 1 && ticket[0].hash === 'aaaa111122223333',
      ticket.map((x) => x.subject).join(' | ')
    )
    check(
      'y "decade" (6 hex que es una palabra) busca como texto',
      aplicarFiltros(
        [c('ffff000011112222', 'Ana López', AYER, 'Una decade de commits')],
        FILTROS_VACIOS,
        interpretarBusqueda('decade'),
        AHORA
      ).length === 1,
      'casa por asunto'
    )
    check(
      'y el hash se combina con los demás ejes (AND)',
      aplicarFiltros(porHash, { rama: null, autor: 'Bob Smith', fecha: 'cualquiera' }, interpretarBusqueda('deadbeef'), AHORA)
        .length === 1,
      'autor + hash'
    )

    // (7) fecha ilegible.
    const conBasura = [...commits, c('z9', 'Ana López', 'no-es-una-fecha', 'Fecha rota')]
    const filtrado = aplicarFiltros(conBasura, { ...FILTROS_VACIOS, fecha: 'hoy' }, vacia, AHORA)
    check(
      'una fecha ilegible NO descarta el commit',
      filtrado.some((x) => x.hash === 'z9'),
      filtrado.map((x) => x.hash).join(',')
    )

    // Un filtro que no casa con nada da lista vacía, no la original.
    const nada = aplicarFiltros(commits, { ...FILTROS_VACIOS, autor: 'Nadie' }, vacia, AHORA)
    check('un autor inexistente da lista vacía', nada.length === 0, `${nada.length}`)

    // (8) indiceDeHash
    check('indiceDeHash localiza por prefijo', indiceDeHash(commits, 'c3') === 2, String(indiceDeHash(commits, 'c3')))
    check('indiceDeHash devuelve -1 si no está', indiceDeHash(commits, 'ffff') === -1, String(indiceDeHash(commits, 'ffff')))
  }

  // -------------------------------------------------------------------------
  hr('9) tramosResaltado')
  // -------------------------------------------------------------------------
  {
    const sinQuery = tramosResaltado('Corrige el arranque', null)
    check('sin query: un solo tramo sin marcar', sinQuery.length === 1 && !sinQuery[0].hit, JSON.stringify(sinQuery))
    const sinCoincidencia = tramosResaltado('Corrige el arranque', 'zzz')
    check('sin coincidencias: un solo tramo sin marcar', sinCoincidencia.length === 1 && !sinCoincidencia[0].hit, JSON.stringify(sinCoincidencia))

    const uno = tramosResaltado('Corrige el arranque', 'el')
    check('una coincidencia parte en 3 tramos', uno.length === 3, JSON.stringify(uno))
    check('el tramo central es el marcado', uno[1].hit && uno[1].t === 'el', JSON.stringify(uno[1]))

    const varias = tramosResaltado('aXaXa', 'x')
    check('varias coincidencias', varias.filter((t) => t.hit).length === 2, JSON.stringify(varias))
    check(
      'case-insensitive pero conserva el texto ORIGINAL',
      varias.filter((t) => t.hit).every((t) => t.t === 'X'),
      JSON.stringify(varias.filter((t) => t.hit))
    )

    const alPrincipio = tramosResaltado('Corrige', 'cor')
    check('coincidencia al principio: sin tramo vacío delante', alPrincipio[0].hit, JSON.stringify(alPrincipio))
    const alFinal = tramosResaltado('Corrige', 'ge')
    check('coincidencia al final: último tramo marcado', alFinal[alFinal.length - 1].hit, JSON.stringify(alFinal))

    // LA PROPIEDAD que importa: nunca se pierde ni se duplica texto.
    for (const [texto, q] of [
      ['Corrige el arranque', 'e'],
      ['aaaa', 'aa'],
      ['Añade el buscador', 'a'],
      ['', 'x'],
      ['xyz', 'xyz']
    ] as const) {
      const tr = tramosResaltado(texto, q)
      check(
        `la concatenación reconstruye el original ("${texto}" / "${q}")`,
        tr.map((t) => t.t).join('') === texto,
        JSON.stringify(tr.map((t) => t.t).join(''))
      )
    }
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
