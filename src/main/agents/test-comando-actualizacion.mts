#!/usr/bin/env node
// =============================================================================
// Prueba de comandoActualizacion (npm run test:comando-actualizacion), para las dos
// plataformas desde cualquiera: detección del método de Codex y de Claude, la tabla
// método × plataforma con su entrecomillado, versiones hostiles, que Windows nunca
// devuelva `codex update`, el binario publicado y la clasificación de los errores.
// Decisiones: docs/decisiones/agentes/nativos-orden-por-metodo.md
// =============================================================================

import {
  binarioCodexPublicado,
  clasificarErrorInstalacion,
  detectarMetodoClaude,
  detectarMetodoCodex,
  ordenActualizacion,
  type OrdenActualizacion
} from './comandoActualizacion.ts'
import type { MetodoInstalacion } from '../../shared/agentes-nativos-ipc.ts'
import type { Plataforma } from '../../shared/plataforma.ts'

let pasadas = 0
let total = 0
function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}

const METODOS: MetodoInstalacion[] = ['npm', 'pnpm', 'bun', 'vite-plus', 'nativo', 'brew', 'gestor', 'desconocido']
const PLATAFORMAS: Plataforma[] = ['windows', 'mac', 'otra']
const txt = (o: OrdenActualizacion): string => JSON.stringify(o)

