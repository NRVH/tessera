// =============================================================================
// Aceptación con Docker: git local, socket SSH real y firmas del host por el buzón sin privadas.
// Comprueba el recorrido completo para detectar fallos de integración entre git y el agente SSH.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { execFileSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GestorSandbox } from '../sandbox/GestorSandbox.ts'
import { fijarBaseGestionada } from '../sandbox/gestor/nombres.ts'
import { PuenteDocker } from '../db/puenteDocker.ts'
import { AgenteSshHost } from '../ssh/agente/servicio.ts'
import { leerClave } from '../ssh/agente/lectorClaves.ts'
import { cadena, entero, Lector } from '../ssh/agente/protocolo.ts'
import { componerComandoGitLimpio, asignacionesBdAgente } from './gitEnContenedor.ts'
import { citarSh } from '../../shared/citarShell.ts'
import { esLinux, plataformaActual } from '../../shared/plataforma.ts'
import type { Perfil } from '../perfiles/types.ts'

let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const carpeta = mkdtempSync(path.join(raiz, '.tmp-git-p5-'))
const repo = path.join(carpeta, 'repo')
const ssh = path.join(carpeta, '.ssh')
mkdirSync(repo); mkdirSync(ssh)
const rutaClave = path.join(ssh, 'id_ed25519')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', rutaClave], { windowsHide: true })
const clave = leerClave(readFileSync(rutaClave, 'utf8'))
const perfil: Perfil = { id: 'git-p5', nombre: 'Prueba', color: '#123456', agentes: [], sshDir: ssh, clavesSshPermitidas: [rutaClave], sandbox: { habilitado: true, redHost: esLinux() } }
const registro: string[] = []
const servicio = new AgenteSshHost({ perfiles: () => [perfil], sesion: (token) => token === 'prueba-p5' ? { profileId: perfil.id, projectHostPath: repo, espacioDatos: false } : null, dialogo: { preguntar: async () => null, retirar: () => {} }, fraseGuardada: () => null, guardarFrase: () => {}, auditar: (linea) => registro.push(linea), dirTssh: path.join(raiz, 'src', 'tssh'), entorno: { home: carpeta, usuario: 'prueba', plataforma: plataformaActual() } })
const buzon = new PuenteDocker({ raiz: path.join(carpeta, 'buzones'), clienteOrigen: path.join(raiz, 'src', 'tdb', 'tdb-container.cjs'), ejecutar: async () => ({ exitCode: 1, stdout: '', stderr: '' }) })
buzon.registrarPrograma(servicio.programa())
fijarBaseGestionada(path.join(carpeta, 'datos'), false)
const sandbox = new GestorSandbox()
sandbox.fijarPuenteDb((id) => buzon.prepararPerfil(id), (id) => buzon.olvidarPerfil(id))
const entorno = asignacionesBdAgente({ TESSERA_DB_SESSION: 'prueba-p5', TESSERA_DB_BRIDGE: '/agent-config/dbbridge' })
const ejecutar = (orden: string) => sandbox.exec(perfil, componerComandoGitLimpio(orden, { asignacionesExtra: entorno }), { proyecto: repo })
try {
  hr('Git y agente SSH por el buzón')
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, windowsHide: true })
  writeFileSync(path.join(repo, 'prueba.txt'), 'Prueba\n')
  await sandbox.ensureContainer(perfil)
  await sandbox.addProject(perfil, repo)
  const git = await ejecutar('git -c user.name=Prueba -c user.email=prueba@example.test add prueba.txt && git -c user.name=Prueba -c user.email=prueba@example.test commit -m prueba && git status --porcelain')
  check('git local funciona', git.exitCode === 0)
  const lista = await ejecutar('ssh-add -L')
  check('ssh ve la identidad pública permitida', lista.exitCode === 0 && lista.stdout.includes(clave.publica.toString('base64')))
  const reto = Buffer.from('Reto desde el socket del contenedor')
  const mensaje = Buffer.concat([Buffer.from([13]), cadena(clave.publica), cadena(reto), entero(0)])
  const trama = Buffer.concat([entero(mensaje.length), mensaje]).toString('base64')
  const cliente = `const n=require('node:net'),s=n.connect(process.env.SSH_AUTH_SOCK);let b=Buffer.alloc(0);s.on('connect',()=>s.write(Buffer.from('${trama}','base64')));s.on('data',d=>{b=Buffer.concat([b,d]);if(b.length>=4&&b.length===b.readUInt32BE()+4){console.log(b.subarray(4).toString('base64'));s.end()}});s.on('error',()=>process.exit(1));s.setTimeout(10000,()=>process.exit(1))`
  const respuesta = await ejecutar('node -e ' + citarSh(cliente))
  const lector = new Lector(Buffer.from(respuesta.stdout.trim(), 'base64'))
  check('socket devuelve firma', respuesta.exitCode === 0 && lector.bytes(1)[0] === 14)
  const firma = new Lector(lector.cadena())
  check('firma verificable fuera del contenedor', firma.texto() === 'ssh-ed25519' && verify(null, reto, createPublicKey(clave.privada), firma.cadena()))
  const archivos = await ejecutar('find /home/agente/.ssh -type f -exec grep -l "PRIVATE KEY" {} +')
  check('no hay claves privadas en la carpeta SSH', archivos.stdout.trim() === '')
  check('firma auditada en el host', registro.some((linea) => linea.includes('clave=SHA256:')))
  if (process.env.TESSERA_TEST_SSH) {
    hr('Autenticación SSH real exclusivamente por el agente')
    if (!process.env.TESSERA_TEST_SSH_DIR) throw new Error('Falta TESSERA_TEST_SSH_DIR')
    const rutaServidor = path.join(process.env.TESSERA_TEST_SSH_DIR, 'ssh', 'id_ed25519')
    const publicaServidor = leerClave(readFileSync(rutaServidor, 'utf8')).publica
    perfil.clavesSshPermitidas = [rutaServidor]
    // El config solo referencia la ruta del host; el buzón entrega su pública y firma allí.
    writeFileSync(path.join(ssh, 'config'), `Host prueba-servidor\n IdentityFile "${rutaServidor.replace(/\\/g, '/')}"\n`)
    const destino = new URL('ssh://' + process.env.TESSERA_TEST_SSH)
    const host = !esLinux() && ['127.0.0.1', 'localhost', '[::1]'].includes(destino.hostname) ? 'host.docker.internal' : destino.hostname.replace(/^\[|\]$/g, '')
    const puerto = destino.port || '22'
    const identidadesServidor = await ejecutar('ssh-add -L')
    check('solo ofrece la pública del servidor', identidadesServidor.exitCode === 0 && identidadesServidor.stdout.includes(publicaServidor.toString('base64')) && !identidadesServidor.stdout.includes(clave.publica.toString('base64')))
    const sinAgente = await ejecutar(`SSH_AUTH_SOCK= ssh -T -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o IdentityAgent=none -o ConnectTimeout=10 -p ${citarSh(puerto)} -l clave ${citarSh(host)} 'printf autenticacion-tessera'`)
    check('sin agente no se autentica', sinAgente.exitCode !== 0 && !sinAgente.stdout.includes('autenticacion-tessera'))
    // Por el alias, como lo usaría el agente: la clave está atada a `prueba-servidor` en el config.
    const autenticada = await ejecutar(`ssh -T -F /home/agente/.ssh/config -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ConnectTimeout=10 -o HostName=${citarSh(host)} -p ${citarSh(puerto)} -l clave prueba-servidor 'printf autenticacion-tessera'`)
    check('ssh real entra con la firma del agente', autenticada.exitCode === 0 && autenticada.stdout.trim() === 'autenticacion-tessera')
    // El caso de un remoto de git sin entrada propia: la clave está citada en otro `Host` y aun así se ofrece.
    const sinEntrada = await ejecutar(`ssh -T -F /home/agente/.ssh/config -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ConnectTimeout=10 -p ${citarSh(puerto)} -l clave ${citarSh(host)} 'printf autenticacion-tessera'`)
    check('un servidor sin entrada propia entra con las claves permitidas', sinEntrada.exitCode === 0 && sinEntrada.stdout.trim() === 'autenticacion-tessera')
    if (autenticada.exitCode !== 0) {
      console.log(`      ssh salió con ${autenticada.exitCode}: ${autenticada.stderr.trim().split('\n').slice(-6).join(' | ')}`)
      const carpeta = await ejecutar('ls -la /home/agente/.ssh; echo ---; cat /home/agente/.ssh/config')
      console.log(carpeta.stdout.replace(/^/gm, '      '))
    }
    const privadas = await ejecutar('find /home/agente/.ssh /agent-config/dbbridge -type f -exec grep -l -- "-----BEGIN .*PRIVATE KEY-----" {} +')
    check('la privada del servidor nunca entró al contenedor', privadas.stdout.trim() === '')
    perfil.clavesSshPermitidas = [rutaClave]
  } else console.log('OMITIDO: autenticación SSH real (falta TESSERA_TEST_SSH)')
  perfil.clavesSshPermitidas = []
  const revocada = await ejecutar('ssh-add -L')
  check('revocar impide listar identidades nuevas', !revocada.stdout.includes(clave.publica.toString('base64')))
} catch (error) { check(String(error), false) }
finally {
  await sandbox.detenerContenedor(perfil).catch(() => {})
  buzon.detener()
  rmSync(carpeta, { recursive: true, force: true })
}
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
