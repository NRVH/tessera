// =============================================================================
// Prueba de `opcionalesConexion.ts` y de las reglas de `conservarAlEditar` para los campos opcionales
// (instancia, autenticación, dominio, cifrado, SRV, opciones de URI, usuario opcional y base de Redis):
// rechazo exacto de cada campo, qué se guarda solo para el motor que lo declara y qué desverifica.
// (node src/main/db/test-opcionales-conexion.mts) Puro, sin `electron` ni disco.
// Decisiones: docs/decisiones/bd/conexiones-campos-opcionales.md
// =============================================================================

import { MOTORES } from '../../shared/motores/index.ts'
import { validarBaseRedis } from '../../shared/uriConexion.ts'
import { MAX_BASE_CLAVES, opcionalesAGuardar, tlsEfectivo, usuarioAGuardar, validarBaseClaves, validarOpcional } from './opcionalesConexion.ts'
import { CLAVES_GOBERNADAS, conservarAlEditar, type ConexionPersistida } from './conservarAlEditar.ts'

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

// ---------------------------------------------------------------------------------
hr('(1) validarOpcional')
const casos: Array<[Parameters<typeof validarOpcional>[0], Parameters<typeof validarOpcional>[1], string | null]> = [
  ['database', { instancia: 'x' }, null],
  ['instancia', {}, null],
  ['instancia', { instancia: 'SQLEXPRESS' }, null],
  ['instancia', { instancia: 'srv\\SQLEXPRESS' }, 'En la instancia va solo su nombre (p. ej. SQLEXPRESS), sin el servidor ni el puerto.'],
  ['instancia', { instancia: 'srv:1433' }, 'En la instancia va solo su nombre (p. ej. SQLEXPRESS), sin el servidor ni el puerto.'],
  ['instancia', { instancia: 7 as never }, 'La instancia no es válida.'],
  ['autenticacion', {}, null],
  ['autenticacion', { autenticacion: 'sql' }, null],
  ['autenticacion', { autenticacion: 'ntlm' }, null],
  ['autenticacion', { autenticacion: 'kerberos' as never }, 'Autenticación desconocida: "kerberos".'],
  ['dominio', { autenticacion: 'sql' }, null],
  ['dominio', {}, null],
  ['dominio', { autenticacion: 'ntlm' }, 'Falta el dominio de la cuenta.'],
  ['dominio', { autenticacion: 'ntlm', dominio: '  ' }, 'Falta el dominio de la cuenta.'],
  ['dominio', { autenticacion: 'ntlm', dominio: 'DOMINIO' }, null],
  ['dominio', { dominio: 3 as never }, 'El dominio no es válido.'],
  ['tls', {}, null],
  ['tls', { tls: { cifrar: true, confiarCertificado: false } }, null],
  ['tls', { tls: { cifrar: true } as never }, 'El cifrado de la conexión no es válido.'],
  ['tls', { tls: 'si' as never }, 'El cifrado de la conexión no es válido.']
]
for (const [campo, input, esperado] of casos) {
  const real = validarOpcional(campo, input)
  check(`${campo} ${j(input)} → ${j(esperado)}`, real === esperado, j(real))
}

