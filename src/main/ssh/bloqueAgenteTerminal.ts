// =============================================================================
// Texto del bloque gestionado `tessera:ssh` que Tessera escribe en el `CLAUDE.md` y el `AGENTS.md`
// de la carpeta del agente de la terminal de un perfil: quién es, las conexiones que puede usar (sin
// secretos ni rutas), cómo conectarse con `tssh` y sus reglas. El catálogo y las frases que comparte con el
// aviso de arranque salen de `catalogoAgentes.ts`. Puro y sin imports de Node: lo fija
// `test-espacio-terminal.mts`; la escritura vive en `controlador/espacioTerminal.ts`.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import type { SshConexion, SshMetodo } from '../../shared/ssh-ipc.ts'
import { REGLAS_SSH, fraseExcluidas, grupoDe, type CatalogoAgentes } from './catalogoAgentes.ts'

/** Marca de inicio del bloque gestionado de las conexiones SSH. */
export const INICIO_SSH = '<!-- tessera:ssh:start -->'
/** Marca de fin del bloque gestionado de las conexiones SSH. */
export const FIN_SSH = '<!-- tessera:ssh:end -->'

/** Cómo se nombra cada método en la tabla. */
const METODO: Record<SshMetodo, string> = {
  contrasena: 'contraseña',
  clave: 'archivo de clave',
  sistema: 'claves del sistema'
}

/**
 * Un texto del usuario (alias, grupo, nombre del perfil) listo para una línea de Markdown: sin
 * saltos ni caracteres de control, con la barra escapada (no rompe la fila de la tabla) y sin
 * `<!--` en crudo, que podría cerrar el bloque antes de tiempo al regenerarlo.
 */
function textoSeguro(texto: string): string {
  return (
    texto
      // eslint-disable-next-line no-control-regex -- quitar caracteres de control es justo su trabajo
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\|/g, '\\|')
      .replace(/<!--/g, '<\\!--')
      .trim()
  )
}

/** Una fila de la tabla: alias, grupo, destino, método y si un humano ya aceptó la huella. */
function fila(c: SshConexion, grupos: ReadonlyMap<string, string>): string {
  const grupo = grupoDe(c, grupos) ?? 'Sin grupo'
  const destino = `${c.usuario}@${c.host}:${c.puerto}`
  const huella = c.huellaServidor.length > 0 ? 'confirmada' : 'SIN CONFIRMAR'
  return `| ${textoSeguro(c.alias)} | ${textoSeguro(grupo)} | ${textoSeguro(destino)} | ${METODO[c.metodo]} | ${huella} |`
}

/** La tabla de las disponibles (en el orden del catálogo) y cuántas más hay sin nombrarlas; con el registro ilegible, su aviso. */
function seccionConexiones(cat: CatalogoAgentes): string[] {
  if (cat.aviso !== null) {
    return [
      '**Ahora mismo Tessera no puede leer las conexiones SSH de este perfil**, así que aquí no se',
      'lista ninguna: no es que el perfil no tenga. Lo que dice Tessera:',
      '',
      `> ${textoSeguro(cat.aviso)}`,
      '',
      'Mientras dure, `tssh` tampoco ve ninguna. No es una avería tuya: díselo al usuario.'
    ]
  }
  const tabla = cat.disponibles.length
    ? ['| Alias | Grupo | Destino | Método | Huella |', '| --- | --- | --- | --- | --- |', ...cat.disponibles.map((c) => fila(c, cat.grupos))]
    : ['(ninguna disponible todavía: el usuario las añade en la terminal de Tessera, con «Nueva conexión SSH…»)']
  const excluidas = fraseExcluidas(cat.excluidas)
  return excluidas === null ? tabla : [...tabla, '', excluidas]
}

/** Quién es y qué es esta carpeta. */
function introduccion(nombrePerfil: string): string[] {
  const perfil = textoSeguro(nombrePerfil) || 'sin nombre'
  return [
    INICIO_SSH,
    `# Agente de la terminal — ${perfil}`,
    '',
    `Eres el agente de la terminal del perfil «${perfil}» en Tessera: el que el usuario abre junto a`,
    'su terminal para pedir ayuda con sus equipos y su red. Esta carpeta es tuya y no es un',
    'repositorio: guarda aquí las notas, los guiones y lo que generes, no en los repos del usuario.',
    '',
    '## Conexiones SSH del perfil',
    '',
    'Las que el usuario marcó como «Disponible para los agentes». Pueden cambiar mientras trabajas:',
    '`tssh ls` da las de ahora, también si su huella ya está confirmada.',
    ''
  ]
}

/** Cómo conectarse y las reglas, que no dependen del perfil. */
const COMANDOS_Y_REGLAS = [
  '',
  '## Cómo conectarte',
  '',
  'Con el comando `tssh`, que resuelve las credenciales sin enseñártelas:',
  '',
  '- `tssh ls` — las conexiones que puedes usar ahora',
  '- `tssh run <alias> -- <orden>` — ejecuta una orden en el equipo y devuelve su salida y su código',
  '- `tssh cp <origen> <destino>` — copia archivos; el lado remoto es `<alias>:<ruta>` y `-r` copia carpetas',
  '- `tssh doctor` — diagnostica por qué una conexión no conecta',
  '- `tssh help` — la ayuda completa',
  '',
  'Si el alias lleva espacios, ponlo entre comillas.',
  '',
  '## Reglas',
  '',
  ...REGLAS_SSH.map((r) => `- ${r}`),
  FIN_SSH
]

/**
 * El bloque `tessera:ssh` del agente de la terminal de un perfil. Nunca lleva secretos, rutas de
 * claves ni el nombre de las conexiones que el usuario no dejó disponibles para los agentes.
 */
export function bloqueAgenteTerminal(nombrePerfil: string, catalogo: CatalogoAgentes): string {
  return [...introduccion(nombrePerfil), ...seccionConexiones(catalogo), ...COMANDOS_Y_REGLAS].join('\n')
}
