// =============================================================================
// Categoría APARIENCIA: tamaños de letra de la interfaz, el explorador y la vista
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
  return (
    <Fila
      sangrada
      etiqueta={etiqueta}
      ayuda={
        tieneTamanoPropio(propio)
          ? `Tamaño propio · filas de ${altoFila(efectivo)} px.`
          : 'Igual que la interfaz.'
      }
      modificado={tieneTamanoPropio(propio)}
      onRestablecer={() => onChange(0)}
      tituloRestablecer="Volver a seguir el tamaño de la interfaz"
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
  return (
    <Fila
      etiqueta="Zoom"
      ayuda={
        // `+/−` y `0` van con el modificador principal (⌘ en Mac). Ctrl+rueda NO:
        // el pellizco del trackpad llega como rueda con un Ctrl SINTÉTICO de
        // Chromium en las dos plataformas, así que ahí Ctrl es literal.
        <>
          Escala TODA la ventana —editor y terminales incluidos—, al contrario que los
          tamaños de arriba. Es lo mismo que {etiquetaModPrincipal()} +/− y Ctrl+rueda;{' '}
          {etiquetaModPrincipal()}+0 lo devuelve al 100%.
        </>
      }
      modificado={zoomLevel !== 0}
      onRestablecer={() => onChangeZoomLevel(0)}
      tituloRestablecer="Volver al 100%"
      control={
        <Stepper
          valor={zoomLevel}
          min={ZOOM_LEVEL_MIN}
          max={ZOOM_LEVEL_MAX}
          onChange={onChangeZoomLevel}
          etiqueta="el zoom de la ventana"
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
  return (
    <Grupo titulo="Tamaño y escala">
      {ve('ui-font') && (
        <Fila
          etiqueta="Interfaz"
          ayuda={
            <>
              Pestañas, barra de estado y paneles. Filas de {altoFila(base)} px. No toca el
              editor ni las terminales, que tienen su propio tamaño.
            </>
          }
          control={
            <Stepper
              valor={base}
              min={UI_FONT_MIN}
              max={UI_FONT_MAX}
              onChange={onChangeUiFontSize}
              etiqueta="el tamaño de letra de la interfaz"
            />
          }
        />
      )}
      {ve('explorer-font') && (
        <FilaTamanoHeredado
          etiqueta="Explorador"
          etiquetaStepper="el tamaño de letra del explorador"
          propio={explorerFontSize}
          efectivo={resolverTamano(uiFontSize, explorerFontSize)}
          onChange={onChangeExplorerFontSize}
        />
      )}
      {ve('git-font') && (
        <FilaTamanoHeredado
          etiqueta="Vista de git"
          etiquetaStepper="el tamaño de letra de la vista de git"
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

  return (
    <>
      {hayTamanos && <GrupoTamanos {...props} />}

      {ve('banda') && (
        <Grupo titulo="Barra de perfiles">
          <Fila
            etiqueta="Colapsar la banda de perfiles"
            ayuda="Deja solo la línea de color de cada perfil, sin nombres."
            control={
              <Interruptor
                activo={hideProfileNames}
                onChange={onToggleProfileNames}
                etiqueta="Colapsar la banda de perfiles"
              />
            }
          />
        </Grupo>
      )}
    </>
  )
}
