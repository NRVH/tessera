#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación de git DENTRO del contenedor (npm run test:gitcontainer), contra
// Docker y un repo efímero: sin `safe.directory` falla por «dubious ownership» (en Windows),
// con él status/log/commit funcionan como uid 1001, el preludio deja la llave a 600 y ssh la
// usa sin quejarse, y sin `.ssh` git local sigue funcionando.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import {
  composeCleanGitCommand,
  SSH_ACTIVE_DIR
} from './gitInContainer.ts'
import type { Profile } from '../profiles/types.ts'
import { esMac } from '../../shared/plataforma.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')

const WORK_DIR = path.join(REPO_ROOT, '.tmp-git-container')
const REPO_DIR = path.join(WORK_DIR, 'repo') // repo git de prueba (montado en /workspace)
const SSH_DIR = path.join(WORK_DIR, 'ssh') // .ssh de prueba (llave ficticia)

const REPO_EMAIL = 'repo-owner@example.test'
const REPO_NAME = 'Repo Owner'
// Remote SSH a un puerto CERRADO: git push --dry-run invocará ssh (vía el wrapper)
// y fallará al conectar; lo que se valida es que ssh USA la llave sin error de perms.
const SSH_REMOTE = 'ssh://git@127.0.0.1:2/fixture.git'

const P_SSH: Profile = {
  id: 'gittest-ssh',
  nombre: 'Git SSH',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/gittest-ssh/claude' }],
  sshDir: SSH_DIR,
  sandbox: { habilitado: true }
}
const P_NOSSH: Profile = {
  id: 'gittest-nossh',
  nombre: 'Git NoSSH',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/gittest-nossh/claude' }],
  sandbox: { habilitado: true }
}
const ALL = [P_SSH, P_NOSSH]

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

function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}

