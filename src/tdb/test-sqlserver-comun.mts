#!/usr/bin/env node
// =============================================================================
// Prueba de `sqlserverComun.cjs` y sus piezas (`exactosSqlserver`, `celdasSqlserver`): la configuración
// de tedious, los errores, los valores exactos y las celdas. Corre con el binario de Electron si está
// (`ELECTRON_RUN_AS_NODE=1`). La parte contra servidor solo con `TESSERA_TEST_MSSQL`
// (`usuario/clave@host:puerto/base`, con `pruebas-mssql`); sin ella se salta y lo demás corre siempre.
// Fija la paridad con shared y la versión fijada de tedious, `opcionesConexion`, `normalizarError`,
// `textoExacto` desde bytes, tipos y celdas, y contra el servidor los tipos exactos que tedious redondea.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-conexion-y-exactos.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTENTICACIONES, pideDominio as pideDominioShared } from '../shared/motores/autenticacion.ts'

const require_ = createRequire(import.meta.url)

// --- Relanzarse con Electron (si está) -------------------------------------------------------
if (!process.versions.electron && process.env.TESSERA_TEST_SIN_ELECTRON !== '1') {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (electron && existsSync(electron)) {
    const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    process.exit(r.status ?? 1)
  }
  console.log('(sin el binario de Electron: se prueba con el Node que lo lanza)')
}

// --- Molde ------------------------------------------------------------------------------
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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? `${(e as { codigo?: string }).codigo ?? ''} ${e.message}` : String(e)
  }
}

const aqui = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(aqui, '..', '..')
const comun: any = require_('./sqlserverComun.cjs')
const celdas: any = require_('./celdas.cjs')

