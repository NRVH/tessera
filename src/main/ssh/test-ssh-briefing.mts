#!/usr/bin/env node
// =============================================================================
// Prueba del aviso SSH de arranque de los agentes (npm run test:ssh-briefing): el saneado de los textos del
// usuario, lo que dice el aviso (las disponibles, cuántas excluidas, `tssh ls`, no pedir contraseñas,
// explicar y esperar), el de bases como PREFIJO exacto, Claude Code sí y Codex no, la línea pasada de verdad
// por PowerShell 5.1 y por sh (apóstrofos tipográficos, comillas dobles), y el cableado de las ramas nativas.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { register } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { esWindows, type Plataforma } from '../../shared/plataforma.ts'
import type { SshConexion, SshListaConexiones } from '../../shared/ssh-ipc.ts'
import { briefingBasesAgente, type ConexionAviso } from '../db/briefingAgente.ts'
import { briefingCompuesto } from '../agents/briefingCompuesto.ts'
import { buildHostAgentLaunchCommand } from '../agents/lineaArranqueAgente.ts'
import { MAX_EN_AVISO, briefingSsh, textoParaAviso } from './briefingSsh.ts'
import { buscarDisponible, catalogoAgentes } from './catalogoAgentes.ts'

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
const j = (v: unknown): string => JSON.stringify(v)
const car = (codigo: number): string => String.fromCharCode(codigo)
/** Apóstrofo tipográfico, comillas dobles tipográficas y el separador de línea de Unicode, por su código. */
const APOSTROFO = car(0x2019)
const DOBLE_ABRE = car(0x201c)
const DOBLE_CIERRA = car(0x201d)
const SEPARADOR = car(0x2028)

let n = 0
function conexion(extra: Partial<SshConexion> & { alias: string }): SshConexion {
  return {
    id: `c-${++n}`,
    profileId: 'pa',
    grupoId: null,
    host: '192.0.2.10',
    puerto: 22,
    usuario: 'admin',
    metodo: 'sistema',
    tieneSecreto: false,
    disponibleAgentes: true,
    huellaServidor: [{ algoritmo: 'ssh-ed25519', sha256: 'AAAA' }],
    ...extra
  }
}
function lista(conexiones: SshConexion[]): SshListaConexiones {
  return { grupos: [{ id: 'g1', profileId: 'pa', nombre: 'Red' }], conexiones, ajenas: [], formatoAjeno: false }
}

