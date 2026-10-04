// =============================================================================
// Contrato IPC de las CONEXIONES a bases de datos (main <-> preload <-> UI): el DTO público, el
// entorno, los esquemas visibles y los canales. Sin secretos hacia el renderer: `password` solo
// viaja de la UI al main. Es una HOJA sin imports de valor (lo importan main, preload, renderer
// y `motores/`); lo que cambia por motor vive en su descriptor.
// Decisiones: docs/decisiones/bd/contratos-conexiones.md
// =============================================================================

/**
 * Motores SQL: los que tienen dialecto, consola SQL, rejilla y catálogo de esquemas. Es la
 * clave de todo lo que SOLO tiene sentido en SQL (`REGLAS`, `ESCRITURA_SQL`,
 * `MOTORES_EXPLORADOR`), y por eso un motor de otra familia no puede tener fila en esas
 * tablas ni por descuido. Coincide con `DialectoSql` (la invariante
 * dialecto = motor), y lo fija `test-motores`.
 */
export type DbMotorSql = 'oracle' | 'postgres' | 'sqlite' | 'sqlserver'

/** Motores de DOCUMENTOS: bases → colecciones → documentos. */
export type DbMotorDocumentos = 'mongodb'

/** Motores de CLAVES: bases numeradas → claves con su tipo. */
export type DbMotorClaves = 'redis'

/**
 * Motores soportados. Sumar uno no es solo «un adaptador en `tdb`»: es su id aquí (en la
 * unión de SU FAMILIA), su descriptor en `shared/motores/` y lo que el compilador pida
 * después (ver la cabecera de `shared/motores/index.ts`).
 */
export type DbMotor = DbMotorSql | DbMotorDocumentos | DbMotorClaves

/**
 * Con qué se autentica una conexión que declara el campo
 * `autenticacion` (`conexion.opcionales` de su descriptor):
 *   - 'sql': usuario y contraseña del propio servidor (un login de SQL Server);
 *   - 'ntlm': una cuenta de DOMINIO con su contraseña (NTLM, que el driver habla en JS puro y
 *     funciona igual desde cualquier sistema); pide además `dominio`.
 * Ausente = 'sql'. La autenticación INTEGRADA (Kerberos/SSPI con la sesión del usuario, sin
 * escribir la clave) y Entra ID no están soportadas: serían valores nuevos de esta unión, y cada `switch` que la mire (con `nunca`) tendrá que decidir.
 */
export type DbAutenticacion = 'sql' | 'ntlm'

/**
 * El cifrado de la conexión, para los motores que declaran `tls`:
 *   - `cifrar`: cifrar el canal (TDS `encrypt`). Por defecto, sí.
 *   - `confiarCertificado`: aceptar el certificado del servidor SIN verificarlo contra las
 *     CA del sistema (la casilla «Confiar en el certificado del servidor»). Por defecto, no:
 *     se verifica. Con un certificado autofirmado,
 *     «Probar» falla con un mensaje que propone la casilla.
 * Ausente = `TLS_POR_DEFECTO`.
 */
export interface DbTls {
  cifrar: boolean
  confiarCertificado: boolean
}

/** El cifrado de una conexión que no dice nada: cifrar y verificar (ver `DbTls`). */
export const TLS_POR_DEFECTO: Readonly<DbTls> = Object.freeze({ cifrar: true, confiarCertificado: false })

/**
 * De dónde sale el ARCHIVO de una conexión de un motor de archivo (SQLite)
 * al darla de alta o editarla. NUNCA una ruta del anfitrión escrita por el renderer (el
 * invariante de todo el IPC): o una FICHA que emitió el main al elegir o crear el archivo
 * con su diálogo nativo (o al soltarlo sobre el árbol, que resuelve el preload), o un
 * archivo DEL PROYECTO por su ruta relativa a la contenedora, que es como el explorador de
 * archivos nombra todo. El main la resuelve a la ruta real y la guarda él; el renderer solo
 * vuelve a ver el nombre (`DbConnection.archivoVisible`).
 *   - 'elegido': la ficha de `DbArchivoElegido` (caduca; una ficha que el main no conoce se
 *     rechaza con un error que pide volver a elegirlo).
 *   - 'proyecto': el archivo `relPath` (POSIX, relativa a la contenedora) del proyecto
 *     `projectHostPath`; el main comprueba que no se sale del proyecto.
 * En una EDICIÓN, ausente = se conserva el archivo guardado.
 */
export type DbOrigenArchivo =
  | { tipo: 'elegido'; token: string }
  | { tipo: 'proyecto'; projectHostPath: string; relPath: string }

/**
 * Lo que devuelve el main al elegir, crear o soltar un archivo: la ficha con la que el
 * renderer lo nombra después (`DbOrigenArchivo`) y el nombre para pintarlo. Sin la ruta.
 */
export interface DbArchivoElegido {
  token: string
  /** El nombre del archivo (sin carpetas), para el formulario. */
  nombre: string
}

/**
 * Petición de «Montar como base de datos» desde el explorador de archivos. El motor lo
 * decide el MAIN por la cabecera del archivo (hoy, solo SQLite: `SQLite format 3\0`), no
 * la extensión que ve el renderer.
 */
export interface DbMontarArchivoRequest {
  profileId: string
  projectHostPath: string
  /** Ruta POSIX relativa a la contenedora del proyecto. */
  relPath: string
}

