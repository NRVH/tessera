// =============================================================================
// Textos del modal de Configuración y de las categorías de ajustes de uso general (apariencia,
// terminales, proyectos y bases de datos), en español e inglés. Lo que lleva marcado se parte en
// trozos (los impares van resaltados) y lo compone el componente. Se leen al usarse.
// Depende de `shared/i18n`. Las categorías de sistema y de actualizaciones, en `textosSistema.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txModal = crearTextos(
  {
    configuracion: 'Configuración',
    buscarPlaceholder: 'Buscar ajuste…',
    buscarAria: 'Buscar ajuste',
    cerrarTitulo: 'Cerrar (Esc)',
    cerrar: 'Cerrar',
    categorias: 'Categorías de configuración',
    gruposRiel: {
      general: 'General',
      trabajo: 'Espacio de trabajo',
      datos: 'Datos',
      tessera: 'Tessera',
      ayuda: 'Ayuda'
    },
    resultados: 'Resultados de la búsqueda',
    sinResultados: (consulta: string) => `Ningún ajuste coincide con «${consulta}».`,
    etiquetaError: 'la configuración',
    restablecerHeredado: 'Volver al valor heredado',
    restablecer: (e: string) => `Restablecer ${e}`,
    reducir: (e: string) => `Reducir ${e}`,
    aumentar: (e: string) => `Aumentar ${e}`
  },
  {
    configuracion: 'Settings',
    buscarPlaceholder: 'Search settings…',
    buscarAria: 'Search settings',
    cerrarTitulo: 'Close (Esc)',
    cerrar: 'Close',
    categorias: 'Settings categories',
    gruposRiel: {
      general: 'General',
      trabajo: 'Workspace',
      datos: 'Data',
      tessera: 'Tessera',
      ayuda: 'Help'
    },
    resultados: 'Search results',
    sinResultados: (consulta: string) => `No settings match “${consulta}”.`,
    etiquetaError: 'settings',
    restablecerHeredado: 'Reset to the inherited value',
    restablecer: (e: string) => `Reset ${e}`,
    reducir: (e: string) => `Decrease ${e}`,
    aumentar: (e: string) => `Increase ${e}`
  }
)

export const txApariencia = crearTextos(
  {
    tamanoPropio: (alto: number) => `Tamaño propio · filas de ${alto} px.`,
    igualInterfaz: 'Igual que la interfaz.',
    volverInterfaz: 'Volver a seguir el tamaño de la interfaz',
    zoom: 'Zoom',
    zoomAyuda: (mod: string) =>
      `Escala toda la ventana, incluidos el editor y las terminales, a diferencia de los tamaños anteriores. Equivale a ${mod} +/− y Ctrl+rueda; ${mod}+0 restablece el 100%.`,
    volver100: 'Volver al 100%',
    zoomVentana: 'el zoom de la ventana',
    grupoTamanos: 'Tamaño y escala',
    interfaz: 'Interfaz',
    interfazAyuda: (alto: number) =>
      `Pestañas, barra de estado y paneles. Filas de ${alto} px. No afecta al editor ni a las terminales, que tienen su propio tamaño.`,
    letraInterfaz: 'el tamaño de letra de la interfaz',
    explorador: 'Explorador',
    letraExplorador: 'el tamaño de letra del explorador',
    vistaGit: 'Vista de Git',
    letraGit: 'el tamaño de letra de la vista de Git',
    grupoEditor: 'Editor de código',
    ayudaEditor:
      'Se aplica al editor, a los diffs, a los visores de archivos y a los editores de bases de datos; el tema, también a los bloques de código de la vista previa de Markdown. El marco de Tessera y las terminales conservan sus colores.',
    nombreEditor: 'del editor de código',
    tema: 'Tema',
    temaEtiqueta: 'Tema del código',
    temaTessera: 'Tessera (predeterminado)',
    previaTema: 'Vista previa del tema del código',
    muestraCodigo:
      '// Vista previa del tema\nexport function saludar(nombre: string, veces = 3): string {\n  const saludo = `Hola, ${nombre}`\n  return saludo.repeat(veces) // también los comentarios\n}',
    grupoBarra: 'Barra de perfiles',
    minimalista: 'Perfiles en un selector compacto',
    minimalistaAyuda: 'Sustituye la banda de perfiles por un selector compacto en la barra de título.'
  },
  {
    tamanoPropio: (alto: number) => `Custom size · ${alto} px rows.`,
    igualInterfaz: 'Same as the interface.',
    volverInterfaz: 'Match the interface size',
    zoom: 'Zoom',
    zoomAyuda: (mod: string) =>
      `Scales the entire window, including the editor and terminals, unlike the sizes above. Same as ${mod} +/− and Ctrl+wheel; ${mod}+0 resets it to 100%.`,
    volver100: 'Reset to 100%',
    zoomVentana: 'the window zoom',
    grupoTamanos: 'Size and scale',
    interfaz: 'Interface',
    interfazAyuda: (alto: number) =>
      `Tabs, status bar and panels. ${alto} px rows. Does not affect the editor or terminals, which have their own size.`,
    letraInterfaz: 'the interface font size',
    explorador: 'Explorer',
    letraExplorador: 'the Explorer font size',
    vistaGit: 'Git view',
    letraGit: 'the Git view font size',
    grupoEditor: 'Code editor',
    ayudaEditor:
      'Applies to the editor, diffs, file viewers and database editors; the theme also applies to the code blocks in the Markdown preview. Tessera’s frame and the terminals keep their colors.',
    nombreEditor: 'the code editor',
    tema: 'Theme',
    temaEtiqueta: 'Code theme',
    temaTessera: 'Tessera (default)',
    previaTema: 'Code theme preview',
    muestraCodigo:
      '// Theme preview\nexport function greet(name: string, times = 3): string {\n  const greeting = `Hello, ${name}`\n  return greeting.repeat(times) // comments too\n}',
    grupoBarra: 'Profile bar',
    minimalista: 'Profiles in a compact selector',
    minimalistaAyuda: 'Replaces the profile strip with a compact selector in the title bar.'
  }
)

