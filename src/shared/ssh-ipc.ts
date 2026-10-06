// =============================================================================
// Contrato IPC de las conexiones SSH de cada perfil (main <-> preload <-> UI): canales, el DTO
// sin secretos ni rutas, lo que manda el formulario, los grupos, el entorno del cliente SSH y
// «Probar». Es una HOJA sin imports de valor: lo importan main, preload y renderer. La sesión en
// la terminal se abre por `terminal:openSsh` (ver `terminal-ipc.ts`).
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import type { TerminalExitReason } from './terminal-ipc'

/** Canales de las conexiones SSH y de la carpeta del agente de la terminal. */
export const SSH_CHANNELS = {
  /** invoke: grupos, conexiones y ajenas de TODOS los perfiles (el renderer filtra). () -> SshListaConexiones. */
  LISTAR: 'ssh:listar',
  /** invoke: alta de una conexión. SshConexionInput -> SshConexion. */
  CREAR: 'ssh:crear',
  /** invoke: edición de una conexión. SshEditarConexion -> SshConexion. */
  EDITAR: 'ssh:editar',
  /** invoke: borra una conexión del perfil. SshBorrarConexion -> SshConexionBorrada. */
  BORRAR: 'ssh:borrar',
  /** invoke: SshCrearGrupo -> SshGrupo. */
  GRUPO_CREAR: 'ssh:grupo:crear',
  /** invoke: SshRenombrarGrupo -> SshGrupo. */
  GRUPO_RENOMBRAR: 'ssh:grupo:renombrar',
  /** invoke: borra el grupo y sus conexiones pasan a «Sin grupo». SshBorrarGrupo -> SshGrupoBorrado. */
  GRUPO_BORRAR: 'ssh:grupo:borrar',
  /** invoke: si hay cliente SSH y de dónde sale. () -> SshEntorno. */
  ENTORNO: 'ssh:entorno',
  /** invoke: diálogo nativo para elegir el archivo de clave; el main importa una copia. SshElegirClave -> SshClaveElegida | null. */
  CLAVE_ELEGIR: 'ssh:clave:elegir',
  /**
   * invoke: un archivo soltado sobre el campo de la clave. La ruta la saca el PRELOAD con
   * `webUtils.getPathForFile`, nunca el renderer. SshClaveSoltada -> SshClaveElegida.
   */
  CLAVE_SOLTADA: 'ssh:clave:soltada',
  /**
   * invoke: diálogo nativo para elegir un archivo `config` de OpenSSH (en el main: el renderer no ve la
   * ruta) y lo que trae cada `Host` concreto, con la copia de su clave ya importada: NO da de alta nada, eso
   * lo hace el renderer con `CREAR` cuando la persona lo revisa. SshImportarOpenSsh -> SshLecturaOpenSsh | null.
   */
  IMPORTAR_OPENSSH: 'ssh:importar:openssh',
  /** invoke: prueba la conexión GUARDADA (no lo que tenga el formulario) con la línea de la pestaña. SshProbar -> SshResultadoPrueba. */
  PROBAR: 'ssh:probar',
  /** invoke: olvida las huellas guardadas del servidor; la próxima conexión acepta la que presente. SshOlvidarHuella -> void. */
  HUELLA_OLVIDAR: 'ssh:huella:olvidar',
  /**
   * invoke: crea si hace falta la carpeta del agente de la terminal del perfil y siembra su contexto
   * (las conexiones). SshEspacioAsegurar -> SshEspacioTerminal.
   */
  ESPACIO_ASEGURAR: 'ssh:espacio:asegurar',
  /** invoke: la carpeta del agente de la terminal de cada perfil, sin crearla. SshEspacioRutas -> Record<perfil, ruta>. */
  ESPACIO_RUTAS: 'ssh:espacio:rutas',
  /** send (main -> renderer), sin argumentos: el registro (o una huella) cambió y toca volver a LISTAR. */
  CAMBIO: 'ssh:cambio',
  /** send (main -> renderer), SshAviso: una pestaña SSH se abrió sin la contraseña guardada y hay que decir por qué. */
  AVISO: 'ssh:aviso'
} as const