/**
 * Respuesta de «Montar como base de datos»: la conexión (creada de solo lectura, o la que
 * ya apuntaba a ese mismo archivo real, `reutilizada`) ya montada en el proyecto.
 */
export interface DbMontarArchivoRespuesta {
  conexion: DbConnection
  reutilizada: boolean
}

/**
 * Una conexión que ESTA versión de Tessera no sabe abrir, por una de tres causas: su motor
 * no lo conoce (la SQLite o la SQL Server de una versión más nueva), es de un motor que
 * sí conoce pero está guardada de una FORMA que no reconoce (le falta el host, el puerto
 * no es un número…), que puede venir de una versión más nueva o de una edición a mano del
 * archivo, o su id ya lo tiene otra conexión anterior del registro (`idRepetido`, solo por
 * una edición a mano). Se conserva en disco TAL CUAL —«lo que no entiendo, no lo toco»— y la UI la
 * enseña atenuada, con el aviso de su causa (`textoAjena` en `filasArbolBd`) y Eliminar
 * como única acción. Hasta la versión que trae esto, la primera escritura del registro
 * BORRABA esas conexiones sin decir nada (medido).
 *
 * No confundir con el FORMATO AJENO del archivo entero (`DbListaConexiones.formatoAjeno`):
 * ahí no hay ninguna entrada que describir, porque no se interpreta ninguna.
 */
export interface DbConexionAjena {
  id: string
  profileId: string
  /** El alias tal como está en el registro (o el id, si no trae uno legible). */
  alias: string
  /** El motor tal como está escrito en el registro ('sqlite', 'sqlserver'…). */
  motor: string
  /**
   * Una TERCERA causa, que no es el motor ni la forma: una
   * conexión de forma conocida cuyo id ya lo tiene otra conocida ANTERIOR del registro (solo
   * por una edición a mano: una entrada copiada y pegada). Todo lo que se hace por id —abrirla,
   * editarla, su contraseña, borrarla— iba a la primera, así que la segunda enseñaba un alias
   * y abría el servidor de la otra, con su contraseña, incluso desde otro perfil. Ahora se lee
   * como ajena, se conserva tal cual, y esto dice con quién comparte el id, tal como está
   * AHORA (`DbComparteId`). Ausente = la causa es el motor o la forma.
   */
  idRepetido?: DbComparteId
}

/**
 * Con quién comparte su id una ajena por id repetido (`DbConexionAjena.idRepetido`), en el
 * momento de listarla:
 *   - 'conexion': una conocida del MISMO perfil, por su alias, que es la que usa el id;
 *   - 'otroPerfil': una conocida de OTRO perfil. Su alias no se da: las conexiones son
 *     privadas de su perfil, y un nombre de un perfil no tiene por qué verse desde otro;
 *   - 'eliminada': ya no queda ninguna conocida con ese id (se eliminó en esta sesión). El
 *     registro se lee al arrancar, así que hasta reiniciar sigue siendo ajena; después, será
 *     la conocida de ese id.
 */
export type DbComparteId = { tipo: 'conexion'; alias: string } | { tipo: 'otroPerfil' } | { tipo: 'eliminada' }

/**
 * Lo que pide `DELETE`. Una conocida y una ajena pueden compartir id (solo por
 * una edición a mano del registro), y cada fila del panel sabe cuál es: `true` borra la
 * ajena, `false` la conocida. Ausente (una versión anterior del renderer), la conocida,
 * que es a la que resuelve el id en todo lo demás.
 */
export interface DbBorrarConexion {
  id: string
  ajena?: boolean
  /**
   * Solo con `ajena: true`: el alias de la fila AJENA pulsada
   * (`DbConexionAjena.alias`): DOS ajenas pueden compartir id —la copia de una conocida por id
   * repetido y una de motor con ese mismo id, p. ej.—, y con el id y el tipo se borraba la
   * PRIMERA del archivo, que podía no ser la pulsada. Si ninguna ajena de ese id tiene ese
   * alias, no se borra nada: nunca otra en su lugar. Ausente, la primera ajena del id.
   */
  alias?: string
  /**
   * El perfil de la fila pulsada: se borra solo entre SUS
   * entradas. La misma copia pegada en dos perfiles tiene el mismo id y el mismo alias, y sin
   * esto se borraba la primera del archivo, la del otro perfil, dejando la pulsada en su sitio.
   * Ausente (una versión anterior del renderer), todo el registro, como antes.
   */
  profileId?: string
}

/** Lo que responde `DELETE`. */
export interface DbConexionBorrada {
  /** Había una entrada con ese id y ese tipo, y se borró. */
  borrada: boolean
  /**
   * Tras borrar, SIGUE habiendo una conocida con ese id EN EL PERFIL de la borrada: se borró la
   * ajena que lo compartía. Lo que cuelga del id —sesiones abiertas, consolas, historial, y los
   * MONTAJES en los proyectos— es de esa conocida, que sigue: ni el main lo limpia ni el
   * renderer lo desmonta. Va ceñido al perfil: la de otro perfil va en `conocidaEnOtroPerfil`.
   */
  quedaConocida: boolean
  /**
   * Tras borrar, la conocida de ese id sigue, pero es de
   * OTRO perfil (se borró la copia pegada en este). Lo de ESTE perfil —sus consolas, su
   * historial, sus montajes— ya no es de nadie: el main limpia lo suyo (el gancho
   * `onConexionOlvidadaEnPerfil` de `DbController`) y el renderer desmonta el id en los
   * proyectos de ESTE perfil y cierra aquí sus pestañas (`olvidarEnPerfilTrasBorrar`, ceñido al
   * perfil de la fila). Lo del id a secas —las sesiones abiertas, y sus montajes y pestañas en
   * el otro perfil— es de la conocida y NO se toca. Va con `quedaConocida` a falso.
   */
  conocidaEnOtroPerfil?: boolean
}

