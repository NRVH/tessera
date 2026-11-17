// =============================================================================
// Contrato IPC de git (main <-> preload <-> UI): historia, diff, estado del working-tree y
// escrituras (preparar, descartar, commit, ignorar). Todo es invoke (renderer -> main) salvo
// `STATUS_PARCIAL`. Las rutas son POSIX relativas a la contenedora: el renderer nunca ve rutas
// del host. Cada invoke lleva además la contenedora de su proyecto (`PeticionGit`). `COMMIT`
// devuelve el permiso pendiente antes de ejecutar hooks no aceptados.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md,
// docs/decisiones/workspace/peticiones-de-archivos-con-su-proyecto.md
// =============================================================================
import type { EnProyecto } from './archivos-ipc'

/**
 * Lo que viaja en cada invoke de git: la petición del canal y la contenedora del proyecto al que
 * pertenece. El main la atiende en la vista de ese proyecto (`ServicioGit.paraRaiz`), nunca en el
 * anclado, para que un gesto de un proyecto no corra en los repos de otro.
 */
export type PeticionGit<R = object> = R & EnProyecto & { resolucionHooks?: ResolucionHooks }

export const GIT_CHANNELS = {
  /**
   * invoke: historia de commits del proyecto. PeticionListaCommits OPCIONAL -> Commit[].
   * Sin `branch` (o petición ausente): toda la historia (--all), como siempre.
   * Con `branch`: acotada a ESA rama.
   */
  LIST_COMMITS: 'git:listCommits',
  /** invoke: ramas locales del repo activo, para el selector del grafo. Sin argumentos. -> Branch[]. */
  LIST_BRANCHES: 'git:listBranches',
  /** invoke: archivos tocados por un commit. PeticionArchivosCommit -> CambioArchivo[]. */
  FILES_FOR_COMMIT: 'git:filesForCommit',
  /**
   * invoke: commits que tocaron un archivo, cruzando renames.
   * PeticionHistorialArchivo -> ResultadoHistorialArchivo (los commits Y el repo dueño; ver ese tipo).
   */
  FILE_HISTORY: 'git:fileHistory',
  /** invoke: contenido de un archivo en un commit dado. PeticionBlobEnCommit -> ResultadoBlob. */
  BLOB_AT_COMMIT: 'git:blobAtCommit',
  /**
   * invoke: BYTES crudos de un lado del diff, sea cual sea su origen (commit,
   * índice o disco). PeticionBytesBlob -> ResultadoBytesBlob.
   *
   * Hermano BINARIO de BLOB_AT_COMMIT/INDEX_BLOB/WORKING_BLOB, y existe porque
   * esos tres devuelven TEXTO: para una imagen sólo traían la marca `binary` y el
   * diff no tenía con qué pintarla. Un canal único (y no tres binarios) porque el
   * renderer ya describe cada lado con la misma forma —origen + hash + ruta— y
   * partirlo en tres obligaría a repetir ese `switch` en el visor.
   *
   * Tope de 50 MiB, el de las lecturas binarias de ServicioArchivos, no los 2 MiB del
   * diff de texto: ahí el tope protege a Monaco de un archivo enorme, y aquí lo
   * que se pinta es una imagen.
   */
  BLOB_BYTES: 'git:blobBytes',
  /** invoke: primer padre (DAG real) de un commit. PeticionPrimerPadre -> ResultadoPrimerPadre. */
  PARENT_OF: 'git:parentOf',
  /** invoke: cambios del working-tree del repo activo (staged, unstaged, untracked, renames, conflictos). Sin argumentos. -> CambioWorktree[]. */
  WORKING_STATUS: 'git:workingStatus',
  /**
   * invoke: rama + cambios del working-tree de VARIOS repos de la contenedora, en
   * una sola llamada. PeticionEstadoRepos -> EstadoRepo[]. Alimenta la lista
   * multi-repo del panel y las decoraciones del explorador, que abarcan TODOS los
   * repos y no solo el activo.
   */
  MULTI_STATUS: 'git:multiStatus',
  /**
   * send (main -> renderer): UN repo de la petición en curso ya tiene su estado.
   * EstadoRepoParcial. Llega mientras `MULTI_STATUS` sigue en vuelo, para que la
   * lista se pinte goteando en vez de aparecer entera al final.
   */
  STATUS_PARCIAL: 'git:statusParcial',
  /** invoke: contenido ACTUAL en disco de un archivo del working-tree (lado "after" del diff working-vs-HEAD). PeticionBlobWorktree -> ResultadoBlob. */
  WORKING_BLOB: 'git:workingBlob',
  /** invoke: descarta los cambios locales de un archivo (revierte el rastreado a HEAD o borra el no commiteado), siempre con confirmación nativa. PeticionDescarteCambios -> ResultadoDescarteCambios. */
  DISCARD_CHANGES: 'git:discardChanges',
  /** invoke: añade un archivo al índice (stage). PeticionPrepararArchivo -> ResultadoEscrituraGit. */
  STAGE_FILE: 'git:stageFile',
  /** invoke: quita un archivo del índice (unstage), preservando los cambios en disco. PeticionQuitarArchivoDelIndice -> ResultadoEscrituraGit. */
  UNSTAGE_FILE: 'git:unstageFile',
  /** invoke: prepara VARIOS archivos de una vez (un proceso de git por repo). PeticionRutasGit -> ResultadoArchivo[]. */
  STAGE_FILES: 'git:stageFiles',
  /** invoke: quita VARIOS archivos del índice de una vez. PeticionRutasGit -> ResultadoArchivo[]. */
  UNSTAGE_FILES: 'git:unstageFiles',
  /** invoke: descarta VARIOS archivos con UNA sola confirmación. PeticionRutasGit -> ResultadoDescarte[]. */
  DISCARD_CHANGES_MANY: 'git:discardChangesMany',
  /** invoke: añade patrones al .gitignore de la raíz del repo. PeticionIgnorar -> ResultadoIgnorar. */
  IGNORAR_GITIGNORE: 'git:ignorarEnGitignore',
  /** invoke: añade patrones a .git/info/exclude (local, nunca se sube). PeticionIgnorar -> ResultadoIgnorar. */
  IGNORAR_EXCLUDE_LOCAL: 'git:ignorarEnExcludeLocal',
  /** invoke: crea un commit con lo que esté staged. PeticionCommit -> ResultadoCommit. */
  COMMIT: 'git:commit',
  /** invoke: contenido de un archivo en el ÍNDICE (versión staged), para el diff staged-vs-HEAD. PeticionBlobIndice -> ResultadoBlob. */
  INDEX_BLOB: 'git:indexBlob',
  /** invoke: detalle COMPLETO de UN commit (cuerpo del mensaje, committer). PeticionDetalleCommit -> DatosDetalleCommit | null. */
  COMMIT_DETAIL: 'git:commitDetail',
  /** invoke: ramas (locales y remotas) que CONTIENEN un commit. PeticionRamasQueContienen -> string[]. */
  BRANCHES_CONTAINING: 'git:branchesContaining',
  /**
   * invoke: hashes alcanzables desde HEAD, para teñir en el log los commits que
   * SÍ están en la rama actual. PeticionCommitsRamaActual -> ResultadoCommitsRamaActual.
   *
   * Canal SEPARADO de LIST_COMMITS aunque ambos alimenten la misma lista, por el
   * mismo motivo que BRANCHES_CONTAINING está separado de COMMIT_DETAIL: el log
   * tiene que pintarse ya, y esto es un recorrido completo de la historia. Unidos,
   * la lista entera esperaría al lento; separados, los commits salen de inmediato
   * y el tinte llega detrás.
   */
  COMMITS_RAMA_ACTUAL: 'git:commitsRamaActual'
} as const

