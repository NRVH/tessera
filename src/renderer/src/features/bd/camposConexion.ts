// =============================================================================
// camposConexion — QUÉ CAMPOS pide una conexión según su MOTOR y cuáles marcaría el main.
// Junta las reglas del descriptor compartido (`shared/motores/`) con la presentación
// (`camposConexionPresentacion.ts`) en `FormularioMotor`, que el diálogo recorre sin
// volver a preguntar por el motor. Reexporta tipos, textos y clientes de sus piezas.
// Puro: sin React ni DOM, para fijarlo bajo `node` (`test-campos-conexion.mts`).
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import { ALIAS_MAX } from '../../../../shared/db-ipc.ts'
import { limpiarDestinoBd } from '../../../../shared/destinoBd.ts'
import {
  IDS_MOTORES,
  autenticacionDe,
  descriptor,
  pideDominio,
  pideUsuarioYClave,
  porMotor,
  usaOpcional
} from '../../../../shared/motores/index.ts'
import { PRESENTACION } from './camposConexionPresentacion.ts'
import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type { CampoConexion, CampoTextoDestino } from '../../../../shared/motores/index.ts'
import type { CampoFormulario, DefCampo, FormularioMotor, ValoresConexion } from './camposConexionTipos.ts'

export type { CampoConexion } from '../../../../shared/motores/index.ts'
export type {
  AnchoCampo,
  CampoTextoFormulario,
  DefCampo,
  EsquemaUri,
  FormularioMotor,
  ValoresConexion
} from './camposConexionTipos.ts'
export {
  ETIQUETA_CONFIAR_CERTIFICADO,
  PRESENTACION,
  placeholderCredencial,
  proponeConfiarCertificado
} from './camposConexionPresentacion.ts'
export {
  ETIQUETA_SOLO_LECTURA,
  OPCIONES_ENTORNO,
  TITULO_SOLO_LECTURA_AGENTES,
  ayudaEntorno,
  ayudaSoloLectura,
  entornoDeRadio,
  valorRadioEntorno
} from './camposConexionAyudas.ts'
export {
  ayudaSinClientes,
  driversDelMotor,
  fraseSinClientes,
  mostrarClientes,
  requiereAplica,
  usaClientes,
  type ClienteDeMotor
} from './camposConexionClientes.ts'

/**
 * Lo que el diálogo sabe de cada motor: las reglas del descriptor compartido y la
 * presentación. Una ayuda que falte sale vacía (y el test lo señala) en vez de tirar el
 * diálogo entero al cargar el módulo.
 */
export const DESCRIPTORES: Readonly<Record<DbMotor, FormularioMotor>> = porMotor((d) => {
  const p = PRESENTACION[d.id]
  return {
    motor: d.id,
    etiqueta: d.etiqueta,
    puertoPorDefecto: d.conexion.puertoPorDefecto,
    deArchivo: d.conexion.deArchivo,
    credenciales: d.conexion.credenciales,
    extensionesArchivo: d.conexion.extensionesArchivo,
    filas: p.filas,
    filasTrasCredenciales: p.filasTrasCredenciales ?? [],
    excluyentes: d.conexion.excluyentes.map((g, i) => ({
      campos: g.campos,
      alMenosUno: g.alMenosUno,
      ayuda: p.ayudasExcluyentes[i] ?? ''
    })),
    obligatorios: d.conexion.obligatorios,
    usaClientes: d.conexion.usaClientes,
    descartarAlGuardar: d.conexion.descartarAlGuardar,
    uri: p.uri ?? null
  }
})

/** Los motores del selector, en el orden en que se ofrecen (el del registro `MOTORES`). */
export const MOTORES_CONEXION: readonly DbMotor[] = IDS_MOTORES

/**
 * Lo que el diálogo sabe de un motor. Pasa por `descriptor()` del registro, que valida: con
 * un motor fuera del registro el error es «Motor desconocido», no un TypeError al leer `.filas`.
 */
export function descriptorDe(motor: DbMotor): FormularioMotor {
  return DESCRIPTORES[descriptor(motor).id]
}

/**
 * Los campos de las filas del destino (las de antes de usuario y contraseña) que el motor
 * PUEDE enseñar, en el orden del formulario (el dominio incluido, aunque `campoVisible` lo esconda).
 */
export function camposVisibles(motor: DbMotor): CampoFormulario[] {
  return descriptorDe(motor).filas.flatMap((fila) => fila.map((c) => c.campo))
}

/** Los de las filas tras usuario y contraseña. */
export function camposTrasCredenciales(motor: DbMotor): CampoFormulario[] {
  return descriptorDe(motor).filasTrasCredenciales.flatMap((fila) => fila.map((c) => c.campo))
}

