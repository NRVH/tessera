// =============================================================================
// Lógica pura del bloque gestionado que Tessera escribe en la memoria del agente (`CLAUDE.md` y
// `AGENTS.md` del espacio de datos de un perfil). Sin imports de Node ni acceso a disco, para probarla
// con `node` a secas; la escritura vive en `agentMemory.ts` y los textos de motor en `briefingAgente.ts`.
// El texto lo lee el agente: cambiarlo cambia su conducta, y lo fija `test-agent-memory.mts`.
// Decisiones: docs/decisiones/bd/puente-textos-del-agente.md
// =============================================================================
import { NOMBRE_ENTORNO, type DbConnection } from '../../shared/db-ipc.ts'
import { destinoLegible } from '../../shared/motores/index.ts'
import {
  consejosDialecto,
  etiquetasConCandadoDeTessera,
  frasesClasificador,
  frasesListaBlanca,
  tieneUsuarioQueEnsenar,
  usuarioConDominio
} from './briefingAgente.ts'

/** Marca de inicio del bloque gestionado de bases de datos. */
export const INICIO = '<!-- tessera:db:start -->'
/** Marca de fin del bloque gestionado de bases de datos. */
export const FIN = '<!-- tessera:db:end -->'

/** Una fila de la tabla del catálogo del perfil. */
function filaDeConexion(c: DbConnection): string {
  const destino = destinoLegible(c)
  const modo = c.readonly ? 'solo lectura' : 'ESCRITURA PERMITIDA'
  // En mayúsculas la de producción: es la que no se puede pasar por alto.
  const entorno = c.entorno === 'produccion' ? 'PRODUCCIÓN' : c.entorno ? NOMBRE_ENTORNO[c.entorno] : '—'
  // Sin usuario que enseñar (archivo, o MongoDB/Redis sin autenticar): «—». Una cuenta de dominio, como `DOMINIO\usuario`.
  const usuario = tieneUsuarioQueEnsenar(c) ? usuarioConDominio(c) : '—'
  // El id va al final: es lo que `consolas/indice.json` guarda como `conexionId`.
  return `| ${c.alias} | ${c.motor} | ${destino} | ${usuario} | ${modo} | ${entorno} | \`${c.id}\` |`
}

/** La frase de las bases de archivo, si el catálogo tiene alguna cuyo solo lectura impone Tessera. */
function seccionArchivo(conexiones: DbConnection[], avisoFormato: string | null): string[] {
  const deTessera = avisoFormato === null ? etiquetasConCandadoDeTessera(conexiones.map((c) => c.motor)) : ''
  if (deTessera === '') return []
  return [
    '',
    `Las de ${deTessera} son un ARCHIVO, sin servidor ni usuario: su solo lectura lo impone`,
    'Tessera (tdb solo deja leer), y ATTACH, VACUUM INTO y cargar extensiones están cerrados',
    `siempre, también en las de escritura. Su SQL es el de ${deTessera}, y \`tdb sessions\` no aplica.`
  ]
}

/** El catálogo: con el registro ilegible para esta versión no se lista nada y se cita el aviso del main. */
function seccionCatalogo(conexiones: DbConnection[], avisoFormato: string | null): string[] {
  if (avisoFormato !== null) {
    return [
      '**Ahora mismo Tessera no puede leer el catálogo de este perfil**, así que aquí no',
      'se lista ninguna conexión: no es que el perfil no tenga. Lo que dice Tessera:',
      '',
      `> ${avisoFormato}`,
      '',
      'Mientras dure, `tdb` tampoco ve ninguna (lo dice al usarlo). No es una avería tuya',
      'ni de `tdb`, y no se arregla montando nada: díselo al usuario si te pide una base.'
    ]
  }
  if (!conexiones.length) {
    return ['(ninguna configurada todavía — se añaden en la vista Bases de datos de Tessera)']
  }
  return [
    '| Nombre | Motor | Destino | Usuario | Modo | Entorno | Id |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...conexiones.map(filaDeConexion)
  ]
}

/** Qué conexiones son de producción; sin el catálogo no se sabe y se pide prudencia. */
function seccionProduccion(conexiones: DbConnection[], avisoFormato: string | null): string[] {
  if (avisoFormato !== null) {
    return [
      'Sin el catálogo no se sabe cuáles son de PRODUCCIÓN: trata como si lo fuera',
      'cualquier base en la que el usuario te pida escribir.'
    ]
  }
  const produccion = conexiones.filter((c) => c.entorno === 'produccion').map((c) => `**${c.alias}**`)
  return produccion.length
    ? [`Son de PRODUCCIÓN: ${produccion.join(', ')}. \`tdb ls\` también las marca.`]
    : ['Ninguna de este perfil está marcada como de PRODUCCIÓN (la columna Entorno lo dice).']
}

/** Lo que hay antes del catálogo: qué es la carpeta y que estar en la tabla no significa poder consultarla. */
function introduccion(nombrePerfil: string): string[] {
  return [
    INICIO,
    `# Espacio de datos — ${nombrePerfil}`,
    '',
    'Esta carpeta es el espacio de trabajo para las bases de datos de este perfil.',
    'No es un repositorio: aquí se guardan la documentación, los diagramas y los',
    'scripts que generes al explorar las bases. Escribe aquí, no en los repos.',
    '',
    '## Conexiones del perfil',
    '',
    'Catálogo de las conexiones que el usuario tiene configuradas en este perfil.',
    'Que una esté en esta tabla NO significa que puedas consultarla: mira la',
    'sección siguiente.',
    ''
  ]
}