/**
 * Tope de la contraseña o la frase guardada, en bytes UTF-8: ssh lee como mucho 1023 del programa
 * de contraseñas y se deja margen. Tampoco puede llevar saltos de línea: ssh corta en el primero.
 */
export const SSH_SECRETO_MAX_BYTES = 1000

/** Tope del nombre de una conexión (como el de las conexiones de BD). */
export const SSH_ALIAS_MAX = 120

/** Tope del nombre de un grupo. */
export const SSH_GRUPO_MAX = 80

/**
 * Cómo se autentica una conexión: 'contrasena' (guardada cifrada, o tecleada en el prompt de ssh),
 * 'clave' (un archivo de clave del que Tessera guarda una copia protegida, y su frase si la tiene)
 * o 'sistema' (las claves por defecto y el agente de claves del usuario).
 */
export type SshMetodo = 'contrasena' | 'clave' | 'sistema'

/**
 * ¿Pide el método un secreto para entrar? La contraseña, o la frase de una clave que la tiene. La única
 * copia de la regla: la usan el main (la prueba, `tssh`) y el formulario.
 */
export function pideSecretoSsh(c: { metodo: SshMetodo; clave?: { cifrada: boolean } | null }): boolean {
  return c.metodo === 'contrasena' || (c.metodo === 'clave' && c.clave?.cifrada === true)
}

/** Una huella guardada del servidor: el tipo de clave y su SHA256 en base64 sin relleno. */
export interface SshHuella {
  algoritmo: string
  sha256: string
}

/** Un grupo de conexiones de un perfil. Un solo nivel. */
export interface SshGrupo {
  id: string
  profileId: string
  nombre: string
}

/** El archivo de clave de una conexión tal como lo ve la UI: el nombre, nunca la ruta. */
export interface SshClaveVisible {
  nombre: string
  /** 'Ed25519', 'RSA'…; vacío si el contenido no lo dice (una PKCS#8 cifrada). */
  tipo: string
  cifrada: boolean
}

/**
 * Un archivo de clave recién elegido o soltado: el main ya guardó una copia protegida, y `token`
 * la identifica al guardar la conexión (`SshConexionInput.clave`). Caduca a la media hora.
 */
export interface SshClaveElegida {
  token: string
  /** El nombre del archivo, sin su carpeta. */
  nombre: string
  /** 'Ed25519', 'RSA'…, o `null` si el contenido no lo dice (una PKCS#8 cifrada). */
  tipo: string | null
  /** Tiene frase: se puede guardar con la conexión o teclearla en la terminal al conectar. */
  cifrada: boolean
}

/** Petición de `CLAVE_ELEGIR`: la copia solo vale para una conexión de ese perfil. */
export interface SshElegirClave {
  profileId: string
}

/** Petición de `CLAVE_SOLTADA`: el perfil, como al elegir (la copia solo vale para él), y la ruta, que la pone el preload. */
export interface SshClaveSoltada {
  profileId: string
  ruta: string
}

/** Una conexión SSH tal como la ve la UI: sin secretos ni rutas del host, a propósito. */
export interface SshConexion {
  id: string
  /** Perfil dueño: toda conexión es privada de su perfil. */
  profileId: string
  /** Nombre libre y único en el perfil (sin distinguir mayúsculas). */
  alias: string
  /** Su grupo, o `null` = «Sin grupo». */
  grupoId: string | null
  /**
   * En disco cita un grupo que esta versión no conoce (borrado a mano, de una versión más nueva…):
   * se enseña en «Sin grupo» y el disco no se toca hasta que se elija otro.
   */
  grupoDesconocido?: true
  host: string
  puerto: number
  usuario: string
  metodo: SshMetodo
  clave?: SshClaveVisible
  /** Hay una contraseña (o la frase de la clave) guardada. */
  tieneSecreto: boolean
  /** Hay un secreto guardado que este equipo no puede descifrar. */
  secretoIlegible?: true
  /** Solo `true` en disco la hace disponible: ausente o con otro valor, no lo está. */
  disponibleAgentes: boolean
  /** Las huellas del servidor que ya se aceptaron para esta conexión (vacía si nunca se conectó). */
  huellaServidor: SshHuella[]
}

