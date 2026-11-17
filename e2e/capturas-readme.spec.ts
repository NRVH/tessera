// =============================================================================
// Genera las capturas del README (`assets/capturas/`) y, con `TESSERA_CAPTURAS_ACADEMY=1`, las de
// Tessera Academy en el idioma de `TESSERA_CAPTURAS_IDIOMA`, con datos NEUTROS: perfiles, proyectos,
// repo git y base de datos de demostración, agente falso y `userData` temporal. NO es una prueba:
// solo corre con `npm run capturas:readme` o `capturas:academy`. Hace falta el paquete
// (`npm run pack:dir`) y, para la base de datos, Docker con `postgres:16-alpine`.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirConsolaNueva, ejecutarTodoSeleccionado, esperarFinEjecucion, desplegar, fila, filaTras } from './consolaAyudas'
import { monacoConsola } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { sembrarHuellas } from './sshFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, MOD, PLATAFORMA, type SesionTessera } from './tessera'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const SALIDA = resolve(process.cwd(), 'assets', 'capturas')
const SALIDA_ACADEMY = resolve(process.cwd(), 'src', 'renderer', 'src', 'features', 'academy', 'capturas')
const ANCHO_ACADEMY = 1200

/** Con `TESSERA_CAPTURAS_ACADEMY=1` solo se escriben las de la Academy, en el idioma de la pasada. */
const SOLO_ACADEMY = process.env.TESSERA_CAPTURAS_ACADEMY === '1'
const IDIOMA: 'es' | 'en' = process.env.TESSERA_CAPTURAS_IDIOMA === 'en' ? 'en' : 'es'

/** Las etiquetas de la interfaz que buscan los selectores, en el idioma de la pasada. */
const L =
  IDIOMA === 'en'
    ? {
        dividida: 'Editor and preview',
        gitCambios: /^Git · Changes/,
        gitHistorial: 'Git · History',
        terminal: 'Terminal',
        nuevaTerminal: 'New terminal',
        maximizar: 'Maximize terminal panel',
        restaurar: 'Restore terminal panel',
        editar: 'Edit…',
        editarSsh: 'Edit SSH connection',
        diferencias: 'Differences',
        archivos: 'Files',
        conexionesBd: 'Databases',
        tablas: 'tables',
        mosaico: 'Agent mosaic'
      }
    : {
        dividida: 'Editor y vista previa',
        gitCambios: /^Git · Cambios/,
        gitHistorial: 'Git · Historial',
        terminal: 'Terminal',
        nuevaTerminal: 'Nueva terminal',
        maximizar: 'Maximizar el panel de terminal',
        restaurar: 'Restaurar el panel de terminal',
        editar: 'Editar…',
        editarSsh: 'Editar conexión SSH',
        diferencias: 'Diferencias',
        archivos: 'Archivos',
        conexionesBd: 'Bases de datos',
        tablas: 'tablas',
        mosaico: 'Mosaico de agentes'
      }

/**
 * Carpeta de los proyectos de demostración: corta y sin nombre de usuario, porque su ruta
 * sale en el prompt de la terminal. Si ya existe se aborta: no se pisa nada ajeno.
 */
const BASE = PLATAFORMA === 'windows' ? 'C:\\demo' : '/tmp/tessera-demo'

const PERFILES = [
  { id: 'personal', nombre: 'Personal', color: '#7c5cff', proyectos: ['tienda-web', 'api-pedidos', 'notas'] },
  { id: 'estudio', nombre: 'Estudio', color: '#1f9e7a', proyectos: ['apuntes-sql', 'practicas-rust'] },
  { id: 'libres', nombre: 'Proyectos libres', color: '#e0832b', proyectos: ['juego-2d'] }
]

