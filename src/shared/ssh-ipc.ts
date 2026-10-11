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
  /** invoke: borra varias conexiones del perfil en una sola escritura. SshBorrarConexiones -> SshConexionesBorradas. */
  BORRAR_VARIAS: 'ssh:borrar:varias',
  /** invoke: pasa varias conexiones del perfil a un grupo (o a «Sin grupo») en una sola escritura. SshMoverConexiones -> SshConexionesMovidas. */
  MOVER: 'ssh:mover',
  /**
   * invoke: copia una conexión del perfil con otro nombre («… (1)», «… (2)»…), con su clave y su secreto guardado y sin sus
   * huellas. SshDuplicarConexion -> SshConexion (la copia).
   */
  DUPLICAR: 'ssh:duplicar',
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
  /**
   * invoke: diálogo nativo de guardar (en el main) y escribe un `config` de OpenSSH con las conexiones del perfil,
   * y junto a él una carpeta con las copias de sus claves. SshExportarOpenSsh -> SshExportacionOpenSsh | null.
   */
  EXPORTAR_OPENSSH: 'ssh:exportar:openssh',
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
  AVISO: 'ssh:aviso',
  /**
   * send (main -> renderer), SshPreguntaAskpass: ssh pregunta algo que Tessera no contesta sola (un código, o la
   * contraseña tras rechazar la guardada) y lo contesta el usuario en un diálogo. La respuesta no se guarda.
   */
  ASKPASS_PREGUNTA: 'ssh:askpass:pregunta',
  /** send (main -> renderer), SshPreguntaRetirada: esa pregunta ya no espera respuesta (venció o ssh terminó). */
  ASKPASS_RETIRAR: 'ssh:askpass:retirar',
  /** invoke: la respuesta del usuario, o `null` si canceló. SshRespuestaAskpass -> void. */
  ASKPASS_RESPONDER: 'ssh:askpass:responder',
  /** invoke: lo que hicieron los agentes con `tssh` en un perfil (`logs/ssh.log`). SshPedirActividad -> SshActividadPerfil. */
  ACTIVIDAD: 'ssh:actividad'
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

/**
 * Un túnel de una conexión, abierto mientras está abierta su terminal. 'local' (`-L`): un puerto de este equipo
 * (solo en 127.0.0.1) lleva a `destinoHost:destinoPuerto` visto desde el servidor. 'remoto' (`-R`): un puerto
 * del servidor lleva a `destinoHost:destinoPuerto` visto desde este equipo. 'dinamico' (`-D`): un proxy SOCKS
 * en 127.0.0.1, sin destino.
 */
export type SshTipoTunel = 'local' | 'remoto' | 'dinamico'

export interface SshTunel {
  tipo: SshTipoTunel
  /** El puerto que escucha: de este equipo ('local', 'dinamico') o del servidor ('remoto'). */
  puerto: number
  /** Ausentes en 'dinamico'. */
  destinoHost?: string
  destinoPuerto?: number
}

/** Tope de túneles por conexión. */
export const SSH_TUNELES_MAX = 20

/** Tope de bastiones encadenados hasta una conexión (el suyo, el del suyo…). */
export const SSH_SALTOS_MAX = 4

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
  /** La conexión del perfil por la que se salta para llegar (el bastión), o `null` si se llega directo. */
  saltoId: string | null
  /** Sus túneles, en el orden en que se guardaron. */
  tuneles: SshTunel[]
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
  /** El bastión: otra conexión del perfil, o `null` = directo. Ausente: en un alta, directo; en una edición, el de antes. */
  saltoId?: string | null
  /** Los túneles. Ausentes: en un alta, ninguno; en una edición, los de antes. */
  tuneles?: SshTunel[]
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

/** Petición de `DUPLICAR`: solo se copia una conexión conocida de ese perfil. */
export interface SshDuplicarConexion {
  id: string
  profileId: string
}

/** Respuesta de `BORRAR`. */
export interface SshConexionBorrada {
  borrada: boolean
}

/** Tope de conexiones de una petición de `BORRAR_VARIAS` o `MOVER`. */
export const SSH_LOTE_MAX = 1000

