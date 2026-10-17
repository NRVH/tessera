// =============================================================================
// Textos de los visores del editor: archivos binarios (pdf, docx, zip, audio, vídeo), imágenes y su diff, clases
// Java descompiladas, diff de comprimidos, diagramas y vista previa de HTML.
// Sin JSX ni DOM. Lo común del editor y del diff de texto está en textos.ts.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txVisorComun = crearTextos(
  {
    cargando: 'Cargando…',
    cerrarArchivo: 'Cerrar archivo',
    abrirExternamente: 'Abrir externamente',
    mostrarEnExplorador: 'Mostrar en el explorador de archivos',
    noSePudoAbrirConApp: (err: string) => `No se pudo abrir con una app del sistema: ${err}`
  },
  {
    cargando: 'Loading…',
    cerrarArchivo: 'Close file',
    abrirExternamente: 'Open externally',
    mostrarEnExplorador: 'Show in file manager',
    noSePudoAbrirConApp: (err: string) => `Could not open with a system app: ${err}`
  }
)

export const txBinario = crearTextos(
  {
    tipoPdf: 'PDF',
    tipoDocx: 'Documento Word',
    tipoZip: 'Archivo comprimido',
    abrirEnWord: 'Abrir en Word',
    abrirTitulo: (etiqueta: string) =>
      `${etiqueta}: abre el archivo con su aplicación del sistema (fidelidad total)`,
    noSePudoAbrir: 'No se pudo abrir el archivo',
    buscarEnDocumento: 'Buscar en el documento',
    queVersion: 'Qué versión se está mostrando',
    zipResumen: (archivos: number, carpetas: number, tamano: string) =>
      `${archivos} archivo(s)${carpetas > 0 ? `, ${carpetas} carpeta(s)` : ''} · ${tamano} sin comprimir`,
    archivoVacio: 'El archivo está vacío.',
    colNombre: 'Nombre',
    colTamano: 'Tamaño',
    colComprimido: 'Comprimido',
    pdfExcede: 'El PDF supera el máximo (50 MiB) y no puede mostrarse completo.',
    pdfNoExiste: 'El PDF no existe en esta revisión.',
    tipoAudio: 'Audio',
    tipoVideo: 'Vídeo',
    mediaExcede: 'El archivo supera el máximo (50 MiB) para reproducirlo aquí. Ábrelo con la app del sistema.',
    mediaNoExiste: 'El archivo no existe en esta revisión.',
    noReproducible: 'Este formato no se puede reproducir aquí. Ábrelo con la app del sistema.',
    convertido: (n: number) =>
      `Convertido con ${n} aviso(s) de formato. Usa "Abrir en Word" para verlo tal cual.`
  },
  {
    tipoPdf: 'PDF',
    tipoDocx: 'Word document',
    tipoZip: 'Compressed archive',
    abrirEnWord: 'Open in Word',
    abrirTitulo: (etiqueta: string) =>
      `${etiqueta}: opens the file with its system application (full fidelity)`,
    noSePudoAbrir: 'Could not open the file',
    buscarEnDocumento: 'Search in the document',
    queVersion: 'Which version is being shown',
    zipResumen: (archivos: number, carpetas: number, tamano: string) =>
      `${archivos} file${archivos === 1 ? '' : 's'}${carpetas > 0 ? `, ${carpetas} folder${carpetas === 1 ? '' : 's'}` : ''} · ${tamano} uncompressed`,
    archivoVacio: 'The archive is empty.',
    colNombre: 'Name',
    colTamano: 'Size',
    colComprimido: 'Compressed',
    pdfExcede: 'The PDF exceeds the maximum (50 MiB) and cannot be shown in full.',
    pdfNoExiste: 'The PDF does not exist in this revision.',
    tipoAudio: 'Audio',
    tipoVideo: 'Video',
    mediaExcede: 'The file exceeds the maximum (50 MiB) to play it here. Open it with the system app.',
    mediaNoExiste: 'The file does not exist in this revision.',
    noReproducible: 'This format cannot be played here. Open it with the system app.',
    convertido: (n: number) =>
      `Converted with ${n} formatting warning${n === 1 ? '' : 's'}. Use “Open in Word” to see it as is.`
  }
)