/**
 * Lo que manda el formulario al crear o editar. `clave` es el archivo recién elegido: obligatoria en
 * un alta con el método 'clave' o al pasar a él; ausente en una edición, se conserva la importada.
 * `secreto` es la contraseña (método 'contrasena') o la frase de la clave ('clave'), de SOLO
 * ESCRITURA: ausente conserva la guardada, '' la borra y un texto la sustituye. Con 'sistema' no vale.
 */
export interface SshConexionInput {
  profileId: string
  alias: string
  grupoId: string | null
  host: string
  puerto: number
  usuario: string
  metodo: SshMetodo
  disponibleAgentes: boolean
  secreto?: string
  clave?: { tipo: 'elegida'; token: string }
}

/** Petición de `EDITAR`. */
export interface SshEditarConexion {
  id: string
  input: SshConexionInput
}

/** Petición de `BORRAR`: solo se borra entre las conexiones conocidas de ese perfil. */
export interface SshBorrarConexion {
  id: string
  profileId: string
}

/** Respuesta de `BORRAR`. */
export interface SshConexionBorrada {
  borrada: boolean
}

/** Petición de `GRUPO_CREAR`. */
export interface SshCrearGrupo {
  profileId: string
  nombre: string
}

/** Petición de `GRUPO_RENOMBRAR`. */
export interface SshRenombrarGrupo {
  id: string
  profileId: string
  nombre: string
}

/** Petición de `GRUPO_BORRAR`. */
export interface SshBorrarGrupo {
  id: string
  profileId: string
}

/** Respuesta de `GRUPO_BORRAR`: cuántas conexiones conocidas pasaron a «Sin grupo». */
export interface SshGrupoBorrado {
  borrado: boolean
  conexionesMovidas: number
}

/**
 * Una entrada del registro que esta versión no sabe usar (forma desconocida, o un id que ya
 * tiene otra anterior del mismo tipo). Se conserva en disco tal cual; esto basta para avisar.
 */
export interface SshEntradaAjena {
  tipo: 'conexion' | 'grupo'
  id: string
  profileId: string
  /** El alias (o el nombre del grupo) tal como está, o el id si no trae uno legible. */
  nombre: string
  /** Su id ya lo tiene una entrada anterior del mismo tipo (solo por una edición a mano). */
  idRepetido?: true
}

/** Las tres listas de `SshListaConexiones`, comunes a sus dos formas. */
interface ListasSsh {
  grupos: SshGrupo[]
  conexiones: SshConexion[]
  ajenas: SshEntradaAjena[]
}

/**
 * Lo que devuelve `LISTAR`. Con `formatoAjeno` (un archivo que esta versión no sabe escribir o no
 * pudo leer) las listas llegan VACÍAS aunque el archivo esté lleno: no se dice «Sin conexiones» ni
 * se ofrecen altas, y se enseña `aviso`. `recuperado` (sin la marca) avisa de que se usan las
 * conexiones de la copia de respaldo porque el archivo no era JSON válido.
 */
export type SshListaConexiones =
  | (ListasSsh & { formatoAjeno: false; aviso?: undefined; recuperado?: string })
  | (ListasSsh & { formatoAjeno: true; aviso: string; recuperado?: undefined })

/**
 * Si hay cliente SSH: 'sistema' es el OpenSSH del sistema y 'git' el de Git for Windows (con
 * `aviso` 'ssh-de-git'); sin ninguno, `disponible: false` y 'sin-ssh'.
 */