const CON = { host: 'srv.lan', port: 1433, user: 'ana', database: 'ventas' }
const TOPES = celdas.topesDe({})

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) Paridad con shared y la versión de tedious fijada')
  check('AUTENTICACIONES = las de shared, en su orden', j(comun.AUTENTICACIONES) === j(AUTENTICACIONES), j(comun.AUTENTICACIONES))
  check(
    'pideDominio = el de shared para cada autenticación',
    AUTENTICACIONES.every((a) => comun.pideDominio(a) === pideDominioShared(a)),
    ''
  )
  check('pideDominio con una desconocida LANZA (switch con nunca)', lanza(() => comun.pideDominio('kerberos')) !== null, '')
  const pkg = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))
  const instalada = JSON.parse(readFileSync(path.join(path.dirname(require_.resolve('tedious/package.json')), 'package.json'), 'utf8')).version
  check(
    'tedious FIJADO: package.json (sin ^/~), la instalada y VERSION_TEDIOUS coinciden',
    pkg.dependencies.tedious === comun.VERSION_TEDIOUS && instalada === comun.VERSION_TEDIOUS,
    `package.json ${pkg.dependencies.tedious} · instalada ${instalada} · código ${comun.VERSION_TEDIOUS}`
  )

  // -------------------------------------------------------------------------
  hr('(2) opcionesConexion (pura)')
  const cas = ['CA1', 'CA2']
  const sql = comun.opcionesConexion(CON, 'clave', { cas })
  check('servidor = host', sql.server === 'srv.lan', sql.server)
  check("autenticación por defecto = 'sql' (type default, usuario y clave)", j(sql.authentication) === j({ type: 'default', options: { userName: 'ana', password: 'clave' } }), j(sql.authentication))
  check('puerto numérico y base', sql.options.port === 1433 && sql.options.database === 'ventas' && sql.options.instanceName === undefined, j(sql.options))
  check(
    'cifrado por defecto: cifrar y VERIFICAR, con las CA del sistema',
    sql.options.encrypt === true && sql.options.trustServerCertificate === false && j(sql.options.cryptoCredentialsDetails) === j({ ca: cas }),
    j(sql.options)
  )
  check('sin tope de petición por defecto (el de tedious, 15 s, mata consultas largas)', sql.options.requestTimeout === 0, String(sql.options.requestTimeout))
  check(
    'idioma Español, dateFormat ymd, abortTransactionOnError false, filas en array y en flujo',
    sql.options.language === 'Español' &&
      sql.options.dateFormat === 'ymd' &&
      sql.options.abortTransactionOnError === false &&
      sql.options.useColumnNames === false &&
      sql.options.rowCollectionOnRequestCompletion === false &&
      sql.options.appName === 'Tessera',
    j(sql.options)
  )
  check('connectTimeout 15 s y cancelTimeout 5 s', sql.options.connectTimeout === 15000 && sql.options.cancelTimeout === 5000, j(sql.options))
  const conTope = comun.opcionesConexion(CON, 'x', { requestTimeoutMs: 30000, textsize: 131074 })
  check('requestTimeoutMs y textsize cuando se piden', conTope.options.requestTimeout === 30000 && conTope.options.textsize === 131074, j(conTope.options))
  const ntlm = comun.opcionesConexion({ ...CON, autenticacion: 'ntlm', dominio: ' DOMINIO ' }, 'clave', {})
  check(
    'NTLM: type ntlm con el dominio (recortado)',
    j(ntlm.authentication) === j({ type: 'ntlm', options: { userName: 'ana', password: 'clave', domain: 'DOMINIO' } }),
    j(ntlm.authentication)
  )
  const sinDominio = lanza(() => comun.opcionesConexion({ ...CON, autenticacion: 'ntlm', dominio: '  ' }, 'c', {}))
  check('NTLM sin dominio NO se construye (TESSERA-MSSQL-CONFIG)', sinDominio !== null && sinDominio.includes('TESSERA-MSSQL-CONFIG'), String(sinDominio))
  const rara = lanza(() => comun.opcionesConexion({ ...CON, autenticacion: 'kerberos' }, 'c', {}))
  check('una autenticación desconocida NO se construye (no manda la clave como otra cuenta)', rara !== null && rara.includes('TESSERA-MSSQL-CONFIG') && rara.includes('kerberos'), String(rara))
  const sinHost = lanza(() => comun.opcionesConexion({ ...CON, host: ' ' }, 'c', {}))
  check('sin servidor NO se construye', sinHost !== null && sinHost.includes('TESSERA-MSSQL-CONFIG'), String(sinHost))
  const inst = comun.opcionesConexion({ ...CON, instancia: ' SQLEXPRESS ' }, 'c', {})
  check('instancia: instanceName y SIN puerto (tedious no admite los dos)', inst.options.instanceName === 'SQLEXPRESS' && inst.options.port === undefined, j(inst.options))
  const sinBase = comun.opcionesConexion({ ...CON, database: '' }, 'c', {})
  check('sin base: no se pasa (la de por defecto del login)', !('database' in sinBase.options), j(sinBase.options))
  const confiar = comun.opcionesConexion({ ...CON, tls: { cifrar: true, confiarCertificado: true } }, 'c', { cas })
  check('«Confiar en el certificado»: trustServerCertificate y sin CA', confiar.options.trustServerCertificate === true && confiar.options.cryptoCredentialsDetails === undefined, j(confiar.options))
  const sinCifrar = comun.opcionesConexion({ ...CON, tls: { cifrar: false, confiarCertificado: false } }, 'c', { cas })
  check('sin cifrar: encrypt false y sin CA', sinCifrar.options.encrypt === false && sinCifrar.options.cryptoCredentialsDetails === undefined, j(sinCifrar.options))
  const tlsRoto = comun.opcionesConexion({ ...CON, tls: { cifrar: 'si' } }, 'c', {})
  check('un tls mal formado cae al de por defecto (cifrar y verificar), no a «confiar»', tlsRoto.options.encrypt === true && tlsRoto.options.trustServerCertificate === false, j(tlsRoto.options))

  // -------------------------------------------------------------------------
  hr('(3) certificadosDeConfianza')
  const falso = { getCACertificates: (t: string) => (t === 'bundled' ? ['A', 'B'] : t === 'system' ? ['B', 'C'] : []) }
  check('paquete + sistema, sin repetir', j(comun.certificadosDeConfianza(falso)) === j(['A', 'B', 'C']), j(comun.certificadosDeConfianza(falso)))
  check('sin la API: null (tedious usa las de Node)', comun.certificadosDeConfianza({}) === null, '')
  const reales = comun.certificadosDeConfianza()
  check(`este runtime lee las CA del sistema (${process.version})`, Array.isArray(reales) && reales.length > 0, `${Array.isArray(reales) ? reales.length : reales} CA`)

  // -------------------------------------------------------------------------
  hr('(4) sqlInicioSesion')
  check('meta: READ UNCOMMITTED y LOCK_TIMEOUT 10000', comun.sqlInicioSesion('meta') === 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 10000', comun.sqlInicioSesion('meta'))
  check('datos y cli: LOCK_TIMEOUT 10000', comun.sqlInicioSesion('datos') === 'SET LOCK_TIMEOUT 10000' && comun.sqlInicioSesion('cli') === 'SET LOCK_TIMEOUT 10000', '')
  check('consola y exportar: nada (las detiene Stop)', comun.sqlInicioSesion('consola') === '' && comun.sqlInicioSesion('exportar') === '', '')
  check('un propósito desconocido LANZA', lanza(() => comun.sqlInicioSesion('otro')) !== null, '')

  // -------------------------------------------------------------------------
  hr('(5) normalizarError (errores fabricados)')
  const req = (numero: number, mensaje: string, extra: Record<string, unknown> = {}): Error =>
    Object.assign(new Error(mensaje), { code: 'EREQUEST', number: numero, class: 16, lineNumber: 3, ...extra })
  const e208 = comun.normalizarError(req(208, "El nombre de objeto 'dbo.x' no es válido.", { procName: '' }))
  check('número como código, línea, sin objeto vacío, clase servidor', j(e208) === j({ mensaje: "El nombre de objeto 'dbo.x' no es válido.", clase: 'servidor', codigo: '208', linea: 3 }), j(e208))
  const enProc = comun.normalizarError(req(8134, 'División entre cero.', { procName: 'dbo.p_err', lineNumber: 7 }))
  check('dentro de un procedimiento: objeto = procName', enProc.objeto === 'dbo.p_err' && enProc.linea === 7, j(enProc))
  const agregado = Object.assign(new Error(''), { errors: [req(207, "El nombre de columna 'a' no es válido."), req(207, "El nombre de columna 'b' no es válido.", { lineNumber: 4 })] })
  const ag = comun.normalizarError(agregado)
  check(
    'AggregateError (mensaje vacío): manda el primero y el resto va a detalle',
    ag.mensaje.includes("'a'") && ag.codigo === '207' && ag.detalle === "Error 207, línea 4: El nombre de columna 'b' no es válido.",
    j(ag)
  )
  check('ECANCEL → cancelada', comun.normalizarError(Object.assign(new Error('Canceled.'), { code: 'ECANCEL' })).clase === 'cancelada', '')
  check('ETIMEOUT de la petición → timeout', comun.normalizarError(Object.assign(new Error('Timeout: Request failed to complete in 15000ms'), { code: 'ETIMEOUT' })).clase === 'timeout', '')
  check('ESOCKET → perdida', comun.normalizarError(Object.assign(new Error('Connection lost - read ECONNRESET'), { code: 'ESOCKET' })).clase === 'perdida', '')
  check('EINVALIDSTATE → perdida', comun.esPerdida(Object.assign(new Error('Requests can only be made in the LoggedIn state, not the Final state'), { code: 'EINVALIDSTATE' })), '')
  check('severidad ≥ 20 (596 de un KILL) → perdida', comun.normalizarError(req(596, 'No se puede continuar la ejecución…', { class: 21 })).clase === 'perdida', '')
  check('severidad 16 → NO es pérdida', !comun.esPerdida(req(2627, 'clave duplicada')), '')
  const cert = comun.normalizarError(
    Object.assign(new Error('Failed to connect to 127.0.0.1:14333 - self-signed certificate'), {
      code: 'ESOCKET',
      cause: Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    }),
    { host: '127.0.0.1', port: 14333 }
  )
  check(
    'certificado autofirmado → TESSERA-MSSQL-CERTIFICADO, que propone la casilla',
    cert.codigo === 'TESSERA-MSSQL-CERTIFICADO' && cert.mensaje.includes('Confiar en el certificado del servidor') && cert.mensaje.includes('127.0.0.1:14333'),
    j(cert)
  )
  const inst2 = comun.normalizarError(Object.assign(new Error('Failed to connect to srv\\SQLEXPRESS in 15000ms'), { code: 'ETIMEOUT' }), { host: 'srv', port: 1433, instancia: 'SQLEXPRESS' })
  check('instancia sin SQL Browser → TESSERA-MSSQL-INSTANCIA (UDP 1434 o el puerto)', inst2.codigo === 'TESSERA-MSSQL-INSTANCIA' && inst2.mensaje.includes('UDP 1434'), j(inst2))
  const busq = comun.normalizarError(Object.assign(new Error('Port for SQLEXPRESS not found in srv'), { code: 'EINSTLOOKUP' }), { host: 'srv', port: 1433, instancia: 'SQLEXPRESS' })
  check('EINSTLOOKUP → TESSERA-MSSQL-INSTANCIA', busq.codigo === 'TESSERA-MSSQL-INSTANCIA', j(busq))
  const rech = comun.normalizarError(Object.assign(new Error('Failed to connect to h:1 - connect ECONNREFUSED 127.0.0.1:1'), { code: 'ESOCKET' }), { host: 'h', port: 1 })
  check('conexión rechazada → TESSERA-MSSQL-RECHAZADA con host:puerto', rech.codigo === 'TESSERA-MSSQL-RECHAZADA' && rech.mensaje.startsWith('h:1 '), j(rech))
  const sinResp = comun.normalizarError(Object.assign(new Error('Failed to connect to h:1433 in 15000ms'), { code: 'ETIMEOUT' }), { host: 'h', port: 1433 })
  check('sin respuesta al conectar → TESSERA-MSSQL-SIN-RESPUESTA (timeout)', sinResp.codigo === 'TESSERA-MSSQL-SIN-RESPUESTA' && sinResp.clase === 'timeout', j(sinResp))
  const propio = comun.normalizarError(comun.errorSqlServer('CONFIG', 'x'))
  check('los TESSERA-… pasan con su código', propio.codigo === 'TESSERA-MSSQL-CONFIG' && propio.mensaje === 'x', j(propio))

  // -------------------------------------------------------------------------
  hr('(6) textoExacto desde los bytes')
  const meta = (name: string, extra: Record<string, unknown> = {}): unknown => ({ type: { name }, ...extra })
  const decimal = (valor: bigint, escala: number, precision = 38): string => {
    const neg = valor < 0n
    let m = neg ? -valor : valor
    const bytes = [neg ? 0 : 1]
    for (let i = 0; i < 16; i++) {
      bytes.push(Number(m & 0xffn))
      m >>= 8n
    }
    return comun.textoExacto(Buffer.from([17, ...bytes]), 0, meta('DecimalN', { precision, scale: escala }))
  }
  check('decimal(38,12) de 38 dígitos, exacto', decimal(12345678901234567890123456123456789012n, 12) === '12345678901234567890123456.123456789012', decimal(12345678901234567890123456123456789012n, 12))
  check('decimal negativo con ceros tras la coma', decimal(-5n, 3) === '-0.005', decimal(-5n, 3))
  check('decimal sin escala', decimal(9007199254740993n, 0) === '9007199254740993', decimal(9007199254740993n, 0))
  const money = (v: bigint): Buffer => {
    const b = Buffer.alloc(9)
    b[0] = 8
    b.writeInt32LE(Number(v >> 32n), 1)
    b.writeUInt32LE(Number(v & 0xffffffffn), 5)
    return b
  }
  check('money máximo exacto (922337203685477.5807)', comun.textoExacto(money(9223372036854775807n), 0, meta('MoneyN')) === '922337203685477.5807', comun.textoExacto(money(9223372036854775807n), 0, meta('MoneyN')))
  check('money mínimo exacto', comun.textoExacto(money(-9223372036854775808n), 0, meta('MoneyN')) === '-922337203685477.5808', comun.textoExacto(money(-9223372036854775808n), 0, meta('MoneyN')))
  const sm = Buffer.alloc(4)
  sm.writeInt32LE(-12345)
  check('smallmoney (fijo, 4 bytes) exacto', comun.textoExacto(sm, 0, meta('SmallMoney')) === '-1.2345', comun.textoExacto(sm, 0, meta('SmallMoney')))
  const hora = (unidades: bigint, n: number): number[] => Array.from({ length: n }, (_, i) => Number((unidades >> BigInt(8 * i)) & 0xffn))
  const t7 = BigInt(86399) * 10000000n + 9999999n
  check('time(7) 23:59:59.9999999', comun.textoExacto(Buffer.from([5, ...hora(t7, 5)]), 0, meta('Time', { scale: 7 })) === '23:59:59.9999999', comun.textoExacto(Buffer.from([5, ...hora(t7, 5)]), 0, meta('Time', { scale: 7 })))
  check('time(0) 00:00:01', comun.textoExacto(Buffer.from([3, ...hora(1n, 3)]), 0, meta('Time', { scale: 0 })) === '00:00:01', '')
  const dias = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
  check('date 0001-01-01 (0 días)', comun.textoExacto(Buffer.from([3, ...dias(0)]), 0, meta('Date')) === '0001-01-01', comun.textoExacto(Buffer.from([3, ...dias(0)]), 0, meta('Date')))
  check('date 9999-12-31 (3 652 058 días)', comun.textoExacto(Buffer.from([3, ...dias(3652058)]), 0, meta('Date')) === '9999-12-31', comun.textoExacto(Buffer.from([3, ...dias(3652058)]), 0, meta('Date')))
  // 2026-09-26 = día 739884 desde 0001-01-01.
  const dia = 739884
  const d2 = Buffer.from([7, ...hora(BigInt(13 * 3600 + 45 * 60 + 30) * 1000n + 123n, 4), ...dias(dia)])
  check('datetime2(3) 2026-09-26 13:45:30.123', comun.textoExacto(d2, 0, meta('DateTime2', { scale: 3 })) === '2026-09-26 13:45:30.123', comun.textoExacto(d2, 0, meta('DateTime2', { scale: 3 })))
  // datetimeoffset(7): 19:45:30.1234567 UTC con -360 min → 13:45:30.1234567 -06:00.
  const off = Buffer.alloc(2)
  off.writeInt16LE(-360)
  const dto = Buffer.from([10, ...hora(BigInt(19 * 3600 + 45 * 60 + 30) * 10000000n + 1234567n, 5), ...dias(dia), ...off])
  check(
    'datetimeoffset(7): la hora LOCAL con su desplazamiento, como la escribe SQL Server',
    comun.textoExacto(dto, 0, meta('DateTimeOffset', { scale: 7 })) === '2026-09-26 13:45:30.1234567 -06:00',
    comun.textoExacto(dto, 0, meta('DateTimeOffset', { scale: 7 }))
  )
  const dtoDia = Buffer.from([10, ...hora(BigInt(2 * 3600) * 10000000n, 5), ...dias(dia), ...Buffer.from([0x68, 0x01])])
  check('datetimeoffset que cambia de día al pasar a local (+06:00)', comun.textoExacto(dtoDia, 0, meta('DateTimeOffset', { scale: 7 })) === '2026-09-26 08:00:00.0000000 +06:00', comun.textoExacto(dtoDia, 0, meta('DateTimeOffset', { scale: 7 })))
  check('un tipo que no se toca → undefined', comun.textoExacto(Buffer.from([1]), 0, meta('Int')) === undefined, '')

  // -------------------------------------------------------------------------
  hr('(7) Tipos, columnas y celdas')
  const tipos: Array<[unknown, string, string]> = [
    [meta('NVarChar', { dataLength: 100 }), 'nvarchar(50)', 'texto'],
    [meta('NVarChar', { dataLength: 65535 }), 'nvarchar(max)', 'texto'],
    [meta('VarChar', { dataLength: 20 }), 'varchar(20)', 'texto'],
    [meta('VarBinary', { dataLength: 65535 }), 'varbinary(max)', 'binario'],
    [meta('DecimalN', { precision: 38, scale: 12 }), 'decimal(38,12)', 'numero'],
    [meta('NumericN', { precision: 10, scale: 0 }), 'numeric(10,0)', 'numero'],
    [meta('IntN', { dataLength: 8 }), 'bigint', 'numero'],
    [meta('MoneyN', { dataLength: 4 }), 'smallmoney', 'numero'],
    [meta('FloatN', { dataLength: 4 }), 'real', 'numero'],
    [meta('BitN'), 'bit', 'booleano'],
    [meta('DateTime2', { scale: 7 }), 'datetime2(7)', 'fechaHora'],
    [meta('DateTimeN', { dataLength: 4 }), 'smalldatetime', 'fechaHora'],
    [meta('Date'), 'date', 'fecha'],
    [meta('Time', { scale: 3 }), 'time(3)', 'texto'],
    [meta('UniqueIdentifier'), 'uniqueidentifier', 'texto'],
    [meta('UDT', { udtInfo: { typeName: 'hierarchyid' } }), 'hierarchyid', 'binario'],
    [meta('Variant'), 'sql_variant', 'otro']
  ]
  for (const [m, motor, logico] of tipos) {
    check(`tipo ${motor} (${logico})`, comun.tipoMotorSqlServer(m) === motor && comun.tipoLogicoSqlServer(m) === logico, `${comun.tipoMotorSqlServer(m)} / ${comun.tipoLogicoSqlServer(m)}`)
  }
  const cols = comun.columnasSqlServer([
    { colName: 'b', type: { name: 'Int' }, flags: 1 },
    { colName: 'b', type: { name: 'NVarChar' }, dataLength: 20, flags: 0 },
    { colName: '', type: { name: 'BitN' }, flags: 9 }
  ])
  check(
    'columnas: nombres repetidos y vacíos conviven, nullable del bit 0 de flags',
    j(cols) ===
      j([
        { nombre: 'b', tipoLogico: 'numero', tipoMotor: 'int', nullable: true },
        { nombre: 'b', tipoLogico: 'texto', tipoMotor: 'nvarchar(10)', nullable: false },
        { nombre: '', tipoLogico: 'booleano', tipoMotor: 'bit', nullable: true }
      ]),
    j(cols)
  )
  const topesChicos = celdas.topesDe({ topeCelda: 4 })
  const largoTexto = comun.celdaSqlServer('ñandúes', meta('NVarChar', { dataLength: 100 }), topesChicos)
  check('texto recortado al tope, con su longitud original', largoTexto.valor === 'ñand' && largoTexto.original === 7, j(largoTexto))
  const bin = comun.celdaSqlServer(Buffer.from([1, 2, 255, 4, 5]), meta('VarBinary', { dataLength: 10 }), topesChicos)
  check('binario 0x… recortado (mitad del tope) con los bytes originales', bin.valor === '0x0102' && bin.original === 5, j(bin))
  check('bit como booleano', comun.celdaSqlServer(true, meta('BitN'), TOPES).valor === true, '')
  check('int como texto', comun.celdaSqlServer(42, meta('Int'), TOPES).valor === '42', '')
  check('bigint (llega como texto) tal cual', comun.celdaSqlServer('-9223372036854775808', meta('BigInt'), TOPES).valor === '-9223372036854775808', '')
  const dt = new Date(Date.UTC(2026, 8, 26, 13, 45, 30, 997))
  check('datetime (un Date en UTC) como la hora de pared con milisegundos', comun.celdaSqlServer(dt, meta('DateTimeN', { dataLength: 8 }), TOPES).valor === '2026-09-26 13:45:30.997', comun.celdaSqlServer(dt, meta('DateTimeN', { dataLength: 8 }), TOPES).valor)
  check('smalldatetime sin fracción', comun.celdaSqlServer(dt, meta('SmallDateTime'), TOPES).valor === '2026-09-26 13:45:30', '')
  check('NULL', comun.celdaSqlServer(null, meta('Int'), TOPES).valor === null, '')
  const catalogo = celdas.topesDe({ proposito: 'catalogo' })
  check('catálogo: sin recorte', comun.celdaSqlServer('x'.repeat(70000), meta('NVarChar', { dataLength: 65535 }), catalogo).valor.length === 70000, '')
  const fila = comun.filaSqlServer(
    [
      { value: 'ñandúes', metadata: meta('NVarChar', { dataLength: 100 }) },
      { value: null, metadata: meta('Int') }
    ],
    topesChicos
  )
  check('fila: celdas y recortes [columna, original]', j(fila) === j({ celdas: ['ñand', null], recortes: [[0, 7]] }), j(fila))

  // -------------------------------------------------------------------------
  hr('(8) Salida del servidor y destino de prueba')
  check('PRINT (clase 0) → línea sin aviso', j(comun.lineaDeInfo({ number: 0, class: 0, message: 'hola' })) === j({ texto: 'hola' }), '')
  check('RAISERROR nivel 10 → aviso', j(comun.lineaDeInfo({ number: 50000, class: 10, message: 'ojo' })) === j({ texto: 'ojo', aviso: true }), '')
  check('5701 (cambio de base) y 5703 (idioma) no son salida', comun.lineaDeInfo({ number: 5701, class: 0, message: 'x' }) === null && comun.lineaDeInfo({ number: 5703, message: 'x' }) === null, '')
  check(
    'destinoDePrueba',
    j(comun.destinoDePrueba('tessera/Ab#9@127.0.0.1:14333/pruebas')) === j({ user: 'tessera', secreto: 'Ab#9', host: '127.0.0.1', port: 14333, database: 'pruebas' }) &&
      comun.destinoDePrueba('sa/x@h:1')?.database === undefined &&
      comun.destinoDePrueba('malo') === null &&
      comun.destinoDePrueba(undefined) === null,
    j(comun.destinoDePrueba('tessera/Ab#9@127.0.0.1:14333/pruebas'))
  )

  // -------------------------------------------------------------------------
  hr('(9) Contra el servidor de pruebas (TESSERA_TEST_MSSQL)')
  const destino = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL)
  if (!destino) {
    console.log('SALTADA: sin TESSERA_TEST_MSSQL (usuario/clave@host:puerto/base). Ver correr-mssql.sh.')
  } else {
    await contraServidor(destino)
  }

  // -------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`FAIL  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  console.log(`\nVEREDICTO: ${passed}/${total} PASS${destino ? '' : ' (servidor: SALTADO)'}`)
  process.exit(allPass ? 0 : 1)
}

