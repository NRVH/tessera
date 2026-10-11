#!/usr/bin/env node
// =============================================================================
// Prueba del cifrado de PostgreSQL y Oracle en `tdb` (npm run test:cifrado-conexiones): la
// opción `ssl` de `pg` (sin cifrar, verificando con las CA o confiando), los errores de conectar
// que se traducen a su remedio, el descriptor TCPS de Oracle y lo común de `tlsComun.cjs`. Sin
// servidor: la conexión real la prueban `oracle.sh` y `test-db-postgres` con TLS.
// =============================================================================

import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
type Tls = { cifrar: boolean; confiarCertificado: boolean }
type Con = { alias?: string; host: string; port: number; database?: string; sid?: string; tls?: unknown }
const postgres = req('./postgres.cjs') as {
  opcionesSsl(con: Con, cas: string[] | null): false | { rejectUnauthorized: boolean; ca?: string[] }
  errorAlConectar(err: unknown, con: Con): Error & { code?: string; cause?: unknown }
}
const oracle = req('./oracle.cjs') as {
  connectString(con: Con): string
  errorAlConectar(err: unknown, con: Con): Error & { code?: string }
}
const tlsComun = req('./tlsComun.cjs') as {
  tlsDe(con: unknown, porDefecto: Tls): Tls
  causaTls(err: unknown): unknown
  mensajeCertificado(servidor: string, err: unknown, admiteConfiar: boolean): string
  SIN_CIFRAR: Tls
}

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const base: Con = { alias: 'Nube', host: 'db.ejemplo.test', port: 5432, database: 'app' }
const verificar = { cifrar: true, confiarCertificado: false }
const confiar = { cifrar: true, confiarCertificado: true }

hr('(1) PostgreSQL: la opción ssl de pg')
check('(1a) sin cifrado guardado (conexión vieja): ssl false', postgres.opcionesSsl(base, ['CA']) === false, j(postgres.opcionesSsl(base, ['CA'])))
check('(1b) NEGATIVO: sin cifrar explícito, tampoco', postgres.opcionesSsl({ ...base, tls: { cifrar: false, confiarCertificado: true } }, ['CA']) === false, '')
check(
  '(1c) verificando: rechaza lo no autorizado y lleva las CA (paquete + sistema)',
  j(postgres.opcionesSsl({ ...base, tls: verificar }, ['CA1', 'CA2'])) === j({ rejectUnauthorized: true, ca: ['CA1', 'CA2'] }),
  j(postgres.opcionesSsl({ ...base, tls: verificar }, ['CA1', 'CA2']))
)
check('(1d) verificando sin CA legibles: las de Node', j(postgres.opcionesSsl({ ...base, tls: verificar }, null)) === j({ rejectUnauthorized: true }), '')
check('(1e) confiando: cifra sin verificar y sin CA', j(postgres.opcionesSsl({ ...base, tls: confiar }, ['CA'])) === j({ rejectUnauthorized: false }), '')
check('(1f) NEGATIVO: un cifrado con otra forma cae al de fábrica (sin cifrar)', postgres.opcionesSsl({ ...base, tls: { cifrar: 'si' } }, ['CA']) === false, '')

hr('(2) PostgreSQL: errores de conectar con su remedio')
{
  const cert = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  const e1 = postgres.errorAlConectar(cert, base)
  check(
    '(2a) certificado: lo dice, con servidor, y ofrece la casilla de confiar',
    e1.code === 'TESSERA-PG-CERTIFICADO' && e1.message.includes('db.ejemplo.test:5432') && e1.message.includes('«Confiar en el certificado del servidor»') && e1.cause === cert,
    e1.message
  )
  const e2 = postgres.errorAlConectar(new Error('The server does not support SSL connections'), base)
  check('(2b) servidor sin SSL: desmarcar «Cifrar la conexión»', e2.code === 'TESSERA-PG-SIN-SSL' && e2.message.includes('Desmarca'), e2.message)
  const e3 = postgres.errorAlConectar(new Error('no pg_hba.conf entry for host "10.0.0.1", user "u", database "app", no encryption'), base)
  check('(2c) servidor que exige SSL: marcar «Cifrar la conexión»', e3.code === 'TESSERA-PG-EXIGE-SSL' && e3.message.includes('Marca'), e3.message)
  const otro = new Error('password authentication failed for user "u"')
  check('(2d) NEGATIVO: otro error sale tal cual', postgres.errorAlConectar(otro, base) === otro, '')
}

