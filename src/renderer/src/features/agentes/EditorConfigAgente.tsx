// =============================================================================
// El editor de los archivos reales de configuración de un agente en un nivel, con Monaco: en una cuenta de
// Docker o en su equipo, su configuración y sus instrucciones en dos pestañas; en el global o en un perfil, solo
// la configuración técnica. No hay opciones propias: lo que admite cada archivo lo decide cada versión del CLI.
// Guardar valida la sintaxis, no pisa un cambio ajeno y deja recuperar la versión anterior. Lo monta el diálogo
// del contexto de los agentes, que pone el marco y la navegación.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================
import './configAgente.css'
import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { AGENTE_ENLACE_OPCIONES } from './enlacesConfigAgente.ts'
import { TIPOS_ARCHIVO_CONFIG, type RefConfigAgente, type TipoArchivoConfig } from '../../../../shared/configAgente-ipc'
import { BARRAS_MONACO, asegurarMonaco, TEMA_MONACO, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'
import { BotonGuardar } from '../../comun/BotonGuardar'
import { hayCambiosSinGuardar, sePuedeGuardar, tieneCambios, type ArchivoEnEdicion, type ProblemaArchivoConfig } from './modeloConfigAgente.ts'
import { txConfigAgente } from './textosConfigAgente.ts'
import { useConfigAgente, type ConfigAgenteEnEdicion } from './useConfigAgente'

const lenguajeDe = (nombre: string): string => (nombre.endsWith('.json') ? 'json' : nombre.endsWith('.toml') ? 'ini' : 'markdown')

/** El texto de un problema al guardar o del bloqueo con que se leyó. */
function textoProblema(p: ProblemaArchivoConfig): string {
  const t = txConfigAgente()
  switch (p.estado) {
    case 'sintaxis':
      return p.linea === null ? t.sintaxis(p.detalle) : t.sintaxisEn(p.linea, p.columna, p.detalle)
    case 'raiz-json':
      return t.raizJson
    case 'no-utf8':
      return t.noUtf8
    case 'sin-anterior':
      return t.anteriorVacia
    case 'cambio-externo':
      return t.cambioExterno
    case 'cuenta-no-disponible':
      return t.noDisponible
    case 'no-regular':
      return t.noRegular
    case 'demasiado-grande':
      return t.demasiadoGrande
    case 'error':
      return t.errorGuardar(p.detalle)
  }
}

type ArchivosEnEdicion = Record<TipoArchivoConfig, ArchivoEnEdicion>
type ModelosConfig = Map<TipoArchivoConfig, Monaco.editor.ITextModel>

/** Crea el editor y un modelo por archivo una sola vez: cambiar de pestaña conserva el cursor y el historial de deshacer. */
function useMonacoArchivos(c: ConfigAgenteEnEdicion, activo: TipoArchivoConfig, archivos: ArchivosEnEdicion): {
  host: React.RefObject<HTMLDivElement>
  editor: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>
  modelos: React.MutableRefObject<ModelosConfig>
} {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelos = useRef<ModelosConfig>(new Map())
  const activoRef = useRef(activo)
  activoRef.current = activo
  const guardar = useRef(c.guardar)
  guardar.current = c.guardar
  const despachar = useRef(c.despachar)
  despachar.current = c.despachar
  const inicial = useRef(archivos)

  useEffect(() => {
    const nodo = host.current
    if (!nodo) return
    const monaco = asegurarMonaco()
    const creados = modelos.current
    const editorMonaco = conLetraEditor(monaco.editor.create(nodo, {
      ...OPCIONES_BASE_MONACO,
      ...opcionesLetraEditor(),
      theme: TEMA_MONACO,
      minimap: { enabled: false },
      scrollbar: BARRAS_MONACO,
      wordWrap: 'on',
      ariaLabel: txConfigAgente().editor(inicial.current[activoRef.current].leido.nombre)
    }))
    editor.current = editorMonaco
    const suscripciones = TIPOS_ARCHIVO_CONFIG.map((tipo) => {
      const { leido, texto } = inicial.current[tipo]
      const modelo = monaco.editor.createModel(texto, lenguajeDe(leido.nombre))
      creados.set(tipo, modelo)
      return modelo.onDidChangeContent(() => despachar.current({ tipo: 'editar', archivo: tipo, texto: modelo.getValue() }))
    })
    editorMonaco.setModel(creados.get(activoRef.current) ?? null)
    editorMonaco.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => guardar.current(activoRef.current))
    const ro = new ResizeObserver(() => {
      if (nodo.clientWidth > 0 && nodo.clientHeight > 0) editorMonaco.layout({ width: nodo.clientWidth, height: nodo.clientHeight })
    })
    ro.observe(nodo)
    editorMonaco.focus()
    return () => {
      ro.disconnect()
      suscripciones.forEach((s) => s.dispose())
      editorMonaco.dispose()
      creados.forEach((m) => m.dispose())
      creados.clear()
      editor.current = null
    }
  }, [])

  return { host, editor, modelos }
}

