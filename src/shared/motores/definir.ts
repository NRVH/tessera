// =============================================================================
// `definirMotor`: de lo que un motor DECLARA (reglas de destino con sus mensajes, carpetas) a su
// descriptor, con lo derivado calculado: `validarDestino`, `tieneSinonimos`, `forma` y `deArchivo`.
// Un obligatorio sin su mensaje (o al revés) lanza al cargar el módulo.
// Neutral y ES2020; solo `import type`.
// Decisiones: docs/decisiones/bd/registro-motores-descriptor.md
// =============================================================================

import type { DbMotor } from '../db-ipc.ts'
import type {
  CampoConexion,
  CampoForma,
  CampoValidable,
  CapacidadesConexion,
  ConexionDeclarada,
  DeclaracionMotor,
  DescriptorMotor,
  DescriptorSql,
  DestinoValidable
} from './tipos.ts'
import { nunca } from '../nunca.ts'

/** Los campos del destino que decide el motor (los de `DestinoValidable`). */
const CAMPOS_VALIDABLES: readonly CampoValidable[] = ['database', 'sid']

function esValidable(c: CampoConexion): c is CampoValidable {
  return (CAMPOS_VALIDABLES as readonly string[]).indexOf(c) >= 0
}

/**
 * El tipo JSON que exige cada campo de la FORMA en disco (ver `CampoForma` en tipos.ts).
 * Aquí y no en tipos.ts, que solo lleva tipos. `tdb` lleva su copia (`motores.cjs`,
 * `TIPO_CAMPO_FORMA`), cruzada por `test-motores-tdb`.
 */
export const TIPO_CAMPO_FORMA: Readonly<Record<CampoForma, 'string' | 'number'>> = {
  host: 'string',
  port: 'number',
  archivo: 'string'
}

function esDeForma(c: CampoConexion): c is CampoForma {
  return Object.prototype.hasOwnProperty.call(TIPO_CAMPO_FORMA, c)
}

/** La regla del destino que se sigue de los datos declarados. */
function validarSegun(c: ConexionDeclarada, v: DestinoValidable): string | null {
  for (const k of c.obligatorios) {
    // `definirMotor` ya comprobó que cada obligatorio validable trae su mensaje.
    if (esValidable(k) && !v[k]) return c.faltaDestino[k] as string
  }
  for (const g of c.excluyentes) {
    const conValor = g.campos.filter((k) => !!v[k]).length
    if (g.alMenosUno && conValor === 0) return g.siNinguno
    if (conValor > 1) return g.siVarios
  }
  return null
}

/**
 * El descriptor de un motor a partir de lo que declara: `validarDestino` y
 * `tieneSinonimos` DERIVADOS. Lanza si un obligatorio validable no trae
 * su mensaje en `faltaDestino`, o si trae uno de un campo que no es obligatorio.
 */
export function definirMotor<M extends DbMotor>(d: DeclaracionMotor<M>): DescriptorMotor<M> {
  const { faltaDestino, ...conexion } = d.conexion
  for (const k of CAMPOS_VALIDABLES) {
    const obligatorio = conexion.obligatorios.indexOf(k) >= 0
    const conMensaje = faltaDestino[k] !== undefined
    if (obligatorio && !conMensaje) {
      throw new Error(`Motor ${d.id}: el obligatorio «${k}» no trae su mensaje en faltaDestino.`)
    }
    if (!obligatorio && conMensaje) {
      throw new Error(`Motor ${d.id}: faltaDestino trae «${k}», que no es obligatorio.`)
    }
  }
  const forma = conexion.obligatorios.filter(esDeForma)
  // Un motor sin forma sería uno cuya entrada del registro esta versión «sabe usar» sin
  // saber a dónde conecta: lanza al cargar, como un obligatorio sin su mensaje.
  if (forma.length === 0) throw new Error(`Motor ${d.id}: ningún obligatorio dice a dónde se conecta (host, port o archivo).`)
  // Un campo es obligatorio U opcional, no las dos cosas; y el dominio solo tiene
  // sentido con la autenticación que lo pide (`pideDominio`). Lanza al cargar, como arriba.
  for (const k of conexion.opcionales) {
    if (conexion.obligatorios.indexOf(k) >= 0) throw new Error(`Motor ${d.id}: «${k}» no puede ser obligatorio y opcional a la vez.`)
  }
  if (conexion.opcionales.indexOf('dominio') >= 0 && conexion.opcionales.indexOf('autenticacion') < 0) {
    throw new Error(`Motor ${d.id}: «dominio» sin «autenticacion» en los opcionales.`)
  }
  const conexionDerivada: CapacidadesConexion = {
    ...conexion,
    forma,
    deArchivo: conexion.obligatorios.indexOf('archivo') >= 0,
    validarDestino: (v: DestinoValidable) => validarSegun(d.conexion, v)
  }
  // El descriptor es una unión por familia: solo la SQL tiene catálogo del
  // que derivar. El tipo condicional no se estrecha dentro de una función genérica, así que
  // se trabaja sobre la unión y se devuelve con el tipo del motor, que es el mismo valor.
  const decl = d as DeclaracionMotor
  switch (decl.familia) {
    case 'sql':
      return {
        ...decl,
        conexion: conexionDerivada,
        catalogo: { ...decl.catalogo, tieneSinonimos: decl.catalogo.carpetas.indexOf('sinonimo') >= 0 }
      } as DescriptorSql as DescriptorMotor<M>
    case 'documentos':
    case 'claves':
      return { ...decl, conexion: conexionDerivada } as DescriptorMotor as DescriptorMotor<M>
    default:
      return nunca(decl, 'definirMotor')
  }
}
