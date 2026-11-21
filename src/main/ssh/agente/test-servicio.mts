// =============================================================================
// Frontera del buzón: autorización por token, revocación durante el diálogo y registro sin secretos.
// Comprueba peticiones de firma y cambios de permisos para impedir usos que ya no estén autorizados.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { crearCarpetaTemporal } from '../../../../scripts/pruebas/temporales.mts'
import { execFileSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Perfil } from '../../perfiles/types.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { AgenteSshHost, SILENCIO_TRAS_CANCELAR_MS } from './servicio.ts'
import { leerClave } from './lectorClaves.ts'
import { cadena, entero, Lector } from './protocolo.ts'
import { FrasesAgente } from './frases.ts'
import { registrarIpcAgenteSsh } from './ipc.ts'
import { CANAL_GUARDAR_CLAVES_AGENTE } from '../../../shared/ssh-agente-ipc.ts'

let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
hr('El host autoriza cada orden del agente')
const carpeta = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-agente-'))
try {
  mkdirSync(path.join(carpeta, '.ssh'))
  const ruta = path.join(carpeta, '.ssh', 'id_ed25519')
  const frase = 'Frase de prueba del host'
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', frase, '-f', ruta], { windowsHide: true, stdio: 'pipe' })
  const texto = readFileSync(ruta, 'utf8')
  const clave = leerClave(texto, frase)
  const perfil: Perfil = { id: 'a', nombre: 'A', color: '#123456', agentes: [], sandbox: { habilitado: true }, clavesSshPermitidas: [ruta] }
  const otro: Perfil = { ...perfil, id: 'b', clavesSshPermitidas: [] }
  let tokenVigente = true
  let alPreguntar = (): void => {}
  let preguntas = 0
  let secreto: string | null = null
  let respuestaFrase: string | null = frase
  const registro: string[] = []
  const servicio = new AgenteSshHost({ perfiles: () => [perfil, otro], sesion: (token) => tokenVigente && ['a', 'b'].includes(token) ? { profileId: token, projectHostPath: '', espacioDatos: false } : null,
    dialogo: { preguntar: async () => { preguntas++; alPreguntar(); return respuestaFrase }, retirar: () => {} }, fraseGuardada: () => secreto, guardarFrase: (_ruta, valor) => { secreto = valor }, auditar: (linea) => registro.push(linea), dirTssh: '', entorno: { home: carpeta, usuario: 'usuario', plataforma: plataformaActual() } })
  const datos = Buffer.from('Reto de autenticación')
  const mensaje = Buffer.concat([Buffer.from([13]), cadena(clave.publica), cadena(datos), entero(0)]).toString('base64')
  const material = await servicio.atender({ token: 'a', operacion: 'material' })
  check('solo material público', material.exitCode === 0 && !JSON.stringify(material).includes('PRIVATE KEY') && !JSON.stringify(material).includes(frase) && !JSON.stringify(material).includes(carpeta))
  check('no pide frase al listar pública OpenSSH cifrada', preguntas === 0)
  const resultado = await servicio.atender({ token: 'a', mensaje })
  const lector = new Lector(Buffer.from(resultado.respuesta as string, 'base64'))
  check('respuesta de firma', resultado.exitCode === 0 && lector.bytes(1)[0] === 14)
  const firma = new Lector(lector.cadena())
  check('firma válida del host', firma.texto() === 'ssh-ed25519' && verify(null, datos, createPublicKey(clave.privada), firma.cadena()))
  check('frase solo se solicita y guarda en el host', preguntas === 1 && secreto === frase)
  check('no devuelve frase ni clave privada', !JSON.stringify(resultado).includes(frase) && !JSON.stringify(resultado).includes(texto))
  check('otro perfil no firma', (await servicio.atender({ token: 'b', mensaje, ruta })).exitCode !== 0)
  check('token inventado no firma', (await servicio.atender({ token: 'inventado', mensaje })).exitCode !== 0)
  perfil.clavesSshPermitidas = []
  check('revocación inmediata', (await servicio.atender({ token: 'a', mensaje })).exitCode !== 0)
  perfil.clavesSshPermitidas = [ruta]
  secreto = null
  alPreguntar = () => { perfil.clavesSshPermitidas = [] }
  check('revalida permisos después del diálogo', (await servicio.atender({ token: 'a', mensaje })).exitCode !== 0)
  perfil.clavesSshPermitidas = [ruta]
  secreto = null
  alPreguntar = () => { tokenVigente = false }
  check('revalida token después del diálogo', (await servicio.atender({ token: 'a', mensaje })).exitCode !== 0)
  check('registro por huella y perfil', registro.some((linea) => linea.includes('perfil="a"') && linea.includes('clave=SHA256:') && linea.includes('cuando=')))
  check('registro sin datos, secretos ni rutas', registro.every((linea) => !linea.includes(frase) && !linea.includes(carpeta) && !linea.includes(datos.toString())))
  check('rechazos quedan registrados', registro.some((linea) => linea.includes('sin autorización')))
  tokenVigente = true
  alPreguntar = () => {}
  secreto = null
  respuestaFrase = null
  const antesCancelar = preguntas
  await servicio.atender({ token: 'a', mensaje })
  await servicio.atender({ token: 'a', mensaje })
  check('cancelar no repite la frase en la siguiente petición', preguntas === antesCancelar + 1)
  const reloj = Date.now
  try {
    Date.now = () => reloj() + SILENCIO_TRAS_CANCELAR_MS + 1
    await servicio.atender({ token: 'a', mensaje })
    check('pasado el silencio, vuelve a preguntar', preguntas === antesCancelar + 2)
  } finally { Date.now = reloj }
  respuestaFrase = null
  await servicio.atender({ token: 'a', mensaje })
  const antesGuardada = preguntas
  secreto = frase
  check('una frase guardada se usa aunque se haya cancelado', (await servicio.atender({ token: 'a', mensaje })).exitCode === 0 && preguntas === antesGuardada)
  secreto = null
  const pem = path.join(carpeta, '.ssh', 'pem_sin_publica')
  execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-m', 'PEM', '-N', frase, '-f', pem], { windowsHide: true, stdio: 'pipe' })
  const textoPublicaPem = readFileSync(pem + '.pub', 'utf8')
  rmSync(pem + '.pub')
  const publicaSk = Buffer.concat([cadena('sk-ssh-ed25519@openssh.com'), cadena(Buffer.alloc(32)), cadena('ssh:')])
  const sk = path.join(carpeta, '.ssh', 'id_ed25519_sk')
  const bytesSk = Buffer.concat([Buffer.from('openssh-key-v1\0'), cadena('none'), cadena('none'), cadena(Buffer.alloc(0)), entero(1), cadena(publicaSk), cadena(Buffer.alloc(0))])
  writeFileSync(sk, `-----BEGIN OPENSSH PRIVATE KEY-----\n${bytesSk.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----\n`)
  writeFileSync(path.join(carpeta, '.ssh', 'config'), `Host pem\n IdentityFile "${pem.replace(/\\/g, '/')}"\n`)
  perfil.clavesSshPermitidas = [pem, sk]
  const antesOmitir = preguntas
  const omitidas = await servicio.atender({ token: 'a', operacion: 'material' })
  await servicio.atender({ token: 'a', operacion: 'material' })
  check('PEM sin pública y hardware no solicitan frase', preguntas === antesOmitir && omitidas.exitCode === 0 && (omitidas.publicas as unknown[]).length === 0)
  check('identidades omitidas registran su motivo', registro.filter((linea) => linea.includes('omision=')).length >= 4)
  writeFileSync(pem + '.pub', textoPublicaPem)
  perfil.clavesSshPermitidas = [pem]
  respuestaFrase = frase
  secreto = null
  const clavePem = leerClave(readFileSync(pem, 'utf8'), frase)
  const mensajePem = Buffer.concat([Buffer.from([13]), cadena(clavePem.publica), cadena(datos), entero(2)]).toString('base64')
  const antesPem = preguntas
  const firmaPem = await servicio.atender({ token: 'a', mensaje: mensajePem })
  check('PEM cifrado con pública solicita frase solo al firmar', firmaPem.exitCode === 0 && preguntas === antesPem + 1)
  hr('Persistencia cifrada de frases')
  const archivo = path.join(carpeta, 'frases.json')
  const cifrado = { disponible: () => true, cifrar: (valor: string) => Buffer.from(Buffer.from(valor).map((b) => b ^ 0xaa)), descifrar: (valor: Buffer) => Buffer.from(valor.map((b) => b ^ 0xaa)).toString() }
  const frases = new FrasesAgente(archivo, cifrado)
  frases.guardar(ruta, frase)
  check('frase persistida cifrada', !readFileSync(archivo, 'utf8').includes(frase) && new FrasesAgente(archivo, cifrado).leer(ruta) === frase)
  check('sin almacén seguro no se descifra', new FrasesAgente(archivo, { ...cifrado, disponible: () => false }).leer(ruta) === null)
  hr('El IPC solo guarda rutas del catálogo')
  const manejadores = new Map<string, (perfil: string, rutas?: unknown) => unknown>()
  let guardadas: string[] | null = null
  registrarIpcAgenteSsh({ ipc: { handle: (canal, manejar) => { manejadores.set(canal, (id, rutas) => manejar({} as never, id, rutas)) } }, listar: () => servicio.listar('a'), guardar: (_perfil, rutas) => { guardadas = rutas } })
  const guardar = manejadores.get(CANAL_GUARDAR_CLAVES_AGENTE)!
  await guardar('a', [ruta, ruta])
  check('IPC deduplica rutas elegidas', guardadas !== null && (guardadas as string[]).length === 1)
  for (const invalida of [['/clave-ajena'], [12], null, 'todas']) {
    let rechazo = false
    guardadas = null
    try { await guardar('a', invalida) } catch { rechazo = true }
    check('IPC rechaza rutas ajenas o malformadas sin guardar', rechazo && guardadas === null)
  }
} catch (error) { check(String(error), false) }
finally { rmSync(carpeta, { recursive: true, force: true }) }
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