function EditorArchivos(p: { c: ConfigAgenteEnEdicion; activo: TipoArchivoConfig; archivos: ArchivosEnEdicion }): React.JSX.Element {
  const { c, activo, archivos } = p
  const { host, editor, modelos } = useMonacoArchivos(c, activo, archivos)

  // Solo cuando el texto llega de fuera (recargar o recuperar la versión anterior). Como una edición y no con
  // `setValue`, que borra el historial: lo que había se recupera con deshacer.
  const aplicadas = useRef<Record<TipoArchivoConfig, number>>({ configuracion: 0, instrucciones: 0 })
  useEffect(() => {
    for (const tipo of TIPOS_ARCHIVO_CONFIG) {
      const modelo = modelos.current.get(tipo)
      if (!modelo || aplicadas.current[tipo] === archivos[tipo].revision) continue
      aplicadas.current[tipo] = archivos[tipo].revision
      modelo.pushStackElement()
      modelo.pushEditOperations([], [{ range: modelo.getFullModelRange(), text: archivos[tipo].texto }], () => null)
      modelo.pushStackElement()
    }
  }, [archivos, modelos])

  const { leido, problema } = archivos[activo]
  useEffect(() => {
    const editorMonaco = editor.current
    if (!editorMonaco) return
    editorMonaco.setModel(modelos.current.get(activo) ?? null)
    editorMonaco.updateOptions({ readOnly: leido.bloqueo !== null, ariaLabel: txConfigAgente().editor(leido.nombre) })
  }, [activo, leido.bloqueo, leido.nombre, editor, modelos])

  const lineaError = problema?.estado === 'sintaxis' ? problema.linea : null
  const columnaError = problema?.estado === 'sintaxis' ? problema.columna : null
  useEffect(() => {
    const editorMonaco = editor.current
    if (!editorMonaco || lineaError === null) return
    editorMonaco.revealLineInCenter(lineaError)
    editorMonaco.setPosition({ lineNumber: lineaError, column: columnaError ?? 1 })
    editorMonaco.focus()
  }, [lineaError, columnaError, editor])

  return <div ref={host} className="config-agente-editor" data-testid="config-agente-editor" />
}

