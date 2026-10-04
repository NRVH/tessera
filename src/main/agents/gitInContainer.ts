// =============================================================================
// Git del agente DENTRO del contenedor (uid 1001 sobre un repo de otro dueño): el
// `safe.directory` por entorno (`GIT_CONFIG_*`, compatible con `env -i`) y el PRELUDIO que
// copia las llaves del bind READ-ONLY a `~/.ssh_active` con 600 y genera el wrapper de ssh
// (`known_hosts` escribible, `accept-new`). Sin llaves, git local funciona igual.
// Imports con extensión: lo importa `test-entorno-bd-agente.mts` bajo `node` a secas.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================
import type { Agente } from '../profiles/types.ts'
import { SSH_RO_BASE, type SshSetup } from '../sandbox/sshSetup.ts'
import { ENV_CONTENEDOR } from '../../shared/db-ipc.ts'
import { citarSh } from '../../shared/citarShell.ts'

/** PATH estándar del contenedor (el mismo que usa AgentLauncher). */
const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
/** HOME neutro del usuario `agente` de la imagen base. */
const NEUTRAL_HOME = '/home/agente'

/** Punto de montaje read-only de la `.ssh` del host (lo monta SandboxManager). */
export const SSH_MOUNT = `${NEUTRAL_HOME}/.ssh`
/** Directorio ext4 (escribible, propiedad de uid 1001) con las copias de llave a 600. */
export const SSH_ACTIVE_DIR = `${NEUTRAL_HOME}/.ssh_active`
/** known_hosts ESCRIBIBLE, fuera del bind ro, para StrictHostKeyChecking=accept-new. */
export const KNOWN_HOSTS = `${NEUTRAL_HOME}/.ssh_known_hosts`
/** Wrapper de ssh generado por el preludio; GIT_SSH_COMMAND apunta aquí. */
export const GIT_SSH_WRAPPER = `${SSH_ACTIVE_DIR}/git-ssh.sh`

/**
 * Asignaciones KEY=VALUE (para colocar tras `env -i`) que:
 *  - fijan `safe.directory=*` vía GIT_CONFIG_* (COUNT=1; ajustar el índice/COUNT
 *    si se añaden más claves GIT_CONFIG_*);
 *  - apuntan GIT_SSH_COMMAND al wrapper que genera el preludio.
 * El `'*'` va POSIX-quoted para que ningún shell lo expanda como glob.
 */
export function gitAgentAssignments(useConfigSsh = false): string[] {
  return [
    'GIT_CONFIG_COUNT=1',
    'GIT_CONFIG_KEY_0=safe.directory',
    `GIT_CONFIG_VALUE_0='*'`,
    // Con setup ssh GLOBAL (config del usuario reproducido): ssh a secas, que LEE
    // `~/.ssh/config` y honra los alias (git@github-ejemplo:…). Sin él: el wrapper
    // histórico que ofrece las llaves de `~/.ssh` (comportamiento previo intacto).
    `GIT_SSH_COMMAND=${useConfigSsh ? 'ssh' : GIT_SSH_WRAPPER}`
  ]
}

/**
 * Asignaciones KEY=VALUE con el contexto de BASES DE DATOS del proyecto, para que
 * `tdb` funcione en el pane del agente igual que en la terminal de abajo.
 *
 * POR QUÉ HACE FALTA, siendo que esas variables YA se pasan en los `-e` de
 * `docker exec`: la línea de arranque del agente corre bajo `env -i`, que es una
 * pizarra en blanco y borra justamente eso. El resultado era el peor de los
 * posibles —no un error, sino una asimetría silenciosa—: con la misma base montada,
 * la terminal de abajo la veía y el agente contestaba "esta terminal no lleva el
 * contexto de bases de datos de Tessera; recarga la terminal", consejo que no podía
 * funcionar porque el problema no estaba en la sesión sino en su entorno. Se pierde
 * media tarde antes de sospechar del `env -i`, que existe por una razón buena
 * (aislar credenciales entre perfiles) y no se toca: se re-inyecta lo justo.
 *
 * Solo cruza lo que `ENV_CONTENEDOR` declara: un token de sesión, el modo y la ruta
 * del buzón. Ninguna contraseña —en modo Docker no existen dentro del contenedor;
 * la consulta la ejecuta el host—. Se ignora lo vacío para no definir variables
 * huecas cuando el puente no llegó a levantar: `tdb` distingue "ausente" y las suyas
 * a medias le harían creer que sí hay contexto.
 */
