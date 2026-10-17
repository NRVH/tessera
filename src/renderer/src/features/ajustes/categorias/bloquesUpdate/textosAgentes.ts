// =============================================================================
// Textos y derivaciones del bloque «Agentes» de la categoría Actualizaciones:
// la línea por CLI, la línea de estado y el resumen que sale del estado de la
// actualización nativa. Las reglas de «en curso» y «resultado pendiente» son las
// del botón de la barra (`decidirVistaBotonAgentes`), no una copia.
// =============================================================================

import type { EstadoCli } from '../../../../../../shared/agentes-nativos-ipc'
import type { NombresSistema } from '../../../../../../shared/nombresSistema'
import { type UseActualizacionNativa, decidirVistaBotonAgentes, hayNovedades } from '../../../agentes'
import { textoUltimoChequeo } from '../../../actualizaciones'
import { txLineasAgentes } from '../../textosSistema.ts'

/** Lo que dice la fila de un CLI: versión y si hay algo que hacer con él. */
export function textoCli(cli: EstadoCli, tuEquipo: string): string {
  // `instalada === null` son dos cosas en el contrato: no instalado, o la sonda falló.
  // Con un error de sonda delante se enseña el error, no «no está instalado».
  const t = txLineasAgentes().cli
  if (cli.instalada === null) {
    const base = cli.error ? t.noResponde(cli.error) : t.noInstalado(tuEquipo)
    if (cli.reparar && cli.hayNueva && cli.ultima) return t.repararReinstalando(base, cli.ultima)
    if (cli.binarioPendiente && cli.ultima) return t.repararCuando(base, cli.ultima, tuEquipo)
    return base
  }
  if (cli.binarioPendiente && cli.ultima) {
    return t.aunNoLista(cli.instalada, cli.ultima, tuEquipo)
  }
  if (cli.hayNueva && cli.ultima) {
    return cli.instalable
      ? t.disponible(cli.instalada, cli.ultima)
      : t.aMano(cli.ultima, cli.ordenManual ?? null)
  }
  return cli.ultima ? t.alDia(cli.instalada) : cli.instalada
}

/** Lo derivado del estado de la actualización nativa que la tarjeta necesita para pintarse. */
export interface ResumenAgentes {
  clis: EstadoCli[]
  atrasadas: number
  comprobadoEn: number | null
  corriendo: boolean
  hayAlgo: boolean
  resultado: 'ok' | 'error' | null
  titulo: string
}

/** Deriva el resumen de la tarjeta a partir del estado de la actualización nativa. */
export function resumirAgentes(act: UseActualizacionNativa, nombres: NombresSistema): ResumenAgentes {
  const { estado, enCurso } = act
  const clis = estado ? [estado.claude, estado.codex] : []
  const marcas = clis.map((c) => c.comprobadoEn).filter((t): t is number => t !== null)
  // `hayProyectoNativo: true` porque aquí la tarjeta se enseña siempre; de la vista se
  // toman el punto (resultado) y su título.
  const vista = decidirVistaBotonAgentes({
    estado,
    plan: act.plan,
    enCurso,
    resumen: act.resumen,
    resumenVisto: act.resumenVisto,
    hayProyectoNativo: true,
    nombres
  })
  return {
    clis,
    atrasadas: estado ? estado.sesiones.filter((s) => s.atrasada).length : 0,
    comprobadoEn: marcas.length ? Math.max(...marcas) : null,
    corriendo: enCurso !== null && enCurso !== 'terminado',
    hayAlgo: hayNovedades(estado),
    // El resultado pegajoso de la última ejecución: el botón lo pinta con un punto verde
    // o rojo, y esta tarjeta no puede decir «todo normal» mientras la barra dice que falló.
    resultado: vista.punto === 'ok' || vista.punto === 'error' ? vista.punto : null,
    titulo: vista.titulo
  }
}

function textoAtrasadas(atrasadas: number): string {
  return txLineasAgentes().atrasadas(atrasadas)
}

/** Línea de estado de la tarjeta de agentes, por orden de prioridad. */
export function lineaEstadoAgentes(
  r: ResumenAgentes,
  act: UseActualizacionNativa,
  ahora: number
): string {
  const t = txLineasAgentes()
  if (r.corriendo) return t.actualizando
  if (r.resultado) return r.titulo
  if (act.comprobando) return t.buscando
  if (act.errorComprobar) return act.errorComprobar
  if (r.atrasadas > 0) return textoAtrasadas(r.atrasadas)
  return textoUltimoChequeo(r.comprobadoEn, ahora)
}
