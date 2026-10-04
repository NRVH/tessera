// =============================================================================
// Tipos del formulario de conexión: cómo se describe un campo (`DefCampo`), lo que el
// diálogo sabe de un motor (`FormularioMotor`) y lo que se lee de un borrador.
// Solo tipos; `camposConexion.ts` los reexporta para no mover a sus lectores.
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import type { CamposUri, ResultadoUri } from '../../../../shared/uriConexion.ts'
import type { DbAutenticacion, DbMotor, DbTls } from '../../../../shared/db-ipc.ts'
import type {
  CampoConexion,
  CampoTextoDestino,
  CredencialesMotor,
  GrupoExcluyenteDestino
} from '../../../../shared/motores/index.ts'

/**
 * Cómo se reparte el ancho de la fila: el que `crece`, el del `puerto` (estrecho,
 * cabe un 65535) y el `medio` (el del SID, igual que el selector de motor).
 */
export type AnchoCampo = 'crece' | 'puerto' | 'medio'

interface DefCampoComun {
  etiqueta: string
  placeholder?: string
  ancho: AnchoCampo
  /** La frase que va bajo la fila del campo (ver `ayudasTrasFila`). */
  ayuda?: string
}

/** Los campos de TEXTO del formulario: los del destino y los opcionales que el borrador lleva como texto. */
export type CampoTextoFormulario = CampoTextoDestino | 'instancia' | 'dominio' | 'opcionesUri' | 'authSource'

/** Una opción de un campo `eleccion` (la autenticación). */
export interface OpcionAutenticacion {
  valor: DbAutenticacion
  etiqueta: string
}

/**
 * Un campo del formulario. El `tipo` decide el input: `texto` (con el recorte al pegar),
 * `puerto` (numérico), `eleccion` (un <select> nativo), `cifrado` (las dos casillas de
 * `DbTls`) o `casilla` (un opcional booleano). Un motor de archivo no usa ninguno.
 */
export type DefCampo =
  | (DefCampoComun & {
      tipo: 'texto'
      campo: CampoTextoFormulario
      /** Lo que se valida EN VIVO: null si vale, o el motivo. La misma función que aplica el main. */
      validar?: (valor: string) => string | null
    })
  | (DefCampoComun & { tipo: 'puerto'; campo: 'port' })
  | (DefCampoComun & { tipo: 'eleccion'; campo: 'autenticacion'; opciones: readonly OpcionAutenticacion[] })
  | (DefCampoComun & {
      tipo: 'cifrado'
      campo: 'tls'
      /** La etiqueta de la segunda casilla (la primera es `etiqueta`). */
      etiquetaConfiar: string
    })
  | (DefCampoComun & { tipo: 'casilla'; campo: 'srv' })

/** El campo que describe un `DefCampo` (todos los del formulario son de `CampoConexion`). */
export type CampoFormulario = DefCampo['campo']

/**
 * Campos de los que SOLO UNO puede llevar valor (Oracle: Service Name o SID): el grupo
 * del descriptor compartido (`conexion.excluyentes`) más la frase que lo explica.
 */
export interface GrupoExcluyente extends GrupoExcluyenteDestino {
  /** La frase que se pinta debajo de la fila del ÚLTIMO de ellos. */
  ayuda: string
}

/** Cómo «pega una URI» un motor: el ejemplo del campo, la frase de debajo y cómo se descompone. */
export interface EsquemaUri {
  ejemplo: string
  /** La ayuda bajo el campo de la URI: qué rellena y que la URI no se guarda. */
  ayuda: string
  descomponer: (uri: string) => ResultadoUri<CamposUri>
}

/** Lo que el diálogo sabe de un motor: las reglas del descriptor compartido y la presentación. */
export interface FormularioMotor {
  motor: DbMotor
  /** Lo que dice el selector de motor (`etiqueta` del descriptor). */
  etiqueta: string
  /** Lo que se precarga al elegirlo; null en un motor sin puerto, que no lo pinta (el borrador guarda 0). */
  puertoPorDefecto: number | null
  /** ¿Es un motor de ARCHIVO? (`conexion.deArchivo`): el destino es el archivo, no host y puerto. */
  deArchivo: boolean
  /** Con qué se autentica (`conexion.credenciales`): con 'ninguna', ni usuario ni contraseña. */
  credenciales: CredencialesMotor
  /** Extensiones del diálogo nativo (`conexion.extensionesArchivo`). */
  extensionesArchivo: readonly string[]
  /** Las filas del destino, en orden (de `PRESENTACION`). */
  filas: readonly (readonly DefCampo[])[]
  /** Las que van tras usuario y contraseña (de `PRESENTACION`). */
  filasTrasCredenciales: readonly (readonly DefCampo[])[]
  /** Los de `conexion.excluyentes`, cada uno con su ayuda de `PRESENTACION`. */
  excluyentes: readonly GrupoExcluyente[]
  /** Los que el main exige por sí solos (`conexion.obligatorios`). */
  obligatorios: readonly CampoConexion[]
  /** ¿Necesita clientes de base de datos? (`conexion.usaClientes`) */
  usaClientes: boolean
  /** Lo que NO viaja al main aunque siga escrito en el borrador (`conexion.descartarAlGuardar`). */
  descartarAlGuardar: readonly CampoTextoDestino[]
  /** «Pegar URI» (de `PRESENTACION`); null = el motor no lo ofrece. */
  uri: EsquemaUri | null
}

/** Lo que el formulario lee de un borrador. `BorradorConexion` lo cumple sin más. */
export interface ValoresConexion {
  motor: DbMotor
  alias: string
  host: string
  port: number
  database: string
  sid: string
  user: string
  /** Motores de archivo: el NOMBRE del archivo elegido; '' o ausente = ninguno. */
  archivo?: string
  /** Los opcionales (`conexion.opcionales`). Ausentes = sin valor. */
  instancia?: string
  autenticacion?: DbAutenticacion
  dominio?: string
  tls?: DbTls
  srv?: boolean
  opcionesUri?: string
  /** La base de autenticación: el `authSource` de las opciones, con campo propio en el formulario. */
  authSource?: string
}

/** Lo que el formulario pone de SUYO por motor; las reglas son del descriptor compartido. */
export interface PresentacionMotor {
  /** Las filas del destino, en orden; cada fila, sus campos de izquierda a derecha. */
  filas: readonly (readonly DefCampo[])[]
  /** Filas DETRÁS de usuario y contraseña: lo que es de la conexión y no del destino. Ausente = ninguna. */
  filasTrasCredenciales?: readonly (readonly DefCampo[])[]
  /** La ayuda de cada grupo de `conexion.excluyentes`, en su mismo orden. */
  ayudasExcluyentes: readonly string[]
  /** «Pegar URI»; ausente = el motor no lo ofrece. */
  uri?: EsquemaUri
}
