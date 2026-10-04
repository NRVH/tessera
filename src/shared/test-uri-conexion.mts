#!/usr/bin/env node
// =============================================================================
// Prueba de uriConexion: «Pegar URI» de MongoDB y de Redis, y la lista blanca de `opcionesUri`.
// Fija lo que se descompone bien (esquemas, credenciales con percent-encoding, IPv6, srv, TLS,
// opciones admitidas y descartadas) y lo que se rechaza con su motivo, con las reglas del driver;
// y que `opcionesUri` pasa `validarOpcionesUriMongo`. En Redis, las credenciales como las lee
// ioredis, la base de la ruta, `rediss://` y `validarBaseRedis`.
// =============================================================================

import {
  BASE_REDIS_MAX,
  OPCIONES_URI_MONGO,
  descomponerUriMongo,
  descomponerUriRedis,
  separarAuthSource,
  unirAuthSource,
  validarBaseRedis,
  validarOpcionesFormularioMongo,
  validarOpcionesUriMongo
} from './uriConexion.ts'
import type { CamposUriMongo, CamposUriRedis } from './uriConexion.ts'

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `\n      ${evidence}`}`)
}
const j = (x: unknown): string => JSON.stringify(x)

/** Los campos de una URI que tiene que descomponerse, o null (y el error, en la evidencia). */
function campos(uri: string): CamposUriMongo | null {
  const r = descomponerUriMongo(uri)
  return r.ok ? r.campos : null
}
function error(uri: string): string {
  const r = descomponerUriMongo(uri)
  return r.ok ? '' : r.error
}

hr('(1) Lo básico: host, puerto, usuario, base')
{
  const c = campos('mongodb://127.0.0.1:27117')
  check(
    'sin usuario ni base: host y puerto; TLS sin cifrar (el de Mongo)',
    c !== null && c.host === '127.0.0.1' && c.port === 27117 && c.user === '' && c.password === '' && c.database === '' && !c.srv && j(c.tls) === j({ cifrar: false, confiarCertificado: false }) && c.opcionesUri === '' && c.descartadas.length === 0,
    j(c)
  )
  const sinPuerto = campos('mongodb://db.local')
  check('sin puerto: 27017', sinPuerto?.port === 27017, j(sinPuerto))
  const conBarra = campos('mongodb://db.local:27018/')
  check('con la barra final sin base: base vacía', conBarra?.database === '' && conBarra.port === 27018, j(conBarra))
  const mayus = campos('  MongoDB://h:1/b  ')
  check('el esquema no distingue mayúsculas y se recortan los blancos', mayus?.host === 'h' && mayus.port === 1 && mayus.database === 'b', j(mayus))
  const frag = campos('mongodb://h/b#algo')
  check('el fragmento (#…) no es de la URI', frag?.database === 'b', j(frag))
}

hr('(2) Credenciales con percent-encoding')
{
  // Contraseña con @, : y % (codificados, como los escribe Atlas o mongosh).
  const c = campos('mongodb://ana%2Egil:p%40ss%3Aw%25rd@h:27017/ventas?authSource=admin')
  check('usuario y clave decodificados (@, : y % en la clave)', c?.user === 'ana.gil' && c.password === 'p@ss:w%rd', j(c))
  check('authSource explícito se respeta', c?.opcionesUri === 'authSource=admin', j(c?.opcionesUri))
  const sinClave = campos('mongodb://ana@h')
  check('usuario sin clave: clave vacía', sinClave?.user === 'ana' && sinClave.password === '', j(sinClave))
  const arroba = campos('mongodb://ana:p@ss@h:27017')
  check('una @ sin codificar en la clave: el usuario acaba en la ÚLTIMA', arroba?.password === 'p@ss' && arroba.host === 'h', j(arroba))
  check('un % suelto en la clave: error con el remedio', /contraseña/.test(error('mongodb://ana:100%@h')) && /%25/.test(error('mongodb://ana:100%@h')), error('mongodb://ana:100%@h'))
}

hr('(3) La base como base de autenticación (sin authSource)')
{
  const c = campos('mongodb://tessera:x@127.0.0.1:27117/pruebas')
  check('con usuario y base, sin authSource: se añade authSource=<base>', c?.database === 'pruebas' && c.opcionesUri === 'authSource=pruebas', j(c))
  const sinUsuario = campos('mongodb://127.0.0.1/pruebas')
  check('sin usuario: nada que añadir', sinUsuario?.opcionesUri === '', j(sinUsuario))
  const srv = campos('mongodb+srv://u:x@cluster0.abcd.mongodb.net/ventas')
  check('con srv: NO (el TXT de Atlas pone su authSource)', srv?.opcionesUri === '', j(srv))
  const x509 = campos('mongodb://u@h/b?authMechanism=MONGODB-X509')
  check('con X.509: NO (el driver rechaza un authSource que no sea $external)', x509?.opcionesUri === 'authMechanism=MONGODB-X509', j(x509))
  const scram = campos('mongodb://u:x@h/b?authMechanism=SCRAM-SHA-256')
  check('con SCRAM: sí', scram?.opcionesUri === 'authMechanism=SCRAM-SHA-256&authSource=b', j(scram))
}

hr('(4) IPv6')
{
  const c = campos('mongodb://[::1]:27017/b')
  check('[::1]:27017 → host ::1 (sin corchetes) y puerto 27017', c?.host === '::1' && c.port === 27017 && c.database === 'b', j(c))
  const sinPuerto = campos('mongodb://[fe80::1]')
  check('[fe80::1] sin puerto: 27017', sinPuerto?.host === 'fe80::1' && sinPuerto.port === 27017, j(sinPuerto))
  check('IPv6 sin cerrar: error', /IPv6/.test(error('mongodb://[::1:27017')), error('mongodb://[::1:27017'))
}

hr('(5) SRV')
{
  const c = campos('mongodb+srv://u:x@cluster0.abcd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
  check(
    'srv: sin puerto, cifrar por defecto, opciones admitidas',
    c !== null && c.srv && c.port === null && c.host === 'cluster0.abcd.mongodb.net' && j(c.tls) === j({ cifrar: true, confiarCertificado: false }) && c.opcionesUri === 'retryWrites=true&w=majority&appName=Cluster0',
    j(c)
  )
  const sinTls = campos('mongodb+srv://c.example.net/?tls=false')
  check('srv con tls=false: sin cifrar (el usuario manda)', sinTls?.tls.cifrar === false, j(sinTls))
  const conSsl = campos('mongodb+srv://c.example.net/?ssl=false')
  check('srv con ssl=false: también', conSsl?.tls.cifrar === false, j(conSsl))
  check('srv con puerto: error (como el driver)', /no lleva puerto/.test(error('mongodb+srv://c.example.net:27017')), error('mongodb+srv://c.example.net:27017'))
  check('srv con dos nombres: error', /un solo nombre/.test(error('mongodb+srv://a.net,b.net')), error('mongodb+srv://a.net,b.net'))
  check('srv con directConnection=true: error', /directConnection/.test(error('mongodb+srv://a.net/?directConnection=true')), error('mongodb+srv://a.net/?directConnection=true'))
}

hr('(6) TLS a sus casillas')
{
  const t = campos('mongodb://h/?tls=true')
  check('tls=true: cifrar', j(t?.tls) === j({ cifrar: true, confiarCertificado: false }) && t?.opcionesUri === '', j(t))
  const s = campos('mongodb://h/?ssl=TRUE&tlsAllowInvalidCertificates=true')
  check('ssl=TRUE + tlsAllowInvalidCertificates: cifrar y confiar', j(s?.tls) === j({ cifrar: true, confiarCertificado: true }) && s?.opcionesUri === '', j(s))
  const ins = campos('mongodb://h/?tls=true&tlsInsecure=true')
  check('tlsInsecure=true: confiar', ins?.tls.confiarCertificado === true, j(ins))
  const soloConfiar = campos('mongodb://h/?tlsAllowInvalidCertificates=true')
  check('tlsAllowInvalidCertificates sin tls: NO cifra (el driver tampoco)', j(soloConfiar?.tls) === j({ cifrar: false, confiarCertificado: true }), j(soloConfiar))
  check('tls y ssl distintos: error', /distintas/.test(error('mongodb://h/?tls=true&ssl=false')), error('mongodb://h/?tls=true&ssl=false'))
  check('tls=quizá: error', /true o false/.test(error('mongodb://h/?tls=quiza')), error('mongodb://h/?tls=quiza'))
  const ca = campos('mongodb://h/?tls=true&tlsCAFile=/etc/ca.pem')
  check('tlsCAFile: descartada (no tiene casilla)', j(ca?.descartadas) === j(['tlsCAFile']) && ca?.opcionesUri === '', j(ca))
}

hr('(7) Opciones admitidas y descartadas')
{
  const c = campos('mongodb://h:27017/?replicaset=rs0&READPREFERENCE=secondary&compressors=zstd&maxIdleTimeMS=10&authMechanismProperties=A:B')
  check('las admitidas, con su nombre canónico', c?.opcionesUri === 'replicaSet=rs0&readPreference=secondary', j(c?.opcionesUri))
  check('las demás, a descartadas (con su nombre tal cual)', j(c?.descartadas) === j(['compressors', 'maxIdleTimeMS', 'authMechanismProperties']), j(c?.descartadas))
  const tags = campos('mongodb://h/?readPreference=secondary&readPreferenceTags=dc:ny&readPreferenceTags=')
  check(
    'readPreferenceTags vacía al final: vale (el driver la admite: «cualquier etiqueta»)',
    tags?.opcionesUri === 'readPreference=secondary&readPreferenceTags=dc:ny&readPreferenceTags=',
    j(tags) + error('mongodb://h/?readPreference=secondary&readPreferenceTags=dc:ny&readPreferenceTags=')
  )
  check('otra opción vacía: error (el driver también)', /no lleva valor/.test(error('mongodb://h/?appName=')), error('mongodb://h/?appName='))
  const tags2 = campos('mongodb://h/?readPreferenceTags=dc:ny&readPreferenceTags=dc:sf')
  check('readPreferenceTags repetida: vale (el driver la admite)', tags2?.opcionesUri === 'readPreferenceTags=dc:ny&readPreferenceTags=dc:sf', j(tags2))
  check('opción repetida: error', /repetida/.test(error('mongodb://h/?appName=a&appname=b')), error('mongodb://h/?appName=a&appname=b'))
  check('opción sin valor: error', /no lleva valor/.test(error('mongodb://h/?appName')), error('mongodb://h/?appName'))
  check('directConnection=quizá: error de valor', /true o false/.test(error('mongodb://h/?directConnection=quiza')), error('mongodb://h/?directConnection=quiza'))
  // Lo que sale en `opcionesUri` pasa la validación del main.
  const muestras = [
    'mongodb://u:x@h/b',
    'mongodb://h/?replicaSet=rs0&w=majority&journal=true&maxPoolSize=5',
    'mongodb+srv://c.net/?appName=x&retryReads=false'
  ]
  const malas = muestras.filter((u) => {
    const r = campos(u)
    return r === null || validarOpcionesUriMongo(r.opcionesUri) !== null
  })
  check('todo lo que sale en opcionesUri pasa validarOpcionesUriMongo', malas.length === 0, j(malas))
}

hr('(8) Lo que se rechaza con su motivo')
{
  check('otro esquema: error con los dos esperados', /mongodb:\/\/ o mongodb\+srv:\/\//.test(error('postgres://h/b')), error('postgres://h/b'))
  check('sin esquema: error', error('h:27017') !== '', error('h:27017'))
  check('vacía: error', error('') !== '', error(''))
  check('varios hosts sin srv: error con el remedio (replicaSet)', /replicaSet/.test(error('mongodb://a:1,b:2/?replicaSet=rs0')), error('mongodb://a:1,b:2/?replicaSet=rs0'))
  check('sin host: error', /host/.test(error('mongodb:///b')), error('mongodb:///b'))
  check('puerto no numérico: error', /puerto/.test(error('mongodb://h:abc')), error('mongodb://h:abc'))
  check('puerto 0: error', /puerto/.test(error('mongodb://h:0')), error('mongodb://h:0'))
  check('puerto 65536: error', /puerto/.test(error('mongodb://h:65536')), error('mongodb://h:65536'))
  check('socket local: error', /socket/.test(error('mongodb://%2Ftmp%2Fmongodb-27017.sock')), error('mongodb://%2Ftmp%2Fmongodb-27017.sock'))
}

hr('(9) validarOpcionesUriMongo (lo que el main aplica al guardar)')
{
  const buenas = [
    '',
    '   ',
    'authSource=admin',
    'authSource=admin&replicaSet=rs0',
    'AUTHSOURCE=admin',
    'readPreferenceTags=dc:ny&readPreferenceTags=dc:sf',
    'directConnection=TRUE&retryWrites=false',
    'maxPoolSize=10&connectTimeoutMS=5000',
    'appName=Mi%20app',
    'authSource=admin&',
    'readPreferenceTags=dc:ny&readPreferenceTags='
  ]
  const fallan = buenas.filter((t) => validarOpcionesUriMongo(t) !== null)
  check('las buenas pasan', fallan.length === 0, j(fallan.map((t) => [t, validarOpcionesUriMongo(t)])))
  const malas: Array<[string, RegExp]> = [
    ['?authSource=admin', /«\?»/],
    ['authSource=admin replicaSet=rs0', /espacios/],
    ['authSource=a#b', /#/],
    ['authSource', /no lleva valor/],
    ['authSource=', /no lleva valor/],
    ['=admin', /Falta la clave/],
    ['tls=true', /casillas de TLS/],
    ['ssl=true', /casillas de TLS/],
    ['tlsAllowInvalidCertificates=true', /casillas de TLS/],
    ['password=x', /sus campos/],
    ['username=ana', /sus campos/],
    ['compressors=zstd', /no es una opción admitida/],
    ['authSource=a&authsource=b', /repetida/],
    ['retryWrites=si', /true o false/],
    ['maxPoolSize=-1', /entero/],
    ['socketTimeoutMS=1.5', /entero/],
    ['appName=100%', /%25/]
  ]
  for (const [t, re] of malas) {
    const m = validarOpcionesUriMongo(t)
    check(`rechaza «${t}»`, m !== null && re.test(m), j(m))
  }
  check('el mensaje de una no admitida enumera la lista', (validarOpcionesUriMongo('x=1') ?? '').includes(OPCIONES_URI_MONGO.join(', ')), j(validarOpcionesUriMongo('x=1')))
}

// --- Redis ---------------------------------------------------------------------

function camposR(uri: string): CamposUriRedis | null {
  const r = descomponerUriRedis(uri)
  return r.ok ? r.campos : null
}
function errorR(uri: string): string {
  const r = descomponerUriRedis(uri)
  return r.ok ? '' : r.error
}
const SIN_CIFRAR = { cifrar: false, confiarCertificado: false }
const CIFRA = { cifrar: true, confiarCertificado: false }

hr('(10) Redis: host, puerto, credenciales y base')
{
  const c = camposR('redis://127.0.0.1:6479')
  check(
    'sin usuario ni base: host y puerto; sin cifrar (el del motor); nada descartado',
    c !== null && c.host === '127.0.0.1' && c.port === 6479 && c.user === '' && c.password === '' && c.database === '' && j(c.tls) === j(SIN_CIFRAR) && c.descartadas.length === 0,
    j(c)
  )
  check('sin puerto: 6379', camposR('redis://cache.local')?.port === 6379, j(camposR('redis://cache.local')))
  check('la barra final sin base: base vacía (la 0)', camposR('redis://h:1/')?.database === '', j(camposR('redis://h:1/')))
  const acl = camposR('redis://ana:p%40ss%3Aw@h:6380/3')
  check('usuario ACL y clave decodificados; la base de la ruta', acl?.user === 'ana' && acl.password === 'p@ss:w' && acl.database === '3' && acl.port === 6380, j(acl))
  const soloClave = camposR('redis://:secreto@h')
  check('redis://:clave@h: AUTH con la clave sola (usuario vacío)', soloClave?.user === '' && soloClave.password === 'secreto', j(soloClave))
  // Como ioredis y NO como redis-cli: sin «:», es el usuario (ver la cabecera).
  const soloUsuario = camposR('redis://ana@h')
  check('redis://ana@h: usuario sin clave (lo que lee ioredis)', soloUsuario?.user === 'ana' && soloUsuario.password === '', j(soloUsuario))
  check('una @ sin codificar en la clave (la última @ corta)', camposR('redis://:a@b@h')?.password === 'a@b' && camposR('redis://:a@b@h')?.host === 'h', j(camposR('redis://:a@b@h')))
  check('la base se normaliza (/007 → 7) y la 0 se queda', camposR('redis://h/007')?.database === '7' && camposR('redis://h/0')?.database === '0', j([camposR('redis://h/007'), camposR('redis://h/0')]))
  check('la base 9999 vale', camposR('redis://h/9999')?.database === '9999', j(camposR('redis://h/9999')))
  const mayus = camposR('  REDIS://h:1/2  ')
  check('el esquema no distingue mayúsculas y se recortan los blancos', mayus?.host === 'h' && mayus.database === '2', j(mayus))
  check('el fragmento (#…) no es de la URI', camposR('redis://h/4#x')?.database === '4', j(camposR('redis://h/4#x')))
}

hr('(11) Redis: rediss://, IPv6 y opciones descartadas')
{
  check('rediss:// cifra y verifica', j(camposR('rediss://h:6380')?.tls) === j(CIFRA), j(camposR('rediss://h:6380')))
  check('redis:// no cifra', j(camposR('redis://h')?.tls) === j(SIN_CIFRAR), j(camposR('redis://h')))
  const v6 = camposR('redis://[::1]:6479/1')
  check('IPv6 con corchetes: sin corchetes en el host', v6?.host === '::1' && v6.port === 6479 && v6.database === '1', j(v6))
  check('IPv6 sin puerto: 6379', camposR('redis://[fe80::1]')?.port === 6379, j(camposR('redis://[fe80::1]')))
  const q = camposR('redis://h/2?family=6&db=5&tls=true&family=4&sinvalor')
  check(
    'lo de detrás de ? se descarta ENTERO y se dice (sin repetir; ni db= ni tls= cuentan)',
    q !== null && j(q.descartadas) === j(['family', 'db', 'tls', 'sinvalor']) && q.database === '2' && j(q.tls) === j(SIN_CIFRAR),
    j(q)
  )
  check('una ? vacía no descarta nada', camposR('redis://h?')?.descartadas.length === 0, j(camposR('redis://h?')))
}

hr('(12) Redis: lo que se rechaza con su motivo')
{
  const casos: [string, RegExp][] = [
    ['mongodb://h', /redis:\/\/ o rediss:\/\//],
    ['h:6379', /redis:\/\/ o rediss:\/\//],
    ['redis://', /Falta el host/],
    ['redis://a:1,b:2', /varios hosts/],
    ['redis://h:0', /puerto/],
    ['redis://h:70000', /puerto/],
    ['redis://h:abc', /puerto/],
    ['redis://h/abc', /número de la base.*«abc»/],
    ['redis://h/-1', /número/],
    ['redis://h/10000', /0 a 9999/],
    ['redis://h/1.5', /número/],
    ['redis://h/0/x', /número/],
    ['redis://%2Ftmp%2Fredis.sock', /socket local/],
    ['redis://[::1', /«\]»/],
    ['redis://:a%zz@h', /%25/]
  ]
  for (const [uri, motivo] of casos) {
    const e = errorR(uri)
    check(`«${uri}» → error con su motivo`, motivo.test(e), e)
  }
}

hr('(13) validarBaseRedis (lo que el formulario y el main aplican a la base)')
{
  const buenas = ['', '  ', '0', '1', '15', '9999', '007']
  const fallan = buenas.filter((t) => validarBaseRedis(t) !== null)
  check('las buenas pasan (vacía = la 0; ceros delante valen)', fallan.length === 0, j(fallan))
  const malas = ['a', '-1', '1.5', '10000', '1e3', '0x1', '١', ' 1 2 ']
  const pasan = malas.filter((t) => validarBaseRedis(t) === null)
  check('las malas no pasan (fuera de rango, signo, decimales, notación)', pasan.length === 0, j(pasan))
  check('el mensaje dice el rango y cita lo escrito', (validarBaseRedis('abc') ?? '').includes('0 a 9999') && (validarBaseRedis('abc') ?? '').includes('«abc»'), j(validarBaseRedis('abc')))
  check('el tope es BASE_REDIS_MAX', BASE_REDIS_MAX === 9999 && validarBaseRedis(String(BASE_REDIS_MAX + 1)) !== null, String(BASE_REDIS_MAX))
  // Todo lo que sale de una URI pasa la validación con la que el main guarda.
  const uris = ['redis://h', 'redis://h/0', 'redis://h/007', 'rediss://u:c@h:1/9999']
  const noPasan = uris.filter((u) => {
    const c = camposR(u)
    return c === null || validarBaseRedis(c.database) !== null
  })
  check('la base que sale de una URI pasa validarBaseRedis', noPasan.length === 0, j(noPasan))
}

hr('(14) La base de autenticación, fuera y dentro de las opciones')
{
  const ida = (t: string): string => {
    const s = separarAuthSource(t)
    return unirAuthSource(s.resto, s.authSource, s.origen)
  }
  const intactas = ['', 'w=1', 'authSource=admin', 'appName=a&authsource=%24external&w=1', 'w=1&&authSource=x']
  const cambian = intactas.filter((t) => ida(t) !== t.replace('&&', '&'))
  check('ida y vuelta sin tocar: al byte (clave, codificación y sitio)', cambian.length === 0, j(cambian.map(ida)))
  const rep = separarAuthSource('authSource=a&authSource=b')
  check('repetido: no se toca (lo dice la validación)', rep.authSource === '' && rep.resto === 'authSource=a&authSource=b' && rep.origen === null, j(rep))
  const pct = separarAuthSource('authSource=%zz&w=1')
  check('con un % suelto: no se toca', pct.authSource === '' && pct.resto === 'authSource=%zz&w=1', j(pct))
  check('sin valor, vacío: no es un authSource que sacar', separarAuthSource('authSource&w=1').origen === null, 'ok')
  check('unir a nada: solo el par, codificado', unirAuthSource('', 'a&b', null) === 'authSource=a%26b', unirAuthSource('', 'a&b', null))
  check('un sitio de más allá del final: al final', unirAuthSource('w=1', 'x', { indice: 7, par: 'authSource=y' }) === 'w=1&authSource=x', unirAuthSource('w=1', 'x', { indice: 7, par: 'authSource=y' }))
  check(
    'el formulario rechaza el authSource en las opciones; lo demás, como el main',
    validarOpcionesFormularioMongo('w=1& authSource=a') !== null && validarOpcionesFormularioMongo('replicaSet=rs0') === null && validarOpcionesFormularioMongo('tls=true') === validarOpcionesUriMongo('tls=true'),
    j(validarOpcionesFormularioMongo('w=1& authSource=a'))
  )
  check(
    'repetido o con % suelto: el error de verdad del main, no «va en su campo»',
    validarOpcionesFormularioMongo('authSource=a&authSource=b') === validarOpcionesUriMongo('authSource=a&authSource=b') &&
      validarOpcionesFormularioMongo('authSource=%zz') === validarOpcionesUriMongo('authSource=%zz') &&
      validarOpcionesUriMongo('authSource=a&authSource=b') !== null,
    j([validarOpcionesFormularioMongo('authSource=a&authSource=b'), validarOpcionesFormularioMongo('authSource=%zz')])
  )
  check('lo unido pasa lo que el main aplica', validarOpcionesUriMongo(unirAuthSource('replicaSet=rs0', '$external', null)) === null, 'ok')
}

const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