hr('(3) Oracle: el descriptor de conexión')
{
  const ora: Con = { alias: 'Ora', host: 'ora.ejemplo.test', port: 1521, database: 'FREEPDB1' }
  check('(3a) sin cifrar, por servicio: Easy Connect de siempre', oracle.connectString(ora) === 'ora.ejemplo.test:1521/FREEPDB1', oracle.connectString(ora))
  check('(3b) cifrando, por servicio: tcps://', oracle.connectString({ ...ora, port: 2484, tls: verificar }) === 'tcps://ora.ejemplo.test:2484/FREEPDB1', oracle.connectString({ ...ora, port: 2484, tls: verificar }))
  const sid = { alias: 'Ora', host: 'h', port: 1521, sid: 'XE' }
  check('(3c) sin cifrar, por SID: PROTOCOL=TCP', oracle.connectString(sid).includes('(PROTOCOL=TCP)'), oracle.connectString(sid))
  check('(3d) cifrando, por SID: PROTOCOL=TCPS', oracle.connectString({ ...sid, tls: verificar }).includes('(PROTOCOL=TCPS)'), oracle.connectString({ ...sid, tls: verificar }))
  // Los dos NJS-506 reales de oracledb 6.10: el detalle va en la segunda línea, sin `cause`.
  const autofirmado = new Error(
    'NJS-506: connection to host 127.0.0.1 port 2484 encountered TLS handshake failure. (CONNECTION_ID=x)\nself signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'
  )
  const e1 = oracle.errorAlConectar(autofirmado, { ...ora, port: 2484 })
  check(
    '(3e) certificado autofirmado: la causa limpia (sin el NJS- ni la coletilla de Node) y sin la casilla de confiar',
    e1.code === 'TESSERA-ORA-CERTIFICADO' && e1.message.includes('(self signed certificate)') && !e1.message.includes('--use-system-ca') && !e1.message.includes('«Confiar'),
    e1.message
  )
  const puertoTcp = new Error('NJS-506: connection to host 127.0.0.1 port 1521 encountered TLS handshake failure. (CONNECTION_ID=y)\nClient network socket disconnected before secure TLS connection was established')
  const e2 = oracle.errorAlConectar(puertoTcp, ora)
  check('(3f) cifrando contra el puerto TCP: nombra el puerto TCPS y la casilla', e2.code === 'TESSERA-ORA-SIN-TCPS' && e2.message.includes('2484') && e2.message.includes('«Cifrar la conexión (TCPS)»'), e2.message)
  const credenciales = new Error('ORA-01017: invalid credential or not authorized; logon denied')
  check('(3g) NEGATIVO: otro error sale tal cual', oracle.errorAlConectar(credenciales, ora) === credenciales, '')
}

hr('(4) Lo común')
{
  check('(4a) tlsDe: el guardado, en orden fijo', j(tlsComun.tlsDe({ tls: { confiarCertificado: true, cifrar: true } }, tlsComun.SIN_CIFRAR)) === j(confiar), '')
  check('(4b) tlsDe: sin él, el de fábrica (copia, no el mismo objeto)', j(tlsComun.tlsDe({}, tlsComun.SIN_CIFRAR)) === j(tlsComun.SIN_CIFRAR) && tlsComun.tlsDe({}, tlsComun.SIN_CIFRAR) !== tlsComun.SIN_CIFRAR, '')
  const envuelto = Object.assign(new Error('NJS-505'), { cause: new Error('server certificate unauthorized') })
  check('(4c) causaTls: el «unauthorized» de oracledb, en la causa', tlsComun.causaTls(envuelto) !== null, '')
  check('(4d) NEGATIVO: un error de credenciales no es de certificado', tlsComun.causaTls(new Error('ORA-01017: invalid username/password')) === null, '')
  const sinConfiar = tlsComun.mensajeCertificado('h:2484', new Error('x'), false)
  check('(4e) el mensaje sin la casilla de confiar (Oracle) remite a instalar la CA', !sinConfiar.includes('«Confiar') && sinConfiar.includes('autoridad de certificación'), sinConfiar)
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