// ---------------------------------------------------------------------------
hr('(1) detectarMetodoCodex')
{
  const casos: Array<[string, { raizPaquete: string | null; prefijoNpm: string | null; plataforma: Plataforma }, MetodoInstalacion]> = [
    // La instalación REAL de esta máquina (Windows, npm global).
    [
      '(1a) Windows, npm global real',
      {
        raizPaquete: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex',
        prefijoNpm: 'C:\\Users\\maria\\AppData\\Roaming\\npm',
        plataforma: 'windows'
      },
      'npm'
    ],
    [
      '(1b) Windows, npm con barras `/`, otra caja y barra final',
      {
        raizPaquete: 'c:/users/MARIA/appdata/roaming/npm/node_modules/@openai/codex/',
        prefijoNpm: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\',
        plataforma: 'windows'
      },
      'npm'
    ],
    [
      '(1c) Windows, parece npm pero el prefijo de npm es OTRO → no es npm (sería una segunda copia)',
      {
        raizPaquete: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex',
        prefijoNpm: 'C:\\nvm4w\\nodejs',
        plataforma: 'windows'
      },
      'desconocido'
    ],
    [
      '(1d) Windows, sin npm (prefijo null) → nunca npm',
      { raizPaquete: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex', prefijoNpm: null, plataforma: 'windows' },
      'desconocido'
    ],
    [
      '(1e) Mac, npm de nvm: <prefijo>/lib/node_modules/@openai/codex',
      {
        raizPaquete: '/Users/yo/.nvm/versions/node/v22.20.0/lib/node_modules/@openai/codex',
        prefijoNpm: '/Users/yo/.nvm/versions/node/v22.20.0',
        plataforma: 'mac'
      },
      'npm'
    ],
    [
      '(1f) Mac, la forma de Windows (sin lib/) NO es npm en POSIX',
      {
        raizPaquete: '/usr/local/node_modules/@openai/codex',
        prefijoNpm: '/usr/local',
        plataforma: 'mac'
      },
      'desconocido'
    ],
    [
      '(1g) Mac distingue mayúsculas (las dos rutas salen del sistema)',
      {
        raizPaquete: '/users/yo/.npm-global/lib/node_modules/@openai/codex',
        prefijoNpm: '/Users/yo/.npm-global',
        plataforma: 'mac'
      },
      'desconocido'
    ],
    [
      '(1h) Windows, bun',
      { raizPaquete: 'C:\\Users\\yo\\.bun\\install\\global\\node_modules\\@openai\\codex', prefijoNpm: 'C:\\Users\\yo\\AppData\\Roaming\\npm', plataforma: 'windows' },
      'bun'
    ],
    [
      '(1i) Mac, bun',
      { raizPaquete: '/Users/yo/.bun/install/global/node_modules/@openai/codex', prefijoNpm: '/usr/local', plataforma: 'mac' },
      'bun'
    ],
    [
      '(1j) Windows, pnpm (almacén .pnpm)',
      {
        raizPaquete:
          'C:\\Users\\yo\\AppData\\Local\\pnpm\\global\\5\\node_modules\\.pnpm\\@openai+codex@0.156.0\\node_modules\\@openai\\codex',
        prefijoNpm: 'C:\\Users\\yo\\AppData\\Roaming\\npm',
        plataforma: 'windows'
      },
      'pnpm'
    ],
    [
      '(1k) Mac, pnpm',
      {
        raizPaquete: '/Users/yo/Library/pnpm/global/5/node_modules/.pnpm/@openai+codex@0.156.0/node_modules/@openai/codex',
        prefijoNpm: '/usr/local',
        plataforma: 'mac'
      },
      'pnpm'
    ],
    [
      '(1l) Mac, vite-plus con installId en subcarpeta',
      { raizPaquete: '/Users/yo/.vite-plus/packages/@openai/codex/k3x9/lib/node_modules/@openai/codex', prefijoNpm: '/usr/local', plataforma: 'mac' },
      'vite-plus'
    ],
    [
      '(1m) Windows, vite-plus con installId #',
      { raizPaquete: 'C:\\Users\\yo\\.vite-plus\\packages\\@openai\\codex#k3x9\\node_modules\\@openai\\codex', prefijoNpm: null, plataforma: 'windows' },
      'vite-plus'
    ],
    [
      '(1n) Mac, Homebrew cask',
      { raizPaquete: '/opt/homebrew/Caskroom/codex/0.156.0', prefijoNpm: '/opt/homebrew', plataforma: 'mac' },
      'brew'
    ],
    [
      '(1o) Mac, Homebrew fórmula',
      { raizPaquete: '/usr/local/Cellar/codex/0.156.0/libexec', prefijoNpm: '/usr/local', plataforma: 'mac' },
      'brew'
    ],
    [
      '(1p) Windows, una ruta con Caskroom NO es brew (no existe allí)',
      { raizPaquete: 'D:\\Caskroom\\codex\\0.156.0', prefijoNpm: null, plataforma: 'windows' },
      'desconocido'
    ],
    [
      '(1q) Windows, winget → gestor',
      {
        raizPaquete: 'C:\\Users\\yo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe',
        prefijoNpm: 'C:\\Users\\yo\\AppData\\Roaming\\npm',
        plataforma: 'windows'
      },
      'gestor'
    ],
    [
      '(1r) Windows, scoop → gestor',
      { raizPaquete: 'C:\\Users\\yo\\scoop\\apps\\codex\\current', prefijoNpm: null, plataforma: 'windows' },
      'gestor'
    ],
    [
      '(1s) Mac, mise → gestor',
      { raizPaquete: '/Users/yo/.local/share/mise/installs/npm-openai-codex/0.156.0', prefijoNpm: '/usr/local', plataforma: 'mac' },
      'gestor'
    ],
    ['(1t) raíz null → desconocido', { raizPaquete: null, prefijoNpm: '/usr/local', plataforma: 'mac' }, 'desconocido'],
    ['(1u) raíz vacía → desconocido', { raizPaquete: '   ', prefijoNpm: 'C:\\npm', plataforma: 'windows' }, 'desconocido'],
    [
      '(1v) Windows, un hermano con prefijo parecido (`codexfoo`) no es npm',
      {
        raizPaquete: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codexfoo',
        prefijoNpm: 'C:\\Users\\maria\\AppData\\Roaming\\npm',
        plataforma: 'windows'
      },
      'desconocido'
    ]
  ]
  for (const [nombre, entrada, esperado] of casos) {
    const r = detectarMetodoCodex(entrada)
    check(nombre, r === esperado, `${r} (esperado ${esperado})`)
  }
}

// ---------------------------------------------------------------------------
hr('(2) detectarMetodoClaude')
{
  const casos: Array<[string, { installMethod: string | null; rutaBinario: string | null; plataforma: Plataforma }, MetodoInstalacion]> = [
    ['(2a) native (lo de esta máquina)', { installMethod: 'native', rutaBinario: 'C:\\Users\\maria\\.local\\bin\\claude.exe', plataforma: 'windows' }, 'nativo'],
    ['(2b) NATIVE en mayúsculas', { installMethod: 'NATIVE', rutaBinario: null, plataforma: 'mac' }, 'nativo'],
    ['(2c) npm-global', { installMethod: 'npm-global', rutaBinario: null, plataforma: 'windows' }, 'npm'],
    ['(2d) global', { installMethod: 'global', rutaBinario: null, plataforma: 'mac' }, 'npm'],
    ['(2e) npm', { installMethod: 'npm', rutaBinario: null, plataforma: 'mac' }, 'npm'],
    [
      '(2f) Homebrew por la ruta MANDA sobre un installMethod native desfasado',
      { installMethod: 'native', rutaBinario: '/opt/homebrew/Caskroom/claude-code/2.1.281/claude', plataforma: 'mac' },
      'brew'
    ],
    [
      '(2g) winget por la ruta → gestor',
      {
        installMethod: null,
        rutaBinario: 'C:\\Users\\yo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe',
        plataforma: 'windows'
      },
      'gestor'
    ],
    [
      '(2h) sin installMethod, huella nativa de POSIX (versions/)',
      { installMethod: null, rutaBinario: '/Users/yo/.local/share/claude/versions/2.1.281', plataforma: 'mac' },
      'nativo'
    ],
    [
      '(2i) sin installMethod, huella nativa de Windows (~/.local/bin/claude.exe)',
      { installMethod: '', rutaBinario: 'C:\\Users\\yo\\.local\\bin\\claude.exe', plataforma: 'windows' },
      'nativo'
    ],
    [
      '(2j) installMethod desconocido NO se sustituye por la huella',
      { installMethod: 'local', rutaBinario: '/Users/yo/.local/bin/claude', plataforma: 'mac' },
      'desconocido'
    ],
    ['(2k) nada de nada', { installMethod: null, rutaBinario: null, plataforma: 'windows' }, 'desconocido'],
    [
      '(2l) npm global bajo el node de Homebrew (resuelto, sin Cellar) sigue siendo npm',
      {
        installMethod: 'npm-global',
        rutaBinario: '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
        plataforma: 'mac'
      },
      'npm'
    ],
    [
      '(2m) en Windows, una carpeta llamada Cellar no es Homebrew',
      { installMethod: 'native', rutaBinario: 'D:\\Cellar\\claude.exe', plataforma: 'windows' },
      'nativo'
    ]
  ]
  for (const [nombre, entrada, esperado] of casos) {
    const r = detectarMetodoClaude(entrada)
    check(nombre, r === esperado, `${r} (esperado ${esperado})`)
  }
}

// ---------------------------------------------------------------------------
hr('(3) ordenActualizacion: la tabla método × plataforma')
{
  const V = '0.156.1'
  const iguales = (o: OrdenActualizacion, esperado: OrdenActualizacion): boolean => txt(o) === txt(esperado)

  // Claude nativo: `claude update` en las dos, sin parar.
  for (const p of PLATAFORMAS) {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'nativo', plataforma: p, version: '2.1.281' })
    check(`(3a·${p}) Claude nativo → claude update, sin parar`, iguales(r, { tipo: 'auto', orden: 'claude update', requiereParar: false }), txt(r))
  }
  {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'npm', plataforma: 'windows', version: '2.1.281' })
    check(
      '(3b) Claude npm en Windows: npm install -g entrecomillado para PowerShell, PARAR',
      iguales(r, { tipo: 'auto', orden: "npm install -g '@anthropic-ai/claude-code@2.1.281'", requiereParar: true }),
      txt(r)
    )
  }
  {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'npm', plataforma: 'mac', version: '2.1.281' })
    check(
      '(3c) Claude npm en Mac: la misma orden, SIN parar (POSIX no bloquea)',
      iguales(r, { tipo: 'auto', orden: "npm install -g '@anthropic-ai/claude-code@2.1.281'", requiereParar: false }),
      txt(r)
    )
  }
  {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'brew', plataforma: 'mac', version: '2.1.281' })
    check('(3d) Claude brew → a mano, con `brew upgrade claude-code`', r.tipo === 'manual' && r.orden === 'brew upgrade claude-code', txt(r))
  }
  {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'gestor', plataforma: 'windows', version: '2.1.281' })
    check('(3e) Claude gestor → a mano, sin orden inventada', r.tipo === 'manual' && r.orden === null && r.motivo.length > 0, txt(r))
  }
  {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'desconocido', plataforma: 'mac', version: null })
    check('(3f) Claude desconocido → a mano, sugiere su propio `claude update`', r.tipo === 'manual' && r.orden === 'claude update', txt(r))
  }
  // Codex en Windows: los tres gestores con orden automática, todos PARAN.
  const esperadasWin: Array<[MetodoInstalacion, string]> = [
    ['npm', `npm install -g '@openai/codex@${V}'`],
    ['pnpm', `pnpm add -g '@openai/codex@${V}'`],
    ['bun', `bun add -g '@openai/codex@${V}'`]
  ]
  for (const [metodo, orden] of esperadasWin) {
    const r = ordenActualizacion({ agente: 'codex', metodo, plataforma: 'windows', version: V })
    check(`(3g·${metodo}) Codex ${metodo} en Windows → ${orden}, PARAR`, iguales(r, { tipo: 'auto', orden, requiereParar: true }), txt(r))
  }
  {
    const r = ordenActualizacion({ agente: 'codex', metodo: 'vite-plus', plataforma: 'windows', version: V })
    check('(3h) Codex vite-plus en Windows → a mano con `vp install -g`', r.tipo === 'manual' && r.orden === `vp install -g '@openai/codex@${V}'`, txt(r))
  }
  for (const metodo of ['nativo', 'brew', 'desconocido', 'gestor'] as MetodoInstalacion[]) {
    const r = ordenActualizacion({ agente: 'codex', metodo, plataforma: 'windows', version: V })
    check(`(3i·${metodo}) Codex ${metodo} en Windows → a mano, SIN orden`, r.tipo === 'manual' && r.orden === null, txt(r))
  }
  // Codex en Mac (y POSIX): `codex update` con CUALQUIER método, sin parar.
  for (const p of ['mac', 'otra'] as Plataforma[]) {
    for (const metodo of METODOS) {
      const r = ordenActualizacion({ agente: 'codex', metodo, plataforma: p, version: V })
      check(`(3j·${p}·${metodo}) Codex → codex update, sin parar`, iguales(r, { tipo: 'auto', orden: 'codex update', requiereParar: false }), txt(r))
    }
  }
  {
    const r = ordenActualizacion({ agente: 'codex', metodo: 'npm', plataforma: 'windows', version: '0.157.0-alpha.3' })
    check('(3k) una prerelease exacta es válida', r.tipo === 'auto' && r.orden === "npm install -g '@openai/codex@0.157.0-alpha.3'", txt(r))
  }
}

