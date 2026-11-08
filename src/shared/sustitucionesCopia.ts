// =============================================================================
// Lo que una importación va a sustituir de este equipo, para confirmarlo antes de escribir: las reglas de un perfil,
// la configuración de Docker, el contexto global, los archivos de las cuentas y las reglas nativas. Los ajustes no
// entran: su casilla ya dice que los sustituye. Cada elemento dice si queda versión anterior que recuperar. Puro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { AgenteConConfig, TipoArchivoConfig } from './configAgente-ipc.ts'
import type { ArbolImportar, ElementoImportar } from './seleccionCopia.ts'

export type ItemSustitucion =
  | { clase: 'reglasPerfil'; perfilAqui: string; recuperable: false }
  | { clase: 'configPerfil'; perfilAqui: string; recuperable: true }
  | { clase: 'reglasGlobales'; recuperable: false }
  | { clase: 'configGlobal'; recuperable: true }
  | { clase: 'archivoCuenta'; perfilAqui: string; agente: AgenteConConfig; tipo: TipoArchivoConfig; archivo: string; cuenta: string | null; predeterminada: boolean; recuperable: true }
  | { clase: 'reglaNativa'; agente: AgenteConConfig; archivo: string; recuperable: true }

function deArchivoCuenta(h: ElementoImportar, perfilAqui: string, cuentaAqui: ElementoImportar | undefined): ItemSustitucion {
  const archivo = h.archivo!
  return { clase: 'archivoCuenta', perfilAqui, agente: archivo.agente, tipo: archivo.tipo, archivo: archivo.nombre, cuenta: cuentaAqui?.cuenta?.predeterminada ? null : (cuentaAqui?.nombre ?? null), predeterminada: cuentaAqui?.cuenta?.predeterminada === true, recuperable: true }
}

function delPerfil(g: ArbolImportar['perfiles'][number], destino: string, sel: ReadonlySet<string>, sustituirArchivos: ReadonlySet<string>): ItemSustitucion[] {
  const fuera: ItemSustitucion[] = []
  let cuenta: ElementoImportar | undefined
  for (const h of g.hijos) {
    if (h.tipo === 'cuentaAgente') cuenta = h
    if (h.tipo === 'configDocker' && h.sustituye && sel.has(h.clave)) fuera.push({ clase: 'configPerfil', perfilAqui: destino, recuperable: true })
    if (h.archivo?.estado === 'distinto' && sustituirArchivos.has(h.clave)) fuera.push(deArchivoCuenta(h, destino, cuenta))
  }
  return fuera
}

function delGlobal(g: ElementoImportar | null, sel: ReadonlySet<string>): ItemSustitucion[] {
  if (!g?.sustituye || !sel.has(g.clave)) return []
  return [
    ...(g.partesGlobal?.reglas ?? true ? [{ clase: 'reglasGlobales', recuperable: false } as const] : []),
    ...(g.partesGlobal?.configuracion ?? true ? [{ clase: 'configGlobal', recuperable: true } as const] : [])
  ]
}

/** Lo que se va a sustituir, en el orden de la lista; dos perfiles del archivo al mismo destino cuentan una vez. */
export function sustitucionesElegidas(
  a: ArbolImportar,
  sel: ReadonlySet<string>,
  sustituir: ReadonlySet<string>,
  sustituirArchivos: ReadonlySet<string>
): ItemSustitucion[] {
  const fuera: ItemSustitucion[] = []
  const reglasVistas = new Set<string>()
  for (const g of a.perfiles) {
    const destino = g.destino
    if (destino === null) continue
    if (g.reglas === 'distintas' && sustituir.has(g.perfil.id) && !reglasVistas.has(destino)) {
      reglasVistas.add(destino)
      fuera.push({ clase: 'reglasPerfil', perfilAqui: destino, recuperable: false })
    }
    fuera.push(...delPerfil(g, destino, sel, sustituirArchivos))
  }
  fuera.push(...delGlobal(a.configGlobal, sel))
  for (const n of a.reglasNativas) {
    if (n.archivo?.estado === 'distinto' && sustituirArchivos.has(n.clave)) fuera.push({ clase: 'reglaNativa', agente: n.archivo.agente, archivo: n.archivo.ruta ?? n.archivo.nombre, recuperable: true })
  }
  return fuera
}