const ARCHIVOS: Record<string, Record<string, string>> = {
  'tienda-web': {
    'README.md':
      '# Tienda web\n\nCatálogo y carrito de una tienda pequeña.\n\n## Puesta en marcha\n\n```bash\nnpm install\nnpm run dev\n```\n\n## Estructura\n\n| Carpeta | Contenido |\n|---|---|\n| `src/carrito.ts` | Líneas del carrito y totales |\n| `src/precios.ts` | IVA y descuentos |\n| `src/catalogo.ts` | Productos disponibles |\n\n## Pendiente\n\n- [x] Cupones de descuento\n- [ ] Cálculo de envíos\n- [ ] Pago con tarjeta\n',
    'package.json': '{\n  "name": "tienda-web",\n  "version": "0.3.0",\n  "scripts": { "dev": "vite", "test": "node --test" }\n}\n',
    'src/catalogo.ts':
      "export interface Producto {\n  id: string\n  nombre: string\n  precio: number\n  stock: number\n}\n\nexport const CATALOGO: Producto[] = [\n  { id: 'cam-01', nombre: 'Camiseta básica', precio: 14.9, stock: 40 },\n  { id: 'sud-02', nombre: 'Sudadera con capucha', precio: 39.5, stock: 12 },\n  { id: 'gor-03', nombre: 'Gorra de lana', precio: 11.0, stock: 3 }\n]\n",
    'src/precios.ts':
      "// Reglas de precio: IVA y descuentos por cupón.\nexport const IVA = 0.21\n\nexport function conIva(base: number): number {\n  return Math.round(base * (1 + IVA) * 100) / 100\n}\n\nexport function aplicarCupon(total: number, porcentaje: number): number {\n  return Math.max(0, total - total * (porcentaje / 100))\n}\n",
    'src/carrito.ts':
      "import { CATALOGO, type Producto } from './catalogo'\nimport { aplicarCupon, conIva } from './precios'\n\nexport interface Linea {\n  producto: Producto\n  cantidad: number\n}\n\nexport class Carrito {\n  private lineas: Linea[] = []\n\n  anadir(id: string, cantidad = 1): void {\n    const producto = CATALOGO.find((p) => p.id === id)\n    if (!producto) throw new Error(`Producto desconocido: ${id}`)\n    this.lineas.push({ producto, cantidad })\n  }\n\n  subtotal(): number {\n    return this.lineas.reduce((s, l) => s + l.producto.precio * l.cantidad, 0)\n  }\n\n  total(cupon = 0): number {\n    return conIva(aplicarCupon(this.subtotal(), cupon))\n  }\n}\n",
    'src/index.ts': "import { Carrito } from './carrito'\n\nconst carrito = new Carrito()\ncarrito.anadir('cam-01', 2)\nconsole.log(carrito.total())\n"
  },
  'api-pedidos': {
    'README.md': '# API de pedidos\n\nServicio REST para crear y consultar pedidos.\n',
    'src/pedidos.ts': "export interface Pedido {\n  id: number\n  clienteId: number\n  total: number\n}\n\nexport function totalDePedidos(pedidos: Pedido[]): number {\n  return pedidos.reduce((s, p) => s + p.total, 0)\n}\n"
  },
  notas: { 'ideas.md': '# Ideas\n\n- Probar el mosaico de agentes\n- Ordenar las notas por proyecto\n' },
  'apuntes-sql': { 'joins.sql': 'select c.nombre, count(*)\nfrom clientes c\njoin pedidos p on p.cliente_id = c.id\ngroup by c.nombre;\n' },
  'practicas-rust': { 'main.rs': 'fn main() {\n    println!("Hola, Tessera");\n}\n' },
  'juego-2d': { 'jugador.js': 'export class Jugador {\n  constructor() {\n    this.x = 0\n    this.y = 0\n  }\n}\n' }
}

/** Nuevo contenido (sin confirmar) de `carrito.ts`: es lo que enseña el diff. */
const cambiarCarrito = (texto: string): string =>
  texto
  .replace(
    "import { aplicarCupon, conIva } from './precios'",
    "import { envio } from './envios'\nimport { aplicarCupon, conIva } from './precios'"
  )
  .replace(
    '  total(cupon = 0): number {\n    return conIva(aplicarCupon(this.subtotal(), cupon))\n  }',
    '  /** Total con IVA, cupón y gastos de envío. */\n  total(cupon = 0, zona = \'peninsula\'): number {\n    const base = aplicarCupon(this.subtotal(), cupon)\n    return conIva(base) + envio(base, zona)\n  }'
  )

const COMMITS: { mensaje: string; fecha: string; rama: string; fusion?: string }[] = [
  { mensaje: 'feat: catálogo inicial de productos', fecha: '2026-08-24T10:00:00Z', rama: 'main' },
  { mensaje: 'feat: carrito con subtotal y total', fecha: '2026-08-27T11:30:00Z', rama: 'main' },
  { mensaje: 'feat: descuentos por cupón', fecha: '2026-09-02T09:15:00Z', rama: 'feature/descuentos' },
  { mensaje: 'fix: redondeo del IVA en el carrito', fecha: '2026-09-03T16:40:00Z', rama: 'main' },
  { mensaje: 'test: cupones caducados y porcentajes límite', fecha: '2026-09-04T12:05:00Z', rama: 'feature/descuentos' },
  { mensaje: 'Merge branch feature/descuentos', fecha: '2026-09-06T08:20:00Z', rama: 'main', fusion: 'feature/descuentos' },
  { mensaje: 'feat: aviso de stock bajo en el catálogo', fecha: '2026-09-10T17:10:00Z', rama: 'main' },
  { mensaje: 'feat: tarifas de envío por zona', fecha: '2026-09-12T10:45:00Z', rama: 'feature/envios' },
  { mensaje: 'docs: guía de puesta en marcha', fecha: '2026-09-15T13:00:00Z', rama: 'main' },
  { mensaje: 'fix: no permitir cantidades negativas', fecha: '2026-09-17T09:30:00Z', rama: 'feature/envios' },
  { mensaje: 'Merge branch feature/envios', fecha: '2026-09-18T18:00:00Z', rama: 'main', fusion: 'feature/envios' },
  { mensaje: 'chore: actualizar dependencias', fecha: '2026-09-29T11:00:00Z', rama: 'main' }
]

function entornoGit(fecha: string): Record<string, string> {
  const heredado = Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^GIT_/i.test(k))
  return {
    ...(Object.fromEntries(heredado) as Record<string, string>),
    GIT_CONFIG_GLOBAL: PLATAFORMA === 'windows' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Demo',
    GIT_AUTHOR_EMAIL: 'demo@example.com',
    GIT_COMMITTER_NAME: 'Demo',
    GIT_COMMITTER_EMAIL: 'demo@example.com',
    GIT_AUTHOR_DATE: fecha,
    GIT_COMMITTER_DATE: fecha
  }
}

