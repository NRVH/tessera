// =============================================================================
// Cómo se llaman, en cada sistema, las cosas de las que Tessera habla: el sistema, el
// gestor de archivos, la shell, el almacén de secretos, el agente de claves SSH y la papelera. Una frase
// de la interfaz que los nombre los pide aquí en vez de escribir «Windows» a mano.
// La plataforma es OBLIGATORIA, sin valor por defecto: lo importan el main
// (`plataformaActual()`) y el renderer (`window.tessera.plataforma`, donde no hay `process`).
// Puro: sin `process`, Electron ni `fs`. Habla el idioma activo (`i18n.ts`).
// Decisiones: docs/decisiones/shared/plataforma-y-nombres-del-sistema.md
// =============================================================================

import { idiomaActual } from './i18n.ts'
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
 * La tabla. En Linux el sistema sí se nombra, pero el gestor de archivos depende del
 * escritorio, así que va el genérico: nombrar uno concreto sería acertar en un tercio
 * de los casos y mentir en dos. El almacén de secretos sí nombra los dos que `safeStorage`
 * sabe usar, porque es lo que el usuario tiene que instalar si falta. `'otra'` (BSD) no
 * nombra nada.
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
  linux: {
    sistema: 'Linux',
    tuEquipo: 'tu equipo',
    gestorArchivos: 'el gestor de archivos',
    shellNativa: 'tu shell de inicio de sesión',
    almacenSecretos: 'el llavero del escritorio (GNOME Keyring o KWallet)',
    agenteClavesSsh: 'el agente SSH de tu sesión',
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

/** La misma tabla en inglés: el artículo va en minúscula porque abre frases a media línea. */
const TABLA_EN: Record<Plataforma, NombresSistema> = {
  windows: {
    sistema: 'Windows',
    tuEquipo: 'your Windows PC',
    gestorArchivos: 'File Explorer',
    shellNativa: 'PowerShell',
    almacenSecretos: 'Windows encryption (DPAPI)',
    agenteClavesSsh: 'the Windows SSH agent',
    papelera: 'the Recycle Bin'
  },
  mac: {
    sistema: 'macOS',
    tuEquipo: 'your Mac',
    gestorArchivos: 'the Finder',
    shellNativa: 'your login shell',
    almacenSecretos: 'the macOS Keychain',
    agenteClavesSsh: 'the keychain and the SSH agent',
    papelera: 'the Trash'
  },
  linux: {
    sistema: 'Linux',
    tuEquipo: 'your computer',
    gestorArchivos: 'the file manager',
    shellNativa: 'your login shell',
    almacenSecretos: 'the desktop keyring (GNOME Keyring or KWallet)',
    agenteClavesSsh: 'your session’s SSH agent',
    papelera: 'the Trash'
  },
  otra: {
    sistema: 'the system',
    tuEquipo: 'your computer',
    gestorArchivos: 'the file manager',
    shellNativa: 'your login shell',
    almacenSecretos: 'the desktop keyring',
    agenteClavesSsh: 'the system SSH agent',
    papelera: 'the trash'
  }
}

/** Los nombres de ESTA plataforma en el idioma activo. Ver la cabecera: la plataforma no tiene defecto. */
export function nombresSistema(plataforma: Plataforma): NombresSistema {
  return (idiomaActual() === 'en' ? TABLA_EN : TABLA)[plataforma]
}