// ---------------------------------------------------------------------------------
hr('(2) opcionalesAGuardar')
const todo = { instancia: ' SQLEXPRESS ', autenticacion: 'ntlm' as const, dominio: ' DOMINIO ', tls: { confiarCertificado: true, cifrar: true } }
const guardado = opcionalesAGuardar(MOTORES.sqlserver, todo)
check(
  'SQL Server: todo recortado, y el cifrado con sus claves en ORDEN FIJO (cifrar, confiarCertificado)',
  j(guardado) === j({ instancia: 'SQLEXPRESS', autenticacion: 'ntlm', dominio: 'DOMINIO', tls: { cifrar: true, confiarCertificado: true } }),
  j(guardado)
)
check('el cifrado guardado es un objeto NUEVO (no el de la entrada)', guardado.tls !== todo.tls, '')
check('con autenticación sql, el dominio NO se guarda', !('dominio' in opcionalesAGuardar(MOTORES.sqlserver, { ...todo, autenticacion: 'sql' })), '')
check('sin autenticación (= sql), tampoco', !('dominio' in opcionalesAGuardar(MOTORES.sqlserver, { ...todo, autenticacion: undefined })), '')
check('instancia vacía o en blanco: no se guarda', !('instancia' in opcionalesAGuardar(MOTORES.sqlserver, { instancia: '   ' })), '')
check('nada: {}', j(opcionalesAGuardar(MOTORES.sqlserver, {})) === '{}', '')
for (const m of ['oracle', 'postgres', 'sqlite'] as const) {
  check(`${m}: NINGUNO se guarda (su registro no cambia)`, j(opcionalesAGuardar(MOTORES[m], todo)) === '{}', j(opcionalesAGuardar(MOTORES[m], todo)))
}

// ---------------------------------------------------------------------------------
hr('(2b) El USUARIO opcional (MongoDB, Redis)')
{
  const casosUsuario: Array<[Parameters<typeof validarOpcional>[1], string | null]> = [
    [{}, null],
    [{ user: undefined }, null],
    [{ user: null as never }, null],
    [{ user: '' }, null],
    [{ user: 'lector' }, null],
    [{ user: 7 as never }, 'El usuario no es válido.']
  ]
  for (const [input, esperado] of casosUsuario) {
    const real = validarOpcional('user', input)
    check(`user ${j(input)} → ${j(esperado)}`, real === esperado, j(real))
  }
  for (const m of ['mongodb', 'redis'] as const) {
    check(`${m}: declara 'user' opcional (no obligatorio)`, MOTORES[m].conexion.opcionales.includes('user') && !MOTORES[m].conexion.obligatorios.includes('user'), '')
    check(`${m}: sin usuario, se guarda ''`, usuarioAGuardar(MOTORES[m], { user: '' }) === '', '')
    check(`${m}: con usuario, recortado`, usuarioAGuardar(MOTORES[m], { user: ' lector ' }) === 'lector', usuarioAGuardar(MOTORES[m], { user: ' lector ' }))
    // (Pasos 3 y 4.) MongoDB y Redis usan ya el cifrado (`tls`): de lo de SQL Server solo viaja eso.
    const esperadoM = j({ tls: { cifrar: true, confiarCertificado: true } })
    check(`${m}: los opcionales de SQL Server no se guardan (salvo el cifrado, que ${MOTORES[m].etiqueta} usa)`, j(opcionalesAGuardar(MOTORES[m], todo)) === esperadoM, j(opcionalesAGuardar(MOTORES[m], todo)))
  }
  // Los de siempre, al byte: el obligatorio recortado; SQLite (sin credenciales), ''.
  for (const m of ['oracle', 'postgres', 'sqlserver'] as const) {
    check(`${m}: el usuario obligatorio, recortado como siempre`, usuarioAGuardar(MOTORES[m], { user: ' ana ' }) === 'ana', usuarioAGuardar(MOTORES[m], { user: ' ana ' }))
  }
  check('sqlite: no usa usuario, se guarda \'\' aunque llegue uno', usuarioAGuardar(MOTORES.sqlite, { user: 'colado' }) === '', usuarioAGuardar(MOTORES.sqlite, { user: 'colado' }))
}

