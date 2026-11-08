// =============================================================================
// Contrato IPC de los documentos de referencia de un perfil: elegir una carpeta y saber qué hay en las elegidas.
// Las carpetas se guardan en el perfil (`Profile.documentos`); esto solo ayuda a elegirlas y a revisarlas.
// Decisiones: docs/decisiones/agentes/documentos-del-perfil.md
// =============================================================================

export const DOCUMENTOS_CHANNELS = {
  /** invoke: el diálogo del sistema para elegir una carpeta; su ruta, o null si se cancela. */
  ELEGIR_CARPETA: 'documentos:elegirCarpeta',
  /** invoke: por cada carpeta, si existe en este equipo y cuántos documentos tiene. */
  RESUMEN: 'documentos:resumen'
} as const

export interface ResumenCarpetaDocumentos {
  carpeta: string
  existe: boolean
  documentos: number
}
