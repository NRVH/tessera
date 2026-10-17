#!/usr/bin/env node
// =============================================================================
// Prueba de la capa PURA de «Abrir con Tessera» en Linux (npm run test:escritorio-linux): dónde
// vive según `XDG_DATA_HOME`, la disponibilidad por plataforma, el escapado del `Exec` y su ida y
// vuelta, y instalar, leer, reescribir y borrar sobre una carpeta TEMPORAL que hace de HOME (nunca
// el real), respetando un `tessera.desktop` ajeno; el tipo `application/x-tessera` que va con la
// entrada; y que instalarlo no le quita las carpetas a su aplicación (`mimeapps.list`), con el
// servicio de punta a punta en Linux (y que al arrancar pone al día una entrada vieja).
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { register } from 'node:module'
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Los módulos de producción importan sin extensión; se reintenta con `.ts`.
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

const {
  ARCHIVO_DESKTOP,
  CLAVE_PROPIA,
  argumentoExec,
  carpetaDatos,
  contenidoDesktop,
  desinstalarDesktop,
  disponibilidadEscritorioLinux,
  ejecutableDelDesktop,
  esDesktopPropio,
  instalarDesktop,
  leerDesktopInstalado,
  rutaDesktop,
  rutaEjecutableLinux,
  rutaIcono,
  rutaIconoDocumento,
  origenIconoDocumento,
  fijadaDelDesktop,
  MIME_COPIA,
  contenidoMime,
  mimeAlDia,
  rutaPaqueteMime
} = await import('./escritorioLinux.ts')
const { MIME_CARPETA, aplicacionAFijar, conDefecto, defectoDeclarado, leerSalidaGio, rutaMimeapps, sinDefecto } = await import(
  './carpetasPorDefecto.ts'
)
const { EscritorioLinuxService } = await import('./EscritorioLinuxService.ts')
const { fijarInfoApp } = await import('../util/infoApp.ts')

let pasados = 0
let total = 0

