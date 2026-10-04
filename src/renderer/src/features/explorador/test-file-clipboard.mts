#!/usr/bin/env node
// =============================================================================
// Prueba del arbitraje del portapapeles de archivos del explorador
// (node src/renderer/src/features/explorador/test-file-clipboard.mts)
// Fija el contrato de `decidirFuentePegado`, incluida la caducidad de la copia
// interna cuando se copia otra cosa en el sistema.
// =============================================================================

// `fileClipboard` importa `./posixPath` sin extensión (como resuelve Vite): con `node`
// a secas se reintenta con ".ts".
import { register } from 'node:module'
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

const { decidirFuentePegado, destinoPegado } = await import('./fileClipboard.ts')
type PortapapelesInterno = Parameters<typeof decidirFuentePegado>[0] & object
import type { ClipboardProbe } from '../../../../shared/clipboard-ipc.ts'

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

const PROY = 'D:\\Proyectos\\tessera'
const OTRO = 'D:\\Proyectos\\otro'
const MARCA = 'D:\\Proyectos\\tessera\\src\\App.tsx'

const interno = (op: 'copiar' | 'cortar' = 'copiar', proyecto = PROY): PortapapelesInterno => ({
  op,
  paths: ['src/App.tsx'],
  projectHostPath: proyecto,
  marca: MARCA
})

/** Interno con VARIAS rutas: la marca es el join por saltos de línea. */
const MARCA_MULTI = [
  'D:\\Proyectos\\tessera\\src\\App.tsx',
  'D:\\Proyectos\\tessera\\src\\main.tsx'
].join('\n')
const internoMulti = (op: 'copiar' | 'cortar' = 'cortar'): PortapapelesInterno => ({
  op,
  paths: ['src/App.tsx', 'src/main.tsx'],
  projectHostPath: PROY,
  marca: MARCA_MULTI
})

const texto = (t: string): ClipboardProbe => ({ kind: 'none', count: 0, effect: 'copy', texto: t })
const ficheros = (effect: 'copy' | 'cut' = 'copy'): ClipboardProbe => ({ kind: 'files', count: 2, effect })
const imagen: ClipboardProbe = { kind: 'image', count: 1, effect: 'copy' }

hr('1. Nada que pegar')

check('1a', decidirFuentePegado(null, PROY, texto('')).kind === 'ninguno', 'portapapeles vacío')
check(
  '1b',
  decidirFuentePegado(null, PROY, texto('hola mundo')).kind === 'ninguno',
  'solo TEXTO -> nada: el ítem "Pegar" ni se pinta (¿cómo pegaría texto un explorador?)'
)

hr('2. Portapapeles INTERNO de Tessera')

let r = decidirFuentePegado(interno(), PROY, texto(MARCA))
check('2a', r.kind === 'interno', 'copiado en Tessera y su marca sigue en el portapapeles -> interno')
check(
  '2b',
  r.kind === 'interno' && r.entrada.paths.join(',') === 'src/App.tsx' && r.entrada.op === 'copiar',
  'devuelve la entrada entera (rutas + operación)'
)
check(
  '2c',
  decidirFuentePegado(interno('cortar'), PROY, texto(MARCA)).kind === 'interno',
  'cortar interno también vale'
)

hr('3. Caducidad del interno (la regla que se olvida)')

check(
  '3a',
  decidirFuentePegado(interno(), PROY, texto('otra cosa cualquiera')).kind === 'ninguno',
  'copiaste TEXTO en Windows después -> el interno CADUCA (no se pega lo viejo)'
)
check(
  '3b',
  decidirFuentePegado(interno(), PROY, texto('')).kind === 'ninguno',
  'portapapeles vaciado después -> caduca'
)
check(
  '3c',
  decidirFuentePegado(interno(), OTRO, texto(MARCA)).kind === 'ninguno',
  'pegar en OTRO proyecto -> no vale: la ruta es relativa a la raíz equivocada'
)

hr('4. El SISTEMA gana cuando trae ficheros o imagen')

r = decidirFuentePegado(null, PROY, ficheros('copy'))
check('4a', r.kind === 'externo' && r.op === 'copiar', 'ficheros copiados en el Explorador -> externo/copiar')

