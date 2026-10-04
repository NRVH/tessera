// =============================================================================
// Entorno que reciben las terminales de modo nativo: el único canal por el que `tdb` llega al agente y a
// la terminal. Función pura sobre datos planos (las dependencias se inyectan), probable con `node` a secas.
// El PATH con el atajo `tdb` va siempre, y el ámbito es solo lo montado; con puente no viaja ninguna
// contraseña, y sin él cada una lleva la huella de su destino.
// Decisiones: docs/decisiones/bd/puente-entorno-de-las-terminales.md
// =============================================================================
import path from 'node:path'
import {
  ENV_DRIVERS,
  ENV_ESPACIO,
  ENV_MODO,
  ENV_PERFIL,
  ENV_PIPE,
  ENV_REGISTRO,
  ENV_SCOPE,
  ENV_SESION,
  envVarDestino,
  envVarSecreto,
  type DbListaConexiones
} from '../../shared/db-ipc.ts'
import { huellaDestino, type DestinoBd } from './huellaDestino.ts'

/**
 * Lo mínimo que hace falta saber de una conexión para construir el entorno: su id, su perfil y su destino
 * (para la huella que acompaña a su contraseña). En producción, el DTO de `list()`.
 */
export interface ConexionParaEntorno extends DestinoBd {
  id: string
  profileId: string
}

/** Dependencias inyectadas. En producción las sirve `DbController`. */
export interface EntornoHostDeps {
  /** Carpeta de los atajos (`tdb`, `tdb.ps1`, `tdb.cmd`) que se antepone al PATH. */
  binDir: string
  /** Ruta del registro de conexiones que leerá `tdb`. */
  registryPath: string
  /** Carpeta de clientes de base de datos (Instant Client). */
  driversDir: string
  /** TODAS las conexiones de un perfil, en orden. */
  conexionesDelPerfil: (profileId: string) => ConexionParaEntorno[]
  /** Secreto descifrado de una conexión, o null si no hay o es ilegible. */
  secretoDe: (id: string) => string | null
  /**
   * Ruta del ESPACIO DE DATOS del perfil. Solo para el diagnóstico y para la marca
   * informativa de `tdb`: el espacio ve lo montado, como cualquier proyecto. Ver el
   * ADR.
   */
  espacioDeDatos: (profileId: string) => string
  /**
   * Puente local, si está levantado. Con él, el pty NO recibe ninguna contraseña:
   * recibe un token, y `tdb` le pregunta a Tessera en cada invocación. Eso es lo que
   * hace que montar y desmontar apliquen sin reiniciar la sesión.
   *
   * Ausente = contrato antiguo (secretos en variables). Se conserva a propósito como
   * respaldo: si el pipe no levanta, es preferible una terminal que funcione con el
   * modelo viejo a una que no funcione.
   */
  puente?: {
    pipe: string
    /**
     * Acuña el token de ESTA sesión. No recibe ningún "ver todas": el ámbito del
     * token es siempre el del proyecto, que el puente resuelve en cada invocación.
     * `espacioDatos` es INFORMATIVO (el puente lo devuelve para que `tdb` elija la
     * redacción de sus mensajes) y no cambia el ámbito.
     */
    mint: (profileId: string, projectHostPath: string, info: { espacioDatos: boolean }) => string
    /** Registra el ámbito inicial del proyecto en el puente. */
    fijarAmbito: (profileId: string, projectHostPath: string, ids: readonly string[]) => void
  }
}

/**
 * Rastro de QUÉ decidió la construcción. No es telemetría: es lo que se escribe en
 * `logs/db.log` para poder responder "por qué esta terminal no ve la base" sin
 * tener que reproducirlo con un depurador. Nunca lleva valores de secretos.
 */
export interface EntornoHostDiag {
  /** 'pipe' = el puente sirve secretos en caliente; 'env' = contrato antiguo. */
  modo: 'pipe' | 'env'
  /**
   * ¿Es la terminal del espacio de datos del perfil? Solo INFORMATIVO: no cambia el
   * ámbito (antes se llamaba `consola` y sí lo cambiaba). Es la misma marca que viaja
   * a `tdb` para la redacción de sus mensajes.
   */
  espacioDatos: boolean
  idsPedidos: number
  idsValidos: number
  /**
   * Los ids montados que NO entraron en el ámbito, en el orden en que se pidieron. Solo
   * ids (nunca un secreto), para que el log diga CUÁLES y `avisosDeDescartados` pueda
   * explicar el porqué de cada uno: no todos los descartes son un fallo.
   */
  idsDescartados: string[]
  secretosPedidos: number
  secretosResueltos: number
  claves: string[]
}

/** El entorno de una terminal nativa y el rastro de lo que se decidió al construirlo. */
export interface EntornoHost {
  env: Record<string, string>
  diag: EntornoHostDiag
}

