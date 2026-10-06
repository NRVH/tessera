#!/usr/bin/env node
// =============================================================================
// Prueba del registro SSH (`registroSsh.ts`, `ConexionesSsh.ts`, `validacionSsh.ts` y los canales de
// `ipc.ts` con un `ipc` de mentira; npm run test:ssh-registro): BOM y vacío, formato ajeno, ajenas y
// grupos ajenos conservados, id repetido, claves no gobernadas, el secreto (solo escritura, cifrado con
// un cifrado de mentira, ilegible, C68), validación, grupos, poda solo de entradas, cambio por fuera,
// `.ilegible`, DTO sin secretos ni rutas, huellas (olvidarlas), archivos al borrar y el archivo de clave.
// Sin Docker ni red; la huella se cruza con `ssh-keygen -l` si el sistema lo trae.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SSH_CHANNELS, type SshConexionInput, type SshListaConexiones } from '../../shared/ssh-ipc.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { conservarAlEditarSsh, type ConexionSshPersistida } from './conservarAlEditarSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import { ClavesImportadas, MENSAJE_FICHA_CLAVE } from './controlador/clavesImportadas.ts'
import { resolverBinariosSsh } from './binariosSsh.ts'
import { reconocerClave, type SalidaCorta } from './formatoClave.ts'
import { registrarIpcSsh } from './ipc.ts'
import { MENSAJE_SIN_COPIA_CLAVE, citarRutaOpcion } from './lineaSsh.ts'
import { MENSAJE_CAMBIADO_FUERA_SSH, MENSAJE_FORMATO_AJENO_SSH, MENSAJE_RESCATADO_CORREGIDO_SSH } from './mensajesRegistroSsh.ts'
import { MENSAJE_FALTA_CLAVE, errorHost, errorPuerto, errorUsuario } from './validacionSsh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function error(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