// ---------------------------------------------------------------------------------
hr('(3) conservarAlEditar con los campos de SQL Server')
for (const k of ['instancia', 'autenticacion', 'dominio', 'tls', 'bases'] as const) {
  check(`CLAVES_GOBERNADAS.${k} = true`, CLAVES_GOBERNADAS[k] === true, '')
}
const previo: ConexionPersistida = {
  id: 'c1',
  profileId: 'p',
  alias: 'A',
  motor: 'sqlserver',
  host: 'h',
  port: 1433,
  user: 'u',
  readonly: true,
  instancia: 'SQLEXPRESS',
  autenticacion: 'ntlm',
  dominio: 'DOMINIO',
  tls: { cifrar: true, confiarCertificado: false },
  secretEnc: 'CIFRADA',
  verificadaEn: 1700000000000,
  driverId: null,
  bases: { modo: 'todos' },
  colorFuturo: 'rojo'
} as ConexionPersistida & { colorFuturo: string }
const nuevo = (cambios: Partial<ConexionPersistida>): ConexionPersistida => {
  // Lo que reconstruye `fields()` desde el formulario: sin lo que el main aprende.
  const { secretEnc: _s, verificadaEn: _v, bases: _b, ...resto } = previo as ConexionPersistida & { colorFuturo?: string }
  const { colorFuturo: _c, ...form } = resto as typeof resto & { colorFuturo?: string }
  return { ...form, ...cambios } as ConexionPersistida
}
const igual = conservarAlEditar(previo, nuevo({}))
check('sin cambios: conserva la verificación, las bases visibles y lo no gobernado', igual.verificadaEn === 1700000000000 && j(igual.bases) === j({ modo: 'todos' }) && (igual as { colorFuturo?: string }).colorFuturo === 'rojo', j(igual))
const otraInst = conservarAlEditar(previo, nuevo({ instancia: 'OTRA' }))
check(
  'otra INSTANCIA es otra dirección: se pierde la verificación y lo no gobernado',
  otraInst.verificadaEn === undefined && (otraInst as { colorFuturo?: string }).colorFuturo === undefined,
  j(otraInst)
)
for (const [nombre, cambio] of [
  ['autenticación', { autenticacion: 'sql' as const, dominio: undefined }],
  ['dominio', { dominio: 'OTRO' }],
  ['cifrado («Confiar en el certificado»)', { tls: { cifrar: true, confiarCertificado: true } }],
  ['cifrado (quitarlo)', { tls: undefined }]
] as Array<[string, Partial<ConexionPersistida>]>) {
  const r = conservarAlEditar(previo, nuevo(cambio))
  check(`cambiar ${nombre} desverifica (es lo probado) pero conserva lo no gobernado (misma dirección)`, r.verificadaEn === undefined && (r as { colorFuturo?: string }).colorFuturo === 'rojo', j(r))
}
const mismoTlsOtroObjeto = conservarAlEditar(previo, nuevo({ tls: { cifrar: true, confiarCertificado: false } }))
check('el MISMO cifrado en otro objeto NO desverifica (se compara por valor)', mismoTlsOtroObjeto.verificadaEn === 1700000000000, j(mismoTlsOtroObjeto))
const aPg = conservarAlEditar(previo, nuevo({ motor: 'postgres', instancia: undefined, autenticacion: undefined, dominio: undefined, tls: undefined }))
check('pasarla a otro motor: las bases visibles se van (como los esquemas)', aPg.bases === undefined, j(aPg))

