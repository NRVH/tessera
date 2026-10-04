#!/usr/bin/env node
// =============================================================================
// Prueba de `FileService.importFromHost` (npm run test:import): lo que se suelta sobre el árbol
// se COPIA si viene de fuera del proyecto y se MUEVE si ya vivía dentro, como en los gestores de
// archivos. Cubre todo-o-nada ante colisiones, sobrescritura confirmada, carpetas recursivas,
// no-op al soltar donde ya está, ciclos, anti-traversal, y que la CAJA no decide mover-vs-copiar
// (NTFS y APFS no distinguen mayúsculas): la regla pura se fija para las tres plataformas.
// Fixture desechable en os.tmpdir(); el escritorio es un objeto literal, sin `electron`.
// =============================================================================

import { register } from 'node:module'
import { promises as fs } from 'node:fs'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron.ts'

// Reintento ".ts" para los imports extensionless de producción; `electron` no debe cargarse.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('FileService importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { FileService } = await import('./FileService.ts')
const { comparablePath, samePath, isInside } = await import('./utilidadesDisco.ts')
const { esMac, esWindows } = await import('../../shared/plataforma.ts')

/** El escritorio de la prueba: aquí nada se revela, se abre, se arrastra ni se guarda. */
const escritorio: EscritorioArchivos = {
  revelarEnCarpeta: () => {},
  abrirRuta: async () => '',
  imagenDesdeDataUrl: () => ({ isEmpty: () => true }) as never,
  guardarConDialogo: async () => ({ canceled: true, filePath: '' })
}

let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}
async function rejects(fn: () => Promise<unknown>, re: RegExp): Promise<string> {
  try {
    await fn()
    return 'NO LANZÓ'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return re.test(msg) ? '' : `mensaje inesperado: ${msg}`
  }
}
const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)
const read = (p: string): Promise<string> => fs.readFile(p, 'utf8')

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-import-')))
const project = path.join(tmp, 'proyecto')
const downloads = path.join(tmp, 'Descargas') // FUERA del proyecto
// Fixture aparte para el bloque 6: ahí la CAJA de las carpetas es el dato bajo
// prueba, así que no puede compartir árbol con el resto.
const tmpCaja = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-caja-')))

