// =============================================================================
// resolverDestinoDiff: arma el DestinoDiff de un archivo tocado por un commit según su status.
// Lo usan la lista de archivos de un commit y el historial de un archivo. El «antes» se
// resuelve contra el PRIMER padre, que el llamador pasa suelto: un commit raíz (`null`) no
// tiene «antes» y todo cuenta como alta. Solo importa tipos, así que no crea ciclos.
// =============================================================================

import type { CambioArchivo } from '../../../../../shared/git-ipc'
import type { LadoDiff, DestinoDiff } from '../../editor'

/** Arma el DestinoDiff de `cambio` en `commitHash`, contra el primer padre. */
export function resolverDestinoDiff(
  commitHash: string,
  hashPadre: string | null,
  cambio: CambioArchivo
): DestinoDiff {
  const antes: LadoDiff =
    cambio.estado === 'A' || hashPadre === null
      ? { origen: 'empty', ruta: cambio.ruta }
      : {
          origen: 'commit',
          hash: hashPadre,
          ruta: cambio.estado === 'R' ? (cambio.rutaAnterior ?? cambio.ruta) : cambio.ruta
        }

  const despues: LadoDiff =
    cambio.estado === 'D'
      ? { origen: 'empty', ruta: cambio.ruta }
      : { origen: 'commit', hash: commitHash, ruta: cambio.ruta }

  return {
    commitHash,
    estado: cambio.estado,
    ruta: cambio.ruta,
    rutaAnterior: cambio.rutaAnterior,
    antes,
    despues
  }
}
