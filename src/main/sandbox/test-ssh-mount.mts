#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación del montaje de `.ssh` por perfil (npm run test:ssh), contra Docker:
// cada perfil ve SOLO su `.ssh` READ-ONLY en `/home/agente/.ssh` (ni por ruta ni por
// barrido alcanza la de otro), sin `sshDir` no existe, el mismo `sshDir` se comparte y la
// ruta del host no aparece. Llaves ficticias; no se autentica contra nada.
// Decisiones: docs/decisiones/sandbox/ssh-global.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from './SandboxManager.ts'
import { tramosDelHost } from './centinelaHost.ts'
import type { Profile } from '../profiles/types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')

// Fixtures efímeros bajo la raíz del repo (mismo patrón que los otros tests).
const WORK_DIR = path.join(REPO_ROOT, '.tmp-ssh-mount')
const SSH_A = path.join(WORK_DIR, 'ssh-A') // carpeta .ssh del perfil A
const SSH_B = path.join(WORK_DIR, 'ssh-B') // carpeta .ssh del perfil B (distinta)
const SSH_SHARED = path.join(WORK_DIR, 'ssh-shared') // .ssh compartida (Trabajo/Ejemplo)

// Secretos ÚNICOS por carpeta: si el de B aparece en el contenedor de A, (d) FALLA.
const SECRET_A = 'SECRET_SSH_A_NO_DEBE_CRUZAR'
const SECRET_B = 'SECRET_SSH_B_NO_DEBE_CRUZAR'
const SECRET_SHARED = 'SECRET_SSH_SHARED'

// Perfiles de prueba con ids propios (contenedores tessera-<id> aislados).
const P_A: Profile = {
  id: 'sshtest-a',
  nombre: 'SSH A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshtest-a/claude' }],
  sshDir: SSH_A,
  sandbox: { habilitado: true }
}
const P_B: Profile = {
  id: 'sshtest-b',
  nombre: 'SSH B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshtest-b/claude' }],
  sshDir: SSH_B,
  sandbox: { habilitado: true }
}
const P_NONE: Profile = {
  id: 'sshtest-none',
  nombre: 'SSH None',
  color: '#7F77DD',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshtest-none/claude' }],
  // sin sshDir a propósito
  sandbox: { habilitado: true }
}
const P_S1: Profile = {
  id: 'sshtest-s1',
  nombre: 'SSH Shared 1',
  color: '#EF9F27',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshtest-s1/claude' }],
  sshDir: SSH_SHARED,
  sandbox: { habilitado: true }
}
const P_S2: Profile = {
  id: 'sshtest-s2',
  nombre: 'SSH Shared 2',
  color: '#EF9F27',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshtest-s2/claude' }],
  sshDir: SSH_SHARED,
  sandbox: { habilitado: true }
}
const ALL_PROFILES = [P_A, P_B, P_NONE, P_S1, P_S2]

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

// Tokens que SOLO aparecen en la ruta real del host (nunca dentro del contenedor).
/** Tramos del host hasta la carpeta de trabajo, más el usuario: ninguno debe verse dentro. */
const FORBIDDEN = tramosDelHost(WORK_DIR)
const driveRe = /(?:^|[^a-z])[a-z]:[\\/]/i
function leaks(value: string): string | null {
  const low = value.toLowerCase()
  for (const t of FORBIDDEN) if (low.includes(t)) return `contiene "${t}"`
  if (driveRe.test(value)) return 'contiene una letra de unidad de Windows'
  if (value.includes('\\')) return 'contiene backslash de Windows'
  return null
}

/**
 * Crea una carpeta .ssh FICTICIA en el host con una llave privada (que embebe un
 * secreto único), su .pub y un marcador. Intenta chmod 600 en la privada (en
 * Windows el efecto real lo decide el mapeo drvfs/9p del bind; justo eso se mide).
 */
function makeSshDir(dir: string, secret: string, mark: string): void {
  mkdirSync(dir, { recursive: true })
  const priv = path.join(dir, 'id_ed25519')
  writeFileSync(
    priv,
    `-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE-${secret}\n-----END OPENSSH PRIVATE KEY-----\n`,
    'utf8'
  )
  writeFileSync(path.join(dir, 'id_ed25519.pub'), `ssh-ed25519 AAAAFAKE ${mark}\n`, 'utf8')
  writeFileSync(path.join(dir, mark), `marcador ${mark}\n`, 'utf8')
  try {
    // Intento de perms estrictos host-side; en Windows suele ser inocuo, pero no
    // hace daño y deja la intención explícita.
    chmodSync(priv, 0o600)
  } catch {
    /* best-effort */
  }
}

