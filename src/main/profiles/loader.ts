// =============================================================================
// Lee y valida un `profiles.json` (por defecto, la semilla `config/profiles.json` de la app). Un
// perfil inválido corta la carga con su índice y los errores encontrados. La copia editable la
// gestiona `store.ts`; la ruta de la app entra por `util/infoApp`.
// =============================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rutaAppPath } from '../util/infoApp'
import type { Profile } from './types'
import { validateProfileShape } from './validate'

export function loadProfiles(configPath = join(rutaAppPath(), 'config', 'profiles.json')): Profile[] {
  const raw = readFileSync(configPath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)

  if (!Array.isArray(parsed)) {
    throw new Error(`El archivo de perfiles "${configPath}" debe contener un arreglo JSON.`)
  }

  const profiles: Profile[] = []
  for (const [index, item] of parsed.entries()) {
    const errors = validateProfileShape(item)
    if (errors.length > 0) {
      throw new Error(
        `Perfil inválido en el índice ${index} de "${configPath}":\n` +
          errors.map((e) => `  - ${e}`).join('\n') +
          `\nPerfil recibido: ${JSON.stringify(item)}`
      )
    }
    profiles.push(item as Profile)
  }

  return profiles
}
