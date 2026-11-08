// =============================================================================
// Catálogo de claves del host para configurar los permisos SSH de un perfil.
// Define canales y tipos compartidos para consultar y guardar permisos sin intercambiar claves privadas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
export const CANAL_CLAVES_AGENTE = 'ssh:agente:claves'
export const CANAL_GUARDAR_CLAVES_AGENTE = 'ssh:agente:guardar-claves'
export interface ClaveAgente {
  ruta: string
  nombre: string
  carpeta: string
  alias: string[]
  permitida: boolean
}
export interface ApiClavesAgente {
  listar: (perfil: string) => Promise<ClaveAgente[]>
  guardar: (perfil: string, rutas: string[]) => Promise<void>
}
