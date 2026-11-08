// =============================================================================
// Validación de la FORMA de un perfil antes de aceptarlo (al cargar y antes de guardar): campos
// y tipos, al menos un agente y sin agentes repetidos. Acumula los errores en vez de cortar en
// el primero. Pura y sin dependencias, para probarla con `node` a secas (`test-loader.mts`).
// =============================================================================

import { MAX_CARPETAS_DOCUMENTOS } from '../../shared/documentosPerfil.ts'
import { MAX_REGLAS_PERFIL } from '../../shared/reglasPerfil.ts'
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
 * El id nombra carpetas del perfil (capas compartidas, buzón del puente, cuentas): uno que llega en una copia de
 * la configuración no puede salirse de ellas. Solo se rechaza lo que cambia la ruta, para no invalidar ids
 * existentes con otros caracteres.
 */
export function idSeguroEnRutas(id: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[/\\:\u0000-\u001f]/.test(id) && !id.includes('..') && id !== '.'
}

/** Las reglas, si vienen, son un texto dentro del tope. */
function reglasValidas(reglas: unknown): boolean {
  return reglas === undefined || (typeof reglas === 'string' && reglas.length <= MAX_REGLAS_PERFIL)
}

function documentosValidos(documentos: unknown): boolean {
  return (
    Array.isArray(documentos) &&
    documentos.length <= MAX_CARPETAS_DOCUMENTOS &&
    documentos.every((d) => typeof d === 'string' && d.trim().length > 0)
  )
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
  if (p.clavesSshPermitidas !== undefined && (!Array.isArray(p.clavesSshPermitidas) || !p.clavesSshPermitidas.every((ruta) => typeof ruta === 'string' && ruta.length > 0))) {
    errors.push('"clavesSshPermitidas" debe ser un arreglo de rutas no vacías')
  }

  if (typeof p.id !== 'string' || p.id.length === 0) errors.push('"id" debe ser un string no vacío')
  else if (!idSeguroEnRutas(p.id)) errors.push('"id" no puede llevar separadores de ruta, «..» ni caracteres de control')
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

  // "reglas" es OPCIONAL: texto de las reglas del perfil para los agentes, con tope.
  if (!reglasValidas(p.reglas)) {
    errors.push(`"reglas" (si se declara) debe ser un string de como mucho ${MAX_REGLAS_PERFIL} caracteres`)
  }

  // "contextoGlobal" es OPCIONAL: ausente, el perfil usa el contexto global de los agentes.
  if (p.contextoGlobal !== undefined && p.contextoGlobal !== false) {
    errors.push('"contextoGlobal" (si se declara) solo puede ser false')
  }

  // "documentos" es OPCIONAL: carpetas de documentos de referencia. No se exige que existan: una copia
  // traída de otro equipo puede nombrar una que aquí no está, y `tctx docs` lo dice.
  if (p.documentos !== undefined && !documentosValidos(p.documentos)) {
    errors.push(`"documentos" (si se declara) debe ser un arreglo de como mucho ${MAX_CARPETAS_DOCUMENTOS} rutas no vacías`)
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

