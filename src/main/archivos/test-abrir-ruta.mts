#!/usr/bin/env node
// =============================================================================
// Prueba pura de clasificación y saneado de errores de `abrirRuta`
// (npm run test:abrir-ruta).
// Cubre `no-existe`, `sin-asociacion` y `otro` sustituyendo rutas absolutas en
// Windows, macOS y Linux sin tocar el disco ni Electron.
// =============================================================================

import {
  clasificarErrorEscritorio,
  clasificarErrorStat,
  reemplazarRutaPorNombre
} from './abrirRutaError.ts'

function hr(titulo: string): void {
  console.log('\n' + '='.repeat(64) + '\n' + titulo)
}

let total = 0
let correctas = 0

function check(nombre: string, ok: boolean, detalle = ''): void {
  total++
  if (ok) correctas++
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${nombre}${detalle ? ` -> ${detalle}` : ''}`)
}

hr('Errores de stat: ENOENT/ENOTDIR vs otros')
{
  const raizWindows = 'C:\\Proyectos\\demo'
  const absolutaWindows = 'C:\\Proyectos\\demo\\docs\\acta.docx'
  const errNoExiste = Object.assign(new Error(`ENOENT: no such file or directory, stat '${absolutaWindows}'`), { code: 'ENOENT' })
  const resNoExiste = clasificarErrorStat(errNoExiste, absolutaWindows, 'acta.docx', raizWindows, 'windows')
  check('ENOENT clasifica como no-existe sin detalle', resNoExiste.ok === false && resNoExiste.motivo === 'no-existe' && !('detalle' in resNoExiste), JSON.stringify(resNoExiste))

  const errPermiso = Object.assign(new Error(`EACCES: permission denied, stat '${absolutaWindows}'`), { code: 'EACCES' })
  const resPermiso = clasificarErrorStat(errPermiso, absolutaWindows, 'acta.docx', raizWindows, 'windows')
  check(
    'EACCES clasifica como otro sin ruta absoluta',
    resPermiso.ok === false &&
      resPermiso.motivo === 'otro' &&
      resPermiso.detalle.includes('acta.docx') &&
      !resPermiso.detalle.includes('C:\\Proyectos'),
    JSON.stringify(resPermiso)
  )
}

hr('Errores de escritorio: éxito, sin-asociacion, no-existe y saneado de ruta')
{
  const ok = clasificarErrorEscritorio('', '/Users/demo/repo/acta.docx', 'acta.docx', '/Users/demo/repo', 'mac')
  check('cadena vacía devuelve ok: true', ok.ok === true, JSON.stringify(ok))

  for (const mensaje of [
    'No application found to open URL',
    'No default application is associated with this file',
    'No file association for extension',
    'No application to open the file',
    'No method available for opening file'
  ]) {
    const res = clasificarErrorEscritorio(mensaje, '/home/demo/repo/acta.docx', 'acta.docx', '/home/demo/repo', 'linux')
    check(`sin-asociacion (${mensaje})`, res.ok === false && res.motivo === 'sin-asociacion', JSON.stringify(res))
  }

  const resEnoentTexto = clasificarErrorEscritorio('ENOENT: no such file or directory', '/home/demo/repo/acta.docx', 'acta.docx', '/home/demo/repo', 'linux')
  check('ENOENT devuelto por escritorio clasifica como no-existe', resEnoentTexto.ok === false && resEnoentTexto.motivo === 'no-existe', JSON.stringify(resEnoentTexto))

  const resOtro = clasificarErrorEscritorio(
    'Fallo al abrir c:\\usuarios\\demo\\repo\\acta.docx dentro de c:\\usuarios\\demo\\repo',
    'C:\\Usuarios\\Demo\\repo\\acta.docx',
    'acta.docx',
    'C:\\Usuarios\\Demo\\repo',
    'windows'
  )
  check(
    'otro reemplaza rutas en Windows sin importar mayúsculas',
    resOtro.ok === false &&
      resOtro.motivo === 'otro' &&
      resOtro.detalle === 'Fallo al abrir acta.docx dentro de repo',
    JSON.stringify(resOtro)
  )

  const limpioUnix = reemplazarRutaPorNombre(
    'No se pudo abrir /home/alguien/proyecto/sub/acta.docx',
    '/home/alguien/proyecto/sub/acta.docx',
    'acta.docx',
    '/home/alguien/proyecto',
    'linux'
  )
  check('reemplazarRutaPorNombre en Linux', limpioUnix === 'No se pudo abrir acta.docx', limpioUnix)
}

hr(`VEREDICTO: ${correctas}/${total} PASS`)
process.exit(correctas === total ? 0 : 1)
