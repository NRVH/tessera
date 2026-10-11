#!/usr/bin/env node
// =============================================================================
// Prueba del tapado de contraseñas de los comandos de la consola de Redis (npm run test:secretos-redis):
// `AUTH`, `HELLO … AUTH`, `MIGRATE … AUTH2`, `CONFIG SET requirepass`, `ACL SETUSER` y lo que NO se toca.
// Es lógica pura de `secretosRedis.ts`; no necesita servidor.
// =============================================================================

import { taparSecretosRedis } from './secretosRedis.ts'

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
  const r = taparSecretosRedis(entrada)
  check(name, r === esperado, r)
}

hr('Lo que se tapa')
caso('AUTH con solo clave', 'AUTH secreta', 'AUTH ***')
caso('AUTH con usuario y clave', 'auth admin "una clave"', 'auth *** ***')
caso('HELLO 3 AUTH usuario clave', 'HELLO 3 AUTH admin s3creta SETNAME x', 'HELLO 3 AUTH *** *** SETNAME x')
caso('MIGRATE con AUTH', 'MIGRATE h 6379 "" 0 5000 AUTH clave KEYS a b', 'MIGRATE h 6379 "" 0 5000 AUTH *** KEYS a b')
caso('MIGRATE con AUTH2', 'MIGRATE h 6379 k 0 5000 AUTH2 u clave', 'MIGRATE h 6379 k 0 5000 AUTH2 *** ***')
caso('CONFIG SET requirepass', 'CONFIG SET requirepass hunter2', 'CONFIG SET requirepass ***')
caso('CONFIG SET con varios pares: solo el secreto', 'config set maxmemory 1gb masterauth clave', 'config set maxmemory 1gb masterauth ***')
caso('CONFIG SET de las frases de las claves TLS', 'CONFIG SET tls-key-file-pass f1 tls-client-key-file-pass f2', 'CONFIG SET tls-key-file-pass *** tls-client-key-file-pass ***')
caso('ACL SETUSER conserva el signo', 'ACL SETUSER ana on >clave1 <vieja #abc123 ~* +@all', 'ACL SETUSER ana on >*** <*** #*** ~* +@all')

hr('Lo que NO se toca')
caso('un SET con la palabra password', 'SET password valor', 'SET password valor')
caso('AUTH sin argumentos', 'AUTH', 'AUTH')
caso('CONFIG GET requirepass', 'CONFIG GET requirepass', 'CONFIG GET requirepass')
caso('CONFIG SET de otro parámetro', 'CONFIG SET maxmemory 1gb', 'CONFIG SET maxmemory 1gb')
caso('ACL SETUSER sin contraseñas', 'ACL SETUSER ana on ~* +@read', 'ACL SETUSER ana on ~* +@read')
check('sin nada que tapar devuelve el MISMO texto', taparSecretosRedis('GET a') === 'GET a', 'mismo')

const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
process.exit(ok === results.length ? 0 : 1)