/**
 * ¿Olvida el renderer el id EN EL PERFIL DE LA FILA tras el `DELETE` (`onConexionEliminada`
 * con ese perfil: lo desmonta de los proyectos de ese perfil y cierra allí sus pestañas)? Sí
 * cuando en ese perfil ya no queda la conocida del id (`quedaConocida` a falso): los montajes y
 * las pestañas de un id son de su conocida, y la de este perfil ya no está. También con la
 * conocida en OTRO perfil (`conocidaEnOtroPerfil`, se borró la copia pegada en éste): lo de ESTE
 * perfil ya no es de nadie; lo del otro no se toca porque el olvido va ceñido al perfil.
 * Con `quedaConocida`, lo de este perfil es de la que sigue y no se olvida.
 *
 * El olvido va ceñido al perfil (`quitarConexion` y `podarConexion` con perfil), así que no
 * hace falta excluir `conocidaEnOtroPerfil`.
 *
 * Aquí, junto al contrato, y no en línea en `DbArbol`: es la mitad del renderer de ese arreglo,
 * y en línea no la fijaba ninguna prueba. Su test (`test-registro-conexiones`) la cruza con las
 * respuestas del `DELETE` de verdad.
 */
export function olvidarEnPerfilTrasBorrar(r: DbConexionBorrada): boolean {
  return !r.quedaConocida
}

/** Las dos listas de `DbListaConexiones`, comunes a sus dos formas. */
interface ListasDeConexiones {
  conexiones: DbConnection[]
  ajenas: DbConexionAjena[]
}

/**
 * Lo que devuelve `LIST_COMPLETA`: las conocidas y las ajenas de una misma lectura, y si
 * el ARCHIVO ENTERO tiene un formato que esta versión no reconoce o no se pudo leer
 * (`formatoAjeno`).
 *
 * POR QUÉ VIAJA LA MARCA, y no basta con las listas: con un formato ajeno (una raíz que
 * no es un objeto, un `connections` que no es una lista, una `version` que no es un
 * número; ver `leerRegistro` en `src/main/db/registroConexiones.ts`) el main no
 * interpreta ninguna entrada, así que las dos listas llegan VACÍAS aunque el archivo esté
 * lleno. Sin la marca, eso sería indistinguible de «el perfil no tiene conexiones»: la poda
 * de arranque del renderer desmontaría las bases de TODOS los proyectos (y lo guardaría), y
 * la UI diría «Sin conexiones», que es falso.
 *
 * La MISMA marca cubre un archivo que NO SE PUEDE LEER (JSON roto por una edición a mano
 * y sin `.bak` que lo supla, o que no se deja abrir): el main tampoco interpreta nada ni
 * escribe encima, y para el renderer las consecuencias son idénticas —no podar, no decir «Sin conexiones»,
 * no ofrecer altas—. Por eso no hay una segunda marca que cada consumidor tuviera que
 * acordarse de mirar: lo que cambia es el `aviso`.
 *
 * `aviso` es el texto que se enseña: el `MENSAJE_FORMATO_AJENO` del main (nombra los dos
 * orígenes posibles y el archivo) o su `mensajeRegistroIlegible` (qué no se pudo leer y
 * qué hacer). Viaja con la respuesta porque el renderer no puede importar el main, y una
 * copia del texto envejecería por separado. Una UNIÓN y no un `aviso?` suelto: con la
 * marca puesta, el texto no puede faltar.
 *
 * `recuperado` (solo SIN la marca) es el aviso NO bloqueante de que el archivo no era JSON
 * válido y se usan las conexiones de su copia de respaldo (`.bak`), y de dónde queda el
 * archivo dañado (`mensajeRegistroRecuperado` del main; ver `lecturaConRespaldo`). Las listas
 * son buenas y se usan como siempre; el renderer lo enseña UNA vez por sesión
 * (`useConexionesBd`), aunque llegue en cada respuesta.
 */
export type DbListaConexiones =
  | (ListasDeConexiones & { formatoAjeno: false; aviso?: undefined; recuperado?: string })
  | (ListasDeConexiones & { formatoAjeno: true; aviso: string; recuperado?: undefined })