/** Estado de un archivo dentro de un commit: alta, modificado, borrado o rename. */
export type EstadoArchivo = 'A' | 'M' | 'D' | 'R'

/** Un commit de la historia. Los `parents` son la base del grafo. */
export interface Commit {
  /** sha completo (40 hex), de git %H. */
  hash: string
  /** Hashes de los padres: 0 en el commit raíz, 1 en un commit normal, 2+ en un merge. */
  padres: string[]
  /** %an, UTF-8 intacto. */
  nombreAutor: string
  /** %ae. */
  emailAutor: string
  /** %aI, ISO-8601. */
  fechaIso: string
  /** %s. */
  asunto: string
  /**
   * Refs que APUNTAN a este commit (%D con `--decorate=short`), ya partidas por
   * su separador `, `: p. ej. `['HEAD -> main', 'origin/main', 'tag: v1.2']`.
   * Vacío en la inmensa mayoría de commits (solo los tips llevan refs).
   *
   * Se entregan CRUDAS a propósito: distinguir rama local de remota o de tag
   * mirando el prefijo no es fiable (un remoto puede llamarse como quiera y una
   * rama local puede llamarse `origin/algo`). La clasificación la hace el
   * renderer cruzando estos tokens contra el `Branch[]` que ya tiene cargado,
   * que es la única fuente que sabe qué remotos existen de verdad.
   *
   * NO se añadieron aquí `%h` (hash corto) ni `%b` (cuerpo): `%h` depende de
   * `core.abbrev` y de la ambigüedad del repo, así que su longitud varía entre
   * llamadas y haría bailar la columna —se deriva en el renderer—; y `%b` es
   * MULTILÍNEA, y este formato parsea por líneas, así que un cuerpo de dos
   * párrafos produciría commits fantasma con campos vacíos. El cuerpo se pide
   * por COMMIT_DETAIL, de uno en uno, que es como se mira.
   */
  refs: string[]
}

