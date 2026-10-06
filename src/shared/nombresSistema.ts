// =============================================================================
// Cómo se llaman, en cada sistema, las cosas de las que Tessera habla: el sistema, el
// gestor de archivos, la shell, el almacén de secretos, el agente de claves SSH y la papelera. Una frase
// de la interfaz que los nombre los pide aquí en vez de escribir «Windows» a mano.
// La plataforma es OBLIGATORIA, sin valor por defecto: lo importan el main
// (`plataformaActual()`) y el renderer (`window.tessera.plataforma`, donde no hay `process`).
// Puro: sin `process`, Electron ni `fs`; solo importa un tipo.
// Decisiones: docs/decisiones/shared/plataforma-y-nombres-del-sistema.md
// =============================================================================

import type { Plataforma } from './plataforma'

export interface NombresSistema {
  /**
   * El sistema cuando la frase lo NOMBRA como actor o como lugar: «Windows bloqueó
   * la actualización», «Exponer puertos a macOS». Es el nombre del producto, no el
   * del núcleo: en Apple, «macOS».
   */
  sistema: string
  /**
   * El sistema cuando la frase habla del EQUIPO del usuario: «no sobre tu Mac»,
   * «Abre en tu Windows con tu cuenta personal».
   *
   * Es un campo aparte y no `sistema` con un «tu» delante porque «tu macOS» no se
   * dice: en Apple el equipo se llama Mac y el sistema macOS, y son dos palabras
   * distintas. En Windows coinciden, que es justo por lo que el problema no se veía.
   */
  tuEquipo: string
  /** El gestor de archivos CON ARTÍCULO: «el Explorador», «el Finder». */
  gestorArchivos: string
  /**
   * La shell que abre el modo nativo, tal y como la reconocería el usuario.
   * En POSIX no se promete `zsh`: es su `$SHELL`, que puede ser fish o bash.
   */
  shellNativa: string
  /**
   * Qué hay detrás de `safeStorage` de Electron, que es donde se cifran las
   * contraseñas de las conexiones a bases de datos. No es cosmética: cuando una
   * contraseña deja de descifrarse, el usuario tiene que saber QUÉ mirar.
   */
  almacenSecretos: string
  /**
   * Qué guarda las claves SSH del usuario y se las ofrece a `ssh`, CON ARTÍCULO. Es lo que
   * hay detrás de la autenticación «Claves del sistema» de una conexión SSH: en Windows, el
   * servicio de agente de OpenSSH; en macOS, el agente que lee el Llavero.
   */
  agenteClavesSsh: string
  /**
   * La papelera del sistema CON ARTÍCULO, con el nombre que el usuario busca para recuperar lo
   * que Tessera mandó allí: «la Papelera de reciclaje» en Windows, «la Papelera» en macOS.
   */
  papelera: string
}

/**
 * La tabla. `'otra'` (Linux, BSD) no dice «Linux» sino el genérico: allí el gestor
 * de archivos depende del escritorio (Nautilus, Dolphin, Thunar) y el almacén de
 * claves también, así que nombrar uno concreto sería acertar en un tercio de los
 * casos y mentir en dos.
 */
const TABLA: Record<Plataforma, NombresSistema> = {
  windows: {
    sistema: 'Windows',
    tuEquipo: 'tu Windows',
    gestorArchivos: 'el Explorador',
    shellNativa: 'PowerShell',
    almacenSecretos: 'el cifrado de Windows (DPAPI)',
    agenteClavesSsh: 'el agente SSH de Windows',
    papelera: 'la Papelera de reciclaje'
  },
  mac: {
    sistema: 'macOS',
    tuEquipo: 'tu Mac',
    gestorArchivos: 'el Finder',
    shellNativa: 'tu shell de inicio de sesión',
    almacenSecretos: 'el Llavero de macOS',
    agenteClavesSsh: 'el llavero y el agente SSH',
    papelera: 'la Papelera'
  },
  otra: {
    sistema: 'el sistema',
    tuEquipo: 'tu equipo',
    gestorArchivos: 'el gestor de archivos',
    shellNativa: 'tu shell de inicio de sesión',
    almacenSecretos: 'el almacén de claves del escritorio',
    agenteClavesSsh: 'el agente SSH del sistema',
    papelera: 'la papelera'
  }
}

/** Los nombres de ESTA plataforma. Ver la cabecera: la plataforma no tiene defecto. */
export function nombresSistema(plataforma: Plataforma): NombresSistema {
  return TABLA[plataforma]
}