export function dbAgentAssignments(env: Record<string, string> | undefined): string[] {
  if (!env) return []
  const out: string[] = []
  for (const clave of ENV_CONTENEDOR) {
    const valor = env[clave]
    // El valor va POSIX-quoted: acaba SUELTO en la línea de `bash -lc`, y aunque hoy
    // sean un hex y una ruta sin espacios, un buzón bajo una carpeta con espacio
    // partiría el comando en dos y el fallo saldría lejísimos de aquí.
    if (valor) out.push(`${clave}=${citarSh(valor)}`)
  }
  return out
}

/**
 * Preludio CONFIG-AWARE (setup ssh GLOBAL): reproduce `~/.ssh` FIEL dentro del
 * contenedor a partir del `SshSetup` resuelto host-side. Por cada carpeta montada
 * read-only en `${SSH_RO_BASE}/<base>` copia su contenido a `~/<base>` (ext4
 * escribible) con las llaves a 600 (el bind de Windows las expone 777 y ssh las
 * rechaza), y escribe el `~/.ssh/config` REESCRITO (rutas Windows → `/home/agente/…`)
 * más el bloque `Host *` con known_hosts escribible. ssh lo lee normal → los alias
 * mandan, sin forzar `-i` (que rompería el caso de varias cuentas del mismo host).
 * Idempotente: recrea cada carpeta destino en cada corrida.
 */
export function buildSshPreludeFromSetup(setup: SshSetup): string {
  const lines: string[] = []
  for (const m of setup.mounts) {
    const dst = `${NEUTRAL_HOME}/${m.basename}`
    const src = `${SSH_RO_BASE}/${m.basename}`
    lines.push(
      `rm -rf "${dst}"`,
      `mkdir -p "${dst}" && chmod 700 "${dst}"`,
      `if [ -d "${src}" ]; then cp -r "${src}/." "${dst}/" 2>/dev/null || true; ` +
        `find "${dst}" -maxdepth 1 -type f -exec chmod 600 {} + 2>/dev/null || true; chmod 700 "${dst}"; fi`
    )
  }
  lines.push(`mkdir -p "${NEUTRAL_HOME}/.ssh" && chmod 700 "${NEUTRAL_HOME}/.ssh"`)
  if (setup.configText != null) {
    // Heredoc CITADO ('…EOF'): el contenido del config va LITERAL (sin expansión).
    lines.push(
      `cat > "${NEUTRAL_HOME}/.ssh/config" <<'TESSERA_SSH_CONFIG_EOF'`,
      setup.configText,
      `TESSERA_SSH_CONFIG_EOF`,
      `chmod 600 "${NEUTRAL_HOME}/.ssh/config"`
    )
  }
  lines.push(`touch "${NEUTRAL_HOME}/.ssh/known_hosts" && chmod 600 "${NEUTRAL_HOME}/.ssh/known_hosts"`)
  return lines.join('\n')
}

/**
 * Snippet sh que prepara las llaves SSH en ext4 y escribe el wrapper de ssh.
 * Idempotente (recrea `~/.ssh_active` en cada corrida). Debe ejecutarse ANTES de
 * cualquier `git`/`ssh`. Si `~/.ssh` no existe (perfil sin sshDir) copia 0 llaves
 * y genera un wrapper sin `-i` (git local sigue OK; el push por SSH fallará por
 * falta de identidad, sin crash).
 */