const temporales: string[] = []
try {
  // ---------------------------------------------------------------------------
  hr('A - El saneado de los textos del usuario para la línea de arranque')
  {
    const raro = `O${APOSTROFO}Brien ${DOBLE_ABRE}nas${DOBLE_CIERRA} "x" \`y\`${SEPARADOR}fin\tz`
    const limpio = textoParaAviso(raro)
    check('(a1) comillas tipográficas, dobles y el acento grave pasan a apóstrofo recto', limpio === "O'Brien 'nas' 'x' 'y' fin z", j(limpio))
    check('(a2) ni saltos ni separadores de línea ni tabuladores: una sola línea', !/[\r\n\t]/.test(limpio) && !limpio.includes(SEPARADOR), j(limpio))
    check('(a3) un texto normal no cambia', textoParaAviso('nas casa (Producción)') === 'nas casa (Producción)', 'igual')
  }

  // ---------------------------------------------------------------------------
  hr('B - Lo que dice el aviso SSH')
  {
    const disponibles = [
      conexion({ alias: 'web', usuario: 'root', host: '10.0.0.5' }),
      conexion({ alias: `nas ${APOSTROFO}casa${APOSTROFO}`, metodo: 'contrasena', tieneSecreto: true, grupoId: 'g1' }),
      conexion({ alias: 'nueva', huellaServidor: [] }),
      conexion({ alias: 'sin clave', metodo: 'contrasena', tieneSecreto: false })
    ]
    const excluidas = [conexion({ alias: 'Servidor secreto', disponibleAgentes: false }), conexion({ alias: 'otra oculta', disponibleAgentes: false })]
    const ajena = conexion({ alias: 'de otro perfil', profileId: 'pb' })
    const aviso = briefingSsh(catalogoAgentes(lista([...disponibles, ...excluidas, ajena]), 'pa')) ?? ''
    check('(b1) nombra las disponibles con su destino', aviso.includes('«web» (root@10.0.0.5:22)') && aviso.includes("«nas 'casa'»"), aviso.slice(0, 200))
    check('(b2) y dice cuál no está lista aún: huella sin confirmar o sin contraseña guardada', aviso.includes('«nueva» (admin@192.0.2.10:22, huella sin confirmar)') && aviso.includes('«sin clave» (admin@192.0.2.10:22, sin la contraseña guardada)'), 'estados')
    check('(b3) NI el nombre de las excluidas NI las de otro perfil: solo cuántas', !aviso.includes('Servidor secreto') && !aviso.includes('otra oculta') && !aviso.includes('de otro perfil') && aviso.includes('Hay 2 conexiones más de este perfil que el usuario no dejó disponibles'), 'excluidas')
    check(
      '(b4) la lista y su estado son los del arranque: manda a `tssh ls` antes de decir que a una le falta algo',
      aviso.includes('La lista y su estado son los del arranque') && aviso.includes('`tssh ls` da los de ahora') && aviso.includes('puede que ya lo haya resuelto'),
      'tssh ls'
    )
    check('(b5) prohíbe pedir contraseñas', aviso.includes('No pidas ni escribas contraseñas, frases de clave ni claves'), 'regla')
    check('(b6) pide explicar y esperar antes de cambiar la configuración de un equipo', aviso.includes('Antes de cambiar la configuración de un equipo') && aviso.includes('espera a que el') && aviso.includes('usuario lo confirme'), 'regla')
    check('(b7) el vocabulario de tssh: run con --, cp con <alias>:<ruta>, doctor y help', ['`tssh run <alias> -- <orden>`', '`tssh cp <origen> <destino>`', '`<alias>:<ruta>`', '`tssh doctor <alias>`', '`tssh help`'].every((s) => aviso.includes(s)), 'vocabulario')
    check('(b8) sin comillas dobles ni tipográficas en todo el aviso (la línea de arranque las rompe)', !/["\u201c\u201d\u2018\u2019`]/.test(aviso.replace(/`[^`]*`/g, '')), 'sin comillas')
    const unaExcluida = briefingSsh(catalogoAgentes(lista([disponibles[0], excluidas[0]]), 'pa')) ?? ''
    check('(b9) con una sola excluida, en singular', unaExcluida.includes('Hay 1 conexión más de este perfil que el usuario no dejó disponible para los agentes'), 'singular')
    check('(b10) sin ninguna disponible no hay aviso (aunque haya excluidas)', briefingSsh(catalogoAgentes(lista(excluidas), 'pa')) === null && briefingSsh(catalogoAgentes(lista([]), 'pa')) === null, 'null')
    const ajeno: SshListaConexiones = { grupos: [], conexiones: [], ajenas: [], formatoAjeno: true, aviso: 'Formato de otra versión.' }
    check('(b11) con el registro ilegible tampoco (el agente arranca con el de siempre)', briefingSsh(catalogoAgentes(ajeno, 'pa')) === null, 'null')
    const muchas = Array.from({ length: MAX_EN_AVISO + 5 }, (_, i) => conexion({ alias: `srv-${String(i).padStart(2, '0')}` }))
    const largo = briefingSsh(catalogoAgentes(lista(muchas), 'pa')) ?? ''
    check(`(b12) nombra ${MAX_EN_AVISO} como mucho y manda a tssh ls por el resto`, largo.includes(`y 5 más (\`tssh ls\` las da todas)`) && !largo.includes(`srv-${MAX_EN_AVISO + 4}`), largo.length + ' caracteres')
  }

  // ---------------------------------------------------------------------------
  hr('C - El de bases queda como PREFIJO exacto; sin SSH, idéntico')
  const bd: ConexionAviso[] = [{ alias: 'ventas', motor: 'postgres', host: 'db.local', port: 5432, database: 'ventas', user: 'lector', readonly: true } as ConexionAviso]
  const avisoBd = briefingBasesAgente(bd, false) ?? ''
  const avisoSsh = briefingSsh(catalogoAgentes(lista([conexion({ alias: 'web' })]), 'pa')) ?? ''
  {
    const compuesto = briefingCompuesto(avisoBd, avisoSsh) ?? ''
    check('(c1) el de bases es un prefijo byte a byte', avisoBd.length > 0 && compuesto.slice(0, avisoBd.length) === avisoBd && Buffer.from(compuesto).subarray(0, Buffer.byteLength(avisoBd)).equals(Buffer.from(avisoBd)), `${avisoBd.length} caracteres`)
    check('(c2) y el SSH va detrás, separado', compuesto === `${avisoBd}\n\n${avisoSsh}`, 'detrás')
    check('(c3) sin SSH, el de bases tal cual (mismo objeto de texto)', briefingCompuesto(avisoBd, null) === avisoBd, 'igual')
    check('(c4) sin bases, solo el SSH; sin ninguno, null', briefingCompuesto(null, avisoSsh) === avisoSsh && briefingCompuesto(null, null) === null, 'null')
  }

  // ---------------------------------------------------------------------------
  hr('D - La línea de arranque: Claude Code lo recibe por --append-system-prompt y Codex por -c developer_instructions')
  {
    const compuesto = briefingCompuesto(avisoBd, avisoSsh)
    for (const p of ['windows', 'mac'] as Plataforma[]) {
      const claude = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, compuesto, p)
      const codex = buildHostAgentLaunchCommand('codex', 'codex', undefined, compuesto, p)
      check(`(d1 ${p}) Claude Code: --append-system-prompt con los dos avisos`, claude.startsWith('claude --append-system-prompt ') && claude.includes('Conexiones SSH de Tessera') && claude.includes('consultables con'), claude.slice(0, 80))
      check(`(d2 ${p}) Codex: -c developer_instructions con los dos avisos y el del sandbox`, codex.startsWith('codex -c ') && codex.includes('developer_instructions=Avisos de Tessera: ') && codex.includes('Conexiones SSH de Tessera') && codex.includes('consultables con') && codex.includes('fuera del sandbox') && !codex.includes('--append-system-prompt'), codex.slice(0, 80))
    }
  }

  // ---------------------------------------------------------------------------
  hr('E - La línea de arranque de verdad: PowerShell 5.1 y sh reciben el aviso intacto')
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-briefing-'))
    temporales.push(dir)
    const eco = path.join(dir, 'eco.cjs')
    const salida = path.join(dir, 'argv.json')
    writeFileSync(eco, "require('node:fs').writeFileSync(process.env.ECO_SALIDA, JSON.stringify(process.argv.slice(2)))\n")
    const trampa = [
      conexion({ alias: `O${APOSTROFO}Brien`, usuario: 'admin' }),
      conexion({ alias: 'con "dobles" impares"', usuario: 'root' }),
      conexion({ alias: 'precio $HOME `ls` 100%', usuario: 'root' })
    ]
    const soloSsh = briefingSsh(catalogoAgentes(lista(trampa), 'pa')) ?? ''
    const compuesto = briefingCompuesto(avisoBd, soloSsh)
    const esperado = (compuesto ?? '').replace(/\r?\n/g, ' ').trim()
    // El de bases lleva `"<SQL>"` y PowerShell 5.1 le quita esas comillas al pasarlo (anotado en el backlog):
    // aquí se mira que el argumento no se parte y que el bloque SSH llega entero.
    const sshPlano = soloSsh.replace(/\r?\n/g, ' ').trim()
    const leer = (): string[] => {
      try {
        return JSON.parse(readFileSync(salida, 'utf8')) as string[]
      } catch {
        return []
      }
    }
    if (esWindows()) {
      const linea = buildHostAgentLaunchCommand(`& '${process.execPath}' '${eco}'`, 'claude-code', undefined, compuesto, 'windows')
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      const argv = leer()
      check('(e1) PowerShell 5.1: un solo argumento, y el bloque SSH llega intacto (apóstrofo tipográfico, comillas dobles impares, $, `)', r.status === 0 && argv.length === 2 && argv[0] === '--append-system-prompt' && (argv[1] ?? '').endsWith(` ${sshPlano}`), `status=${r.status} argv=${argv.length} ${(r.stderr ?? '').slice(0, 160)}`)
      check('(e2) y el alias del apóstrofo llega con el recto, que `tssh` encuentra', (argv[1] ?? '').includes("«O'Brien»") && buscarDisponible(catalogoAgentes(lista(trampa), 'pa'), "O'Brien") !== null, 'buscable')
      rmSync(salida, { force: true })
      const lineaCodex = buildHostAgentLaunchCommand(`& '${process.execPath}' '${eco}'`, 'codex', undefined, compuesto, 'windows')
      const rc = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lineaCodex], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      const argvC = leer()
      check('(e2b) PowerShell 5.1, Codex: `-c` y un solo valor con el bloque SSH intacto', rc.status === 0 && argvC.length === 2 && argvC[0] === '-c' && (argvC[1] ?? '').startsWith('developer_instructions=Avisos de Tessera: ') && (argvC[1] ?? '').includes(` ${sshPlano} `), `status=${rc.status} argv=${argvC.length}`)
    } else {
      console.log('  (no es Windows: PowerShell 5.1 no aplica)')
    }
    rmSync(salida, { force: true })
    const sh = spawnSync('sh', ['-c', 'exit 0'], { windowsHide: true })
    if (sh.status === 0) {
      const linea = buildHostAgentLaunchCommand(`'${process.execPath.replace(/\\/g, '/')}' '${eco.replace(/\\/g, '/')}'`, 'claude-code', undefined, compuesto, 'mac')
      const r = spawnSync('sh', ['-c', linea], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      const argv = leer()
      check('(e3) sh (la línea POSIX de macOS): el mismo argumento intacto', r.status === 0 && argv.length === 2 && argv[1] === esperado, `status=${r.status} argv=${argv.length}`)
      rmSync(salida, { force: true })
      const lineaCodex = buildHostAgentLaunchCommand(`'${process.execPath.replace(/\\/g, '/')}' '${eco.replace(/\\/g, '/')}'`, 'codex', undefined, compuesto, 'mac')
      const rc = spawnSync('sh', ['-c', lineaCodex], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      const argvC = leer()
      check('(e3b) sh, Codex: `-c` y el aviso entero en un solo valor', rc.status === 0 && argvC.length === 2 && argvC[0] === '-c' && (argvC[1] ?? '').startsWith(`developer_instructions=Avisos de Tessera: ${esperado} `), `status=${rc.status} argv=${argvC.length}`)
    } else {
      console.log('  (sin sh: el caso POSIX se salta)')
    }
  }

  // ---------------------------------------------------------------------------
  hr('F - Cableado: la apertura y la recarga NATIVAS componen los dos avisos')
  await cableado(avisoBd)
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

/** Abre y recarga agentes nativos con terminales falsas y mira la línea de arranque que les llega. */
async function cableado(avisoBd: string): Promise<void> {
  const electronStub = 'export const app = {}; export const safeStorage = {}; export default {};'
  const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
  register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
  const { AgentTerminalController } = await import('../agents/AgentTerminalController.ts')
  const lanzadas: string[] = []
  const recargadas: string[] = []
  let k = 0
  const terminales = {
    async createSession(_p: unknown, opts: { project: string; launch?: string }) {
      lanzadas.push(opts.launch ?? '')
      return { id: `t${++k}`, workspacePath: opts.project, project: opts.project }
    },
    onData: () => () => {},
    onExit: () => () => {},
    write: () => {},
    estaViva: () => true,
    estaOcupada: () => false,
    pidDe: () => 1,
    async reloadSession(id: string, overrides?: { launch?: string }) {
      recargadas.push(overrides?.launch ?? '')
      return { id, workspacePath: 'x', project: 'x' }
    },
    async closeSession() {}
  }
  const perfil = { id: 'pa', nombre: 'PA', color: '#000000', agentes: [] }
  const crear = (conSsh: boolean): InstanceType<typeof AgentTerminalController> => {
    const ctrl = new AgentTerminalController({
      profiles: [perfil as never],
      sandbox: {} as never,
      accounts: {} as never,
      eventos: { emitir: () => {}, hayDestino: () => false },
      portapapeles: { leerPng: () => null },
      getDbBriefing: () => avisoBd,
      ...(conSsh ? { getSshBriefing: (profileId: string) => (profileId === 'pa' ? 'AVISO-SSH' : null) } : {}),
      binaries: { 'claude-code': 'claude', codex: 'codex' },
      log: () => {}
    })
    ;(ctrl as unknown as { terminals: typeof terminales }).terminals = terminales
    return ctrl
  }
  const ctrl = crear(true)
  const claude = await ctrl.open({ profileId: 'pa', agente: 'claude-code', projectHostPath: 'C:\\proy\\a', mode: 'host' })
  await ctrl.open({ profileId: 'pa', agente: 'codex', projectHostPath: 'C:\\proy\\b', mode: 'host' })
  const conLosDos = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, `${avisoBd}\n\nAVISO-SSH`)
  check('(f1) apertura nativa de Claude Code: el de bases y DETRÁS el SSH', lanzadas[0] === conLosDos, (lanzadas[0] ?? '').slice(-60))
  const codexConLosDos = buildHostAgentLaunchCommand('codex', 'codex', undefined, `${avisoBd}\n\nAVISO-SSH`)
  check('(f2) apertura nativa de Codex: los dos avisos por -c', lanzadas[1] === codexConLosDos && codexConLosDos.startsWith('codex -c '), j(lanzadas[1]).slice(0, 80))
  await ctrl.reload(claude.sessionId, [])
  check('(f3) recarga nativa (con montajes): vuelve a componer los dos', recargadas[0] === conLosDos, (recargadas[0] ?? '').slice(-60))
  const sinSsh = crear(false)
  await sinSsh.open({ profileId: 'pa', agente: 'claude-code', projectHostPath: 'C:\\proy\\c', mode: 'host' })
  check('(f4) sin aviso SSH, la línea es la de siempre (solo el de bases)', lanzadas[2] === buildHostAgentLaunchCommand('claude', 'claude-code', undefined, avisoBd), (lanzadas[2] ?? '').slice(-40))
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
