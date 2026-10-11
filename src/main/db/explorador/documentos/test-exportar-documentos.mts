#!/usr/bin/env node
// =============================================================================
// Prueba de `exportarDocumentos.ts` (npm run test:exportar-documentos): la validación del origen, el productor por
// páginas con un gestor falso (cursor, Stop, fallo, aviso de omitidos) y el archivo que sale de JSON y de CSV con el
// `Exportador` real contra una carpeta temporal.
// =============================================================================

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { Exportador } from '../exportacion.ts'
import type { PaginaExportacionDocs } from '../protocoloTrabajador.ts'
import {
  escritorJsonDocumentos,
  origenDocumentos,
  productorDocumentos,
  type GestorExportaDocumentos,
  type OrigenDocumentos
} from './exportarDocumentos.ts'
import { ErrorGestor } from '../sesiones/errores.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 400)}`)
}
const j = (v: unknown): string => JSON.stringify(v) ?? 'undefined'

function falla(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof ErrorGestor ? e.message : `NO ES ErrorGestor: ${String(e)}`
  }
}

const ok = (valor: PaginaExportacionDocs): DbRespuesta<PaginaExportacionDocs> => ({ ok: true, valor })

interface Registro {
  abrir: Array<{ conexionId: string; pet: unknown }>
  mas: Array<{ lector: string; pet: unknown }>
  cerrados: string[]
}

/** Un gestor con `paginas`: la primera sale de `exportarAbrir` y el resto de `exportarMas`, enlazadas por lectores. */
function gestorFalso(paginas: PaginaExportacionDocs[], r: Registro, fallaEn = -1): GestorExportaDocumentos {
  let i = 0
  const dar = (): DbRespuesta<PaginaExportacionDocs> => {
    if (i === fallaEn) return { ok: false, error: { motivo: 'servidor', mensaje: 'se cortó la conexión' } }
    return ok(paginas[i++])
  }
  return {
    exportarAbrir: async (conexionId, pet) => {
      r.abrir.push({ conexionId, pet })
      return dar()
    },
    exportarMas: async (lector, pet) => {
      r.mas.push({ lector, pet })
      return dar()
    },
    cerrarLector: async (lector) => void r.cerrados.push(lector)
  }
}

const registroNuevo = (): Registro => ({ abrir: [], mas: [], cerrados: [] })

hr('(1) Validación del origen')
{
  const col = { tipo: 'coleccion', conexionId: 'c1', base: 'app', coleccion: 'pedidos', filtro: '{ a: 1 }', proyeccion: '', orden: '{ a: -1 }' }
  const o = origenDocumentos(col, 'json')
  check('una colección: la petición al trabajador lleva sus textos y 1000 por página', j(o) === j({ conexionId: 'c1', pet: { operacion: 'exportarAbrir', origen: 'coleccion', base: 'app', coleccion: 'pedidos', filtro: '{ a: 1 }', proyeccion: '', orden: '{ a: -1 }', formato: 'json', maxDocumentos: 1000 } }), j(o))
  const g = origenDocumentos({ ...col, filtro: '', filtroGuiado: { union: 'todas', condiciones: [{ columna: 'edad', categoria: 'numero', operador: 'mayor', valor: '30' }] }, ordenColumnas: [{ columna: 'edad', dir: 'desc' }], orden: '' }, 'csv')
  check('con filtro guiado y orden de la cabecera, el trabajador recibe los textos ya compilados', g.pet.origen === 'coleccion' && g.pet.filtro.includes('$gt') && g.pet.orden.includes('edad') && g.pet.formato === 'csv', j(g.pet))
  const s = origenDocumentos({ tipo: 'sentencia', conexionId: 'c1', base: null, texto: 'db.pedidos.find()' }, 'csv')
  check('una sentencia: texto y base tal cual', j(s.pet) === j({ operacion: 'exportarAbrir', origen: 'sentencia', base: null, texto: 'db.pedidos.find()', formato: 'csv', maxDocumentos: 1000 }), j(s.pet))
  const malos: Array<[string, Record<string, unknown>]> = [
    ['sin conexión', { ...col, conexionId: '' }],
    ['sin base', { ...col, base: undefined }],
    ['sin colección', { ...col, coleccion: 5 }],
    ['filtro que no es texto', { ...col, filtro: 3 }],
    ['filtro guiado y de texto a la vez', { ...col, filtroGuiado: { union: 'todas', condiciones: [{ columna: 'a', categoria: 'texto', operador: 'igual', valor: 'x' }] } }],
    ['filtro guiado roto', { ...col, filtro: '', filtroGuiado: { union: 'todas', condiciones: 7 } }],
    ['sentencia vacía', { tipo: 'sentencia', conexionId: 'c1', base: null, texto: '   ' }],
    ['base de la sentencia que no es texto', { tipo: 'sentencia', conexionId: 'c1', base: 4, texto: 'db.a.find()' }]
  ]
  for (const [nombre, req] of malos) {
    const m = falla(() => origenDocumentos(req, 'json'))
    check(`rechaza: ${nombre}`, m !== null && !m.startsWith('NO ES'), String(m))
  }
}