export interface SshEntorno {
  disponible: boolean
  origen: 'sistema' | 'git' | null
  aviso: 'sin-ssh' | 'ssh-de-git' | null
}

/** Petición de `IMPORTAR_OPENSSH`: las conexiones van a ese perfil. */
export interface SshImportarOpenSsh {
  profileId: string
}

/** Un `Host` concreto de un archivo de OpenSSH, listo para revisarlo y darlo de alta. */
export interface SshCandidataOpenSsh {
  alias: string
  host: string
  /** El de `Port`, o 22 sin él; `null` si no es un número. */
  puerto: number | null
  /** El de `User`; '' si el bloque no lo trae. */
  usuario: string
  /** La copia de su `IdentityFile`, ya importada (con su ficha): entra con el método «Archivo de clave». */
  clave: SshClaveElegida | null
  /** Traía un `IdentityFile` que no se pudo usar (no es una clave válida o está en una ruta de red). */
  claveNoUsable: boolean
  /** El perfil ya tiene una conexión con ese nombre. */
  existe: boolean
}

/** Respuesta de `IMPORTAR_OPENSSH`: lo que trae el archivo y lo que no se sigue. */
export interface SshLecturaOpenSsh {
  /** El nombre del archivo, sin su carpeta. */
  archivo: string
  candidatas: SshCandidataOpenSsh[]
  /** Bloques `Host` con comodines o varios patrones, y bloques `Match`. */
  conPatrones: number
  /** Líneas `Include`: no se siguen. */
  include: number
}

/** Petición de `PROBAR`. */
export interface SshProbar {
  id: string
}

/** Petición de `HUELLA_OLVIDAR`. */
export interface SshOlvidarHuella {
  id: string
}

/** Por qué falló «Probar»: los motivos de la salida de una sesión SSH, el tope de tiempo u otro. */
export type SshMotivoPrueba = TerminalExitReason | 'tiempo' | 'otro'

/** Lo común del resultado de «Probar»: lo que tardó y las huellas guardadas del servidor al terminar. */
interface ResultadoPruebaBase {
  ms: number
  huellas: SshHuella[]
  /** Hay un secreto guardado que no se pudo usar (ilegible, sin puente…), y por qué. */
  aviso?: string
}

/**
 * Lo que responde `PROBAR`: nunca rutas ni la salida de ssh tal cual. `soloAlcance`: sin el secreto
 * que el método necesita no se prueba a entrar; se llegó al servidor y su huella quedó guardada.
 */
export type SshResultadoPrueba =
  | (ResultadoPruebaBase & { ok: true; soloAlcance: boolean })
  | (ResultadoPruebaBase & {
      ok: false
      motivo: SshMotivoPrueba
      /** La última línea de ssh sin rutas, o vacío. */
      detalle: string
      /** Con la huella cambiada: la que presenta ahora el servidor, si ssh la dijo. */
      huellaNueva?: SshHuella
      /** El servidor pidió algo que Tessera no contesta (un código, una confirmación). */
      preguntaSinContestar?: true
    })

/** Lo que manda `AVISO`: la conexión y por qué su pestaña pedirá la contraseña en la terminal. */
export interface SshAviso {
  alias: string
  texto: string
}

/** Petición de `ESPACIO_ASEGURAR`: el perfil. El nombre que se escribe en el contexto lo pone el main. */
export interface SshEspacioAsegurar {
  profileId: string
}

/**
 * Respuesta de `ESPACIO_ASEGURAR`: la carpeta `<userData>/terminal/<perfil>`, que el renderer usa como
 * el proyecto de los targets del agente de la terminal (igual que el espacio de datos), y su nombre visible.
 */
export interface SshEspacioTerminal {
  projectHostPath: string
  name: string
}

/** Petición de `ESPACIO_RUTAS`. */
export interface SshEspacioRutas {
  profileIds: string[]
}