export const txTerminales = crearTextos(
  {
    grupoTerminal: 'Terminal',
    grupoAgente: 'Terminal del agente',
    ayudaAgente: 'Terminal de Claude Code y Codex, independiente de la terminal anterior.',
    // Con su preposición: «del editor» no se arma con «de» + «el editor».
    nombreTerminal: 'de la terminal',
    nombreAgente: 'de la terminal del agente',
    fuente: 'Fuente',
    fuenteDe: (nombre: string) => `Fuente ${nombre}`,
    tamano: 'Tamaño',
    tamanoDe: (nombre: string) => `el tamaño ${nombre}`,
    predeterminada: 'Predeterminada',
    resaltar: 'Resaltar logs y salidas',
    resaltarAyuda:
      'Muestra los errores en rojo, los avisos en amarillo y los éxitos en verde; las fechas, los procesos, las rutas, las IP y las claves de configuración llevan su propio color, también en SSH. No modifica el texto, ni la salida que ya trae color, ni los editores a pantalla completa.',
    rendimiento: 'Rendimiento',
    renderizado: 'Renderizado',
    porGpu: 'Las terminales se renderizan con la GPU.',
    porSoftware: 'No hay GPU disponible: las terminales se renderizan por software.',
    sinDatosGpu: 'sin datos de GPU'
  },
  {
    grupoTerminal: 'Terminal',
    grupoAgente: 'Agent terminal',
    ayudaAgente: 'The terminal for Claude Code and Codex, set separately from the one above.',
    nombreTerminal: 'the terminal',
    nombreAgente: 'the agent terminal',
    fuente: 'Font',
    fuenteDe: (nombre: string) => `Font for ${nombre}`,
    tamano: 'Size',
    tamanoDe: (nombre: string) => `the size of ${nombre}`,
    predeterminada: 'Default',
    resaltar: 'Highlight logs and output',
    resaltarAyuda:
      'Errors in red, warnings in yellow and successes in green; dates, processes, paths, IPs and config keys in their own color, over SSH too. The text does not change, and output that already has color or a full-screen editor stays as it is.',
    rendimiento: 'Performance',
    renderizado: 'Rendering',
    porGpu: 'Terminals draw on the GPU.',
    porSoftware: 'No GPU available: terminals draw in software.',
    sinDatosGpu: 'no GPU data'
  }
)

