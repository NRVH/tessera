// =============================================================================
// Si un `.tessera` que llega del SISTEMA (argv, segunda instancia u `open-file`) se puede abrir:
// solo un archivo regular de este equipo. Abrirlo no lo pide nadie dentro de Tessera, así que una
// ruta de red (en Windows, leerla ya entrega las credenciales del usuario a ese servidor) o un
// dispositivo o FIFO (la lectura no acaba) se rechazan. Puro: la plataforma entra por parámetro.
// =============================================================================
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** ¿Es en Windows una ruta de red (UNC) o de dispositivo, y no una de un disco de este equipo? */
export function esRutaRemotaWindows(ruta: string): boolean {
  const r = ruta.replace(/\//g, '\\')
  // `\\?\C:\…` es la forma larga de una ruta local; cualquier otro `\\?\` (`UNC\`, `GLOBALROOT\`, volúmenes) no.
  if (r.startsWith('\\\\?\\')) return !/^[A-Za-z]:\\/.test(r.slice(4))
  // `\\servidor\recurso` y `\\.\dispositivo`; `\??\` es el espacio de nombres interno de objetos.
  return r.startsWith('\\\\') || r.startsWith('\\??\\')
}

/** ¿Se abre la copia que llegó del sistema? `esArchivo`: `stat(...).isFile()` de la ruta ya resuelta. */
export function copiaDelSistemaAceptable(ruta: string, esArchivo: boolean, plataforma: Plataforma = plataformaActual()): boolean {
  if (!esArchivo) return false
  return plataforma !== 'windows' || !esRutaRemotaWindows(ruta)
}