/** ¿Se pinta este campo con estos valores? Todos, salvo el DOMINIO con una autenticación que no lo pide. */
export function campoVisible(campo: CampoFormulario, v: Pick<ValoresConexion, 'autenticacion'>): boolean {
  if (campo === 'dominio') return pideDominio(autenticacionDe(v.autenticacion))
  return true
}

/**
 * ¿Se pinta este campo APAGADO con estos valores? El puerto con SRV marcado, en un motor
 * que lo declara: el driver no lo admite, pero el main lo sigue exigiendo.
 */
export function campoDeshabilitado(campo: CampoFormulario, v: Pick<ValoresConexion, 'motor' | 'srv'>): boolean {
  if (campo === 'port') return v.srv === true && usaOpcional(descriptor(v.motor), 'srv')
  return false
}

/** Los campos de TEXTO del motor que llevan validación en vivo (`validar`), de todas sus filas. */
function camposConValidacion(motor: DbMotor): Extract<DefCampo, { tipo: 'texto' }>[] {
  const d = descriptorDe(motor)
  return [...d.filas, ...d.filasTrasCredenciales].flatMap((fila) =>
    fila.flatMap((c) => (c.tipo === 'texto' && c.validar !== undefined ? [c] : []))
  )
}

/**
 * Lo que se dice EN VIVO bajo un campo, o null: por qué el main lo rechazaría, con la
 * función `validar` de ese campo EN ESE MOTOR. Un campo que el motor no valida, nada,
 * aunque lleve algo escrito de otro motor.
 */
export function avisoDeCampo(campo: CampoFormulario, v: ValoresConexion): string | null {
  const def = camposConValidacion(v.motor).find((c) => c.campo === campo)
  if (def === undefined || def.validar === undefined) return null
  return def.validar(v[def.campo] ?? '')
}

/**
 * El motor de ARCHIVO que se ofrece para un nombre de archivo por su EXTENSIÓN (sin caja),
 * o null. Es solo la OFERTA: el main decide el motor de verdad por la CABECERA.
 */
export function motorPorNombreDeArchivo(nombre: string): DbMotor | null {
  const punto = nombre.lastIndexOf('.')
  if (punto <= 0 || punto === nombre.length - 1) return null
  const ext = nombre.slice(punto + 1).toLowerCase()
  return MOTORES_CONEXION.find((m) => descriptorDe(m).deArchivo && descriptorDe(m).extensionesArchivo.includes(ext)) ?? null
}

/**
 * El orden del formulario entero para las marcas: el nombre, el archivo (motor de archivo),
 * el destino, el usuario (si el motor lo pide) y lo de tras las credenciales. Es también
 * el orden del foco al fallar un guardado.
 */
export function ordenFormulario(motor: DbMotor): CampoConexion[] {
  const d = descriptorDe(motor)
  const archivo: CampoConexion[] = d.deArchivo ? ['archivo'] : []
  const usuario: CampoConexion[] = pideUsuarioYClave(descriptor(motor)) ? ['user'] : []
  // La base de autenticación no se marca nunca como falta: no entra.
  const delRegistro = (c: CampoFormulario): c is Exclude<CampoFormulario, 'authSource'> => c !== 'authSource'
  return ['alias', ...archivo, ...camposVisibles(motor).filter(delRegistro), ...usuario, ...camposTrasCredenciales(motor).filter(delRegistro)]
}

/**
 * ¿Rechazaría el main este OPCIONAL? Las reglas de `validarOpcional`
 * (`main/db/opcionalesConexion.ts`) que un formulario puede provocar: el dominio que
 * falta con cuenta de dominio y la instancia con `\`, `/` o `:`.
 */
function opcionalInvalido(v: ValoresConexion, campo: CampoConexion): boolean {
  switch (campo) {
    case 'dominio':
      return pideDominio(autenticacionDe(v.autenticacion)) && (v.dominio ?? '').trim() === ''
    case 'instancia':
      return /[\\/:]/.test(v.instancia ?? '')
    default:
      // Las opciones de la URI y la base numérica van por su `validar` (`faltantes`).
      return false
  }
}