function git(dir: string, fecha: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    env: entornoGit(fecha),
    stdio: 'ignore'
  })
}

/** Crea los archivos de un proyecto y, en `tienda-web`, su historial con ramas y cambios sin confirmar. */
function crearProyecto(nombre: string): string {
  const dir = join(BASE, nombre)
  for (const [ruta, texto] of Object.entries(ARCHIVOS[nombre])) {
    mkdirSync(join(dir, ruta, '..'), { recursive: true })
    writeFileSync(join(dir, ruta), texto)
  }
  if (nombre !== 'tienda-web') return dir
  // `carrito.ts` e `index.ts` entran en el segundo commit: el primero lleva el resto.
  const tardios = ['src/carrito.ts', 'src/index.ts']
  const guardados = new Map(tardios.map((r) => [r, readFileSync(join(dir, r), 'utf8')]))
  for (const r of tardios) rmSync(join(dir, r))
  git(dir, COMMITS[0].fecha, 'init', '-q', '-b', 'main')
  COMMITS.forEach((c, i) => {
    const f = c.fecha
    if (i > 0) {
      const existe = execFileSync('git', ['branch', '--list', c.rama], { cwd: dir, env: entornoGit(f) }).toString().trim() !== ''
      if (existe) git(dir, f, 'checkout', '-q', c.rama)
      else git(dir, f, 'checkout', '-q', '-b', c.rama, 'main')
    }
    if (c.fusion) {
      git(dir, f, 'merge', '-q', '--no-ff', '-m', c.mensaje, c.fusion)
      return
    }
    if (i === 1) for (const [r, t] of guardados) writeFileSync(join(dir, r), t)
    // Cada rama anota en su propio archivo, para que las fusiones no choquen.
    if (i > 1) {
      const documento = c.rama === 'main' ? 'CHANGELOG.md' : `docs/${c.rama.split('/')[1]}.md`
      const ruta = join(dir, documento)
      mkdirSync(join(ruta, '..'), { recursive: true })
      writeFileSync(ruta, (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '# Cambios\n\n') + `- ${c.mensaje}\n`)
    }
    git(dir, f, 'add', '-A')
    git(dir, f, 'commit', '-q', '-m', c.mensaje)
  })
  git(dir, COMMITS[COMMITS.length - 1].fecha, 'checkout', '-q', 'main')
  // El estado de trabajo que enseñan las capturas: dos modificados y uno nuevo.
  writeFileSync(join(dir, 'src', 'carrito.ts'), cambiarCarrito(guardados.get('src/carrito.ts')!))
  writeFileSync(
    join(dir, 'src', 'envios.ts'),
    "// Gastos de envío por zona: gratis a partir de 50 €.\nconst TARIFAS: Record<string, number> = { peninsula: 4.95, baleares: 7.9, canarias: 12 }\n\nexport function envio(base: number, zona: string): number {\n  if (base >= 50) return 0\n  return TARIFAS[zona] ?? TARIFAS.peninsula\n}\n"
  )
  writeFileSync(join(dir, 'src', 'precios.ts'), ARCHIVOS['tienda-web']['src/precios.ts'].replace('= 0.21', '= 0.21 // tipo general'))
  return dir
}

/** La conversación que pinta el agente de demostración, en el idioma de la pasada. */
const CONVERSACION_DEMO = {
  es: {
    pide: 'Añade el cálculo de envíos al carrito',
    reviso: 'Reviso primero cómo calcula el total.',
    lineas: 'líneas',
    separo: 'Lo separo en su propio módulo:',
    tarifa: 'tarifa por zona',
    suma: 'suma el envío al total',
    listo: 'Listo. ¿Ejecuto los tests?'
  },
  en: {
    pide: 'Add shipping costs to the cart',
    reviso: 'First I check how the total is computed.',
    lineas: 'lines',
    separo: 'I split it into its own module:',
    tarifa: 'rate per zone',
    suma: 'adds shipping to the total',
    listo: 'Done. Shall I run the tests?'
  }
}

/**
 * Programa del agente de demostración: pinta una conversación fija, sin pid, ruta ni
 * latido, y deja pasar `--version`, `--help`, `update` y `npm` al agente falso de siempre.
 */
