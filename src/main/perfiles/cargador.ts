// =============================================================================
// Lee y valida un `profiles.json` (por defecto, la semilla `config/profiles.json` de la app). Un
// perfil inválido corta la carga con su índice y los errores encontrados. La copia editable la
// gestiona `store.ts`; la ruta de la app entra por `util/infoApp`.
// =============================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rutaAplicacion } from '../util/infoApp'
import type { Perfil } from './types'
import { validarFormaDePerfil } from './validar'

export function cargarPerfiles(rutaConfig = join(rutaAplicacion(), 'config', 'profiles.json')): Perfil[] {
  const crudo = readFileSync(rutaConfig, 'utf-8')
  const analizado: unknown = JSON.parse(crudo)

  if (!Array.isArray(analizado)) {
    throw new Error(`El archivo de perfiles "${rutaConfig}" debe contener un arreglo JSON.`)
  }

  const perfiles: Perfil[] = []
  for (const [indice, elemento] of analizado.entries()) {
    const errores = validarFormaDePerfil(elemento)
    if (errores.length > 0) {
      throw new Error(
        `Perfil inválido en el índice ${indice} de "${rutaConfig}":\n` +
          errores.map((e) => `  - ${e}`).join('\n') +
          `\nPerfil recibido: ${JSON.stringify(elemento)}`
      )
    }
    perfiles.push(elemento as Perfil)
  }

  return perfiles
}
