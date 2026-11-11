// =============================================================================
// Aceptación con Docker: ni el SSH global ni el propio del perfil se montan en el contenedor.
// Inspecciona el aislamiento real para impedir que los montajes expongan claves privadas del host.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SandboxManager } from './SandboxManager.ts'
import { fijarBaseGestionada } from './gestor/nombres.ts'
import type { Profile } from '../profiles/types.ts'

let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const carpeta = mkdtempSync(path.join(raiz, '.tmp-ssh-p5-'))
const global = path.join(carpeta, 'global')
const propia = path.join(carpeta, 'propia')
mkdirSync(global); mkdirSync(propia)
for (const ruta of [global, propia]) writeFileSync(path.join(ruta, 'id_ed25519'), '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETO_P5\n')
fijarBaseGestionada(path.join(carpeta, 'datos'), false)
const perfiles: Profile[] = [true, false].map((conSsh, indice) => ({ id: 'ssh-p5-' + indice, nombre: 'Prueba SSH', color: '#123456', agentes: [], ...(conSsh ? { sshDir: propia } : {}), sandbox: { habilitado: true } }))
const sandbox = new SandboxManager()
try {
  hr('Ninguna clave privada se monta')
  for (const perfil of perfiles) {
    await sandbox.ensureContainer(perfil)
    const resultado = await sandbox.exec(perfil, 'test ! -e /mnt/tessera-ssh/.ssh/id_ed25519 && test ! -e /home/agente/.ssh/id_ed25519 && test ! -e /home/agente/.ssh_active/id_ed25519')
    check(perfil.id + ' sin archivos privados', resultado.exitCode === 0)
    const montajes = await sandbox.exec(perfil, 'cat /proc/self/mountinfo')
    check(perfil.id + ' sin montajes SSH', !montajes.stdout.includes('/mnt/tessera-ssh') && !montajes.stdout.includes('/home/agente/.ssh'))
  }
} catch (error) { check(String(error), false) }
finally {
  for (const perfil of perfiles) await sandbox.stopContainer(perfil).catch(() => {})
  rmSync(carpeta, { recursive: true, force: true })
}
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