/** Una conexión tal como la ve la UI. SIN secreto, a propósito. */
export interface DbConnection {
  id: string
  /** Perfil dueño. Toda conexión es privada de su perfil. */
  profileId: string
  /**
   * Nombre LIBRE que le das a la conexión para reconocerla ("DEV-VENTAS",
   * "Ventas PROD", "réplica de lectura"). Sin restricciones de caracteres: es tuyo, no un
   * identificador técnico. Lo técnico es `id`, que es de donde cuelga el secreto.
   *
   * `tdb` lo busca sin distinguir mayúsculas ni espacios sobrantes; si lleva
   * espacios, se entrecomilla como cualquier argumento: `tdb query "Ventas PROD" …`.
   */
  alias: string
  motor: DbMotor
  /**
   * host, port y user siguen OBLIGATORIOS en el tipo aunque un motor de archivo no los
   * use ('' / 0 / ''): hacerlos opcionales obligaba a tocar cada lector de un motor de
   * red para nada. Qué campos aplican a cada motor lo dice su descriptor
   * (`conexion.obligatorios`), y la FORMA en disco de cada motor sale de ahí.
   */
  host: string
  port: number
  /**
   * postgres: nombre de la base. oracle: SERVICE_NAME. Excluyente con `sid`. sqlserver: la
   * base en la que trabaja la conexión, OPCIONAL (sin ella, el árbol tiene un nivel «Bases»
   * y la sesión abre en la base por defecto del login).
   */
  database?: string
  /** oracle: SID (las 11g heredadas suelen ir por aquí). Excluyente con `database`. */
  sid?: string
  user: string
  /**
   * sqlite: el NOMBRE del archivo (sin carpetas), para pintarlo. La RUTA la guarda y la
   * resuelve el main (en disco, `archivo`) y no cruza nunca al renderer: es una ruta del
   * anfitrión, y el renderer no ve ni envía rutas del anfitrión. Ausente en los motores
   * de red.
   */
  archivoVisible?: string
  /**
   * Solo en los motores que lo declaran en `conexion.opcionales` (SQL Server): instancia
   * con nombre (`SQLEXPRESS`). Con instancia, el PUERTO NO SE USA: lo resuelve el servicio
   * SQL Browser del servidor (UDP 1434), y el driver no admite los dos a la vez. Ausente o '' = la instancia por defecto, por el puerto.
   */
  instancia?: string
  /** Ver `DbAutenticacion`. Ausente = 'sql'. */
  autenticacion?: DbAutenticacion
  /** Dominio de la cuenta con `autenticacion: 'ntlm'` (`DOMINIO`). Obligatorio con ella. */
  dominio?: string
  /**
   * Ver `DbTls`. Ausente = el `tlsPorDefecto` del motor
   * (`tlsDeConexion` de `motores/index.ts`), y sin él `TLS_POR_DEFECTO`.
   */
  tls?: DbTls
  /**
   * Solo MongoDB: `mongodb+srv://`, el host es un nombre DNS cuyos
   * registros SRV/TXT dan los miembros y opciones (Atlas). Sin puerto (el driver no lo
   * admite con SRV) y con TLS salvo que la URI diga lo contrario. Ausente = false.
   */
  srv?: boolean
  /**
   * Solo MongoDB: el resto de la URI, lo que va detrás de `?`
   * (`authSource=admin&replicaSet=rs0`), SIN las opciones de TLS (van en `tls`) y solo con
   * las claves de la lista blanca de `shared/uriConexion.ts` (`validarOpcionesUriMongo`):
   * lo valida el main al guardar. Ausente o '' = ninguna. Con UN host, sin `replicaSet` ni
   * `directConnection` ni `srv`, el trabajador añade `directConnection=true` (lo que hace
   * mongosh).
   */
  opcionesUri?: string
  /** ¿Tiene contraseña guardada? (el valor jamás sale del main). */
  tieneSecreto: boolean
  /**
   * Hay contraseña guardada pero ESTE equipo no puede descifrarla: el cifrado es
   * DPAPI, atado a tu usuario y a tu máquina, así que un `userData` copiado a otro
   * PC (o un cambio de cuenta de Windows) la deja ilegible. Se distingue de "no hay
   * contraseña" porque el remedio es otro —volver a escribirla— y sin decirlo el
   * síntoma es un mensaje que parece no tener arreglo.
   */
  secretoIlegible?: boolean
  /**
   * La última prueba contra el servidor fue BUENA. Solo las verificadas se pueden
   * montar en un proyecto: montar algo que nunca respondió deja al agente creyendo
   * que tiene una base a la que en realidad no llega, y el fallo aparece a mitad de
   * un análisis en vez de al configurarla.
   *
   * Se pone al pasar "Probar" y se retira al editar el destino o la contraseña (lo
   * verificado era la conexión anterior, no la nueva).
   */
  verificada?: boolean
  /** Si true, `tdb` fuerza transacción de solo lectura y rechaza escrituras. */
  readonly: boolean
  /**
   * Entorno. Ausente = sin entorno. En `produccion` el explorador pide confirmación antes
   * de cada escritura, sus consolas nuevas arrancan en Tx Manual y se marca en rojo.
   */
  entorno?: DbEntorno
  notas?: string
  /**
   * Driver que esta conexión resolvió la última vez (id de pack, p.ej.
   * `oracle-ic-19`), o `null` si le basta el modo thin empaquetado. Es una CACHÉ:
   * si desaparece, se vuelve a resolver sondeando.
   */
  driverId?: string | null
  /**
   * Esquemas que el explorador enseña en el árbol («N de M»).
   * Opcional a propósito: las conexiones anteriores no lo tienen y los tests que
   * construyen un `DbConnection` a mano no deben romperse. Ausente equivale a
   * `ESQUEMAS_VISIBLES_INICIAL` (solo el esquema por defecto).
   */
  esquemas?: DbEsquemasVisibles
  /**
   * Las BASES que enseña el nivel «Bases» del árbol (con la
   * misma forma que `esquemas`; `porDefecto` = la base por defecto del
   * login, que es donde abre la sesión). Solo lo usa una conexión con nivel «Bases»
   * (`tieneNivelBases` de `shared/motores`: SQL Server sin base fija). Ausente = solo la
   * base por defecto, como `ESQUEMAS_VISIBLES_INICIAL`.
   */
  bases?: DbEsquemasVisibles
  /**
   * Lo último que la introspección supo del servidor, para pintar la insignia
   * "N de M" y "Por defecto (X)" SIN conectar. Es una caché: si falta, la insignia
   * espera a que se abra la sesión.
   */
  introspeccion?: DbIntrospeccion
}

