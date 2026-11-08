// =============================================================================
// Los documentos del perfil contra carpetas temporales: el listado con sus nombres, pedir por nombre completo
// o de archivo, la ambigüedad, y que nada fuera de las carpetas (enlaces, lo oculto, lo binario o lo grande)
// llega al agente. También la operación `ctx.docs` con el perfil de la sesión.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { MAX_BYTES_DOCUMENTO, MAX_DOCUMENTOS, sinCarpetasDocumentos } from '../../shared/documentosPerfil.ts'
import type { SesionDelPuente } from '../db/dbBridge.ts'
import { leerDocumento, listarDocumentos } from './documentosPerfil.ts'
import { atenderDocs } from './operacionDocs.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}`)
}
function hr(titulo: string): void {
  console.log(`\n--- ${titulo} ---`)
}

const raiz = mkdtempSync(join(os.tmpdir(), 'tessera-documentos-'))
const doc = join(raiz, 'Documentacion')
const otra = join(raiz, 'otra', 'Documentacion')
const secreto = join(raiz, 'secreto.md')
try {
  mkdirSync(join(doc, 'guias'), { recursive: true })
  mkdirSync(join(doc, '.oculta'))
  mkdirSync(otra, { recursive: true })
  writeFileSync(join(doc, 'contrato.md'), '# Contrato\n')
  writeFileSync(join(doc, 'guias', 'despliegue.md'), 'pasos')
  writeFileSync(join(doc, '.oculta', 'nota.md'), 'oculta')
  writeFileSync(join(doc, 'imagen.png'), 'binario')
  writeFileSync(join(doc, 'latin.txt'), Buffer.from('caf\xe9', 'latin1'))
  writeFileSync(join(doc, 'grande.md'), 'x'.repeat(MAX_BYTES_DOCUMENTO + 1))
  writeFileSync(join(otra, 'contrato.md'), 'el otro')
  writeFileSync(secreto, 'NO-SALE')
  let hayEnlaces = true
  try {
    symlinkSync(secreto, join(doc, 'enlace.md'))
  } catch {
    hayEnlaces = false
    console.log('PLATAFORMA: este usuario no puede crear enlaces simbólicos; se comprueba en Linux y macOS')
  }

  hr('listar')
  const l = await listarDocumentos([doc, join(raiz, 'no-existe')])
  const nombres = l.documentos.map((d) => d.nombre)
  check('nombra por carpeta y ruta dentro', nombres.includes('Documentacion/contrato.md') && nombres.includes('Documentacion/guias/despliegue.md'))
  check('no entra en lo oculto ni lista lo que no es texto', !nombres.some((n) => n.includes('.oculta') || n.endsWith('.png')))
  check('no lista enlaces', !nombres.includes('Documentacion/enlace.md'))
  check('los nombres son relativos a la carpeta', !nombres.some((n) => n.includes(raiz)))
  check('dice qué carpeta no está', l.noDisponibles.join() === 'no-existe')
  const dos = await listarDocumentos([doc, otra])
  check('dos carpetas con el mismo nombre se distinguen', dos.documentos.some((d) => d.nombre === 'Documentacion-2/contrato.md'))

  hr('leer')
  const porNombre = await leerDocumento([doc], 'contrato.md')
  check('basta el nombre del archivo', porNombre.estado === 'ok' && porNombre.contenido === '# Contrato\n')
  const completo = await leerDocumento([doc], 'Documentacion/guias/despliegue.md')
  check('y vale el nombre completo', completo.estado === 'ok' && completo.contenido === 'pasos')
  const citado = await leerDocumento([doc], 'E:\\Trabajo\\Equipo\\Guias\\contrato.md')
  check('una ruta de otro equipo se encuentra por su archivo', citado.estado === 'ok')
  const ambiguo = await leerDocumento([doc, otra], 'contrato.md')
  check('repetido en dos carpetas: pide cuál', ambiguo.estado === 'ambiguo' && ambiguo.candidatos.length === 2)
  check('no sale de las carpetas con ..', (await leerDocumento([doc], '../secreto.md')).estado === 'no-existe')
  check('lo grande no se entrega', (await leerDocumento([doc], 'grande.md')).estado === 'grande')
  check('lo que no es UTF-8 no se entrega', (await leerDocumento([doc], 'latin.txt')).estado === 'no-texto')
  writeFileSync(join(doc, 'powershell.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('guía', 'utf16le')]))
  const utf16 = await leerDocumento([doc], 'powershell.md')
  check('UTF-16 con su marca sí se entrega', utf16.estado === 'ok' && utf16.contenido.includes('guía'))
  if (hayEnlaces) check('un enlace no se entrega', (await leerDocumento([doc], 'enlace.md')).estado === 'no-existe')

  hr('tope de documentos')
  const llena = join(raiz, 'llena')
  mkdirSync(llena)
  for (let i = 0; i < MAX_DOCUMENTOS; i++) writeFileSync(join(llena, `d${String(i).padStart(3, '0')}.md`), 'x')
  writeFileSync(join(llena, 'zz.png'), 'binario')
  check('justo en el tope y sin más documentos: no se dice que se cortó', (await listarDocumentos([llena])).truncado === false)
  writeFileSync(join(llena, 'zz.md'), 'x')
  check('con uno más: sí se cortó', (await listarDocumentos([llena])).truncado === true)

  hr('copia de configuración')
  const conCarpetas = { id: 'p', documentos: ['C:\\cualquiera'] }
  check('la copia no lleva las carpetas de documentos', !('documentos' in sinCarpetasDocumentos(conCarpetas)) && conCarpetas.documentos.length === 1)

  hr('operación ctx.docs')
  const sesion = { profileId: 'p1' } as SesionDelPuente
  const deps = { carpetasDe: (id: string) => (id === 'p1' ? [doc] : id === 'vacio' ? [] : null) }
  const lista = await atenderDocs(deps, {}, sesion)
  check('sin nombre, la lista', lista.ok === true && Array.isArray(lista.documentos))
  const uno = await atenderDocs(deps, { nombre: 'contrato.md' }, sesion)
  check('con nombre, el contenido', uno.ok === true && uno.contenido === '# Contrato\n')
  check('perfil sin carpetas', (await atenderDocs(deps, {}, { profileId: 'vacio' } as SesionDelPuente)).rechazo === 'sin-documentos')
  check('perfil que ya no existe', (await atenderDocs(deps, {}, { profileId: 'otro' } as SesionDelPuente)).rechazo === 'sin-perfil')
  check('un nombre que no es texto se rechaza', (await atenderDocs(deps, { nombre: 42 }, sesion)).rechazo === 'peticion')
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