function hr(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`)
}

function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasados++
  console.log(`  ${pass ? '✓' : '✗'} ${name}${evidence === '' ? '' : ` — ${evidence}`}`)
}

const existe = (ruta: string): Promise<boolean> =>
  stat(ruta).then(
    () => true,
    () => false
  )

hr('(A) dónde se instala')
{
  check('(A1) sin XDG_DATA_HOME, ~/.local/share', carpetaDatos({ home: '/home/ana' }) === '/home/ana/.local/share', carpetaDatos({ home: '/home/ana' }))
  check('(A2) con XDG_DATA_HOME absoluto, ése', carpetaDatos({ home: '/home/ana', xdgDataHome: '/datos/x/' }) === '/datos/x', carpetaDatos({ home: '/home/ana', xdgDataHome: '/datos/x/' }))
  check('(A3) relativo o vacío se ignora', carpetaDatos({ home: '/h', xdgDataHome: 'rel' }) === '/h/.local/share' && carpetaDatos({ home: '/h', xdgDataHome: '' }) === '/h/.local/share', '')
  check('(A4) el archivo es applications/tessera.desktop', rutaDesktop('/d') === `/d/applications/${ARCHIVO_DESKTOP}`, rutaDesktop('/d'))
  check('(A5) el icono va al tema hicolor de 512', rutaIcono('/d') === '/d/icons/hicolor/512x512/apps/tessera.png', rutaIcono('/d'))
  check('(A6) el AppImage manda sobre el ejecutable', rutaEjecutableLinux('/home/a/Tessera.AppImage', '/tmp/.mount_x/tessera') === '/home/a/Tessera.AppImage', '')
  check('(A7) sin AppImage, el ejecutable', rutaEjecutableLinux(undefined, '/opt/Tessera/tessera') === '/opt/Tessera/tessera' && rutaEjecutableLinux('', '/e') === '/e', '')
  check(
    '(A8) el binario real se cambia por su lanzador',
    rutaEjecutableLinux(undefined, '/opt/Tessera/tessera-bin') === '/opt/Tessera/tessera',
    rutaEjecutableLinux(undefined, '/opt/Tessera/tessera-bin')
  )
}

hr('(B) disponibilidad por plataforma')
{
  const emp = { empaquetada: true }
  check('(B1) Linux empaquetado: ok', disponibilidadEscritorioLinux(emp, 'linux') === 'ok', '')
  check('(B2) Linux en desarrollo', disponibilidadEscritorioLinux({ empaquetada: false }, 'linux') === 'desarrollo', '')
  check('(B3) Windows, macOS y otra: otro-sistema', (['windows', 'mac', 'otra'] as const).every((p) => disponibilidadEscritorioLinux(emp, p) === 'otro-sistema'), '')
}

hr('(C) escapado del Exec')
{
  const casos: [string, string][] = [
    ['/opt/Tessera/tessera', '"/opt/Tessera/tessera"'],
    ['/home/a/Mis Apps/Tessera.AppImage', '"/home/a/Mis Apps/Tessera.AppImage"'],
    ['/home/a/$HOME/t', '"/home/a/\\\\$HOME/t"'],
    ['/home/a/"x"/t', '"/home/a/\\\\"x\\\\"/t"'],
    ['/home/a/`x`/t', '"/home/a/\\\\`x\\\\`/t"'],
    ['/home/a/100%/t', '"/home/a/100%%/t"'],
    ['/home/a\\b/t', '"/home/a\\\\\\\\b/t"']
  ]
  for (const [ruta, esperado] of casos) {
    const r = argumentoExec(ruta)
    check(`(C) ${ruta}`, r === esperado, String(r))
  }
  check('(C8) una barra invertida acaba en cuatro', (argumentoExec('a\\b') ?? '').includes('\\\\\\\\'), String(argumentoExec('a\\b')))
  check('(C9) un salto de línea se rechaza', argumentoExec('/a\nb') === null && contenidoDesktop('/a\nb', '/i.png') === null, '')
  check('(C10) un retorno de carro también', argumentoExec('/a\rb') === null, '')
  const raras = ['/opt/T essera/x', '/a/$b/`c`/"d"/100%/e\\f', '/a/%F/b', '/x/\\\\y']
  for (const r of raras) {
    const c = contenidoDesktop(r, '/i.png')
    check(`(C) ida y vuelta: ${r}`, c !== null && ejecutableDelDesktop(c) === r, c === null ? 'null' : String(ejecutableDelDesktop(c)))
  }
}

hr('(D) contenido')
{
  const c = contenidoDesktop('/opt/Tessera/tessera', '/d/icons/hicolor/512x512/apps/tessera.png') ?? ''
  const lineas = c.split('\n')
  for (const l of [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Tessera',
    'Exec="/opt/Tessera/tessera" %F',
    'Icon=/d/icons/hicolor/512x512/apps/tessera.png',
    'Terminal=false',
    'Categories=Development;IDE;',
    'MimeType=inode/directory;application/x-tessera;',
    'StartupWMClass=Tessera',
    `${CLAVE_PROPIA}=true`
  ]) {
    check(`(D) lleva «${l}»`, lineas.includes(l), '')
  }
  check('(D) empieza por el grupo', lineas[0] === '[Desktop Entry]', lineas[0])
  check('(D) lleva un Comment', lineas.some((l) => /^Comment=.+/.test(l)), '')
  check('(D) es propio', esDesktopPropio(c), '')
  check('(D) uno sin la clave no es propio', !esDesktopPropio('[Desktop Entry]\nName=Tessera\nExec=tessera %F\n'), '')
}

hr('(H) el tipo de las copias de la configuración (.tessera)')
{
  const x = contenidoMime()
  check('(H1) la definición va a mime/packages/tessera.xml', rutaPaqueteMime('/d') === '/d/mime/packages/tessera.xml', rutaPaqueteMime('/d'))
  check('(H2) declara application/x-tessera', MIME_COPIA === 'application/x-tessera' && x.includes(`<mime-type type="${MIME_COPIA}">`), '')
  check('(H3) por la extensión .tessera', x.includes('<glob pattern="*.tessera"/>'), '')
  check(
    '(H4) con su icono de documento, en mimetypes y con el nombre derivado del tipo',
    x.includes('<icon name="application-x-tessera"/>') && rutaIconoDocumento('/d') === '/d/icons/hicolor/512x512/mimetypes/application-x-tessera.png',
    rutaIconoDocumento('/d')
  )
  check(
    '(H4b) su PNG viaja junto al de la marca, con barras de las dos plataformas',
    origenIconoDocumento('/opt/T/resources/icon.png') === '/opt/T/resources/tessera-documento.png' &&
      origenIconoDocumento('C:\\T\\resources\\icon.png') === 'C:\\T\\resources\\tessera-documento.png',
    origenIconoDocumento('/opt/T/resources/icon.png')
  )
  check('(H5) con su nombre en los dos idiomas', x.includes('<comment>Tessera configuration</comment>') && x.includes('<comment xml:lang="es">Configuración de Tessera</comment>'), '')
  check('(H6) NEGATIVO: no hereda de JSON ni de texto', !x.includes('sub-class-of'), '')
  check('(H7) es XML con su espacio de nombres', x.startsWith('<?xml') && x.includes('xmlns="http://www.freedesktop.org/standards/shared-mime-info"'), '')
}

hr('(E) en disco, sobre un HOME temporal')
{
  const home = await mkdtemp(join(tmpdir(), 'tessera-escritorio-'))
  const datos = carpetaDatos({ home })
  const iconoOrigen = join(home, 'icono-origen.png')
  await writeFile(iconoOrigen, 'png-falso')
  await writeFile(join(home, 'tessera-documento.png'), 'png-documento')
  try {
    const r1 = await instalarDesktop(datos, '/opt/A/tessera', iconoOrigen)
    check('(E1) instalar no falla', r1.fallos.length === 0 && r1.iconoCopiado, JSON.stringify(r1))
    const leido = await leerDesktopInstalado(datos)
    check('(E2) se lee y apunta al ejecutable', leido !== null && ejecutableDelDesktop(leido) === '/opt/A/tessera', String(leido && ejecutableDelDesktop(leido)))
    check('(E3) el icono se copió', (await readFile(rutaIcono(datos), 'utf8')) === 'png-falso', '')
    check('(E3b) y el del documento, al tema de los tipos', (await readFile(rutaIconoDocumento(datos), 'utf8')) === 'png-documento', '')
    check('(E4) no queda el temporal', !(await existe(`${rutaDesktop(datos)}.tmp`)), '')
    check(
      '(E4b) con la entrada se escribe el tipo .tessera, sin temporal',
      r1.mimeEscrito && (await readFile(rutaPaqueteMime(datos), 'utf8')) === contenidoMime() && (await mimeAlDia(datos)) && !(await existe(`${rutaPaqueteMime(datos)}.tmp`)),
      JSON.stringify(r1)
    )

    // Reconciliar: el ejecutable cambió y el instalado es nuestro, así que se reescribe.
    const ahora = '/home/a/Descargas/Tessera-2.AppImage'
    check('(E5) el instalado apunta a otra copia', leido !== null && ejecutableDelDesktop(leido) !== ahora, '')
    const r2 = await instalarDesktop(datos, ahora, iconoOrigen)
    const releido = await leerDesktopInstalado(datos)
    check('(E6) reescrito apunta a la nueva', r2.fallos.length === 0 && releido !== null && ejecutableDelDesktop(releido) === ahora, String(releido && ejecutableDelDesktop(releido)))

    const r3 = await desinstalarDesktop(datos)
    check('(E7) borrar no falla y se va el archivo', r3.length === 0 && !(await existe(rutaDesktop(datos))), '')
    check('(E8) y se va el icono', !(await existe(rutaIcono(datos))) && !(await existe(rutaIconoDocumento(datos))), '')
    check('(E8b) y el tipo .tessera', !(await existe(rutaPaqueteMime(datos))) && !(await mimeAlDia(datos)), '')
    check('(E9) borrar dos veces no es un fallo', (await desinstalarDesktop(datos)).length === 0, '')

    const r4 = await instalarDesktop(datos, '/x', join(home, 'no-existe.png'))
    check('(E10) sin icono, la entrada se instala igual', r4.fallos.length === 0 && !r4.iconoCopiado && (await existe(rutaDesktop(datos))), JSON.stringify(r4))
    await desinstalarDesktop(datos)

    // Uno ajeno con el mismo nombre: ni se pisa ni se borra.
    const ajeno = '[Desktop Entry]\nType=Application\nName=Tessera del usuario\nExec=/usr/bin/tessera %F\n'
    await mkdir(join(datos, 'applications'), { recursive: true })
    await writeFile(rutaDesktop(datos), ajeno)
    const r5 = await instalarDesktop(datos, '/opt/A/tessera', iconoOrigen)
    check('(E11) instalar sobre uno ajeno falla y no lo pisa', r5.fallos.length === 1 && (await readFile(rutaDesktop(datos), 'utf8')) === ajeno, JSON.stringify(r5.fallos))
    const r6 = await desinstalarDesktop(datos)
    check('(E12) apagar no borra uno ajeno', r6.length === 0 && (await readFile(rutaDesktop(datos), 'utf8')) === ajeno, '')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

hr('(F) la aplicación de las carpetas en mimeapps.list')
{
  const NAUTILUS = 'org.gnome.Nautilus.desktop'
  check('(F1) la ruta sigue XDG_CONFIG_HOME', rutaMimeapps({ home: '/h', xdgConfigHome: '/c/' }) === '/c/mimeapps.list' && rutaMimeapps({ home: '/h' }) === '/h/.config/mimeapps.list', '')
  const vacio = conDefecto('', MIME_CARPETA, NAUTILUS)
  check('(F2) sobre un archivo vacío crea la sección', vacio === `[Default Applications]\n${MIME_CARPETA}=${NAUTILUS};\n` && defectoDeclarado(vacio, MIME_CARPETA) === NAUTILUS, JSON.stringify(vacio))
  const otras = '[Added Associations]\ntext/plain=gedit.desktop;\n\n[Default Applications]\nimage/png=eog.desktop;\n'
  const conOtras = conDefecto(otras, MIME_CARPETA, NAUTILUS)
  check(
    '(F3) se añade dentro de la sección existente y no toca las demás',
    defectoDeclarado(conOtras, MIME_CARPETA) === NAUTILUS && defectoDeclarado(conOtras, 'image/png') === 'eog.desktop' && conOtras.includes('text/plain=gedit.desktop;'),
    JSON.stringify(conOtras)
  )
  const elegida = `[Default Applications]\n${MIME_CARPETA}=nemo.desktop;${NAUTILUS};\n`
  check('(F4) NEGATIVO: si el usuario ya eligió una, no se cambia', conDefecto(elegida, MIME_CARPETA, NAUTILUS) === elegida && defectoDeclarado(elegida, MIME_CARPETA) === 'nemo.desktop', '')
  check('(F5) deshacer deja el archivo como estaba', sinDefecto(conOtras, MIME_CARPETA, NAUTILUS) === otras, JSON.stringify(sinDefecto(conOtras, MIME_CARPETA, NAUTILUS)))
  const cambiada = conOtras.replace(`${MIME_CARPETA}=${NAUTILUS};`, `${MIME_CARPETA}=nemo.desktop;`)
  check('(F6) NEGATIVO: si el usuario la cambió después, deshacer no la toca', sinDefecto(cambiada, MIME_CARPETA, NAUTILUS) === cambiada, '')
  check('(F7) NEGATIVO: la misma clave en otra sección no cuenta', defectoDeclarado(`[Added Associations]\n${MIME_CARPETA}=x.desktop;\n`, MIME_CARPETA) === null, '')
  const gio = `Default application for “inode/directory”: ${NAUTILUS}\nRegistered applications:\n\ttessera.desktop\n\t${NAUTILUS}\nRecommended applications:\n\ttessera.desktop\n`
  const leida = leerSalidaGio(gio)
  check('(F8) se lee la salida de gio', leida.defecto === NAUTILUS && leida.registradas.join(',') === `tessera.desktop,${NAUTILUS}`, JSON.stringify(leida))
  check('(F9) se fija la que abre las carpetas', aplicacionAFijar(leida, ARCHIVO_DESKTOP) === NAUTILUS, '')
  check(
    '(F10) si ya es la nuestra (instalación anterior), la primera otra que las admite; sin otra, ninguna',
    aplicacionAFijar({ defecto: ARCHIVO_DESKTOP, registradas: [ARCHIVO_DESKTOP, NAUTILUS] }, ARCHIVO_DESKTOP) === NAUTILUS &&
      aplicacionAFijar({ defecto: null, registradas: [ARCHIVO_DESKTOP] }, ARCHIVO_DESKTOP) === null,
    ''
  )
  const conFijada = contenidoDesktop('/opt/A/tessera', '/i.png', NAUTILUS)
  check('(F11) el .desktop recuerda la que fijó', conFijada !== null && fijadaDelDesktop(conFijada) === NAUTILUS && fijadaDelDesktop(contenidoDesktop('/x', '/i.png') ?? '') === null, '')
  check('(F12) NEGATIVO: un nombre raro no se escribe en el .desktop', contenidoDesktop('/x', '/i.png', 'a\nExec=/bin/mal') === null && contenidoDesktop('/x', '/i.png', '../x.desktop') === null, '')
}

hr('(G) el servicio de punta a punta, sobre un HOME temporal (solo Linux)')
if (process.platform !== 'linux') {
  console.log('  [NO APLICA] la disponibilidad del servicio es la de la plataforma actual')
} else {
  const home = await mkdtemp(join(tmpdir(), 'tessera-escritorio-servicio-'))
  fijarInfoApp({
    rutaUserData: () => home,
    rutaAppData: () => home,
    rutaExe: () => '/opt/A/tessera',
    rutaAppPath: () => home,
    versionApp: () => '0.0.0',
    appEmpaquetada: () => true
  })
  const NAUTILUS = 'org.gnome.Nautilus.desktop'
  let consulta = { defecto: NAUTILUS as string | null, registradas: [NAUTILUS] }
  const servicio = new EscritorioLinuxService({
    sistema: { empaquetada: () => true },
    ejecutable: () => '/opt/A/tessera',
    iconoOrigen: join(home, 'no-hay.png'),
    home,
    consultarCarpetas: async () => consulta
  })
  const mimeapps = rutaMimeapps({ home })
  try {
    const r1 = await servicio.aplicar(true)
    const tras = await readFile(mimeapps, 'utf8').catch(() => '')
    check('(G1) al instalar se fija la que abría las carpetas', r1.ok && defectoDeclarado(tras, MIME_CARPETA) === NAUTILUS, tras)
    consulta = { defecto: ARCHIVO_DESKTOP, registradas: [ARCHIVO_DESKTOP, NAUTILUS] }
    const r2 = await servicio.aplicar(true)
    const desktop = (await leerDesktopInstalado(carpetaDatos({ home }))) ?? ''
    check('(G2) reinstalar conserva la fijada y no duplica la línea', r2.ok && fijadaDelDesktop(desktop) === NAUTILUS && (await readFile(mimeapps, 'utf8')).split(MIME_CARPETA).length === 2, '')
    const r3 = await servicio.aplicar(false)
    check('(G3) al quitarla se deshace', r3.ok && defectoDeclarado(await readFile(mimeapps, 'utf8'), MIME_CARPETA) === null, await readFile(mimeapps, 'utf8'))
    await writeFile(mimeapps, `[Default Applications]\n${MIME_CARPETA}=nemo.desktop;\n`)
    consulta = { defecto: 'nemo.desktop', registradas: ['nemo.desktop'] }
    await servicio.aplicar(true)
    await servicio.aplicar(false)
    check('(G4) NEGATIVO: la que eligió el usuario sigue tras instalar y quitar', defectoDeclarado(await readFile(mimeapps, 'utf8'), MIME_CARPETA) === 'nemo.desktop', '')

    // Una entrada de una versión sin el tipo `.tessera`, apuntando al MISMO ejecutable: al arrancar se pone al día.
    const datosG = carpetaDatos({ home })
    const vieja = (contenidoDesktop('/opt/A/tessera', rutaIcono(datosG)) ?? '').replace(`${MIME_COPIA};`, '')
    await mkdir(join(datosG, 'applications'), { recursive: true })
    await writeFile(rutaDesktop(datosG), vieja)
    await rm(rutaPaqueteMime(datosG), { force: true })
    await servicio.reconciliar()
    const puesta = (await leerDesktopInstalado(datosG)) ?? ''
    check(
      '(G7) reconciliar pone al día una entrada sin el tipo .tessera',
      puesta.includes(`MimeType=inode/directory;${MIME_COPIA};`) && (await mimeAlDia(datosG)) && ejecutableDelDesktop(puesta) === '/opt/A/tessera',
      puesta
    )
    await servicio.aplicar(false)
    await rm(mimeapps, { force: true })

    // Un mimeapps.list que es un ENLACE (dotfiles): se escribe su destino y el enlace sigue.
    const real = join(home, 'dotfiles-mimeapps.list')
    await writeFile(real, '[Added Associations]\ntext/plain=gedit.desktop;\n')
    await rm(mimeapps, { force: true })
    await symlink(real, mimeapps)
    consulta = { defecto: NAUTILUS, registradas: [NAUTILUS] }
    const r5 = await servicio.aplicar(true)
    check(
      '(G5) con mimeapps.list enlazado: el enlace se conserva y la línea va a su destino',
      r5.ok && (await lstat(mimeapps)).isSymbolicLink() && defectoDeclarado(await readFile(real, 'utf8'), MIME_CARPETA) === NAUTILUS && (await readFile(real, 'utf8')).includes('gedit'),
      JSON.stringify(r5)
    )
    await servicio.aplicar(false)
    await rm(mimeapps, { force: true })

    // Uno que no se puede leer: no se instala nada y el archivo sigue tal cual.
    const ajenoMime = '[Default Applications]\nimage/png=eog.desktop;\n'
    await writeFile(mimeapps, ajenoMime)
    await chmod(mimeapps, 0o000)
    const esRoot = process.getuid?.() === 0
    const r6 = await servicio.aplicar(true)
    await chmod(mimeapps, 0o644)
    if (esRoot) {
      console.log('  [NO APLICA] (G6) como root se lee igual')
    } else {
      check(
        '(G6) NEGATIVO: un mimeapps.list ilegible no se sustituye (antes se perdían sus asociaciones)',
        !r6.ok && (await readFile(mimeapps, 'utf8')) === ajenoMime && (await leerDesktopInstalado(carpetaDatos({ home }))) === null,
        JSON.stringify(r6)
      )
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

hr('VEREDICTO')
const allPass = pasados === total
console.log(`VEREDICTO: ${pasados}/${total} PASS`)
process.exit(allPass ? 0 : 1)