// --- Contra el servidor -----------------------------------------------------------------------

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}

interface Lote {
  error: unknown
  conjuntos: Array<{ columnas: unknown[]; filas: unknown[][] }>
  infos: Array<{ number: number; class: number; message: string }>
}

/** Un lote por `execSqlBatch`, con todos sus conjuntos ya convertidos a celdas. */
function lote(conexion: any, sqlTexto: string): Promise<Lote> {
  const { Request } = comun.cargarTedious() as any
  const conjuntos: Lote['conjuntos'] = []
  const infos: Lote['infos'] = []
  const alInfo = (m: { number: number; class: number; message: string }): void => {
    infos.push(m)
  }
  conexion.on('infoMessage', alInfo)
  return new Promise((resolve) => {
    const r = new Request(sqlTexto, (err: unknown) => {
      conexion.removeListener('infoMessage', alInfo)
      resolve({ error: err ?? null, conjuntos, infos })
    })
    let actual: Lote['conjuntos'][number] | null = null
    r.on('columnMetadata', (m: unknown[]) => {
      actual = { columnas: comun.columnasSqlServer(m), filas: [] }
      conjuntos.push(actual)
    })
    r.on('row', (cols: unknown[]) => {
      if (actual) actual.filas.push(comun.filaSqlServer(cols, TOPES).celdas)
    })
    conexion.execSqlBatch(r)
  })
}

