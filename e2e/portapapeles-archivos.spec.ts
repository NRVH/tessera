// =============================================================================
// Pegar en el proyecto archivos copiados en el gestor de archivos del sistema: pone
// archivos DE VERDAD en el portapapeles del sistema (Windows: un `DataObject` de WinForms
// con `Shell IDList Array` y `Preferred DropEffect`; Mac: JXA con `NSPasteboard` y
// relectura de lo escrito, porque la primera lectura puede pillar una vista a medias y
// cachearla) y comprueba que llegan por `clipboard.pasteInto`, la API del preload que usa
// «Pegar». Es la red de los parsers de `main/clipboard/clipboardFiles.ts`, cuyo test
// simula `electron.clipboard`. USA EL PORTAPAPELES DE QUIEN LA CORRE y lo deja vacío.
// =============================================================================

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  abrirTessera,
  borrarTemporal,
  PERFILES_SIN_SANDBOX,
  PLATAFORMA,
  type SesionTessera
} from './tessera'

type Efecto = 'copy' | 'cut'

let s: SesionTessera
/** Temporal de la prueba: de aquí cuelgan el origen (fuera del proyecto) y el proyecto. */
let base = ''
let origen = ''
let proyecto = ''

test.beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'tessera-e2e-pegar-'))
  origen = join(base, 'origen')
  proyecto = join(base, 'proyecto')
  mkdirSync(origen)
  mkdirSync(proyecto)
  s = await abrirTessera({}, {
    args: [proyecto],
    sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
  })
  await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
})

test.afterAll(async () => {
  await s?.cerrar()
  // Se vacía desde el SISTEMA y no con el `clipboard` de la app: si la app murió a mitad
  // de la suite, un `clear()` suyo fallaría en silencio y el portapapeles del usuario se
  // quedaría apuntando a archivos de un temporal que se borra en la línea siguiente (y,
  // tras la prueba de cortar, marcado como MOVER).
  vaciarPortapapelesDelSistema()
  if (base) await borrarTemporal(base)
})

/** Vacía el portapapeles del sistema sin pasar por la app. Best-effort: nunca lanza. */
function vaciarPortapapelesDelSistema(): void {
  try {
    if (PLATAFORMA === 'windows') {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()'
        ],
        { stdio: 'ignore' }
      )
    } else if (PLATAFORMA === 'mac') {
      execFileSync(
        'osascript',
        ['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); $.NSPasteboard.generalPasteboard.clearContents; 'ok'"],
        { stdio: 'ignore' }
      )
    }
  } catch {
    // No queda nada que hacer: el portapapeles se quedará con lo último que se puso.
  }
}

/** Crea archivos de origen FUERA del proyecto, cada uno con un contenido reconocible. */
function crearOrigen(caso: string, nombres: string[]): string[] {
  const dir = join(origen, caso)
  mkdirSync(dir)
  return nombres.map((nombre) => {
    const ruta = join(dir, nombre)
    writeFileSync(ruta, `contenido de ${caso}/${nombre}`)
    return ruta
  })
}

/** Crea la carpeta de destino dentro del proyecto y devuelve su ruta relativa (POSIX). */
function crearDestino(caso: string): string {
  mkdirSync(join(proyecto, caso))
  return caso
}

/**
 * Pone archivos en el portapapeles de Windows con los formatos del Explorador:
 * `CF_HDROP` (la lista), `Preferred DropEffect` (copiar o cortar), `Shell IDList Array`
 * (la cuenta) y `FileNameW` (el primero). `SetDataObject(…, $true)` vuelca los datos al
 * portapapeles, así que sobreviven a que PowerShell termine.
 */