export const txImagen = crearTextos(
  {
    aria: 'Imagen',
    codigoSvgClic: 'Código SVG — clic para ver la imagen',
    imagenClic: 'Imagen — clic para ver el código SVG',
    codigoSvgAria: 'Código SVG (cambiar a imagen)',
    imagenAria: 'Imagen (cambiar a código SVG)',
    abrirExternamenteTitulo: 'Abrir externamente: abre la imagen con su aplicación del sistema',
    mostrarEnCarpeta: 'Mostrar en la carpeta',
    controlesZoom: 'Controles de zoom',
    alejar: 'Alejar',
    tamanoReal: 'Tamaño real (100 %)',
    acercar: 'Acercar',
    ajustarTitulo: 'Ajustar a la ventana',
    ajustar: 'Ajustar',
    rotarTitulo: 'Rotar 90°',
    rotarAria: 'Rotar 90 grados',
    supera50: 'La imagen supera el máximo (50 MiB) y no puede mostrarse completa.',
    sinDimensiones: 'No se pudieron determinar las dimensiones de la imagen.',
    formatoNoMostrable:
      'Este formato de imagen no se puede mostrar en el visor. Ábrelo con la aplicación del sistema.',
    noSePudoLeerCodigo: (err: string) => `No se pudo leer el código: ${err}`,
    // Diff de imagen
    diffAria: 'Diff de imagen',
    noSePudoLeer: 'No se pudo leer la imagen.',
    noSePudoLeerSugerencia:
      'Puede que la revisión ya no exista o que el repositorio esté en un estado raro.',
    antes: 'Antes',
    despues: 'Después',
    nuevo: 'No existía: el archivo es nuevo.',
    sinVersionAnterior: 'No hay versión anterior.',
    borradoEnRevision: 'Se borró en esta revisión.',
    sinVersionPosterior: 'No hay versión posterior.',
    mismasDimensionesYPeso: (w: number, h: number) => `Mismas dimensiones (${w}×${h}) y mismo peso.`,
    mismasDimensionesOtroContenido: (w: number, h: number) =>
      `Mismas dimensiones (${w}×${h}): el cambio está en el contenido.`,
    cerrarDiff: 'Cerrar diff',
    pesaDemasiado: (tamano: string) => `Pesa ${tamano} y supera el máximo de 50 MiB: no se puede pintar.`,
    navegadorNoDibuja:
      'El navegador no sabe dibujar este formato. Ábrelo desde el explorador con la aplicación del sistema.'
  },
  {
    aria: 'Image',
    codigoSvgClic: 'SVG code — click to see the image',
    imagenClic: 'Image — click to see the SVG code',
    codigoSvgAria: 'SVG code (switch to image)',
    imagenAria: 'Image (switch to SVG code)',
    abrirExternamenteTitulo: 'Open externally: opens the image with its system application',
    mostrarEnCarpeta: 'Show in folder',
    controlesZoom: 'Zoom controls',
    alejar: 'Zoom out',
    tamanoReal: 'Actual size (100%)',
    acercar: 'Zoom in',
    ajustarTitulo: 'Fit to window',
    ajustar: 'Fit',
    rotarTitulo: 'Rotate 90°',
    rotarAria: 'Rotate 90 degrees',
    supera50: 'The image exceeds the maximum (50 MiB) and cannot be shown in full.',
    sinDimensiones: 'Could not determine the image dimensions.',
    formatoNoMostrable:
      'This image format cannot be shown in the viewer. Open it with the system application.',
    noSePudoLeerCodigo: (err: string) => `Could not read the code: ${err}`,
    diffAria: 'Image diff',
    noSePudoLeer: 'Could not read the image.',
    noSePudoLeerSugerencia:
      'The revision may no longer exist, or the repository may be in an unusual state.',
    antes: 'Before',
    despues: 'After',
    nuevo: 'It did not exist: the file is new.',
    sinVersionAnterior: 'There is no previous version.',
    borradoEnRevision: 'Deleted in this revision.',
    sinVersionPosterior: 'There is no later version.',
    mismasDimensionesYPeso: (w: number, h: number) => `Same dimensions (${w}×${h}) and same size.`,
    mismasDimensionesOtroContenido: (w: number, h: number) =>
      `Same dimensions (${w}×${h}): the change is in the content.`,
    cerrarDiff: 'Close diff',
    pesaDemasiado: (tamano: string) => `It is ${tamano} and exceeds the 50 MiB maximum: it cannot be drawn.`,
    navegadorNoDibuja:
      'The browser cannot draw this format. Open it from the explorer with the system application.'
  }
)

