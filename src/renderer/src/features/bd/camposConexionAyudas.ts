// =============================================================================
// Lo que el formulario de conexión dice fuera del destino: la casilla «Solo lectura para
// los agentes» con su ayuda por motor, y las opciones y la ayuda del selector de entorno.
// Escrito como datos para que `test-campos-conexion.mts` fije lo que promete cada frase.
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import { ENTORNOS, NOMBRE_ENTORNO, esEntorno } from '../../../../shared/db-ipc.ts'
import { nunca } from '../../../../shared/nunca.ts'
import { candadoSoloLecturaDe, descriptor } from '../../../../shared/motores/index.ts'
import type { DbEntorno, DbMotor } from '../../../../shared/db-ipc.ts'
import type { DescriptorMotor } from '../../../../shared/motores/index.ts'

/** La etiqueta de la casilla: limita a los agentes, no al usuario. */
export const ETIQUETA_SOLO_LECTURA = 'Solo lectura para los agentes (recomendado)'

/** El `title` de la marca «RO» (árbol, barras de las consolas): informa de la casilla, que no limita al usuario. */
export const TITULO_SOLO_LECTURA_AGENTES = 'Solo lectura para los agentes: tdb no escribe en esta conexión (tú sí puedes)'

/** El principio de la ayuda de la casilla: a quién limita y a quién no. */
const AYUDA_SOLO_LECTURA_QUIEN =
  'Los agentes (Claude Code, Codex), que consultan por tdb, solo pueden leer esta conexión; tú no quedas ' +
  'limitado: desde el explorador editas, insertas, borras y confirmas como siempre. '

/**
 * La ayuda bajo «Solo lectura para los agentes»: a quién limita y, por motor, cómo lo
 * cierra `tdb` y cuál es la garantía de verdad. Mira primero el CANDADO: si lo impone
 * Tessera y no el servidor, no promete lo del servidor.
 */
export function ayudaSoloLectura(motor: DbMotor): string {
  const d = descriptor(motor)
  const candado = candadoSoloLecturaDe(d)
  switch (candado) {
    case 'clasificadorYEnvoltorio':
      return (
        AYUDA_SOLO_LECTURA_QUIEN +
        'tdb rechaza sus escrituras y deshace lo que se cuele: aquí el solo lectura lo impone Tessera; para ' +
        'garantía, un usuario con db_datareader.'
      )
    case 'listaBlanca':
      // Sin transacción que envuelva: `tdb` deja pasar solo las operaciones de lectura.
      return (
        AYUDA_SOLO_LECTURA_QUIEN +
        `tdb solo les deja pasar las operaciones de lectura: aquí el solo lectura lo impone Tessera; para garantía, ${garantiaSoloLectura(d)}.`
      )
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
      return (
        AYUDA_SOLO_LECTURA_QUIEN +
        'tdb rechaza sus escrituras y el servidor abre sus transacciones en solo lectura. La garantía de ' +
        'verdad sigue siendo darles un usuario de base de datos con permisos de lectura.'
      )
    case 'ninguna':
      return AYUDA_SOLO_LECTURA_QUIEN + 'tdb abre el archivo en solo lectura y rechaza sus escrituras.'
    default:
      return nunca(c, 'ayudaSoloLectura')
  }
}

/** El usuario de solo lectura que garantiza de verdad el candado 'listaBlanca', por FAMILIA. */
function garantiaSoloLectura(d: DescriptorMotor): string {
  switch (d.familia) {
    case 'documentos':
      return 'un usuario con el rol read'
    case 'claves':
      return 'un usuario ACL que solo pueda leer (+@read)'
    case 'sql':
      return 'un usuario con permisos de lectura'
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
 * `ENTORNOS`, de menos a más peligro, con las etiquetas de `NOMBRE_ENTORNO` (las de la marca).
 */
export const OPCIONES_ENTORNO: readonly OpcionEntorno[] = [
  { valor: null, etiqueta: 'Sin entorno' },
  ...ENTORNOS.map((e) => ({ valor: e, etiqueta: NOMBRE_ENTORNO[e] }))
]

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
  switch (entorno) {
    case null:
      return 'Sin marcas ni confirmaciones.'
    case 'desarrollo':
      return 'Marca verde en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.'
    case 'pruebas':
      return 'Marca ámbar en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.'
    case 'produccion':
      return 'Marca roja, y Tessera pide confirmación antes de cada escritura (DML, DDL, PL/SQL y COMMIT, y al enviar los cambios de la rejilla). Sus consolas nuevas arrancan en Tx Manual.'
  }
}