/**
 * Detalle completo de UN commit, para el panel de detalle del log. Lo que
 * `Commit` deja fuera por no caber en una lista de miles: el cuerpo del mensaje
 * y los datos del committer (que difieren del autor en un cherry-pick, un
 * rebase o un merge de PR).
 */
export interface DatosDetalleCommit {
  hash: string
  padres: string[]
  nombreAutor: string
  emailAutor: string
  /** %aI: cuándo se ESCRIBIÓ el cambio. */
  fechaIso: string
  /** %cn: quién lo APLICÓ (difiere del autor tras un rebase/cherry-pick/merge de PR). */
  nombreAplicador: string
  /** %ce. */
  emailAplicador: string
  /** %cI: cuándo se aplicó. */
  fechaIsoAplicacion: string
  /** %s: primera línea. */
  asunto: string
  /** %b: el resto del mensaje, con sus saltos de línea intactos. '' si no hay. */
  cuerpo: string
  /** Igual que Commit.refs. */
  refs: string[]
}

/** Un archivo tocado por un commit. */
export interface CambioArchivo {
  estado: EstadoArchivo
  /** Ruta RELATIVA POSIX al proyecto (destino/nueva en el caso de un rename). */
  ruta: string
  /** SOLO presente cuando status es 'R': ruta origen del rename. Clave para poder renderizar "de -> a" en el diff. */
  rutaAnterior?: string
}

/** Referencia a un commit dentro de la historia de un archivo. */
export interface ReferenciaCommitArchivo {
  hash: string
  asunto: string
  /** Autor del commit (nombre corto), para la columna del historial. */
  autor: string
  /** Fecha de autoría en ISO, para formatearla en el renderer. */
  fechaIso: string
}

/**
 * La historia de un archivo Y EL REPO EN EL QUE SE RESOLVIÓ. El repo viaja de vuelta porque en una
 * contenedora multi-repo las llamadas siguientes (archivos del commit, padre, blobs) deben ir al repo
 * dueño del archivo y no al del proyecto activo, donde los hashes no existen.
 */
export interface ResultadoHistorialArchivo {
  /** Ruta HOST del repo dueño del archivo, para pasársela a las llamadas siguientes. */
  rutaHostRepo: string
  commits: ReferenciaCommitArchivo[]
}

/**
 * Una rama del repo activo (LOCAL o REMOTA), para el árbol de ramas y el
 * selector del grafo: el nombre corto (que se pasa tal cual como ref a
 * LIST_COMMITS), si es la rama actual (HEAD) y si es remota.
 */
export interface Rama {
  /**
   * Nombre corto de la rama, tal cual lo consume `git log <ref>`. Para
   * locales es solo el nombre (p.ej. "main"); para remotas incluye el remoto
   * (p.ej. "origin/main").
   */
  nombre: string
  /** true solo en la rama a la que apunta HEAD; false en las demás (y en todas si HEAD está detached). Siempre false en remotas. */
  esActual: boolean
  /** true si es una rama REMOTA (refs/remotes, p.ej. "origin/main"); false si es local (refs/heads). */
  esRemota: boolean
  // Sin `tip` (el sha de la punta): el árbol de ramas filtra por nombre y un campo que nadie lee se paga en cada respuesta.
}

/**
 * Petición OPCIONAL de LIST_COMMITS. Ausente, o con `branch` ausente/undefined,
 * reproduce el comportamiento histórico (--all: todas las ramas). Con `branch`,
 * el grafo se acota a esa ref.
 */