type Crudo = Record<string, unknown>
const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ssh-registro-'))
const dirHuellas = path.join(dir, 'huellas')
const dirClaves = path.join(dir, 'claves')
mkdirSync(dirHuellas, { recursive: true })
mkdirSync(dirClaves, { recursive: true })
let n = 0
/** Un registro nuevo en disco con ese contenido (objeto, o texto tal cual); `null` = no existe. */
function archivo(contenido: unknown): string {
  const ruta = path.join(dir, `ssh-connections-${++n}.json`)
  if (contenido !== null) writeFileSync(ruta, typeof contenido === 'string' ? contenido : JSON.stringify(contenido, null, 2))
  return ruta
}
const disco = (ruta: string): Crudo => JSON.parse(readFileSync(ruta, 'utf-8'))
const lista = (doc: Crudo, clave: 'grupos' | 'conexiones'): Crudo[] => doc[clave] as Crudo[]
const descifrarFalso = (b: Buffer): string => {
  const t = b.toString('utf-8')
  if (!t.startsWith('ENC:')) throw new Error('ilegible')
  return t.slice(4)
}
/** Un cifrado de mentira: «ENC:» delante; lo que no lo lleva es de «otra máquina». */
const cifradoFalso = { disponible: (): boolean => true, cifrar: (p: string): Buffer => Buffer.from(`ENC:${p}`), descifrar: descifrarFalso }
function store(ruta: string): ConexionesSsh {
  return new ConexionesSsh({ storePath: ruta, dirHuellas, dirClaves, cifrado: cifradoFalso, log: () => {} })
}
/** Una conexión cruda de forma conocida. */
function cx(id: string, extra: Crudo = {}): Crudo {
  return { id, profileId: 'pa', alias: `srv-${id}`, host: 'servidor.ejemplo', puerto: 22, usuario: 'pruebas', metodo: 'sistema', disponibleAgentes: true, ...extra }
}
function entrada(extra: Partial<SshConexionInput> = {}): SshConexionInput {
  return { profileId: 'pa', alias: `nueva-${++n}`, grupoId: null, host: '192.0.2.10', puerto: 22, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, ...extra }
}
/** Una cadena SSH: longitud de 4 bytes y los bytes. */
function cadenaSsh(b: Buffer | string): Buffer {
  const datos = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  return Buffer.concat([largo, datos])
}
/** Una clave con la forma del formato propio de OpenSSH (cabecera real, contenido al azar). */
function claveSintetica(cifrado: string, algoritmo: string): string {
  const cuantas = Buffer.alloc(4)
  cuantas.writeUInt32BE(1)
  const blob = Buffer.concat([
    Buffer.from('openssh-key-v1\u0000', 'latin1'),
    cadenaSsh(cifrado),
    cadenaSsh(cifrado === 'none' ? 'none' : 'bcrypt'),
    cadenaSsh(cifrado === 'none' ? Buffer.alloc(0) : randomBytes(24)),
    cuantas,
    cadenaSsh(Buffer.concat([cadenaSsh(algoritmo), cadenaSsh(randomBytes(32))])),
    cadenaSsh(randomBytes(64))
  ])
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${(blob.toString('base64').match(/.{1,70}/g) ?? []).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
}
/** Un `ssh-keygen -y` de mentira: lee la copia y contesta como el de verdad (pública, frase o formato). */
async function keygenFalso(_exe: string, args: readonly string[]): Promise<SalidaCorta> {
  const r = reconocerClave(readFileSync(args[args.length - 1]), 'x')
  if (!r.ok) return { codigo: 255, salida: '', errores: 'Load key "x": invalid format', agotado: false }
  if (r.clave.cifrada) return { codigo: 255, salida: '', errores: 'Load key "x": incorrect passphrase supplied to decrypt private key', agotado: false }
  return { codigo: 0, salida: `${r.clave.algoritmo ?? 'ssh-rsa'} AAAAprueba comentario\n`, errores: '', agotado: false }
}

try {
  // ---------------------------------------------------------------------------
  hr('A - Lectura: BOM, vacío y raíces que no tienen nada que perder')
  {
    const ruta = archivo(String.fromCharCode(0xfeff) + JSON.stringify({ version: 1, conexiones: [cx('a1')] }))
    const l = store(ruta).listar()
    check('(a1) un archivo con BOM se lee', !l.formatoAjeno && l.conexiones.length === 1, `conexiones=${l.conexiones.length}`)
    for (const [nombre, texto] of [['cero bytes', ''], ['solo espacios', '  \n '], ['null', 'null'], ['[]', '[]']] as const) {
      const r = archivo(texto)
      const s = store(r)
      const creada = error(() => s.crear(entrada()))
      check(`(a2) ${nombre}: vacío y escribible`, !s.formatoAjeno && creada === null && lista(disco(r), 'conexiones').length === 1, `error=${creada}`)
    }
    const r = archivo(null)
    store(r).crear(entrada())
    check('(a3) sin archivo: la primera alta lo crea con version 1', disco(r).version === 1 && lista(disco(r), 'grupos').length === 0, readFileSync(r, 'utf-8').slice(0, 60))
  }

  // ---------------------------------------------------------------------------
  hr('B - Formato ajeno: se lista vacío con su aviso y no se escribe nada')
  for (const [nombre, contenido] of [
    ['raíz lista con entradas', [cx('b1')]],
    ['raíz número', 5],
    ['conexiones no es una lista', { conexiones: { a: 1 } }],
    ['grupos no es una lista', { grupos: 'x', conexiones: [] }],
    ['versión de texto', { version: '2', conexiones: [cx('b2')] }]
  ] as const) {
    const r = archivo(contenido)
    const antes = readFileSync(r, 'utf-8')
    const s = store(r)
    const l = s.listar()
    const alta = error(() => s.crear(entrada()))
    s.podarPerfiles(new Set())
    check(
      `(b) ${nombre}`,
      l.formatoAjeno && l.aviso === MENSAJE_FORMATO_AJENO_SSH && l.conexiones.length === 0 && alta === MENSAJE_FORMATO_AJENO_SSH && readFileSync(r, 'utf-8') === antes,
      `formatoAjeno=${l.formatoAjeno} alta=${alta?.slice(0, 50)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('C/D - Ajenas y grupos ajenos se conservan en su sitio; id repetido')
  {
    const ajenaMetodo = cx('c-ajena', { metodo: 'kerberos', alias: 'raro' })
    const grupoAjeno = { id: 'g-ajeno', profileId: 'pa', color: 'rojo' }
    const repetida = cx('c1', { alias: 'copia-de-c1', host: 'otro.ejemplo' })
    const r = archivo({ version: 3, extra: { a: 1 }, grupos: [grupoAjeno, { id: 'g1', profileId: 'pa', nombre: 'Prod' }], conexiones: [cx('c1'), ajenaMetodo, repetida, cx('C1', { alias: 'caja' }), cx('../fuera')] })
    const s = store(r)
    const l = s.listar()
    s.crear(entrada())
    const doc = disco(r)
    const conexiones = lista(doc, 'conexiones')
    check('(c1) la versión no baja y la raíz desconocida sigue', doc.version === 3 && JSON.stringify(doc.extra) === '{"a":1}', `version=${doc.version}`)
    check('(c2) la conexión ajena vuelve al disco idéntica y en su sitio', JSON.stringify(conexiones[1]) === JSON.stringify(ajenaMetodo), JSON.stringify(conexiones[1]))
    check('(c3) el grupo ajeno vuelve al disco idéntico y en su sitio', JSON.stringify(lista(doc, 'grupos')[0]) === JSON.stringify(grupoAjeno), JSON.stringify(lista(doc, 'grupos')[0]))
    const ajenas = l.ajenas.map((a) => `${a.tipo}:${a.nombre}${a.idRepetido ? '*' : ''}`)
    check(
      '(c4) las ajenas se listan con su tipo y nombre',
      ajenas.includes('grupo:g-ajeno') && ajenas.includes('conexion:raro'),
      ajenas.join(', ')
    )
    check('(d1) la segunda con el mismo id es ajena por id repetido', ajenas.includes('conexion:copia-de-c1*') && l.conexiones.filter((c) => c.id === 'c1').length === 1, ajenas.join(', '))
    check('(d2) sin distinguir mayúsculas (el id nombra un archivo)', ajenas.includes('conexion:caja*'), ajenas.join(', '))
    check('(d3) un id que no puede nombrar un archivo es ajeno', ajenas.includes('conexion:srv-../fuera') && conexiones.length === 6, `${conexiones.length} en disco`)
  }

  // ---------------------------------------------------------------------------
  hr('E - Lo que esta versión no gobierna sobrevive (mientras no cambie la máquina)')
  {
    const r = archivo({ grupos: [{ id: 'g1', profileId: 'pa', nombre: 'Prod', orden: 3 }], conexiones: [cx('e1', { metodo: 'contrasena', secretEnc: Buffer.from('ENC:x').toString('base64'), colorFuturo: 'rojo', proxyJump: 'salto' })] })
    const s = store(r)
    const dto = s.listar().conexiones[0]
    const edicion = (cambios: Partial<SshConexionInput>): SshConexionInput => ({ profileId: 'pa', alias: dto.alias, grupoId: null, host: dto.host, puerto: dto.puerto, usuario: dto.usuario, metodo: dto.metodo, disponibleAgentes: true, ...cambios })
    s.editar('e1', edicion({ alias: 'renombrada' }))
    let c = lista(disco(r), 'conexiones')[0]
    check('(e1) al renombrar siguen las claves desconocidas', c.colorFuturo === 'rojo' && c.proxyJump === 'salto' && c.alias === 'renombrada', JSON.stringify(c))
    check('(e2) y el secreto, con el mismo método', typeof c.secretEnc === 'string', `secretEnc=${String(c.secretEnc).slice(0, 8)}…`)
    s.editar('e1', edicion({ alias: 'renombrada', metodo: 'sistema' }))
    c = lista(disco(r), 'conexiones')[0]
    check('(e3) con otro método el secreto ya no vale y se va', c.secretEnc === undefined && c.colorFuturo === 'rojo', JSON.stringify(c))
    s.editar('e1', edicion({ alias: 'renombrada', metodo: 'sistema', host: 'otra.ejemplo' }))
    c = lista(disco(r), 'conexiones')[0]
    check('(e4) con otra máquina, lo no gobernado se va', c.colorFuturo === undefined && c.proxyJump === undefined, JSON.stringify(c))
    s.renombrarGrupo('g1', 'pa', 'Producción')
    const g = lista(disco(r), 'grupos')[0]
    check('(e5) renombrar un grupo conserva lo que trae', g.nombre === 'Producción' && g.orden === 3, JSON.stringify(g))
  }

  // ---------------------------------------------------------------------------
  hr('E2 - Una contraseña guardada no viaja a otro destino; la frase de una clave se queda')
  {
    const secreto = Buffer.from('ENC:x').toString('base64')
    const editarConContrasena = (id: string, cambios: Partial<SshConexionInput>): { ruta: string; tieneSecreto: boolean } => {
      const ruta = archivo({ conexiones: [cx(id, { metodo: 'contrasena', secretEnc: secreto })] })
      const s = store(ruta)
      const dto = s.listar().conexiones[0]
      const base: SshConexionInput = { profileId: 'pa', alias: dto.alias, grupoId: null, host: dto.host, puerto: dto.puerto, usuario: dto.usuario, metodo: 'contrasena', disponibleAgentes: true }
      return { ruta, tieneSecreto: s.editar(id, { ...base, ...cambios }).tieneSecreto }
    }
    for (const [que, cambios] of [['host', { host: 'otra.ejemplo' }], ['puerto', { puerto: 2222 }], ['usuario', { usuario: 'otro' }]] as const) {
      const { ruta, tieneSecreto } = editarConContrasena(`e6-${que}`, cambios)
      const c = lista(disco(ruta), 'conexiones')[0]
      check(`(e6) con contraseña y otro ${que}: el secreto se descarta`, c.secretEnc === undefined && !tieneSecreto, `secretEnc=${String(c.secretEnc)} tieneSecreto=${tieneSecreto}`)
    }
    const mismoDestino = editarConContrasena('e7', { alias: 'otro-nombre', disponibleAgentes: false })
    const c7 = lista(disco(mismoDestino.ruta), 'conexiones')[0]
    check('(e7) con contraseña y el mismo destino (otro nombre y disponibilidad): el secreto se queda', c7.secretEnc === secreto && mismoDestino.tieneSecreto, `secretEnc=${String(c7.secretEnc).slice(0, 8)}…`)
    // La función pura, con un secreto junto a la clave.
    const previoClave = cx('e8', { metodo: 'clave', secretEnc: secreto, clave: { nombre: 'id_prod', tipo: 'ed25519', cifrada: true } })
    const nuevoClave: ConexionSshPersistida = { id: 'e8', profileId: 'pa', alias: 'srv-e8', host: 'otra.ejemplo', puerto: 2222, usuario: 'otro', metodo: 'clave', disponibleAgentes: true }
    const editadoClave = conservarAlEditarSsh(previoClave, nuevoClave, () => true)
    check(
      '(e8) con clave y otro destino: la frase se queda (no viaja al servidor) y la clave también',
      editadoClave.secretEnc === secreto && JSON.stringify(editadoClave.clave) === JSON.stringify(previoClave.clave),
      JSON.stringify(editadoClave)
    )
    const nueva = Buffer.from('ENC:nueva').toString('base64')
    const previoPw = cx('e9', { metodo: 'contrasena', secretEnc: secreto })
    const conNueva: ConexionSshPersistida = { id: 'e9', profileId: 'pa', alias: 'srv-e9', host: 'servidor.ejemplo', puerto: 22, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, secretEnc: nueva }
    const mismo = conservarAlEditarSsh(previoPw, conNueva, () => true).secretEnc
    const otro = conservarAlEditarSsh(previoPw, { ...conNueva, host: 'otra.ejemplo' }, () => true).secretEnc
    check('(e9) con una contraseña nueva gana la nueva, con el mismo destino y con otro', mismo === nueva && otro === nueva, `mismo=${String(mismo)} otro=${String(otro)}`)
    const claveNueva = { nombre: 'id_nueva', tipo: 'RSA', cifrada: false }
    const conClaveNueva = conservarAlEditarSsh(previoClave, { ...nuevoClave, clave: claveNueva }, () => true)
    check('(e10) C58: con el mismo método, una clave nueva del formulario gana a la guardada', JSON.stringify(conClaveNueva.clave) === JSON.stringify(claveNueva), JSON.stringify(conClaveNueva.clave))
  }

  // ---------------------------------------------------------------------------
  hr('F - disponibleAgentes: solo true cuenta, se escribe siempre explícito')
  {
    const r = archivo({ conexiones: [cx('f1', { disponibleAgentes: undefined }), cx('f2', { disponibleAgentes: 'yes' }), cx('f3', { disponibleAgentes: false }), cx('f4')] })
    const s = store(r)
    const disp = s.listar().conexiones.map((c) => `${c.id}=${c.disponibleAgentes}`).join(' ')
    check('(f1) ausente y raro = no disponible; true = disponible', disp === 'f1=false f2=false f3=false f4=true', disp)
    const nueva = s.crear(entrada({ disponibleAgentes: false }))
    const crudo = lista(disco(r), 'conexiones')
    check('(f2) el valor raro se conserva en disco', crudo[1].disponibleAgentes === 'yes', JSON.stringify(crudo[1]))
    check('(f3) un alta lo escribe explícito', crudo.find((c) => c.id === nueva.id)?.disponibleAgentes === false, JSON.stringify(crudo.at(-1)))
    const sinValor = { ...entrada(), disponibleAgentes: undefined } as unknown as SshConexionInput
    const porDefecto = s.crear(sinValor)
    check('(f4) un alta sin valor vale true', porDefecto.disponibleAgentes === true && lista(disco(r), 'conexiones').at(-1)?.disponibleAgentes === true, `dto=${porDefecto.disponibleAgentes}`)
  }

  // ---------------------------------------------------------------------------
  hr('G/H - Alias único (contando ajenas) y validación de los campos')
  {
    const r = archivo({ conexiones: [cx('g1', { alias: 'Prod' }), cx('g2', { alias: 'Ajena', metodo: 'otro' }), cx('g3', { alias: 'De-B', profileId: 'pb' })] })
    const s = store(r)
    check('(g1) alias repetido sin distinguir mayúsculas', error(() => s.crear(entrada({ alias: 'prod' })))?.includes('"Prod"') === true, String(error(() => s.crear(entrada({ alias: 'prod' })))))
    check('(g2) cuenta el alias de una ajena del perfil', error(() => s.crear(entrada({ alias: 'ajena' })))?.includes('"Ajena"') === true, String(error(() => s.crear(entrada({ alias: 'ajena' })))))
    check('(g3) en otro perfil, el mismo alias vale', error(() => s.crear(entrada({ alias: 'de-b' }))) === null, 'alta en pa con el alias de pb')
    check('(g4) editar conservando el propio alias vale', error(() => s.editar('g1', { ...entrada(), alias: 'PROD' })) === null, 'g1 -> PROD')
    const malos: Array<[string, Partial<SshConexionInput>]> = [
      ['alias vacío', { alias: '  ' }],
      ['alias con «:»', { alias: 'a:b' }],
      ['alias de 121', { alias: 'x'.repeat(121) }],
      ['host -oProxyCommand=x', { host: '-oProxyCommand=x' }],
      ['host con espacio', { host: 'a b' }],
      ['host con %', { host: 'h%d' }],
      ['host con ${', { host: 'h${HOME}' }],
      ['host con @', { host: 'pruebas@servidor.ejemplo' }],
      ['host con /', { host: 'servidor.ejemplo/x' }],
      ['host IPv6 entre corchetes', { host: '[2001:db8::1]' }],
      ['host con :puerto', { host: 'servidor.ejemplo:22' }],
      ['host vacío', { host: '' }],
      ['usuario vacío', { usuario: ' ' }],
      ['usuario -l', { usuario: '-oX' }],
      ['usuario con espacio', { usuario: 'a b' }],
      ['usuario con ${', { usuario: '${USER}' }],
      ['puerto 0', { puerto: 0 }],
      ['puerto 65536', { puerto: 65536 }],
      ['puerto 22.5', { puerto: 22.5 }],
      ['método clave sin archivo elegido', { metodo: 'clave' }],
      ['método desconocido', { metodo: 'x' as never }],
      ['grupo que no existe', { grupoId: 'no-existe' }]
    ]
    for (const [nombre, cambios] of malos) {
      const e = error(() => s.crear(entrada(cambios)))
      check(`(h-) ${nombre} se rechaza`, e !== null, String(e))
    }
    const buenos: Array<[string, Partial<SshConexionInput>]> = [
      ['host nombre', { host: 'servidor.ejemplo' }],
      ['host IPv4', { host: '192.0.2.44' }],
      ['host IPv6 sin corchetes', { host: '2001:db8::1' }],
      ['host con _', { host: 'srv_01.ejemplo' }],
      ['usuario con @ (dominio)', { usuario: 'pruebas@dominio.ejemplo' }],
      ['puerto 1', { puerto: 1 }],
      ['puerto 65535', { puerto: 65535 }],
      ['claves del sistema', { metodo: 'sistema' }]
    ]
    for (const [nombre, cambios] of buenos) {
      const e = error(() => s.crear(entrada(cambios)))
      check(`(h+) ${nombre} vale`, e === null, String(e))
    }
    check('(h) los errores sueltos: host, usuario y puerto', errorHost('-x') !== null && errorUsuario('') !== null && errorPuerto('22') !== null && errorHost('servidor.ejemplo') === null, 'funciones puras')
    const textoAlta = readFileSync(r, 'utf-8')
    check('(h) un alta que no valida no escribe nada', error(() => s.crear(entrada({ host: 'a b' }))) !== null && readFileSync(r, 'utf-8') === textoAlta, 'archivo igual')
  }

  // ---------------------------------------------------------------------------
  hr('I - Grupos: nombre único, borrar manda a «Sin grupo», grupo huérfano')
  {
    const ajenaQueCita = cx('i-ajena', { metodo: 'otro', grupoId: 'GX' })
    const r = archivo({
      grupos: [{ id: 'GX', profileId: 'pa', nombre: 'Prod' }, { id: 'GB', profileId: 'pb', nombre: 'De B' }],
      conexiones: [cx('i1', { grupoId: 'GX' }), cx('i2', { grupoId: 'GX' }), ajenaQueCita, cx('i3', { grupoId: 'g-borrado-a-mano' }), cx('i4', { grupoId: 'GB' })]
    })
    const s = store(r)
    check('(i1) nombre de grupo repetido sin distinguir mayúsculas', error(() => s.crearGrupo('pa', 'prod')) !== null, String(error(() => s.crearGrupo('pa', 'prod'))))
    check('(i2) nombre vacío o de más de 80', error(() => s.crearGrupo('pa', ' ')) !== null && error(() => s.crearGrupo('pa', 'g'.repeat(81))) !== null, 'rechazados')
    const antes = readFileSync(r, 'utf-8')
    const l = s.listar()
    const i3 = l.conexiones.find((c) => c.id === 'i3')
    const i4 = l.conexiones.find((c) => c.id === 'i4')
    check('(i3) un grupo huérfano sale como «Sin grupo» con grupoDesconocido', i3?.grupoId === null && i3?.grupoDesconocido === true, JSON.stringify(i3))
    check('(i4) un grupo de OTRO perfil también es desconocido', i4?.grupoId === null && i4?.grupoDesconocido === true, JSON.stringify(i4))
    check('(i5) listar no reescribe el disco', readFileSync(r, 'utf-8') === antes, 'archivo igual')
    s.editar('i3', { ...entrada(), alias: 'srv-i3', grupoId: null })
    check('(i6) editar sin elegir grupo conserva el desconocido', lista(disco(r), 'conexiones').find((c) => c.id === 'i3')?.grupoId === 'g-borrado-a-mano', 'grupoId conservado')
    const nuevo = s.crearGrupo('pa', 'Nuevo')
    s.editar('i3', { ...entrada(), alias: 'srv-i3', grupoId: nuevo.id })
    check('(i7) elegir un grupo conocido lo sustituye', lista(disco(r), 'conexiones').find((c) => c.id === 'i3')?.grupoId === nuevo.id, 'grupo nuevo')
    const borrado = s.borrarGrupo('GX', 'pa')
    const doc = disco(r)
    const cs = lista(doc, 'conexiones')
    check('(i8) borrar el grupo: sus conocidas pasan a «Sin grupo»', borrado.borrado && borrado.conexionesMovidas === 2 && cs.filter((c) => c.grupoId === 'GX').length === 1, JSON.stringify(borrado))
    check('(i9) la ajena que lo citaba queda intacta', JSON.stringify(cs.find((c) => c.id === 'i-ajena')) === JSON.stringify(ajenaQueCita), 'ajena igual')
    check('(i10) borrar un grupo de otro perfil no hace nada', !s.borrarGrupo('GB', 'pa').borrado && lista(disco(r), 'grupos').some((g) => g.id === 'GB'), 'GB sigue')
  }

  // ---------------------------------------------------------------------------
  hr('J - Al arrancar se podan solo ENTRADAS; al borrar el perfil, también sus archivos')
  {
    const sinPerfil = { id: 'j-sin', alias: 'huérfana' }
    const r = archivo({
      grupos: [{ id: 'jg', profileId: 'pb', nombre: 'B' }],
      conexiones: [cx('j1'), cx('j2', { profileId: 'pb' }), cx('j3', { profileId: 'pb', metodo: 'otro' }), sinPerfil, cx('j4', { profileId: 'pc' })]
    })
    for (const id of ['j1', 'j2', 'j4']) writeFileSync(path.join(dirHuellas, id), 'x')
    writeFileSync(path.join(dirClaves, 'j4'), 'clave')
    const s = store(r)
    s.podarPerfiles(new Set(['pa', 'pc']))
    const ids = lista(disco(r), 'conexiones').map((c) => c.id).join(',')
    check('(j1) se van las entradas (conocidas, ajenas y grupos) del perfil que no existe', ids === 'j1,j-sin,j4' && lista(disco(r), 'grupos').length === 0, ids)
    check('(j2) pero NO sus archivos', existsSync(path.join(dirHuellas, 'j2')), 'huellas/j2 sigue')
    s.alBorrarPerfil('pc')
    check('(j3) borrar el perfil quita sus entradas y sus archivos', !lista(disco(r), 'conexiones').some((c) => c.id === 'j4') && !existsSync(path.join(dirHuellas, 'j4')) && !existsSync(path.join(dirClaves, 'j4')), 'j4 fuera')
    check('(j4) la entrada sin perfil legible se conserva', lista(disco(r), 'conexiones').some((c) => c.id === 'j-sin'), 'j-sin sigue')
    s.borrar('j1', 'pa')
    check('(j5) borrar una conexión borra su known_hosts', !existsSync(path.join(dirHuellas, 'j1')), 'huellas/j1 fuera')
    const r2 = archivo({ conexiones: [cx('jx'), cx('jx', { profileId: 'pb', alias: 'copia' })] })
    writeFileSync(path.join(dirHuellas, 'jx'), 'x')
    const s2 = store(r2)
    s2.borrar('jx', 'pa')
    check('(j6) si otra entrada cita el mismo id, su archivo se queda', existsSync(path.join(dirHuellas, 'jx')), 'huellas/jx sigue')
    check('(j7) borrar en otro perfil no borra nada', !store(archivo({ conexiones: [cx('jy')] })).borrar('jy', 'pb').borrada, 'borrada=false')
  }

  // ---------------------------------------------------------------------------
  hr('K - Cambiado por fuera con Tessera abierta: se niega a pisarlo')
  {
    const r = archivo({ conexiones: [cx('k1')] })
    const s = store(r)
    writeFileSync(r, JSON.stringify({ conexiones: [cx('k1'), cx('k2')] }))
    const fuera = readFileSync(r, 'utf-8')
    check('(k1) un cambio válido por fuera no se pisa', error(() => s.crear(entrada())) === MENSAJE_CAMBIADO_FUERA_SSH && readFileSync(r, 'utf-8') === fuera, 'archivo intacto')
    const r2 = archivo({ conexiones: [cx('k3')] })
    const s2 = store(r2)
    writeFileSync(r2, JSON.stringify({ conexiones: [cx('k3')] }))
    check('(k2) el mismo contenido con otro formato sí se escribe', error(() => s2.crear(entrada())) === null, 'escrito')
    const r3 = archivo({ conexiones: [cx('k4')] })
    const s3 = store(r3)
    writeFileSync(r3, '{ roto')
    check('(k3) un archivo roto por fuera no se pisa', error(() => s3.crear(entrada()))?.includes('no es JSON válido') === true && readFileSync(r3, 'utf-8') === '{ roto', 'intacto')
  }

  // ---------------------------------------------------------------------------
  hr('L - Principal roto: se usa el .bak y el roto se guarda aparte (.ilegible)')
  {
    const r = archivo('{ roto: sí')
    writeFileSync(`${r}.bak`, JSON.stringify({ conexiones: [cx('l1')] }))
    const s = store(r)
    const l = s.listar()
    check('(l1) se listan las del .bak con el aviso de recuperado', !l.formatoAjeno && l.conexiones.length === 1 && typeof l.recuperado === 'string', String(l.recuperado).slice(0, 70))
    s.crear(entrada())
    const copia = `${r}.ilegible`
    check('(l2) la primera escritura guarda el roto aparte', existsSync(copia) && readFileSync(copia, 'utf-8') === '{ roto: sí', 'copia .ilegible')
    check('(l3) y el aviso cuenta dónde quedó', s.listar().recuperado?.includes('ssh-connections.json.ilegible') === true, String(s.listar().recuperado).slice(-80))
    const r2 = archivo('{ roto')
    const s2 = store(r2)
    check('(l4) roto y sin .bak: bloqueado, sin altas y sin tocarlo', s2.formatoAjeno && error(() => s2.crear(entrada())) !== null && readFileSync(r2, 'utf-8') === '{ roto', String(s2.listar().aviso).slice(0, 60))
    const r3 = archivo('{ roto')
    writeFileSync(`${r3}.bak`, JSON.stringify({ conexiones: [cx('l3')] }))
    const s3 = store(r3)
    writeFileSync(r3, JSON.stringify({ conexiones: [cx('l3'), cx('l4')] }))
    check('(l5) el roto corregido a mano con Tessera abierta no se pisa', error(() => s3.crear(entrada())) === MENSAJE_RESCATADO_CORREGIDO_SSH, 'negado')
    const carpeta = path.join(dir, 'es-una-carpeta.json')
    mkdirSync(carpeta)
    const s4 = store(carpeta)
    const e = error(() => s4.crear(entrada()))
    check('(l6) un principal que no se deja abrir se bloquea y el aviso no lleva rutas', s4.formatoAjeno && e !== null && !e.includes(dir), String(e).slice(0, 80))
  }

  // ---------------------------------------------------------------------------
  hr('M/N - El DTO no lleva secretos ni rutas; huellas del known_hosts propio')
  {
    const secreto = Buffer.from('ENC:secreto-123').toString('base64')
    const ilegible = Buffer.from('OTRA-MAQUINA').toString('base64')
    const r = archivo({ conexiones: [cx('m1', { metodo: 'contrasena', secretEnc: secreto }), cx('m2', { metodo: 'contrasena', secretEnc: ilegible }), cx('m3', { metodo: 'clave', clave: { nombre: 'id_prod.pem', tipo: 'rsa', cifrada: true, ruta: 'X' } }), cx('m4', { host: '127.0.0.1', puerto: 2222 })] })
    const s = store(r)
    const l = s.listar()
    const texto = JSON.stringify(l)
    const m1 = l.conexiones.find((c) => c.id === 'm1')
    const m2 = l.conexiones.find((c) => c.id === 'm2')
    const m3 = l.conexiones.find((c) => c.id === 'm3')
    check('(m1) ni secretEnc ni el secreto ni la carpeta de datos en el DTO', !texto.includes('secretEnc') && !texto.includes(secreto) && !texto.includes(dir) && !texto.includes('huellas'), `${texto.length} caracteres`)
    check('(m2) tieneSecreto y secretoIlegible', m1?.tieneSecreto === true && m1.secretoIlegible === undefined && m2?.secretoIlegible === true, `m1=${m1?.tieneSecreto}/${m1?.secretoIlegible} m2=${m2?.secretoIlegible}`)
    check('(m3) de la clave, solo nombre, tipo y si está cifrada', JSON.stringify(m3?.clave) === '{"nombre":"id_prod.pem","tipo":"rsa","cifrada":true}', JSON.stringify(m3?.clave))
    const rk = archivo({ conexiones: [cx('k1', { metodo: 'contrasena', secretEnc: secreto }), cx('k2', { metodo: 'contrasena', secretEnc: ilegible }), cx('k3', { profileId: 'pb', metodo: 'contrasena', secretEnc: secreto })] })
    const sk = new ConexionesSsh({ storePath: rk, dirHuellas, dirClaves, cifrado: cifradoFalso, log: () => {} })
    const soloPb = sk.listar('pb')
    check('(m3c) E38: la lista de un perfil trae solo lo suyo', JSON.stringify(soloPb.conexiones.map((c) => c.id)) === '["k3"]' && soloPb.formatoAjeno === false, JSON.stringify(soloPb.conexiones.map((c) => c.id)))

    // Una clave real si hay ssh-keygen: su huella se cruza con la que enseña el propio ssh-keygen.
    const keygen = resolverBinariosSsh().sshKeygen
    let blob = randomBytes(51).toString('base64')
    let esperada = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')
    let fuente = 'calculada con node:crypto (sin ssh-keygen)'
    if (keygen) {
      const k = path.join(dir, 'clave_prueba')
      spawnSync(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', 'prueba', '-f', k], { windowsHide: true })
      const huella = spawnSync(keygen, ['-l', '-E', 'sha256', '-f', `${k}.pub`], { windowsHide: true, encoding: 'utf-8' }).stdout
      const pub = existsSync(`${k}.pub`) ? readFileSync(`${k}.pub`, 'utf-8').trim().split(/\s+/) : []
      const deKeygen = /SHA256:([A-Za-z0-9+/]+)/.exec(String(huella))?.[1]
      if (pub[1] && deKeygen) {
        blob = pub[1]
        esperada = deKeygen
        fuente = 'la de ssh-keygen -l'
      }
    }
    const patron = '[127.0.0.1]:2222'
    const sal = randomBytes(20)
    const cifrado = `|1|${sal.toString('base64')}|${createHmac('sha1', sal).update(patron).digest('base64')}`
    writeFileSync(
      path.join(dirHuellas, 'm4'),
      ['# comentario', `${patron} ssh-ed25519 ${blob}`, `${cifrado} ssh-ed25519 ${blob}`, `otro.ejemplo ssh-rsa ${randomBytes(30).toString('base64')}`, `@revoked ${patron} ssh-rsa ${randomBytes(30).toString('base64')}`].join('\n')
    )
    const m4 = store(r).listar().conexiones.find((c) => c.id === 'm4')
    check(
      '(n1) la huella del host:puerto vigente, sin repetir, sin otros hosts ni revocadas',
      m4?.huellaServidor.length === 1 && m4.huellaServidor[0].algoritmo === 'ssh-ed25519' && m4.huellaServidor[0].sha256 === esperada,
      `${JSON.stringify(m4?.huellaServidor)} (esperada: ${fuente})`
    )
    const sinArchivo = l.conexiones.find((c) => c.id === 'm1')
    check('(n2) sin known_hosts, ninguna huella', Array.isArray(sinArchivo?.huellaServidor) && sinArchivo?.huellaServidor.length === 0, JSON.stringify(sinArchivo?.huellaServidor))
  }

  // ---------------------------------------------------------------------------
  hr('O - Canales: forma de las peticiones, aviso de cambio y entorno')
  {
    const handlers = new Map<string, (e: unknown, req?: unknown) => unknown>()
    const emitidos: string[] = []
    const ipc = { handle: (canal: string, h: (e: unknown, req?: unknown) => unknown) => void handlers.set(canal, h) }
    const ssh = new ControladorSsh({ conexiones: store(archivo(null)), eventos: { emitir: (c) => void emitidos.push(c), hayDestino: () => true }, log: () => {} })
    registrarIpcSsh({ ipc: ipc as never, ssh })
    const invocar = (canal: string, req?: unknown): unknown => handlers.get(canal)?.({}, req)
    const enviado = (canal: string, req?: unknown): string | null => error(() => invocar(canal, req))
    check(
      '(o1) se registran los trece canales invocables, con probar, olvidar la huella e importar de OpenSSH',
      handlers.size === 13 && handlers.has(SSH_CHANNELS.IMPORTAR_OPENSSH) && handlers.has(SSH_CHANNELS.PROBAR) && handlers.has(SSH_CHANNELS.HUELLA_OLVIDAR) && !handlers.has(SSH_CHANNELS.CAMBIO) && !handlers.has(SSH_CHANNELS.AVISO),
      [...handlers.keys()].join(' ')
    )
    const claveRara = enviado(SSH_CHANNELS.CREAR, { ...entrada(), metodo: 'clave', clave: { tipo: 'ruta', ruta: 'C:/x' } })
    check('(o1b) una clave que no es una ficha recién elegida es una petición mal formada', claveRara?.includes('mal formada') === true, String(claveRara))
    const sinRuta = enviado(SSH_CHANNELS.CLAVE_SOLTADA, { profileId: 'pa', ruta: 5 })
    check('(o1c) soltar sin una ruta de texto es una petición mal formada', sinRuta?.includes('mal formada') === true, String(sinRuta))
    const sinPerfil = enviado(SSH_CHANNELS.CLAVE_SOLTADA, { ruta: 'C:/x/id_ed25519' })
    check('(o1d) soltar sin perfil también: la copia solo vale para una conexión de su perfil', sinPerfil?.includes('mal formada') === true && sinPerfil.includes('profileId'), String(sinPerfil))
    const g = invocar(SSH_CHANNELS.GRUPO_CREAR, { profileId: 'pa', nombre: 'Prod' }) as { id: string }
    const c = invocar(SSH_CHANNELS.CREAR, { ...entrada(), grupoId: g.id }) as { id: string; grupoId: string }
    check('(o2) crear grupo y conexión avisan con ssh:cambio', emitidos.length === 2 && emitidos.every((x) => x === SSH_CHANNELS.CAMBIO) && c.grupoId === g.id, emitidos.join(','))
    check('(o3) un puerto de texto es una petición mal formada y no avisa', enviado(SSH_CHANNELS.CREAR, { ...entrada(), puerto: '22' })?.includes('mal formada') === true && emitidos.length === 2, String(enviado(SSH_CHANNELS.CREAR, { ...entrada(), puerto: '22' })))
    check('(o4) sin objeto, mal formada', enviado(SSH_CHANNELS.BORRAR, null)?.includes('mal formada') === true, 'BORRAR null')
    invocar(SSH_CHANNELS.EDITAR, { id: c.id, input: { ...entrada(), alias: 'editada', grupoId: g.id } })
    invocar(SSH_CHANNELS.GRUPO_RENOMBRAR, { id: g.id, profileId: 'pa', nombre: 'Producción' })
    const l = invocar(SSH_CHANNELS.LISTAR) as SshListaConexiones
    check('(o5) editar y renombrar por los canales', l.conexiones[0]?.alias === 'editada' && l.grupos[0]?.nombre === 'Producción', `${l.conexiones[0]?.alias} / ${l.grupos[0]?.nombre}`)
    const gb = invocar(SSH_CHANNELS.GRUPO_BORRAR, { id: g.id, profileId: 'pa' }) as { conexionesMovidas: number }
    const b = invocar(SSH_CHANNELS.BORRAR, { id: c.id, profileId: 'pa' }) as { borrada: boolean }
    check('(o6) borrar grupo y conexión', gb.conexionesMovidas === 1 && b.borrada && (invocar(SSH_CHANNELS.LISTAR) as SshListaConexiones).conexiones.length === 0, JSON.stringify({ gb, b }))
    const ent = invocar(SSH_CHANNELS.ENTORNO) as { disponible: boolean; origen: string | null; aviso: string | null }
    check('(o7) el entorno dice si hay cliente SSH', typeof ent.disponible === 'boolean' && (ent.disponible ? ent.origen !== null : ent.aviso === 'sin-ssh'), JSON.stringify(ent))
    const secretoRaro = enviado(SSH_CHANNELS.CREAR, { ...entrada(), secreto: 5 })
    check('(o8) un secreto que no es texto es una petición mal formada', secretoRaro?.includes('mal formada') === true, String(secretoRaro))
    const conSecreto = invocar(SSH_CHANNELS.CREAR, { ...entrada(), secreto: 'por-el-canal' }) as { id: string; tieneSecreto: boolean }
    check('(o9) el secreto llega por el canal y el DTO solo dice que hay', conSecreto.tieneSecreto && !JSON.stringify(invocar(SSH_CHANNELS.LISTAR)).includes('por-el-canal'), JSON.stringify(conSecreto))
    writeFileSync(path.join(dirHuellas, conSecreto.id), '[192.0.2.10]:22 ssh-ed25519 AAAA\n')
    const antesOlvidar = emitidos.length
    invocar(SSH_CHANNELS.HUELLA_OLVIDAR, { id: conSecreto.id })
    check('(o10) olvidar la huella por el canal la vacía y avisa con ssh:cambio', readFileSync(path.join(dirHuellas, conSecreto.id), 'utf-8') === '' && emitidos.length === antesOlvidar + 1, emitidos.slice(antesOlvidar).join(','))
    const sinEjecutar = await Promise.resolve(invocar(SSH_CHANNELS.PROBAR, { id: conSecreto.id })).then(() => null, (x: Error) => x.message)
    check('(o11) probar sin con qué correr ssh: un error claro', sinEjecutar?.includes('no puede probar') === true, String(sinEjecutar))
  }

  // ---------------------------------------------------------------------------
  hr('Q - El secreto: de solo escritura, cifrado, nunca en el DTO; ilegible; C68')
  {
    const r = archivo(null)
    const s = store(r)
    const alta = s.crear(entrada({ alias: 'q-alta', secreto: 'contraseña ñ#1' }))
    const enDisco = (): Crudo => lista(disco(r), 'conexiones').find((x) => x.id === alta.id) as Crudo
    check(
      '(q1) el alta guarda el secreto CIFRADO y el DTO solo dice que hay',
      enDisco().secretEnc === Buffer.from('ENC:contraseña ñ#1').toString('base64') && alta.tieneSecreto && !JSON.stringify(s.listar()).includes('contraseña ñ#1'),
      String(enDisco().secretEnc)
    )
    check('(q2) secretoDe lo devuelve en claro (solo para el main)', s.secretoDe(alta.id) === 'contraseña ñ#1', 'secretoDe')
    const base = (extra: Partial<SshConexionInput> = {}): SshConexionInput => entrada({ alias: 'q-alta', ...extra })
    s.editar(alta.id, base())
    check('(q3) editar sin secreto lo conserva', s.secretoDe(alta.id) === 'contraseña ñ#1', 'conservado')
    s.editar(alta.id, base({ secreto: 'otra' }))
    check('(q4) un texto lo sustituye', s.secretoDe(alta.id) === 'otra', String(s.secretoDe(alta.id)))
    const borrada = s.editar(alta.id, base({ secreto: '' }))
    check("(q5) '' lo borra", !borrada.tieneSecreto && enDisco().secretEnc === undefined && s.secretoDe(alta.id) === null, JSON.stringify(enDisco()))
    const rechazos: Array<[string, Partial<SshConexionInput>, string]> = [
      ['un salto de línea', { secreto: 'a\nb' }, 'saltos de línea'],
      ['un retorno de carro', { secreto: 'a\rb' }, 'saltos de línea'],
      ['el carácter nulo', { secreto: `a${String.fromCharCode(0)}b` }, 'nulo'],
      ['más de 1000 bytes (501 «ñ»)', { secreto: 'ñ'.repeat(501) }, '1000 bytes'],
      ['un secreto con «Claves del sistema»', { metodo: 'sistema', secreto: 'x' }, 'Claves del sistema'],
      ['la frase de una clave con salto', { metodo: 'clave', secreto: 'a\nb' }, 'La frase de la clave']
    ]
    for (const [que, extra, texto] of rechazos) {
      const m = error(() => s.crear(entrada({ alias: `q6-${++n}`, ...extra })))
      check(`(q6) se rechaza ${que}`, m?.includes(texto) === true, String(m))
    }
    check('(q7) 1000 bytes justos (500 «ñ») valen', error(() => s.crear(entrada({ alias: 'q7', secreto: 'ñ'.repeat(500) }))) === null, '500 ñ')
    const sinAlmacen = new ConexionesSsh({ storePath: archivo(null), dirHuellas, dirClaves, cifrado: { ...cifradoFalso, disponible: () => false }, log: () => {} })
    const m8 = error(() => sinAlmacen.crear(entrada({ alias: 'q8', secreto: 'x' })))
    check('(q8) sin almacén del sistema no se guarda (nunca en claro); sin secreto, sí', m8?.includes('nunca la guarda en claro') === true && error(() => sinAlmacen.crear(entrada({ alias: 'q8b' }))) === null, String(m8))
    const sinCifrado = new ConexionesSsh({ storePath: archivo(null), dirHuellas, dirClaves, log: () => {} })
    check('(q9) sin cifrado inyectado, igual', error(() => sinCifrado.crear(entrada({ alias: 'q9', secreto: 'x' })))?.includes('nunca la guarda en claro') === true, 'sin cifrado')
    const sIl = store(archivo({ conexiones: [cx('q10', { metodo: 'contrasena', secretEnc: Buffer.from('OTRA-MAQUINA').toString('base64') })] }))
    const dtoIl = sIl.listar().conexiones[0]
    check('(q10) un secreto de otra máquina: tieneSecreto, secretoIlegible y secretoDe null', dtoIl.tieneSecreto && dtoIl.secretoIlegible === true && sIl.secretoDe('q10') === null, JSON.stringify(dtoIl))

    const frase = Buffer.from('ENC:frase-vieja').toString('base64')
    const previo = cx('q11', { metodo: 'clave', secretEnc: frase, clave: { nombre: 'id_vieja', tipo: 'Ed25519', cifrada: true } })
    const nuevo: ConexionSshPersistida = { id: 'q11', profileId: 'pa', alias: 'srv-q11', host: 'servidor.ejemplo', puerto: 22, usuario: 'pruebas', metodo: 'clave', disponibleAgentes: true }
    const otraClave = { nombre: 'id_nueva', tipo: 'RSA', cifrada: true }
    const conOtra = conservarAlEditarSsh(previo, { ...nuevo, clave: otraClave }, () => true)
    check('(q11) C68: una clave NUEVA descarta la frase de la anterior', conOtra.secretEnc === undefined && JSON.stringify(conOtra.clave) === JSON.stringify(otraClave), JSON.stringify(conOtra))
    const fraseNueva = Buffer.from('ENC:frase-nueva').toString('base64')
    const conOtraYFrase = conservarAlEditarSsh(previo, { ...nuevo, clave: otraClave, secretEnc: fraseNueva }, () => true, 'frase-nueva')
    check('(q12) C68: salvo que llegue una frase nueva, que gana', conOtraYFrase.secretEnc === fraseNueva, String(conOtraYFrase.secretEnc))
    check('(q13) sin clave nueva la frase se queda', conservarAlEditarSsh(previo, nuevo, () => true).secretEnc === frase, 'se queda')
    check("(q14) y con '' se borra", conservarAlEditarSsh(previo, nuevo, () => true, '').secretEnc === undefined, 'borrada')
    const rClave = archivo({ conexiones: [previo] })
    const sClave = store(rClave)
    const editada = sClave.editar('q11', entrada({ alias: 'srv-q11', host: 'servidor.ejemplo', puerto: 22, metodo: 'clave' }), { clave: otraClave })
    check('(q15) C68 en el registro: guardar otra clave sin frase deja la conexión sin secreto', !editada.tieneSecreto && lista(disco(rClave), 'conexiones')[0].secretEnc === undefined, JSON.stringify(editada))
  }

  // ---------------------------------------------------------------------------
  hr('R - Huellas: el texto del known_hosts propio y olvidarlas')
  {
    const s = store(archivo({ conexiones: [cx('r1', { host: '127.0.0.1', puerto: 2222 })] }))
    check('(r1) sin known_hosts, textoHuellas es null', s.textoHuellas('r1') === null, 'null')
    const linea = `[127.0.0.1]:2222 ssh-ed25519 ${randomBytes(51).toString('base64')}\n`
    writeFileSync(path.join(dirHuellas, 'r1'), linea)
    writeFileSync(path.join(dirHuellas, 'r1.old'), linea)
    check('(r2) con él, su texto y una huella en el DTO', s.textoHuellas('r1') === linea && s.listar().conexiones[0].huellaServidor.length === 1, JSON.stringify(s.listar().conexiones[0].huellaServidor))
    s.olvidarHuellas('r1')
    check(
      '(r3) olvidar: el known_hosts queda vacío (ninguna huella en el DTO) y el .old se va',
      readFileSync(path.join(dirHuellas, 'r1'), 'utf-8') === '' && !existsSync(path.join(dirHuellas, 'r1.old')) && s.listar().conexiones[0].huellaServidor.length === 0,
      JSON.stringify(s.listar().conexiones[0].huellaServidor)
    )
    check('(r4) olvidar las de una conexión que no existe se rechaza', error(() => s.olvidarHuellas('no-existe'))?.includes('ya no existe') === true, String(error(() => s.olvidarHuellas('no-existe'))))
  }

  // ---------------------------------------------------------------------------
  hr('P - Archivo de clave: alta, edición (C58), fallo del registro, cambio de método y borrado')
  {
    const dirP = path.join(dir, 'p')
    const dirClavesP = path.join(dirP, 'claves')
    const dirHuellasP = path.join(dirP, 'huellas')
    const origen = path.join(dirP, 'origen')
    mkdirSync(dirHuellasP, { recursive: true })
    mkdirSync(origen)
    let aElegir = ''
    let peticion: unknown = null
    const claves = new ClavesImportadas({
      dir: dirClavesP,
      plataforma: 'mac',
      elegirArchivo: async (opciones, candidatas) => {
        peticion = { opciones, candidatas }
        return { canceled: false, filePaths: [aElegir] }
      },
      home: path.join(dirP, 'home'),
      sshKeygen: () => 'ssh-keygen',
      permisos: {
        asegurarCarpeta: async (d) => void mkdirSync(d, { recursive: true }),
        escribirProtegida: async (r, t) => writeFileSync(r, t, { flag: 'wx' })
      },
      ejecutar: keygenFalso,
      log: () => {}
    })
    const rutaReg = path.join(dirP, 'ssh-connections.json')
    const conexiones = new ConexionesSsh({ storePath: rutaReg, dirHuellas: dirHuellasP, dirClaves: dirClavesP, log: () => {} })
    const binarios = (): ReturnType<typeof resolverBinariosSsh> => ({ ssh: { exe: 'ssh', args: [] }, scp: null, sshKeygen: null, origen: 'sistema', aviso: null, dePrueba: false })
    const ctrl = new ControladorSsh({ conexiones, claves, binarios, eventos: { emitir: () => {}, hayDestino: () => true }, plataforma: 'mac', log: () => {} })
    const elegir = async (nombre: string, texto: string, perfil = 'pa'): Promise<{ token: string; nombre: string; tipo: string | null; cifrada: boolean }> => {
      aElegir = path.join(origen, nombre)
      writeFileSync(aElegir, texto)
      const e = await ctrl.elegirClave({ profileId: perfil })
      if (e === null) throw new Error('el diálogo de mentira no se canceló')
      return e
    }
    const provisionales = (): string[] => readdirSync(dirClavesP).filter((f) => f.startsWith('.import-'))
    const ficha = (token: string): Partial<SshConexionInput> => ({ metodo: 'clave', clave: { tipo: 'elegida', token } })

    check('(p1) alta con «Archivo de clave» y sin archivo: se rechaza', error(() => ctrl.crear(entrada({ metodo: 'clave' }))) === MENSAJE_FALTA_CLAVE, String(error(() => ctrl.crear(entrada({ metodo: 'clave' })))))
    const textoA = claveSintetica('none', 'ssh-ed25519')
    const original = textoA.replace(/\n/g, '\r\n')
    const a = await elegir('id_prueba', original)
    check('(p2) elegir deja UNA copia provisional y devuelve ficha, nombre y tipo (sin rutas)', provisionales().length === 1 && a.nombre === 'id_prueba' && a.tipo === 'Ed25519' && !a.cifrada && !JSON.stringify(a).includes(dirP), JSON.stringify(a))
    const pedido = peticion as { opciones: { properties: string[] }; candidatas: { despues: string[] } } | null
    check(
      '(p2b) el diálogo abre un archivo y, sin nada recordado, en ~/.ssh',
      pedido !== null && pedido.opciones.properties.includes('openFile') && !pedido.opciones.properties.includes('openDirectory') && pedido.candidatas.despues[0] === path.join(dirP, 'home', '.ssh'),
      JSON.stringify(pedido?.candidatas)
    )

    ctrl.crear(entrada({ alias: 'ocupado' }))
    const repetida = error(() => ctrl.crear(entrada({ alias: 'ocupado', ...ficha(a.token) })))
    check('(p3) un alta que no valida devuelve la copia a provisional: la ficha sigue valiendo', repetida?.includes('"ocupado"') === true && provisionales().length === 1 && readdirSync(dirClavesP).length === 1, `${repetida} · ${readdirSync(dirClavesP).join(',')}`)

    const c = ctrl.crear(entrada({ alias: 'con-clave', ...ficha(a.token) }))
    const rutaC = path.join(dirClavesP, c.id)
    check('(p4) el alta deja la copia en claves/<id>, normalizada (LF) y sin la provisional', existsSync(rutaC) && provisionales().length === 0 && readFileSync(rutaC, 'utf-8') === textoA, readdirSync(dirClavesP).join(','))
    check('(p4b) el original no se toca', readFileSync(aElegir, 'utf-8') === original, 'CRLF intacto')
    const enDisco = lista(disco(rutaReg), 'conexiones').find((x) => x.id === c.id)
    check('(p4c) el DTO y el disco llevan nombre, tipo y frase; ninguna ruta', JSON.stringify(c.clave) === '{"nombre":"id_prueba","tipo":"Ed25519","cifrada":false}' && JSON.stringify(enDisco?.clave) === JSON.stringify(c.clave) && !JSON.stringify(ctrl.listar()).includes(dirP), JSON.stringify(enDisco?.clave))
    check('(p4d) la ficha se gastó: no sirve para otra alta', error(() => ctrl.crear(entrada({ ...ficha(a.token) }))) === MENSAJE_FICHA_CLAVE, 'ficha gastada')

    const sinTocar = ctrl.editar({ id: c.id, input: entrada({ alias: 'con-clave', puerto: 2222, metodo: 'clave' }) })
    check('(p5) editar sin elegir otra: se conserva la clave importada (registro y archivo)', JSON.stringify(sinTocar.clave) === JSON.stringify(c.clave) && readFileSync(rutaC, 'utf-8') === textoA, JSON.stringify(sinTocar.clave))

    const textoB = claveSintetica('aes256-ctr', 'ecdsa-sha2-nistp256')
    const b = await elegir('id_nueva', textoB)
    const conB = ctrl.editar({ id: c.id, input: entrada({ alias: 'con-clave', ...ficha(b.token) }) })
    check(
      '(p6) C58: editar con otra clave gana la nueva, en el registro y en el archivo, sin dejar .anterior',
      conB.clave?.nombre === 'id_nueva' && conB.clave.cifrada && conB.clave.tipo === 'ECDSA P-256' && readFileSync(rutaC, 'utf-8') === textoB && !existsSync(`${rutaC}.anterior`) && provisionales().length === 0,
      JSON.stringify(conB.clave)
    )

    const cc = await elegir('id_tercera', claveSintetica('none', 'ssh-rsa'))
    const antes = readFileSync(rutaReg, 'utf-8')
    writeFileSync(rutaReg, JSON.stringify({ conexiones: [cx('cambiada-fuera')] }))
    const cortada = error(() => ctrl.editar({ id: c.id, input: entrada({ alias: 'con-clave', ...ficha(cc.token) }) }))
    check(
      '(p7) si el registro falla al editar, la clave anterior vuelve a su sitio y la nueva a provisional',
      cortada === MENSAJE_CAMBIADO_FUERA_SSH && readFileSync(rutaC, 'utf-8') === textoB && !existsSync(`${rutaC}.anterior`) && provisionales().length === 1,
      `${cortada} · ${readdirSync(dirClavesP).join(',')}`
    )
    writeFileSync(rutaReg, antes)

    const prep = ctrl.preparar('pa', c.id).ejecutable?.args ?? []
    check('(p8) la línea usa la copia importada con -o IdentityFile y solo esa clave', prep.includes(`IdentityFile=${citarRutaOpcion(rutaC, 'mac')}`) && prep.includes('IdentitiesOnly=yes'), prep.filter((x) => x.startsWith('Identit')).join(' '))
    rmSync(rutaC)
    check('(p8b) sin la copia no hay línea: nunca se cae a las claves por defecto', error(() => ctrl.preparar('pa', c.id)) === MENSAJE_SIN_COPIA_CLAVE, String(error(() => ctrl.preparar('pa', c.id))))
    writeFileSync(rutaC, textoB)

    const otroPerfil = await elegir('id_otro', claveSintetica('none', 'ssh-ed25519'), 'pb')
    const ajena = error(() => ctrl.crear(entrada({ alias: 'otro-perfil', ...ficha(otroPerfil.token) })))
    check('(p9) una ficha elegida para otro perfil no vale, y no se mueve nada', ajena?.includes('otro perfil') === true && provisionales().length === 2, `${ajena} · ${provisionales().length}`)

    ctrl.editar({ id: c.id, input: entrada({ alias: 'con-clave', metodo: 'contrasena' }) })
    check('(p10) pasar a contraseña deja la conexión sin clave y borra su copia', !existsSync(rutaC) && lista(disco(rutaReg), 'conexiones').find((x) => x.id === c.id)?.clave === undefined, readdirSync(dirClavesP).join(','))

    const d = ctrl.crear(entrada({ alias: 'a-borrar', ...ficha(cc.token) }))
    const rutaD = path.join(dirClavesP, d.id)
    writeFileSync(`${rutaD}.anterior`, 'resto de una edición cortada')
    ctrl.borrar({ id: d.id, profileId: 'pa' })
    check('(p11) borrar la conexión borra su copia y la .anterior', !existsSync(rutaD) && !existsSync(`${rutaD}.anterior`), readdirSync(dirClavesP).join(','))

    const e = ctrl.crear(entrada({ alias: 'del-perfil', profileId: 'pc', ...ficha((await elegir('id_pc', claveSintetica('none', 'ssh-ed25519'), 'pc')).token) }))
    ctrl.alBorrarPerfil('pc')
    check('(p12) borrar el perfil borra las copias de sus conexiones', !existsSync(path.join(dirClavesP, e.id)), readdirSync(dirClavesP).join(','))

    const vacia = await ctrl.claveSoltada({ profileId: 'pa', ruta: '' }).then(() => null, (x: Error) => x.message)
    const pub = path.join(origen, 'id_prueba.pub')
    writeFileSync(pub, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ prueba\n')
    const publica = await ctrl.claveSoltada({ profileId: 'pa', ruta: pub }).then(() => null, (x: Error) => x.message)
    check('(p13) soltar: sin ruta, o la pública, se rechaza con su porqué y sin dejar copia', vacia !== null && publica?.includes('es la clave pública') === true && !publica.includes(origen) && provisionales().length === 1, `${vacia} · ${publica}`)

    const rutaSoltada = path.join(origen, 'id_soltada')
    writeFileSync(rutaSoltada, claveSintetica('none', 'ssh-ed25519'))
    const soltada = await ctrl.claveSoltada({ profileId: 'pb', ruta: rutaSoltada })
    const enOtro = error(() => ctrl.crear(entrada({ alias: 'soltada-en-pa', ...ficha(soltada.token) })))
    const enSuyo = ctrl.crear(entrada({ alias: 'soltada-en-pb', profileId: 'pb', ...ficha(soltada.token) }))
    check(
      '(p14) una clave SOLTADA queda atada a su perfil, como la elegida: en otro no vale y en el suyo sí',
      enOtro?.includes('otro perfil') === true && enSuyo.clave?.nombre === 'id_soltada' && existsSync(path.join(dirClavesP, enSuyo.id)) && provisionales().length === 1,
      `${enOtro} · ${JSON.stringify(enSuyo.clave)}`
    )

    // C78: la ruta de la copia la calcula un solo sitio.
    check('(p17) C78: el registro y las claves importadas dan la misma ruta de copia', claves.rutaDe(enSuyo.id) === conexiones.rutaClave(enSuyo.id) && claves.rutaDe(enSuyo.id) === path.join(dirClavesP, enSuyo.id), conexiones.rutaClave(enSuyo.id))
    check('(p18) C78: y los dos rechazan el mismo id que no vale', error(() => claves.rutaDe('../x')) !== null && error(() => conexiones.rutaClave('../x')) !== null, String(error(() => claves.rutaDe('../x'))))
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* la carpeta temporal la recoge el sistema */
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