hr('(2) El productor por páginas')
{
  const origen: OrigenDocumentos = origenDocumentos({ tipo: 'sentencia', conexionId: 'c1', base: 'app', texto: 'db.p.find()' }, 'csv')
  const paginas: PaginaExportacionDocs[] = [
    { lector: 'docs:1', columnas: ['_id', 'n'], filas: [['a', '1'], ['b', '2']], omitidos: 0 },
    { lector: 'docs:1', columnas: ['_id', 'n'], filas: [['c', '3']], omitidos: 1 },
    { lector: null, columnas: ['_id', 'n'], filas: [['d', null]], omitidos: 1 }
  ]
  const r = registroNuevo()
  const recibidas: Array<{ columnas: string[]; filas: unknown }> = []
  const aviso = await productorDocumentos(gestorFalso(paginas, r), origen, 'csv', 'p1')(
    async (p) => void recibidas.push({ columnas: p.columnas.map((c) => c.nombre), filas: JSON.parse(p.filasJson) }),
    () => false
  )
  check('entrega las tres páginas, con las columnas de la primera en todas', recibidas.length === 3 && recibidas.every((p) => j(p.columnas) === j(['_id', 'n'])) && j(recibidas[2].filas) === j([['d', null]]), j(recibidas))
  check('las siguientes se piden con el lector y las columnas fijadas, en CSV', r.mas.length === 2 && r.mas.every((m) => m.lector === 'docs:1' && j((m.pet as { columnas: string[] }).columnas) === j(['_id', 'n'])), j(r.mas))
  check('agotado el cursor no se cierra nada más', r.cerrados.length === 0, j(r.cerrados))
  check('dice cuántos documentos se quedaron sin algún campo', aviso?.aviso?.startsWith('2 documentos tenían campos') === true, j(aviso))

  const rj = registroNuevo()
  const enJson: string[][] = []
  await productorDocumentos(gestorFalso([{ lector: null, columnas: [], filas: [['{"a":1}']], omitidos: 0 }], rj), origenDocumentos({ tipo: 'sentencia', conexionId: 'c1', base: null, texto: 'db.p.find()' }, 'json'), 'json', 'p2')(
    async (p) => void enJson.push(p.columnas.map((c) => c.nombre)),
    () => false
  )
  check('en JSON la única columna es «documento» y las páginas siguientes no llevan columnas', j(enJson) === j([['documento']]), j(enJson))

  const rs = registroNuevo()
  const vistas: number[] = []
  await productorDocumentos(gestorFalso(paginas, rs), origen, 'csv', 'p3')(
    async () => void vistas.push(1),
    () => vistas.length >= 1
  )
  check('un Stop entre páginas corta la lectura y cierra el cursor', vistas.length === 1 && j(rs.cerrados) === j(['docs:1']) && rs.mas.length === 0, j({ vistas, cerrados: rs.cerrados }))

  const rf = registroNuevo()
  let motivo = ''
  try {
    await productorDocumentos(gestorFalso(paginas, rf, 1), origen, 'csv', 'p4')(async () => undefined, () => false)
  } catch (e) {
    motivo = e instanceof ErrorGestor ? `${e.error.motivo}: ${e.message}` : String(e)
  }
  check('un fallo a mitad sale como ErrorGestor con el mensaje del servidor y el cursor se cierra', motivo === 'servidor: se cortó la conexión' && j(rf.cerrados) === j(['docs:1']), `${motivo} ${j(rf.cerrados)}`)
  let falloAbrir = ''
  try {
    await productorDocumentos(gestorFalso(paginas, registroNuevo(), 0), origen, 'csv', 'p5')(async () => undefined, () => false)
  } catch (e) {
    falloAbrir = e instanceof ErrorGestor ? e.message : String(e)
  }
  check('un fallo al abrir no deja nada que cerrar', falloAbrir === 'se cortó la conexión', falloAbrir)
}

