// =============================================================================
// El DESTINO LEGIBLE de un motor de red (host, puerto y base o SID), en las cuatro formas que
// pintan el árbol, la memoria del agente, el aviso de arranque, `tdb ls` y el popover de montaje.
// Las formas no se unifican aunque se parezcan: `tdb ls` lo leen agentes que ya lo conocen así.
// Neutral y ES2020.
// =============================================================================

import type { DestinoConexion, FormaDestino } from './tipos.ts'
import { nunca } from '../nunca.ts'

/** El destino de un motor de red en la forma pedida (ver `FormaDestino`). */
export function destinoDeRed(c: DestinoConexion, forma: FormaDestino): string {
  switch (forma) {
    case 'completo':
      return `${c.host}:${c.port}${c.database ? `/${c.database}` : c.sid ? ` (SID ${c.sid})` : ''}`
    case 'conUsuario': {
      const base = `${c.user}@${c.host}:${c.port}`
      if (c.database) return `${base}/${c.database}`
      if (c.sid) return `${base} (SID ${c.sid})`
      return base
    }
    case 'ls':
      return `${c.host}:${c.port}/${c.database || c.sid || ''}`
    case 'breve':
      return c.host
    default:
      return nunca(forma, 'destinoDeRed')
  }
}

/**
 * El destino de un motor de red con el USUARIO OPCIONAL y sin SID (MongoDB
 * y Redis, que se conectan sin autenticar o, Redis, con la clave sola): lo mismo que
 * `destinoDeRed` salvo que 'conUsuario' sin usuario no escribe un `@` huérfano. En Redis la
 * «base» es su número (`host:6379/2`).
 */
export function destinoDeRedUsuarioOpcional(c: DestinoConexion, forma: FormaDestino): string {
  const servidor = `${c.host}:${c.port}`
  const base = c.database ? `/${c.database}` : ''
  switch (forma) {
    case 'completo':
      return servidor + base
    case 'conUsuario':
      return (c.user ? `${c.user}@` : '') + servidor + base
    case 'ls':
      return `${servidor}/${c.database || ''}`
    case 'breve':
      return c.host
    default:
      return nunca(forma, 'destinoDeRedUsuarioOpcional')
  }
}