// ---------------------------------------------------------------------------------
hr('(4) srv, opcionesUri y el cifrado EFECTIVO de MongoDB')
const casosMongo: Array<[Parameters<typeof validarOpcional>[0], Parameters<typeof validarOpcional>[1], string | null]> = [
  ['srv', {}, null],
  ['srv', { srv: true }, null],
  ['srv', { srv: false }, null],
  ['srv', { srv: 'si' as never }, 'El tipo de dirección (SRV) no es válido.'],
  ['opcionesUri', {}, null],
  ['opcionesUri', { opcionesUri: '' }, null],
  ['opcionesUri', { opcionesUri: '   ' }, null],
  ['opcionesUri', { opcionesUri: 7 as never }, 'Las opciones de la URI no son válidas.']
]
for (const [campo, input, esperado] of casosMongo) {
  const real = validarOpcional(campo, input)
  check(`${campo} ${j(input)} → ${j(esperado)}`, real === esperado, j(real))
}
// La lista blanca es de `uriConexion.ts` (grupo del formulario): aquí solo que se CONSULTA.
const rechazada = validarOpcional('opcionesUri', { opcionesUri: 'tlsCAFile=/etc/ca.pem' })
check('opcionesUri con una clave fuera de la lista blanca (una de TLS) → rechazada por validarOpcionesUriMongo', typeof rechazada === 'string' && rechazada !== '', j(rechazada))
check(
  'MongoDB sin nada: guarda SIEMPRE el cifrado efectivo (sin cifrar), sin srv ni opciones',
  j(opcionalesAGuardar(MOTORES.mongodb, {})) === j({ tls: { cifrar: false, confiarCertificado: false } }),
  j(opcionalesAGuardar(MOTORES.mongodb, {}))
)
check(
  'MongoDB con srv y sin cifrado escrito: srv y cifrar (lo que hace mongodb+srv://)',
  j(opcionalesAGuardar(MOTORES.mongodb, { srv: true })) === j({ tls: { cifrar: true, confiarCertificado: false }, srv: true }),
  j(opcionalesAGuardar(MOTORES.mongodb, { srv: true }))
)
check(
  'MongoDB con cifrado escrito (manda sobre srv), srv false (no se guarda) y opciones recortadas',
  j(opcionalesAGuardar(MOTORES.mongodb, { tls: { confiarCertificado: true, cifrar: true }, srv: false, opcionesUri: ' authSource=admin ' })) ===
    j({ tls: { cifrar: true, confiarCertificado: true }, opcionesUri: 'authSource=admin' }),
  j(opcionalesAGuardar(MOTORES.mongodb, { tls: { confiarCertificado: true, cifrar: true }, srv: false, opcionesUri: ' authSource=admin ' }))
)
check(
  'MongoDB con srv y cifrado escrito SIN cifrar: se respeta lo escrito (la URI lo dijo)',
  j(opcionalesAGuardar(MOTORES.mongodb, { srv: true, tls: { cifrar: false, confiarCertificado: false } })) ===
    j({ tls: { cifrar: false, confiarCertificado: false }, srv: true }),
  ''
)
check('SQL Server sin cifrado escrito sigue sin guardarlo (no tiene tlsPorDefecto)', j(opcionalesAGuardar(MOTORES.sqlserver, {})) === j({}), j(opcionalesAGuardar(MOTORES.sqlserver, {})))
const ajenosMongo = (['oracle', 'postgres', 'sqlite', 'sqlserver', 'redis'] as const).map((m) => [m, opcionalesAGuardar(MOTORES[m], { srv: true, opcionesUri: 'authSource=admin' })])
// Redis guarda su cifrado efectivo, y `srv` (que no es suyo) NO lo enciende.
check(
  'srv y opcionesUri no viajan con ningún otro motor (Redis guarda su cifrado, y sin cifrar: srv no es suyo)',
  ajenosMongo.every(([m, g]) => j(g) === (m === 'redis' ? j({ tls: { cifrar: false, confiarCertificado: false } }) : j({}))),
  j(ajenosMongo)
)
check('tlsEfectivo: basura en tls cae al del motor', j(tlsEfectivo(MOTORES.mongodb, { tls: 'si' })) === j({ cifrar: false, confiarCertificado: false }), '')
for (const k of ['srv', 'opcionesUri'] as const) {
  check(`CLAVES_GOBERNADAS.${k} = true`, CLAVES_GOBERNADAS[k] === true, '')
}
const previoM: ConexionPersistida = {
  id: 'm1',
  profileId: 'p',
  alias: 'M',
  motor: 'mongodb',
  host: 'cluster0.ejemplo.net',
  port: 27017,
  user: 'u',
  readonly: true,
  tls: { cifrar: true, confiarCertificado: false },
  srv: true,
  opcionesUri: 'authSource=admin',
  secretEnc: 'CIFRADA',
  verificadaEn: 1700000000000,
  driverId: null,
  colorFuturo: 'rojo'
} as ConexionPersistida & { colorFuturo: string }
const nuevoM = (cambios: Partial<ConexionPersistida>): ConexionPersistida => {
  const { secretEnc: _s, verificadaEn: _v, ...resto } = previoM as ConexionPersistida & { colorFuturo?: string }
  const { colorFuturo: _c, ...form } = resto as typeof resto & { colorFuturo?: string }
  return { ...form, ...cambios } as ConexionPersistida
}
const igualM = conservarAlEditar(previoM, nuevoM({}))
check('MongoDB sin cambios: conserva la verificación y lo no gobernado', igualM.verificadaEn === 1700000000000 && (igualM as { colorFuturo?: string }).colorFuturo === 'rojo', j(igualM))
const sinSrv = conservarAlEditar(previoM, nuevoM({ srv: undefined }))
check('quitar srv es otra DIRECCIÓN: se pierde la verificación y lo no gobernado', sinSrv.verificadaEn === undefined && (sinSrv as { colorFuturo?: string }).colorFuturo === undefined, j(sinSrv))
const otrasOpc = conservarAlEditar(previoM, nuevoM({ opcionesUri: 'authSource=pruebas' }))
check('otras opcionesUri desverifican (lo probado) pero conservan lo no gobernado', otrasOpc.verificadaEn === undefined && (otrasOpc as { colorFuturo?: string }).colorFuturo === 'rojo', j(otrasOpc))