try {
  await fs.mkdir(path.join(project, 'destino'), { recursive: true })
  await fs.mkdir(path.join(project, 'origen'), { recursive: true })
  await fs.mkdir(downloads)
  await fs.writeFile(path.join(downloads, 'a.txt'), 'AAA')
  await fs.writeFile(path.join(downloads, 'b.pdf'), 'BBB')
  await fs.mkdir(path.join(downloads, 'sub'))
  await fs.writeFile(path.join(downloads, 'sub', 'c.txt'), 'CCC')

  const svc = new FileService({ projectRoot: project, escritorio, log: () => {} })
  const A = path.join(downloads, 'a.txt')
  const B = path.join(downloads, 'b.pdf')

  hr('1. De FUERA del proyecto -> COPIA (el original no se toca)')

  let res = await svc.importFromHost([A, B], 'destino', false)
  check(
    '1a',
    JSON.stringify(res) === JSON.stringify({ imported: ['destino/a.txt', 'destino/b.pdf'], conflicts: [] }),
    `dos archivos a una subcarpeta -> ${JSON.stringify(res.imported)}`
  )
  check('1b', (await read(path.join(project, 'destino', 'a.txt'))) === 'AAA', 'el contenido llega íntegro')
  check('1c', await exists(A), 'el original en Descargas SIGUE existiendo (fue una copia)')

  res = await svc.importFromHost([path.join(downloads, 'sub')], '', false)
  check(
    '1d',
    JSON.stringify(res.imported) === JSON.stringify(['sub']) &&
      (await read(path.join(project, 'sub', 'c.txt'))) === 'CCC',
    'una carpeta entera se copia recursivamente a la raíz'
  )

  hr('2. De DENTRO del proyecto -> MUEVE (es reordenar el árbol)')

  await fs.writeFile(path.join(project, 'origen', 'movible.txt'), 'MOV')
  const movible = path.join(project, 'origen', 'movible.txt')
  res = await svc.importFromHost([movible], 'destino', false)
  check(
    '2a',
    JSON.stringify(res.imported) === JSON.stringify(['destino/movible.txt']),
    `ruta resultante -> ${JSON.stringify(res.imported)}`
  )
  check('2b', !(await exists(movible)), 'el original DESAPARECE de su carpeta (fue un movimiento)')
  check(
    '2c',
    (await read(path.join(project, 'destino', 'movible.txt'))) === 'MOV',
    'y aparece intacto en el destino'
  )

  // Una CARPETA de dentro también se mueve, con su contenido.
  await fs.mkdir(path.join(project, 'origen', 'carpeta'))
  await fs.writeFile(path.join(project, 'origen', 'carpeta', 'x.txt'), 'X')
  res = await svc.importFromHost([path.join(project, 'origen', 'carpeta')], 'destino', false)
  check(
    '2d',
    !(await exists(path.join(project, 'origen', 'carpeta'))) &&
      (await read(path.join(project, 'destino', 'carpeta', 'x.txt'))) === 'X',
    'una carpeta de dentro se mueve con su contenido'
  )

  hr('3. Colisiones: todo-o-nada, y sobrescritura solo si se confirma')

  await fs.writeFile(A, 'AAA-v2') // el de Descargas cambia
  res = await svc.importFromHost([A, B], 'destino', false)
  check(
    '3a',
    res.imported.length === 0 && JSON.stringify(res.conflicts) === JSON.stringify(['a.txt', 'b.pdf']),
    `conflicto -> no trae NADA y los reporta: ${JSON.stringify(res.conflicts)}`
  )
  check('3b', (await read(path.join(project, 'destino', 'a.txt'))) === 'AAA', 'el destino queda intacto')

  res = await svc.importFromHost([A, B], 'destino', true)
  check(
    '3c',
    res.conflicts.length === 0 && (await read(path.join(project, 'destino', 'a.txt'))) === 'AAA-v2',
    'con overwrite sí reemplaza'
  )

  // Y una colisión al MOVER también respeta overwrite (rename no pisa en Windows).
  await fs.writeFile(path.join(project, 'origen', 'a.txt'), 'DESDE-DENTRO')
  res = await svc.importFromHost([path.join(project, 'origen', 'a.txt')], 'destino', true)
  check(
    '3d',
    (await read(path.join(project, 'destino', 'a.txt'))) === 'DESDE-DENTRO' &&
      !(await exists(path.join(project, 'origen', 'a.txt'))),
    'mover con overwrite pisa el destino y vacía el origen'
  )

  hr('4. Guardas')

  res = await svc.importFromHost([path.join(project, 'sub', 'c.txt')], 'sub', false)
  check(
    '4a',
    res.imported.length === 0 && res.conflicts.length === 0,
    'soltar algo en su PROPIA carpeta es un no-op silencioso'
  )

  check(
    '4b',
    (await rejects(() => svc.importFromHost([path.join(project, 'sub')], 'sub', false), /dentro de sí misma/)) === '',
    'una carpeta dentro de sí misma se rechaza (crearía un ciclo)'
  )
  check(
    '4c',
    (await rejects(() => svc.importFromHost([A], '../Descargas', false), /path traversal/)) === '',
    'un destino fuera del proyecto se bloquea'
  )
  // La raíz cae en la MISMA guarda de ciclo: todo destino vive dentro de ella, así
  // que soltarla en cualquier sitio es meterla en sí misma.
  check(
    '4d',
    (await rejects(() => svc.importFromHost([project], '', false), /dentro de sí misma/)) === '',
    'la raíz del proyecto no se puede soltar dentro del proyecto'
  )
  check(
    '4e',
    (await rejects(() => svc.importFromHost([path.join(downloads, 'no.txt')], '', false), /No se pudo leer "no\.txt"/)) === '',
    'un origen inexistente da un error legible y no deja nada a medias'
  )

  hr('5. fileUrl: la URL file:// que alimenta el DownloadURL del arrastre')

  const urlDest = await svc.fileUrl('destino/a.txt')
  check('5a', urlDest.startsWith('file:///'), `un archivo devuelve su URL file:// -> ${urlDest}`)
  check(
    '5b',
    decodeURIComponent(urlDest).endsWith('destino/a.txt'),
    'la URL apunta al archivo correcto (y va porcentaje-codificada)'
  )
  check('5c', (await svc.fileUrl('destino')) === '', 'una CARPETA devuelve "" (no se puede arrastrar fuera)')
  check('5d', (await svc.fileUrl('no-existe.txt')) === '', 'un archivo inexistente devuelve ""')
  check(
    '5e',
    (await svc.fileUrl('../Descargas/a.txt')) === '',
    'anti-traversal: no se puede pedir la URL de algo fuera del proyecto'
  )

  // Espacios y acentos: el arrastre se rompería con una URL mal formada.
  await fs.writeFile(path.join(project, 'destino', 'con espacio y ñ.txt'), 'X')
  const urlRaro = await svc.fileUrl('destino/con espacio y ñ.txt')
  check(
    '5f',
    urlRaro.includes('%20') && !urlRaro.includes(' ') && decodeURIComponent(urlRaro).endsWith('con espacio y ñ.txt'),
    `espacios y acentos se codifican -> ${urlRaro}`
  )

  hr('6. La CAJA no decide mover-vs-copiar')

  // NTFS y APFS (el formato de fábrica de cualquier Mac) NO distinguen mayúsculas.
  // El Finder y el Explorador pueden entregar por arrastre `…/documents/app/x` para
  // un proyecto guardado como `…/Documents/App`, y con comparación SENSIBLE
  // `isInside` decía "fuera": `importFromHost` elegía COPIAR en vez de mover y la
  // guarda de "dentro de sí misma" se saltaba (un `fs.cp` recursivo copiando una
  // carpeta dentro de sí misma). Nada fijaba esto: volver a la versión sensible no
  // ponía ningún test en rojo.

  // (a) La regla PURA, con la plataforma por parámetro: fija las TRES desde aquí,
  // incluida `'otra'` (Linux), que no se puede ejercitar con el disco de esta
  // máquina. `path.join` construye con el separador nativo, así que lo único que
  // varía entre los casos es la plataforma.
  const outerCaja = path.join('base', 'App')
  const innerCaja = path.join('base', 'app', 'x.txt')
  check('6a', comparablePath('App', 'windows') === 'app', 'Windows compara en minúsculas')
  check('6b', comparablePath('App', 'mac') === 'app', 'macOS (APFS) también')
  check('6c', comparablePath('App', 'otra') === 'App', "Linux ('otra') NO: ahí la caja sí distingue")
  check(
    '6d',
    samePath(path.join('base', 'App'), path.join('base', 'app'), 'windows') &&
      samePath(path.join('base', 'App'), path.join('base', 'app'), 'mac') &&
      !samePath(path.join('base', 'App'), path.join('base', 'app'), 'otra'),
    'samePath: iguales en Windows y Mac, distintas en Linux'
  )
  check(
    '6e',
    isInside(innerCaja, outerCaja, 'windows') &&
      isInside(innerCaja, outerCaja, 'mac') &&
      !isInside(innerCaja, outerCaja, 'otra'),
    'isInside: "dentro" en Windows y Mac, "fuera" en Linux'
  )
  check(
    '6f',
    !isInside(path.join('base', 'App2', 'x'), outerCaja, 'windows'),
    'y el vecino de nombre parecido (`App2`) sigue SIN colarse: el separador está en el prefijo'
  )

  // (b) La misma regla contra el DISCO real. Solo donde el sistema de archivos no
  // distingue la caja de fábrica; en Linux el escenario no existe (dos carpetas que
  // solo difieren en la caja son dos carpetas distintas, y eso ya lo fija (6c-6e)).
  if (esWindows() || esMac()) {
    const proyectoCaja = path.join(tmpCaja, 'Proyecto')
    await fs.mkdir(path.join(proyectoCaja, 'Origen', 'carpeta'), { recursive: true })
    await fs.mkdir(path.join(proyectoCaja, 'Destino'), { recursive: true })
    await fs.writeFile(path.join(proyectoCaja, 'Origen', 'a.txt'), 'CAJA')
    const svcCaja = new FileService({ projectRoot: proyectoCaja, escritorio, log: () => {} })

    // El origen llega con la caja CAMBIADA, como lo entrega el Finder.
    const origenOtraCaja = path.join(tmpCaja, 'proyecto', 'origen', 'a.txt')
    const resCaja = await svcCaja.importFromHost([origenOtraCaja], 'Destino', false)
    check(
      '6g',
      JSON.stringify(resCaja.imported) === JSON.stringify(['Destino/a.txt']),
      `un origen de dentro escrito en otra caja se importa -> ${JSON.stringify(resCaja.imported)}`
    )
    check(
      '6h',
      !(await exists(path.join(proyectoCaja, 'Origen', 'a.txt'))),
      'y el original DESAPARECE: fue MOVER, no copiar (con comparación sensible se copiaba)'
    )
    check(
      '6i',
      (await rejects(
        () => svcCaja.importFromHost([path.join(tmpCaja, 'proyecto', 'origen')], 'Origen/carpeta', false),
        /dentro de sí misma/
      )) === '',
      'y la guarda de ciclo reconoce la carpeta aunque venga con otra caja'
    )
  } else {
    // No se finge: se dice. La rama de disco no aplica en este sistema y las tres
    // plataformas ya quedan fijadas por (6a)-(6f), que son puras.
    console.log(
      'NOTA  (6g-6i) sin ejecutar: esta máquina no es Windows ni macOS, y el escenario ' +
        '(dos rutas que solo difieren en la caja apuntando al MISMO sitio) no existe aquí. ' +
        'La regla queda fijada para las tres plataformas en (6a)-(6f).'
    )
  }

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(tmpCaja, { recursive: true, force: true })
}
