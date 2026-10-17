#!/usr/bin/env node
// =============================================================================
// Prueba de los canales de archivos por proyecto (npm run test:raiz-anclada): toda petición con
// rutas dice su contenedora y se atiende en la de SU proyecto, aunque el ancla ya esté en otro; la
// de un proyecto que nunca se ancló se rechaza sin tocar el disco. Cubre que NINGÚN canal con rutas
// se registre sin pasar por `paraRaiz`. Fixture desechable en os.tmpdir().
// =============================================================================

import { register } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron.ts'

// Reintento ".ts" para los imports extensionless de producción; `electron` no debe cargarse.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('importó electron desde ' + ctx.parentURL)
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
const { registrarIpcArchivos } = await import('./ipc.ts')
const { FILE_CHANNELS } = await import('../../shared/files-ipc.ts')

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

type Handler = (e: unknown, req: unknown) => unknown
/** Llama al handler y devuelve el mensaje con que falló, o '' si no falló. */
async function fallo(h: Handler, req: unknown): Promise<string> {
  try {
    await h({ sender: null }, req)
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-raiz-')))
const proyA = path.join(tmp, 'a')
const proyB = path.join(tmp, 'b')
mkdirSync(proyA)
mkdirSync(proyB)
writeFileSync(path.join(proyA, 'README.md'), 'de a\n')
writeFileSync(path.join(proyB, 'README.md'), 'de b\n')

const svc = new FileService({ projectRoot: proyA, escritorio, log: () => {} })
const handlers = new Map<string, Handler>()
const ipc = { handle: (canal: string, fn: Handler) => void handlers.set(canal, fn) }
const logOriginal = console.log
console.log = () => {}
registrarIpcArchivos({ ipc: ipc as never, files: svc })
console.log = logOriginal

const desconocido = /no está abierto|isn.t open/i
try {
  hr('(1) Todo canal con rutas pasa por la vista de su proyecto')
  // Los que no nombran rutas de un proyecto: la raíz neutra y los buffers sin título.
  const sinRutas = new Set<string>([FILE_CHANNELS.GET_ROOT, FILE_CHANNELS.SAVE_UNTITLED, FILE_CHANNELS.FORGET_UNTITLED])
  const conRutas = Object.values(FILE_CHANNELS).filter((c) => handlers.has(c) && !sinRutas.has(c))
  const sinGuarda: string[] = []
  for (const canal of conRutas) {
    const msg = await fallo(handlers.get(canal)!, { path: 'README.md', paths: ['README.md'], dir: '', name: 'x', srcs: [], destDir: '' })
    if (!desconocido.test(msg)) sinGuarda.push(`${canal}: «${msg}»`)
  }
  check('1a', conRutas.length >= 18 && sinGuarda.length === 0, `${conRutas.length} canales; sin proyecto aceptados: ${sinGuarda.join(' | ') || 'ninguno'}`)

  hr('(2) Con el ancla ya en otro proyecto, cada petición va al suyo')
  svc.setProjectRoot(proyB)
  const escribir = handlers.get(FILE_CHANNELS.WRITE_FILE)!
  const deA = await fallo(escribir, { raiz: proyA, path: 'README.md', content: 'guardado en a\n' })
  check(
    '2a',
    deA === '' && readFileSync(path.join(proyA, 'README.md'), 'utf8') === 'guardado en a\n' && readFileSync(path.join(proyB, 'README.md'), 'utf8') === 'de b\n',
    'el guardado del proyecto anterior va a él, y b queda intacto'
  )
  const deB = await fallo(escribir, { raiz: proyB, path: 'README.md', content: 'nuevo de b\n' })
  check('2b', deB === '' && readFileSync(path.join(proyB, 'README.md'), 'utf8') === 'nuevo de b\n', 'el del anclado, al anclado')
  const leido = (await handlers.get(FILE_CHANNELS.READ_FILE)!({}, { raiz: proyA, path: 'README.md' })) as { content: string }
  const listado = (await handlers.get(FILE_CHANNELS.LIST_DIR)!({}, { raiz: proyA, path: '' })) as Array<{ name: string }>
  check('2c', leido.content === 'guardado en a\n' && listado.some((e) => e.name === 'README.md'), 'leer y listar el anterior dan lo suyo')

  hr('(3) Sin contenedora, vacía o de un proyecto nunca abierto: rechazo y nada en disco')
  const leer = handlers.get(FILE_CHANNELS.READ_FILE)!
  const sinRaiz = await fallo(leer, { path: 'README.md' })
  const vacia = await fallo(leer, { raiz: '', path: 'README.md' })
  const proyC = path.join(tmp, 'c')
  mkdirSync(proyC)
  const ajena = await fallo(escribir, { raiz: proyC, path: 'nuevo.md', content: 'x' })
  check(
    '3a',
    [sinRaiz, vacia, ajena].every((m) => desconocido.test(m)) && !existsSync(path.join(proyC, 'nuevo.md')),
    `sin=«${sinRaiz}» vacía=«${vacia}» ajena=«${ajena}»`
  )

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  svc.dispose()
  rmSync(tmp, { recursive: true, force: true })
}