function programaDemo(original: string): string {
  return `'use strict'
const [estado, agente, ...args] = process.argv.slice(2)
if (agente === 'npm' || ['--version', '-v', '--help', 'update'].includes(args[0])) {
  require(${JSON.stringify(original)})
  return
}
const E = String.fromCharCode(27)
const NL = String.fromCharCode(13, 10)
const c = (n, t) => E + '[' + n + 'm' + t + E + '[0m'
const proyecto = require('node:path').basename(process.cwd())
// El mismo apunte de arranque que el agente falso: es lo que el guion espera.
require('node:fs').appendFileSync(
  require('node:path').join(estado, 'eventos.log'),
  JSON.stringify({ t: Date.now(), tipo: 'arranque', agente, pid: process.pid, cwd: process.cwd(), argv: args }) + String.fromCharCode(10)
)
const nombre = agente === 'codex' ? 'OpenAI Codex' : 'Claude Code'
const L = []
const borde = c('38;5;209', '+----------------------------+')
const fila = (crudo, texto) => c('38;5;209', '|') + ' ' + texto + ' '.repeat(Math.max(0, 27 - crudo.length)) + c('38;5;209', '|')
L.push(borde)
L.push(fila('* ' + nombre, c('1', '* ' + nombre)))
L.push(fila('proyecto: ' + proyecto, c('2', 'proyecto: ' + proyecto)))
L.push(borde)
L.push('')
const T = ${JSON.stringify(CONVERSACION_DEMO[IDIOMA])}
L.push(c('1;36', '>') + ' ' + T.pide)
L.push('')
L.push(c('1;32', '*') + ' ' + T.reviso)
L.push('  ' + c('2', '- Read(src/carrito.ts)') + c('2', '  48 ' + T.lineas))
L.push('  ' + c('2', '- Read(src/precios.ts)') + c('2', '  22 ' + T.lineas))
L.push('')
L.push(c('1;32', '*') + ' ' + T.separo)
L.push('  - ' + c('1', 'envios.ts') + ': ' + T.tarifa)
L.push('  - ' + c('1', 'carrito.ts') + ': ' + T.suma)
L.push('  ' + c('2', '- Write(src/envios.ts)') + '  ' + c('32', '+9'))
L.push('  ' + c('2', '- Update(src/carrito.ts)') + '  ' + c('32', '+5') + ' ' + c('31', '-2'))
L.push('')
L.push(c('1;32', '*') + ' ' + T.listo)
L.push('')
L.push(c('1;36', '>') + ' ')
process.stdout.write(L.join(NL))
if (process.stdin.isTTY) process.stdin.setRawMode(true)
let ultimo = 0
process.stdin.on('data', (b) => {
  for (const x of b) {
    if (x !== 3) continue
    if (Date.now() - ultimo < 3000) process.exit(0)
    ultimo = Date.now()
  }
})
process.stdin.resume()
setInterval(() => {}, 1000)
`
}

/** Sustituye el programa del agente falso por el de demostración, conservando el original. */
function instalarAgenteDemo(agente: AgenteFalso): void {
  const programa = join(agente.raiz, 'agente-falso.cjs')
  const original = join(agente.raiz, 'agente-original.cjs')
  writeFileSync(original, readFileSync(programa))
  const demo = programaDemo(original)
  writeFileSync(programa, demo)
  // En Windows el Codex corre desde el paquete de npm, con su propia copia del programa.
  const codexJs = join(agente.raizCodex, 'bin', 'codex.js')
  if (existsSync(codexJs)) writeFileSync(codexJs, demo)
}

/**
 * El «ssh» de demostración: la app lo lanza en lugar de OpenSSH (`TESSERA_SSH_BINARIO`, que solo el
 * arnés e2e admite). Pinta el saludo de un servidor de ejemplo y un prompt, y contesta a unas pocas
 * órdenes con salida fija. Nada toca la red.
 */
const PROGRAMA_SSH_DEMO = `'use strict'
const NL = String.fromCharCode(13, 10)
const E = String.fromCharCode(27)
const verde = (t) => E + '[1;32m' + t + E + '[0m'
const azul = (t) => E + '[1;34m' + t + E + '[0m'
const prompt = () => verde('deploy@web-01') + ':' + azul('~') + '$ '
const salidas = {
  uptime: [' 10:42:17 up 23 days,  4:05,  1 user,  load average: 0.18, 0.22, 0.19'],
  'df -h /': ['Filesystem      Size  Used Avail Use% Mounted on', '/dev/sda1        80G   31G   46G  41% /'],
  'systemctl is-active nginx': ['active']
}
const saludo = [
  'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)',
  '',
  '  System load:  0.18               Processes:             132',
  '  Usage of /:   41.2% of 79.0GB    Users logged in:       0',
  '  Memory usage: 37%                IPv4 address for eth0: 192.0.2.10',
  '',
  'Last login: Mon Oct  5 18:20:44 2026 from 198.51.100.7'
]
process.stdout.write(saludo.join(NL) + NL + prompt())
if (process.stdin.isTTY) process.stdin.setRawMode(true)
let linea = ''
process.stdin.on('data', (b) => {
  for (const ch of b.toString('utf8')) {
    if (ch === String.fromCharCode(13)) {
      const orden = linea.trim()
      linea = ''
      process.stdout.write(NL)
      if (orden === 'exit') process.exit(0)
      for (const l of salidas[orden] || []) process.stdout.write(l + NL)
      process.stdout.write(prompt())
    } else if (ch === String.fromCharCode(127)) {
      if (linea) { linea = linea.slice(0, -1); process.stdout.write(String.fromCharCode(8, 32, 8)) }
    } else {
      linea += ch
      process.stdout.write(ch)
    }
  }
})
process.stdin.resume()
`

/** Escribe el ssh de demostración en `dir` y devuelve la variable de entorno que lo activa. */
function instalarSshDemo(dir: string): Record<string, string> {
  const guion = join(dir, 'ssh-demo.cjs')
  writeFileSync(guion, PROGRAMA_SSH_DEMO)
  return { TESSERA_SSH_BINARIO: JSON.stringify({ exe: process.execPath, args: [guion] }) }
}

