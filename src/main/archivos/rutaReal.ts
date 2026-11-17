// =============================================================================
// La guarda de enlaces de lo que el main toca en un proyecto: el proyecto se monta con escritura en el
// contenedor del agente, que puede dejar en él un enlace simbólico o una junction que apunte fuera, y la guarda
// léxica (`path.resolve` + prefijo de la raíz) no lo ve. Se resuelve la ruta real del ancestro más cercano que
// exista y se exige que caiga bajo la ruta real de la raíz. Solo verifica: quien llama sigue operando con su ruta.
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================

import { lstat, realpath } from 'node:fs/promises'
import * as path from 'node:path'

/** Lo que la guarda pide al disco; se inyecta en las pruebas. */
export interface DiscoRutaReal {
  realpath: (ruta: string) => Promise<string>
  /** ¿Existe la entrada misma, sin seguirla? Un enlace colgante existe aunque su destino no. */
  existeEntrada: (ruta: string) => Promise<boolean>
}

const discoSistema: DiscoRutaReal = {
  realpath: (ruta) => realpath(ruta),
  existeEntrada: (ruta) =>
    lstat(ruta).then(
      () => true,
      () => false
    )
}

/** Errores que significan «este tramo aún no existe»: se sube al padre. */
const NO_EXISTE = new Set(['ENOENT', 'ENOTDIR'])

function dentroDe(raizReal: string, ruta: string): boolean {
  const conSeparador = raizReal.endsWith(path.sep) ? raizReal : raizReal + path.sep
  return ruta === raizReal || ruta.startsWith(conSeparador)
}

/**
 * ¿`abs` (ya validada léxicamente bajo `raiz`) sigue dentro de la raíz al seguir los enlaces? Con
 * `seguirUltimo: false` se mira solo la carpeta que la contiene: borrar, renombrar o mover un enlace actúa sobre el
 * enlace, no sobre su destino, y tiene que poder hacerse aunque apunte fuera. Un bucle de enlaces o un error que no
 * sea «no existe» cuenta como fuera: ante la duda, no se toca.
 */
export async function sigueDentroDeLaRaiz(
  raiz: string,
  abs: string,
  opciones: { seguirUltimo: boolean },
  disco: DiscoRutaReal = discoSistema
): Promise<boolean> {
  let raizReal: string
  try {
    raizReal = await disco.realpath(raiz)
  } catch (err) {
    // Sin raíz no hay nada que proteger. En un volumen donde el sistema no sabe resolver rutas reales (algunos discos
    // virtuales o de red) tampoco se puede comprobar nada, y bloquearlo dejaría el proyecto inservible: vale la guarda
    // léxica de quien llama.
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
  let tramo = opciones.seguirUltimo || path.resolve(abs) === path.resolve(raiz) ? abs : path.dirname(abs)
  for (;;) {
    try {
      return dentroDe(raizReal, await disco.realpath(tramo))
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code ?? ''
      const padre = path.dirname(tramo)
      if (!NO_EXISTE.has(codigo) || padre === tramo) return false
      // Un enlace colgante: escribir por él crearía su destino, que puede estar fuera.
      if (await disco.existeEntrada(tramo)) return false
      tramo = padre
    }
  }
}
