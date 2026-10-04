// =============================================================================
// El cliente Oracle de Mac de punta a punta: la app empaquetada descarga el Instant Client
// arm64 del CDN de Oracle, lo instala desde su .dmg (hdiutil sin preguntar, `cp -R -P -X`
// que conserva `libclntsh.dylib` como enlace y quita la cuarentena, codesign con el Team ID
// de Oracle, nada montado ni restos) y el binario de la app lanzado como Node lo CARGA con
// `initOracleClient`. Las órdenes las fijan `test-instalar-dmg.mts` y `test-driver-packs.mts`.
// Solo Mac (en Windows el pack es un zip). Baja 66 MB: sin red FALLA a propósito, y
// `TESSERA_E2E_SIN_RED=1` la salta con su motivo. Conectar a una 11.2 es `test:db-oracle`.
// =============================================================================

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PLATAFORMA, abrirTessera, rutaAppEmpaquetada, type SesionTessera } from './tessera'

const PACK = 'oracle-ic-23-macos-arm64'
/** El `aviso` del pack (una prueba de interfaz no importa el main). */
const AVISO = '11.2–18c están fuera del soporte de Oracle; probado.'

test.describe('cliente Oracle de Mac: el .dmg de Oracle se instala y carga', () => {
  test.skip(
    PLATAFORMA !== 'mac',
    'el Instant Client en .dmg (hdiutil, cp, codesign, dlopen de dylibs arm64) solo existe en macOS; Windows baja un zip'
  )
  test.skip(process.env.TESSERA_E2E_SIN_RED === '1', 'TESSERA_E2E_SIN_RED=1: esta prueba baja 66 MB del CDN de Oracle')
  test.describe.configure({ mode: 'serial' })

  let s: SesionTessera | null = null
  let dirPack = ''

  test.beforeAll(async () => {
    s = await abrirTessera()
    dirPack = join(s.datos, 'drivers', 'oracle', PACK)
  })

  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('(1) el pack de Mac se ofrece para descargar, solo él y con su aviso de 11.2–18c', async () => {
    const lista = await s!.win.evaluate(() => window.tessera.db.driversList())
    expect(lista.map((d) => d.id), 'en Mac solo existe el cliente 23 arm64').toEqual([PACK])
    const p = lista[0]
    expect(p.descargable, `no es descargable: ${p.noDisponible ?? '(sin motivo)'}`).toBe(true)
    expect(p.aviso).toBe(AVISO)
    expect(p.cubre).toBe('Oracle 11.2 y superior')
    expect(p.instalado).toBe(false)
  })

  test('(2) «Descargar»: hdiutil + cp + firma, sin montajes, restos ni cuarentena', async () => {
    test.setTimeout(10 * 60_000)
    const win = s!.win
    await win.evaluate(() => {
      const w = window as unknown as { __fasesDriver: string[] }
      w.__fasesDriver = []
      window.tessera.db.onDriverProgress((p) => {
        const f = w.__fasesDriver
        if (f[f.length - 1] !== p.fase) f.push(p.fase)
      })
    })
    const st = await win.evaluate((id) => window.tessera.db.driverInstall(id), PACK)
    expect(st.instalado, 'la instalación no dejó el pack instalado').toBe(true)
    expect(st.externo).toBe(false)
    const fases = await win.evaluate(() => (window as unknown as { __fasesDriver: string[] }).__fasesDriver)
    expect(fases, 'el progreso no pasó por descargar -> instalar -> listo').toEqual(['descargando', 'instalando', 'listo'])

    // El centinela es un ENLACE (`cp -P` lo conservó) y apunta al binario de la 23.
    const centinela = join(dirPack, 'libclntsh.dylib')
    expect(lstatSync(centinela).isSymbolicLink(), 'libclntsh.dylib ya no es un enlace: la copia lo aplanó').toBe(true)
    const real = realpathSync(centinela)
    expect(real.endsWith('libclntsh.dylib.23.1')).toBe(true)
    expect(existsSync(join(dirPack, 'install_ic.sh')), 'se quedó el install_ic.sh de Oracle').toBe(false)
    expect(existsSync(join(dirPack, 'network', 'admin'))).toBe(true)
    // Solo lo visible del volumen: nada de lo que el sistema pone en la raíz de un volumen.
    expect(
      readdirSync(dirPack).filter((n) => n.startsWith('.')),
      'se copiaron entradas ocultas de la raíz del volumen'
    ).toEqual([])

    // Sin restos: ni el .dmg, ni el punto de montaje, ni una copia a medias.
    const drivers = join(s!.datos, 'drivers')
    expect(readdirSync(join(drivers, '.descargas')), 'se quedó el .dmg').toEqual([])
    expect(existsSync(join(drivers, '.montajes', PACK)), 'se quedó la carpeta del montaje').toBe(false)
    expect(readdirSync(join(drivers, 'oracle')).filter((n) => n.includes('.instalando'))).toEqual([])
    // Y nada montado: hdiutil no lista nuestro punto de montaje.
    const info = execFileSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' })
    expect(info, 'la imagen sigue montada').not.toContain(`.montajes/${PACK}`)

    // Sin cuarentena (`cp -X`), y la firma de Oracle intacta en la copia.
    for (const binario of [real, realpathSync(join(dirPack, 'libnnz.dylib'))]) {
      const xattrs = execFileSync('/usr/bin/xattr', [binario], { encoding: 'utf8' })
      expect(xattrs, `${binario} lleva cuarentena`).not.toContain('com.apple.quarantine')
    }
    execFileSync('/usr/bin/codesign', [
      '--verify',
      '--strict',
      '-R',
      '=anchor apple generic and certificate leaf[subject.OU] = "VB5E2TV963"',
      real
    ])
  })

  test('(3) el binario de la app, como Node, carga el cliente (dlopen de verdad)', async () => {
    const exe = rutaAppEmpaquetada()
    expect(exe).not.toBeNull()
    // `oracledb` se busca DONDE ESTÉ, y no sólo en el asar: Tessera empaqueta con
    // `asar: false` (está en `electron-builder.yml`), así que el módulo vive en
    // `Resources/app/node_modules` y la ruta fija al asar no existía — la prueba moría
    // con «Cannot find module .../app.asar/node_modules/oracledb», que acusa al cliente
    // de Oracle cuando lo que fallaba era la ruta. Se prueban las dos para que siga
    // valiendo el día que el asar vuelva. El binario lanzado con ELECTRON_RUN_AS_NODE
    // las resuelve igual que cuando corre `tdb`.
    const recursos = join(dirname(exe!), '..', 'Resources')
    const candidatos = [
      join(recursos, 'app.asar', 'node_modules', 'oracledb'),
      join(recursos, 'app', 'node_modules', 'oracledb')
    ]
    const oracledb = candidatos.find((c) => existsSync(c)) ?? candidatos[0]
    const guion =
      'const o = require(process.env.T_ORACLEDB);' +
      'o.initOracleClient({ libDir: process.env.T_LIBDIR });' +
      'process.stdout.write(String(o.oracleClientVersionString));'
    const entorno: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ELECTRON_RUN_AS_NODE: '1',
      T_ORACLEDB: oracledb,
      T_LIBDIR: dirPack
    }
    const version = execFileSync(exe!, ['-e', guion], { env: entorno, encoding: 'utf8', timeout: 60_000 })
    expect(version.trim(), 'initOracleClient no cargó el Instant Client 23.26').toMatch(/^23\.26\./)
  })

  test('(4) repetir «Descargar» con el pack instalado no baja nada', async () => {
    const win = s!.win
    await win.evaluate(() => {
      ;(window as unknown as { __fasesDriver: string[] }).__fasesDriver = []
    })
    const st = await win.evaluate((id) => window.tessera.db.driverInstall(id), PACK)
    expect(st.instalado).toBe(true)
    const fases = await win.evaluate(() => (window as unknown as { __fasesDriver: string[] }).__fasesDriver)
    expect(fases, 'volvió a descargar un pack ya instalado').toEqual([])
  })
})