hr('(3) El archivo, con el exportador real')
{
  const base = mkdtempSync(path.join(os.tmpdir(), 'tessera-exp-docs-'))
  try {
    const ex = new Exportador({
      guardar: async (op) => path.join(base, op.nombrePropuesto),
      revelar: () => undefined,
      emitirProgreso: () => undefined,
      plataforma: 'linux'
    })
    const paginas = (): PaginaExportacionDocs[] => [
      { lector: 'docs:1', columnas: ['_id', 'nombre'], filas: [['a', 'Ana, "la" primera'], ['b', null]], omitidos: 0 },
      { lector: null, columnas: ['_id', 'nombre'], filas: [['c', 'Luis']], omitidos: 0 }
    ]
    const origen = origenDocumentos({ tipo: 'sentencia', conexionId: 'c1', base: null, texto: 'db.p.find()' }, 'csv')
    const csv = await ex.exportar({
      peticionId: 'e1',
      formato: 'csv',
      nombreSugerido: 'pedidos',
      motor: 'mongodb',
      producir: productorDocumentos(gestorFalso(paginas(), registroNuevo()), origen, 'csv', 'e1')
    })
    const textoCsv = readFileSync(path.join(base, 'pedidos.csv'), 'utf8')
    check('CSV: BOM, cabecera, una fila por documento y comillas de RFC 4180 (líneas CRLF)', textoCsv.charCodeAt(0) === 0xfeff && textoCsv.slice(1) === '_id,nombre\r\na,"Ana, ""la"" primera"\r\nb,\r\nc,Luis\r\n' && csv?.filas === 3, j(textoCsv))

    const origenJ = origenDocumentos({ tipo: 'sentencia', conexionId: 'c1', base: null, texto: 'db.p.find()' }, 'json')
    const docs: PaginaExportacionDocs[] = [
      { lector: 'docs:1', columnas: [], filas: [['{"_id":"a"}'], ['{"_id":"b"}']], omitidos: 0 },
      { lector: null, columnas: [], filas: [['{"_id":"c"}']], omitidos: 0 }
    ]
    const json = await ex.exportar({
      peticionId: 'e2',
      formato: 'json',
      nombreSugerido: 'pedidos',
      motor: 'mongodb',
      escritor: escritorJsonDocumentos,
      producir: productorDocumentos(gestorFalso(docs, registroNuevo()), origenJ, 'json', 'e2')
    })
    const textoJson = readFileSync(path.join(base, 'pedidos.json'), 'utf8')
    check('JSON: una lista con un documento por línea, que se puede leer', textoJson === '[\n{"_id":"a"},\n{"_id":"b"},\n{"_id":"c"}\n]\n' && Array.isArray(JSON.parse(textoJson)) && json?.filas === 3, j(textoJson))

    const vacio = await ex.exportar({
      peticionId: 'e3',
      formato: 'json',
      nombreSugerido: 'nada',
      motor: 'mongodb',
      escritor: escritorJsonDocumentos,
      producir: productorDocumentos(gestorFalso([{ lector: null, columnas: [], filas: [], omitidos: 0 }], registroNuevo()), origenJ, 'json', 'e3')
    })
    check('JSON sin documentos: una lista vacía válida', readFileSync(path.join(base, 'nada.json'), 'utf8') === '[]\n' && vacio?.filas === 0, j(readFileSync(path.join(base, 'nada.json'), 'utf8')))
    check('no queda ningún temporal', readdirSync(base).every((f) => !f.endsWith('.part')), j(readdirSync(base)))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

const pasan = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
process.exit(pasan === results.length ? 0 : 1)
