#!/usr/bin/env node
// =============================================================================
// Prueba del tapado de contraseñas de las órdenes del shell de MongoDB (npm run test:secretos-mongo):
// `pwd`/`password` en un objeto, `changeUserPassword` y `db.auth`, la URI con clave, las comillas que
// se conservan y lo que NO se toca.
// =============================================================================

import { taparSecretosMongo } from './secretosMongo.ts'

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

function caso(name: string, entrada: string, esperado: string): void {
  const r = taparSecretosMongo(entrada)
  check(name, r === esperado, r)
}

function main(): void {
  hr('(1) Lo que se tapa')
  caso('(1a) createUser con pwd entre comillas simples', `db.createUser({ user: 'ana', pwd: 's3cr3t', roles: [] })`, `db.createUser({ user: 'ana', pwd: '***', roles: [] })`)
  caso('(1b) clave citada y comillas dobles', `db.updateUser("ana", { "pwd": "otra" })`, `db.updateUser("ana", { "pwd": "***" })`)
  caso('(1c) password en un objeto, sin distinguir caja', `db.runCommand({ createUser: 'x', Password: 'y' })`, `db.runCommand({ createUser: 'x', Password: '***' })`)
  caso('(1d) changeUserPassword: el segundo argumento', `db.changeUserPassword('ana', "nueva")`, `db.changeUserPassword('ana', "***")`)
  caso('(1e) db.auth(usuario, clave)', `db.auth('ana', 'clave')`, `db.auth('ana', '***')`)
  caso('(1f) db.auth({ user, pwd })', `db.auth({ user: 'ana', pwd: 'clave' })`, `db.auth({ user: 'ana', pwd: '***' })`)
  caso('(1g) la clave de una URI', `new Mongo('mongodb://ana:clave@servidor:27017')`, `new Mongo('mongodb://ana:***@servidor:27017')`)
  caso('(1h) una comilla escapada dentro de la clave no la corta', `db.createUser({ user: 'a', pwd: 'it\\'s' })`, `db.createUser({ user: 'a', pwd: '***' })`)
  caso('(1i) comillas invertidas', 'db.createUser({ user: `a`, pwd: `x` })', 'db.createUser({ user: `a`, pwd: `***` })')

  caso('(1j) una clave que CONTIENE password', `db.u.insertOne({ nombre: 'a', newPassword: 'S3creta!' })`, `db.u.insertOne({ nombre: 'a', newPassword: '***' })`)
  caso('(1k) en un $set, con otra caja', `db.u.updateOne({}, { $set: { userPassword: 'x', apiPwd: "y" } })`, `db.u.updateOne({}, { $set: { userPassword: '***', apiPwd: "***" } })`)

  hr('(2) Lo que NO se toca')
  const sinNada = `db.pedidos.find({ password: { $exists: true } })`
  check('(2a) un campo llamado password con un filtro (no una cadena)', taparSecretosMongo(sinNada) === sinNada, taparSecretosMongo(sinNada))
  const consulta = `db.usuarios.find({ nombre: 'pwd' })`
  check('(2b) la palabra como VALOR', taparSecretosMongo(consulta) === consulta, taparSecretosMongo(consulta))
  const prompt = `db.createUser({ user: 'a', pwd: passwordPrompt() })`
  check('(2c) passwordPrompt(): no hay clave escrita', taparSecretosMongo(prompt) === prompt, taparSecretosMongo(prompt))
  const uri = `new Mongo('mongodb://servidor:27017')`
  check('(2d) una URI sin usuario (el `:` es del puerto)', taparSecretosMongo(uri) === uri, taparSecretosMongo(uri))
  check('(2e) sin nada que tapar devuelve el MISMO texto', taparSecretosMongo(consulta) === consulta, 'mismo')
}

main()
const allPass = results.every((r) => r.pass)
console.log(`\nVEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