export interface PeticionListaCommits {
  /** Nombre corto de la rama a graficar; undefined -> todas las ramas (--all). */
  rama?: string
  /**
   * Máximo de commits a devolver (git `--max-count`). undefined/0 -> SIN límite
   * (todo el historial, comportamiento histórico). El renderer pide una página
   * acotada por defecto para NO traer decenas de miles de commits (parseo + IPC)
   * en repos gigantes; ofrece "cargar historial completo" bajo demanda.
   */
  limite?: number
  /** Repo al que se pregunta. Ver `repo` en PeticionArchivosCommit. */
  repo?: string
}

/** Petición de las ramas de un repo. */
export interface PeticionListaRamas {
  /** Repo al que se pregunta. Ver `repo` en PeticionArchivosCommit. */
  repo?: string
}

export interface PeticionArchivosCommit {
  hash: string
  /**
   * Repo al que se pregunta (`repoHostPath`). El renderer lo manda siempre que lo sabe: sin él el
   * main usa su puntero de «proyecto activo», que cambia con el perfil y haría que una petición
   * tardía corriera contra otro repo. Omitido: el repo ACTIVO.
   */
  repo?: string
}

export interface PeticionDetalleCommit {
  hash: string
  /**
   * Repo al que se pregunta (`repoHostPath`). El renderer lo manda siempre que lo sabe: sin él el
   * main usa su puntero de «proyecto activo», que cambia con el perfil y haría que una petición
   * tardía corriera contra otro repo. Omitido: el repo ACTIVO.
   */
  repo?: string
}

/**
 * Petición de "¿qué ramas contienen este commit?". Va en un canal SEPARADO de
 * COMMIT_DETAIL aunque ambos hablen del mismo commit y alimenten el mismo panel:
 * `git show -s` es instantáneo, mientras que enumerar ramas con `--contains` es
 * O(refs × historia) y en un repo con cientos de ramas remotas se nota. Unidos,
 * el detalle (asunto, autor, fecha) tendría que esperar al lento; separados, el
 * panel pinta de inmediato y las ramas rellenan después.
 */
export interface PeticionRamasQueContienen {
  hash: string
  /**
   * Repo al que se pregunta (`repoHostPath`). El renderer lo manda siempre que lo sabe: sin él el
   * main usa su puntero de «proyecto activo», que cambia con el perfil y haría que una petición
   * tardía corriera contra otro repo. Omitido: el repo ACTIVO.
   */
  repo?: string
}

/** Petición de los commits de la rama actual. `repo` opcional, como en las demás. */
export interface PeticionCommitsRamaActual {
  /** Repo concreto (`repoHostPath`). Omitido: el repo ACTIVO. */
  repo?: string
  /**
   * Commits sobre los que se pregunta. La respuesta trae SOLO los de esta lista
   * que estén en la rama actual.
   *
   * Es lo que evita que cruce el IPC una historia entera: el panel solo necesita
   * saber si tiñe las filas que tiene cargadas, y en un repo grande la diferencia
   * es de 500 hashes a 50.000, en cada montaje y en cada commit. Omitido, se
   * devuelven todos (el contrato original).
   */
  hashes?: readonly string[]
}

/**
 * Commits que están EN la rama actual, o sea alcanzables desde HEAD: el dato con el que el log
 * tiñe las filas de la rama actual. La definición es ALCANZABILIDAD y no «su rama es la actual»
 * (tras un cherry-pick hay dos commits iguales y solo uno está bajo HEAD), así que es un
 * `rev-list HEAD` y no un filtro por refs, en un solo recorrido y no un proceso por fila.
 */
export interface ResultadoCommitsRamaActual {
  /**
   * sha de HEAD cuando se calculó. Cadena vacía si el repo aún no tiene commits
   * o HEAD no resuelve; en ese caso `hashes` va vacío y no se tiñe nada.
   */
  head: string
  /**
   * Hashes completos (40 hex), sin orden garantizado.
   *
   * Si la petición traía `hashes`, esto es su SUBCONJUNTO alcanzable desde HEAD —no
   * la historia entera—, así que no vale para preguntar por un commit que no iba en
   * la petición.
   */
  hashes: string[]
}

export interface PeticionHistorialArchivo {
  /** Archivo cuya historia se pide, relativo a la raíz. POSIX. */
  ruta: string
  /** Repo al que se pregunta. Ver `repo` en PeticionArchivosCommit. */
  repo?: string
}

