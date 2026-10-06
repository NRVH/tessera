// =============================================================================
// El aviso SSH que recibe al arrancar un agente nativo (detrás del de bases, en `briefingCompuesto.ts`): que
// tiene `tssh`, las conexiones del perfil disponibles para los agentes en ese momento (la lista puede cambiar:
// `tssh ls`) y las reglas (las de `REGLAS_SSH`, las mismas que el `CLAUDE.md` del agente de la terminal). Los
// textos del usuario van saneados para la línea de arranque. Puro: el catálogo llega hecho.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import type { SshConexion } from '../../shared/ssh-ipc.ts'
import { REGLAS_SSH, fraseExcluidas, motivoNoLista, type CatalogoAgentes } from './catalogoAgentes.ts'

/** Cuántas conexiones se nombran como mucho: el aviso viaja en la línea de arranque, y el resto lo da `tssh ls`. */
export const MAX_EN_AVISO = 30

/**
 * Comillas que no pueden ir en la línea de arranque: PowerShell toma las simples tipográficas por comillas
 * (la línea no se analiza) y 5.1 pierde las dobles o parte el argumento al pasarlo al agente (medido).
 * Se cambian por el apóstrofo recto, que la cita de PowerShell dobla; `tssh` busca el alias igual con ellas.
 */
const COMILLAS_LINEA = new RegExp(`[${[0x22, 0x60, 0xb4, 0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f].map((c) => String.fromCharCode(c)).join('')}]`, 'g')

/** Los caracteres de control (C0, DEL y C1), por su código. */
const CONTROLES = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]+`, 'g')

/** Los separadores de línea y de párrafo de Unicode, por su código (escritos tal cual romperían este archivo). */
const SEPARADORES = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, 'g')

/** Un texto del usuario listo para la línea de arranque: una sola línea, sin controles y sin esas comillas. */
export function textoParaAviso(texto: string): string {
  return texto.replace(CONTROLES, ' ').replace(SEPARADORES, ' ').replace(COMILLAS_LINEA, "'").replace(/\s+/g, ' ').trim()
}

/** Lo que se dice de una conexión que aún no se puede usar. */
function estadoDe(c: SshConexion): string {
  const motivo = motivoNoLista(c)
  const frase = c.metodo === 'clave' ? 'la frase de la clave' : 'la contraseña'
  if (motivo === 'huella') return ', huella sin confirmar'
  if (motivo === 'secreto-falta') return `, sin ${frase} guardada`
  return motivo === 'secreto-ilegible' ? `, con ${frase} ilegible en este equipo` : ''
}

/** «alias» (usuario@host:puerto[, estado]). */
function entrada(c: SshConexion): string {
  return `«${textoParaAviso(c.alias)}» (${textoParaAviso(`${c.usuario}@${c.host}:${c.puerto}`)}${estadoDe(c)})`
}

/** La lista de las disponibles, con un tope. */
function lista(disponibles: readonly SshConexion[]): string {
  const nombradas = disponibles.slice(0, MAX_EN_AVISO).map(entrada).join(', ')
  const resto = disponibles.length - MAX_EN_AVISO
  return resto > 0 ? `${nombradas} y ${resto} más (\`tssh ls\` las da todas)` : nombradas
}

/**
 * El aviso SSH de un perfil, o `null` si no tiene ninguna conexión disponible para los agentes (o su registro
 * no se puede leer): entonces el agente arranca con el aviso de siempre.
 */
export function briefingSsh(cat: CatalogoAgentes): string | null {
  if (cat.aviso !== null || cat.disponibles.length === 0) return null
  const excluidas = fraseExcluidas(cat.excluidas)
  return [
    'Conexiones SSH de Tessera: en este perfil puedes usar estas conexiones con el comando `tssh`, que pone las',
    `credenciales sin enseñártelas: ${lista(cat.disponibles)}.`,
    'La lista puede cambiar mientras trabajas: `tssh ls` da la de ahora.',
    '`tssh run <alias> -- <orden>` ejecuta una orden en el equipo y devuelve su salida y su código;',
    '`tssh cp <origen> <destino>` copia archivos (el lado remoto es `<alias>:<ruta>` y `-r` copia carpetas);',
    '`tssh doctor <alias>` dice por qué una conexión no conecta, y `tssh help` es la ayuda completa.',
    'Si el alias lleva espacios, ponlo entre comillas.',
    ...(excluidas !== null ? [excluidas] : []),
    'Reglas:',
    ...REGLAS_SSH.map((r) => `- ${r}`)
  ].join('\n')
}