// ---------------------------------------------------------------------------------
hr('(5) La base de Redis es un número de 0 a 9999, y su cifrado el efectivo')
{
  const R = MOTORES.redis
  const buenas = ['', '0', '1', '15', '9999', '0007']
  // (Sin ' 1': la entrada llega ya limpia de `destinoAGuardar`, y la función común con el
  // formulario, `validarBaseRedis`, recorta los blancos del campo.)
  // '00007' (5 cifras): el trabajador y tdb exigen hasta 4.
  const malas = ['-1', '10000', 'db1', '1.5', '1e3', '١', '00007']
  const aceptadas = buenas.filter((b) => validarBaseClaves(R, b) === null)
  const rechazadas = malas.filter((b) => validarBaseClaves(R, b) !== null)
  check(
    `Redis: acepta ${j(buenas)} (vacía = 0) y rechaza ${j(malas)} con el mensaje del rango`,
    aceptadas.length === buenas.length && rechazadas.length === malas.length && validarBaseClaves(R, 'db1') === validarBaseRedis('db1') && MAX_BASE_CLAVES === 9999,
    j({ aceptadas, rechazadas })
  )
  check(
    'mitad negativa: en los demás motores la base es un NOMBRE y esta regla no la mira',
    validarBaseClaves(MOTORES.postgres, 'db1') === null && validarBaseClaves(MOTORES.mongodb, 'pruebas') === null,
    ''
  )
  check(
    'Redis guarda SIEMPRE el cifrado efectivo (sin escribir: sin cifrar); el escrito manda',
    j(opcionalesAGuardar(R, {}).tls) === j({ cifrar: false, confiarCertificado: false }) &&
      j(opcionalesAGuardar(R, { tls: { cifrar: true, confiarCertificado: true } }).tls) === j({ cifrar: true, confiarCertificado: true }),
    j(opcionalesAGuardar(R, {}))
  )
}

// ---------------------------------------------------------------------------------
hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
for (const r of results.filter((x) => !x.pass)) {
  console.log(`FAIL  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
console.log(`\nVEREDICTO: ${passed}/${total} PASS`)
process.exit(allPass ? 0 : 1)