export interface PeticionBlobEnCommit {
  hash: string
  /** Archivo a leer en ese commit, relativo a la raíz. POSIX. */
  ruta: string
  /** Repo al que se pregunta. Ver `repo` en PeticionArchivosCommit. */
  repo?: string
}

/**
 * Qué lado del diff se quiere en BYTES. Espeja el `LadoDiff` del renderer a
 * propósito —mismo discriminador, mismos campos— para que el visor pueda pasar el
 * lado tal cual sin traducir. `'empty'` no aparece: un lado vacío no se pide, se
 * resuelve en el renderer sin tocar IPC.
 */
export interface PeticionBytesBlob {
  origen: 'commit' | 'worktree' | 'index'
  /** Sólo con source==='commit'. */
  hash?: string
  /** Archivo a leer, relativo a la contenedora del proyecto. POSIX. */
  ruta: string
}

/**
 * Bytes de un lado del diff. Mismo contrato que `ContenidoArchivoBinario` de archivos-ipc
 * (bytes + tamaño real + marca de truncado) más el `exists` que distingue "no
 * existía en esa revisión" —el lado vacío de un alta o de un borrado— de "existía
 * y pesaba cero".
 */
export interface ResultadoBytesBlob {
  existe: boolean
  /** Bytes del blob; el main devuelve Buffer y llega como Uint8Array. Ausente si !exists o truncated. */
  bytes?: Uint8Array
  /** Tamaño real en bytes, aunque no se hayan enviado (truncated). 0 si !exists. */
  tamano: number
  /** true si superó el tope de 50 MiB: `bytes` no viene y el visor debe avisar. */
  truncado: boolean
}

/**
 * Contenido de un archivo en un commit dado. NO es un string pelado: el diff
 * necesita distinguir "no existía" (lado before de un alta, lado after de un
 * borrado) de "existía y estaba vacío".
 */
export interface ResultadoBlob {
  /** false si el path no existe en ese commit (evita que el diff editor reviente al pedir un lado inexistente). */
  existe: boolean
  /** Contenido ya DECODIFICADO con `encoding`; "" si `exists` es false. */
  contenido: string
  /**
   * Codificación DETECTADA del blob (id del catálogo `shared/encodings`, p. ej. 'utf8',
   * 'windows1252'). El contenido llega ya decodificado con ella (el mismo `codificacionTexto` que el
   * editor): el renderer no ve bytes. Ausente si no hay contenido que decodificar
   * (`exists:false`, `truncated`, `isDirectory`, `binary`).
   */
  encoding?: string
  /** true si el blob es BINARIO (byte NUL en el primer tramo): no hay diff de texto y `content` queda "". */
  esBinario?: boolean
  /**
   * true si el archivo excede el tope de tamaño del diff: NO se cargó su contenido
   * (`content` queda ""), para no mandar megabytes por IPC ni ahogar a Monaco. El
   * visor de diff muestra un aviso en vez del diff. Ausente/false = contenido íntegro.
   */
  truncado?: boolean
  /**
   * true si la ruta es una CARPETA, no un archivo (p.ej. un submódulo, que git
   * reporta como un cambio cuya ruta es un directorio). No hay diff de texto que
   * mostrar: el visor lo dice con palabras en vez de reventar con EISDIR.
   */
  esCarpeta?: boolean
}

export interface PeticionPrimerPadre {
  /** Commit cuyo primer padre se pide. */
  hash: string
  /**
   * Repo al que se pregunta (`repoHostPath`). El renderer lo manda siempre que lo sabe: sin él el
   * main usa su puntero de «proyecto activo», que cambia con el perfil y haría que una petición
   * tardía corriera contra otro repo. Omitido: el repo ACTIVO.
   */
  repo?: string
}

/**
 * Primer padre de un commit, resuelto contra el DAG real (`git rev-parse <hash>^1`),
 * NO contra el historial --follow ni el grafo en memoria. En un commit raíz (sin
 * padre) rev-parse falla; eso NO es un error: se devuelve `hashPadre: null`.
 */
export interface ResultadoPrimerPadre {
  hashPadre: string | null
}

/**
 * Estado de un archivo en el working-tree. Superconjunto de EstadoArchivo: añade
 * '?' (untracked), 'C' (copy), 'T' (typechange), 'U' (unmerged/conflicto) y '.'
 * (sin cambio en ese eje). A/M/D/R como en los commits.
 */
