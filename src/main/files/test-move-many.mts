#!/usr/bin/env node
// =============================================================================
// Prueba de `FileService.moveMany` (npm run test:move-many): arrastrar VARIOS en el explorador es
// TODO O NADA contra las colisiones (un nombre que ya existe en el destino no mueve ninguno y
// vuelve en `conflicts`), y dos orígenes con el mismo nombre de carpetas distintas se detectan
// antes de que el segundo `rename` pise al primero. Cubre además el no-op de lo que ya vive en el
// destino, el ciclo, el destino que no es carpeta, el anti-traversal, las rutas dentro de un .jar
// y la lista vacía. Fixture desechable en os.tmpdir(); el escritorio es un objeto literal.
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
const { comparablePath } = await import('./utilidadesDisco.ts')

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
const hay = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-move-')))
const project = path.join(tmp, 'proyecto')
const enProy = (...p: string[]): string => path.join(project, ...p)

/** Rehace el fixture desde cero: cada bloque parte del mismo árbol conocido. */
async function sembrar(): Promise<void> {
  await fs.rm(project, { recursive: true, force: true })
  await fs.mkdir(enProy('origen', 'sub'), { recursive: true })
  await fs.mkdir(enProy('destino'), { recursive: true })
  await fs.mkdir(enProy('otra'), { recursive: true })
  await fs.writeFile(enProy('origen', 'a.txt'), 'A')
  await fs.writeFile(enProy('origen', 'b.txt'), 'B')
  await fs.writeFile(enProy('origen', 'sub', 'c.txt'), 'C')
  await fs.writeFile(enProy('otra', 'a.txt'), 'OTRA-A')
  await fs.writeFile(enProy('raiz.txt'), 'RAIZ')
}

