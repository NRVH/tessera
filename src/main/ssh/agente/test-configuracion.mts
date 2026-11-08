// =============================================================================
// Configuración y catálogo públicos: alias, includes, carpetas propias y ausencia de montajes privados.
// Comprueba el descubrimiento y la traducción para evitar que la configuración pública exponga secretos.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { configPublico, identidadesConfig, nombrePublica, primeroLasEstandar } from './configuracion.ts'
import { CacheCatalogo, carpetaSshGlobal, catalogo, publicaSinFrase } from './catalogo.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import type { Profile } from '../../profiles/types.ts'

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\\.[mc]?[jt]s$/.test(s))return n(s+'.ts',c);throw e}}`))
const { argumentosShellContenedor, sshKeyPrelude } = await import('../../agents/gitInContainer.ts')
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
hr('Configuración pública y ausencia de claves privadas en el contenedor')
const carpeta = mkdtempSync(path.join(tmpdir(), 'tessera-config-'))
try {
  const ssh = path.join(carpeta, '.ssh')
  const propia = path.join(carpeta, 'propia')
  mkdirSync(ssh); mkdirSync(propia); mkdirSync(path.join(ssh, 'conf.d'))
  for (const ruta of [path.join(ssh, 'id_ed25519'), path.join(ssh, 'empresa'), path.join(ssh, 'personal'), path.join(propia, 'servidor')]) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', ruta], { windowsHide: true, stdio: 'pipe' })
  writeFileSync(path.join(ssh, 'conf.d', 'empresa.conf'), 'Host empresa\n HostName git.empresa.test\n IdentityFile ~/.ssh/empresa\n')
  writeFileSync(path.join(ssh, 'config'), 'Include conf.d/*.conf\nHost personal\n HostName github.com\n IdentityFile ~/.ssh/personal\n IdentityFile="~/.ssh/no-existe"\n')
  const perfil: Profile = { id: 'empresa', nombre: 'Empresa', color: '#123456', agentes: [], sshDir: propia, sandbox: { habilitado: true }, clavesSshPermitidas: [path.join(ssh, 'empresa'), path.join(propia, 'servidor')] }
  const entorno = { home: carpeta, usuario: 'usuario', plataforma: plataformaActual() }
  const resultado = await catalogo(perfil, entorno)
  check('include descubre clave y alias', resultado.claves.some((c) => c.nombre === 'empresa' && c.alias.includes('empresa')))
  check('clave estándar descubierta', resultado.claves.some((c) => c.nombre === 'id_ed25519'))
  check('carpeta del perfil descubierta', resultado.claves.some((c) => c.nombre === 'servidor' && c.permitida))
  check('carpeta del home abreviada', resultado.claves.find((c) => c.nombre === 'empresa')?.carpeta === '~/.ssh')
  check('clave ajena no permitida', resultado.claves.find((c) => c.nombre === 'personal')?.permitida === false)
  const config = configPublico(resultado.config, entorno, perfil.clavesSshPermitidas!)
  check('solo IdentityFile públicas o none', config.split('\n').filter((l) => /IdentityFile/i.test(l)).every((l) => /\.pub$|none$/.test(l)))
  check('sin rutas privadas ni del host', !config.includes(carpeta) && !config.includes('~/.ssh/personal') && !config.includes('~/.ssh/empresa'))
  check('config fija identidades y socket', config.includes('IdentitiesOnly yes') && config.includes('IdentityAgent SSH_AUTH_SOCK'))
  check('clave autorizada por alias', config.includes(nombrePublica(path.join(ssh, 'empresa'))))
  check('clave excluida ausente', !config.includes(nombrePublica(path.join(ssh, 'personal'))))
  check('rutas con comillas y signo igual', identidadesConfig('Host x\n IdentityFile="~/.ssh/empresa"', entorno)[0]?.ruta === path.join(ssh, 'empresa'))
  const condicional = configPublico('Host a\n HostName a.test\nMatch exec "orden-del-host"\n HostName otro.test\nHost b\n HostName b.test\nMatch host b\n User usuario', entorno, [])
  check('Match no ejecuta órdenes ni mezcla bloques', !condicional.includes('orden-del-host') && !condicional.includes('otro.test') && condicional.includes('Match host b\n User usuario'))
  hr('Qué identidades ofrece ssh a cada destino (ssh -G, sin red)')
  const generado = path.join(carpeta, 'generado.conf')
  const efectiva = (config: string, permitidas: string[], destino: string): string => {
    writeFileSync(generado, configPublico(config, entorno, permitidas))
    return execFileSync('ssh', ['-G', '-F', generado, destino], { encoding: 'utf8' }).toLowerCase()
  }
  const empresa = path.join(ssh, 'empresa')
  const publicaEmpresa = nombrePublica(empresa)
  const variada = 'Host con-clave\n IdentityFile ~/.ssh/empresa\nHost desactivada\n IdentityFile ~/.ssh/personal\nHost *.comodin.test\n IdentityFile ~/.ssh/empresa\nHost solo-puerto\n Port 2200\nHost explicita-none\n IdentityFile none\nMatch host por-match.test\n IdentityFile ~/.ssh/empresa\n'
  const libre = (salida: string): boolean => salida.includes('identitiesonly no') && !salida.includes('.pub')
  const atada = (salida: string): boolean => salida.includes('identitiesonly yes') && salida.includes(publicaEmpresa)
  check('servidor sin entrada: ofrece lo que liste el agente', libre(efectiva(variada, [empresa], 'gitlab.ejemplo.test')))
  check('entrada sin identidad propia: también', libre(efectiva(variada, [empresa], 'solo-puerto')))
  check('IdentityFile none del usuario no ata el destino', libre(efectiva(variada, [empresa], 'explicita-none')))
  check('sin config del usuario: también', libre(efectiva('', [empresa], 'gitlab.ejemplo.test')))
  check('IdentitiesOnly del usuario en Host * no deja sin claves', libre(efectiva('Host *\n IdentitiesOnly yes\n', [empresa], 'gitlab.ejemplo.test')))
  check('alias con clave permitida: solo esa', atada(efectiva(variada, [empresa], 'con-clave')))
  check('comodín: solo esa', atada(efectiva(variada, [empresa], 'repo.comodin.test')))
  check('Match host: solo esa', atada(efectiva(variada, [empresa], 'por-match.test')))
  const desactivada = efectiva(variada, [empresa], 'desactivada')
  check('alias con clave desactivada: no prueba otra', desactivada.includes('identitiesonly yes') && !desactivada.includes('.pub'))
  const conAgente = (salida: string): boolean => salida.includes('identitiesonly no') && salida.includes(publicaEmpresa)
  check('Host * con clave permitida: va primero y no ata', conAgente(efectiva('Host *\n IdentityFile ~/.ssh/empresa\n', [empresa], 'cualquiera.test')))
  check('Host * con clave desactivada: no deja sin claves', libre(efectiva('Host *\n IdentityFile ~/.ssh/personal\n', [empresa], 'cualquiera.test')))
  check('Host * con excepción: tampoco', libre(efectiva('Host * !otro\n IdentityFile ~/.ssh/personal\n', [empresa], 'cualquiera.test')))
  check('sección global: tampoco', libre(efectiva('IdentityFile ~/.ssh/personal\n', [empresa], 'cualquiera.test')))
  check('Match all: tampoco', libre(efectiva('Match all\n IdentityFile ~/.ssh/personal\n', [empresa], 'cualquiera.test')))
  check('primero los nombres estándar, en el orden de ssh', primeroLasEstandar([{ nombre: 'empresa' }, { nombre: 'id_ed25519' }, { nombre: 'id_rsa' }]).map((c) => c.nombre).join() === 'id_rsa,id_ed25519,empresa')
  const publica = await publicaSinFrase(readFileSync(path.join(ssh, 'empresa'), 'utf8'), path.join(ssh, 'empresa'))
  check('solo pública extraída', readFileSync(path.join(ssh, 'empresa.pub'), 'utf8').includes(publica.toString('base64')))
  for (const preludio of [sshKeyPrelude()]) {
    check('sin copia ni montaje SSH', !/\b(cp|mount)\b|PRIVATE KEY|\/privada|\/mnt\/tessera-ssh/.test(preludio))
    check('preludio usa socket del buzón', preludio.includes('SSH_AUTH_SOCK') && preludio.includes('ssh-agente.cjs'))
  }
  mkdirSync(path.join(propia, 'conf.d'))
  writeFileSync(path.join(propia, 'config'), 'Include conf.d/*.conf\n')
  writeFileSync(path.join(propia, 'conf.d', 'propia.conf'), 'Host servidor-propio\n IdentityFile ~/.ssh/servidor\n')
  const cache = new CacheCatalogo()
  const primero = await cache.leer(perfil, entorno)
  check('include y tilde propios', primero.claves.some((c) => c.ruta === path.join(propia, 'servidor') && c.alias.includes('servidor-propio')))
  check('catálogo vigente se reutiliza', primero === await cache.leer(perfil, entorno))
  writeFileSync(path.join(propia, 'conf.d', 'nueva.conf'), 'Host nuevo\n IdentityFile ~/.ssh/servidor\n')
  check('include nuevo invalida caché', (await cache.leer(perfil, entorno)).claves.some((c) => c.alias.includes('nuevo')))
  writeFileSync(path.join(propia, 'conf.d', 'propia.conf'), 'Host sustituido\n IdentityFile ~/.ssh/servidor\n')
  check('include modificado invalida caché', (await cache.leer(perfil, entorno)).claves.some((c) => c.alias.includes('sustituido') && !c.alias.includes('servidor-propio')))
  perfil.clavesSshPermitidas = []
  check('permisos invalidan caché', (await cache.leer(perfil, entorno)).claves.every((c) => !c.permitida))
  check('aislamiento solo con marca del arnés', carpetaSshGlobal(entorno, [], { TESSERA_E2E_SSH_DIR: propia }) === ssh && carpetaSshGlobal(entorno, ['--tessera-arnes-e2e'], { TESSERA_E2E_SSH_DIR: propia }) === propia)
  const shell = argumentosShellContenedor()
  check('shell Docker interactiva prepara SSH antes de abrirse', shell[0] === 'bash' && shell[1] === '-lc' && shell[2].includes(sshKeyPrelude()) && shell[2].endsWith('exec bash -il'))
  check('el lanzamiento explícito conserva su preludio', argumentosShellContenedor('orden')[2] === 'orden')
} catch (error) { check(String(error), false) }
finally { rmSync(carpeta, { recursive: true, force: true }) }
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
