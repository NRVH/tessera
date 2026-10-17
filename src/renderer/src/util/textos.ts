// =============================================================================
// Textos de las utilidades puras del renderer en español e inglés: tiempos relativos («en 5 min»,
// «hace 2 h») y la pista de cómo se abre un nodo.
// Se leen al usarse, nunca en el nivel superior del módulo. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

export const txUtil = crearTextos(
  {
    ahora: 'ahora',
    enMenosDeUnMin: 'en menos de 1 min',
    enMin: (min: number) => `en ${min} min`,
    enHoras: (h: number) => `en ${h} h`,
    enHorasMin: (h: number, min: number) => `en ${h} h ${min} min`,
    enDias: (d: number) => `en ${d} días`,
    ahoraMismo: 'ahora mismo',
    haceMin: (min: number) => `hace ${min} min`,
    haceHoras: (h: number) => `hace ${h} h`,
    haceDias: (d: number) => `hace ${d} días`,
    dobleClic: 'doble clic',
    unirOpciones: (partes: readonly string[]) => partes.slice(0, -1).join(', ') + ' o ' + partes[partes.length - 1]
  },
  {
    ahora: 'now',
    enMenosDeUnMin: 'in less than 1 min',
    enMin: (min: number) => `in ${min} min`,
    enHoras: (h: number) => `in ${h} h`,
    enHorasMin: (h: number, min: number) => `in ${h} h ${min} min`,
    enDias: (d: number) => `in ${d} days`,
    ahoraMismo: 'just now',
    haceMin: (min: number) => `${min} min ago`,
    haceHoras: (h: number) => `${h} h ago`,
    haceDias: (d: number) => `${d} days ago`,
    dobleClic: 'double-click',
    unirOpciones: (partes: readonly string[]) =>
      partes.length === 2 ? `${partes[0]} or ${partes[1]}` : partes.slice(0, -1).join(', ') + ', or ' + partes[partes.length - 1]
  }
)