function portapapelesWindows(rutas: string[], efecto: Efecto): void {
  const guion = `
Add-Type -AssemblyName System.Windows.Forms
$rutas = [string[]](ConvertFrom-Json $env:TESSERA_E2E_RUTAS)
$d = New-Object System.Windows.Forms.DataObject
$lista = New-Object System.Collections.Specialized.StringCollection
foreach ($r in $rutas) { [void]$lista.Add($r) }
$d.SetFileDropList($lista)
$efecto = [byte[]]@(${efecto === 'cut' ? 2 : 1}, 0, 0, 0)
$d.SetData('Preferred DropEffect', (New-Object System.IO.MemoryStream(,$efecto)))
$cida = New-Object System.Collections.Generic.List[byte]
$cida.AddRange([BitConverter]::GetBytes([uint32]$rutas.Count))
for ($i = 0; $i -le $rutas.Count; $i++) { $cida.AddRange([BitConverter]::GetBytes([uint32]0)) }
$d.SetData('Shell IDList Array', (New-Object System.IO.MemoryStream(,$cida.ToArray())))
$nombre = [System.Text.Encoding]::Unicode.GetBytes($rutas[0] + [char]0)
$d.SetData('FileNameW', (New-Object System.IO.MemoryStream(,$nombre)))
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)
`
  // `-EncodedCommand` (UTF-16LE en base64) y las rutas por el ENTORNO: así ni el guion
  // ni las rutas pasan por las reglas de comillas de ninguna shell.
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(guion, 'utf16le').toString('base64')],
    { env: { ...process.env, TESSERA_E2E_RUTAS: JSON.stringify(rutas) }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

/** Pone archivos en el portapapeles de macOS como los deja el Finder: un `NSURL` por archivo. */
function portapapelesMac(rutas: string[]): void {
  const jxa = `function run(argv) {
  ObjC.import('AppKit')
  const pb = $.NSPasteboard.generalPasteboard
  pb.clearContents
  const urls = argv.map((p) => $.NSURL.fileURLWithPath(p))
  if (!pb.writeObjects($(urls))) return 'fallo'
  // SE RELEE LO ESCRITO, en este mismo proceso y por la misma API que usará la app:
  // el plist de NSFilenamesPboardType que AppKit sintetiza a partir de los ítems.
  const s = pb.stringForType($('NSFilenamesPboardType'))
  const texto = s.js === undefined ? '' : String(s.js)
  return String((texto.match(/<string>/g) || []).length)
}`
  const r = execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa, ...rutas], {
    encoding: 'utf8'
  }).trim()
  if (r !== String(rutas.length)) {
    throw new Error(`NSPasteboard no aceptó las ${rutas.length} rutas (releídas: ${r})`)
  }
}

/** Lo que el explorador ve en el portapapeles: tipo, cuántos y si es cortar. */
async function sondear(): Promise<{ kind: string; count: number; effect: Efecto }> {
  const p = await s.win.evaluate(() => window.tessera.clipboard.probe())
  return { kind: p.kind, count: p.count, effect: p.effect }
}

/**
 * Pega en `destino` por la misma API que el «Pegar» del explorador.
 *
 * El proyecto que llega por `argv` se activa en el main un instante DESPUÉS de que
 * exista su pestaña, y hasta entonces la respuesta es «No hay proyecto activo». Sólo
 * ese error se reintenta: reintentar cualquier otro podría pegar dos veces.
 */
async function pegarEn(destino: string): Promise<{ paths: string[]; fallidos: string[] }> {
  const limite = Date.now() + 30_000
  for (;;) {
    try {
      return await s.win.evaluate((d) => window.tessera.clipboard.pasteInto(d), destino)
    } catch (err) {
      if (!String(err).includes('No hay proyecto activo') || Date.now() > limite) throw err
      await s.win.waitForTimeout(500)
    }
  }
}

/** Comprueba que cada origen tiene su copia, con el mismo contenido, en `destino`. */
function expectCopiados(rutas: string[], destino: string): void {
  for (const ruta of rutas) {
    const nombre = ruta.split(/[\\/]/).pop()!
    const copia = join(proyecto, destino, nombre)
    expect(existsSync(copia), `falta ${nombre} en ${destino}`).toBe(true)
    expect(readFileSync(copia, 'utf8')).toBe(readFileSync(ruta, 'utf8'))
  }
}