/** Deja el contenedor de un perfil en pizarra limpia (por si quedó de una corrida previa). */
async function cleanSlate(sandbox: SandboxManager, p: Profile): Promise<void> {
  try {
    await sandbox.stopContainer(p)
  } catch {
    /* no existía: ok */
  }
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()

  // --- PASO 0: preflight ------------------------------------------------------
  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  // --- Fixtures de .ssh en disco ---------------------------------------------
  rmSync(WORK_DIR, { recursive: true, force: true })
  makeSshDir(SSH_A, SECRET_A, 'MARK_A')
  makeSshDir(SSH_B, SECRET_B, 'MARK_B')
  makeSshDir(SSH_SHARED, SECRET_SHARED, 'MARK_SHARED')
  console.log('fixtures .ssh creados:')
  console.log('  A      ->', SSH_A, `(${SECRET_A})`)
  console.log('  B      ->', SSH_B, `(${SECRET_B})`)
  console.log('  shared ->', SSH_SHARED, `(${SECRET_SHARED})`)

  try {
    // Pizarra limpia y contenedores creados CON el mount de .ssh (o sin él).
    for (const p of ALL_PROFILES) await cleanSlate(sandbox, p)
    for (const p of ALL_PROFILES) await sandbox.ensureContainer(p)

    // --- (a) Perfil CON sshDir: ~/.ssh existe, legible uid 1001, con archivos --
    hr('(a) Perfil A: ~/.ssh existe, legible por uid 1001, con los archivos del host')
    const aCmd = [
      'echo "UID=$(id -u)"',
      'echo "SSH_EXISTS=$(test -d /home/agente/.ssh && echo YES || echo NO)"',
      `echo "LIST=$(ls -1 /home/agente/.ssh 2>/dev/null | tr '\\n' ',')"`,
      'echo "MARK_A=$(cat /home/agente/.ssh/MARK_A 2>/dev/null)"',
      'echo "PRIV_READABLE=$(head -n1 /home/agente/.ssh/id_ed25519 >/dev/null 2>&1 && echo YES || echo NO)"'
    ].join('\n')
    const a = await sandbox.exec(P_A, aCmd)
    console.log('--- salida cruda (a) ---\n' + a.stdout.trim() + `\n[exit ${a.exitCode}]`)
    const aUid = field(a.stdout, 'UID')
    const aExists = field(a.stdout, 'SSH_EXISTS')
    const aList = field(a.stdout, 'LIST')
    const aMark = field(a.stdout, 'MARK_A')
    const aPrivReadable = field(a.stdout, 'PRIV_READABLE')
    check(
      '(a) A: ~/.ssh existe y es legible por uid 1001 con id_ed25519(.pub) + MARK_A',
      a.exitCode === 0 &&
        aUid === '1001' &&
        aExists === 'YES' &&
        aList.includes('id_ed25519') &&
        aList.includes('id_ed25519.pub') &&
        aMark.includes('MARK_A') &&
        aPrivReadable === 'YES',
      `uid=${aUid} | exists=${aExists} | list=${aList} | MARK_A="${aMark}" | priv_legible=${aPrivReadable}`
    )

    // --- (b) Permisos de la llave privada bajo el bind (HALLAZGO si drvfs fuerza) -
    hr('(b) Permisos de la llave privada bajo el bind read-only (ssh es quisquilloso)')
    const bCmd = [
      'echo "MODE=$(stat -c %a /home/agente/.ssh/id_ed25519 2>/dev/null)"',
      'echo "OWNER=$(stat -c %U:%G /home/agente/.ssh/id_ed25519 2>/dev/null)"',
      // Prueba de escritura sobre el bind ro: DEBE fallar (read-only).
      'if echo x >> /home/agente/.ssh/id_ed25519 2>/dev/null; then echo "RO=WRITABLE"; else echo "RO=READONLY"; fi'
    ].join('\n')
    const b = await sandbox.exec(P_A, bCmd)
    console.log('--- salida cruda (b) ---\n' + b.stdout.trim() + `\n[exit ${b.exitCode}]`)
    const mode = field(b.stdout, 'MODE')
    const owner = field(b.stdout, 'OWNER')
    const ro = field(b.stdout, 'RO')
    // ssh rechaza la llave privada si es accesible por grupo u "otros" (mascara 077).
    const modeNum = /^[0-7]{3,4}$/.test(mode) ? parseInt(mode, 8) : NaN
    const sshWouldAccept = Number.isNaN(modeNum) ? false : (modeNum & 0o077) === 0
    if (!sshWouldAccept) {
      console.log(
        `  [HALLAZGO] modo=${mode} (owner ${owner}): ssh RECHAZARÍA la llave ("UNPROTECTED PRIVATE KEY FILE").`
      )
      console.log(
        '            El bind es READ-ONLY, así que el agente NO puede chmod-earla dentro del contenedor.'
      )
      console.log(
        '            Mitigación: copiar la llave a un path ext4 con 600 y apuntar ssh -i ahí,'
      )
      console.log(
        '            o usar GIT_SSH_COMMAND con IdentitiesOnly + una copia con perms estrictos (lo hace el preludio de git).'
      )
    }
    // El check del MECANISMO pasa si pudimos leer modo+propietario y confirmar RO.
    // La aceptación de ssh se reporta como evidencia (hallazgo), no tumba la prueba.
    check(
      '(b) [mecanismo] modo/propietario de la llave legibles y bind READ-ONLY confirmado',
      b.exitCode === 0 && /^[0-7]{3,4}$/.test(mode) && owner.length > 0 && ro === 'READONLY',
      `modo=${mode} | owner=${owner} | bind=${ro} | ssh_aceptaria(mascara 077)=${sshWouldAccept ? 'SÍ' : 'NO (HALLAZGO)'}`
    )

    // --- (c) Perfil SIN sshDir: ~/.ssh NO existe, sin crash --------------------
    hr('(c) Perfil sin sshDir: ~/.ssh NO existe (comportamiento seguro por defecto)')
    const cCmd = [
      'echo "SSH_EXISTS=$(test -e /home/agente/.ssh && echo YES || echo NO)"',
      'echo "HOME_OK=$(test -d /home/agente && echo YES || echo NO)"'
    ].join('\n')
    const c = await sandbox.exec(P_NONE, cCmd)
    console.log('--- salida cruda (c) ---\n' + c.stdout.trim() + `\n[exit ${c.exitCode}]`)
    check(
      '(c) Perfil sin sshDir: contenedor sano y ~/.ssh AUSENTE',
      c.exitCode === 0 && field(c.stdout, 'SSH_EXISTS') === 'NO' && field(c.stdout, 'HOME_OK') === 'YES',
      `ssh_existe=${field(c.stdout, 'SSH_EXISTS')} | home_ok=${field(c.stdout, 'HOME_OK')}`
    )

    // --- (d) CRUCE: A no alcanza la .ssh de B (y viceversa) --------------------
    hr('(d) CRUCE obligatorio: A ve SOLO su .ssh; NO alcanza el secreto/contenido de B')
    const crossCmd = (ownSecret: string, otherSecret: string, otherMark: string): string =>
      [
        `echo "OWN=$(grep -rl ${ownSecret} /home/agente/.ssh 2>/dev/null | head -n1)"`,
        // cat directo del marcador del OTRO perfil: debe fallar (no está montado).
        `if cat /home/agente/.ssh/${otherMark} 2>/dev/null; then echo "OTHER_MARK=REACHABLE"; else echo "OTHER_MARK=BLOCKED"; fi`,
        // barrido del secreto del OTRO en todo lo alcanzable/escribible.
        `if grep -rq ${otherSecret} /home /workspace /agent-config /tmp /etc 2>/dev/null; then echo "OTHER_SCAN=FOUND"; else echo "OTHER_SCAN=ABSENT"; fi`,
        // el secreto PROPIO sí debe estar.
        `if grep -rq ${ownSecret} /home/agente/.ssh 2>/dev/null; then echo "OWN_SCAN=FOUND"; else echo "OWN_SCAN=ABSENT"; fi`
      ].join('\n')

    const dA = await sandbox.exec(P_A, crossCmd(SECRET_A, SECRET_B, 'MARK_B'))
    console.log('--- A intentando alcanzar B ---\n' + dA.stdout.trim() + `\n[exit ${dA.exitCode}]`)
    const dB = await sandbox.exec(P_B, crossCmd(SECRET_B, SECRET_A, 'MARK_A'))
    console.log('--- B intentando alcanzar A ---\n' + dB.stdout.trim() + `\n[exit ${dB.exitCode}]`)

    const aIsolated =
      dA.exitCode === 0 &&
      field(dA.stdout, 'OTHER_MARK') === 'BLOCKED' &&
      field(dA.stdout, 'OTHER_SCAN') === 'ABSENT' &&
      field(dA.stdout, 'OWN_SCAN') === 'FOUND' &&
      !dA.stdout.includes(SECRET_B)
    const bIsolated =
      dB.exitCode === 0 &&
      field(dB.stdout, 'OTHER_MARK') === 'BLOCKED' &&
      field(dB.stdout, 'OTHER_SCAN') === 'ABSENT' &&
      field(dB.stdout, 'OWN_SCAN') === 'FOUND' &&
      !dB.stdout.includes(SECRET_A)
    check(
      '(d) CRUCE: A no alcanza la .ssh de B ni su secreto; B tampoco la de A (simétrico)',
      aIsolated && bIsolated,
      `A{otherMark=${field(dA.stdout, 'OTHER_MARK')} otherScan=${field(dA.stdout, 'OTHER_SCAN')} ` +
        `ownScan=${field(dA.stdout, 'OWN_SCAN')} fugaB=${dA.stdout.includes(SECRET_B)}} | ` +
        `B{otherMark=${field(dB.stdout, 'OTHER_MARK')} otherScan=${field(dB.stdout, 'OTHER_SCAN')} ` +
        `ownScan=${field(dB.stdout, 'OWN_SCAN')} fugaA=${dB.stdout.includes(SECRET_A)}}`
    )

    // --- (e) Mismo sshDir en dos perfiles (Trabajo/Ejemplo) ------------------------
    hr('(e) Mismo sshDir en dos perfiles: ambos ven la misma .ssh')
    const sharedCmd = [
      'echo "MARK_SHARED=$(cat /home/agente/.ssh/MARK_SHARED 2>/dev/null)"',
      `echo "SECRET=$(grep -rq ${SECRET_SHARED} /home/agente/.ssh 2>/dev/null && echo FOUND || echo ABSENT)"`
    ].join('\n')
    const e1 = await sandbox.exec(P_S1, sharedCmd)
    const e2 = await sandbox.exec(P_S2, sharedCmd)
    console.log('--- S1 ---\n' + e1.stdout.trim() + `\n[exit ${e1.exitCode}]`)
    console.log('--- S2 ---\n' + e2.stdout.trim() + `\n[exit ${e2.exitCode}]`)
    const sharedOk =
      e1.exitCode === 0 &&
      e2.exitCode === 0 &&
      field(e1.stdout, 'MARK_SHARED').includes('MARK_SHARED') &&
      field(e2.stdout, 'MARK_SHARED').includes('MARK_SHARED') &&
      field(e1.stdout, 'SECRET') === 'FOUND' &&
      field(e2.stdout, 'SECRET') === 'FOUND'
    check(
      '(e) S1 y S2 (mismo sshDir) ven ambos la misma .ssh (MARK_SHARED + secreto)',
      sharedOk,
      `S1{mark=${field(e1.stdout, 'MARK_SHARED')} secret=${field(e1.stdout, 'SECRET')}} | ` +
        `S2{mark=${field(e2.stdout, 'MARK_SHARED')} secret=${field(e2.stdout, 'SECRET')}}`
    )

    // --- (f) La ruta Windows real NO aparece en env ni en pwd ------------------
    hr('(f) Aislamiento de ruta: env y pwd neutros (solo ~/.ssh), sin ruta Windows')
    const fCmd = [
      'echo "PWD_SSH=$(cd /home/agente/.ssh && pwd)"',
      'echo "---ENV-START---"',
      'env | sort',
      'echo "---ENV-END---"'
    ].join('\n')
    const f = await sandbox.exec(P_A, fCmd)
    const pwdSsh = field(f.stdout, 'PWD_SSH')
    const envDump = f.stdout
    console.log('pwd ~/.ssh:', JSON.stringify(pwdSsh))
    const fIssues: string[] = []
    const pwdLeak = leaks(pwdSsh)
    if (pwdSsh !== '/home/agente/.ssh') fIssues.push(`pwd de ~/.ssh no neutro: ${pwdSsh}`)
    if (pwdLeak) fIssues.push(`pwd ${pwdLeak}`)
    const envLeak = leaks(envDump)
    if (envLeak) fIssues.push(`env ${envLeak}`)
    check(
      '(f) pwd de ~/.ssh es /home/agente/.ssh y el env no filtra la ruta Windows',
      f.exitCode === 0 && fIssues.length === 0,
      fIssues.length === 0 ? 'pwd neutro y env sin ruta host' : fIssues.join(' ;; ')
    )
  } finally {
    // --- Limpieza: detener todos los contenedores, sin huérfanos ---------------
    hr('LIMPIEZA - stopContainer por perfil + verificación de no huérfanos')
    for (const p of ALL_PROFILES) {
      try {
        await sandbox.stopContainer(p)
      } catch (err) {
        console.log(`  aviso: stopContainer(${p.id}) -> ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const orphans: string[] = []
    for (const p of ALL_PROFILES) {
      const cname = `tessera-${p.id}`
      const psRaw = spawnSync(
        'docker',
        ['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.Names}}'],
        { encoding: 'utf8' }
      ).stdout.trim()
      if (psRaw.length > 0) orphans.push(psRaw)
    }
    check(
      '(limpieza) Sin contenedores huérfanos tras stopContainer de todos los perfiles',
      orphans.length === 0,
      orphans.length === 0 ? 'todo limpio' : `huérfanos: ${orphans.join(', ')}`
    )
    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  // --- Reporte -----------------------------------------------------------------
  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

/** Extrae "CLAVE=valor" (hasta fin de línea) de una salida multilinea. */
function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado en la prueba:', err)
  process.exit(1)
})
