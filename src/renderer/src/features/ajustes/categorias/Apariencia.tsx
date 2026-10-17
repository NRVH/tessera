// =============================================================================
// Categoría APARIENCIA: idioma, tamaños de letra de la interfaz, el explorador y la vista
// de git, zoom de la ventana y colapso de la banda de perfiles.
// «Interfaz» es la BASE; «Explorador» y «Vista de git» heredan de ella y enseñan
// su tamaño efectivo, con una flecha para volver a heredar. El zoom escala TODO
// (editor y terminales incluidos) y se mueve por niveles pero se lee en porcentajes.
// Depende de `theme/densidad` y de las primitivas de Configuración.
// =============================================================================

import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../../../../../shared/workspace-state-ipc'
import {
  UI_FONT_MAX,
  UI_FONT_MIN,
  altoFila,
  resolverTamano,
  tieneTamanoPropio
} from '../../../theme/densidad'
import { Fila, Grupo, Interruptor, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { etiquetaModPrincipal } from '../../../util/atajos'
import { txApariencia } from '../textos.ts'
import { GrupoIdioma } from './GrupoIdioma'

/** Nivel de zoom -> lo que se lee. Cada paso de webFrame es un factor de 1,2. */
function porcentajeZoom(nivel: number): string {
  return `${Math.round(1.2 ** nivel * 100)}%`
}

/** Fila de un tamaño que hereda el de la interfaz: enseña el efectivo y deja volver a heredar. */
function FilaTamanoHeredado({
  etiqueta,
  etiquetaStepper,
  propio,
  efectivo,
  onChange
}: {
  etiqueta: string
  etiquetaStepper: string
  /** Valor guardado: 0 mientras hereda. */
  propio: number
  efectivo: number
  onChange: (v: number) => void
}): React.JSX.Element {
  const t = txApariencia()
  return (
    <Fila
      sangrada
      etiqueta={etiqueta}
      ayuda={tieneTamanoPropio(propio) ? t.tamanoPropio(altoFila(efectivo)) : t.igualInterfaz}
      modificado={tieneTamanoPropio(propio)}
      onRestablecer={() => onChange(0)}
      tituloRestablecer={t.volverInterfaz}
      control={
        <Stepper
          valor={efectivo}
          min={UI_FONT_MIN}
          max={UI_FONT_MAX}
          onChange={onChange}
          etiqueta={etiquetaStepper}
        />
      }
    />
  )
}

function FilaZoom({
  zoomLevel,
  onChangeZoomLevel
}: Pick<PropsCategoria, 'zoomLevel' | 'onChangeZoomLevel'>): React.JSX.Element {
  const t = txApariencia()
  return (
    <Fila
      etiqueta={t.zoom}
      // `+/−` y `0` van con el modificador principal (⌘ en Mac). Ctrl+rueda NO:
      // el pellizco del trackpad llega como rueda con un Ctrl SINTÉTICO de
      // Chromium en las dos plataformas, así que ahí Ctrl es literal.
      ayuda={t.zoomAyuda(etiquetaModPrincipal())}
      modificado={zoomLevel !== 0}
      onRestablecer={() => onChangeZoomLevel(0)}
      tituloRestablecer={t.volver100}
      control={
        <Stepper
          valor={zoomLevel}
          min={ZOOM_LEVEL_MIN}
          max={ZOOM_LEVEL_MAX}
          onChange={onChangeZoomLevel}
          etiqueta={t.zoomVentana}
          formato={porcentajeZoom}
        />
      }
    />
  )
}

function GrupoTamanos({
  ve,
  uiFontSize,
  onChangeUiFontSize,
  explorerFontSize,
  onChangeExplorerFontSize,
  gitFontSize,
  onChangeGitFontSize,
  zoomLevel,
  onChangeZoomLevel
}: PropsCategoria): React.JSX.Element {
  // Tamaño BASE ya resuelto (0 = el predeterminado) y el EFECTIVO de cada
  // superficie: subir desde una que hereda empieza justo donde estaba.
  const base = resolverTamano(uiFontSize, 0)
  const t = txApariencia()
  return (
    <Grupo titulo={t.grupoTamanos}>
      {ve('ui-font') && (
        <Fila
          etiqueta={t.interfaz}
          ayuda={t.interfazAyuda(altoFila(base))}
          control={
            <Stepper
              valor={base}
              min={UI_FONT_MIN}
              max={UI_FONT_MAX}
              onChange={onChangeUiFontSize}
              etiqueta={t.letraInterfaz}
            />
          }
        />
      )}
      {ve('explorer-font') && (
        <FilaTamanoHeredado
          etiqueta={t.explorador}
          etiquetaStepper={t.letraExplorador}
          propio={explorerFontSize}
          efectivo={resolverTamano(uiFontSize, explorerFontSize)}
          onChange={onChangeExplorerFontSize}
        />
      )}
      {ve('git-font') && (
        <FilaTamanoHeredado
          etiqueta={t.vistaGit}
          etiquetaStepper={t.letraGit}
          propio={gitFontSize}
          efectivo={resolverTamano(uiFontSize, gitFontSize)}
          onChange={onChangeGitFontSize}
        />
      )}
      {ve('zoom') && <FilaZoom zoomLevel={zoomLevel} onChangeZoomLevel={onChangeZoomLevel} />}
    </Grupo>
  )
}

export function Apariencia(props: PropsCategoria): React.JSX.Element {
  const { ve, hideProfileNames, onToggleProfileNames } = props
  const hayTamanos = ve('ui-font') || ve('explorer-font') || ve('git-font') || ve('zoom')
  const t = txApariencia()

  return (
    <>
      {ve('idioma') && <GrupoIdioma />}
      {hayTamanos && <GrupoTamanos {...props} />}

      {ve('banda') && (
        <Grupo titulo={t.grupoBarra}>
          <Fila
            etiqueta={t.minimalista}
            ayuda={t.minimalistaAyuda}
            control={
              <Interruptor
                activo={hideProfileNames}
                onChange={onToggleProfileNames}
                etiqueta={t.minimalista}
              />
            }
          />
        </Grupo>
      )}
    </>
  )
}