/**
 * Entorno para la terminal (de usuario o de agente) de un PROYECTO en modo nativo,
 * incluido el espacio de datos del perfil, que es un proyecto más: todos ven SOLO
 * las conexiones MONTADAS, y de esas solo las que existan en el perfil.
 *
 * `TESSERA_DB_SCOPE` se define SIEMPRE, aunque sea vacío (= ninguna). Su ausencia
 * significaba "todas las del perfil" y ya no la produce nadie; `tdb` conserva esa
 * lectura solo por un pty arrancado con una versión anterior.
 */
export function construirEntornoHost(
  deps: EntornoHostDeps,
  profileId: string,
  projectHostPath: string,
  idsMontados: readonly string[]
): EntornoHost {
  const espacioDatos = mismaRuta(projectHostPath, deps.espacioDeDatos(profileId))

  // Solo ids que existan y sean REALMENTE de este perfil: defensa ante un
  // workspace-state editado a mano, o con ids de un perfil ya borrado.
  const delPerfil = deps.conexionesDelPerfil(profileId)
  const visibles = idsMontados
    .map((id) => delPerfil.find((c) => c.id === id))
    .filter((c): c is ConexionParaEntorno => c !== undefined)

  const env: Record<string, string> = {
    PATH: deps.binDir,
    [ENV_PERFIL]: profileId,
    [ENV_REGISTRO]: deps.registryPath,
    [ENV_DRIVERS]: deps.driversDir,
    // En modo puente esto es solo un RESPALDO —el ámbito bueno lo sirve el puente, y
    // es el de este instante—, pero se manda igual: si el puente no contesta, `tdb`
    // puede al menos listar en vez de quedarse mudo.
    [ENV_SCOPE]: visibles.map((c) => c.id).join(',')
  }
  // Marca INFORMATIVA del espacio de datos (ver el ADR), en los dos contratos. En
  // modo puente es el respaldo de la respuesta de `resolve`; en modo `env`, la única
  // vía. En un proyecto se escribe VACÍA, no se omite: este entorno se fusiona ENCIMA
  // del heredado (`mergeEnv(cleanEnv(), extraEnv)`), y si Tessera se hubiera lanzado
  // desde una terminal del espacio (`npm run dev` en esa carpeta), un '1' heredado
  // haría que las terminales de un proyecto hablaran de "el agente de datos". `tdb`
  // trata cualquier valor distinto de '1' como proyecto.
  env[ENV_ESPACIO] = espacioDatos ? '1' : ''

  let resueltos = 0
  if (deps.puente) {
    // MODO PUENTE: ni una contraseña en el entorno. Además de aplicar en caliente,
    // esto quita las credenciales del bloque de entorno del agente —que las heredaban
    // TODOS sus hijos: git, npm, servidores MCP— y de cualquier volcado de memoria.
    deps.puente.fijarAmbito(profileId, projectHostPath, visibles.map((c) => c.id))
    env[ENV_MODO] = 'pipe'
    env[ENV_PIPE] = deps.puente.pipe
    env[ENV_SESION] = deps.puente.mint(profileId, projectHostPath, { espacioDatos })
  } else {
    env[ENV_MODO] = 'env'
    for (const c of visibles) {
      const secreto = deps.secretoDe(c.id)
      // Una conexión sin secreto legible (safeStorage no pudo descifrarlo, p.ej. tras
      // restaurar el perfil del sistema) se OMITE en silencio del entorno, pero cuenta
      // en el diagnóstico: es la diferencia entre "tdb no existe" y "tdb existe, lista
      // la base y falla al conectar", que desde fuera se parecen demasiado.
      if (secreto !== null) {
        Object.assign(env, variablesDeSecreto(c, secreto))
        resueltos++
      }
    }
  }

  return {
    env,
    diag: {
      modo: deps.puente ? 'pipe' : 'env',
      espacioDatos,
      idsPedidos: idsMontados.length,
      idsValidos: visibles.length,
      idsDescartados: idsMontados.filter((id) => !delPerfil.some((c) => c.id === id)),
      secretosPedidos: visibles.length,
      // En modo puente los secretos se resuelven en la invocación, no aquí: contarlos
      // ahora sería inventarse un número. El puente tiene su propio registro.
      secretosResueltos: deps.puente ? visibles.length : resueltos,
      // Solo NOMBRES de variable. El valor de un secreto no se registra jamás.
      claves: Object.keys(env)
    }
  }
}

/**
 * Las variables con la contraseña de UNA conexión, sin puente: el secreto y, SIEMPRE con él,
 * la huella del destino para el que se emite (ver el ADR). Las dos juntas o ninguna: un
 * `tdb` no usa un secreto sin su huella. La usan las terminales (`construirEntornoHost`) y el
 * «Probar» del main sin puente (`entornoDe` en `controlador/invocacionTdb.ts`), para que no haya dos sitios
 * que las armen —y uno que se olvide de la huella dejaría «Probar» fallando siempre—.
 *
 * @param c la conexión de la MEMORIA del main para la que se emite (el DTO de `list()`/`get()`),
 *          no una lectura del disco: la huella dice para qué conexión es la contraseña.
 */
