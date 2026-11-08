// =============================================================================
// Permiso de firma por ruta del host: ausencia conserva perfiles existentes; vacío deniega.
// Normaliza rutas y conserva los permisos vigentes para que una instantánea antigua no revierta revocaciones.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'

export function permiteClave(perfil: { clavesSshPermitidas?: string[] }, ruta: string, plataforma: Plataforma): boolean {
  const rutas = plataforma === 'windows' ? path.win32 : path.posix
  const normalizar = (valor: string): string => plataforma === 'windows' ? rutas.resolve(valor).toLowerCase() : rutas.resolve(valor)
  return perfil.clavesSshPermitidas === undefined || perfil.clavesSshPermitidas.some((permitida) => normalizar(permitida) === normalizar(ruta))
}

/** Las instantáneas del renderer no revierten permisos ya guardados por su canal específico. */
export function conservarPermisosSsh<T extends { id: string; clavesSshPermitidas?: string[] }>(actuales: readonly T[], siguientes: readonly T[]): T[] {
  return siguientes.map((perfil) => {
    const actual = actuales.find((anterior) => anterior.id === perfil.id)
    const copia = { ...perfil }
    if (!actual) copia.clavesSshPermitidas = []
    else if (actual.clavesSshPermitidas === undefined) delete copia.clavesSshPermitidas
    else copia.clavesSshPermitidas = [...actual.clavesSshPermitidas]
    return copia
  })
}
