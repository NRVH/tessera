#!/usr/bin/env node
// =============================================================================
// El guion que sustituye la app del usuario en macOS (npm run test:relevo-mac). EJECUTA el
// guion de verdad contra un bundle firmado de mentira empaquetado con `ditto`, porque lo que
// importa (el orden, el entrecomillado, que la versión anterior SE DEVUELVA si el último paso
// falla) son propiedades del guion corriendo; el último paso se hace fallar con el contenedor
// en otro volumen sin espacio, donde `mv` degrada a copia. Fuera de macOS los casos que
// ejecutan se saltan diciéndolo; la parte pura corre en las dos plataformas, por parámetro.
// =============================================================================

import { register } from 'node:module'
import { spawnSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Resolver-hook: los módulos de producción importan sin extensión ('../../shared/x').
// Node ejecutando .ts por type-stripping no resuelve extensionless: se reintenta con .ts.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const { guionRelevoMac, bundleDesdeExe, interpretarMarcaRelevo } = await import('./relevoMacPuro.ts')
const { citarSh } = await import('../../shared/citarShell.ts')
const { plataformaActual } = await import('../../shared/plataforma.ts')

// ---------------------------------------------------------------------------
// Arnés
// ---------------------------------------------------------------------------
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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
/** Lo que no se puede ejecutar en esta máquina: se dice y cuenta en el veredicto. */
const saltados: string[] = []
function saltar(nombre: string, motivo: string): void {
  saltados.push(nombre)
  console.log(`  [SKIP] ${nombre} (${motivo})`)
}

const ES_MAC = plataformaActual() === 'mac'

/**
 * Rutas HOSTILES a propósito, y no por deporte: en macOS el espacio es la norma
 * (`~/Library/Application Support`) y un usuario se puede llamar O'Brien. Si el
 * entrecomillado falla, el guion no da error: hace algo distinto.
 */
const CONTENEDOR_HOSTIL = "Apli caciones de O'Brien $HOME"

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>tessera-falsa</string>
<key>CFBundleIdentifier</key><string>com.tessera.falsa</string>
<key>CFBundleName</key><string>TesseraFalsa</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`

/** El archivo por el que se distingue una versión de la otra dentro del bundle. */
function rutaSello(bundle: string): string {
  return join(bundle, 'Contents', 'Resources', 'quien.txt')
}

/** ¿Qué versión hay ahora mismo en esa ruta? `null` si no hay bundle legible. */
function selloDe(bundle: string): string | null {
  try {
    return readFileSync(rutaSello(bundle), 'utf8').trim()
  } catch {
    return null
  }
}

/** Un `.app` mínimo pero REAL: estructura válida, ejecutable y firma ad-hoc. */
function crearBundle(bundle: string, sello: string, rellenoMb = 0): void {
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(bundle, 'Contents', 'Info.plist'), PLIST)
  writeFileSync(join(bundle, 'Contents', 'MacOS', 'tessera-falsa'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755
  })
  writeFileSync(rutaSello(bundle), sello + '\n')
  // Ceros: ocupan lo que tienen que ocupar en disco y comprimen a nada en el zip.
  if (rellenoMb > 0) {
    writeFileSync(join(bundle, 'Contents', 'Resources', 'relleno.bin'), Buffer.alloc(rellenoMb * 1024 * 1024))
  }
  const r = spawnSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`no se pudo firmar el bundle de prueba: ${r.stderr}`)
}

/** El mismo empaquetado que usa electron-builder para el `.zip` de macOS. */
function empaquetar(origen: string, zip: string): void {
  const r = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', origen, zip], {
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error(`no se pudo empaquetar: ${r.stderr}`)
}

/** Un pid que con toda seguridad ya no existe: el guion no tendrá nada que esperar. */
function pidMuerto(): number {
  const r = spawnSync('/bin/sh', ['-c', 'exit 0'])
  return r.pid ?? 999_999
}

interface Ejecucion {
  status: number | null
  marca: string
  traza: string
}

/** Escribe el guion y lo ejecuta de verdad, devolviendo lo que dejó dicho. */
function correrGuion(w: string, opciones: Parameters<typeof guionRelevoMac>[0]): Ejecucion {
  const guion = join(w, 'relevo.sh')
  writeFileSync(guion, guionRelevoMac(opciones), { mode: 0o700 })
  const r = spawnSync('/bin/sh', [guion], { encoding: 'utf8', timeout: 180_000 })
  return {
    status: r.status,
    marca: existsSync(opciones.marca) ? readFileSync(opciones.marca, 'utf8').trim() : '',
    traza: existsSync(opciones.traza) ? readFileSync(opciones.traza, 'utf8') : ''
  }
}

/** Un escenario montado: contenedor hostil, destino con la versión vieja, y rutas. */
interface Escenario {
  w: string
  destino: string
  marca: string
  traza: string
  zip: string
}

function montarEscenario(nombre: string): Escenario {
  const w = mkdtempSync(join(tmpdir(), `tessera-relevo-${nombre}-`))
  const contenedor = join(w, CONTENEDOR_HOSTIL)
  mkdirSync(contenedor, { recursive: true })
  const destino = join(contenedor, 'Tessera.app')
  crearBundle(destino, 'vieja')
  return { w, destino, marca: join(w, 'marca.txt'), traza: join(w, 'relevo.log'), zip: join(w, 'nueva.zip') }
}

function limpiar(w: string): void {
  rmSync(w, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
function main(): void {
  // =========================================================================
  hr('(1) bundleDesdeExe: del ejecutable al .app, y la plataforma es un parámetro')
  // =========================================================================
  const EXE_MAC = '/Applications/Tessera.app/Contents/MacOS/Tessera'
  check(
    '(1a) el exe de un .app da el .app (tres niveles arriba)',
    bundleDesdeExe(EXE_MAC, 'mac') === '/Applications/Tessera.app',
    String(bundleDesdeExe(EXE_MAC, 'mac'))
  )
  check(
    '(1b) con espacios y apóstrofo en la ruta, igual',
    bundleDesdeExe("/Users/O'Brien/Mis Apps/Tessera.app/Contents/MacOS/Tessera", 'mac') ===
      "/Users/O'Brien/Mis Apps/Tessera.app",
    String(bundleDesdeExe("/Users/O'Brien/Mis Apps/Tessera.app/Contents/MacOS/Tessera", 'mac'))
  )
  check(
    '(1c) un binario suelto NO es un bundle (dev, o `node_modules/.bin`)',
    bundleDesdeExe('/usr/local/bin/tessera', 'mac') === null,
    'null'
  )
  check(
    '(1d) una ruta demasiado corta no se convierte en "/" ni en ".app" a secas',
    bundleDesdeExe('/a/b/c', 'mac') === null && bundleDesdeExe('/.app/x/y', 'mac') === null,
    `${bundleDesdeExe('/a/b/c', 'mac')} / ${bundleDesdeExe('/.app/x/y', 'mac')}`
  )
  check(
    '(1e) en Windows y en Linux NO hay bundles: null aunque la ruta parezca uno',
    bundleDesdeExe(EXE_MAC, 'windows') === null && bundleDesdeExe(EXE_MAC, 'otra') === null,
    'null en las dos'
  )
  {
    // El llamador de producción (`bundleDeLaApp`) no pasa plataforma: lo que obtiene
    // tiene que ser idéntico a pasar la actual. Sin esto, el default podría estar
    // ignorándose sin que nadie lo notara.
    const porDefecto = bundleDesdeExe(EXE_MAC)
    const explicita = bundleDesdeExe(EXE_MAC, plataformaActual())
    check(
      `(1f) sin plataforma == plataforma actual (${plataformaActual()})`,
      porDefecto === explicita,
      `${porDefecto} == ${explicita}`
    )
  }

  // =========================================================================
  hr('(2) guionRelevoMac: el texto (orden de los pasos y entrecomillado)')
  // =========================================================================
  const OPC = {
    pid: 4242,
    zip: "/tmp/mi paquete/Tessera-1.0.0-arm64.zip",
    destino: "/Users/O'Brien/Apps $raras/Tessera.app",
    marca: '/tmp/datos de prueba/marca.txt',
    traza: '/tmp/datos de prueba/relevo.log',
    relanzar: false
  }
  const guion = guionRelevoMac(OPC)
  {
    // El ORDEN es la propiedad que salva al usuario: apartar (no borrar) va después
    // de verificar la firma, y el borrado de lo apartado va después de poner la nueva.
    const iFirma = guion.indexOf('codesign --verify')
    const iApartar = guion.indexOf('mv "$destino" "$apartado"')
    const iPoner = guion.indexOf('mv "$nueva" "$destino"')
    const iBorrar = guion.indexOf('rm -rf "$apartado"\nrm -rf "$stage"')
    check(
      '(2a) verificar firma -> apartar -> poner -> y sólo entonces borrar lo apartado',
      iFirma > 0 && iApartar > iFirma && iPoner > iApartar && iBorrar > iPoner,
      `firma@${iFirma} apartar@${iApartar} poner@${iPoner} borrar@${iBorrar}`
    )
    check(
      '(2b) el .app se BUSCA con find, no se supone el nombre (el fallo de la sonda)',
      /nueva=\$\(find "\$stage" -maxdepth 1 -name '\*\.app' -print -quit\)/.test(guion),
      guion.split('\n').find((l) => l.includes('find "$stage"')) ?? '(no está)'
    )
    check(
      '(2c) hay devolución de la versión anterior si el último paso falla',
      guion.includes('mv "$apartado" "$destino"') && guion.includes('se ha devuelto la anterior'),
      'mv "$apartado" "$destino" presente'
    )
    check(
      '(2d) el fracaso POSTERIOR a tocar el destino no borra el stage',
      /fracaso_sucio\(\) \{ anotar "fallo: \$1"; exit 1; \}/.test(guion) &&
        /fracaso_limpio\(\) \{ anotar "fallo: \$1"; rm -rf "\$stage"; exit 1; \}/.test(guion),
      'fracaso_sucio sin rm; fracaso_limpio con rm'
    )
  }
  check(
    '(2e) toda ruta va entrecomillada con citarSh (apóstrofo, espacio y $ incluidos)',
    guion.includes(`destino=${citarSh(OPC.destino)}`) &&
      guion.includes(`zip=${citarSh(OPC.zip)}`) &&
      guion.includes(`marca=${citarSh(OPC.marca)}`),
    citarSh(OPC.destino)
  )
  check(
    '(2f) el apóstrofo NO viaja crudo a ninguna parte del guion',
    !guion.includes("O'Brien/Apps"),
    "la única forma de O'Brien es la escapada"
  )
  check(
    '(2g) el stage por defecto cuelga del CONTENEDOR del destino (rename, no copia)',
    guion.includes(`stage=${citarSh("/Users/O'Brien/Apps $raras/.tessera-relevo")}`),
    citarSh("/Users/O'Brien/Apps $raras/.tessera-relevo")
  )
  check(
    '(2h) el apartado es el destino + .anterior, en el mismo directorio',
    guion.includes(`apartado=${citarSh(OPC.destino + '.anterior')}`),
    citarSh(OPC.destino + '.anterior')
  )
  check(
    '(2i) sin relanzar NO hay `open`: cerrar Tessera no puede reabrirla',
    !guion.includes('open -n'),
    'sin open'
  )
  {
    const conOpen = guionRelevoMac({
      ...OPC,
      relanzar: true,
      argumentos: ["--user-data-dir=/Users/O'Brien/Library/Application Support/Tessera"]
    })
    check(
      '(2j) con relanzar hay `open -n` y los argumentos van citados',
      conOpen.includes(`open -n ${citarSh(OPC.destino)} --args ${citarSh("--user-data-dir=/Users/O'Brien/Library/Application Support/Tessera")}`),
      conOpen.split('\n').find((l) => l.startsWith('open -n')) ?? '(no está)'
    )
    check(
      '(2k) el `ok` se anota ANTES de relanzar (la app nueva tiene que poder leerlo)',
      conOpen.indexOf('anotar ok') < conOpen.indexOf('open -n'),
      `ok@${conOpen.indexOf('anotar ok')} open@${conOpen.indexOf('open -n')}`
    )
    const espera = guionRelevoMac({ ...OPC, esperaSegundos: 7 })
    check(
      '(2l) la espera se traduce a vueltas de medio segundo',
      espera.includes(`vueltas=${citarSh('14')}`),
      'esperaSegundos 7 -> vueltas 14'
    )
  }
  if (existsSync('/bin/sh')) {
    // `sh -n` analiza la sintaxis SIN ejecutar nada. Es lo que caza un
    // entrecomillado roto por una ruta hostil antes de que el guion corra sobre la
    // app de alguien; y corre en cualquier POSIX, no sólo en macOS.
    const w = mkdtempSync(join(tmpdir(), 'tessera-sintaxis-'))
    const g = join(w, 'relevo.sh')
    writeFileSync(g, guionRelevoMac({ ...OPC, relanzar: true, argumentos: ["--user-data-dir=/a 'b'/c"] }))
    const r = spawnSync('/bin/sh', ['-n', g], { encoding: 'utf8' })
    check(
      '(2m) el guion es sintácticamente válido para sh con rutas hostiles',
      r.status === 0,
      r.status === 0 ? 'sh -n conforme' : `sh -n: ${r.stderr.trim()}`
    )
    limpiar(w)
  } else {
    saltar('(2m) sintaxis con sh -n', 'no hay /bin/sh en esta máquina')
  }

  // =========================================================================
  hr('(3) interpretarMarcaRelevo: lo que dejó dicho el proceso que ya no existe')
  // =========================================================================
  check('(3a) ok', interpretarMarcaRelevo('ok\n')?.clase === 'ok', 'ok')
  {
    const r = interpretarMarcaRelevo('fallo: la firma del paquete no es válida\n')
    check(
      '(3b) fallo con motivo, y el motivo llega entero',
      r?.clase === 'fallo' && r.motivo === 'la firma del paquete no es válida',
      r?.clase === 'fallo' ? r.motivo : String(r)
    )
  }
  check(
    '(3c) sólo cuenta la PRIMERA línea, y el \\r de un archivo raro no ensucia',
    interpretarMarcaRelevo('ok\r\nbasura posterior')?.clase === 'ok',
    'ok'
  )
  check(
    '(3d) lo que no se reconoce es null, nunca un desenlace inventado',
    interpretarMarcaRelevo('') === null &&
      interpretarMarcaRelevo('fallo:') === null &&
      interpretarMarcaRelevo('vete a saber') === null,
    'null en los tres'
  )

  // =========================================================================
  hr('(4) EJECUCIÓN REAL: el caso bueno — sustituye y lo deja dicho')
  // =========================================================================
  if (!ES_MAC) {
    saltar('(4..8) ejecución del guion', 'ditto y codesign son de macOS')
  } else {
    const e = montarEscenario('ok')
    try {
      // El .app de dentro del zip NO se llama como el destino: es exactamente el caso
      // que rompió la primera sonda, y por eso el guion lo BUSCA.
      const fuente = join(e.w, 'fuente', 'Tessera Nueva 0.49.3.app')
      crearBundle(fuente, 'nueva')
      empaquetar(fuente, e.zip)
      check(
        '(4-previo) el destino arranca con la versión vieja',
        selloDe(e.destino) === 'vieja',
        String(selloDe(e.destino))
      )
      const r = correrGuion(e.w, {
        pid: pidMuerto(),
        zip: e.zip,
        destino: e.destino,
        marca: e.marca,
        traza: e.traza,
        relanzar: false,
        esperaSegundos: 5
      })
      check('(4a) el guion termina con éxito', r.status === 0, `status ${r.status}`)
      check(
        '(4b) el bundle QUEDA SUSTITUIDO, con el nombre del destino y no el del zip',
        selloDe(e.destino) === 'nueva',
        String(selloDe(e.destino))
      )
      check('(4c) el desenlace es ok', r.marca === 'ok', r.marca)
      check(
        '(4d) no quedan restos: ni la versión apartada ni la carpeta de trabajo',
        !existsSync(`${e.destino}.anterior`) &&
          !existsSync(join(e.w, CONTENEDOR_HOSTIL, '.tessera-relevo')),
        'contenedor limpio'
      )
      check(
        '(4e) lo instalado sigue pasando la verificación de firma',
        spawnSync('codesign', ['--verify', '--deep', '--strict', e.destino]).status === 0,
        'codesign --verify conforme'
      )
    } finally {
      limpiar(e.w)
    }

    // =======================================================================
    hr('(5) EJECUCIÓN REAL: un zip SIN .app no toca el destino')
    // =======================================================================
    const e5 = montarEscenario('sinapp')
    try {
      const basura = join(e5.w, 'fuente', 'paquete')
      mkdirSync(basura, { recursive: true })
      writeFileSync(join(basura, 'leeme.txt'), 'esto no es una aplicación\n')
      empaquetar(basura, e5.zip)
      const r = correrGuion(e5.w, {
        pid: pidMuerto(),
        zip: e5.zip,
        destino: e5.destino,
        marca: e5.marca,
        traza: e5.traza,
        relanzar: false,
        esperaSegundos: 5
      })
      check('(5a) el guion falla', r.status !== 0, `status ${r.status}`)
      check(
        '(5b) EL DESTINO SIGUE INTACTO con la versión vieja',
        selloDe(e5.destino) === 'vieja',
        String(selloDe(e5.destino))
      )
      check(
        '(5c) y dice por qué',
        interpretarMarcaRelevo(r.marca)?.clase === 'fallo' &&
          r.marca.includes('no contiene ninguna aplicación'),
        r.marca
      )
    } finally {
      limpiar(e5.w)
    }

    // =======================================================================
    hr('(6) EJECUCIÓN REAL: una firma inválida no toca el destino')
    // =======================================================================
    const e6 = montarEscenario('firma')
    try {
      const fuente = join(e6.w, 'fuente', 'Tessera.app')
      crearBundle(fuente, 'nueva')
      // Se manipula DESPUÉS de firmar: el sello de recursos deja de cuadrar y
      // `codesign --verify --deep --strict` lo detecta. Es la simulación más fiel que
      // hay de un paquete alterado en tránsito con el hash del feed ya superado.
      writeFileSync(rutaSello(fuente), 'manipulada\n')
      empaquetar(fuente, e6.zip)
      check(
        '(6-previo) el paquete manipulado NO pasa la verificación (si no, el caso no prueba nada)',
        spawnSync('codesign', ['--verify', '--deep', '--strict', fuente]).status !== 0,
        'codesign --verify rechaza el bundle manipulado'
      )
      const r = correrGuion(e6.w, {
        pid: pidMuerto(),
        zip: e6.zip,
        destino: e6.destino,
        marca: e6.marca,
        traza: e6.traza,
        relanzar: false,
        esperaSegundos: 5
      })
      check('(6a) el guion falla', r.status !== 0, `status ${r.status}`)
      check(
        '(6b) EL DESTINO SIGUE INTACTO con la versión vieja',
        selloDe(e6.destino) === 'vieja',
        String(selloDe(e6.destino))
      )
      check('(6c) y dice que fue la firma', r.marca.includes('firma'), r.marca)
    } finally {
      limpiar(e6.w)
    }

    // =======================================================================
    hr('(7) EJECUCIÓN REAL: si el ÚLTIMO paso falla, se DEVUELVE la versión anterior')
    // =======================================================================
    // El caso decisivo. Ver la cabecera para el porqué de la imagen de disco.
    const e7 = { w: mkdtempSync(join(tmpdir(), 'tessera-relevo-devolver-')) }
    const punto = join(e7.w, 'volumen')
    let montado = false
    try {
      const dmg = join(e7.w, 'chico.dmg')
      const crear = spawnSync(
        'hdiutil',
        ['create', '-size', '12m', '-fs', 'HFS+', '-volname', 'TESSERAPRUEBA', '-quiet', dmg],
        { encoding: 'utf8' }
      )
      if (crear.status !== 0) throw new Error(`hdiutil create: ${crear.stderr}`)
      mkdirSync(punto, { recursive: true })
      const montar = spawnSync(
        'hdiutil',
        ['attach', dmg, '-nobrowse', '-quiet', '-mountpoint', punto],
        { encoding: 'utf8' }
      )
      if (montar.status !== 0) throw new Error(`hdiutil attach: ${montar.stderr}`)
      montado = true

      const destino = join(punto, 'Tessera.app')
      crearBundle(destino, 'vieja', 1)
      // La nueva NO cabe en el volumen ni de lejos: el `mv` entre volúmenes tiene que
      // agotar el espacio a mitad de copia, con el destino ya apartado.
      const fuente = join(e7.w, 'fuente', 'Tessera Nueva.app')
      crearBundle(fuente, 'nueva', 30)
      const zip = join(e7.w, 'nueva.zip')
      empaquetar(fuente, zip)

      const marca = join(e7.w, 'marca.txt')
      const r = correrGuion(e7.w, {
        pid: pidMuerto(),
        zip,
        destino,
        marca,
        traza: join(e7.w, 'relevo.log'),
        relanzar: false,
        esperaSegundos: 5,
        // FUERA del volumen: es lo que convierte el paso 6 en una copia que puede
        // fallar. En producción `stage` va dentro y esto no puede pasar.
        stage: join(e7.w, 'stage')
      })
      check('(7a) el guion falla, como tiene que hacer', r.status !== 0, `status ${r.status}`)
      check(
        '(7b) EL USUARIO NO SE QUEDA SIN APP: el destino existe y es la versión ANTERIOR',
        existsSync(destino) && selloDe(destino) === 'vieja',
        `${existsSync(destino) ? 'existe' : 'NO EXISTE'} / sello ${String(selloDe(destino))}`
      )
      check(
        '(7c) la app devuelta sigue siendo un bundle válido y firmado, no una copia a medias',
        spawnSync('codesign', ['--verify', '--deep', '--strict', destino]).status === 0,
        'codesign --verify conforme'
      )
      check(
        '(7d) y el desenlace dice exactamente que se devolvió',
        r.marca.includes('se ha devuelto la anterior'),
        r.marca
      )
      check(
        '(7e) no queda la versión apartada rondando por el contenedor',
        !existsSync(`${destino}.anterior`),
        'sin .anterior'
      )
    } finally {
      if (montado) {
        // `-force` porque Spotlight puede tener el volumen tomado un instante.
        spawnSync('hdiutil', ['detach', punto, '-quiet'])
        if (existsSync(join(punto, 'Tessera.app'))) spawnSync('hdiutil', ['detach', punto, '-force', '-quiet'])
      }
      limpiar(e7.w)
    }

    // =======================================================================
    hr('(8) EJECUCIÓN REAL: si la app no se cierra, NO se toca el bundle')
    // =======================================================================
    const e8 = montarEscenario('viva')
    const vivo = spawn('/bin/sh', ['-c', 'sleep 20'], { detached: true, stdio: 'ignore' })
    try {
      const fuente = join(e8.w, 'fuente', 'Tessera.app')
      crearBundle(fuente, 'nueva')
      empaquetar(fuente, e8.zip)
      const r = correrGuion(e8.w, {
        pid: vivo.pid ?? 1,
        zip: e8.zip,
        destino: e8.destino,
        marca: e8.marca,
        traza: e8.traza,
        relanzar: false,
        // Un segundo: lo justo para comprobar que se rinde en vez de seguir adelante.
        esperaSegundos: 1
      })
      check('(8a) el guion se rinde con error', r.status !== 0, `status ${r.status}`)
      check(
        '(8b) el bundle NO se ha tocado: sustituirlo bajo un proceso vivo es lo que no se hace',
        selloDe(e8.destino) === 'vieja',
        String(selloDe(e8.destino))
      )
      check('(8c) y lo dice', r.marca.includes('no llegó a cerrarse'), r.marca)
    } finally {
      try {
        process.kill(vivo.pid ?? 0, 'SIGKILL')
      } catch {
        // ya se había ido solo
      }
      limpiar(e8.w)
    }
  }

  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  if (saltados.length > 0) {
    console.log(`\nSALTADOS (${saltados.length}, esta máquina no puede ejecutarlos): ${saltados.join(' ;; ')}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  const nota = saltados.length > 0 ? ` (${saltados.length} saltados)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS${nota} — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
