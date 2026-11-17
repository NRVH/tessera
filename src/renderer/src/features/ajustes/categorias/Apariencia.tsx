// =============================================================================
// Categoría APARIENCIA: idioma, tamaños de letra de la interfaz, el explorador y la vista
// de git, zoom de la ventana, tema, fuente y tamaño del editor de código y colapso de la banda de perfiles.
// «Interfaz» es la BASE; «Explorador» y «Vista de git» heredan de ella y enseñan
// su tamaño efectivo, con una flecha para volver a heredar. El zoom escala TODO
// (editor y terminales incluidos) y se mueve por niveles pero se lee en porcentajes.
// Depende de `theme/densidad` y de las primitivas de Configuración.
// =============================================================================

import { NIVEL_ZOOM_MAX, NIVEL_ZOOM_MIN } from '../../../../../shared/workspace-state-ipc'
import {
  LETRA_UI_MAX,
  LETRA_UI_MIN,
  altoFila,
  resolverTamano,
  tieneTamanoPropio
} from '../../../theme/densidad'
import { Fila, Grupo, Interruptor, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { etiquetaModPrincipal } from '../../../util/atajos'
import { txApariencia } from '../textos.ts'
import { GrupoIdioma } from './GrupoIdioma'
import { GrupoTerminal } from './Terminales'
import { FilaTemaCodigo } from './TemaCodigo'

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
  onCambio
}: {
  etiqueta: string
  etiquetaStepper: string
  /** Valor guardado: 0 mientras hereda. */
  propio: number
  efectivo: number
  onCambio: (v: number) => void
}): React.JSX.Element {
  const t = txApariencia()
  return (
    <Fila
      sangrada
      etiqueta={etiqueta}
      ayuda={tieneTamanoPropio(propio) ? t.tamanoPropio(altoFila(efectivo)) : t.igualInterfaz}
      modificado={tieneTamanoPropio(propio)}
      onRestablecer={() => onCambio(0)}
      tituloRestablecer={t.volverInterfaz}
      control={
        <Stepper
          valor={efectivo}
          min={LETRA_UI_MIN}
          max={LETRA_UI_MAX}
          onCambio={onCambio}
          etiqueta={etiquetaStepper}
        />
      }
    />
  )
}

function FilaZoom({
  zoomLevel,
  onCambiarNivelZoom
}: Pick<PropsCategoria, 'zoomLevel' | 'onCambiarNivelZoom'>): React.JSX.Element {
  const t = txApariencia()
  return (
    <Fila
      etiqueta={t.zoom}
      // `+/−` y `0` van con el modificador principal (⌘ en Mac). Ctrl+rueda NO:
      // el pellizco del trackpad llega como rueda con un Ctrl SINTÉTICO de
      // Chromium en las dos plataformas, así que ahí Ctrl es literal.
      ayuda={t.zoomAyuda(etiquetaModPrincipal())}
      modificado={zoomLevel !== 0}
      onRestablecer={() => onCambiarNivelZoom(0)}
      tituloRestablecer={t.volver100}
      control={
        <Stepper
          valor={zoomLevel}
          min={NIVEL_ZOOM_MIN}
          max={NIVEL_ZOOM_MAX}
          onCambio={onCambiarNivelZoom}
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
  onCambiarTamanoLetraUi,
  explorerFontSize,
  onCambiarTamanoLetraExplorador,
  gitFontSize,
  onCambiarTamanoLetraGit,
  zoomLevel,
  onCambiarNivelZoom
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
              min={LETRA_UI_MIN}
              max={LETRA_UI_MAX}
              onCambio={onCambiarTamanoLetraUi}
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
          onCambio={onCambiarTamanoLetraExplorador}
        />
      )}
      {ve('git-font') && (
        <FilaTamanoHeredado
          etiqueta={t.vistaGit}
          etiquetaStepper={t.letraGit}
          propio={gitFontSize}
          efectivo={resolverTamano(uiFontSize, gitFontSize)}
          onCambio={onCambiarTamanoLetraGit}
        />
      )}
      {ve('zoom') && <FilaZoom zoomLevel={zoomLevel} onCambiarNivelZoom={onCambiarNivelZoom} />}
    </Grupo>
  )
}

export function Apariencia(props: PropsCategoria): React.JSX.Element {
  const { ve, hideProfileNames, onAlternarNombresPerfil } = props
  const hayTamanos = ve('ui-font') || ve('explorer-font') || ve('git-font') || ve('zoom')
  const t = txApariencia()

  return (
    <>
      {ve('idioma') && <GrupoIdioma />}
      {hayTamanos && <GrupoTamanos {...props} />}
      <GrupoTerminal
        titulo={t.grupoEditor}
        ayuda={t.ayudaEditor}
        idFuente="editor-fuente"
        idTamano="editor-tamano"
        nombre={t.nombreEditor}
        apariencia={props.aparienciaEditor}
        onCambio={props.onCambiarAparienciaEditor}
        ve={ve}
        antes={ve('editor-tema') ? <FilaTemaCodigo tema={props.editorTema} letra={props.aparienciaEditor} onCambio={props.onCambiarTemaEditor} /> : undefined}
      />

      {ve('banda') && (
        <Grupo titulo={t.grupoBarra}>
          <Fila
            etiqueta={t.minimalista}
            ayuda={t.minimalistaAyuda}
            control={
              <Interruptor
                activo={hideProfileNames}
                onCambio={onAlternarNombresPerfil}
                etiqueta={t.minimalista}
              />
            }
          />
        </Grupo>
      )}
    </>
  )
}