async function asentar(ventana: Page): Promise<void> {
  await ventana.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

type Region = Locator | { x: number; y: number; width: number; height: number }

/**
 * Pasa una captura a WebP con el canvas de la propia ventana (sin dependencias), a como mucho
 * `ANCHO_ACADEMY` de ancho: la Academy las pinta en una columna de lectura y van en el instalador.
 */
async function aWebp(ventana: Page, png: Buffer): Promise<Buffer> {
  const b64 = await ventana.evaluate(
    async ({ datos, ancho }) => {
      const imagen = new Image()
      imagen.src = `data:image/png;base64,${datos}`
      await imagen.decode()
      const escala = Math.min(1, ancho / imagen.width)
      const lienzo = document.createElement('canvas')
      lienzo.width = Math.round(imagen.width * escala)
      lienzo.height = Math.round(imagen.height * escala)
      const ctx = lienzo.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
      return lienzo.toDataURL('image/webp', 0.86).split(',')[1]
    },
    { datos: png.toString('base64'), ancho: ANCHO_ACADEMY }
  )
  return Buffer.from(b64, 'base64')
}

/**
 * Descarta avisos, aparca el ratón donde no marca nada y guarda la captura: en el README (solo en
 * español y sin `TESSERA_CAPTURAS_ACADEMY`) y en la Academy con cada id de `academy`, en el idioma
 * de la pasada. `raton: false` deja el ratón donde está (un menú que se cierra al moverlo).
 */
async function foto(
  ventana: Page,
  nombres: { readme?: string; academy?: string[] },
  region?: Region,
  raton = true
): Promise<void> {
  for (const cerrar of await ventana.locator('.toast-close').all()) await cerrar.click().catch(() => {})
  const marca = await ventana.locator('.status-bar-marca').boundingBox()
  if (raton && marca) await ventana.mouse.move(marca.x + marca.width / 2, marca.y + marca.height / 2)
  await ventana.waitForTimeout(500)
  await asentar(ventana)
  const png =
    region && 'screenshot' in region
      ? await region.screenshot({ animations: 'disabled' })
      : await ventana.screenshot({ animations: 'disabled', clip: region })
  if (nombres.readme && !SOLO_ACADEMY && IDIOMA === 'es') {
    mkdirSync(SALIDA, { recursive: true })
    writeFileSync(join(SALIDA, `${nombres.readme}.png`), png)
  }
  if (!SOLO_ACADEMY || !nombres.academy?.length) return
  mkdirSync(SALIDA_ACADEMY, { recursive: true })
  const webp = await aWebp(ventana, png)
  for (const id of nombres.academy) writeFileSync(join(SALIDA_ACADEMY, `${id}.${IDIOMA}.webp`), webp)
}

/** El rectángulo que abarca varias cajas, con un margen alrededor. */
async function abarcar(cajas: Locator[], margen = 10): Promise<{ x: number; y: number; width: number; height: number }> {
  const bs = (await Promise.all(cajas.map((c) => c.boundingBox()))).filter((b) => b !== null)
  const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - margen)
  const y = Math.max(0, Math.min(...bs.map((b) => b.y)) - margen)
  const x2 = Math.max(...bs.map((b) => b.x + b.width)) + margen
  const y2 = Math.max(...bs.map((b) => b.y + b.height)) + margen
  return { x, y, width: x2 - x, height: y2 - y }
}

async function ponerCasilla(ventana: Page, texto: string): Promise<void> {
  await ventana.locator('.barra-mosaico-selector').click()
  const elemento = ventana.locator('.ctx-menu-item[aria-checked="false"]', { hasText: texto })
  if ((await elemento.count()) > 0) await elemento.first().click()
  else await ventana.keyboard.press('Escape')
}

const SEMBRADO_PG = `
CREATE DATABASE tienda;
${'\\'}c tienda
CREATE TABLE clientes (id serial PRIMARY KEY, nombre text NOT NULL, email text UNIQUE, ciudad text, alta date);
INSERT INTO clientes (nombre, email, ciudad, alta) VALUES
  ('Ana Ruiz', 'ana@example.com', 'Valencia', '2026-01-14'),
  ('Bruno Sanz', 'bruno@example.com', 'Sevilla', '2026-02-02'),
  ('Carla Mena', 'carla@example.com', 'Bilbao', '2026-02-19'),
  ('Diego Prado', 'diego@example.com', 'Madrid', '2026-03-05'),
  ('Elena Costa', 'elena@example.com', 'Vigo', '2026-03-28'),
  ('Fabián Leal', 'fabian@example.com', 'Zaragoza', '2026-04-11'),
  ('Gema Ortiz', 'gema@example.com', 'Málaga', '2026-05-03'),
  ('Hugo Vidal', 'hugo@example.com', 'Valencia', '2026-05-27');
CREATE TABLE productos (id serial PRIMARY KEY, nombre text NOT NULL, precio numeric(8,2) NOT NULL, stock int NOT NULL);
INSERT INTO productos (nombre, precio, stock) VALUES
  ('Camiseta básica', 14.90, 40), ('Sudadera con capucha', 39.50, 12), ('Gorra de lana', 11.00, 3),
  ('Mochila urbana', 49.90, 18), ('Botella térmica', 19.95, 60), ('Libreta A5', 4.50, 150);
CREATE TABLE pedidos (id serial PRIMARY KEY, cliente_id int NOT NULL REFERENCES clientes(id), fecha date NOT NULL, total numeric(10,2) NOT NULL, estado text NOT NULL);
INSERT INTO pedidos (cliente_id, fecha, total, estado)
  SELECT 1 + (n % 8), date '2026-08-01' + n, round((20 + (n * 37 % 180))::numeric, 2),
         (ARRAY['pagado', 'enviado', 'pendiente'])[1 + n % 3]
  FROM generate_series(1, 40) AS n;
CREATE INDEX ix_pedidos_cliente ON pedidos (cliente_id);
CREATE VIEW v_resumen_clientes AS
  SELECT c.nombre, count(p.id) AS pedidos, sum(p.total) AS facturado
  FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id GROUP BY c.nombre;
`

