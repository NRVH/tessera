// =============================================================================
// Textos de exportar e importar la configuración que ve la persona: los errores de leer y descifrar
// el archivo, los avisos de lo que hay que revisar tras importar, los motivos del historial y el filtro
// de los diálogos de archivo. Español e inglés juntos; se leen al usarse. Solo depende de shared/i18n.
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
      fraseMala: 'La frase no es la de este archivo (o el archivo está dañado).',
      historialDanado: 'El historial del archivo está dañado o alguien lo cambió.',
      historialIncompleto: 'El historial del archivo está incompleto: el archivo se cortó.',
      cambioArchivo: 'El archivo cambió desde que se abrió: vuelve a elegirlo.'
    },
    historial: {
      enlace: 'pasa por un enlace simbólico',
      fueraDeLaCuenta: 'no es una conversación o quedaría fuera de la carpeta de su cuenta',
      distinto: 'en este equipo hay otra conversación con el mismo nombre; se conserva la de aquí',
      otroFormato: 'en este equipo está con otra compresión; se conserva la de aquí',
      abierta: 'está abierta en un agente de este equipo (o se usó hace unos minutos); se conserva la de aquí',
      sinCuenta: (cuenta: string, motivo: string) => `no se pudo preparar la cuenta «${cuenta}»: ${motivo}`,
      sinProyecto: (carpeta: string) => `ningún proyecto abierto en este equipo se llama «${carpeta}»`,
      varios: (carpeta: string) => `hay varios proyectos abiertos que se llaman «${carpeta}»`,
      variosOrigen: (carpeta: string) => `en el otro equipo hay varios proyectos que se llaman «${carpeta}»`,
      larga: (carpeta: string) => `la ruta de «${carpeta}» en este equipo es demasiado larga para su carpeta de conversaciones`,
      error: (motivo: string) => `El historial no se terminó de importar: ${motivo} Lo que ya entró se queda.`
    }
  },
  {
    filtro: 'Tessera configuration backup',
    fraseCorta: (min: number) => `The passphrase must be at least ${min} characters long.`,
    demasiadoGrande: 'The file is too large to be a Tessera backup.',
    noSeLeyo: 'The file could not be read.',
    soloLocales: 'For security, Tessera only opens backups stored on this computer; open it from Settings › Export and import.',
    noAbierto: 'The file is no longer open because too much time has passed: choose it again.',
    noAbiertoCorto: 'The file is no longer open: choose it again.',
    contenidoIlegible: 'Tessera cannot interpret the contents of the file.',
    sshNoEsta: (nombre: string) =>
      `Profile “${nombre}” mounts a .ssh folder that is not on this computer: Docker agents will not see your keys until you change it.`,
    sinSecretoSsh: (alias: string) =>
      `The SSH connection “${alias}” was imported without its password: this computer has nowhere to store it, so Tessera will ask for it when you connect.`,
    elegirPerfil: 'Choose at least one profile to export.',
    archivo: {
      sinCifrado: 'The file does not specify how it is encrypted.',
      cifradoDesconocido: 'The file uses an encryption method that this version of Tessera does not support.',
      parametros: 'The encryption parameters of the file are not valid.',
      memoria: 'The encryption parameters of the file require too much memory.',
      faltaCifrado: 'Part of the encryption data is missing from the file.',
      noEsCopia: 'The file is not a Tessera configuration backup.',
      sinVersion: 'The file does not specify its version.',
      masNueva: 'The backup is from a newer version of Tessera: update Tessera to import it.',
      faltaContenido: 'Part of the content is missing from the file.',
      incompleto: 'The file is incomplete.',
      fraseMala: 'The passphrase does not match this file (or the file is damaged).',
      historialDanado: 'The history in the file is damaged or was modified.',
      historialIncompleto: 'The history in the file is incomplete: the file is truncated.',
      cambioArchivo: 'The file changed after it was opened: choose it again.'
    },
    historial: {
      enlace: 'it goes through a symbolic link',
      fueraDeLaCuenta: 'it is not a conversation, or it would end up outside its account folder',
      distinto: 'this computer has a different conversation with the same name; the local one is kept',
      otroFormato: 'this computer has it with a different compression; the local one is kept',
      abierta: 'it is open in an agent on this computer (or was used a few minutes ago); the local one is kept',
      sinCuenta: (cuenta: string, motivo: string) => `the account “${cuenta}” could not be prepared: ${motivo}`,
      sinProyecto: (carpeta: string) => `no open project on this computer is named “${carpeta}”`,
      varios: (carpeta: string) => `several open projects are named “${carpeta}”`,
      variosOrigen: (carpeta: string) => `several projects on the other computer are named “${carpeta}”`,
      larga: (carpeta: string) => `the path of “${carpeta}” on this computer is too long for its conversations folder`,
      error: (motivo: string) => `The history was not fully imported: ${motivo} Everything imported so far is kept.`
    }
  }
)
