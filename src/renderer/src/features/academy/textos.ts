// =============================================================================
// Textos de la interfaz de Tessera Academy: el índice de Configuración, el lector y el botón ⓘ.
// El contenido de los artículos va en `contenido/`, y sus títulos y grupos, en
// `textosIndice.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txAcademy = crearTextos(
  {
    nombre: 'Tessera Academy',
    presentacion:
      'Cómo funciona Tessera, por temas. Los botones ⓘ de los diálogos abren la parte que los explica.',
    indice: 'Índice de Tessera Academy',
    enEsteArticulo: 'En este artículo',
    anteriorEtiqueta: 'Anterior',
    siguienteEtiqueta: 'Siguiente',
    cerrar: 'Cerrar Tessera Academy',
    secciones: (n: number) => (n === 1 ? '1 sección' : `${n} secciones`),
    ayudaTitulo: (titulo: string) => `Explicación en Tessera Academy: ${titulo}`,
    ayudaAria: (titulo: string) => `Abrir la explicación «${titulo}» en Tessera Academy`,
    resultados: 'Artículos de Tessera Academy'
  },
  {
    nombre: 'Tessera Academy',
    presentacion:
      'How Tessera works, by topic. The ⓘ button in a dialog opens the section that explains that dialog.',
    indice: 'Tessera Academy contents',
    enEsteArticulo: 'In this article',
    anteriorEtiqueta: 'Previous',
    siguienteEtiqueta: 'Next',
    cerrar: 'Close Tessera Academy',
    secciones: (n: number) => (n === 1 ? '1 section' : `${n} sections`),
    ayudaTitulo: (titulo: string) => `Explained in Tessera Academy: ${titulo}`,
    ayudaAria: (titulo: string) => `Open the “${titulo}” explanation in Tessera Academy`,
    resultados: 'Tessera Academy articles'
  }
)