export const txProyectos = crearTextos(
  {
    documentos: 'Herramientas de documentos',
    documentosAyuda:
      'LibreOffice y poppler, para convertir y capturar PDF, Word, Excel y PowerPoint. Aumenta el tamaño de la imagen en aproximadamente 1 GB.',
    hornearDocumentos: 'Incluir las herramientas de documentos en la imagen',
    sandbox: 'Sandbox de Docker',
    sandboxAyuda: [
      'El agente puede instalar cualquier paquete dentro del contenedor (dispone de ',
      'sudo',
      '), pero lo instalado se pierde al hibernar el perfil o al cerrar Tessera. Lo que se marque aquí se incluye en la imagen y se conserva. Se aplica al reconstruir la imagen: la próxima vez que se abra un agente o al usar «Actualizar todos sus agentes».'
    ],
    navegador: 'Navegador de pruebas',
    navegadorAyuda:
      'Las bibliotecas del sistema que necesita Chromium (playwright install-deps). No incluye el navegador, que se instala dentro del proyecto.',
    hornearNavegador: 'Incluir las bibliotecas del sistema de Chromium en la imagen',
    otros: 'Otros paquetes',
    otrosAyuda: 'Nombres de paquetes de Debian separados por espacios.',
    otrosEtiqueta: 'Otros paquetes que incluir en la imagen del sandbox',
    otrosPlaceholder: 'p. ej. jq ripgrep',
    hibernar: 'Hibernar el agente inactivo tras',
    volver5: 'Volver a 5 minutos',
    grupoSegundoPlano: 'Agentes en segundo plano'
  },
  {
    documentos: 'Document tools',
    documentosAyuda:
      'LibreOffice and poppler, to convert and capture PDF, Word, Excel and PowerPoint files. Adds about 1 GB to the image.',
    hornearDocumentos: 'Include the document tools in the image',
    sandbox: 'Docker sandbox',
    sandboxAyuda: [
      'The agent can already install whatever it wants inside the container (it has ',
      'sudo',
      '), but that is lost when the profile hibernates or Tessera quits. What you select here is built into the image and is kept. It takes effect when the image is rebuilt: the next time an agent opens, or when you use “Update all your agents”.'
    ],
    navegador: 'Test browser',
    navegadorAyuda:
      'The system libraries Chromium needs (playwright install-deps). It does not include the browser: that is installed inside the project.',
    hornearNavegador: 'Include the Chromium system libraries in the image',
    otros: 'Other packages',
    otrosAyuda: 'Debian package names separated by spaces.',
    otrosEtiqueta: 'Other packages to include in the sandbox image',
    otrosPlaceholder: 'e.g. jq ripgrep',
    hibernar: 'Hibernate an idle agent after',
    volver5: 'Reset to 5 minutes',
    grupoSegundoPlano: 'Background agents'
  }
)

export const txBd = crearTextos(
  {
    filas: (n: string) => `${n} filas`,
    automatica: 'Automática',
    automaticaAyuda: 'Cada sentencia se confirma automáticamente al terminar.',
    manual: 'Manual',
    manualAyuda: 'Los cambios esperan a «Confirmar (Commit)» o «Revertir».',
    grupoApariencia: 'Apariencia',
    tamanoLetra: 'Tamaño de letra',
    ayudaArbolPropio: (alto: number) =>
      `Árbol de conexiones, rejillas y resultados. Tamaño propio · filas de ${alto} px.`,
    ayudaArbolIgual: 'Árbol de conexiones, rejillas y resultados. Igual que el Explorador.',
    volverExplorador: 'Volver a seguir el tamaño del Explorador',
    letraVista: 'el tamaño de letra de la vista de bases de datos',
    grupoResultados: 'Resultados',
    filasPorPagina: 'Filas por página',
    filasAyuda:
      'Número de filas que se leen en cada lectura de las tablas y de los resultados de la consola. Se aplica a partir de la siguiente lectura; lo ya cargado no cambia.',
    volverAFilas: (filas: string) => `Volver a ${filas}`,
    cerrarInactiva: 'Cerrar la sesión inactiva tras',
    inactividadNunca:
      'La sesión de una consola nunca se cierra automáticamente. Una consola con cambios sin confirmar no se cierra nunca.',
    inactividadAyuda:
      'Una consola inactiva libera su sesión y la abre de nuevo al volver a usarla; se pierde lo configurado con ALTER SESSION o SET. Una consola con cambios sin confirmar no se cierra nunca.',
    volver30: 'Volver a 30 minutos',
    grupoConsolas: 'Consolas',
    transaccion: 'Transacción al abrir',
    volverAutomatica: 'Volver a Automática'
  },
  {
    filas: (n: string) => `${n} rows`,
    automatica: 'Automatic',
    automaticaAyuda: 'Each statement commits automatically when it finishes.',
    manual: 'Manual',
    manualAyuda: 'Changes wait for “Commit” or “Roll back”.',
    grupoApariencia: 'Appearance',
    tamanoLetra: 'Font size',
    ayudaArbolPropio: (alto: number) =>
      `Connection tree, grids and results. Custom size · ${alto} px rows.`,
    ayudaArbolIgual: 'Connection tree, grids and results. Same as the Explorer.',
    volverExplorador: 'Match the Explorer size',
    letraVista: 'the font size of the database view',
    grupoResultados: 'Results',
    filasPorPagina: 'Rows per page',
    filasAyuda:
      'How many rows are read at a time in tables and in console results. It applies to the next read; what is already loaded does not change.',
    volverAFilas: (filas: string) => `Reset to ${filas}`,
    cerrarInactiva: 'Close the idle session after',
    inactividadNunca:
      'A console session never closes automatically. A console with uncommitted changes is never closed.',
    inactividadAyuda:
      'An idle console releases its session and reopens it when you use it again; anything set with ALTER SESSION or SET is lost. A console with uncommitted changes is never closed.',
    volver30: 'Reset to 30 minutes',
    grupoConsolas: 'Consoles',
    transaccion: 'Transaction mode on open',
    volverAutomatica: 'Reset to Automatic'
  }
)
