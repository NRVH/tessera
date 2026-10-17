// =============================================================================
// Textos de Java y de los archivos comprimidos que ve la persona: los mensajes del descompilador,
// la detección de Java, el selector de java.exe y los errores de abrir un .jar o un .zip por
// dentro. Español e inglés juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos, localeActual } from '../../shared/i18n.ts'

export const txJava = crearTextos(
  {
    descompilador: {
      salidaExcesiva:
        'El descompilador generó más texto del que Tessera puede mostrar y se detuvo. ' +
        'Suele pasar con clases generadas automáticamente.',
      timeout: (s: number) => `El descompilador tardó más de ${s} s con esta clase y se detuvo.`,
      motorFallo: (motor: string, codigo: number | null) =>
        `${motor} no pudo descompilar esta clase (terminó con código ${codigo}). Prueba con el otro motor.`,
      motorVacio: (motor: string) =>
        `${motor} terminó sin errores pero no produjo código para esta clase. Prueba con el otro motor.`,
      usoCfr: 'Se usó CFR porque no hay ningún JDK 17 o superior instalado para ejecutar Vineflower.',
      noEsClase: 'Este archivo no es una clase de Java (le falta la firma 0xCAFEBABE).',
      motorNoUsable: 'Ese motor no se puede usar con las versiones de Java que hay en el equipo.'
    },
    runtime: {
      noExiste: 'Ese archivo no existe.',
      noEsJava: 'Eso no parece un java.exe: al ejecutarlo no devolvió una versión de Java.',
      sinJava: 'No se encontró ninguna instalación de Java en el equipo.',
      necesitaJdk: (requiere: number, mejor: number) =>
        `Necesita un JDK ${requiere} o superior; el más nuevo que se encontró es ${mejor}.`,
      sinJavaMensaje:
        'No se encontró Java en este equipo. Para ver el código de una clase hace falta una instalación de Java ' +
        '(cualquiera desde la 6). Si tienes una en una ruta poco habitual, elígela con "Elegir java.exe…".'
    },
    dialogo: {
      tituloWindows: 'Elige el ejecutable de Java (java.exe)',
      tituloOtro: 'Elige el ejecutable de Java (java)',
      filtro: 'Ejecutable de Java'
    },
    zip: {
      rutaVacia: 'Esa ruta no apunta a nada dentro de un archivo comprimido.',
      yaNoEsta: (interna: string) =>
        `«${interna}» ya no está dentro del archivo. ` +
        'Puede que se haya reconstruido desde la última vez que lo abriste.',
      demasiadosAnidados: 'Hay demasiados archivos anidados unos dentro de otros.',
      esCarpeta: 'Eso es una carpeta, no un archivo comprimido.',
      muyGrande: (mb: number) => `El archivo ocupa ${mb} MB y supera el máximo que Tessera abre.`,
      noAbrible: (interna: string) => `«${interna}» no es un archivo que Tessera pueda abrir por dentro.`,
      noEstaEnPadre: (interna: string) => `«${interna}» no está dentro del archivo que lo contiene.`,
      anidadoGrande: (interna: string, mb: number) =>
        `El archivo anidado «${interna}» ocupa ${mb} MB y es demasiado grande para abrirlo por dentro.`,
      incompletoLejos: 'El archivo está incompleto o dañado (se pidió leer más allá de su final).',
      incompletoCorta: 'El archivo está incompleto o dañado (lectura corta).',
      comprimidoIncompleto: 'El archivo comprimido está incompleto o dañado.',
      tamanos: 'El archivo declara tamaños que Tessera no puede manejar.',
      pequeno: 'El archivo es demasiado pequeño para ser un .jar o .zip válido.',
      sinIndice: 'No parece un archivo comprimido válido (no se encontró su índice).',
      zip64Falta: 'El archivo dice ser ZIP64 pero le falta su índice extendido.',
      zip64Danado: 'El índice extendido (ZIP64) del archivo está dañado.',
      indiceFuera: 'El índice del archivo apunta fuera de él (está dañado o incompleto).',
      indiceCortado: 'El índice del archivo se corta a mitad de una entrada; se listó lo que se pudo leer.',
      nombreNoAdmitido: (nombre: string) => `Se ignoró una entrada con un nombre no admitido: ${nombre}`,
      masDeEntradas: (n: number) =>
        `El archivo tiene más de ${n.toLocaleString(localeActual())} entradas; se listaron las primeras.`,
      repetidas: (n: number) => `Se ignoraron ${n} entrada(s) repetida(s); se conservó la primera de cada nombre.`,
      entradaGrande: (nombre: string, mb: number) =>
        `«${nombre}» ocupa ${mb} MB descomprimido y supera el máximo que Tessera abre.`,
      compresion: (nombre: string, metodo: number) =>
        `«${nombre}» usa una compresión que Tessera no sabe leer (método ${metodo}). ` +
        'Ábrelo con una herramienta externa.',
      entradaDesplazada: (nombre: string) =>
        `El archivo está dañado: la entrada «${nombre}» no está donde dice su índice.`,
      entradaSupera: (nombre: string) => `«${nombre}» supera el máximo que Tessera abre.`,
      noDescomprime: (nombre: string) => `No se pudo descomprimir «${nombre}» (puede estar dañada o cifrada).`
    }
  },
  {
    descompilador: {
      salidaExcesiva:
        'The decompiler produced more text than Tessera can show and was stopped. ' +
        'This usually happens with automatically generated classes.',
      timeout: (s: number) => `The decompiler took more than ${s} s on this class and was stopped.`,
      motorFallo: (motor: string, codigo: number | null) =>
        `${motor} could not decompile this class (it exited with code ${codigo}). Try the other engine.`,
      motorVacio: (motor: string) =>
        `${motor} finished without errors but produced no code for this class. Try the other engine.`,
      usoCfr: 'CFR was used because no JDK 17 or later is installed to run Vineflower.',
      noEsClase: 'This file is not a Java class (it lacks the 0xCAFEBABE signature).',
      motorNoUsable: 'That engine cannot be used with the Java versions on this computer.'
    },
    runtime: {
      noExiste: 'That file does not exist.',
      noEsJava: 'That does not look like a java.exe: running it did not return a Java version.',
      sinJava: 'No Java installation was found on this computer.',
      necesitaJdk: (requiere: number, mejor: number) =>
        `It needs JDK ${requiere} or later; the newest one found is ${mejor}.`,
      sinJavaMensaje:
        'Java was not found on this computer. Viewing the code of a class needs a Java installation ' +
        '(any version from 6). If you have one in an unusual location, choose it with “Choose java.exe…”.'
    },
    dialogo: {
      tituloWindows: 'Choose the Java executable (java.exe)',
      tituloOtro: 'Choose the Java executable (java)',
      filtro: 'Java executable'
    },
    zip: {
      rutaVacia: 'That path does not point to anything inside a compressed file.',
      yaNoEsta: (interna: string) =>
        `“${interna}” is no longer inside the file. ` +
        'It may have been rebuilt since you last opened it.',
      demasiadosAnidados: 'There are too many files nested inside one another.',
      esCarpeta: 'That is a folder, not a compressed file.',
      muyGrande: (mb: number) => `The file is ${mb} MB and exceeds the maximum Tessera opens.`,
      noAbrible: (interna: string) => `“${interna}” is not a file Tessera can open from the inside.`,
      noEstaEnPadre: (interna: string) => `“${interna}” is not inside the file that contains it.`,
      anidadoGrande: (interna: string, mb: number) =>
        `The nested file “${interna}” is ${mb} MB and is too large to open from the inside.`,
      incompletoLejos: 'The file is incomplete or damaged (a read past its end was requested).',
      incompletoCorta: 'The file is incomplete or damaged (short read).',
      comprimidoIncompleto: 'The compressed file is incomplete or damaged.',
      tamanos: 'The file declares sizes Tessera cannot handle.',
      pequeno: 'The file is too small to be a valid .jar or .zip.',
      sinIndice: 'It does not look like a valid compressed file (its index was not found).',
      zip64Falta: 'The file says it is ZIP64 but its extended index is missing.',
      zip64Danado: 'The file’s extended index (ZIP64) is damaged.',
      indiceFuera: 'The file’s index points outside of it (it is damaged or incomplete).',
      indiceCortado: 'The file’s index is cut off in the middle of an entry; what could be read was listed.',
      nombreNoAdmitido: (nombre: string) => `An entry with an unsupported name was ignored: ${nombre}`,
      masDeEntradas: (n: number) =>
        `The file has more than ${n.toLocaleString(localeActual())} entries; the first ones were listed.`,
      repetidas: (n: number) => `${n} duplicate entr${n === 1 ? 'y was' : 'ies were'} ignored; the first of each name was kept.`,
      entradaGrande: (nombre: string, mb: number) =>
        `“${nombre}” is ${mb} MB uncompressed and exceeds the maximum Tessera opens.`,
      compresion: (nombre: string, metodo: number) =>
        `“${nombre}” uses a compression Tessera cannot read (method ${metodo}). ` +
        'Open it with an external tool.',
      entradaDesplazada: (nombre: string) =>
        `The file is damaged: entry “${nombre}” is not where its index says.`,
      entradaSupera: (nombre: string) => `“${nombre}” exceeds the maximum Tessera opens.`,
      noDescomprime: (nombre: string) => `Could not decompress “${nombre}” (it may be damaged or encrypted).`
    }
  }
)
