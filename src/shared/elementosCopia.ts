// =============================================================================
// Las piezas del árbol de importar que no dependen del árbol: cómo es un elemento y cómo se construyen los de los
// archivos de los agentes (las cuentas de Docker bajo su perfil y las reglas nativas aparte), frente a lo que hay
// en este equipo. Lo que se elige de ellos llega saneado desde el IPC. Puro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { ARCHIVOS_CONFIG_AGENTE, TIPOS_ARCHIVO_CONFIG, type AgenteConConfig, type TipoArchivoConfig } from './configAgente-ipc.ts'
import type { EstadoArchivoAgente, FuenteHistorial, PreviaArchivosAgentes } from './copia-configuracion-ipc.ts'

export type TipoElemento =
  | 'perfil'
  | 'reglas'
  | 'ssh'
  | 'bd'
  | 'agente'
  | 'nativo'
  | 'historial'
  | 'configDocker'
  | 'configGlobal'
  | 'ajustes'
  | 'cuentaAgente'
  | 'archivoCuenta'
  | 'reglaNativa'

export interface ElementoImportar {
  clave: string
  tipo: TipoElemento
  id: string
  perfil: string | null
  nombre: string
  detalle: string | null
  yaEsta: boolean
  /** Las claves de los elementos sin los que este no puede entrar. */
  requiere: string[]
  /** El historial de una cuenta (o el nativo de un agente), para enseñar cuánto trae. */
  historial?: FuenteHistorial
  /** Importarlo sustituye algo distinto de este equipo: no viene marcado de serie. */
  sustituye?: true
  /** No sustituye nada, pero cambia lo que hacen los agentes de todo el equipo: solo se marca a mano o con «Todo». */
  soloAMano?: true
  /** Una cuenta de Docker del archivo. */
  cuenta?: { agente: AgenteConConfig; predeterminada: boolean }
  /** Un archivo de agente: el `id` de su cuenta en el archivo (null en las reglas nativas), cuál es y cómo está aquí. */
  archivo?: { cuenta: string | null; agente: AgenteConConfig; tipo: TipoArchivoConfig; nombre: string; estado: EstadoArchivoAgente; ruta?: string }
  /** En la global: qué partes sustituirían algo de aquí. */
  partesGlobal?: { reglas: boolean; configuracion: boolean }
}

export const claveDe = (tipo: TipoElemento, perfil: string | null, id: string): string => JSON.stringify([tipo, perfil, id])

export function elemento(tipo: TipoElemento, id: string, perfil: string | null, nombre: string, yaEsta: boolean, detalle: string | null = null): ElementoImportar {
  return { clave: claveDe(tipo, perfil, id), tipo, id, perfil, nombre, detalle, yaEsta, requiere: [] }
}

/**
 * Las cuentas de un perfil del archivo, cada una seguida de sus archivos, frente a la suya en el destino (`destino`
 * null, un perfil nuevo: nada existe). Los archivos de una cuenta que no existe aquí la necesitan: sin marcarla no se
 * ofrecen ni se escriben. Lo que no se trae sale sin casilla (`yaEsta`): igual, o la elección entre mantener y sustituir.
 */
export function elementosDeCuentas(previa: PreviaArchivosAgentes | undefined, perfil: string, destino: string | null): ElementoImportar[] {
  return (previa?.cuentas ?? [])
    .filter((c) => c.perfil === perfil)
    .flatMap((c) => {
      const aqui = destino === null ? undefined : c.frente[destino]
      const cuenta: ElementoImportar = { ...elemento('cuentaAgente', c.id, perfil, aqui?.cuenta ?? c.nombre, aqui !== undefined), cuenta: { agente: c.agente, predeterminada: c.predeterminada } }
      const archivos = c.archivos.map((tipo): ElementoImportar => {
        const estado = aqui?.archivos[tipo] ?? 'traer'
        const nombre = ARCHIVOS_CONFIG_AGENTE[c.agente][tipo]
        const el = elemento('archivoCuenta', `${c.id}/${tipo}`, perfil, nombre, estado !== 'traer')
        if (aqui === undefined) el.requiere.push(cuenta.clave)
        return { ...el, archivo: { cuenta: c.id, agente: c.agente, tipo, nombre, estado } }
      })
      return [cuenta, ...archivos]
    })
}

/**
 * Las reglas nativas: de todo el equipo, y faltando aquí tampoco vienen marcadas de serie, porque si no se tocan
 * los agentes nativos no cambian.
 */
export function elementosReglasNativas(previa: PreviaArchivosAgentes | undefined): ElementoImportar[] {
  return (previa?.nativos ?? []).map((n): ElementoImportar => {
    const nombre = ARCHIVOS_CONFIG_AGENTE[n.agente].instrucciones
    return {
      ...elemento('reglaNativa', n.agente, null, nombre, n.estado !== 'traer'),
      soloAMano: true,
      archivo: { cuenta: null, agente: n.agente, tipo: 'instrucciones', nombre, estado: n.estado, ruta: n.ruta }
    }
  })
}

const AGENTES_CON_CONFIG: readonly AgenteConConfig[] = ['claude-code', 'codex']

const objeto = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const esTipo = (v: unknown): v is TipoArchivoConfig => TIPOS_ARCHIVO_CONFIG.includes(v as TipoArchivoConfig)

/** Un archivo de una cuenta elegido; `sustituir` solo vale si se eligió frente a uno distinto. */
export interface ArchivoElegido {
  perfil: string
  cuenta: string
  tipo: TipoArchivoConfig
  sustituir: boolean
}

export interface EleccionArchivosIpc {
  archivosCuentas: ArchivoElegido[]
  cuentasNuevas: Array<{ perfil: string; cuenta: string }>
  reglasNativas: Array<{ agente: AgenteConConfig; sustituir: boolean }>
}

/** Lo elegido de los archivos de agentes que llega por IPC, saneado: lo que no tiene la forma, fuera. */
export function leerEleccionArchivos(crudo: Record<string, unknown>): EleccionArchivosIpc {
  const filas = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.map(objeto) : [])
  const textos = (o: Record<string, unknown>): boolean => typeof o.perfil === 'string' && typeof o.cuenta === 'string'
  return {
    archivosCuentas: filas(crudo.archivosCuentas)
      .filter((o) => textos(o) && esTipo(o.tipo))
      .map((o) => ({ perfil: o.perfil as string, cuenta: o.cuenta as string, tipo: o.tipo as TipoArchivoConfig, sustituir: o.sustituir === true })),
    cuentasNuevas: filas(crudo.cuentasNuevas).filter(textos).map((o) => ({ perfil: o.perfil as string, cuenta: o.cuenta as string })),
    reglasNativas: filas(crudo.reglasNativas)
      .filter((o) => AGENTES_CON_CONFIG.includes(o.agente as AgenteConConfig))
      .map((o) => ({ agente: o.agente as AgenteConConfig, sustituir: o.sustituir === true }))
  }
}