export type EstadoArchivoWorktree = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?' | '.'

/**
 * Un archivo con cambios en el working-tree. A diferencia de CambioArchivo (un solo
 * eje, el del commit), el working-tree tiene DOS ejes independientes que git
 * reporta en el campo XY de `status --porcelain=v2`:
 *   - estadoIndice:    cambio del ÍNDICE respecto a HEAD (lo "staged"). '.' si nada.
 *   - estadoWorktree: cambio del WORKING-TREE respecto al índice (lo "unstaged"). '.' si nada.
 * Untracked => estadoIndice '.', estadoWorktree '?'. Se capturan AMBOS ejes aunque
 * la vista de este bloque los combine, para no re-tocar backend cuando llegue
 * stage/commit desde la UI.
 */
export interface CambioWorktree {
  /** Ruta POSIX relativa a la CONTENEDORA (destino/nueva en un rename). */
  ruta: string
  /** SOLO en rename ('R' en algún eje): ruta origen del rename. */
  rutaAnterior?: string
  estadoIndice: EstadoArchivoWorktree
  estadoWorktree: EstadoArchivoWorktree
}

/**
 * Petición del estado de VARIOS repos a la vez. `repos` son `repoHostPath` de
 * `RepoDetectado` (identificadores OPACOS que el renderer ya maneja). El main los
 * VALIDA contra la contenedora activa: solo acepta la propia contenedora o un repo
 * de los que ofrece el escaneo (`shared/reposAnidados.ts`), así que este parámetro no es una vía para
 * correr git en una carpeta arbitraria del host.
 */
export interface PeticionEstadoRepos {
  repos: string[]
  /**
   * Repos que el usuario está VIENDO (la ventana visible de la lista, más el
   * activo). Se atienden antes que el resto.
   *
   * Existe porque una contenedora puede tener cientos de repos —abrir la carpeta
   * padre en vez de reorganizar los proyectos es un flujo real— y sin esto el repo
   * que estás mirando esperaba su turno detrás de los otros novecientos. Omitirlo
   * es válido: entonces todos valen lo mismo y el orden es el de llegada.
   */
  prioritarios?: string[]
  /**
   * Marca de la petición. Vuelve en cada aviso parcial para que el renderer pueda
   * tirar los goteos de una petición ya superada (cambio de perfil, de proyecto)
   * sin tener que adivinar a cuál pertenecen.
   */
  gen?: number
}

/**
 * Aviso de que UN repo ya tiene su estado, mientras los demás siguen en camino.
 *
 * `leerEstadoRepos` sigue devolviendo la lista completa al final; esto es lo que
 * permite PINTAR SIN ESPERAR. Con cientos de repos, aguardar a que respondan todos
 * antes de enseñar el primero es lo que hacía que la vista pareciera colgada
 * aunque el proceso estuviera trabajando perfectamente.
 */
export interface EstadoRepoParcial {
  gen: number
  estado: EstadoRepo
}

/**
 * Estado de UN repo: su rama actual y sus cambios sin commitear. Es lo que el
 * panel necesita para pintar la cabecera colapsable (nombre + rama + conteo) y
 * su lista, sin una llamada por repo y por dato.
 */
export interface EstadoRepo {
  /** `repoHostPath` tal como se pidió: la clave con la que el renderer lo identifica. */
  repo: string
  /**
   * Rama actual (nombre corto), o null si HEAD está detached, el repo no tiene
   * commits aún, o no se pudo leer.
   */
  rama: string | null
  /** Cambios del working-tree, con rutas relativas a la CONTENEDORA (como el resto). */
  cambios: CambioWorktree[]
  /**
   * Carpeta del repo relativa a la contenedora (POSIX; '' si es la propia contenedora). Es lo que
   * la lista quita de la ruta de cada archivo para enseñarla relativa a su repo.
   */
  prefijo?: string
  /** Mensaje de error si ESTE repo falló; los demás repos siguen devolviéndose. */
  error?: string
}

export interface PeticionBlobWorktree {
  /** Archivo a leer del working-tree (disco), relativo a la raíz. POSIX. */
  ruta: string
}

/** Petición de descarte de cambios del working-tree de un archivo. */
export interface PeticionDescarteCambios {
  /** Archivo cuyos cambios locales se descartan, relativo a la raíz. POSIX. */
  ruta: string
}

