// =============================================================================
// Lo que un agente ve de las conexiones SSH de su perfil por `tssh`: solo las marcadas «Disponible para los
// agentes», cuántas más hay (sin nombrarlas), la fila de `tssh ls`, si una está lista para usarse y las frases
// que comparten el aviso de arranque y el `CLAUDE.md`. El alias que escribe el agente se busca sin mayúsculas
// y con cualquier comilla (recta o tipográfica) como la misma, porque el aviso de arranque las sanea. Puro: el
// registro llega ya listado.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { pideSecretoSsh, type SshConexion, type SshListaConexiones, type SshMetodo } from '../../shared/ssh-ipc.ts'

/** Las conexiones de un perfil que un agente puede usar, y cuántas más tiene el perfil. */
export interface CatalogoAgentes {
  /** Por grupo y, dentro, por alias: el mismo orden en `tssh ls`, en el aviso y en el `CLAUDE.md`. */
  disponibles: SshConexion[]
  excluidas: number
  /** Nombre de cada grupo del perfil, por id. */
  grupos: ReadonlyMap<string, string>
  /** El registro está en un formato que esta versión no lee: no se lista ninguna. */
  aviso: string | null
}

/** Qué pasa con el secreto que pide el método de una conexión. */
export type EstadoSecreto = 'no-hace-falta' | 'guardado' | 'falta' | 'ilegible'

/** Una conexión tal como la ve un agente: sin id, sin rutas y sin nada del secreto salvo si está. */
export interface FilaTssh {
  alias: string
  grupo: string | null
  usuario: string
  host: string
  puerto: number
  metodo: SshMetodo
  huellaConfirmada: boolean
  secreto: EstadoSecreto
}

/** Por qué una conexión disponible no se puede usar ahora mismo desde un agente. */
export type MotivoNoLista = 'huella' | 'secreto-falta' | 'secreto-ilegible'

/**
 * Comillas que un alias puede llevar (rectas, tipográficas y el acento suelto), por su código para que ninguna
 * edición las convierta en otra cosa: para buscarlo cuentan todas como el apóstrofo recto.
 */
const COMILLAS = new RegExp(`[${[0x22, 0x27, 0x60, 0xb4, 0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f].map((c) => String.fromCharCode(c)).join('')}]`, 'g')

/** El alias como se compara: sin espacios en los extremos, en NFC, sin mayúsculas y con las comillas unificadas. */
export function normalizarAlias(alias: string): string {
  return alias.trim().normalize('NFC').replace(COMILLAS, "'").toLowerCase()
}

/** El nombre del grupo de una conexión, o `null` = «Sin grupo». */
export function grupoDe(c: SshConexion, grupos: ReadonlyMap<string, string>): string | null {
  return c.grupoId !== null && !c.grupoDesconocido ? (grupos.get(c.grupoId) ?? null) : null
}

/** Las conexiones y los grupos de un perfil, sacados de la lista entera del registro. */
export function catalogoAgentes(lista: SshListaConexiones, profileId: string): CatalogoAgentes {
  const grupos = new Map(lista.grupos.filter((g) => g.profileId === profileId).map((g) => [g.id, g.nombre]))
  if (lista.formatoAjeno) return { disponibles: [], excluidas: 0, grupos, aviso: lista.aviso }
  const delPerfil = lista.conexiones.filter((c) => c.profileId === profileId)
  const comparar = (a: string, b: string): number => a.localeCompare(b, 'es', { sensitivity: 'base' })
  const disponibles = delPerfil
    .filter((c) => c.disponibleAgentes === true)
    .sort((a, b) => comparar(grupoDe(a, grupos) ?? '', grupoDe(b, grupos) ?? '') || comparar(a.alias, b.alias))
  return { disponibles, excluidas: delPerfil.length - disponibles.length, grupos, aviso: null }
}

/** Cuántas más tiene el perfil que el usuario no dejó disponibles, sin nombrarlas; `null` si ninguna. */
export function fraseExcluidas(n: number): string | null {
  if (n === 1) return 'Hay 1 conexión más de este perfil que el usuario no dejó disponible para los agentes: no la busques ni preguntes cuál es.'
  if (n > 1) return `Hay ${n} conexiones más de este perfil que el usuario no dejó disponibles para los agentes: no las busques ni preguntes cuáles son.`
  return null
}

/** Las reglas de un agente con las conexiones SSH, las mismas en el aviso de arranque y en el `CLAUDE.md`. */
export const REGLAS_SSH: readonly string[] = [
  'No pidas ni escribas contraseñas, frases de clave ni claves: `tssh` las resuelve. Si una conexión no tiene la suya guardada, díselo al usuario en vez de pedírsela.',
  'Sin la huella confirmada no conectes: el usuario tiene que conectarse una vez desde la terminal de Tessera, porque solo usas equipos cuya huella ya aceptó una persona. La comprueba `tssh` en cada conexión: si `tssh ls` la da por lista, ya la aceptó, aunque al arrancar no lo estuviera; no se la vuelvas a pedir.',
  'Antes de cambiar la configuración de un equipo (reiniciar servicios, editar archivos del sistema, tocar la red o el cortafuegos) explica qué vas a hacer y por qué, y espera a que el usuario lo confirme. Mirar y diagnosticar no necesita permiso.'
]

/** Si la conexión tiene el secreto que su método pide, y si este equipo lo puede leer. */
export function estadoSecreto(c: Pick<SshConexion, 'metodo' | 'clave' | 'tieneSecreto' | 'secretoIlegible'>): EstadoSecreto {
  if (!pideSecretoSsh(c)) return 'no-hace-falta'
  if (!c.tieneSecreto) return 'falta'
  return c.secretoIlegible === true ? 'ilegible' : 'guardado'
}

/** La fila de `tssh ls` (y de `--json`). */
export function filaTssh(c: SshConexion, grupos: ReadonlyMap<string, string>): FilaTssh {
  return {
    alias: c.alias,
    grupo: grupoDe(c, grupos),
    usuario: c.usuario,
    host: c.host,
    puerto: c.puerto,
    metodo: c.metodo,
    huellaConfirmada: c.huellaServidor.length > 0,
    secreto: estadoSecreto(c)
  }
}

/** Lo primero que impide usarla desde un agente, o `null` si está lista. La huella va antes: sin ella no se llega a pedir nada. */
export function motivoNoLista(c: SshConexion): MotivoNoLista | null {
  if (c.huellaServidor.length === 0) return 'huella'
  const secreto = estadoSecreto(c)
  if (secreto === 'falta') return 'secreto-falta'
  return secreto === 'ilegible' ? 'secreto-ilegible' : null
}

/** Resultado de buscar un alias entre las disponibles. */
export type Busqueda = { conexion: SshConexion } | { ambigua: true } | null

/**
 * La disponible con ese alias. Si al unificar las comillas casan varias, gana la que casa sin unificarlas;
 * si aún son varias, es ambigua. Una conexión que el usuario no dejó disponible no se encuentra, igual que
 * una que no existe.
 */
export function buscarDisponible(cat: CatalogoAgentes, alias: string): Busqueda {
  const buscado = normalizarAlias(alias)
  if (buscado === '') return null
  const casan = cat.disponibles.filter((c) => normalizarAlias(c.alias) === buscado)
  if (casan.length === 1) return { conexion: casan[0] }
  if (casan.length === 0) return null
  const exacto = alias.trim().normalize('NFC').toLowerCase()
  const exactas = casan.filter((c) => c.alias.trim().normalize('NFC').toLowerCase() === exacto)
  return exactas.length === 1 ? { conexion: exactas[0] } : { ambigua: true }
}