/**
 * Selección de esquemas visibles en el explorador.
 *
 * `porDefecto` es DINÁMICO: significa "el esquema actual de la sesión, sea cual
 * sea", no un nombre congelado. Así, cambiar el usuario de la conexión no deja
 * marcado el esquema del usuario anterior.
 */
export type DbEsquemasVisibles =
  | { modo: 'todos' }
  | { modo: 'lista'; porDefecto: boolean; esquemas: string[] }

/** Valor por defecto: solo el esquema por defecto. */
export const ESQUEMAS_VISIBLES_INICIAL: DbEsquemasVisibles = {
  modo: 'lista',
  porDefecto: true,
  esquemas: []
}

/** Resumen persistido de la última introspección (ver `DbConnection.introspeccion`). */
export interface DbIntrospeccion {
  totalEsquemas: number
  esquemaPorDefecto: string
  /** Epoch ms de la lectura. */
  en: number
}

/** Alta/edición. `password` solo viaja UI -> main, nunca de vuelta. */
export interface DbConnectionInput {
  profileId: string
  alias: string
  motor: DbMotor
  host: string
  port: number
  database?: string
  sid?: string
  user: string
  /**
   * Motores de archivo: de dónde sale el archivo (ver `DbOrigenArchivo`). En `update`,
   * ausente = conserva el guardado. Los motores de red lo ignoran.
   */
  archivo?: DbOrigenArchivo
  /**
   * Los campos de `DbConnection` con el mismo nombre, solo para los motores que
   * los declaran en `conexion.opcionales` (el main descarta los de un motor que no los
   * declara). En `update`, ausentes = sin valor (se envían siempre enteros, como el resto
   * del destino).
   */
  instancia?: string
  autenticacion?: DbAutenticacion
  dominio?: string
  tls?: DbTls
  /** Ver `DbConnection.srv` y `DbConnection.opcionesUri`. */
  srv?: boolean
  opcionesUri?: string
  /** En `update`, `undefined` = conserva la guardada; `''` = borra la guardada. */
  password?: string
  readonly: boolean
  /** Ausente o `undefined` = sin entorno. */
  entorno?: DbEntorno
  notas?: string
}

/**
 * Entorno de una conexión: tres niveles con su
 * color (verde, ámbar, rojo). Sin entorno es lo de siempre y no se pinta nada.
 */
export type DbEntorno = 'desarrollo' | 'pruebas' | 'produccion'

/** Los entornos en el orden en que se ofrecen. */
export const ENTORNOS: readonly DbEntorno[] = ['desarrollo', 'pruebas', 'produccion']

/** Nombre visible de cada entorno. */
export const NOMBRE_ENTORNO: Record<DbEntorno, string> = {
  desarrollo: 'Desarrollo',
  pruebas: 'Pruebas',
  produccion: 'Producción'
}

/** ¿Es un entorno válido? (lo que llega del disco o del renderer se valida con esto). */
export function esEntorno(v: unknown): v is DbEntorno {
  return v === 'desarrollo' || v === 'pruebas' || v === 'produccion'
}

/** Resultado de "Probar conexión": lo que se pinta en el panel. */
export interface DbTestResult {
  ok: boolean
  /** Mensaje para el usuario. En caso de fallo, el error CRUDO (sirve para depurar VPN). */
  mensaje: string
  /** Banner de versión del servidor, si conectó. */
  servidor?: string
  /** Milisegundos del handshake, si conectó. */
  ms?: number
  /**
   * Presente cuando el fallo es "falta un driver para esta versión de servidor".
   * El panel lo convierte en el botón "Descargar e instalar".
   */
  requiereDriver?: DriverRequerido
}

export interface DriverRequerido {
  packId: string
  /** Versión del servidor detectada, que es la que obliga a este pack. */
  versionServidor?: string
  /** Texto para el usuario ("Oracle 11.2 necesita el cliente Oracle 19"). */
  motivo: string
}

// --- Drivers ----------------------------------------------------------------

/**
 * Un "pack" de driver descargable. Es DATO, no código: añadir una versión de
 * Instant Client es añadir una entrada, no una release de Tessera.
 */
export interface DriverPack {
  id: string
  motor: DbMotor
  /** Nombre visible ("Oracle Instant Client 19.28 (Basic Light)"). */
  nombre: string
  sizeMB: number
  /** Rango de versiones de SERVIDOR que este pack alcanza, para la UI. */
  cubre: string
  /**
   * ¿Se puede DESCARGAR automáticamente? `false` cuando Oracle retiró ese cliente de
   * su CDN público y solo queda en el archivo histórico, que exige iniciar sesión y
   * aceptar la licencia a mano. La interfaz usa esto para NO enseñar un botón de
   * descarga que solo puede acabar en 404. También `false` cuando ESTE sistema no puede
   * usar el cliente (`noDisponible` dice por qué).
   */
  descargable: boolean
  /**
   * Aviso que acompaña a `cubre` cuando el pack alcanza versiones fuera del soporte de
   * Oracle («11.2–18c están fuera del soporte de Oracle; probado.»). Tessera informa,
   * no prohíbe: el pack se ofrece igual.
   */
  aviso?: string
  /**
   * Por qué este sistema no puede descargar el pack aunque exista (hoy: un macOS
   * anterior al que exigen sus bibliotecas). Sustituye a la nota genérica de «Oracle ya
   * no lo publica», que aquí sería falsa.
   */
  noDisponible?: string
}

