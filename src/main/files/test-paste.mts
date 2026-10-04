#!/usr/bin/env node
// =============================================================================
// Prueba de `FileService.paste` (npm run test:paste): pegar nunca pisa (renombra a "x - copia.md",
// "x - copia (2).md"), nunca pregunta y es best-effort por elemento. Cubre además cortar = mover,
// cortar en la MISMA carpeta = no-op, ciclos, anti-traversal, el nombre forzado del pegado de
// imagen, `absPath`, `saveUntitled` y que `relFromHost` compara con el mismo criterio que
// `isInside`/`samePath` (NTFS y APFS no distinguen mayúsculas). No cubre EXDEV (haría falta una
// segunda unidad). Fixture desechable en os.tmpdir(); el escritorio es un objeto literal.
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
const { esMac, esWindows } = await import('../../shared/plataforma.ts')

/** Lo que el bloque 9 hace «elegir» en el diálogo de guardar, y con qué se le llamó. */
let respuestaGuardar: { canceled: boolean; filePath: string } = { canceled: true, filePath: '' }
const llamadasGuardar: unknown[][] = []
/** El escritorio de la prueba: nada se revela, se abre ni se arrastra; guardar responde lo fijado. */
const escritorio: EscritorioArchivos = {
  revelarEnCarpeta: () => {},
  abrirRuta: async () => '',
  imagenDesdeDataUrl: () => ({ isEmpty: () => true }) as never,
  guardarConDialogo: async (...args) => {
    llamadasGuardar.push(args)
    return respuestaGuardar
  }
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-paste-')))
const project = path.join(tmp, 'proyecto')
const downloads = path.join(tmp, 'Descargas') // FUERA del proyecto
// Fixture aparte para el bloque 9: allí la CAJA de la raíz es el dato bajo prueba.
const tmpCaja = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-paste-caja-')))

try {
  await fs.mkdir(path.join(project, 'destino'), { recursive: true })
  await fs.mkdir(path.join(project, 'origen', 'sub'), { recursive: true })
  await fs.mkdir(downloads)
  await fs.writeFile(path.join(project, 'origen', 'informe.md'), 'INFORME')
  await fs.writeFile(path.join(project, 'origen', 'sub', 'hoja.txt'), 'HOJA')
  await fs.writeFile(path.join(project, 'raiz.txt'), 'RAIZ')
  await fs.writeFile(path.join(downloads, 'externo.png'), 'PNG')
  await fs.writeFile(path.join(downloads, 'otro.txt'), 'OTRO')

  const svc = new FileService({ projectRoot: project, escritorio, log: () => {} })

  hr('1. COPIAR dentro del proyecto')

  let res = await svc.paste({ destDir: 'destino', srcs: ['origen/informe.md'], op: 'copiar' })
  check('1a', JSON.stringify(res.paths) === '["destino/informe.md"]', `copia a otra carpeta -> ${JSON.stringify(res.paths)}`)
  check('1b', (await read(path.join(project, 'destino', 'informe.md'))) === 'INFORME', 'el contenido llega íntegro')
  check('1c', await exists(path.join(project, 'origen', 'informe.md')), 'el ORIGEN sigue existiendo (fue una copia)')

  res = await svc.paste({ destDir: 'destino', srcs: ['origen/sub'], op: 'copiar' })
  check('1d', JSON.stringify(res.paths) === '["destino/sub"]', 'una CARPETA se copia recursiva')
  check('1e', (await read(path.join(project, 'destino', 'sub', 'hoja.txt'))) === 'HOJA', 'con su contenido dentro')

  hr('2. Colisión -> RENOMBRA sola (nunca pisa, nunca pregunta)')

  // Pegar en la MISMA carpeta es el caso que motiva toda la política: sin renombrado
  // automático esto sería un error "ya existe" en vez de un duplicado.
  res = await svc.paste({ destDir: 'origen', srcs: ['origen/informe.md'], op: 'copiar' })
  check('2a', JSON.stringify(res.paths) === '["origen/informe - copia.md"]', `misma carpeta -> ${JSON.stringify(res.paths)}`)
  check('2b', (await read(path.join(project, 'origen', 'informe - copia.md'))) === 'INFORME', 'la copia tiene el contenido')

  res = await svc.paste({ destDir: 'origen', srcs: ['origen/informe.md'], op: 'copiar' })
  check('2c', JSON.stringify(res.paths) === '["origen/informe - copia (2).md"]', `segunda vez -> ${JSON.stringify(res.paths)}`)

  res = await svc.paste({ destDir: 'origen', srcs: ['origen/informe.md'], op: 'copiar' })
  check('2d', JSON.stringify(res.paths) === '["origen/informe - copia (3).md"]', `tercera vez -> ${JSON.stringify(res.paths)}`)

  // La extensión se preserva: el sufijo va ANTES del punto, no al final del nombre.
  check('2e', await exists(path.join(project, 'origen', 'informe - copia.md')), 'el sufijo va antes de la extensión')

  // Un archivo SIN extensión no debe acabar con un punto suelto.
  await fs.writeFile(path.join(project, 'origen', 'LICENSE'), 'L')
  res = await svc.paste({ destDir: 'origen', srcs: ['origen/LICENSE'], op: 'copiar' })
  check('2f', JSON.stringify(res.paths) === '["origen/LICENSE - copia"]', `sin extensión -> ${JSON.stringify(res.paths)}`)

  hr('3. CORTAR = mover')

  res = await svc.paste({ destDir: 'destino', srcs: ['raiz.txt'], op: 'cortar' })
  check('3a', JSON.stringify(res.paths) === '["destino/raiz.txt"]', `mueve -> ${JSON.stringify(res.paths)}`)
  check('3b', !(await exists(path.join(project, 'raiz.txt'))), 'el ORIGEN desaparece (fue un movimiento)')
  check('3c', (await read(path.join(project, 'destino', 'raiz.txt'))) === 'RAIZ', 'con su contenido')

  // Cortar y pegar donde ya está: no-op silencioso, NO un duplicado "- copia".
  res = await svc.paste({ destDir: 'destino', srcs: ['destino/raiz.txt'], op: 'cortar' })
  check('3d', JSON.stringify(res.paths) === '["destino/raiz.txt"]', 'cortar+pegar en la MISMA carpeta es un no-op')
  check('3e', !(await exists(path.join(project, 'destino', 'raiz - copia.txt'))), 'y no deja una copia fantasma')

  hr('4. Origen EXTERNO (portapapeles del Explorador de Windows)')

  const EXT = path.join(downloads, 'externo.png')
  res = await svc.paste({ destDir: 'destino', hostPaths: [EXT], op: 'copiar' })
  check('4a', JSON.stringify(res.paths) === '["destino/externo.png"]', `copia de fuera -> ${JSON.stringify(res.paths)}`)
  check('4b', await exists(EXT), 'el original en Descargas SIGUE existiendo')

  // Varios a la vez (es el caso de copiar 3 archivos en el Explorador).
  res = await svc.paste({ destDir: 'destino', hostPaths: [EXT, path.join(downloads, 'otro.txt')], op: 'copiar' })
  check(
    '4c',
    JSON.stringify(res.paths) === '["destino/externo - copia.png","destino/otro.txt"]',
    `varios a la vez, con renombrado del que colisiona -> ${JSON.stringify(res.paths)}`
  )

  // CORTAR desde fuera SÍ mueve: es lo que el usuario pidió con Ctrl+X en el Explorador.
  const CORTADO = path.join(downloads, 'cortado.txt')
  await fs.writeFile(CORTADO, 'CORTADO')
  res = await svc.paste({ destDir: 'destino', hostPaths: [CORTADO], op: 'cortar' })
  check('4d', JSON.stringify(res.paths) === '["destino/cortado.txt"]', 'cortar de fuera trae el archivo')
  check('4e', !(await exists(CORTADO)), 'y BORRA el original de Descargas (fue un corte, no una copia)')

  hr('5. Renombrado forzado (`nombre`): el pegado de IMAGEN')

  const TMPPNG = path.join(downloads, 'terminal_clip_1700000000000.png')
  await fs.writeFile(TMPPNG, 'IMG')
  res = await svc.paste({ destDir: 'destino', hostPaths: [TMPPNG], op: 'copiar', nombre: 'imagen.png' })
  check('5a', JSON.stringify(res.paths) === '["destino/imagen.png"]', `el temporal feo llega como "imagen.png"`)

  res = await svc.paste({ destDir: 'destino', hostPaths: [TMPPNG], op: 'copiar', nombre: 'imagen.png' })
  check('5b', JSON.stringify(res.paths) === '["destino/imagen - copia.png"]', 'repetir da "imagen - copia.png"')

  check(
    '5c',
    (await rejects(
      () => svc.paste({ destDir: 'destino', hostPaths: [TMPPNG, EXT], op: 'copiar', nombre: 'x.png' }),
      /renombrar al pegar varios/i
    )) === '',
    'renombrar con VARIOS orígenes se rechaza (no habría a cuál aplicarlo)'
  )

  hr('5bis. El nombre de ORIGEN se respeta tal cual')

  // validateName es para lo que se TECLEA en un diálogo, y hace trim(). Aplicarlo al
  // basename del origen renombraba en silencio archivos perfectamente legales.
  const RARO = path.join(downloads, ' con espacio inicial.txt')
  await fs.writeFile(RARO, 'RARO')
  res = await svc.paste({ destDir: 'destino', hostPaths: [RARO], op: 'copiar' })
  check(
    '5d',
    JSON.stringify(res.paths) === '["destino/ con espacio inicial.txt"]',
    `un nombre con espacio inicial NO se recorta -> ${JSON.stringify(res.paths)}`
  )
  check('5e', await exists(path.join(project, 'destino', ' con espacio inicial.txt')), 'y en disco se llama igual')

  hr('6. Guardas: ciclos, traversal y orígenes inválidos')

  check(
    '6a',
    (await rejects(() => svc.paste({ destDir: 'origen/sub', srcs: ['origen'], op: 'copiar' }), /No se pudo pegar/i)) === '',
    'una carpeta DENTRO de sí misma se rechaza (recursaría sin fin)'
  )
  check(
    '6b',
    (await rejects(() => svc.paste({ destDir: '../Descargas', srcs: ['origen/informe.md'], op: 'copiar' }), /fuera del proyecto/i)) === '',
    'anti-traversal del destino: no se puede pegar fuera del proyecto'
  )
  check(
    '6c',
    (await rejects(() => svc.paste({ destDir: 'destino', srcs: ['no-existe.txt'], op: 'copiar' }), /No se pudo pegar/i)) === '',
    'un origen inexistente da un error legible'
  )
  check(
    '6d',
    (await rejects(() => svc.paste({ destDir: 'destino', op: 'copiar' }), /nada que pegar/i)) === '',
    'sin origen alguno se rechaza'
  )
  check(
    '6e',
    (await rejects(() => svc.paste({ destDir: 'destino/raiz.txt', srcs: ['origen/informe.md'], op: 'copiar' }), /no es una carpeta/i)) === '',
    'pegar DENTRO de un archivo se rechaza'
  )

  hr('7. Best-effort: un fallo parcial se DEVUELVE, no se lanza')

  // Lanzar un parcial perdía la lista de lo que sí entró y, en un CORTE, se saltaba
  // el vaciado del portapapeles que hace el llamador. Por eso solo se lanza si NO
  // entró nada.
  res = await svc.paste({ destDir: 'destino', hostPaths: [path.join(downloads, 'otro.txt')], op: 'copiar' })
  check('7a', res.fallidos.length === 0, 'un pegado limpio devuelve `fallidos` vacío')

  const parcial = await svc.paste({
    destDir: 'destino',
    hostPaths: [path.join(downloads, 'no-existe-jamas.txt'), path.join(downloads, 'otro.txt')],
    op: 'copiar'
  })
  check(
    '7b',
    JSON.stringify(parcial.fallidos) === '["no-existe-jamas.txt"]',
    `NO lanza: nombra solo al que falló -> ${JSON.stringify(parcial.fallidos)}`
  )
  check('7c', parcial.paths.length === 1, 'y devuelve la ruta del que SÍ entró (para revelarlo)')
  check('7d', await exists(path.join(project, 'destino', 'otro - copia.txt')), 'que está en disco')
  check(
    '7e',
    (await rejects(
      () => svc.paste({ destDir: 'destino', hostPaths: [path.join(downloads, 'ni-esto.txt')], op: 'copiar' }),
      /No se pudo pegar/i
    )) === '',
    'si NO entra nada, entonces sí lanza'
  )

  hr('8. absPath (el "Copiar ruta" del menú)')

  const abs = await svc.absPath('destino/informe.md')
  check('8a', abs === path.join(project, 'destino', 'informe.md'), `ruta absoluta del host -> ${abs}`)
  check('8b', (await svc.absPath('')) === project, 'la raíz devuelve la contenedora')
  check('8c', (await svc.absPath('../Descargas/externo.png')) === '', 'anti-traversal: fuera del proyecto devuelve ""')
  check('8d', (await svc.absPath('no-existe.txt')) !== '', 'NO exige que exista (copiar la ruta de algo borrado sigue valiendo)')

  hr('9. La CAJA de la raíz no puede dejar una ruta sin traducir (relFromHost)')

  // `relFromHost` es la INVERSA de resolveSafe y decide dos cosas visibles:
  //   - el CORTE no-op ("cortar y pegar en la misma carpeta"): si no sabe nombrar lo
  //     que ya estaba, el elemento no entra ni en `pasted` ni en `failed` y el
  //     usuario recibe «No había nada que pegar.» por una operación legítima.
  //   - `saveUntitled` dentro del proyecto: si devuelve null, la pestaña se queda
  //     «sin título» para siempre aunque el archivo ya esté en disco.
  // Preguntaba con `path.relative`, que compara RESPETANDO la caja, mientras
  // `isInside`/`samePath` ya no lo hacen: dos criterios distintos sobre "¿está dentro
  // del proyecto?" en el mismo archivo. En Windows y en macOS eso es alcanzable con
  // sólo escribir la ruta con otras mayúsculas, que es lo que entrega el SO.
  if (esWindows() || esMac()) {
    const proyectoCaja = path.join(tmpCaja, 'Proyecto')
    await fs.mkdir(path.join(proyectoCaja, 'Sub'), { recursive: true })
    await fs.writeFile(path.join(proyectoCaja, 'Sub', 'a.txt'), 'CAJA')
    const svcCaja = new FileService({ projectRoot: proyectoCaja, escritorio, log: () => {} })

    // Cortar y pegar en la MISMA carpeta, con el origen escrito en otra caja (que es
    // como lo entrega el portapapeles del SO).
    const resCorte = await svcCaja.paste({
      destDir: 'Sub',
      hostPaths: [path.join(tmpCaja, 'proyecto', 'sub', 'a.txt')],
      op: 'cortar'
    })
    check(
      '9a',
      resCorte.paths.length === 1 && resCorte.fallidos.length === 0,
      `cortar+pegar donde ya está NO lanza «No había nada que pegar.» -> ${JSON.stringify(resCorte.paths)}`
    )
    check('9b', await exists(path.join(proyectoCaja, 'Sub', 'a.txt')), 'y el archivo sigue en su sitio (fue un no-op)')

    // El segundo síntoma: guardar un "sin título" DENTRO del proyecto.
    respuestaGuardar = { canceled: false, filePath: path.join(tmpCaja, 'proyecto', 'sub', 'nota.txt') }
    const guardado = await svcCaja.saveUntitled({ id: 'u1', content: 'NOTA', suggestedName: 'nota.txt' })
    respuestaGuardar = { canceled: true, filePath: '' }
    check(
      '9c',
      guardado.canceled === false && guardado.path === 'sub/nota.txt',
      `guardar dentro del proyecto devuelve su ruta relativa (la pestaña deja de ser "sin título") -> ${JSON.stringify(guardado.path)}`
    )
    // Y el «Guardar como» va a la memoria de SU diálogo, arrancando en el proyecto: cómo se
    // recuerda la carpeta lo fija `util/test-carpeta-dialogo.mts`.
    const [dialogo, nombre, , donde] = (llamadasGuardar.at(-1) ?? []) as [string, string, unknown, { antes?: unknown[] }]
    check(
      '9d',
      dialogo === 'guardar-como' && nombre === 'nota.txt' && donde?.antes?.[0] === proyectoCaja,
      `«Guardar como» abre el diálogo 'guardar-como' con el nombre propuesto, arrancando en el proyecto -> ${JSON.stringify([dialogo, nombre, donde?.antes])}`
    )
  } else {
    // No se finge: se dice. El escenario (dos rutas que sólo difieren en la caja
    // apuntando al MISMO sitio) no existe en un sistema de archivos sensible, así
    // que aquí no hay nada que comprobar. La regla de comparación queda fijada para
    // las tres plataformas en `test-import.mts` (6a)-(6f).
    console.log(
      'NOTA  (9a-9c) sin ejecutar: esta máquina no es Windows ni macOS y su sistema de ' +
        'archivos distingue mayúsculas, así que el desfase de caja no se puede provocar.'
    )
  }

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(tmpCaja, { recursive: true, force: true })
}
