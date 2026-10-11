#!/usr/bin/env node
// =============================================================================
// Prueba del autocompletado de la consola de MongoDB (npm run test:autocompletado-docs): qué contexto
// ve en cada punto de una orden (`db.`, la colección, la cadena del `find`, la clave de un objeto y la
// etapa de un pipeline), dónde no sugiere nada, y que lo que ofrece es lo que admite el intérprete.
// =============================================================================

import { createRequire } from 'node:module'
import {
  CADENA_AGGREGATE_DOCS,
  CADENA_FIND_DOCS,
  METODOS_COLECCION_DOCS,
  METODOS_DB_DOCS,
  candidatosDocs,
  contextoAutocompletadoDocs,
  esIdentificadorDocs
} from './autocompletadoDocs.ts'

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
const j = (x: unknown): string => JSON.stringify(x)

/** El contexto con el cursor donde está la `|`. */
function en(texto: string): string {
  const i = texto.indexOf('|')
  return j(contextoAutocompletadoDocs(texto.slice(0, i) + texto.slice(i + 1), i))
}
function caso(name: string, texto: string, esperado: unknown): void {
  const r = en(texto)
  check(name, r === j(esperado), r)
}

function main(): void {
  hr('(1) Tras un punto')
  caso('(1a) db.', 'db.|', { contexto: { tipo: 'db' }, parcial: '' })
  caso('(1b) db.ped (con lo escrito)', 'db.ped|', { contexto: { tipo: 'db' }, parcial: 'ped' })
  caso('(1c) db.pedidos.', 'db.pedidos.|', { contexto: { tipo: 'coleccion', coleccion: 'pedidos' }, parcial: '' })
  caso('(1d) db.getCollection("a-b").fi', "db.getCollection('a-b').fi|", { contexto: { tipo: 'coleccion', coleccion: 'a-b' }, parcial: 'fi' })
  caso('(1e) db["a b"].', 'db["a b"].|', { contexto: { tipo: 'coleccion', coleccion: 'a b' }, parcial: '' })
  caso('(1f) la cadena de un find', 'db.pedidos.find({ a: 1 }).|', { contexto: { tipo: 'cadena', metodo: 'find' }, parcial: '' })
  caso('(1g) la de un find ya encadenado', 'db.pedidos.find({}).sort({ a: -1 }).li|', { contexto: { tipo: 'cadena', metodo: 'find' }, parcial: 'li' })
  caso('(1h) la de un aggregate', 'db.pedidos.aggregate([]).|', { contexto: { tipo: 'cadena', metodo: 'aggregate' }, parcial: '' })
  caso('(1i) la de db.aggregate', 'db.aggregate([]).|', { contexto: { tipo: 'cadena', metodo: 'aggregate' }, parcial: '' })
  caso('(1j) un countDocuments no encadena', 'db.pedidos.countDocuments().|', null)
  caso('(1k) lo que no empieza en db, nada', 'x.|', null)
  caso('(1l) un método de db no es una colección', 'db.stats().|', null)
  caso('(1m) en varias líneas', 'db.pedidos\n  .find({})\n  .|', { contexto: { tipo: 'cadena', metodo: 'find' }, parcial: '' })

  hr('(2) Claves de objeto')
  caso('(2a) el filtro de un find', 'db.pedidos.find({ |', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: false }, parcial: '' })
  caso('(2b) tras una coma', "db.pedidos.find({ estado: 'ok', to|", { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: false }, parcial: 'to' })
  caso('(2c) un operador anidado', 'db.pedidos.find({ total: { $g|', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: false }, parcial: '$g' })
  caso('(2d) una etapa del pipeline', 'db.pedidos.aggregate([{ $m|', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: true }, parcial: '$m' })
  caso('(2e) la segunda etapa', 'db.pedidos.aggregate([{ $match: {} }, { |', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: true }, parcial: '' })
  caso('(2f) dentro de una etapa ya no es etapa', 'db.pedidos.aggregate([{ $match: { |', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: false }, parcial: '' })
  caso('(2g) el sort encadenado sigue en la colección', 'db.pedidos.find({}).sort({ |', { contexto: { tipo: 'clave', coleccion: 'pedidos', etapa: false }, parcial: '' })
  caso('(2h) db.aggregate: sin colección', 'db.aggregate([{ |', { contexto: { tipo: 'clave', coleccion: null, etapa: true }, parcial: '' })
  caso('(2i) un valor no es clave', 'db.pedidos.find({ estado: |', null)
  caso('(2j) un objeto cerrado, tampoco', 'db.pedidos.find({ a: 1 }|', null)

  hr('(3) Dónde no se sugiere nada, y el principio de una orden')
  caso('(3a) dentro de una cadena', "db.pedidos.find({ nombre: 'Ana|", null)
  caso('(3b) dentro de un comentario', 'db.pedidos.find() // db.|', null)
  caso('(3c) al principio', '|', { contexto: { tipo: 'orden' }, parcial: '' })
  caso('(3d) al principio de la siguiente orden', 'db.a.find();\nd|', { contexto: { tipo: 'orden' }, parcial: 'd' })
  caso('(3e) tras una línea en blanco', 'db.a.find()\n\n|', { contexto: { tipo: 'orden' }, parcial: '' })
  caso('(3g) un comentario tras una orden terminada', 'db.c.find(); // ver db.|', null)
  caso('(3h) un comentario solo', '// nota.|', null)
  caso('(3f) solo mira la orden del cursor', 'db.pedidos.find({ a: 1 });\ndb.clientes.|', { contexto: { tipo: 'coleccion', coleccion: 'clientes' }, parcial: '' })

  hr('(4) Identificadores')
  check('(4a) un nombre normal va tal cual; con guion o espacio, no', esIdentificadorDocs('pedidos') && esIdentificadorDocs('$x') && !esIdentificadorDocs('a-b') && !esIdentificadorDocs('a b') && !esIdentificadorDocs('1a'), 'ok')

  hr('(4b) Los candidatos')
  const datos = { colecciones: ['pedidos', 'a-b'], campos: ['_id', 'total', 'fecha alta'] }
  const insertos = (texto: string): string[] => {
    const i = texto.indexOf('|')
    const p = contextoAutocompletadoDocs(texto.slice(0, i) + texto.slice(i + 1), i)
    return p ? candidatosDocs(p, datos).map((c) => c.insertar) : []
  }
  const db = insertos('db.|')
  check('(4b1) db.: las colecciones (un nombre raro con getCollection) y los métodos', db.includes('pedidos') && db.includes("getCollection('a-b')") && db.includes('getName'), j(db))
  const campos = insertos('db.pedidos.find({ |')
  check('(4b2) una clave: los campos, con comillas el que no es identificador', j(campos) === j(['_id', 'total', "'fecha alta'"]), j(campos))
  check('(4b3) con $: los operadores, no los campos', insertos('db.pedidos.find({ total: { $|').includes('$gte') && !insertos('db.pedidos.find({ $|').includes('total'), 'ok')
  check('(4b4) en una etapa: las etapas', insertos('db.pedidos.aggregate([{ |').includes('$match'), 'ok')
  check('(4b5) sin datos de la base: solo los métodos', j(candidatosDocs({ contexto: { tipo: 'db' }, parcial: '' }, {}).map((c) => c.tipo)) === j(METODOS_DB_DOCS.map(() => 'metodo')), 'ok')

  hr('(5) Lo que se ofrece es lo que admite el intérprete')
  const requerir = createRequire(import.meta.url)
  const interprete = requerir('../../../../../tdb/sentenciaMongodb.cjs') as Record<string, ReadonlySet<string>>
  const mismo = (a: readonly string[], b: Iterable<string>): boolean => j([...a].sort()) === j([...b].sort())
  check('(5a) los métodos de una colección', mismo(METODOS_COLECCION_DOCS, [...interprete.LECTURA_COLECCION, ...interprete.ESCRITURA_COLECCION]), j(METODOS_COLECCION_DOCS))
  check('(5b) los de db, más getCollection', mismo(METODOS_DB_DOCS, [...interprete.METODOS_DB, ...interprete.ESCRITURA_DB, 'getCollection']), j(METODOS_DB_DOCS))
  check(
    '(5c) lo que encadena find y aggregate',
    mismo(CADENA_FIND_DOCS, [...interprete.CADENA_FIND, ...interprete.CADENA_CURSOR]) && mismo(CADENA_AGGREGATE_DOCS, interprete.CADENA_CURSOR),
    j(CADENA_FIND_DOCS)
  )
}

main()
const allPass = results.every((r) => r.pass)
console.log(`\nVEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