export interface DriverStatus extends DriverPack {
  /** ¿Está ya instalado y utilizable? */
  instalado: boolean
  /** Carpeta donde vive (la descargada, o la que apuntó el usuario). */
  ruta?: string
  /** true si el usuario lo apuntó a mano en vez de descargarlo. */
  externo?: boolean
}

/** Progreso de descarga, emitido por evento mientras `install` está en vuelo. */
export interface DriverProgress {
  packId: string
  /** 0..100, o null si el servidor no informó el tamaño. */
  porcentaje: number | null
  /**
   * `instalando` es la del .dmg de Mac (montar, copiar, verificar la firma, desmontar):
   * no se descomprime nada, y «Descomprimiendo…» habría descrito otra cosa.
   */
  fase: 'descargando' | 'descomprimiendo' | 'instalando' | 'listo' | 'error'
  mensaje?: string
}

export const DB_CHANNELS = {
  /** invoke: conexiones del perfil (sin secretos). ListRequest -> DbConnection[] */
  LIST: 'db:list',
  /**
   * invoke: las conexiones del perfil Y las que esta versión no sabe abrir (de un motor
   * que no conoce, o de uno que conoce guardadas de una forma que no reconoce; ver
   * `DbConexionAjena`), de UNA MISMA lectura del registro, más la marca de si el archivo
   * entero tiene un formato que no reconoce (`formatoAjeno`, con su `aviso`). {profileId}
   * -> DbListaConexiones. Juntas y no en dos llamadas: quien poda por ids vivos (la
   * selección del árbol, los montajes) tiene que verlas a la vez, o daría por muerta una
   * ajena que llegó un instante después. Y con `formatoAjeno` NO se poda nada: las listas
   * vienen vacías porque no se entiende el archivo, no porque no haya conexiones. Las
   * ajenas se borran con DELETE, como las demás; `db:changed` avisa también de sus cambios.
   */
  LIST_COMPLETA: 'db:list:completa',
  /** invoke: alta. DbConnectionInput -> DbConnection */
  CREATE: 'db:create',
  /** invoke: edición. {id, input} -> DbConnection */
  UPDATE: 'db:update',
  /**
   * invoke: baja. DbBorrarConexion -> DbConexionBorrada. Borra UNA entrada: la fila
   * pulsada dice si es la conocida o la ajena (`ajena`), porque las dos pueden compartir
   * id si alguien editó el registro a mano, y de
   * qué perfil es (`profileId`: solo entre las suyas).
   */
  DELETE: 'db:delete',
  /** invoke: fija el orden de un perfil (arrastre). {profileId, ids} -> void */
  REORDER: 'db:reorder',
  /** invoke: prueba real contra el servidor. {id} -> DbTestResult */
  TEST: 'db:test',
  /**
   * invoke: fija las bases MONTADAS de un proyecto. {profileId, projectHostPath, ids} -> void
   *
   * Es lo que aplica el montaje EN CALIENTE. El ámbito se guarda por PROYECTO y no
   * por sesión a propósito: un proyecto tiene el pane del agente y N terminales de
   * abajo, y todas deben ver lo mismo sin que el renderer tenga que ir enterándose
   * de qué sesiones hay vivas.
   *
   * No sustituye a mandar `dbConnectionIds` al abrir: eso siembra el ámbito inicial
   * (y es el respaldo si el puente no levantó). Esto lo cambia en caliente.
   */
  SET_SCOPE: 'db:scope:set',
  /** invoke: estado de los packs de driver. -> DriverStatus[] */
  DRIVERS_LIST: 'db:drivers:list',
  /** invoke: descarga + instala un pack. {packId} -> DriverStatus */
  DRIVERS_INSTALL: 'db:drivers:install',
  /** invoke: registra un driver que el usuario YA tiene. {packId, ruta} -> DriverStatus */
  DRIVERS_USE_EXISTING: 'db:drivers:useExisting',
  /**
   * invoke: diálogo nativo para elegir la carpeta de un cliente ya instalado.
   * Sin argumentos -> ruta elegida, o null si se canceló.
   */
  DRIVERS_PICK_FOLDER: 'db:drivers:pickFolder',
  /** evento main -> renderer: progreso de descarga. DriverProgress */
  DRIVERS_PROGRESS: 'db:drivers:progress',
  /**
   * evento main -> renderer: el registro de conexiones cambió (alta, edición, baja o
   * el resultado de una prueba). Sin argumentos.
   *
   * Existe porque hay DOS vistas del mismo registro —el árbol de la vista Bases de
   * datos y el selector de montaje del header del agente— y quien actúa en una tiene
   * que verse en la otra: probar una conexión en la vista (o abrir sesión con ella al
   * desplegarla) debe habilitarla en el selector en el acto, sin cerrarlo y volverlo
   * a abrir.
   */
  CHANGED: 'db:changed',
  /**
   * invoke: crea (si hace falta) el ESPACIO DE DATOS del perfil y devuelve su ruta
   * para abrirlo como proyecto. {profileId, nombrePerfil} -> DbWorkspaceRef
   */
  WORKSPACE_ENSURE: 'db:workspace:ensure',
  /** invoke: rutas de espacio de datos de todos los perfiles, SIN crearlas.
   *  {profileIds} -> Record<profileId, ruta> */
  WORKSPACE_PATHS: 'db:workspace:paths',
  // --- Motores de ARCHIVO (SQLite). Canales NEUTROS de motor: el motor
  // va en la petición, y los filtros del diálogo salen de su descriptor
  // (`conexion.extensionesArchivo`).
  /**
   * invoke: diálogo nativo de ABRIR para elegir el archivo de un motor de archivo.
   * {motor} -> DbArchivoElegido, o null si se canceló. La ruta se queda en el main (ver
   * `DbOrigenArchivo`).
   */
  ARCHIVO_ELEGIR: 'db:archivo:elegir',
  /**
   * invoke: diálogo nativo de GUARDAR para CREAR una base nueva (vacía y válida; en SQLite,
   * `crearBaseNueva` de `src/tdb/sqliteComun.cjs`). {motor} -> DbArchivoElegido, o null si
   * se canceló. Es un archivo que crea Tessera: la conexión que se dé de alta con él puede
   * ser de escritura.
   */
  ARCHIVO_CREAR: 'db:archivo:crear',
  /**
   * invoke: un archivo SOLTADO sobre el árbol de Conexiones. Lo manda el PRELOAD con la
   * ruta que resuelve `webUtils.getPathForFile` (el renderer no la ve). {motor, ruta} ->
   * DbArchivoElegido.
   */
  ARCHIVO_SOLTADO: 'db:archivo:soltado',
  /**
   * invoke: «Montar como base de datos» desde el explorador de archivos.
   * DbMontarArchivoRequest -> DbMontarArchivoRespuesta. Desmontar es `SET_SCOPE`, como
   * cualquier otra conexión.
   */
  ARCHIVO_MONTAR: 'db:archivo:montar',
  /**
   * invoke: ¿qué conexión del perfil apunta ya a este archivo del proyecto (el mismo archivo
   * REAL, como al montar)? DbMontarArchivoRequest -> DbConexionDeArchivo. Lo pregunta el
   * menú del explorador de archivos al abrirse, para ofrecer «Desmontar» en vez de «Montar»
   * sin comparar nombres (dos `datos.db` en carpetas distintas son dos bases). No crea nada.
   */
  ARCHIVO_CONEXION: 'db:archivo:conexion'
} as const