/**
 * Resultado del descarte. `ok` false sin `error` = el usuario canceló la confirmación
 * (no es un fallo); con `error`, el descarte se rechazó o falló y el texto se le enseña.
 * `estabaSinSeguimiento` informa a la UI qué ocurrió (borrado de disco vs revertido a git).
 */
export interface ResultadoDescarteCambios {
  ok: boolean
  estabaSinSeguimiento: boolean
  /** Motivo legible del rechazo o del fallo; ausente si fue éxito o cancelación. */
  error?: string
}

/** Petición de stage de un archivo. */
export interface PeticionPrepararArchivo {
  ruta: string
}

/** Petición de unstage de un archivo. */
export interface PeticionQuitarArchivoDelIndice {
  ruta: string
}

/** Resultado de una operación de escritura simple (stage/unstage). ok:false + error si falló. */
export interface ResultadoEscrituraGit {
  ok: boolean
  error?: string
}

/**
 * Petición de una operación EN LOTE sobre varias rutas (contenedora-relativas,
 * POSIX). Los canales singulares se conservan tal cual: los usa el explorador y
 * los recorren `test:descartar` / `test:git-stage` de punta a punta.
 *
 * Las rutas pueden ser de REPOS DISTINTOS en un mismo lote: el backend las agrupa
 * por repo y corre un proceso de git por grupo.
 */
export interface PeticionRutasGit {
  rutas: string[]
}

/**
 * Petición de "ignorar": solo las rutas a ignorar. No lleva el universo contra el que se decide
 * si una carpeta está entera porque el renderer no puede saberlo (la lista de «Sin versionar» no
 * incluye lo que git ya rastrea): lo calcula el main con `ls-files --cached --others`.
 */
export interface PeticionIgnorar {
  rutas: string[]
}

/** Qué pasó con CADA ruta de un lote de stage/unstage. */
export interface ResultadoArchivo {
  ruta: string
  ok: boolean
  error?: string
}

/**
 * Qué pasó con cada ruta de un DESCARTE en lote. Es más que un `ok` porque la UI
 * necesita distinguir el caso: `revertido` obliga a RECARGAR la pestaña abierta
 * del archivo, `borrado` a CERRARLA, y `cancelado` no es un error (el usuario
 * dijo que no) y no debe salir en el aviso de fallos.
 */
export interface ResultadoDescarte {
  ruta: string
  estado: 'revertido' | 'borrado' | 'cancelado' | 'error'
  error?: string
}

/**
 * Resultado de añadir patrones a `.gitignore` o a `.git/info/exclude`.
 *
 * `omitidos` existe porque ignorar NO saca de git a un archivo que ya rastrea
 * (comprobado): esas rutas se dejan intactas y la UI lo dice con números en vez
 * de fingir que la acción las cubrió.
 */
export interface ResultadoIgnorar {
  /** Líneas realmente añadidas al archivo (ya colapsadas y escapadas). */
  patrones: string[]
  /** Rutas que a partir de ahora git no ve. */
  ignorados: string[]
  /** Rutas que git YA RASTREA: ignorarlas no las saca de la lista de cambios. */
  omitidos: string[]
  error?: string
}

/** Petición de commit: mensaje (multilínea permitido). */
export interface PeticionCommit {
  resolucionHooks?: ResolucionHooks
  mensaje: string
  /**
   * Repo donde commitear (`repoHostPath`), validado como en PeticionEstadoRepos.
   * Omitido: el repo ACTIVO. Con varios repos abiertos cada uno tiene su propio
   * commit box, así que la UI dice explícitamente cuál commitea.
   */
  repo?: string
}

/**
 * Resultado de un commit. ok:false con `error` legible si git rechazó (nada
 * staged, falta user.name/email, etc.). `hash` del commit creado si ok.
 */
export interface ResultadoCommit {
  pendienteHooks?: HooksPendientes
  ok: boolean
  hash?: string
  error?: string
}

export interface ResolucionHooks {
  ficha: string
  decision: 'aceptar' | 'omitir'
}

export interface HooksPendientes {
  ficha: string
  repo: string
  hooks: { nombre: string; ruta: string; estado: 'nuevo' | 'cambiado'; contenido: string; truncado: boolean }[]
  /** La carpeta no se pudo inspeccionar entera: no se puede aceptar, y el contenido del hook explica por qué. */
  incompleta?: boolean
}

/** Petición del blob del índice (versión staged) de un archivo. */
export interface PeticionBlobIndice {
  ruta: string
}