/** git host-side en el fixture (el `git` de Windows). */
function gitHost(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' })
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

function makeSshDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const priv = path.join(dir, 'id_ed25519')
  writeFileSync(
    priv,
    '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE-KEY\n-----END OPENSSH PRIVATE KEY-----\n',
    'utf8'
  )
  writeFileSync(path.join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAFAKE prueba\n', 'utf8')
  try {
    chmodSync(priv, 0o600)
  } catch {
    /* best-effort en Windows */
  }
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  // --- Fixture: repo git real con identidad LOCAL + commit base + remote ssh ---
  hr('PASO 1 - Fixture: repo git host-side (identidad local, commit base, remote ssh)')
  rmSync(WORK_DIR, { recursive: true, force: true })
  mkdirSync(REPO_DIR, { recursive: true })
  makeSshDir(SSH_DIR)

  gitHost(['init', '-b', 'main'])
  // Identidad SOLO en el .git/config LOCAL del repo (no global): es lo que el
  // contenedor debe leer sin que se le inyecte identidad por entorno.
  gitHost(['config', 'user.email', REPO_EMAIL])
  gitHost(['config', 'user.name', REPO_NAME])
  writeFileSync(path.join(REPO_DIR, 'README.md'), '# fixture\n', 'utf8')
  gitHost(['add', 'README.md'])
  gitHost(['commit', '-m', 'commit base'])
  gitHost(['remote', 'add', 'origin', SSH_REMOTE])
  const baseHead = gitHost(['rev-parse', 'HEAD']).out.trim()
  console.log('repo:', REPO_DIR)
  console.log('identidad local:', REPO_NAME, `<${REPO_EMAIL}>`)
  console.log('HEAD base:', baseHead)
  console.log('remote origin:', SSH_REMOTE)

  try {
    for (const p of ALL) {
      try {
        await sandbox.stopContainer(p)
      } catch {
        /* no existía */
      }
    }
    for (const p of ALL) {
      await sandbox.ensureContainer(p)
    }
    // El repo se monta en ambos contenedores (mismo repo host).
    const mSsh = await sandbox.addProject(P_SSH, REPO_DIR)
    await sandbox.addProject(P_NOSSH, REPO_DIR)
    const wsSsh = mSsh.workspacePath

    // Diagnóstico: propiedad y modo del repo montado tal como lo ve uid 1001.
    hr('DIAGNÓSTICO - propiedad/modo del repo montado (raíz del hallazgo)')
    const diag = await sandbox.exec(
      P_SSH,
      `echo "UID=$(id -u)"; echo "GITDIR_OWNER=$(stat -c %U:%G ${wsSsh}/.git 2>/dev/null)"; ` +
        `echo "GITDIR_MODE=$(stat -c %a ${wsSsh}/.git 2>/dev/null)"`
    )
    console.log(diag.stdout.trim())

    // --- (a) SIN fix: git status FALLA con dubious ownership --------------------
    // Control negativo para que (b) no pase por casualidad. Depende del dueño del repo en
    // el contenedor: en Windows (WSL2) es ajeno y el aviso sale; en macOS Docker Desktop
    // remapea el bind a `agente:agente` (medido) y el aviso no sale nunca, así que allí se
    // comprueba la premisa (el dueño coincide) en vez del síntoma.
    hr('(a) SIN safe.directory: git status FALLA con dubious ownership')
    const a = await sandbox.exec(P_SSH, `git -C ${wsSsh} status`)
    const aDubious = /dubious ownership/i.test(a.stdout + a.stderr)
    console.log(`--- salida cruda (a) [exit ${a.exitCode}] ---\n` + (a.stdout + a.stderr).trim())
    if (esMac()) {
      const dueno = await sandbox.exec(
        P_SSH,
        `test "$(stat -c %u ${wsSsh}/.git)" = "$(id -u)" && echo COINCIDE || echo DISTINTO`
      )
      const coincide = dueno.stdout.includes('COINCIDE')
      check(
        '(a) en macOS el bind ya llega con el dueño del agente, así que NO hay dubious ownership que provocar',
        coincide && !aDubious,
        `dueño_del_.git_=_uid_del_agente=${coincide} | dubious_ownership_en_salida=${aDubious}`
      )
    } else {
      check(
        '(a) git status sin fix -> falla por dubious ownership (el problema existe)',
        a.exitCode !== 0 && aDubious,
        `exit=${a.exitCode} | dubious_ownership_en_salida=${aDubious}`
      )
    }

    // --- (b) CON fix: status/log OK + identidad del .git/config del repo --------
    hr('(b) CON safe.directory: status/log OK; git lee la identidad LOCAL del repo')
    const bCmd = [
      'echo "STATUS_RC=start"',
      'git status --porcelain=v1 >/dev/null 2>&1 && echo "STATUS_OK=YES" || echo "STATUS_OK=NO"',
      'git log --oneline -1 >/dev/null 2>&1 && echo "LOG_OK=YES" || echo "LOG_OK=NO"',
      'echo "EMAIL=$(git config user.email)"',
      'echo "NAME=$(git config user.name)"'
    ].join('\n')
    const b = await sandbox.exec(P_SSH, composeCleanGitCommand(bCmd), { project: REPO_DIR })
    console.log(`--- salida cruda (b) [exit ${b.exitCode}] ---\n` + (b.stdout + b.stderr).trim())
    const bOk =
      b.exitCode === 0 &&
      field(b.stdout, 'STATUS_OK') === 'YES' &&
      field(b.stdout, 'LOG_OK') === 'YES' &&
      field(b.stdout, 'EMAIL') === REPO_EMAIL &&
      field(b.stdout, 'NAME') === REPO_NAME
    check(
      '(b) status/log OK y git lee la identidad del .git/config del repo (no vacía, no inyectada)',
      bOk,
      `status=${field(b.stdout, 'STATUS_OK')} log=${field(b.stdout, 'LOG_OK')} ` +
        `email=${field(b.stdout, 'EMAIL')} name=${field(b.stdout, 'NAME')}`
    )

    // --- (c) CRÍTICO: git commit dentro del contenedor (uid 1001 escribe .git) --
    hr('(c) CRÍTICO: git commit como uid 1001 sobre el .git montado (HEAD avanza)')
    const marker = 'agente-uid1001-escribio.txt'
    const cCmd = [
      `echo contenido-del-agente > ${marker}`,
      `git add ${marker}`,
      'git commit -m "commit del agente dentro del contenedor" >/dev/null 2>commit.err && echo "COMMIT_OK=YES" || echo "COMMIT_OK=NO"',
      'echo "COMMIT_ERR=$(cat commit.err 2>/dev/null)"',
      'echo "NEWHEAD=$(git rev-parse HEAD)"',
      'echo "SUBJECT=$(git log -1 --pretty=%s)"',
      'echo "AUTHOR=$(git log -1 --pretty=%ae)"'
    ].join('\n')
    const c = await sandbox.exec(P_SSH, composeCleanGitCommand(cCmd), { project: REPO_DIR })
    console.log(`--- salida cruda (c) [exit ${c.exitCode}] ---\n` + (c.stdout + c.stderr).trim())
    const newHead = field(c.stdout, 'NEWHEAD')
    const commitOk =
      c.exitCode === 0 &&
      field(c.stdout, 'COMMIT_OK') === 'YES' &&
      newHead.length === 40 &&
      newHead !== baseHead &&
      field(c.stdout, 'SUBJECT') === 'commit del agente dentro del contenedor' &&
      field(c.stdout, 'AUTHOR') === REPO_EMAIL
    // Verificación cruzada host-side: el commit del contenedor es visible desde el host.
    const hostSubject = gitHost(['log', '-1', '--pretty=%s']).out.trim()
    const hostVisible = hostSubject === 'commit del agente dentro del contenedor'
    check(
      '(c) commit de uid 1001 escribe en el .git montado; HEAD avanza y es visible host-side',
      commitOk && hostVisible,
      `commit_ok=${field(c.stdout, 'COMMIT_OK')} | head ${baseHead.slice(0, 8)}->${newHead.slice(0, 8)} | ` +
        `autor=${field(c.stdout, 'AUTHOR')} | host_ve_el_commit=${hostVisible} | commit_err="${field(c.stdout, 'COMMIT_ERR')}"`
    )

    // --- (d) Permisos SSH tras la copia-a-ext4-con-600 -------------------------
    hr('(d) SSH: contraste 777(bind ro)->600(copia ext4); ssh corre sin queja de permisos')
    const dCmd = [
      // Modo de la llave ORIGINAL en el bind ro (777 en drvfs) vs la COPIA.
      `echo "BINDMODE=$(stat -c %a /home/agente/.ssh/id_ed25519 2>/dev/null)"`,
      `echo "KEYMODE=$(stat -c %a ${SSH_ACTIVE_DIR}/id_ed25519 2>/dev/null)"`,
      `echo "KEYOWNER=$(stat -c %U ${SSH_ACTIVE_DIR}/id_ed25519 2>/dev/null)"`,
      `echo "WRAP_OK=$(test -x ${SSH_ACTIVE_DIR}/git-ssh.sh && echo YES || echo NO)"`,
      'echo "---PUSH-START---"',
      'git push --dry-run origin main 2>&1 || true',
      'echo "---PUSH-END---"'
    ].join('\n')
    const d = await sandbox.exec(P_SSH, composeCleanGitCommand(dCmd), { project: REPO_DIR })
    const dOut = d.stdout + d.stderr
    console.log(`--- salida cruda (d) [exit ${d.exitCode}] ---\n` + dOut.trim())
    const bindMode = field(d.stdout, 'BINDMODE')
    const keyMode = field(d.stdout, 'KEYMODE')
    const keyOwner = field(d.stdout, 'KEYOWNER')
    const wrapOk = field(d.stdout, 'WRAP_OK') === 'YES'
    const permError = /UNPROTECTED PRIVATE KEY|too open|bad permissions/i.test(dOut)
    // ssh CORRIÓ vía el wrapper y llegó a la fase de red (el remoto real no está
    // disponible: puerto cerrado -> Connection refused). La ACEPTACIÓN de la llave
    // en la fase de auth exige un remoto vivo -> queda para validación en runtime.
    const reachedSsh = /Connection refused|connect to host|Could not read from remote|port 2|kex_exchange|Permission denied|publickey/i.test(dOut)
    if (bindMode && (parseInt(bindMode, 8) & 0o077) !== 0) {
      console.log(`  [contexto] llave del bind ro en modo ${bindMode} (ssh la rechazaría) -> la copia queda en ${keyMode}.`)
    }
    console.log(
      '  [nota] la aceptación de la llave en la fase de AUTH de ssh requiere un remoto SSH vivo; ' +
        'offline se valida el contraste de permisos 777->600 + que ssh corre sin error de permisos. Auth real -> runtime.'
    )
    check(
      '(d) copia de llave a 600 (owner agente), wrapper ejecutable, ssh corre sin error de permisos',
      keyMode === '600' && keyOwner === 'agente' && wrapOk && !permError && reachedSsh,
      `bind=${bindMode} -> copia=${keyMode} owner=${keyOwner} | wrapper_x=${wrapOk} | ` +
        `error_de_permisos=${permError} | ssh_llegó_a_red=${reachedSsh}`
    )

    // --- (e) Perfil SIN .ssh: git local OK; push por SSH falla claro, sin crash -
    hr('(e) Perfil sin .ssh: git local OK; push por SSH falla por falta de llave (sin crash)')
    // git local (status) sobre el mismo repo montado en el contenedor sin .ssh.
    const eLocal = await sandbox.exec(
      P_NOSSH,
      composeCleanGitCommand('git status --porcelain=v1 >/dev/null 2>&1 && echo "LOCAL_OK=YES" || echo "LOCAL_OK=NO"'),
      { project: REPO_DIR }
    )
    const ePush = await sandbox.exec(
      P_NOSSH,
      composeCleanGitCommand('echo "---P---"; git push --dry-run origin main 2>&1 || true; echo "RC=$?"'),
      { project: REPO_DIR }
    )
    const ePushOut = ePush.stdout + ePush.stderr
    console.log(`--- (e) local [exit ${eLocal.exitCode}] ---\n` + (eLocal.stdout + eLocal.stderr).trim())
    console.log(`--- (e) push [exit ${ePush.exitCode}] ---\n` + ePushOut.trim())
    const localOk = field(eLocal.stdout, 'LOCAL_OK') === 'YES'
    // Sin llave: ssh no autentica -> fallo claro (publickey / permission denied /
    // connection refused al puerto cerrado). No debe haber crash del intérprete.
    const pushFailedClean = /Permission denied|publickey|Connection refused|Could not read from remote|connect to host/i.test(ePushOut)
    // "sin crash": el contenedor respondió con salida estructurada (nuestros ecos).
    const noCrash = /---P---/.test(ePushOut)
    check(
      '(e) sin .ssh: git local OK; push por SSH falla con error claro y sin crash',
      localOk && pushFailedClean && noCrash,
      `local_ok=${localOk} | push_falla_claro=${pushFailedClean} | sin_crash=${noCrash}`
    )
  } finally {
    hr('LIMPIEZA - stopContainer por perfil + verificación de no huérfanos')
    for (const p of ALL) {
      try {
        await sandbox.stopContainer(p)
      } catch (err) {
        console.log(`  aviso: stopContainer(${p.id}) -> ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const orphans: string[] = []
    for (const p of ALL) {
      const cname = `tessera-${p.id}`
      const psRaw = spawnSync(
        'docker',
        ['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.Names}}'],
        { encoding: 'utf8' }
      ).stdout.trim()
      if (psRaw.length > 0) orphans.push(psRaw)
    }
    check(
      '(limpieza) Sin contenedores huérfanos tras stopContainer',
      orphans.length === 0,
      orphans.length === 0 ? 'todo limpio' : `huérfanos: ${orphans.join(', ')}`
    )
    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado en la prueba:', err)
  process.exit(1)
})
