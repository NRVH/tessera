// =============================================================================
// Índice de Tessera Academy: los artículos en orden y agrupados. Los títulos y las palabras de
// búsqueda, en `textosIndice.ts`. `gruposBuscables` lo da con la forma de un grupo del catálogo
// de Configuración, que lo monta como su categoría «Tessera Academy»: el buscador recorre los
// artículos igual que los ajustes. Puro.
// =============================================================================

import { CLAVES_ACADEMY, txIndice } from './textosIndice.ts'

export const INDICE_ACADEMY = [
  { grupo: 'primeros-pasos', articulos: ['bienvenida', 'glosario'] },
  { grupo: 'perfiles-y-proyectos', articulos: ['perfiles', 'proyectos', 'hibernar'] },
  {
    grupo: 'agentes',
    articulos: [
      'agentes',
      'cuentas',
      'nativo-o-docker',
      'continuar-en-otro-agente',
      'delegar-tareas',
      'reglas-del-perfil',
      'conversaciones',
      'mosaico'
    ]
  },
  { grupo: 'herramientas', articulos: ['herramientas-de-los-agentes'] },
  { grupo: 'datos-y-conexiones', articulos: ['bases-de-datos', 'ssh'] },
  { grupo: 'codigo-y-terminales', articulos: ['editor-y-explorador', 'git', 'terminales'] },
  {
    grupo: 'tessera-y-tu-equipo',
    articulos: ['contenedores-docker', 'copia-de-configuracion', 'atajos', 'actualizaciones']
  }
] as const

/** Los artículos que existen, como tipo literal: un destino mal escrito no compila. */
export type ArticuloId = (typeof INDICE_ACADEMY)[number]['articulos'][number]
export type GrupoAcademyId = (typeof INDICE_ACADEMY)[number]['grupo']

/** Los ids en el orden del índice. */
export const ARTICULOS_EN_ORDEN: readonly ArticuloId[] = INDICE_ACADEMY.flatMap((g) => g.articulos)

export function esArticulo(id: string): id is ArticuloId {
  return (ARTICULOS_EN_ORDEN as readonly string[]).includes(id)
}

/** El título de un artículo en el idioma de la interfaz. */
export function tituloDe(id: ArticuloId): string {
  return txIndice().titulos[id]
}

/** Un grupo del índice como lo recorre el buscador de Configuración. */
export interface GrupoBuscableAcademy {
  titulo: string
  ajustes: { id: ArticuloId; etiqueta: string; claves: readonly string[] }[]
}

/**
 * Los grupos con títulos en el idioma de la interfaz y las palabras de los DOS idiomas: quien no
 * entiende el que está puesto busca en el suyo.
 */
export function gruposBuscables(): GrupoBuscableAcademy[] {
  const t = txIndice()
  const { es, en } = CLAVES_ACADEMY
  return INDICE_ACADEMY.map((g) => ({
    titulo: t.grupos[g.grupo],
    ajustes: g.articulos.map((id) => ({ id, etiqueta: t.titulos[id], claves: [...es[id], ...en[id]] }))
  }))
}