export function sshKeyPrelude(): string {
  return [
    `SSH_SRC=${SSH_MOUNT}`,
    `SSH_ACT=${SSH_ACTIVE_DIR}`,
    `KH=${KNOWN_HOSTS}`,
    `WRAP=${GIT_SSH_WRAPPER}`,
    `rm -rf "$SSH_ACT"`,
    `mkdir -p "$SSH_ACT" && chmod 700 "$SSH_ACT"`,
    `touch "$KH" && chmod 600 "$KH"`,
    `IDENT=""`,
    `if [ -d "$SSH_SRC" ]; then`,
    `  for f in "$SSH_SRC"/*; do`,
    `    [ -f "$f" ] || continue`,
    `    if head -n1 "$f" 2>/dev/null | grep -q "PRIVATE KEY"; then`,
    `      b=$(basename "$f")`,
    `      cp "$f" "$SSH_ACT/$b" && chmod 600 "$SSH_ACT/$b"`,
    `      IDENT="$IDENT -i $SSH_ACT/$b"`,
    `    fi`,
    `  done`,
    `fi`,
    `cat > "$WRAP" <<EOF`,
    `#!/bin/sh`,
    // $KH e $IDENT se expanden al escribir el wrapper; "\$@" queda literal para
    // reenviar los argumentos que git le pasa a ssh (host + comando remoto).
    `exec ssh -o IdentitiesOnly=yes -o UserKnownHostsFile=$KH -o StrictHostKeyChecking=accept-new$IDENT "\\$@"`,
    `EOF`,
    `chmod 700 "$WRAP"`
  ].join('\n')
}

/** Variable de entorno de cada agente apuntando a su carpeta de credenciales. */
const AGENT_ENV_VAR: Record<Agente, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME'
}

export interface ComposeGitOptions {
  /** Si se da, añade la var del agente (CLAUDE_CONFIG_DIR/CODEX_HOME) apuntando aquí. */
  agente?: Agente
  containerConfigPath?: string
  /** Ejecuta el preludio de llaves SSH antes del comando (default true). */
  prelude?: boolean
  /**
   * Asignaciones KEY=VALUE adicionales para `env -i` (p.ej. `TERM=xterm-256color`
   * para una sesión interactiva). Se colocan junto a PATH/HOME/git; POSIX-quote
   * el valor si puede contener glob/espacios.
   */
  extraAssignments?: string[]
  /**
   * Setup ssh GLOBAL (config del usuario). Si se da, el preludio reproduce `~/.ssh`
   * honrando el config (alias por host) y GIT_SSH_COMMAND=ssh. Si se omite, se usa el
   * preludio histórico (cosecha de llaves de `~/.ssh` + wrapper). Comportamiento previo
   * INTACTO cuando no se pasa.
   */
  sshSetup?: SshSetup | null
}

/**
 * Compone el comando limpio COMPLETO para correr `userCommand` con git operativo:
 * `env -i PATH HOME <git assignments> [<agent var>] bash --noprofile --norc -c '<prelude>\n<cmd>'`.
 * Es la pieza que el test ejerce (pariente del buildCleanEnvCommand de AgentLauncher). No abre pty ni nada interactivo.
 */
export function composeCleanGitCommand(userCommand: string, opts: ComposeGitOptions = {}): string {
  const useConfigSsh = !!opts.sshSetup
  const assignments = [`PATH=${BASE_PATH}`, `HOME=${NEUTRAL_HOME}`, ...gitAgentAssignments(useConfigSsh)]
  if (opts.extraAssignments) assignments.push(...opts.extraAssignments)
  if (opts.agente && opts.containerConfigPath) {
    assignments.push(`${AGENT_ENV_VAR[opts.agente]}=${opts.containerConfigPath}`)
  }
  // Preludio: config-aware si hay setup ssh global; si no, el histórico (cosecha de
  // llaves + wrapper). `prelude:false` lo omite del todo.
  const preludeStr =
    opts.prelude === false ? '' : (opts.sshSetup ? buildSshPreludeFromSetup(opts.sshSetup) : sshKeyPrelude()) + '\n'
  const inner = preludeStr + userCommand
  // El citado POSIX vive en `shared/citarShell.ts`: aquí había una de sus tres copias.
  return `env -i ${assignments.join(' ')} bash --noprofile --norc -c ${citarSh(inner)}`
}