export const txJava = crearTextos(
  {
    aria: 'Clase',
    volverADescompilar: (motor: string) => `Volver a descompilar con ${motor}`,
    cerrar: 'Cerrar',
    descompilando: (nombre: string) => `Descompilando ${nombre}…`,
    enCache: 'en caché',
    sinInfoDepuracion: 'La clase se compiló sin información de depuración (-g)',
    sinNombresVariables: 'sin nombres de variables',
    recortado: 'recortado',
    probarCon: (motor: string) => `Probar con ${motor}`,
    buscandoJava: 'Buscando Java…',
    volverADetectar: 'Volver a detectar Java',
    elegirJavaExe: 'Elegir java.exe…',
    elegirJava: 'Elegir java…',
    ocultarDetalle: 'Ocultar detalle',
    verDetalle: 'Ver detalle',
    falloSinDetalle: 'La clase no se pudo descompilar y el motor no dio ninguna explicación.'
  },
  {
    aria: 'Class',
    volverADescompilar: (motor: string) => `Decompile again with ${motor}`,
    cerrar: 'Close',
    descompilando: (nombre: string) => `Decompiling ${nombre}…`,
    enCache: 'cached',
    sinInfoDepuracion: 'The class was compiled without debug information (-g)',
    sinNombresVariables: 'no variable names',
    recortado: 'truncated',
    probarCon: (motor: string) => `Try with ${motor}`,
    buscandoJava: 'Looking for Java…',
    volverADetectar: 'Detect Java again',
    elegirJavaExe: 'Choose java.exe…',
    elegirJava: 'Choose java…',
    ocultarDetalle: 'Hide details',
    verDetalle: 'Show details',
    falloSinDetalle: 'The class could not be decompiled and the engine gave no explanation.'
  }
)