export function variablesDeSecreto(c: DestinoBd & { id: string }, secreto: string): Record<string, string> {
  return { [envVarSecreto(c.id)]: secreto, [envVarDestino(c.id)]: huellaDestino(c) }
}

/**
 * Lo que el llamador sabe del REGISTRO para explicar un descarte (ver
 * `avisosDeDescartados`). En producción sale de `ConnectionStore.listaCompleta`.
 */
export interface RegistroParaDescartes {
  /**
   * El aviso del registro si está BLOQUEADO (formato que esta versión no reconoce, o un
   * archivo que no se pudo leer; `DbListaConexiones.aviso`), o `null` si se puede usar.
   */
  avisoRegistro: string | null
  /** Ids de las conexiones del perfil que esta versión no sabe usar (`DbConexionAjena`). */
  idsAjenas: ReadonlySet<string>
}

/**
 * `RegistroParaDescartes` a partir de la respuesta de `ConnectionStore.listaCompleta`: la
 * marca con su aviso y las ajenas salen de UNA misma lectura. Aparte y no dentro de
 * `DbController` para que el test del registro recorra la misma cadena que el main (store
 * real → esta función → `avisosDeDescartados`) sin tener que levantar Electron.
 */
export function registroParaDescartes(lista: DbListaConexiones): RegistroParaDescartes {
  return {
    avisoRegistro: lista.formatoAjeno ? lista.aviso : null,
    idsAjenas: new Set(lista.ajenas.map((a) => a.id))
  }
}

/**
 * Las líneas de `logs/db.log` que explican los ids montados que no entraron en el ámbito, cada uno con su
 * causa; vacío si no hay ninguno. Tres causas y solo una es un fallo del montaje: el registro bloqueado
 * (no se sabe si existen), las conexiones ajenas (existen, `tdb` no sabe usarlas) y las que no existen en
 * el perfil, que es la única que se llama AVISO. Pura: `DbController` solo la alimenta.
 */
export function avisosDeDescartados(
  descartados: readonly string[],
  registro: RegistroParaDescartes,
  profileId: string
): string[] {
  if (descartados.length === 0) return []
  if (registro.avisoRegistro !== null) {
    return [
      `NOTA: ${descartados.length} id(s) montado(s) no entran en el ámbito porque el registro de ` +
        `conexiones está bloqueado, así que no se sabe si existen; siguen montados (no es un fallo ` +
        `del montaje): ${descartados.join(',')}. El registro: ${registro.avisoRegistro}`
    ]
  }
  const ajenas = descartados.filter((id) => registro.idsAjenas.has(id))
  const inexistentes = descartados.filter((id) => !registro.idsAjenas.has(id))
  const lineas: string[] = []
  if (ajenas.length > 0) {
    lineas.push(
      `NOTA: ${ajenas.length} id(s) montado(s) son de conexiones que esta versión no sabe usar ` +
        `(motor que no conoce, forma que no reconoce o id repetido): siguen montados y tdb no los usará: ${ajenas.join(',')}`
    )
  }
  if (inexistentes.length > 0) {
    lineas.push(
      `AVISO: ${inexistentes.length} id(s) montado(s) no existen en el perfil "${profileId}" ` +
        `(de otro perfil, o conexión borrada) y se descartaron: ${inexistentes.join(',')}`
    )
  }
  return lineas
}

/**
 * ¿Son la misma ruta del host? Comparación insensible a mayúsculas y al separador: el
 * mismo directorio puede llegar como `C:\…\conexiones\alfa` desde el main y como
 * `C:/…/conexiones/alfa` desde un estado persistido o un diálogo. Hoy alimenta el
 * diagnóstico (`espacioDatos`) y la redacción de los mensajes —la de `tdb` y la del
 * aviso de arranque del agente—, pero ninguna de las dos cosas decide qué se ve; y un
 * diagnóstico que se equivoca manda a buscar el fallo al sitio equivocado, así que la
 * comparación sigue siendo la buena.
 *
 * Exportada para que `DbController` reconozca el espacio con la MISMA regla en los
 * caminos que no pasan por aquí (el aviso de arranque, el entorno del contenedor): dos
 * comparaciones de rutas distintas acabarían etiquetando distinto la misma terminal.
 */
export function mismaRuta(a: string, b: string): boolean {
  // Una ruta vacía (el espacio de un id de perfil no válido) no es la de nadie.
  if (a === '' || b === '') return false
  return normalizar(a) === normalizar(b)
}

/**
 * Clave de comparación de una ruta, con `path.win32` a propósito también en macOS: trata `/` y `\` como el
 * mismo separador, que es la insensibilidad que necesita `mismaRuta`. No construye rutas ni toca el disco.
 * Ver el ADR (un colaborador la «arreglaría» con `path.posix`).
 */
function normalizar(p: string): string {
  // La barra final se quita aparte: `normalize` la conserva.
  const ruta = path.win32.normalize(p).toLowerCase()
  return ruta.endsWith(path.win32.sep) ? ruta.slice(0, -1) : ruta
}