/** ¿Rechazaría el main este campo por sí solo? Las mismas reglas que `validate`. */
function sinValor(v: ValoresConexion, campo: CampoConexion): boolean {
  switch (campo) {
    case 'alias': {
      const alias = v.alias.trim()
      return alias === '' || alias.length > ALIAS_MAX
    }
    case 'user':
      return v.user.trim() === ''
    case 'port':
      return !Number.isInteger(v.port) || v.port < 1 || v.port > 65535
    case 'archivo':
      return (v.archivo ?? '') === ''
    case 'instancia':
    case 'autenticacion':
    case 'dominio':
    case 'tls':
    case 'srv':
    case 'opcionesUri':
      // No son obligatorios en ningún motor: lo que el main rechaza de ellos lo marca `opcionalInvalido`.
      return false
    default:
      // Host, servicio y SID: lo que se GUARDA, no lo que se escribió.
      return limpiarDestinoBd(v[campo]) === ''
  }
}

/**
 * Los campos que faltan para que el main acepte el borrador, en el orden del
 * formulario: los obligatorios sin valor (o, puerto y nombre, fuera de su cota) y,
 * si un grupo excluyente exige al menos uno y no hay ninguno, todos los del grupo.
 */
export function faltantes(v: ValoresConexion): CampoConexion[] {
  const d = descriptorDe(v.motor)
  const faltan = new Set<CampoConexion>()
  for (const c of d.obligatorios) if (sinValor(v, c)) faltan.add(c)
  for (const g of d.excluyentes) {
    if (g.alMenosUno && g.campos.every((c) => sinValor(v, c))) for (const c of g.campos) faltan.add(c)
  }
  for (const c of descriptor(v.motor).conexion.opcionales) if (opcionalInvalido(v, c)) faltan.add(c)
  for (const def of camposConValidacion(v.motor)) {
    // La base de autenticación no tiene `validar` (ver `ordenFormulario`).
    if (def.campo !== 'authSource' && avisoDeCampo(def.campo, v) !== null) faltan.add(def.campo)
  }
  return ordenFormulario(v.motor).filter((c) => faltan.has(c))
}

/** Los campos de un grupo excluyente que llevan valor A LA VEZ (Service Name y SID). */
export function enConflicto(v: ValoresConexion): CampoConexion[] {
  const chocan = new Set<CampoConexion>()
  for (const g of descriptorDe(v.motor).excluyentes) {
    const conValor = g.campos.filter((c) => !sinValor(v, c))
    if (conValor.length > 1) for (const c of conValor) chocan.add(c)
  }
  return ordenFormulario(v.motor).filter((c) => chocan.has(c))
}

/** Lo que el diálogo pinta en rojo: lo que falta y lo que choca, en el orden del formulario. */
export function camposAMarcar(v: ValoresConexion): CampoConexion[] {
  const marcados = new Set<CampoConexion>([...faltantes(v), ...enConflicto(v)])
  return ordenFormulario(v.motor).filter((c) => marcados.has(c))
}

/** ¿Lo aceptaría el main? (Salvo un nombre duplicado, que solo sabe él.) */
export function listoParaGuardar(v: ValoresConexion): boolean {
  return camposAMarcar(v).length === 0
}

/**
 * El borrador tal como debe viajar: los campos que el motor descarta, vacíos. Si no
 * hay nada que vaciar devuelve el MISMO objeto; nunca muta el de entrada.
 */
export function limpiarParaGuardar<T extends ValoresConexion>(v: T): T {
  const descartar = descriptorDe(v.motor).descartarAlGuardar.filter((c) => v[c] !== '')
  if (descartar.length === 0) return v
  const vacios: Partial<Record<CampoTextoDestino, string>> = {}
  for (const c of descartar) vacios[c] = ''
  return { ...v, ...vacios }
}

/**
 * Las ayudas que van DEBAJO de la fila `indice`: las de los grupos excluyentes cuyo
 * último campo visible cae en ella, y después las de los campos de la fila.
 */
export function ayudasTrasFila(motor: DbMotor, indice: number): string[] {
  const d = descriptorDe(motor)
  const fila = d.filas[indice]
  if (!fila) return []
  const orden = camposVisibles(motor)
  const deGrupos = d.excluyentes
    .filter((g) => {
      const ultimo = orden.filter((c) => (g.campos as readonly CampoFormulario[]).includes(c)).pop()
      return ultimo !== undefined && fila.some((c) => c.campo === ultimo)
    })
    .map((g) => g.ayuda)
  return [...deGrupos, ...ayudasDeCampos(fila)]
}

/** Las ayudas bajo la fila `indice` de las de tras las credenciales. */
export function ayudasTrasFilaCredenciales(motor: DbMotor, indice: number): string[] {
  const fila = descriptorDe(motor).filasTrasCredenciales[indice]
  return fila ? ayudasDeCampos(fila) : []
}

function ayudasDeCampos(fila: readonly DefCampo[]): string[] {
  return fila.flatMap((c) => (c.ayuda ? [c.ayuda] : []))
}