/** Respuesta de `ARCHIVO_CONEXION`: el id de la conexión de ese archivo, o null si no hay. */
export type DbConexionDeArchivo = { id: string } | null

/**
 * Referencia al espacio de datos de un perfil: una carpeta REAL que se abre como un
 * proyecto más, de modo que hereda la columna del agente, el historial de
 * conversaciones y el inspector sin código propio. La ruta la produce el MAIN (el
 * renderer nunca inventa rutas de proyecto; ver el invariante en `tabsModel`).
 */
export interface DbWorkspaceRef {
  projectHostPath: string
  /** Lo que se pinta en la pestaña. */
  name: string
}

/** Petición de `SET_SCOPE`: las bases montadas de un proyecto, tal cual. */
export interface SetScopeRequest {
  profileId: string
  projectHostPath: string
  ids: string[]
}

export interface ListConnectionsRequest {
  profileId: string
}

/**
 * Tope de longitud del alias. No es una regla de formato: es la única cota, y existe
 * solo para que un pegado accidental de media pantalla no reviente la UI.
 */
export const ALIAS_MAX = 120

/**
 * Nombre de la variable de entorno que lleva el secreto de una conexión al proceso
 * `tdb`. Se indexa por el **id** (uuid), NO por el alias.
 *
 * Por qué el id: el alias es un nombre libre del usuario y puede llevar espacios,
 * acentos o símbolos; derivar de él un nombre de variable obligaría a normalizarlo,
 * y dos nombres distintos ("Ventas PROD" y "ventas-prod") colapsarían al mismo
 * nombre y se pisarían el secreto en silencio. El id es único por construcción, así
 * que el usuario puede llamar a sus conexiones como quiera.
 *
 * Compartido entre quien inyecta (main) y quien lee (`tdb`): un solo sitio.
 */