try {
  await sembrar()
  const svc = new FileService({ projectRoot: project, escritorio, log: () => {} })

  // ---------------------------------------------------------------------------
  hr('1. Mover VARIOS a otra carpeta: todos llegan, y el resultado los nombra')

  {
    const res = await svc.moveMany(['origen/a.txt', 'origen/b.txt', 'origen/sub'], 'destino')
    check('1a', res.conflicts.length === 0, 'sin conflictos')
    check(
      '1b',
      res.moved.join(',') === 'destino/a.txt,destino/b.txt,destino/sub',
      `moved = ${JSON.stringify(res.moved)} (rutas RESULTANTES, no las de origen)`
    )
    check('1c', await hay(enProy('destino', 'a.txt')), 'a.txt está en el destino')
    check('1d', !(await hay(enProy('origen', 'a.txt'))), 'a.txt ya NO está en el origen')
    check(
      '1e',
      await hay(enProy('destino', 'sub', 'c.txt')),
      'una CARPETA se mueve con su contenido dentro'
    )
  }

  // ---------------------------------------------------------------------------
  hr('2. TODO O NADA: un solo nombre que choca deja el lote entero sin mover')

  {
    await sembrar()
    // 'otra/a.txt' choca con el 'destino/a.txt' que va a crear el primero... no:
    // el conflicto real es contra algo que YA existe en el destino.
    await fs.writeFile(enProy('destino', 'b.txt'), 'YA-ESTABA')
    const res = await svc.moveMany(['origen/a.txt', 'origen/b.txt', 'origen/sub'], 'destino')
    check('2a', res.moved.length === 0, 'no se movió NADA')
    check('2b', res.conflicts.join(',') === 'b.txt', `conflicts nombra al culpable: ${JSON.stringify(res.conflicts)}`)
    check('2c', await hay(enProy('origen', 'a.txt')), 'el que no chocaba sigue en su sitio (a.txt)')
    check('2d', await hay(enProy('origen', 'sub', 'c.txt')), 'y la carpeta tampoco se movió')
    check(
      '2e',
      (await fs.readFile(enProy('destino', 'b.txt'), 'utf8')) === 'YA-ESTABA',
      'el archivo del destino NO se pisó'
    )
  }

  // ---------------------------------------------------------------------------
  hr('3. Varios conflictos: se devuelven TODOS, no solo el primero')

  {
    await sembrar()
    await fs.writeFile(enProy('destino', 'a.txt'), 'YA')
    await fs.writeFile(enProy('destino', 'b.txt'), 'YA')
    const res = await svc.moveMany(['origen/a.txt', 'origen/b.txt'], 'destino')
    check('3a', res.conflicts.sort().join(',') === 'a.txt,b.txt', 'los dos nombres, para poder enseñarlos juntos')
  }

  // ---------------------------------------------------------------------------
  hr('4. Lo que YA vive en el destino se descarta: no es un error, es un no-op')

  {
    await sembrar()
    await fs.writeFile(enProy('destino', 'ya.txt'), 'YA')
    // Es el gesto real: arrastras dos filas sobre la carpeta donde una de ellas ya
    // vive. Antes esto fallaba con "ya existe" y no se movía tampoco la otra.
    const res = await svc.moveMany(['destino/ya.txt', 'origen/a.txt'], 'destino')
    check('4a', res.conflicts.length === 0, 'estar ya en el destino NO es una colisión')
    check('4b', res.moved.join(',') === 'destino/a.txt', `sólo se mueve el que venía de fuera: ${JSON.stringify(res.moved)}`)
    check('4c', (await fs.readFile(enProy('destino', 'ya.txt'), 'utf8')) === 'YA', 'el que ya estaba sigue intacto')
  }
  {
    // Y el reverso: dos ficheros distintos con el MISMO nombre, uno de ellos ya en
    // el destino. Aquí sí hay colisión de verdad, y tiene que verse como tal.
    await sembrar()
    const res = await svc.moveMany(['otra/a.txt'], 'origen')
    check('4d', res.moved.length === 0 && res.conflicts.join(',') === 'a.txt', 'colisión real contra un homónimo del destino')
    check('4e', (await fs.readFile(enProy('origen', 'a.txt'), 'utf8')) === 'A', 'y el del destino NO se pisó')
  }

  // ---------------------------------------------------------------------------
  hr('5. Dos orígenes con el MISMO nombre: se rechaza ANTES de mover nada')

  {
    await sembrar()
    const msg = await rejects(
      () => svc.moveMany(['origen/a.txt', 'otra/a.txt'], 'destino'),
      /dos elementos llamados "a\.txt"/i
    )
    check('5a', msg === '', msg || 'lanza con un mensaje que dice cuál es el nombre repetido')
    check('5b', await hay(enProy('origen', 'a.txt')), 'y no movió el primero antes de darse cuenta')
    check('5c', await hay(enProy('otra', 'a.txt')), 'ni el segundo')
    check('5d', !(await hay(enProy('destino', 'a.txt'))), 'el destino sigue limpio')
  }

  // ---------------------------------------------------------------------------
  hr('5bis. Dos nombres que sólo difieren en la CAJA: también son el mismo destino')

  {
    // NTFS y APFS conservan la caja pero no la distinguen, así que `A.txt` y `a.txt`
    // apuntan al mismo sitio: con un Set sensible a mayúsculas los dos pasaban la
    // guarda, `exists` no veía nada (el primero aún no se había movido) y el segundo
    // `rename` se comía al primero. En Linux son ficheros distintos y NO debe fallar.
    await sembrar()
    await fs.writeFile(enProy('otra', 'A.txt'), 'MAYUS')
    const msg = await rejects(
      () => svc.moveMany(['origen/a.txt', 'otra/A.txt'], 'destino'),
      /dos elementos llamados/i
    )
    const sensible = comparablePath('A.txt') === comparablePath('a.txt')
    if (sensible) {
      check('5e', msg === '', msg || 'en un FS insensible a la caja se rechaza el par a.txt/A.txt')
      check('5f', await hay(enProy('origen', 'a.txt')), 'y no se movió ninguno de los dos')
    } else {
      check('5e', msg === 'NO LANZÓ', 'en un FS sensible a la caja son ficheros distintos: se permite')
      check('5f', true, '(en esta plataforma la caja SÍ distingue)')
    }
  }

  // ---------------------------------------------------------------------------
  hr('5ter. Un origen que ya no existe se rechaza ANTES de mover nada')

  {
    // El caso real: una selección de hace unos segundos cuyo segundo elemento acaba
    // de borrar un build. Sin comprobarlo en la validación, el bucle movía el primero
    // y reventaba con un ENOENT crudo, dejando el lote a medias — el estado que el
    // todo-o-nada existe para impedir.
    await sembrar()
    const msg = await rejects(
      () => svc.moveMany(['origen/a.txt', 'origen/fantasma.txt'], 'destino'),
      /Ya no existe "fantasma\.txt"/i
    )
    check('5g', msg === '', msg || 'lanza nombrando el que faltaba')
    check('5h', await hay(enProy('origen', 'a.txt')), 'y el que sí existía NO se movió')
    check('5i', !(await hay(enProy('destino', 'a.txt'))), 'el destino sigue limpio')
  }

  // ---------------------------------------------------------------------------
  hr('6. Ciclos, destinos imposibles y anti-traversal')

  {
    await sembrar()
    check(
      '6a',
      (await rejects(() => svc.moveMany(['origen'], 'origen/sub'), /dentro de sí misma/i)) === '',
      'una carpeta dentro de un descendiente suyo'
    )
    check(
      '6b',
      (await rejects(() => svc.moveMany(['origen', 'raiz.txt'], 'origen/sub'), /dentro de sí misma/i)) === '',
      'un solo ciclo tumba el lote, aunque el resto fuera legal'
    )
    check(
      '6c',
      await hay(enProy('raiz.txt')),
      'y el que era legal no se movió (la validación va ANTES que el primer rename)'
    )
    check(
      '6d',
      (await rejects(() => svc.moveMany(['origen/a.txt'], 'destino/no-existe'), /no es una carpeta/i)) === '',
      'destino inexistente'
    )
    check(
      '6e',
      (await rejects(() => svc.moveMany(['origen/a.txt'], 'raiz.txt'), /no es una carpeta/i)) === '',
      'destino que es un archivo'
    )
    check(
      '6f',
      (await rejects(() => svc.moveMany(['origen/a.txt'], '../Descargas'), /fuera del proyecto/i)) === '',
      'destino fuera del proyecto (anti-traversal)'
    )
    check(
      '6g',
      (await rejects(() => svc.moveMany(['../secretos.txt'], 'destino'), /fuera del proyecto/i)) === '',
      'origen fuera del proyecto'
    )
    check(
      '6h',
      (await rejects(() => svc.moveMany([''], 'destino'), /Origen inválido/i)) === '',
      'origen vacío'
    )
  }

  // ---------------------------------------------------------------------------
  hr('7. Rutas dentro de un contenedor (.jar): la guarda de resolveSafe las para')

  {
    await sembrar()
    check(
      '7a',
      (await rejects(
        () => svc.moveMany(['lib/x.jar!/com/A.class'], 'destino'),
        /archivo comprimido/i
      )) === '',
      'origen virtual'
    )
    check(
      '7b',
      (await rejects(
        () => svc.moveMany(['origen/a.txt'], 'lib/x.jar!/com'),
        /archivo comprimido/i
      )) === '',
      'destino virtual'
    )
  }

  // ---------------------------------------------------------------------------
  hr('8. Casos de borde: lista vacía, todo no-op, y mover a la RAÍZ')

  {
    await sembrar()
    const vacia = await svc.moveMany([], 'destino')
    check('8a', vacia.moved.length === 0 && vacia.conflicts.length === 0, 'lista vacía: no pasa nada')
    const todoNoop = await svc.moveMany(['origen/a.txt', 'origen/b.txt'], 'origen')
    check('8b', todoNoop.moved.length === 0 && todoNoop.conflicts.length === 0, 'todos ya en el destino: tampoco')
    const aRaiz = await svc.moveMany(['origen/a.txt', 'origen/b.txt'], '')
    check('8c', aRaiz.moved.join(',') === 'a.txt,b.txt', 'a la raíz, las rutas resultantes no llevan prefijo')
    check('8d', await hay(enProy('a.txt')), 'y el archivo está en la raíz del proyecto')
  }

  // ---------------------------------------------------------------------------
  hr('9. Sin proyecto activo')

  {
    const suelto = new FileService({ escritorio, log: () => {} })
    check(
      '9a',
      (await rejects(() => suelto.moveMany(['a.txt'], 'destino'), /No hay proyecto activo/i)) === '',
      'sin raíz no se mueve nada'
    )
  }

  // ---------------------------------------------------------------------------
  const total = passed + failed
  hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : `${failed} FAIL`}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
