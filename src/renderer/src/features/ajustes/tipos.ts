// =============================================================================
// tipos: el contrato entre `SettingsModal` y los paneles de cada categoría.
// Todas las categorías reciben lo mismo, aunque `Apariencia` no mire `terminalAppearance`:
// con una interfaz por categoría el registro `PANELES` no podría existir, y con él la
// garantía de que una categoría sin panel no compila. El precio es que cambiar un ajuste
// re-renderiza la categoría visible entera, que es barato. Sin React ni JSX: un `.ts` de
// tipos para no arrastrar componentes a la cadena de imports de nadie.
// =============================================================================

import type { DefaultProjectMode } from '../../../../shared/workspace-state-ipc'
import type { DbTxModo } from '../../../../shared/db-explorador-ipc'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { UseActualizacionNativa } from '../agentes'

/** Todo lo que Configuración puede leer y cambiar. Lo compone `ModalAjustes` desde los stores. */
export interface AjustesProps {
  /** Modo con el que NACE un proyecto nuevo (windows | docker | ask). */
  defaultProjectMode: DefaultProjectMode
  onChangeDefaultProjectMode: (mode: DefaultProjectMode) => void
  /** Banda de perfiles colapsada (solo su línea de color). */
  hideProfileNames: boolean
  onToggleProfileNames: () => void
  /**
   * Aplicar la actualización preparada al CERRAR Tessera. Lo consume el main (lee
   * el ajuste en el momento del cierre); aquí solo se enseña y se conmuta.
   */
  aplicarUpdateAlCerrar: boolean
  onToggleAplicarUpdateAlCerrar: () => void
  /**
   * Actualización de los agentes NATIVOS: el MISMO estado que el botón de la barra de
   * título (lo posee `useActualizacionNativa`), así que las dos superficies no pueden contradecirse.
   */
  actualizacionAgentes: UseActualizacionNativa
  /**
   * Cierra la configuración y abre el panel de ese botón, que es donde se revisa qué
   * sesiones se reiniciarán y se confirma: esa lista no se duplica aquí.
   */
  onAbrirActualizacionAgentes: () => void
  /**
   * Paquetes apt horneados en la imagen del sandbox de Docker. Como el anterior, lo
   * consume el MAIN (los pasa a `docker build`); aquí solo se enseñan y se editan.
   * La lista incluye el preset de documentos cuando está activo: la categoría
   * deriva de ella los dos interruptores y el campo de texto.
   */
  paquetesSandbox: string[]
  onChangePaquetesSandbox: (paquetes: string[]) => void
  /** ¿Se hornean las libs de sistema de Chromium (`playwright install-deps`)? */
  depsNavegadorSandbox: boolean
  onToggleDepsNavegadorSandbox: () => void
  /** Apariencia de la terminal de SHELL (fuente, tamaño). */
  terminalAppearance: TerminalAppearance
  onChangeTerminalAppearance: (a: TerminalAppearance) => void
  /** Apariencia de la terminal del AGENTE (CC/Codex), independiente de la anterior. */
  agentAppearance: TerminalAppearance
  onChangeAgentAppearance: (a: TerminalAppearance) => void
  /** Tamaño de letra BASE de la interfaz en px (ver theme/densidad). */
  uiFontSize: number
  onChangeUiFontSize: (px: number) => void
  /** Tamaños PROPIOS del explorador y de la vista de git. 0 = igual que la interfaz. */
  explorerFontSize: number
  onChangeExplorerFontSize: (px: number) => void
  gitFontSize: number
  onChangeGitFontSize: (px: number) => void
  /**
   * Nivel DISCRETO de zoom de webFrame (0 = 100%, cada paso ≈ 1,2×).
   *
   * La fuente de verdad NO es este número: es `webFrame`. Viaja como prop solo
   * para poder PINTARLO, porque el zoom también se cambia con Ctrl +/− y con la
   * rueda, y la fila tiene que reflejarlo en vivo.
   */
  zoomLevel: number
  onChangeZoomLevel: (nivel: number) => void
  /**
   * INTEGRACIÓN CON EL EXPLORADOR DE WINDOWS ("Abrir con Tessera").
   *
   * Estos tres son lo que el usuario marca; quien de verdad escribe el registro es el
   * MAIN, y la categoría le habla por su propio canal (`shellWindows.integracionAplicar`)
   * en vez de esperar al guardado de ajustes: escribir en el registro puede FALLAR, y el
   * canal de ajustes no puede rechazar por un efecto secundario. Estos campos son la
   * copia persistida con la que se siembra el servicio en el siguiente arranque.
   */
  menuWindowsCarpetas: boolean
  menuWindowsArchivos: boolean
  menuWindowsExtensiones: string[]
  onChangeMenuWindows: (estado: {
    carpetas: boolean
    archivos: boolean
    extensiones: string[]
  }) => void
  /**
   * ACCIÓN RÁPIDA DEL FINDER («Abrir en Tessera»), el equivalente macOS de los tres de
   * arriba. Mismo trato y por el mismo motivo: quien escribe en `~/Library/Services` es
   * el MAIN, por su propio canal (`servicioFinder.aplicar`), porque escribir en el HOME
   * puede fallar y el canal de ajustes no puede rechazar por un efecto secundario.
   *
   * ES UNO Y NO TRES a propósito. En Windows hay tres casillas porque son tres
   * superficies del registro que se encienden por separado; en macOS las extensiones ya
   * las declara el paquete (`CFBundleDocumentTypes`) y "Abrir con › Tessera" sobre un
   * archivo funciona siempre, así que lo único conmutable es el servicio del Finder
   * sobre carpetas. Una casilla de extensiones aquí sería la casilla muerta que
   * `shared/plataforma.ts` prohíbe.
   *
   * ESTO ES UNA COPIA PERSISTIDA, NO LA VERDAD. La verdad es si existe el `.workflow`
   * en el disco, y la sabe el main; el usuario puede borrarlo a mano desde el Finder.
   * El panel siembra con esto y lo corrige con lo que el main le conteste al montar.
   */
  accionRapidaFinder: boolean
  onChangeAccionRapidaFinder: (activo: boolean) => void
  /**
   * EXPLORADOR DE BASES DE DATOS. El saneado y el porqué de cada uno,
   * en `shared/ajustesBd.ts`.
   *   · `dbFontSize`: tamaño propio de la vista; 0 = igual que el Explorador.
   *   · `dbFilasPorPagina`: uno de `DB_FILAS_POR_PAGINA_OPCIONES`.
   *   · `dbTxInicial`: con qué transacción nace una consola nueva (fuera de producción, que
   *     manda; la casilla «Solo lectura» es de los agentes y no cuenta).
   *   · `dbConsolaInactividadMin`: minutos tras los que se cierra una consola ociosa sin
   *     transacción pendiente; 0 = Nunca. Lo aplica el MAIN (le llega por el guardado).
   */
  dbFontSize: number
  onChangeDbFontSize: (px: number) => void
  dbFilasPorPagina: number
  onChangeDbFilasPorPagina: (n: number) => void
  dbTxInicial: DbTxModo
  onChangeDbTxInicial: (modo: DbTxModo) => void
  dbConsolaInactividadMin: number
  onChangeDbConsolaInactividadMin: (min: number) => void
  /**
   * Minutos sin actividad tras los que se hiberna el agente de un proyecto que no está en
   * pantalla; 0 = Nunca. El saneado, en `shared/ajustesAgente.ts`.
   */
  agenteInactividadMin: number
  onChangeAgenteInactividadMin: (min: number) => void
}

/** Lo que recibe el panel de UNA categoría: los ajustes más el filtro del buscador. */
export interface PropsCategoria extends AjustesProps {
  /**
   * ¿Se pinta esta fila con el filtro puesto? El modal lo calcula UNA vez con
   * `filtrarAjustes` sobre todo el catálogo y lo pasa igual a las cuatro, así el
   * catálogo y lo que se ve no pueden divergir.
   */
  ve: (id: string) => boolean
}