async function contraServidor(d: Destino): Promise<void> {
  const con = { host: d.host, port: d.port, user: d.user, database: d.database }
  const cas = comun.certificadosDeConfianza()

  // El contenedor usa un certificado AUTOFIRMADO: verificando, falla con el mensaje que
  // propone la casilla; con ella, entra.
  let error: unknown = null
  try {
    const c = await comun.conectar(comun.opcionesConexion(con, d.secreto, { cas }))
    await comun.cerrar(c)
  } catch (e) {
    error = e
  }
  const n1 = error ? comun.normalizarError(error, con) : null
  check('verificando el certificado autofirmado del contenedor: TESSERA-MSSQL-CERTIFICADO', n1 !== null && n1.codigo === 'TESSERA-MSSQL-CERTIFICADO', j(n1))

  const confiar = { ...con, tls: { cifrar: true, confiarCertificado: true } }
  error = null
  try {
    const c = await comun.conectar(comun.opcionesConexion(confiar, d.secreto + 'MAL', {}))
    await comun.cerrar(c)
  } catch (e) {
    error = e
  }
  const n2 = error ? comun.normalizarError(error, confiar) : null
  check('clave mala: el 18456 del servidor como código', n2 !== null && n2.codigo === '18456', j(n2))

  const c = await comun.conectar(comun.opcionesConexion(confiar, d.secreto, {}))
  try {
    check('con «Confiar en el certificado» conecta; el parche de valores exactos está activo', comun.valoresExactos()?.activo === true, j(comun.valoresExactos()))

    const cero = await lote(c, 'SELECT 1/0')
    const nc = comun.normalizarError(cero.error)
    check('mensajes en ESPAÑOL (8134 «división entre cero»), con el número aparte', nc.codigo === '8134' && /divisi[oó]n/i.test(nc.mensaje), j(nc))

    const sintaxis = await lote(c, 'SELECT 1\nSELEC 2 FROM')
    const ns = comun.normalizarError(sintaxis.error)
    check('error de sintaxis: la línea del token (2), sin objeto', ns.linea === 2 && ns.objeto === undefined && (ns.codigo === '102' || ns.codigo === '156'), j(ns))

    const dos = await lote(c, 'SELECT noexiste1, noexiste2 FROM dbo.t')
    const nd = comun.normalizarError(dos.error)
    check('dos errores a la vez (207×2): manda el primero y el otro va a detalle', nd.codigo === '207' && typeof nd.detalle === 'string' && nd.detalle.includes('207'), j(nd))

    const inicio = await lote(c, comun.sqlInicioSesion('meta') + '; SELECT @@LOCK_TIMEOUT, (SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id = @@SPID)')
    const filaIni = inicio.conjuntos[0]?.filas[0]
    check('inicio de la meta: LOCK_TIMEOUT 10000 y READ UNCOMMITTED (nivel 1)', j(filaIni) === j(['10000', '1']), j(inicio.error ?? filaIni))

    const tiposSql = [
      "CAST('12345678901234567890123456.123456789012' AS decimal(38,12))",
      'CAST(922337203685477.5807 AS money)',
      'CAST(-214748.3648 AS smallmoney)',
      "CAST('2026-09-26 13:45:30.1234567' AS datetime2(7))",
      "CAST('2026-09-26 13:45:30.1234567 -06:00' AS datetimeoffset(7))",
      "CAST('23:59:59.9999999' AS time(7))",
      "CAST('0001-01-01' AS date)",
      "CAST('2026-09-26 13:45:30.997' AS datetime)",
      'CAST(9223372036854775807 AS bigint)',
      "CAST('6F9619FF-8B86-D011-B42D-00C04FC964FF' AS uniqueidentifier)",
      'CAST(0x0102FF AS varbinary(10))',
      'CAST(1 AS bit)',
      "N'Ñandú ✓'",
      'CAST(0.1 AS float)'
    ]
    const tiposR = await lote(c, 'SELECT ' + tiposSql.join(', '))
    const esperado = [
      '12345678901234567890123456.123456789012',
      '922337203685477.5807',
      '-214748.3648',
      '2026-09-26 13:45:30.1234567',
      '2026-09-26 13:45:30.1234567 -06:00',
      '23:59:59.9999999',
      '0001-01-01',
      '2026-09-26 13:45:30.997',
      '9223372036854775807',
      '6F9619FF-8B86-D011-B42D-00C04FC964FF',
      '0x0102FF',
      true,
      'Ñandú ✓',
      '0.1'
    ]
    const real = tiposR.conjuntos[0]?.filas[0] ?? []
    for (let i = 0; i < esperado.length; i++) {
      check(`tipo exacto ${tiposSql[i]} → ${j(esperado[i])}`, j(real[i]) === j(esperado[i]), `real ${j(real[i])} ${tiposR.error ? j(comun.normalizarError(tiposR.error)) : ''}`)
    }
    const colsR = (tiposR.conjuntos[0]?.columnas ?? []) as Array<{ tipoMotor: string }>
    check(
      'tipoMotor desde el servidor: decimal(38,12), money, datetime2(7), datetimeoffset(7), time(7), date',
      j(colsR.slice(0, 7).map((x) => x.tipoMotor)) === j(['decimal(38,12)', 'money', 'smallmoney', 'datetime2(7)', 'datetimeoffset(7)', 'time(7)', 'date']),
      j(colsR.map((x) => x.tipoMotor))
    )

    const varios = await lote(c, "SELECT 1 AS a; SELECT 'x' AS b, 'y' AS b; PRINT 'hola'")
    check('un lote con dos conjuntos, columnas repetidas, y el PRINT como salida', varios.conjuntos.length === 2 && varios.conjuntos[1].columnas.length === 2 && varios.infos.some((i) => comun.lineaDeInfo(i)?.texto === 'hola'), j({ n: varios.conjuntos.length, infos: varios.infos.map((i) => i.message) }))
  } finally {
    await comun.cerrar(c)
  }

  const lector = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL_LECTOR)
  if (lector) {
    const cl = await comun.conectar(comun.opcionesConexion({ host: lector.host, port: lector.port, user: lector.user, database: lector.database, tls: { cifrar: true, confiarCertificado: true } }, lector.secreto, {}))
    try {
      const w = await lote(cl, 'INSERT INTO dbo.t VALUES (99, N\'no\')')
      const nw = comun.normalizarError(w.error)
      check('el usuario con solo db_datareader: el SERVIDOR rechaza el INSERT (229)', nw.codigo === '229', j(nw))
    } finally {
      await comun.cerrar(cl)
    }
  } else {
    console.log('(sin TESSERA_TEST_MSSQL_LECTOR: se salta el usuario de solo lectura)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