function Pestanas(p: { c: ConfigAgenteEnEdicion; activo: TipoArchivoConfig; archivos: ArchivosEnEdicion; tipos: readonly TipoArchivoConfig[] }): React.JSX.Element {
  const t = txConfigAgente()
  const { c, activo, archivos } = p
  return (
    <div className="config-agente-pestanas" role="tablist" aria-label={t.pestanas}>
      {p.tipos.map((tipo) => {
        const archivo = archivos[tipo]
        const cambios = tieneCambios(archivo)
        return (
          <button
            key={tipo}
            type="button"
            role="tab"
            aria-selected={tipo === activo}
            aria-label={cambios ? t.sinGuardarMarca(archivo.leido.nombre) : archivo.leido.nombre}
            className={`config-agente-pestana${tipo === activo ? ' activa' : ''}`}
            onClick={() => c.despachar({ tipo: 'activar', archivo: tipo })}
          >
            <span>{tipo === 'configuracion' ? t.configuracion : t.instrucciones}</span>
            <code>{archivo.leido.nombre}</code>
            {cambios && <span className="config-agente-marca" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

/** Lo que Tessera hace con este archivo y conviene saber antes de editarlo. */
function avisoDelArchivo({ leido }: ArchivoEnEdicion, enDocker: boolean): string | null {
  const t = txConfigAgente()
  if (leido.avisos.includes('developer-instructions')) return t.avisoDeveloperInstructions
  return enDocker && leido.tipo === 'instrucciones' ? t.avisoBloqueDocker : null
}

/** Lo que hay que saber del archivo a la vista: su estado, su problema y cómo salir de él. */
function Avisos({ c, archivo, enDocker }: { c: ConfigAgenteEnEdicion; archivo: ArchivoEnEdicion; enDocker: boolean }): React.JSX.Element | null {
  const t = txConfigAgente()
  const { leido, problema } = archivo
  const bloqueo = leido.bloqueo ? textoProblema({ estado: leido.bloqueo }) : null
  const aviso = avisoDelArchivo(archivo, enDocker)
  const noExiste = leido.version === null && !leido.bloqueo ? t.noExiste(leido.nombre) : null
  if (!bloqueo && !problema && !aviso && !noExiste) return null
  return (
    <div className="config-agente-avisos">
      {noExiste && !problema && <p className="dbc-ayuda">{noExiste}</p>}
      {aviso && <p className="config-agente-aviso">{aviso}</p>}
      {bloqueo && <p className="config-agente-error" role="alert">{bloqueo}</p>}
      {problema && (
        <div className="config-agente-error" role="alert" data-testid="config-agente-problema">
          <p>{textoProblema(problema)}</p>
          {problema.estado === 'cambio-externo' && (
            <div className="config-agente-acciones-aviso">
              <button type="button" className="btn btn-ghost" onClick={() => c.cargarDelArchivo(leido.tipo)}>
                {t.cargarArchivo}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => c.guardar(leido.tipo, { sobrescribir: true })}>
                {t.sobrescribir}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Las acciones del archivo a la vista: la referencia, la versión anterior y Guardar. */
function Pie(p: { c: ConfigAgenteEnEdicion; archivo: ArchivoEnEdicion | null; referencia: string }): React.JSX.Element {
  const t = txConfigAgente()
  const { c, archivo } = p
  return (
    <div className="contexto-pie">
      {archivo?.leido.tipo === 'configuracion' && (
        <button type="button" className="btn btn-ghost" onClick={() => void window.tessera.abrirExterno(p.referencia)}>
          {t.referencia}
        </button>
      )}
      {archivo?.leido.hayAnterior && (
        <button type="button" className="btn btn-ghost" title={t.anteriorAyuda} onClick={() => c.recuperarAnterior(archivo.leido.tipo)}>
          {t.anterior}
        </button>
      )}
      <span className="dbc-hueco" />
      {archivo && (
        <BotonGuardar
          // Por archivo: la confirmación de uno no se ve al pasar al otro.
          key={archivo.leido.tipo}
          exitos={archivo.exitos}
          guardando={c.guardando}
          deshabilitado={!sePuedeGuardar(archivo)}
          textos={{ guardar: t.guardar, guardando: t.guardando, guardado: t.guardado }}
          onClic={() => c.guardar(archivo.leido.tipo)}
        />
      )}
    </div>
  )
}

function Cuerpo({ c, enDocker, tipos }: { c: ConfigAgenteEnEdicion; enDocker: boolean; tipos: readonly TipoArchivoConfig[] }): React.JSX.Element {
  const t = txConfigAgente()
  const { estado } = c
  if (estado.fase === 'cargando') return <p className="dbc-ayuda">{t.cargando}</p>
  if (estado.fase === 'no-disponible') return <p className="config-agente-error" role="alert">{t.noDisponible}</p>
  if (estado.fase === 'error') {
    return (
      <div className="config-agente-error" role="alert">
        <p>{t.errorLeer(estado.detalle)}</p>
        <button type="button" className="btn btn-ghost" onClick={c.cargar}>
          {t.reintentar}
        </button>
      </div>
    )
  }
  return (
    <>
      <Pestanas c={c} activo={estado.activo} archivos={estado.archivos} tipos={tipos} />
      <EditorArchivos c={c} activo={estado.activo} archivos={estado.archivos} />
      {estado.activo === 'configuracion' && estado.fijadas.length > 0 && (
        <p className="config-agente-aviso" data-testid="config-agente-fijadas">
          {txConfigAgente().fijadas(estado.fijadas.map((f) => `${f.clave} (${txConfigAgente().origen[f.origen]})`).join(', '))}
        </p>
      )}
      <Avisos c={c} archivo={estado.archivos[estado.activo]} enDocker={enDocker} />
    </>
  )
}

/**
 * El editor de los archivos de un nivel: sus pestañas, sus avisos y su pie. Va con `key` por nivel y agente,
 * así que cambiar lo vuelve a montar limpio; avisa al diálogo de si tiene cambios sin guardar. En una capa
 * compartida solo está la configuración técnica.
 */
export function EditorConfigAgente(p: {
  nivel: RefConfigAgente
  onSinGuardar: (hay: boolean) => void
  /** En una capa compartida, que no tiene carpeta que enseñar: a qué se aplica. Ocupa la línea de la carpeta. */
  descripcion?: string
}): React.JSX.Element {
  const t = txConfigAgente()
  const c = useConfigAgente(p.nivel)
  const { onSinGuardar } = p
  const sinGuardar = hayCambiosSinGuardar(c.estado)
  useEffect(() => onSinGuardar(sinGuardar), [sinGuardar, onSinGuardar])
  const lista = c.estado.fase === 'lista' ? c.estado : null
  const enDocker = p.nivel.cuentaId !== null && !p.nivel.capa
  const tipos: readonly TipoArchivoConfig[] = p.nivel.capa ? ['configuracion'] : TIPOS_ARCHIVO_CONFIG
  // La línea está siempre, también mientras carga: así cambiar de cuenta o de capa no mueve lo de debajo.
  const linea = p.nivel.capa
    ? (p.descripcion ?? '')
    : lista
      ? `${t.carpeta(lista.carpeta)}${lista.sesionesAbiertas > 0 ? ` · ${t.sesiones(lista.sesionesAbiertas)}` : ''}`
      : ''
  return (
    <>
      <div className="config-agente-ruta" title={linea || undefined}>
        {linea || ' '}
      </div>
      <div className="config-agente-cuerpo">
        <Cuerpo c={c} enDocker={enDocker} tipos={tipos} />
      </div>
      <Pie c={c} archivo={lista ? lista.archivos[lista.activo] : null} referencia={AGENTE_ENLACE_OPCIONES[p.nivel.agente]} />
    </>
  )
}

