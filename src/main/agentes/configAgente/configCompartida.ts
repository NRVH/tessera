// =============================================================================
// La configuración técnica compartida de las cuentas de Docker (`settings.json`, `config.toml`): una capa global
// y otra por perfil que gana sobre ella. Al abrir o relanzar una sesión en Docker se componen en un archivo propio
// de Tessera, junto al de la cuenta, que el CLI superpone al suyo por la línea de arranque (`capaEnLinea`): el
// archivo de la cuenta nunca se escribe, así que quitar una clave o dejar de usar el global se nota en la próxima
// sesión. Las reglas no van aquí: son parte del contexto, que llega en el aviso de arranque.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md, docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { escribirSinSeguirEnlaces } from '../../util/escrituraAtomica.ts'
import {
  ARCHIVO_CAPA,
  ARCHIVOS_CONFIG_AGENTE,
  type AgenteConConfig,
  type CapaCompartida,
  type ClaveFijada,
  type OrigenCompartido
} from '../../../shared/configAgente-ipc.ts'
import { leerDeDisco } from './ServicioConfigAgente.ts'

/** Una capa con su carpeta: la común primero y la del perfil después, que gana. */
export interface CapaAplicable {
  origen: OrigenCompartido
  carpeta: string
}

type Tabla = Record<string, unknown>

/** La carpeta de una capa, dentro de la raíz de la configuración compartida (en los datos de Tessera, nunca montada). */
export function carpetaCapa(raiz: string, capa: CapaCompartida, agente: AgenteConConfig): string {
  return capa.tipo === 'global' ? join(raiz, 'global', agente) : join(raiz, 'perfiles', capa.perfilId, agente)
}

/** Las capas que se aplican a las cuentas de Docker de un perfil: la del perfil, y antes la global si la usa. */
export function capasDe(raiz: string, perfilEntrada: { id: string; contextoGlobal?: false }, agente: AgenteConConfig): CapaAplicable[] {
  const perfil: CapaAplicable = { origen: 'perfil', carpeta: carpetaCapa(raiz, { tipo: 'perfil', perfilId: perfilEntrada.id }, agente) }
  if (perfilEntrada.contextoGlobal === false) return [perfil]
  return [{ origen: 'global', carpeta: carpetaCapa(raiz, { tipo: 'global' }, agente) }, perfil]
}

function interpretar(agente: AgenteConConfig, texto: string): Tabla | null {
  if (texto.trim() === '') return {}
  try {
    const valor: unknown = agente === 'codex' ? parseToml(texto) : JSON.parse(texto)
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Tabla) : null
  } catch {
    return null
  }
}

function serializar(agente: AgenteConConfig, tabla: Tabla): string {
  return agente === 'codex' ? `${stringifyToml(tabla)}\n` : `${JSON.stringify(tabla, null, 2)}\n`
}

const esTabla = (valor: unknown): valor is Tabla => valor !== null && typeof valor === 'object' && !Array.isArray(valor)

/**
 * Funde la capa del perfil (`encima`) sobre la global (`base`) dentro de las tablas: lo que la global tiene en una
 * tabla y el perfil no nombra se conserva. Una lista o un valor suelto se sustituye entero, porque unir listas
 * cambiaría el sentido de las ordenadas, como los argumentos de un servidor. Con la cuenta no se funde aquí: lo
 * hace el CLI, que en Claude Code además une las listas de permisos. `alEscribir` recibe la clave completa de
 * cada valor que pone.
 */
function fundir(base: Tabla, encima: Tabla, alEscribir: (ruta: string) => void, prefijo = ''): Tabla {
  const resultado: Tabla = { ...base }
  for (const [clave, valor] of Object.entries(encima)) {
    const ruta = prefijo === '' ? clave : `${prefijo}.${clave}`
    const previo = resultado[clave]
    if (esTabla(valor)) resultado[clave] = fundir(esTabla(previo) ? previo : {}, valor, alEscribir, ruta)
    else {
      resultado[clave] = valor
      alEscribir(ruta)
    }
  }
  return resultado
}

/** Los valores que fijan las capas y de cuál sale cada uno; una capa con errores de sintaxis no aporta nada. */
export async function combinarCapas(agente: AgenteConConfig, capas: readonly CapaAplicable[]): Promise<{ valores: Tabla; fijadas: ClaveFijada[] }> {
  let valores: Tabla = {}
  const origen = new Map<string, OrigenCompartido>()
  for (const capa of capas) {
    const leida = await leerDeDisco(join(capa.carpeta, ARCHIVOS_CONFIG_AGENTE[agente].configuracion))
    const tabla = leida.bloqueo ? null : interpretar(agente, leida.contenido)
    if (!tabla) continue
    valores = fundir(valores, tabla, (ruta) => {
      // Un valor que sustituye una tabla de la capa anterior, o un valor suelto por una tabla, anula lo que esa fijaba.
      for (const previa of [...origen.keys()]) if (previa.startsWith(`${ruta}.`) || ruta.startsWith(`${previa}.`)) origen.delete(previa)
      origen.set(ruta, capa.origen)
    })
  }
  return { valores, fijadas: [...origen].map(([clave, de]) => ({ clave, origen: de })) }
}

/**
 * Compone las capas en el archivo de Tessera de la carpeta de una cuenta de Docker, antes de que el CLI arranque,
 * y dice si se le puede pasar. Se escribe también sin valores, vacío: uno viejo aplicaría lo que ya no está, y un
 * relanzamiento con la línea guardada lo sigue nombrando. Nunca lanza: si falla, se quita y la sesión arranca con
 * la configuración de la cuenta. La carpeta se monta con escritura en el contenedor: se escribe sin seguir un
 * enlace que hayan dejado allí.
 */
export async function prepararCapaCompartida(dir: string, agente: AgenteConConfig, capas: readonly CapaAplicable[], log: (m: string) => void): Promise<boolean> {
  const ruta = join(dir, ARCHIVO_CAPA[agente])
  try {
    const { valores } = await combinarCapas(agente, capas)
    // Puede llevar secretos de un servidor MCP: solo lo lee su dueño.
    await escribirSinSeguirEnlaces(ruta, serializar(agente, valores), 0o600)
    return true
  } catch (err) {
    log(`configuración compartida: no se pudo preparar ${ruta}: ${String(err)}`)
    await rm(ruta, { force: true }).catch(() => undefined)
    return false
  }
}