test.describe('Windows', () => {
  test.skip(PLATAFORMA !== 'windows', 'formatos del portapapeles del Explorador')

  test('un archivo copiado llega por el camino rápido (FileNameW)', async () => {
    const rutas = crearOrigen('uno', ['informe.txt'])
    const destino = crearDestino('destino-uno')
    portapapelesWindows(rutas, 'copy')

    // La sonda lee `Shell IDList Array` y `Preferred DropEffect` con `readBuffer`: que
    // diga 1 y 'copy' es la prueba de que Electron sigue entregando esos formatos.
    expect(await sondear()).toEqual({ kind: 'files', count: 1, effect: 'copy' })

    const res = await pegarEn(destino)
    expect(res).toEqual({ paths: [`${destino}/informe.txt`], fallidos: [] })
    expectCopiados(rutas, destino)
    expect(existsSync(rutas[0]), 'copiar no toca el origen').toBe(true)
  })

  test('varios archivos copiados llegan todos (camino de PowerShell)', async () => {
    const rutas = crearOrigen('varios', ['a.txt', 'b.txt', 'c.txt'])
    const destino = crearDestino('destino-varios')
    portapapelesWindows(rutas, 'copy')

    expect(await sondear()).toEqual({ kind: 'files', count: 3, effect: 'copy' })

    const res = await pegarEn(destino)
    expect(res.fallidos).toEqual([])
    expect([...res.paths].sort()).toEqual(['a.txt', 'b.txt', 'c.txt'].map((n) => `${destino}/${n}`))
    expectCopiados(rutas, destino)
  })

  test('cortar MUEVE el archivo y vacía el portapapeles', async () => {
    const rutas = crearOrigen('cortar', ['movido.txt'])
    const contenido = readFileSync(rutas[0], 'utf8')
    const destino = crearDestino('destino-cortar')
    portapapelesWindows(rutas, 'cut')

    expect(await sondear()).toEqual({ kind: 'files', count: 1, effect: 'cut' })

    const res = await pegarEn(destino)
    expect(res).toEqual({ paths: [`${destino}/movido.txt`], fallidos: [] })
    expect(readFileSync(join(proyecto, destino, 'movido.txt'), 'utf8')).toBe(contenido)
    expect(existsSync(rutas[0]), 'cortar tiene que quitarlo del origen').toBe(false)
    // Tras un CORTAR se vacía el portapapeles: si no, el Explorador deja los iconos
    // atenuados y un segundo pegado fallaría sobre rutas que ya no existen.
    expect((await sondear()).kind).not.toBe('files')
  })
})

test.describe('macOS', () => {
  test.skip(PLATAFORMA !== 'mac', 'formatos del portapapeles del Finder')

  /**
   * La sonda, ESPERANDO a que la app vea el portapapeles entero.
   *
   * POR QUÉ HACE FALTA AQUÍ Y NO EN WINDOWS. El portapapeles del sistema ya está
   * completo cuando `osascript` retorna —medido con AppKit: `NSFilenamesPboardType` sale
   * con las tres rutas nada más volver de `writeObjects`—, pero Chromium tarda en verlo:
   * leyendo de inmediato, la sonda devolvía 1 de 3 y, en otra pasada, 2 de 3, mientras
   * que aislada devolvía 3. O sea que el recuento no es incorrecto, es que llega tarde.
   *
   * Se espera al VALOR ENTERO, no se relaja la afirmación: lo que se prueba sigue siendo
   * que la app lee los tres ficheros que el Finder dejó, y si sólo llegaran dos, esto
   * falla igual al agotarse el plazo.
   */
  async function sondearAsentado(esperado: {
    kind: string
    count: number
    effect: Efecto
  }): Promise<void> {
    await expect
      .poll(sondear, { message: `la sonda no llegó a ver ${esperado.count} fichero(s)` })
      .toEqual(esperado)
  }

  test('un archivo copiado en el Finder llega al proyecto', async () => {
    const rutas = crearOrigen('uno', ['informe.txt'])
    const destino = crearDestino('destino-uno')
    portapapelesMac(rutas)

    await sondearAsentado({ kind: 'files', count: 1, effect: 'copy' })

    const res = await pegarEn(destino)
    expect(res).toEqual({ paths: [`${destino}/informe.txt`], fallidos: [] })
    expectCopiados(rutas, destino)
  })

  test('varios archivos copiados en el Finder llegan todos', async () => {
    const rutas = crearOrigen('varios', ['a.txt', 'b.txt', 'c.txt'])
    const destino = crearDestino('destino-varios')
    portapapelesMac(rutas)

    await sondearAsentado({ kind: 'files', count: 3, effect: 'copy' })

    const res = await pegarEn(destino)
    expect(res.fallidos).toEqual([])
    expect([...res.paths].sort()).toEqual(['a.txt', 'b.txt', 'c.txt'].map((n) => `${destino}/${n}`))
    expectCopiados(rutas, destino)
  })
})