export const txComprimido = crearTextos(
  {
    volverA: (nombre: string) => `Volver a ${nombre}`,
    descompiladoCon: (motor: string | null, version: string, jvm: number) =>
      `Descompilado con ${motor} ${version} sobre JVM ${jvm}`,
    bytecode: (major: number, minor: number, plataforma: string) =>
      ` · bytecode ${major}.${minor} (${plataforma})`,
    sinNombresLocales: ' · sin nombres de variables (la clase no trae LocalVariableTable)',
    entradasQueCambiaron: 'Entradas que cambiaron',
    comparando: 'Comparando…',
    repartoEntradasDiff: 'Reparto entre las entradas y el diff',
    sinDiferencias: 'Sin diferencias dentro del archivo',
    entradasCambiadas: (n: number) => `${n} ${n === 1 ? 'entrada cambiada' : 'entradas cambiadas'}`,
    identicas: (n: number) => ` · ${n} idénticas`,
    listaRecortada: ' · lista recortada',
    elegirEntrada: 'Elige una entrada para ver sus diferencias',
    noSePudoComparar: 'No se pudo comparar el archivo',
    sinDiferenciasHint:
      'Las dos versiones del comprimido tienen el mismo contenido. Pueden diferir en fechas o en el orden de las entradas, que no cambian lo que hay dentro.',
    nueva: (tamano: string) => `Nueva, ${tamano}.`,
    borrada: (tamano: string) => `Borrada; ocupaba ${tamano}.`,
    cambio: (antes: string, despues: string) => `Cambió de ${antes} a ${despues}.`,
    entradaBinaria: 'Entrada binaria: no hay diff de texto que mostrar.',
    grandeEnteraTitulo: 'La entrada es demasiado grande para compararla entera.',
    grandeEnteraHint: 'Sólo se pudo leer el principio, y un diff a medias se leería como un borrado gigante.',
    grandeAquiTitulo: 'La entrada es demasiado grande para compararla aquí.',
    noSePudoLeerEntrada: 'No se pudo leer esta entrada',
    comparandoArchivo: 'Comparando el archivo…',
    leyendoEntrada: 'Leyendo la entrada…',
    tituloNueva: (nombre: string, tamano: string) => `${nombre}\nNueva · ${tamano}`,
    tituloBorrada: (nombre: string, tamano: string) => `${nombre}\nBorrada · ocupaba ${tamano}`,
    tituloModificada: (nombre: string, antes: string, despues: string) =>
      `${nombre}\nModificada · ${antes} → ${despues}`
  },
  {
    volverA: (nombre: string) => `Back to ${nombre}`,
    descompiladoCon: (motor: string | null, version: string, jvm: number) =>
      `Decompiled with ${motor} ${version} on JVM ${jvm}`,
    bytecode: (major: number, minor: number, plataforma: string) =>
      ` · bytecode ${major}.${minor} (${plataforma})`,
    sinNombresLocales: ' · no variable names (the class has no LocalVariableTable)',
    entradasQueCambiaron: 'Entries that changed',
    comparando: 'Comparing…',
    repartoEntradasDiff: 'Split between the entries and the diff',
    sinDiferencias: 'No differences inside the archive',
    entradasCambiadas: (n: number) => `${n} ${n === 1 ? 'entry changed' : 'entries changed'}`,
    identicas: (n: number) => ` · ${n} identical`,
    listaRecortada: ' · list truncated',
    elegirEntrada: 'Choose an entry to see its differences',
    noSePudoComparar: 'Could not compare the file',
    sinDiferenciasHint:
      'The two versions of the archive have the same content. They may differ in dates or in the order of the entries, which do not change what is inside.',
    nueva: (tamano: string) => `New, ${tamano}.`,
    borrada: (tamano: string) => `Deleted; it took up ${tamano}.`,
    cambio: (antes: string, despues: string) => `Changed from ${antes} to ${despues}.`,
    entradaBinaria: 'Binary entry: there is no text diff to show.',
    grandeEnteraTitulo: 'The entry is too large to compare in full.',
    grandeEnteraHint: 'Only the beginning could be read, and a partial diff would look like a huge deletion.',
    grandeAquiTitulo: 'The entry is too large to compare here.',
    noSePudoLeerEntrada: 'Could not read this entry',
    comparandoArchivo: 'Comparing the file…',
    leyendoEntrada: 'Reading the entry…',
    tituloNueva: (nombre: string, tamano: string) => `${nombre}\nNew · ${tamano}`,
    tituloBorrada: (nombre: string, tamano: string) => `${nombre}\nDeleted · took up ${tamano}`,
    tituloModificada: (nombre: string, antes: string, despues: string) =>
      `${nombre}\nModified · ${antes} → ${despues}`
  }
)

export const txVistaPrevia = crearTextos(
  {
    diagramaVacio: 'El diagrama está vacío.',
    diagramaSintaxis: 'El diagrama tiene un error de sintaxis.',
    noSePudoDibujar: (err: string) => `No se pudo dibujar el diagrama: ${err}`,
    sinCarpeta: (lista: string) => `la página se carga sin su carpeta, así que no resuelven: ${lista}`,
    sinRed: (lista: string) => `esta vista no sale a la red, así que no se descargan: ${lista}`,
    unirPartes: '; y ',
    faltanRecursos: (partes: string) =>
      `Faltan recursos y por eso la página puede verse sin formato — ${partes}. Tampoco se ejecuta JavaScript.`
  },
  {
    diagramaVacio: 'The diagram is empty.',
    diagramaSintaxis: 'The diagram has a syntax error.',
    noSePudoDibujar: (err: string) => `Could not draw the diagram: ${err}`,
    sinCarpeta: (lista: string) => `the page is loaded without its folder, so these do not resolve: ${lista}`,
    sinRed: (lista: string) => `this view does not reach the network, so these are not downloaded: ${lista}`,
    unirPartes: '; and ',
    faltanRecursos: (partes: string) =>
      `Some resources are missing, so the page may look unstyled — ${partes}. JavaScript does not run either.`
  }
)
