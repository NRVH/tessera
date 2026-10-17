// =============================================================================
// Lo que el formulario de conexión dice fuera del destino: la casilla «Solo lectura para
// los agentes» con su ayuda por motor, y las opciones y la ayuda del selector de entorno.
// Escrito como datos para que `test-campos-conexion.mts` fije lo que promete cada frase.
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import { ENTORNOS, esEntorno } from '../../../../shared/db-ipc.ts'
import { nombreEntorno } from './textosEntorno.ts'
import { nunca } from '../../../../shared/nunca.ts'
import { candadoSoloLecturaDe, descriptor } from '../../../../shared/motores/index.ts'
import type { DbEntorno, DbMotor } from '../../../../shared/db-ipc.ts'
import type { DescriptorMotor } from '../../../../shared/motores/index.ts'
import { txConexionCampos } from './textosConexionCampos.ts'

/** La etiqueta de la casilla: limita a los agentes, no al usuario. */
export const etiquetaSoloLectura = (): string => txConexionCampos().etiquetaSoloLectura

/** El `title` de la marca «RO» (árbol, barras de las consolas): informa de la casilla, que no limita al usuario. */
export const tituloSoloLecturaAgentes = (): string => txConexionCampos().tituloSoloLecturaAgentes

/**
 * La ayuda bajo «Solo lectura para los agentes»: a quién limita y, por motor, cómo lo
 * cierra `tdb` y cuál es la garantía de verdad. Mira primero el CANDADO: si lo impone
 * Tessera y no el servidor, no promete lo del servidor.
 */
export function ayudaSoloLectura(motor: DbMotor): string {
  const t = txConexionCampos()
  const d = descriptor(motor)
  const candado = candadoSoloLecturaDe(d)
  switch (candado) {
    case 'clasificadorYEnvoltorio':
      return t.ayudaQuien + t.ayudaClasificador
    case 'listaBlanca':
      // Sin transacción que envuelva: `tdb` deja pasar solo las operaciones de lectura.
      return t.ayudaQuien + t.ayudaListaBlanca(garantiaSoloLectura(d))
    case 'transaccionSoloLectura':
    case 'envoltorioRollback':
    case 'autorizador':
      break
    default:
      return nunca(candado, 'ayudaSoloLectura')
  }
  const c = d.conexion.credenciales
  switch (c) {
    case 'usuarioClave':
      return t.ayudaQuien + t.ayudaUsuarioClave
    case 'ninguna':
      // Sin servidor que reparta el archivo, una transacción abierta lo bloquea para las demás aplicaciones
      // (en WAL solo si escribe: de ahí el «pueden», como en `TITULO_TX_ARCHIVO`).
      return t.ayudaQuien + t.ayudaArchivo
    default:
      return nunca(c, 'ayudaSoloLectura')
  }
}

/** El usuario de solo lectura que garantiza de verdad el candado 'listaBlanca', por FAMILIA. */
function garantiaSoloLectura(d: DescriptorMotor): string {
  const t = txConexionCampos()
  switch (d.familia) {
    case 'documentos':
      return t.garantiaDocumentos
    case 'claves':
      return t.garantiaClaves
    case 'sql':
      return t.garantiaSql
    default:
      return nunca(d, 'garantiaSoloLectura')
  }
}

/** Una opción del selector «Entorno». `valor` null = sin entorno. */
export interface OpcionEntorno {
  valor: DbEntorno | null
  etiqueta: string
}

/**
 * Las opciones en el orden en que se ofrecen: «Sin entorno» primero y luego los de
 * `ENTORNOS`, de menos a más peligro, con las de `nombreEntorno` (las de la marca).
 */
export function opcionesEntorno(): readonly OpcionEntorno[] {
  return [
    { valor: null, etiqueta: txConexionCampos().sinEntorno },
    ...ENTORNOS.map((e) => ({ valor: e, etiqueta: nombreEntorno(e) }))
  ]
}

/** El `value` de un radio del selector: el entorno, o '' para «Sin entorno» (un radio no admite null). */
export function valorRadioEntorno(entorno: DbEntorno | null): string {
  return entorno ?? ''
}

/** Lo contrario: lo que no sea un entorno válido (el '' incluido) es «sin entorno». */
export function entornoDeRadio(valor: string): DbEntorno | null {
  return esEntorno(valor) ? valor : null
}

/** La ayuda bajo el selector: qué CAMBIA con lo elegido. No depende de la casilla de los agentes. */
export function ayudaEntorno(entorno: DbEntorno | null): string {
  const t = txConexionCampos()
  switch (entorno) {
    case null:
      return t.ayudaEntornoNinguno
    case 'desarrollo':
      return t.ayudaEntornoDesarrollo
    case 'pruebas':
      return t.ayudaEntornoPruebas
    case 'produccion':
      return t.ayudaEntornoProduccion
  }
}
