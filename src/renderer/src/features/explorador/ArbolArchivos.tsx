// =============================================================================
// Árbol de archivos de UN proyecto: cabecera, cuerpo virtualizado, menú contextual y
// diálogos. `ArbolArchivos` solo compone; el estado y los efectos viven en `useArbol`, y las
// operaciones, el menú y el teclado en sus módulos. Hay uno por proyecto (`LateralExplorador` mantiene
// vivos los de los últimos vistos), así que su estado es solo de ese proyecto.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { EsperaCarga } from '../../comun/IndicadorCarga'
import { Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { ListaVirtual } from '../../comun/ListaVirtual'
import { RaizDelProyecto } from '../../comun/raizDelProyecto'
import { DialogosArbol } from './DialogosArbol'
import { MenuContextualArbol, abrirMenuDeFila } from './menuArbol'
import { CabeceraArbol, FilaPlaceholderArchivos } from './piezasArbol'
import { FilaArbolArchivos } from './FilaArbolArchivos'
import { txExplorador } from './textos.ts'
import { importarNodos, moverNodos } from './operacionesArbol'
import {
  alClicarFila,
  alClicDerechoVacio,
  alPulsarVacio,
  alSobrevolarVacio,
  alSoltarEnVacio,
  prepararArrastre
} from './interaccionArbol'
import { manejarTeclaArbol } from './tecladoArbol'
import { useArbol } from './useArbol'
import type { FilaAplanada } from './aplanarArbol'
import type { Arbol, PropsArbolArchivos } from './tiposArbol'

/** Una fila del árbol aplanado: nodo o placeholder. */
function pintarFilaArchivos(a: Arbol, r: FilaAplanada): React.JSX.Element {
  if (r.tipo === 'placeholder') return <FilaPlaceholderArchivos fila={r} />
  const { archivoAbierto, decoraciones, altoFila, onAbrirArchivo } = a.props
  return (
    <FilaArbolArchivos
      fila={r}
      rutaActiva={archivoAbierto?.ruta ?? null}
      decoraciones={decoraciones}
      dirSeleccionado={a.dirSeleccionado}
      // Un boolean por fila y no el Set: una fila no se repinta si la selección no la incluye.
      seleccionada={a.seleccion.claves.has(r.clave)}
      // El líder solo se dibuja cuando hay grupo: con una fila, el contorno sería ruido.
      lider={a.seleccion.claves.size > 1 && a.seleccion.lider === r.clave}
      rutasCortadas={a.rutasCortadas}
      arrastrados={a.arrastrados}
      fantasma={a.fantasma}
      altoFila={altoFila}
      onAbrirArchivo={onAbrirArchivo}
      onSeleccionarDir={a.setDirSeleccionado}
      onClicFila={(clave, mods, fase) => alClicarFila(a, clave, mods, fase)}
      onAlternarExpandido={a.alternarExpandido}
      onIniciarArrastreNodo={(clave) => prepararArrastre(a, clave)}
      onArrastreFuera={a.arrastrarFuera}
      onTerminarArrastreNodo={() => a.setArrastrados([])}
      onMoverNodo={(srcs, destDir) => void moverNodos(a, srcs, destDir)}
      onImportarNodo={(rutasHost, destDir) => void importarNodos(a, rutasHost, destDir)}
      onMenuContextualNodo={(x, y, clave, esDir) => abrirMenuDeFila(a, x, y, clave, esDir)}
    />
  )
}

/** Cuerpo del panel: también es zona de drop y de menú de la raíz. */
function CuerpoArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { error, entradasRaiz, filas, indicePorRevelar } = arbol
  const t = txExplorador()
  return (
    <div
      className="sidebar-body sidebar-body-tree"
      ref={arbol.arbolRef}
      // -1: enfocable con el ratón sin entrar en el orden de tabulación; hace falta para
      // que Ctrl+V funcione tras clicar el vacío, donde no hay fila que tome el foco.
      tabIndex={-1}
      onKeyDown={(e) => void manejarTeclaArbol(arbol, e)}
      onMouseDown={(e) => alPulsarVacio(arbol, e)}
      onContextMenu={(e) => alClicDerechoVacio(arbol, e)}
      onDragOver={(e) => alSobrevolarVacio(arbol, e)}
      onDrop={(e) => alSoltarEnVacio(arbol, e)}
    >
      {error ? (
        // Con error no se pinta el aviso: aunque la carga acabe, cumpliría su mínimo visible.
        <div className="tree-error">{t.noSePudoLeerProyecto}{'\n'}{error}</div>
      ) : (
        <EsperaCarga cargando={entradasRaiz === null} variante="fila" texto={t.cargando} className="tree-row muted">
          {entradasRaiz !== null && (
            // Virtualizada: solo se montan las filas visibles del árbol aplanado.
            <ListaVirtual<FilaAplanada>
              className="tree-virtual"
              etiquetaAria={t.arbolArchivos}
              elementos={filas}
              altoElemento={arbol.props.altoFila}
              obtenerClave={(r) => r.clave}
              indiceARevelar={indicePorRevelar}
              pintarElemento={(r) => pintarFilaArchivos(arbol, r)}
            />
          )}
        </EsperaCarga>
      )}
    </div>
  )
}

/** Árbol de archivos de un proyecto. */
export function ArbolArchivos(props: PropsArbolArchivos): React.JSX.Element {
  const arbol = useArbol(props)
  const ultimoError = useUltimoValor(arbol.opError || null)
  return (
    <RaizDelProyecto.Provider value={props.rutaHostProyecto}>
      <CabeceraArbol arbol={arbol} />
      <Presente visible={!!arbol.opError} className="mov-despliega"><div className="tree-op-error">{ultimoError}</div></Presente>
      <CuerpoArbol arbol={arbol} />
      <MenuContextualArbol arbol={arbol} />
      <DialogosArbol arbol={arbol} />
    </RaizDelProyecto.Provider>
  )
}