/** Petición de `BORRAR_VARIAS`: solo se borran las conexiones conocidas de ese perfil; las demás ids se ignoran. */
export interface SshBorrarConexiones {
  ids: string[]
  profileId: string
}

/** Respuesta de `BORRAR_VARIAS`. */
export interface SshConexionesBorradas {
  borradas: number
}

/**
 * Petición de `MOVER`: las conexiones conocidas de ese perfil pasan a `grupoId` (`null` = «Sin grupo»), que
 * tiene que ser un grupo del perfil. Las ids de otro perfil, o que no existen, se ignoran.
 */
export interface SshMoverConexiones {
  ids: string[]
  profileId: string
  grupoId: string | null
}

/** Respuesta de `MOVER`: cuántas cambiaron de grupo (las que ya estaban en él no cuentan). */
export interface SshConexionesMovidas {
  movidas: number
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

/** Petición de `EXPORTAR_OPENSSH`: las conexiones de ese perfil (`ids`, o todas sin ellas). */
export interface SshExportarOpenSsh {
  profileId: string
  ids?: string[]
}

/** Respuesta de `EXPORTAR_OPENSSH`: dónde quedó y lo que hay que contar. Solo nombres, nunca rutas. */
export interface SshExportacionOpenSsh {
  /** El nombre del archivo, sin su carpeta. */
  archivo: string
  conexiones: number
  /** Los bastiones que se añadieron porque una conexión exportada salta por ellos. */
  bastiones: number
  /** La carpeta con las copias de las claves, junto al archivo; `null` si no hay ninguna. */
  carpetaClaves: string | null
  claves: number
  /** Conexiones con archivo de clave cuya copia no estaba: van sin `IdentityFile`. */
  sinClave: number
  /** Conexiones con contraseña (o con la frase de la clave guardada): ssh la pedirá al conectar. */
  conSecreto: number
  /** Conexiones cuyo nombre de `Host` no es su alias (espacios, comodines…). */
  renombradas: number
  /** Se guardó en `~/.ssh` con otro nombre que `config`: se usa con un `Include` de ese nombre. */
  incluible: boolean
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

/**
 * Lo que manda `ASKPASS_PREGUNTA`. `texto` es lo que pregunta el servidor (sin caracteres de control) o, con la
 * contraseña o la frase de la propia conexión, una etiqueta de Tessera; `rechazada`, que el servidor no aceptó
 * la guardada.
 */
export interface SshPreguntaAskpass {
  id: string
  alias: string
  texto: string
  /** El texto lo escribió el servidor, no Tessera. */
  delServidor: boolean
  rechazada: boolean
}

/** Lo que manda `ASKPASS_RETIRAR`. */
export interface SshPreguntaRetirada {
  id: string
}

/** Petición de `ASKPASS_RESPONDER`: `null` si el usuario canceló. */
export interface SshRespuestaAskpass {
  id: string
  respuesta: string | null
}

/** Lo que pide un agente con `tssh`: una orden remota, una copia o la prueba de `tssh doctor <alias>`. */
export type SshUsoTssh = 'run' | 'cp' | 'doctor'

/**
 * Una petición de un agente con `tssh`, tal como quedó en el registro: rechazada antes de lanzar ssh (con el
 * código propio de `tssh`), o terminada (con el código de ssh, lo que tardó y, si ssh falló, por qué). Nunca
 * la orden remota ni las rutas: el registro no las guarda.
 */
export interface SshActividad {
  /** ISO 8601. */
  fecha: string
  uso: SshUsoTssh
  /** El alias que escribió el agente (puede no existir: por eso se rechazó). */
  alias: string
  /** 'sinFinal': empezó y no consta cómo acabó (sigue en curso, o se interrumpió antes de apuntarlo). */
  estado: 'rechazada' | 'terminada' | 'sinFinal'
  codigo: number | null
  ms: number | null
  /** La cortó su `--timeout`. */
  tope: boolean
  motivo?: TerminalExitReason
}

/** Petición de `ACTIVIDAD`. */
export interface SshPedirActividad {
  profileId: string
}

/** Respuesta de `ACTIVIDAD`: la más reciente primero, con un tope; `mas` si había más antiguas. */
export interface SshActividadPerfil {
  entradas: SshActividad[]
  mas: boolean
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
