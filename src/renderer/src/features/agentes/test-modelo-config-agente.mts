// =============================================================================
// El estado del editor de configuración: cambios sin guardar, problemas y recarga. Fija que lo
// tecleado mientras se guarda no se pierde y que un archivo bloqueado no se puede guardar.
// Solo el reductor puro: el recorrido con Monaco está en `e2e/config-agente.spec.ts`.
// =============================================================================

import type { ArchivoConfigLeido, ConfigAgenteLeida } from '../../../../shared/configAgente-ipc.ts'
import { hayCambiosSinGuardar, reducirConfigAgente, sePuedeGuardar, ESTADO_INICIAL_CONFIG, type EstadoConfigAgente } from './modeloConfigAgente.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}`)
}

const leido = (tipo: 'configuracion' | 'instrucciones', contenido: string): ArchivoConfigLeido => ({
  tipo,
  nombre: tipo === 'configuracion' ? 'config.toml' : 'AGENTS.md',
  contenido,
  version: 'v1',
  hayAnterior: false,
  avisos: [],
  bloqueo: null
})
const config: ConfigAgenteLeida = {
  carpeta: 'x',
  sesionesAbiertas: 0,
  fijadas: [],
  archivos: { configuracion: leido('configuracion', 'a = 1'), instrucciones: leido('instrucciones', '') }
}
const listo = reducirConfigAgente(ESTADO_INICIAL_CONFIG, { tipo: 'cargado', config })
const archivo = (e: EstadoConfigAgente): Extract<EstadoConfigAgente, { fase: 'lista' }>['archivos']['configuracion'] => {
  if (e.fase !== 'lista') throw new Error('no está lista')
  return e.archivos.configuracion
}

check('sin config, no disponible', reducirConfigAgente(ESTADO_INICIAL_CONFIG, { tipo: 'cargado', config: null }).fase === 'no-disponible')
check('al cargar no hay cambios', !hayCambiosSinGuardar(listo) && !sePuedeGuardar(archivo(listo)))

const editado = reducirConfigAgente(listo, { tipo: 'editar', archivo: 'configuracion', texto: 'a = 2' })
check('editar marca cambios', hayCambiosSinGuardar(editado) && sePuedeGuardar(archivo(editado)))
check('el aviso de Monaco con el mismo texto no cambia el estado', reducirConfigAgente(editado, { tipo: 'editar', archivo: 'configuracion', texto: 'a = 2' }) === editado)

const conError = reducirConfigAgente(editado, { tipo: 'resultado', archivo: 'configuracion', resultado: { estado: 'sintaxis', linea: 1, columna: 1, detalle: 'x' } })
check('un error conserva el texto', archivo(conError).texto === 'a = 2' && archivo(conError).problema?.estado === 'sintaxis')
check('volver a editar quita el error', archivo(reducirConfigAgente(conError, { tipo: 'editar', archivo: 'configuracion', texto: 'a = 3' })).problema === null)

const guardado = reducirConfigAgente(editado, { tipo: 'resultado', archivo: 'configuracion', resultado: { estado: 'guardado', archivo: leido('configuracion', 'a = 2') } })
check('guardar deja sin cambios y cuenta un guardado para que el botón lo confirme', !hayCambiosSinGuardar(guardado) && archivo(guardado).exitos === archivo(editado).exitos + 1)
check('editar después no cuenta otro', archivo(reducirConfigAgente(guardado, { tipo: 'editar', archivo: 'configuracion', texto: 'a = 9' })).exitos === archivo(guardado).exitos)

const tecleando = reducirConfigAgente(editado, { tipo: 'editar', archivo: 'configuracion', texto: 'a = 2 # sigue' })
const tras = reducirConfigAgente(tecleando, { tipo: 'resultado', archivo: 'configuracion', resultado: { estado: 'guardado', archivo: leido('configuracion', 'a = 2') } })
check('lo tecleado mientras se guardaba no se pierde', archivo(tras).texto === 'a = 2 # sigue' && hayCambiosSinGuardar(tras) && archivo(tras).exitos === archivo(tecleando).exitos)

const recargado = reducirConfigAgente(conError, { tipo: 'recargado', archivo: 'configuracion', leido: leido('configuracion', 'del = "agente"') })
check('recargar sustituye el texto y limpia el problema', archivo(recargado).texto === 'del = "agente"' && archivo(recargado).problema === null && !hayCambiosSinGuardar(recargado))

check('recargar sube la revisión', archivo(recargado).revision === archivo(conError).revision + 1)
check('una edición no sube la revisión', archivo(editado).revision === archivo(listo).revision)
const anterior = reducirConfigAgente(editado, { tipo: 'anterior', archivo: 'configuracion', texto: 'previo = 1' })
check('recuperar la anterior pone el texto, sube la revisión y queda sin guardar', archivo(anterior).texto === 'previo = 1' && archivo(anterior).revision === 1 && hayCambiosSinGuardar(anterior))
check('sin versión anterior lo dice y conserva el texto', (() => {
  const a = archivo(reducirConfigAgente(editado, { tipo: 'anterior', archivo: 'configuracion', texto: null }))
  return a.problema?.estado === 'sin-anterior' && a.texto === 'a = 2'
})())

const bloqueado = reducirConfigAgente(ESTADO_INICIAL_CONFIG, { tipo: 'cargado', config: { ...config, archivos: { ...config.archivos, configuracion: { ...leido('configuracion', ''), bloqueo: 'no-regular' } } } })
check('un archivo bloqueado no se puede guardar', !sePuedeGuardar(archivo(reducirConfigAgente(bloqueado, { tipo: 'editar', archivo: 'configuracion', texto: 'x' }))))

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