const CONSULTA = `select c.nombre, c.ciudad, count(p.id) as pedidos, sum(p.total) as facturado
from clientes c
join pedidos p on p.cliente_id = c.id
where p.estado <> 'pendiente'
group by c.nombre, c.ciudad
order by facturado desc;`

test.describe.configure({ mode: 'serial' })

test.describe('capturas del README', () => {
  let s: SesionTessera
  let agente: AgenteFalso
  let servidorUso: Server
  let pg: PostgresEfimero | null = null
  let motivoPg: string | null = null

  test.beforeAll(async () => {
    if (existsSync(BASE)) throw new Error(`${BASE} ya existe: bórrala o muévela, el guion crea y borra esa carpeta.`)
    mkdirSync(BASE, { recursive: true })
    const rutas: Record<string, string> = {}
    for (const p of PERFILES) for (const n of p.proyectos) rutas[n] = crearProyecto(n)

    const r = await arrancarPostgres(SEMBRADO_PG)
    if (r.ok) pg = r.pg
    else if (r.fallo) throw new Error(r.motivo)
    else motivoPg = r.motivo

    servidorUso = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          limits: [
            { kind: 'session', group: 'session', percent: 34, resets_at: null, scope: null },
            { kind: 'weekly_all', group: 'weekly', percent: 61, resets_at: null, scope: null }
          ]
        })
      )
    })
    await new Promise<void>((listo) => servidorUso.listen(0, '127.0.0.1', listo))
    const { port } = servidorUso.address() as AddressInfo

    agente = montarAgenteFalso()
    instalarAgenteDemo(agente)
    s = await abrirTessera(
      {
        ...agente.env,
        ...instalarSshDemo(agente.raiz),
        TESSERA_USO_CLAUDE: `http://127.0.0.1:${port}/uso`,
        TESSERA_FORZAR_IDIOMA: IDIOMA
      },
      {
        sembrar: (datos) => {
          writeFileSync(
            join(datos, 'profiles.json'),
            JSON.stringify(
              PERFILES.map((p) => ({
                id: p.id,
                nombre: p.nombre,
                color: p.color,
                agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${p.id}/claude` }],
                sandbox: { habilitado: false }
              }))
            )
          )
          const porPerfil: Record<string, object> = {}
          for (const p of PERFILES) {
            porPerfil[p.id] = {
              openProjects: p.proyectos.map((n) => ({ projectHostPath: rutas[n], name: n, estado: 'active' })),
              activePath: rutas[p.proyectos[0]]
            }
          }
          writeFileSync(
            join(datos, 'workspace-state.json'),
            JSON.stringify({
              version: 1,
              activeProfileId: 'personal',
              byProfile: porPerfil,
              settings: {
                defaultProjectMode: 'windows',
                windowsModeProjects: PERFILES.flatMap((p) => p.proyectos.map((n) => `${p.id}|${rutas[n]}`)),
                menuWindowsAvisado: true
              }
            })
          )
          writeFileSync(
            join(carpetasAgentes(datos).claude, '.credentials.json'),
            JSON.stringify({ claudeAiOauth: { accessToken: 'token-de-demostracion' } })
          )
        }
      }
    )
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w.isMaximized()) w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect.poll(() => agente.arranques('claude').length, { timeout: 60_000 }).toBe(1)
    await s.ventana.waitForTimeout(2500)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    pg?.parar()
    if (servidorUso) {
      servidorUso.closeAllConnections()
      servidorUso.close()
    }
    if (agente) await borrarTemporal(agente.raiz)
    await borrarTemporal(BASE)
  })

  test('principal, espacios y agentes', async () => {
    const ventana = s.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'src' }).first().click()
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'carrito.ts' }).first().click()
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'precios.ts' }).first().click()
    await ventana.locator('.editor-tab', { hasText: 'carrito.ts' }).click()
    await expect(ventana.locator('.editor-tab.active', { hasText: 'carrito.ts' })).toHaveCount(1)
    await ventana.waitForTimeout(1500)
    await foto(ventana, { readme: 'principal', academy: ['ventana'] })
    await foto(ventana, { readme: 'espacios' }, { x: 0, y: 0, width: 1600, height: 100 })
    await foto(ventana, { readme: 'agentes' }, ventana.locator('.right-panel'))
  })

  test('menú del perfil, selector de cuenta y menú de continuar', async () => {
    const ventana = s.ventana
    await ventana.locator('.profile-tab[data-perfil-id="personal"]').click({ button: 'right' })
    const menu = ventana.locator('.ctx-menu')
    await expect(menu).toBeVisible()
    await foto(ventana, { academy: ['menu-del-perfil'] }, await abarcar([ventana.locator('.profile-tab[data-perfil-id="personal"]'), menu]), false)
    await ventana.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await ventana.evaluate(async () => {
      for (const nombre of ['Trabajo', 'Pruebas']) {
        await window.tessera.cuentasAgente.crear({ nombre, agente: 'claude-code', profileId: 'personal' })
      }
    })
    await ventana.locator('.agent-pane:not(.hidden) .cuenta-btn').first().click()
    const emergente = ventana.locator('.cuenta-pop')
    await expect(emergente.locator('.cuenta-tarjeta', { hasText: 'Pruebas' })).toHaveCount(1)
    await foto(ventana, { readme: 'cuentas', academy: ['selector-de-cuenta'] }, await abarcar([emergente], 0), false)
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)
    await ventana.locator('.agent-pane:not(.hidden) .pasar-btn').click()
    await expect(emergente.locator('.cuenta-tarjeta', { hasText: 'Pruebas' })).toHaveCount(1)
    await foto(ventana, { readme: 'continuar', academy: ['continuar-conversacion'] }, await abarcar([emergente], 0), false)
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)
  })

  test('editor con vista dividida de un Markdown', async () => {
    const ventana = s.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'README.md' }).first().click()
    await expect(ventana.locator('.editor-tab.active', { hasText: 'README.md' })).toHaveCount(1)
    await ventana.getByRole('radio', { name: L.dividida }).click()
    await expect(ventana.locator('.editor-cuerpo.dividida > .markdown-preview')).toBeVisible()
    await ventana.waitForTimeout(1000)
    await foto(ventana, { readme: 'editor', academy: ['editor-markdown-dividido'] })
  })

  test('git: cambios con diff e historial con grafo', async () => {
    const ventana = s.ventana
    await ventana.getByRole('button', { name: L.gitCambios }).click()
    await ventana.locator('.git-panel .git-arbol-fila', { hasText: 'carrito.ts' }).dblclick()
    await expect(ventana.locator('.monaco-diff-editor').filter({ visible: true })).toContainText('envio')
    await ventana.getByRole('button', { name: L.gitHistorial }).click()
    await expect(ventana.locator('.git-fila-commit').first()).toBeVisible()
    await ventana.locator('.git-fila-commit', { hasText: 'fix: redondeo del IVA' }).click()
    await expect(ventana.locator('.git-log-detalle .git-detalle-asunto')).toHaveText('fix: redondeo del IVA en el carrito')
    // El detalle abre el primer archivo del commit; se vuelve al diff del cambio sin confirmar. Se espera a
    // que lo abra: si no, la apertura llega después del clic y tapa el diff que se quería enseñar.
    await expect(ventana.locator('.editor-tab.active', { hasText: 'CHANGELOG.md' })).toHaveCount(1, { timeout: 15_000 })
    await ventana.locator('.editor-tab', { has: ventana.getByRole('img', { name: L.diferencias }) }).filter({ hasText: 'carrito.ts' }).click()
    await expect(ventana.locator('.monaco-diff-editor').filter({ visible: true })).toContainText('envio')
    await ventana.waitForTimeout(1200)
    await foto(ventana, { readme: 'git', academy: ['git-log-con-diff'] })
  })

  test('terminales con dos terminales', async () => {
    const ventana = s.ventana
    await ventana.locator(`.activity-item[title="${L.archivos}"]`).click()
    await ventana.locator('.editor-tab', { hasText: 'carrito.ts' }).first().click()
    await ventana.getByRole('button', { name: L.terminal }).click()
    const panel = ventana.locator('section.terminal-panel')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    await panel.locator('.xterm').first().click()
    await ventana.keyboard.type('git status -s')
    await ventana.keyboard.press('Enter')
    await panel.getByRole('button', { name: L.nuevaTerminal }).click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await panel.locator('.xterm').filter({ visible: true }).first().click()
    await ventana.keyboard.type('git --no-pager log --oneline --graph --decorate -8')
    await ventana.keyboard.press('Enter')
    await ventana.waitForTimeout(2500)
    await foto(ventana, { readme: 'terminales' })
  })

  test('conexiones SSH: terminal a pantalla completa con el riel y una sesión, y el formulario', async () => {
    const ventana = s.ventana
    await ventana.evaluate(async () => {
      const crear = (alias: string, grupoId: string | null, host: string, usuario: string) =>
        window.tessera.ssh.crear({ profileId: 'personal', alias, grupoId, host, puerto: 22, usuario, metodo: 'sistema', disponibleAgentes: true })
      const produccion = await window.tessera.ssh.crearGrupo({ profileId: 'personal', nombre: 'Producción' })
      const pruebas = await window.tessera.ssh.crearGrupo({ profileId: 'personal', nombre: 'Pruebas' })
      await crear('web-01', produccion.id, '192.0.2.10', 'deploy')
      await crear('db-01', produccion.id, '192.0.2.11', 'deploy')
      await crear('staging', pruebas.id, '192.0.2.20', 'deploy')
      await crear('nas-casa', null, '192.0.2.30', 'admin')
    })
    // Huellas ya confirmadas: la captura es la de una sesión, no la del diálogo de un servidor nuevo.
    await sembrarHuellas(ventana, s.datos)
    const panel = ventana.locator('section.terminal-panel')
    await panel.getByRole('button', { name: L.maximizar }).click()
    const riel = ventana.locator('aside.ssh-riel')
    await expect(riel).toBeVisible()
    // El doble clic conecta. El texto de la terminal no se lee del DOM (se pinta por GPU): se espera a la pestaña.
    await riel.getByRole('treeitem', { name: /^web-01,/ }).dblclick()
    await expect(panel.locator('.terminal-tab.active', { hasText: 'web-01' })).toHaveCount(1, { timeout: 30_000 })
    await ventana.waitForTimeout(1500)
    await panel.locator('.xterm').filter({ visible: true }).first().click()
    for (const orden of ['uptime', 'df -h /', 'systemctl is-active nginx']) {
      await ventana.keyboard.type(orden)
      await ventana.keyboard.press('Enter')
    }
    await ventana.waitForTimeout(1500)
    await foto(ventana, { readme: 'ssh', academy: ['ssh-riel', 'terminal-pantalla-completa'] })

    await riel.getByRole('treeitem', { name: /^web-01,/ }).click({ button: 'right' })
    await ventana.locator('.ctx-menu-item', { hasText: L.editar }).click()
    const dialogo = ventana.getByRole('dialog', { name: L.editarSsh })
    await expect(dialogo).toBeVisible()
    await ventana.waitForTimeout(500)
    await foto(ventana, { readme: 'ssh-conexion' }, dialogo)
    await ventana.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await ventana.locator('.activity-bar').getByRole('button', { name: L.restaurar }).click()
  })

  test('configuración', async () => {
    const ventana = s.ventana
    await ventana.keyboard.press(`${MOD}+,`)
    await expect(ventana.locator('.ajustes-modal')).toHaveCount(1)
    await ventana.locator('.ajustes-riel-item[data-cat="proyectos"]').click()
    await ventana.waitForTimeout(800)
    await foto(ventana, { readme: 'configuracion' })
    await ventana.locator('.ajustes-riel-item[data-cat="contenedores"]').click()
    await ventana.waitForTimeout(800)
    await foto(ventana, { readme: 'limite-contenedores', academy: ['docker-limite'] }, ventana.locator('.ajustes-modal'))
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator('.ajustes-modal')).toHaveCount(0)
  })

  test('bases de datos', async () => {
    test.skip(pg === null, motivoPg ?? 'sin PostgreSQL de demostración')
    const ventana = s.ventana
    const p = pg!
    await ventana.locator(`.activity-item[title="${L.conexionesBd}"]`).click()
    await ventana.evaluate(
      (c) =>
        window.tessera.db.crearConexion({
          profileId: 'personal',
          alias: 'tienda-dev',
          motor: 'postgres',
          host: c.host,
          port: c.port,
          database: 'tienda',
          user: 'postgres',
          password: c.password,
          readonly: false
        }),
      { host: p.host, port: p.port, password: p.contrasena }
    )
    const conexion = fila(ventana, 'conexion', 'tienda-dev')
    await expect(conexion).toHaveCount(1)
    await desplegar(conexion)
    const publico = fila(ventana, 'esquema', 'public')
    await expect(publico).toHaveCount(1, { timeout: 30_000 })
    await desplegar(publico)
    const tablas = await filaTras(ventana, publico, 'carpeta', 'tablas-public', L.tablas)
    await desplegar(tablas)
    await expect(fila(ventana, 'objeto', 'pedidos')).toHaveCount(1, { timeout: 30_000 })
    await abrirConsolaNueva(ventana, `${MOD}+KeyN`)
    await ejecutarTodoSeleccionado(ventana, CONSULTA)
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator('section.db-consola:not(.hidden) .db-resultados-panel:not(.oculto) .db-rejilla-fila').first()).toBeVisible()
    // Sin la selección azul de «ejecutar todo»: el cursor al final.
    await monacoConsola(ventana, { op: 'cursorAlFinal' })
    await ventana.waitForTimeout(800)
    await foto(ventana, { readme: 'bases-de-datos', academy: ['bd-vista'] })
  })

  test('mosaico de agentes', async () => {
    const ventana = s.ventana
    // Las sesiones son perezosas: se arrancan mirando cada proyecto, como el usuario.
    await ventana.locator(`.activity-item[title="${L.archivos}"]`).click()
    await ventana.locator('.tabs-projects .project-tab', { hasText: 'api-pedidos' }).first().click()
    await expect.poll(() => agente.arranques('claude').length, { timeout: 60_000 }).toBe(2)
    await ventana.locator('.profile-tab', { hasText: 'Estudio' }).first().click()
    await expect.poll(() => agente.arranques('claude').length, { timeout: 60_000 }).toBe(3)
    await ventana.locator('.profile-tab', { hasText: 'Proyectos libres' }).first().click()
    await expect.poll(() => agente.arranques('claude').length, { timeout: 60_000 }).toBe(4)
    await ventana.waitForTimeout(2000)
    await expect(ventana.locator(`.titlebar-inicio button[aria-label="${L.mosaico}"]`)).toBeEnabled({ timeout: 30_000 })
    await ventana.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(ventana.locator('.shell.modo-mosaico')).toHaveCount(1)
    for (const t of ['Personal · tienda-web', 'Personal · api-pedidos', 'Estudio · apuntes-sql', 'Proyectos libres · juego-2d']) {
      await ponerCasilla(ventana, t)
    }
    await expect
      .poll(() => ventana.locator('.right-panel.cc-mosaico > .agent-pane:not(.hidden)').count())
      .toBe(4)
    await ventana.waitForTimeout(1500)
    await foto(ventana, { readme: 'mosaico', academy: ['mosaico'] })
  })
})