export function envVarSecreto(connectionId: string): string {
  return `TESSERA_DB_SECRET_${connectionId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * Variable que acompaña a cada `envVarSecreto`: la HUELLA del destino para el que se emitió
 * esa contraseña (`huellaDestino` de `src/main/db/huellaDestino.ts`). `tdb` lee el registro
 * en cada invocación, y el secreto se fijó al abrir la terminal; sin la huella, una conexión
 * que cambió de servidor por medio —o la copia con el mismo id que queda al borrar la
 * original— recibía una contraseña que no era para ella. No es un
 * secreto: por eso NO empieza por `TESSERA_DB_SECRET_`, que es lo que cuentan como
 * contraseñas `tdb doctor` y las pruebas.
 */
export function envVarDestino(connectionId: string): string {
  return `TESSERA_DB_DESTINO_${connectionId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** Variable con el perfil activo de la sesión: `tdb ls` filtra por ella. */
export const ENV_PERFIL = 'TESSERA_PROFILE'
/** Variable con la ruta del registro de conexiones (para que `tdb` lo lea). */
export const ENV_REGISTRO = 'TESSERA_DB_REGISTRY'
/** Variable con la carpeta de drivers instalados. */
export const ENV_DRIVERS = 'TESSERA_DB_DRIVERS'
/**
 * Ámbito de la sesión: ids de conexión MONTADOS, separados por coma. `tdb` solo ve
 * esos. Una cadena VACÍA significa "ninguna".
 *
 * Su AUSENCIA significaba "todas las del perfil" y la usaba la antigua consola de
 * datos. Ya no la omite nadie: el agente de la vista de bases de datos usa el
 * selector de montaje como cualquier proyecto. `tdb` conserva la lectura de la
 * ausencia solo para no romper un pty arrancado por una versión anterior.
 */
export const ENV_SCOPE = 'TESSERA_DB_SCOPE'
/**
 * Marca INFORMATIVA: `'1'` si la terminal es la del ESPACIO DE DATOS del perfil (el
 * agente de la vista Bases de datos). Ausente = la de un proyecto.
 *
 * NO cambia el ámbito ni ningún secreto: el espacio ve lo montado, como cualquier
 * proyecto. Solo decide la REDACCIÓN de los mensajes de `tdb`, que en el espacio dicen
 * «el agente de datos» en vez de «este proyecto» — para el usuario el espacio no es un
 * proyecto, y un mensaje que lo llama así lo manda a buscar uno que no ha abierto.
 *
 * Es el RESPALDO: con el puente vivo, la misma marca llega en la respuesta de
 * `resolve` (`espacioDatos`) y manda sobre esta, igual que el ámbito. Aquí cubre el
 * contrato `env` (sin puente) y un puente que no contesta.
 *
 * No está en `ENV_CONTENEDOR`, y a propósito: el espacio de datos vive SIEMPRE en
 * modo nativo (`App.toggleWindowsMode` se niega a pasarlo a Docker), y si algún día
 * no fuera así, el `tdb` real de un contenedor corre en el host con el token de la
 * sesión, así que la marca le llegaría igual por la respuesta del puente.
 */
export const ENV_ESPACIO = 'TESSERA_DB_ESPACIO'

// --- Puente local -----------------------------------------------------------
// Las variables del contrato NUEVO. Con ellas, `tdb` no lee ninguna contraseña del
// entorno: le pregunta a Tessera en el momento de ejecutarse, y de paso recibe el
// ámbito VIGENTE en vez del que hubiera al arrancar el pty. Eso es exactamente lo
// que hace que marcar una casilla aplique sin reiniciar la sesión del agente.

/** Nombre del named pipe de ESTA instancia de Tessera (aleatorio por arranque). */
export const ENV_PIPE = 'TESSERA_DB_PIPE'
/** Token de la sesión. Es lo único secreto que queda en el entorno del pty. */
export const ENV_SESION = 'TESSERA_DB_SESSION'
/**
 * Qué contrato rige: `pipe` (el puente sirve ámbito y secretos) o `env` (el antiguo,
 * con las contraseñas en variables). Se declara EXPLÍCITAMENTE para que `tdb` no
 * tenga que adivinar: sin esta variable, "no hay secretos en el entorno" y "el puente
 * no ha contestado" se parecen demasiado, y llevan a mensajes distintos.
 */
export const ENV_MODO = 'TESSERA_DB_MODE'
/**
 * Carpeta del BUZÓN del puente vista DESDE DENTRO del contenedor. En modo Docker no
 * hay named pipe que alcanzar, así que `tdb` deja ahí la petición y el host la recoge.
 */
export const ENV_BUZON = 'TESSERA_DB_BRIDGE'

/**
 * Las ÚNICAS variables que cruzan a un contenedor. Vive AQUÍ, y no repetida en cada
 * sitio que la necesita, por un fallo real: la lista estaba escrita a mano en
 * `TerminalService` (los `-e` de `docker exec`) pero NO en la línea de arranque del
 * agente, que corre bajo `env -i` y por tanto BORRA todo lo que llegó por `-e`. La
 * terminal de abajo veía las bases y el pane del agente no, con el mismo montaje y
 * sin ningún error: `tdb` decía "esta terminal no lleva el contexto" y la respuesta
 * —recargar— no arreglaba nada, porque el problema no era la sesión.
 *
 * Ninguna contraseña está aquí ni puede estarlo: en modo Docker el entorno son un
 * token y una ruta, y la consulta la ejecuta el host (ver `entornoContenedor`).
 * Tampoco `ENV_ESPACIO`: el porqué, en su declaración.
 */
export const ENV_CONTENEDOR = [ENV_MODO, ENV_SESION, ENV_BUZON] as const

/**
 * Clave con la que el puente indexa la sesión del PANE DEL AGENTE, para no chocar
 * con la de la terminal de abajo.
 *
 * NO es cosmética. El pane del agente y la terminal de abajo tienen cada uno su
 * `TerminalService`, y cada instancia numera desde cero: en el perfil `alfa` las dos
 * sesiones se llaman `term-alfa-1`. Está en `logs/db.log` tal cual —`term-personal-1
 * launch=agente` y, minutos después, `term-personal-1 launch=interactiva`—. Como
 * `DbBridge.bind` BORRA el token anterior de esa clave (para que una recarga no deje
 * tokens huérfanos, que serían oráculos de credenciales), la segunda en atarse
 * revocaba la primera: abrir el agente dejaba sin bases a la terminal de abajo, o al
 * revés según el orden. Es la MISMA asimetría que motivó `ENV_CONTENEDOR`, por otra
 * puerta, y por eso el refcount del contenedor ya namespacea igual (`agent:<id>`).
 */
export function claveSesionAgente(sessionId: string): string {
  return `agent:${sessionId}`
}
