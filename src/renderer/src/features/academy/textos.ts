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
      'Cómo funciona Tessera, por temas. El botón ⓘ de un diálogo abre la sección que explica ese diálogo.',
    indice: 'Índice de Tessera Academy',
    enEsteArticulo: 'En este artículo',
    anteriorEtiqueta: 'Anterior',
    siguienteEtiqueta: 'Siguiente',
    navegacionArticulos: 'Artículo anterior y siguiente',
    migajas: 'Ubicación en Tessera Academy',
    irAlIndice: 'Ver el índice completo de Tessera Academy',
    irAlGrupo: (grupo: string) => `Ver los demás artículos de «${grupo}» en el índice`,
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
    navegacionArticulos: 'Previous and next article',
    migajas: 'Location in Tessera Academy',
    irAlIndice: 'View the full Tessera Academy contents',
    irAlGrupo: (grupo: string) => `View the other articles in “${grupo}” in the contents`,
    cerrar: 'Close Tessera Academy',
    secciones: (n: number) => (n === 1 ? '1 section' : `${n} sections`),
    ayudaTitulo: (titulo: string) => `Explained in Tessera Academy: ${titulo}`,
    ayudaAria: (titulo: string) => `Open the “${titulo}” explanation in Tessera Academy`,
    resultados: 'Tessera Academy articles'
  }
)
