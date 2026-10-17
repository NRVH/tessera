// =============================================================================
// Textos del modelo de pestañas de BD: la etiqueta de cada tipo de objeto y las piezas de los
// tooltips de la tira (colección, clave, consola, definición). Español e inglés con las mismas
// claves; se leen al usarse (`txTabsBd()`), nunca al cargar el módulo. Sin JSX ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txTabsBd = crearTextos(
  {
    tipoObjeto: {
      tabla: 'Tabla',
      vista: 'Vista',
      vistaMaterializada: 'Vista materializada',
      tablaForanea: 'Tabla foránea',
      tablaVirtual: 'Tabla virtual',
      rutina: 'Rutina',
      paquete: 'Paquete',
      secuencia: 'Secuencia',
      sinonimo: 'Sinónimo',
      tipoObjeto: 'Tipo de objeto',
      tipoColeccion: 'Tipo colección',
      tipo: 'Tipo',
      disparador: 'Disparador',
      evento: 'Evento'
    },
    definicion: ' (definición)',
    coleccion: 'Colección',
    clave: 'Clave',
    consola: 'Consola'
  },
  {
    tipoObjeto: {
      tabla: 'Table',
      vista: 'View',
      vistaMaterializada: 'Materialized view',
      tablaForanea: 'Foreign table',
      tablaVirtual: 'Virtual table',
      rutina: 'Routine',
      paquete: 'Package',
      secuencia: 'Sequence',
      sinonimo: 'Synonym',
      tipoObjeto: 'Object type',
      tipoColeccion: 'Collection type',
      tipo: 'Type',
      disparador: 'Trigger',
      evento: 'Event'
    },
    definicion: ' (definition)',
    coleccion: 'Collection',
    clave: 'Key',
    consola: 'Console'
  }
)