// ---------------------------------------------------------------------------
hr('(4) versiones hostiles: ninguna llega a una orden')
{
  const hostiles: Array<string | null> = [
    'latest',
    '^1.2.3',
    '~0.156.0',
    '>=0.156.0',
    '1.2.3 && calc',
    '1.2.3; rm -rf ~',
    "1.2.3' ; calc ; '",
    '1.2.3`calc`',
    '$(calc)',
    'https://evil.example/codex-0.156.1.tgz',
    'file:../codex',
    'v1.2.3',
    '1.2',
    '',
    null
  ]
  for (const v of hostiles) {
    const etiqueta = JSON.stringify(v)
    for (const [agente, metodo] of [
      ['codex', 'npm'],
      ['codex', 'pnpm'],
      ['codex', 'bun'],
      ['claude-code', 'npm']
    ] as const) {
      const r = ordenActualizacion({ agente, metodo, plataforma: 'windows', version: v })
      check(
        `(4a) ${agente} ${metodo} Windows con ${etiqueta} → a mano, sin orden, «sin versión exacta»`,
        r.tipo === 'manual' && r.orden === null && /sin versión exacta/i.test(r.motivo),
        txt(r)
      )
    }
    const mac = ordenActualizacion({ agente: 'claude-code', metodo: 'npm', plataforma: 'mac', version: v })
    check(`(4b) Claude npm Mac con ${etiqueta} → a mano, sin orden`, mac.tipo === 'manual' && mac.orden === null, txt(mac))
    // Las órdenes que NO llevan versión no se ven afectadas (y nunca la contienen).
    const cu = ordenActualizacion({ agente: 'claude-code', metodo: 'nativo', plataforma: 'windows', version: v })
    const cx = ordenActualizacion({ agente: 'codex', metodo: 'npm', plataforma: 'mac', version: v })
    check(
      `(4c) con ${etiqueta}, claude update / codex update siguen, sin la versión dentro`,
      cu.tipo === 'auto' && cu.orden === 'claude update' && cx.tipo === 'auto' && cx.orden === 'codex update',
      `${txt(cu)} ${txt(cx)}`
    )
  }
  // Barrido: ninguna combinación mete un carácter de control de shell en una orden.
  let limpias = true
  let ejemplo = ''
  for (const v of hostiles) {
    for (const agente of ['claude-code', 'codex'] as const) {
      for (const metodo of METODOS) {
        for (const plataforma of PLATAFORMAS) {
          const r = ordenActualizacion({ agente, metodo, plataforma, version: v })
          if (r.orden !== null && (/[;&|`$<>]/.test(r.orden) || (v && v.length > 0 && r.orden.includes(v)))) {
            limpias = false
            ejemplo = `${agente}/${metodo}/${plataforma}/${JSON.stringify(v)} → ${r.orden}`
          }
        }
      }
    }
  }
  check('(4d) ninguna orden contiene la versión hostil ni `; & | ` $ < >`', limpias, ejemplo || 'todas limpias')
}

// ---------------------------------------------------------------------------
hr('(5) la mitad negativa: Windows NUNCA devuelve `codex update`')
{
  let nunca = true
  let ejemplo = ''
  for (const metodo of METODOS) {
    for (const v of ['0.156.1', 'latest', null]) {
      const r = ordenActualizacion({ agente: 'codex', metodo, plataforma: 'windows', version: v })
      if (r.orden !== null && r.orden.includes('codex update')) {
        nunca = false
        ejemplo = `${metodo}/${String(v)} → ${txt(r)}`
      }
    }
  }
  check('(5a) ni automática ni sugerida, con ningún método ni versión', nunca, ejemplo || 'ninguna')
  let sinParar = true
  for (const metodo of METODOS) {
    const r = ordenActualizacion({ agente: 'codex', metodo, plataforma: 'mac', version: '0.156.1' })
    if (r.tipo !== 'auto' || r.requiereParar) sinParar = false
  }
  check('(5b) y en Mac Codex NUNCA pide parar sesiones', sinParar, 'requiereParar=false en los 8 métodos')
  const claudeNativoParar = PLATAFORMAS.some((p) => {
    const r = ordenActualizacion({ agente: 'claude-code', metodo: 'nativo', plataforma: p, version: null })
    return r.tipo === 'auto' && r.requiereParar
  })
  check('(5c) `claude update` no pide parar en ninguna plataforma', !claudeNativoParar, 'requiereParar=false')
}

// ---------------------------------------------------------------------------
hr('(6) binarioCodexPublicado')
{
  // Los dist-tags reales del 2026-09-23 (latest 0.156.1 con sus binarios ya publicados).
  const publicados = {
    latest: '0.156.1',
    'win32-x64': '0.156.1-win32-x64',
    'win32-arm64': '0.156.1-win32-arm64',
    'darwin-arm64': '0.156.1-darwin-arm64',
    'darwin-x64': '0.156.1-darwin-x64',
    'linux-x64': '0.156.1-linux-x64'
  }
  check('(6a) Windows x64 publicado', binarioCodexPublicado(publicados, '0.156.1', 'windows', 'x64'), 'true')
  check('(6b) Mac arm64 publicado (darwin, no «mac»)', binarioCodexPublicado(publicados, '0.156.1', 'mac', 'arm64'), 'true')
  check('(6c) otra → linux', binarioCodexPublicado(publicados, '0.156.1', 'otra', 'x64'), 'true')
  // La ventana peligrosa: `latest` ya es la nueva, el binario de la plataforma no.
  const ventana = { latest: '0.156.1', 'win32-x64': '0.156.0-win32-x64', 'darwin-arm64': '0.156.1-darwin-arm64' }
  check('(6d) latest nuevo pero win32-x64 viejo → NO', !binarioCodexPublicado(ventana, '0.156.1', 'windows', 'x64'), 'false')
  check('(6e) …y la otra plataforma sí, independiente', binarioCodexPublicado(ventana, '0.156.1', 'mac', 'arm64'), 'true')
  check('(6f) arquitectura sin tag → NO', !binarioCodexPublicado(publicados, '0.156.1', 'otra', 'arm64'), 'false')
  check('(6g) versión hostil → NO', !binarioCodexPublicado({ 'win32-x64': 'latest-win32-x64' }, 'latest', 'windows', 'x64'), 'false')
  check('(6h) nombre de Tessera en la clave (mac-arm64) no cuenta', !binarioCodexPublicado({ 'mac-arm64': '0.156.1-mac-arm64' }, '0.156.1', 'mac', 'arm64'), 'false')
  check('(6i) tags vacíos → NO', !binarioCodexPublicado({}, '0.156.1', 'windows', 'x64'), 'false')
  check(
    '(6j) una clave heredada del prototipo no cuenta',
    !binarioCodexPublicado(Object.create({ 'win32-x64': '0.156.1-win32-x64' }) as Record<string, string>, '0.156.1', 'windows', 'x64'),
    'false'
  )
}

// ---------------------------------------------------------------------------
hr('(7) clasificarErrorInstalacion')
{
  const ebusy =
    'npm error code EBUSY\nnpm error syscall rename\n' +
    'npm error path C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\n' +
    'npm error errno -4082\nnpm error EBUSY: resource busy or locked, rename'
  const bloqueadores = [
    { pid: 4242, nombre: 'codex.exe', ruta: 'C:\\x\\codex.exe', esDemonio: true },
    { pid: 77, nombre: 'node.exe', ruta: 'C:\\x\\node.exe', esDemonio: false }
  ]
  {
    const r = clasificarErrorInstalacion({ salida: ebusy, codigo: 4082, tope: false, plataforma: 'windows', bloqueadores, agente: 'codex', orden: 'npm install -g x' })
    check(
      '(7a) EBUSY en Windows → bloqueado, dice «fuera de Tessera» y nombra a los que siguen',
      r.motivo === 'bloqueado' && r.detalle.includes('fuera de Tessera') && r.detalle.includes('tu editor u otra terminal') && r.detalle.includes('codex.exe (pid 4242') && r.detalle.includes('node.exe (pid 77)') && r.ordenManual === 'npm install -g x',
      JSON.stringify(r)
    )
  }
  {
    // EPERM es AMBIGUO en Windows (libuv traduce ERROR_ACCESS_DENIED a EPERM): sin nadie
    // que tenga la carpeta abierta, no se culpa a «un Codex fuera de Tessera».
    const r = clasificarErrorInstalacion({
      salida: 'npm error code EPERM\nnpm error syscall unlink',
      codigo: 1,
      tope: false,
      plataforma: 'windows',
      bloqueadores: [],
      agente: 'codex',
      orden: "npm install -g '@openai/codex@0.156.1'"
    })
    check(
      '(7b) EPERM en Windows SIN bloqueadores → permisos: «administrador» y la orden, sin culpar a otro programa',
      r.motivo === 'permisos' &&
        r.detalle.includes('administrador') &&
        r.detalle.includes("npm install -g '@openai/codex@0.156.1'") &&
        r.detalle.includes('antivirus') &&
        !r.detalle.includes('fuera de Tessera') &&
        !r.detalle.includes('tu editor') &&
        r.ordenManual === "npm install -g '@openai/codex@0.156.1'",
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({
      salida: 'npm error code EPERM\nnpm error syscall rename',
      codigo: 1,
      tope: false,
      plataforma: 'windows',
      bloqueadores: [{ pid: 4242, nombre: 'codex.exe', ruta: 'C:\\x\\codex.exe', esDemonio: true }],
      agente: 'codex'
    })
    check(
      '(7b2) EPERM en Windows CON un bloqueador a la vista → bloqueado, y lo nombra',
      r.motivo === 'bloqueado' && r.detalle.includes('codex.exe (pid 4242') && r.detalle.includes('Siguen abiertos'),
      JSON.stringify(r)
    )
  }
  {
    // La salida real de npm con un prefijo protegido (Node instalado en Program Files).
    const r = clasificarErrorInstalacion({
      salida: 'npm error code EPERM\nnpm error syscall mkdir\nnpm error path C:\\Program Files\\nodejs\\node_modules\\@openai',
      codigo: 1,
      tope: false,
      plataforma: 'windows',
      bloqueadores: [],
      agente: 'codex',
      orden: "npm install -g '@openai/codex@0.156.1'"
    })
    check(
      '(7b3) la salida real de npm sobre Program Files → permisos, con la orden para el administrador',
      r.motivo === 'permisos' && r.detalle.includes('Program Files') && r.detalle.includes('administrador'),
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({ salida: 'npm error code EPERM', codigo: 1, tope: false, plataforma: 'windows', bloqueadores: [] })
    check(
      '(7b4) EPERM en Windows sin orden ni agente: frase completa, sin orden inventada',
      r.motivo === 'permisos' && r.detalle.includes('el agente') && r.detalle.includes('administrador') && r.ordenManual === undefined,
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({
      salida: 'npm error code EACCES\nnpm error syscall mkdir\nnpm error path /usr/local/lib/node_modules/@openai',
      codigo: 243,
      tope: false,
      plataforma: 'mac',
      bloqueadores: [],
      agente: 'codex',
      orden: 'codex update'
    })
    check(
      '(7c) EACCES en Mac → permisos, con la orden exacta y «tu Mac» (de nombresSistema), sin «administrador»',
      r.motivo === 'permisos' &&
        r.detalle.includes('codex update') &&
        r.detalle.includes('tu Mac') &&
        r.ordenManual === 'codex update' &&
        !r.detalle.includes('Windows') &&
        !r.detalle.includes('administrador'),
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({ salida: 'Error: EPERM: operation not permitted, rename', codigo: 1, tope: false, plataforma: 'mac', bloqueadores: [] })
    check('(7d) EPERM en Mac → permisos, NO bloqueado (POSIX no bloquea por uso)', r.motivo === 'permisos', JSON.stringify(r))
  }
  {
    const r = clasificarErrorInstalacion({ salida: 'npm error code EACCES', codigo: 1, tope: false, plataforma: 'windows', bloqueadores: [], orden: 'npm install -g y' })
    check(
      '(7e) EACCES en Windows → permisos, con «tu Windows» y como administrador (sin elevar fallaría igual)',
      r.motivo === 'permisos' && r.detalle.includes('tu Windows') && r.detalle.includes('administrador') && !r.detalle.includes('Mac'),
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({ salida: 'EBUSY: resource busy or locked', codigo: 1, tope: false, plataforma: 'mac', bloqueadores: [] })
    check('(7f) EBUSY en Mac → no es «bloqueado» (el aviso de cerrar Codex es de Windows)', r.motivo !== 'bloqueado', JSON.stringify(r))
  }
  for (const [nombre, salida] of [
    ['ENOTFOUND', 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed'],
    ['ETIMEDOUT', 'npm error code ETIMEDOUT'],
    ['ECONNRESET', 'npm error code ECONNRESET'],
    ['ERR_SOCKET_TIMEOUT', 'npm error code ERR_SOCKET_TIMEOUT'],
    ['npm error network', 'npm error network This is a problem related to network connectivity.']
  ] as const) {
    const r = clasificarErrorInstalacion({ salida, codigo: 1, tope: false, plataforma: 'windows', bloqueadores: [], orden: 'npm install -g z' })
    check(`(7g·${nombre}) → red, sin orden manual (reintentar vale)`, r.motivo === 'red' && r.ordenManual === undefined, JSON.stringify(r))
  }
  {
    const r = clasificarErrorInstalacion({ salida: ebusy, codigo: null, tope: true, plataforma: 'windows', bloqueadores, agente: 'codex' })
    check('(7h) tope manda aunque la salida traiga EBUSY', r.motivo === 'tope', JSON.stringify(r))
  }
  {
    const r = clasificarErrorInstalacion({
      salida: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@openai%2fcodex - Not found\n\n',
      codigo: 1,
      tope: false,
      plataforma: 'windows',
      bloqueadores: [],
      agente: 'claude-code'
    })
    check(
      '(7i) cualquier otro → fallo, con código y última línea, nombrando al agente',
      r.motivo === 'fallo' && r.detalle.includes('código 1') && r.detalle.includes('404 Not Found') && r.detalle.includes('Claude Code'),
      JSON.stringify(r)
    )
  }
  {
    const r = clasificarErrorInstalacion({ salida: 'x'.repeat(5000), codigo: 1, tope: false, plataforma: 'mac', bloqueadores: [] })
    check('(7j) una última línea kilométrica se recorta', r.detalle.length < 400, `${r.detalle.length} caracteres`)
  }
  {
    const r = clasificarErrorInstalacion({ salida: '', codigo: 1, tope: false, plataforma: 'windows', bloqueadores: [] })
    check('(7k) sin agente ni salida: frase completa, sin orden manual', r.motivo === 'fallo' && r.detalle.includes('el agente') && r.ordenManual === undefined, JSON.stringify(r))
  }
}

hr(`VEREDICTO: ${pasadas}/${total} PASS`)
process.exit(pasadas === total ? 0 : 1)