r = decidirFuentePegado(null, PROY, ficheros('cut'))
check('4b', r.kind === 'externo' && r.op === 'cortar', 'Ctrl+X en el Explorador -> externo/cortar')

r = decidirFuentePegado(interno(), PROY, ficheros('copy'))
check(
  '4c',
  r.kind === 'externo',
  'con interno vivo Y ficheros en el sistema gana el SISTEMA: copiar ficheros solo pudo pasar después'
)

check('4d', decidirFuentePegado(null, PROY, imagen).kind === 'imagen', 'un bitmap -> imagen')
check(
  '4e',
  decidirFuentePegado(interno(), PROY, imagen).kind === 'imagen',
  'la imagen también gana al interno, por el mismo motivo'
)

hr('5. destinoPegado — dónde cae lo pegado')

check('5a', destinoPegado('src/git', true) === 'src/git', 'sobre una CARPETA se pega DENTRO')
check('5b', destinoPegado('src/App.tsx', false) === 'src', 'sobre un ARCHIVO se pega en SU CARPETA')
check('5c', destinoPegado('LICENSE', false) === '', 'un archivo de la raíz -> raíz')
check('5d', destinoPegado('', true) === '', 'la raíz sigue siendo la raíz')

hr('6. VARIAS rutas: la marca multi-línea sigue siendo una marca')

// Con selección múltiple el interno guarda N rutas y deja las N absolutas en el
// portapapeles del sistema, unidas por saltos de línea (lo mismo que hace el
// Explorador de Windows). El arbitraje no mira `paths`, sólo la marca — así que lo
// que hay que fijar es que un texto multi-línea caduque y venza igual que uno solo.
const multi = decidirFuentePegado(internoMulti(), PROY, texto(MARCA_MULTI))
check(
  '6a',
  multi.kind === 'interno' && multi.entrada.paths.length === 2,
  'la marca multi-línea intacta -> gana el interno, con sus DOS rutas'
)
check(
  '6b',
  decidirFuentePegado(internoMulti(), PROY, texto(MARCA_MULTI.split('\n')[0])).kind === 'ninguno',
  'si en el portapapeles queda SÓLO la primera ruta, la marca ya no casa: caducó'
)
check(
  '6c',
  decidirFuentePegado(internoMulti(), PROY, ficheros('cut')).kind === 'externo',
  'unos ficheros del sistema siguen ganando a un interno de varias rutas'
)
check(
  '6d',
  decidirFuentePegado(internoMulti(), OTRO, texto(MARCA_MULTI)).kind === 'ninguno',
  'y sigue sin valer en otro proyecto'
)

// EL CASO QUE ROMPÍA EN SILENCIO: el sondeo RECORTA el texto a MAX_TEXTO_SONDEO, y
// la marca de N rutas absolutas se pasa de ahí con ~27 ficheros. Comparando la marca
// entera, el interno caducaba solo: "Pegar" desaparecía del menú y el corte pendiente
// se limpiaba, sin error. Se compara contra la marca RECORTADA.
const { MAX_TEXTO_SONDEO } = await import('../../../../shared/clipboard-ipc.ts')
const MUCHAS = Array.from({ length: 60 }, (_, i) => `D:\\Proyectos\\tessera\\src\\componentes\\Fichero${i}.tsx`)
const MARCA_LARGA = MUCHAS.join('\n')
const internoLargo: PortapapelesInterno = {
  op: 'cortar',
  paths: MUCHAS.map((_, i) => `src/componentes/Fichero${i}.tsx`),
  projectHostPath: PROY,
  marca: MARCA_LARGA
}
check('6e', MARCA_LARGA.length > MAX_TEXTO_SONDEO, `la marca de 60 ficheros SÍ se pasa del tope (${MARCA_LARGA.length} > ${MAX_TEXTO_SONDEO})`)
check(
  '6f',
  decidirFuentePegado(internoLargo, PROY, texto(MARCA_LARGA.slice(0, MAX_TEXTO_SONDEO))).kind === 'interno',
  'y con el texto RECORTADO que devuelve el sondeo, el interno sigue vigente'
)
check(
  '6g',
  decidirFuentePegado(internoLargo, PROY, texto('otra cosa')).kind === 'ninguno',
  'pero un texto distinto lo sigue caducando (el recorte no lo vuelve indetectable)'
)

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
if (failed > 0) process.exitCode = 1