/** Regla de producción (`tdb` no pasa por el diálogo de confirmación de Tessera), qué bases se pueden consultar y los comandos. */
const REGLAS_Y_COMANDOS = [
  '',
  '**No escribas en una conexión de PRODUCCIÓN salvo que el usuario te lo pida',
  'explícitamente en esta conversación**: ni INSERT, UPDATE, DELETE o MERGE, ni DDL, ni',
  'bloques PL/SQL o llamadas que escriban, ni COMMIT. Leer sí. Si una tarea necesita',
  'escribir en una de ellas, para y pregunta antes. Tessera pide confirmación al usuario',
  'antes de cada escritura en producción, pero `tdb` no pasa por ese diálogo.',
  '',
  '## Qué bases puedes consultar',
  '',
  'Solo puedes consultar las bases MONTADAS en el botón de bases de datos de la',
  'cabecera del agente; cambian en caliente y `tdb ls` dice cuáles son ahora. Si',
  'necesitas otra, pide que te la monten.',
  '',
  'Antes este espacio veía todas las conexiones del perfil; ya no. Si `tdb ls` no',
  'lista ninguna, es que no hay ninguna montada, no que algo esté roto.',
  '',
  '## Cómo consultarlas',
  '',
  'Con el comando `tdb`, que ya tiene las credenciales resueltas:',
  '',
  '- `tdb ls` — lista las bases montadas AHORA en esta sesión',
  '- `tdb schema <nombre>` — tablas y claves foráneas (para documentar o diagramar)',
  '- `tdb describe <nombre> <TABLA>` — columnas, tipos, PK y referencias',
  '- `tdb query <nombre> "<SQL>"` — consulta puntual (tope de filas; `--limit N` para ampliar)',
  '- `tdb sessions <nombre>` — sesiones abiertas de tu usuario',
  '',
  '**No pidas al usuario URLs ni credenciales: ya las tienes.** Las conexiones marcadas',
  'como solo lectura las impone el SERVIDOR (Oracle responde ORA-01456 a cualquier',
  'escritura), así que puedes explorar sin miedo a romper nada.'
]

/** Lo que cierra el bloque: el cliente que falta y las consolas SQL del usuario. */
const CIERRE = [
  '',
  'Si `tdb` avisa de que falta un cliente de base de datos, instálalo con',
  '`tdb driver install <id>`.',
  '',
  '## Consolas SQL del usuario',
  '',
  'La carpeta `consolas/` guarda las consolas SQL que el usuario abre en la vista',
  'Bases de datos de Tessera: un archivo `.sql` por consola, y `consolas/indice.json`',
  'con la conexión de cada una (`id`, `conexionId`, `nombre`, `creadaEn`; el',
  '`conexionId` es la columna Id de la tabla de arriba). Sirven para saber qué está',
  'consultando el usuario.',
  '',
  'Es el SQL del usuario; léelo, no lo edites salvo que te lo pida. Suele tenerlas',
  'abiertas, y un cambio tuyo le aparecería como hecho fuera de Tessera.',
  FIN
]

/**
 * Contenido del `CLAUDE.md` / `AGENTS.md` del espacio de datos de un perfil. La tabla es el catálogo del
 * perfil; lo consultable es lo montado. Nunca incluye contraseñas.
 * @param avisoFormato el aviso del main si el registro tiene un formato que esta versión no reconoce
 *                     (`DbListaConexiones.aviso`), o `null`; con él `conexiones` viene vacía sin que el perfil lo esté.
 */
export function bloqueEspacioDatos(
  nombrePerfil: string,
  conexiones: DbConnection[],
  avisoFormato: string | null = null
): string {
  const motores = conexiones.map((c) => c.motor)
  return [
    ...introduccion(nombrePerfil),
    ...seccionCatalogo(conexiones, avisoFormato),
    '',
    '## Conexiones de PRODUCCIÓN',
    '',
    ...seccionProduccion(conexiones, avisoFormato),
    ...REGLAS_Y_COMANDOS,
    ...seccionArchivo(conexiones, avisoFormato),
    // Servidor sin candado de solo lectura (SQL Server), lista blanca de Tessera (MongoDB, Redis) y T-SQL.
    ...(avisoFormato === null ? frasesClasificador(motores) : []),
    ...(avisoFormato === null ? frasesListaBlanca(motores) : []),
    ...(avisoFormato === null ? consejosDialecto(motores) : []),
    ...CIERRE
  ].join('\n')
}

/**
 * Sustituye el bloque delimitado dentro de `texto`. Si no existe y `nuevo` no está vacío, lo añade al
 * final; con `nuevo` vacío, lo retira. Sirve también para los archivos del usuario, así que no se come
 * nunca su contenido: ante marcadores a medias se prefiere añadir un bloque nuevo. Los marcadores son
 * parametrizables porque el bloque de BD y el del sandbox conviven en el mismo archivo.
 */
export function reemplazarBloque(
  texto: string,
  nuevo: string,
  inicio: string = INICIO,
  fin: string = FIN
): string {
  const i = texto.indexOf(inicio)
  const j = texto.indexOf(fin)

  if (i >= 0 && j > i) {
    const antes = texto.slice(0, i)
    const despues = texto.slice(j + fin.length)
    if (!nuevo) {
      // Al retirar se colapsan los saltos que lo rodeaban, para no dejar huecos crecientes.
      return (antes.replace(/\n+$/, '\n') + despues.replace(/^\n+/, '')).trimEnd() + '\n'
    }
    return antes + nuevo + despues
  }

  if (!nuevo) return texto
  const base = texto.trimEnd()
  return base ? `${base}\n\n${nuevo}\n` : `${nuevo}\n`
}
