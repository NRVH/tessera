// =============================================================================
// Textos de exportar e importar la configuración que ve la persona: los errores de leer y descifrar
// el archivo, los avisos de lo que hay que revisar tras importar y el filtro de los diálogos de
// archivo. Español e inglés juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txConfiguracion = crearTextos(
  {
    filtro: 'Copia de la configuración de Tessera',
    fraseCorta: (min: number) => `La frase tiene que tener al menos ${min} caracteres.`,
    demasiadoGrande: 'El archivo es demasiado grande para ser una copia de Tessera.',
    noSeLeyo: 'No se pudo leer el archivo.',
    soloLocales: 'Por seguridad, Tessera solo abre copias de este equipo; ábrela desde Configuración › Exportar e importar.',
    noAbierto: 'El archivo ya no está abierto (pasó demasiado tiempo): vuelve a elegirlo.',
    noAbiertoCorto: 'El archivo ya no está abierto: vuelve a elegirlo.',
    contenidoIlegible: 'El contenido del archivo no se entiende.',
    sshNoEsta: (nombre: string) =>
      `El perfil «${nombre}» monta una carpeta .ssh que no está en este equipo: los agentes de Docker no verán tus llaves hasta que la cambies.`,
    sinSecretoSsh: (alias: string) =>
      `La conexión SSH «${alias}» se importó sin su contraseña: este equipo no tiene dónde guardarla, así que te la pedirá al conectar.`,
    elegirPerfil: 'Elige al menos un perfil para exportar.',
    archivo: {
      sinCifrado: 'El archivo no dice cómo está cifrado.',
      cifradoDesconocido: 'El archivo usa un cifrado que esta versión de Tessera no conoce.',
      parametros: 'Los parámetros del cifrado del archivo no son válidos.',
      memoria: 'Los parámetros del cifrado del archivo piden demasiada memoria.',
      faltaCifrado: 'Al archivo le falta parte del cifrado.',
      noEsCopia: 'El archivo no es una copia de la configuración de Tessera.',
      sinVersion: 'El archivo no dice su versión.',
      masNueva: 'La copia es de una Tessera más nueva: actualiza Tessera para importarla.',
      faltaContenido: 'Al archivo le falta parte del contenido.',
      incompleto: 'El archivo está incompleto.',
      fraseMala: 'La frase no es la de este archivo (o el archivo está dañado).'
    }
  },
  {
    filtro: 'Tessera configuration backup',
    fraseCorta: (min: number) => `The passphrase must be at least ${min} characters long.`,
    demasiadoGrande: 'The file is too large to be a Tessera backup.',
    noSeLeyo: 'The file could not be read.',
    soloLocales: 'For security, Tessera only opens backups stored on this computer; open it from Settings › Export and import.',
    noAbierto: 'The file is no longer open (too much time passed): choose it again.',
    noAbiertoCorto: 'The file is no longer open: choose it again.',
    contenidoIlegible: 'The contents of the file cannot be understood.',
    sshNoEsta: (nombre: string) =>
      `Profile “${nombre}” mounts a .ssh folder that is not on this computer: Docker agents will not see your keys until you change it.`,
    sinSecretoSsh: (alias: string) =>
      `The SSH connection “${alias}” was imported without its password: this computer has nowhere to store it, so it will ask you when connecting.`,
    elegirPerfil: 'Choose at least one profile to export.',
    archivo: {
      sinCifrado: 'The file does not say how it is encrypted.',
      cifradoDesconocido: 'The file uses an encryption that this version of Tessera does not know.',
      parametros: 'The encryption parameters of the file are not valid.',
      memoria: 'The encryption parameters of the file require too much memory.',
      faltaCifrado: 'Part of the encryption is missing from the file.',
      noEsCopia: 'The file is not a Tessera configuration backup.',
      sinVersion: 'The file does not say its version.',
      masNueva: 'The backup is from a newer Tessera: update Tessera to import it.',
      faltaContenido: 'Part of the content is missing from the file.',
      incompleto: 'The file is incomplete.',
      fraseMala: 'The passphrase is not the one for this file (or the file is damaged).'
    }
  }
)
