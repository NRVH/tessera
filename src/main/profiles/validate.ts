// =============================================================================
// Validación de la FORMA de un perfil antes de aceptarlo (al cargar y antes de guardar): campos
// y tipos, al menos un agente y sin agentes repetidos. Acumula los errores en vez de cortar en
// el primero. Pura y sin dependencias, para probarla con `node` a secas (`test-loader.mts`).
// =============================================================================

import type { Agente, AgenteConfig } from './types'

const AGENTES: Agente[] = ['claude-code', 'codex']

function isAgenteConfig(value: unknown): value is AgenteConfig {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  if (typeof a.tipo !== 'string' || !AGENTES.includes(a.tipo as Agente)) return false
  if (typeof a.configDir !== 'string' || a.configDir.length === 0) return false
  return true
}

/**
 * Valida la forma de un perfil y devuelve la lista de errores encontrados
 * (vacía si es válido). Se acumulan en vez de cortar en el primero para que
 * el mensaje de error final sea explícito por cada regla violada.
 */
export function validateProfileShape(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null) {
    return ['el perfil debe ser un objeto']
  }
  const p = value as Record<string, unknown>

  if (typeof p.id !== 'string' || p.id.length === 0) errors.push('"id" debe ser un string no vacío')
  if (typeof p.nombre !== 'string' || p.nombre.length === 0) errors.push('"nombre" debe ser un string no vacío')
  if (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color)) {
    errors.push('"color" debe ser un hex de la forma #RRGGBB')
  }

  if (!Array.isArray(p.agentes) || p.agentes.length === 0) {
    errors.push('"agentes" debe ser un arreglo con al menos un agente')
  } else {
    const tiposVistos = new Set<string>()
    p.agentes.forEach((agenteRaw, i) => {
      if (!isAgenteConfig(agenteRaw)) {
        errors.push(`"agentes[${i}]" debe tener "tipo" (claude-code|codex) y "configDir" no vacío`)
        return
      }
      if (tiposVistos.has(agenteRaw.tipo)) {
        errors.push(`"agentes" tiene el tipo duplicado "${agenteRaw.tipo}": cada perfil admite un único agente por tipo`)
      }
      tiposVistos.add(agenteRaw.tipo)
    })
  }

  // "sshDir" es OPCIONAL: si no viene, el perfil sigue válido (no se monta .ssh).
  // Si viene, debe ser un string no vacío (ruta host absoluta de Windows). No se
  // valida aquí que la carpeta exista: eso lo resuelve el montaje en runtime.
  if (p.sshDir !== undefined && (typeof p.sshDir !== 'string' || p.sshDir.length === 0)) {
    errors.push('"sshDir" (si se declara) debe ser un string no vacío: la ruta host absoluta de la carpeta .ssh')
  }

  if (typeof p.sandbox !== 'object' || p.sandbox === null) {
    errors.push('"sandbox" debe ser un objeto')
  } else {
    const sandbox = p.sandbox as Record<string, unknown>
    if (typeof sandbox.habilitado !== 'boolean') errors.push('"sandbox.habilitado" debe ser boolean')
    // "redHost" es OPCIONAL: si no viene, el contenedor usa red bridge aislada.
    if (sandbox.redHost !== undefined && typeof sandbox.redHost !== 'boolean') {
      errors.push('"sandbox.redHost" (si se declara) debe ser boolean')
    }
  }

  return errors
}

