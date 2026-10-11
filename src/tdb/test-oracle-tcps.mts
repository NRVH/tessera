#!/usr/bin/env node
// =============================================================================
// Cifrado de Oracle (TCPS) contra un servidor de verdad: el puerto TCP con el cifrado marcado,
// el certificado sin su CA, la conexión cifrada y el proceso que ya cargó el Instant Client. Lo
// corre `scripts/pruebas/oracle.sh tcps <11|21>` con TESSERA_TEST_ORACLE y
// TESSERA_TEST_ORACLE_VERSION; TESSERA_TEST_ORACLE_TCPS (puerto) y TESSERA_TEST_ORACLE_CA
// (certificado del servidor) añaden lo de TCPS. Con TESSERA_TEST_ORACLE_DRIVERS solo prueba el
// proceso en thick.
// Decisiones: docs/decisiones/bd/conexiones-cifrado.md
// =============================================================================

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'

const req = createRequire(import.meta.url)
type Con = Record<string, unknown>
type Abierta = { conexion: { execute(sql: string): Promise<{ rows: Array<Record<string, string>> }> }; modo: string; cerrar(): Promise<void> }
const oracle = req('./oracle.cjs') as { abrir(con: Con, secreto: string, ctx: unknown): Promise<Abierta> }
const oracledb = req('oracledb') as { thin: boolean; initOracleClient(o: { libDir: string }): void }

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      -> ${evidence}`)
}

const spec = process.env.TESSERA_TEST_ORACLE ?? ''
const version = process.env.TESSERA_TEST_ORACLE_VERSION ?? ''
const puertoTcps = Number(process.env.TESSERA_TEST_ORACLE_TCPS ?? '')
const rutaCa = process.env.TESSERA_TEST_ORACLE_CA ?? ''
const dirDrivers = (process.env.TESSERA_TEST_ORACLE_DRIVERS ?? '').trim()
const m = /^([^/]+)\/(.+)@([^:]+):(\d+)\/(.+)$/.exec(spec)
if (!m || !['11', '21'].includes(version)) {
  console.log('SALTA: faltan TESSERA_TEST_ORACLE o TESSERA_TEST_ORACLE_VERSION (ver scripts/pruebas/oracle.sh tcps).')
  process.exit(0)
}
const [, usuario, clave, , puertoTcp, servicio] = m
const es11 = version === '11'
const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-ora-tcps-'))
const ctx = { usuarioWindows: 'prueba', packs: [], externos: {}, driversDir: tmp }
const cifrado = { cifrar: true, confiarCertificado: false }
// El certificado de prueba es de CN=localhost: el cliente compara el nombre del servidor.
const base: Con = { alias: `TCPS ${version}`, host: 'localhost', database: servicio, user: usuario, readonly: true }
const tcps: Con = { ...base, port: puertoTcps, tls: cifrado }

async function intentar(con: Con): Promise<{ abierta?: Abierta; error?: Error & { code?: string } }> {
  try {
    return { abierta: await oracle.abrir(con, clave, ctx) }
  } catch (e) {
    return { error: e as Error & { code?: string } }
  }
}
const resumen = (r: { abierta?: Abierta; error?: Error & { code?: string } }): string =>
  r.abierta ? `conectó (${r.abierta.modo})` : `${r.error?.code ?? '(sin código)'}: ${r.error?.message ?? ''}`

async function main(): Promise<void> {
  // oracledb no pasa a thick tras una conexión thin (NJS-118): lo de thick va en otro proceso.
  if (dirDrivers) return probarThick()
  hr(`(1) Oracle ${version}, proceso en thin`)
  const r1 = await intentar({ ...base, port: Number(puertoTcp), tls: cifrado })
  check('(1a) cifrando contra el puerto TCP: lo dice y nombra el puerto TCPS', r1.error?.code === 'TESSERA-ORA-SIN-TCPS' && r1.error.message.includes('2484'), resumen(r1))

  if (!Number.isInteger(puertoTcps) || puertoTcps <= 0 || !rutaCa) {
    console.log('\nSALTA (1b-1c): sin TESSERA_TEST_ORACLE_TCPS y TESSERA_TEST_ORACLE_CA no hay listener TCPS que probar.')
    return probarThick()
  }
  const r2 = await intentar(tcps)
  check(
    '(1b) TCPS sin la CA del servidor: certificado no verificado, sin ofrecer confiar',
    r2.error?.code === 'TESSERA-ORA-CERTIFICADO' && !r2.error.message.includes('«Confiar'),
    resumen(r2)
  )

  // Como si el usuario instalara la CA en el sistema: `oracle.cjs` ya fijó las suyas en (1a).
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(rutaCa, 'utf8')])
  const r3 = await intentar(tcps)
  if (es11) {
    check(
      '(1c) 11.2 con la CA: el saludo TLS pasa y se avisa de que esta base no se cifra',
      r3.error?.code === 'TESSERA-ORA-CIFRADO-THICK' && r3.error.message.includes('«Cifrar la conexión (TCPS)»'),
      resumen(r3)
    )
    check('(1d) y no se escaló a thick por ello', oracledb.thin, `thin=${oracledb.thin}`)
  } else {
    let protocolo = ''
    if (r3.abierta) {
      const q = await r3.abierta.conexion.execute("SELECT SYS_CONTEXT('USERENV','NETWORK_PROTOCOL') AS P FROM DUAL")
      protocolo = String(q.rows[0]?.P ?? '')
      await r3.abierta.cerrar()
    }
    check('(1c) 21 con la CA: conecta en thin y la sesión va por TCPS', r3.abierta?.modo === 'thin' && protocolo.toLowerCase() === 'tcps', `${resumen(r3)}, protocolo=${protocolo}`)
  }
  return probarThick()
}

async function probarThick(): Promise<void> {
  if (!dirDrivers) {
    console.log('\nSALTA (2): el proceso en thick se prueba en otra corrida, con TESSERA_TEST_ORACLE_DRIVERS.')
    return
  }
  hr('(2) El proceso ya cargó el Instant Client')
  oracledb.initOracleClient({ libDir: dirDrivers })
  const r4 = await intentar({ ...base, port: Number(puertoTcp) })
  check('(2a) sin cifrar sigue conectando, en thick', r4.abierta?.modo === 'thick', resumen(r4))
  if (r4.abierta) await r4.abierta.cerrar()
  const r5 = await intentar({ ...base, port: Number.isInteger(puertoTcps) && puertoTcps > 0 ? puertoTcps : Number(puertoTcp), tls: cifrado })
  check('(2b) cifrando: se avisa sin intentar conectar', r5.error?.code === 'TESSERA-ORA-CIFRADO-THICK', resumen(r5))
}

main()
  .catch((e) => check('sin excepciones', false, String(e?.stack ?? e)))
  .finally(() => {
    rmSync(tmp, { recursive: true, force: true })
    const total = passed + failed
    hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
    process.exit(failed === 0 ? 0 : 1)
  })
