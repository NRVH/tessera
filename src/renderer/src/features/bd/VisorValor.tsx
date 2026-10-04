// =============================================================================
// VisorValor: el valor ENTERO de una celda, en un modal con un Monaco de solo lectura (JSON
// formateado o crudo, binario en volcado hex). Se abre con Mayús+Intro o «Ver valor»; lo monta
// `DbRejilla` por portal, para la pestaña de datos y los resultados de la consola. Si la celda
// llegó recortada y el dueño sabe pedirlo, carga el valor completo (`cargarCompleto`).
// La lógica (modo, JSON, hex, textos) está en `rejilla/visorValor.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-visor-valor.md
// =============================================================================

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type {
  DbCelda,
  DbColumnaResultado,
  DbErrorSql,
  DbRespuesta,
  DbValor
} from '../../../../shared/db-explorador-ipc'
import { MONACO_THEME, OPCIONES_BASE_MONACO, ensureMonaco } from '../../comun/monacoSetup'
import { useDialogo } from '../../comun/useDialogo'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IconoCerrar, IconoCopiar } from '../../comun/iconosMenu'
import { notify, notifyError } from '../../comun/notifications'
import {
  avisoParcial,
  describirLongitud,
  hexAgrupado,
  lenguajeVisor,
  longitudDe,
  metadatosVisor,
  modoVisor,
  resangrarJson,
  textoDeCelda,
  tipoVisible,
  type HexAgrupado,
  type ModoVisor
} from './rejilla/visorValor'
import { retenerSilencioCancelaciones } from './silencioCancelacionesMonaco'
import './rejilla.css'

export interface VisorValorProps {
  columna: DbColumnaResultado
  /** Lo que la rejilla tiene de la celda (quizá recortado). */
  valor: DbCelda
  /** Longitud real si la celda llegó recortada (caracteres, o bytes en binario). */
  longitudOriginal?: number
  /** Pide el valor entero. Sin ella, `razonSinValorCompleto` explica por qué no. */
  cargarCompleto?: () => Promise<DbRespuesta<DbValor>>
  razonSinValorCompleto?: string
  onCerrar: () => void
}

type VistaJson = 'formateado' | 'crudo'
type Aviso = { texto: string; tono: 'info' | 'aviso' }

let contadorModelos = 0

function mensajeDe(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' && err ? err : 'Error inesperado'
}

interface ValorCompleto {
  completo: DbValor | null
  cargando: boolean
  error: DbErrorSql | null
  cargar: () => Promise<void>
}

/** Pide el valor completo al abrir (si se puede) y en cada «Reintentar»; la última petición manda. */
function useValorCompleto(props: VisorValorProps, puedeCompletar: boolean): ValorCompleto {
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const [completo, setCompleto] = useState<DbValor | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<DbErrorSql | null>(null)
  const pedidoRef = useRef(0)
  const vivoRef = useRef(true)
  useEffect(() => {
    vivoRef.current = true
    return () => {
      vivoRef.current = false
    }
  }, [])

  const cargar = useCallback(async (): Promise<void> => {
    const pedir = propsRef.current.cargarCompleto
    if (!pedir) return
    const id = ++pedidoRef.current
    setCargando(true)
    setError(null)
    let r: DbRespuesta<DbValor>
    try {
      r = await pedir()
    } catch (err) {
      r = { ok: false, error: { motivo: 'interno', mensaje: mensajeDe(err) } }
    }
    if (!vivoRef.current || id !== pedidoRef.current) return
    setCargando(false)
    if (r.ok) setCompleto(r.valor)
    else setError(r.error)
  }, [])

  useEffect(() => {
    if (puedeCompletar) void cargar()
    // Solo al abrir: el visor es de UNA celda, y reabrirlo es otro montaje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { completo, cargando, error, cargar }
}

/** Crea el editor de solo lectura y su modelo sobre un host que ya mide algo. */
function crearEditorVisor(
  host: HTMLDivElement,
  texto: string,
  lenguaje: string
): { ed: editor.IStandaloneCodeEditor; modelo: editor.ITextModel } {
  const monaco = ensureMonaco()
  contadorModelos++
  const uri = monaco.Uri.from({ scheme: 'tessera-db', authority: 'visor', path: `/${contadorModelos}` })
  const modelo = monaco.editor.createModel(texto, lenguaje, uri)
  const ed = monaco.editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    model: modelo,
    theme: MONACO_THEME,
    readOnly: true,
    minimap: { enabled: false },
    // `simple` supone letra monoespaciada y no mide cada línea en el DOM (16 MiB en una
    // sola línea serían millones de medidas).
    wordWrap: 'on',
    wrappingStrategy: 'simple',
    renderWhitespace: 'none',
    cursorBlinking: 'solid',
    wordBasedSuggestions: 'off',
    quickSuggestions: false,
    scrollbar: { alwaysConsumeMouseWheel: true }
  })
  ed.layout({ width: host.clientWidth, height: host.clientHeight })
  return { ed, modelo }
}

/** El Monaco del visor: nace cuando el host mide algo (nunca a 0 px) y sigue al texto y al modo. */
function useMonacoVisor(texto: string, lenguaje: string, binario: boolean): React.RefObject<HTMLDivElement> {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const modeloRef = useRef<editor.ITextModel | null>(null)
  const [editorListo, setEditorListo] = useState(false)
  // El editor nace en un efecto que no depende del texto (se crea UNA vez): lee el
  // texto y el lenguaje vigentes de aquí.
  const textoRef = useRef(texto)
  const lenguajeRef = useRef(lenguaje)
  useLayoutEffect(() => {
    textoRef.current = texto
    lenguajeRef.current = lenguaje
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let creado: ReturnType<typeof crearEditorVisor> | null = null
    let soltarSilencio: (() => void) | null = null
    const crear = (): void => {
      if (creado || host.clientWidth === 0 || host.clientHeight === 0) return
      soltarSilencio = retenerSilencioCancelaciones()
      creado = crearEditorVisor(host, textoRef.current, lenguajeRef.current)
      editorRef.current = creado.ed
      modeloRef.current = creado.modelo
      setEditorListo(true)
      creado.ed.focus()
    }
    const ro = new ResizeObserver(() => {
      if (!creado) {
        crear()
        return
      }
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        creado.ed.layout({ width: host.clientWidth, height: host.clientHeight })
      }
    })
    ro.observe(host)
    crear()
    return () => {
      ro.disconnect()
      creado?.ed.dispose()
      creado?.modelo.dispose()
      soltarSilencio?.()
      editorRef.current = null
      modeloRef.current = null
    }
  }, [])

  // Texto y lenguaje: al llegar el valor completo, al conmutar el JSON.
  useEffect(() => {
    const modelo = modeloRef.current
    if (!modelo) return
    if (modelo.getLanguageId() !== lenguaje) ensureMonaco().editor.setModelLanguage(modelo, lenguaje)
    if (modelo.getValue() !== texto) modelo.setValue(texto)
  }, [texto, lenguaje, editorListo])

  // El volcado hex lleva su propia columna de desplazamiento y sus líneas son de ancho
  // fijo: sin números de línea y sin partir (partido, el ASCII se descolocaría).
  useEffect(() => {
    editorRef.current?.updateOptions({
      lineNumbers: binario ? 'off' : 'on',
      wordWrap: binario ? 'off' : 'on'
    })
  }, [binario, editorListo])

  return hostRef
}

/** El texto que enseña el editor: el volcado en binario, el JSON según la vista, o el crudo. */
function textoVisible(modo: ModoVisor, crudo: string, hex: HexAgrupado | null, formateado: string | null, vista: VistaJson): string {
  if (modo === 'binario') return hex?.texto ?? crudo
  if (modo === 'json' && vista === 'formateado' && formateado !== null) return formateado
  return crudo
}

function tituloCopiar(modo: ModoVisor, vista: VistaJson): string {
  if (modo === 'binario') return 'Copiar el valor (en hex)'
  if (modo === 'json' && vista === 'formateado') return 'Copiar el JSON formateado'
  return 'Copiar el valor'
}

interface DatosAvisos {
  props: VisorValorProps
  modo: ModoVisor
  binario: boolean
  cargando: boolean
  completo: DbValor | null
  puedeCompletar: boolean
  hex: HexAgrupado | null
}

/** Las líneas de estado: cargando, parcial (y por qué no hay más), tope del visor y volcado corto. */
function avisosDelVisor(d: DatosAvisos): Aviso[] {
  const { longitudOriginal, razonSinValorCompleto } = d.props
  const { modo, binario, completo, hex } = d
  const avisos: Aviso[] = []
  if (d.cargando && longitudOriginal !== undefined) {
    avisos.push({ texto: `Cargando el valor completo (${describirLongitud(longitudOriginal, binario)})…`, tono: 'info' })
  } else if (!completo && longitudOriginal !== undefined) {
    // Con forma de pedirlo basta decir que es parcial; sin ella, además, por qué no hay más.
    const parcial = avisoParcial(longitudDe(d.props.valor, modo), longitudOriginal, binario)
    const porQue = d.puedeCompletar ? '' : ` ${razonSinValorCompleto ?? 'El valor llegó recortado del servidor.'}`
    avisos.push({ texto: `${parcial}.${porQue}`, tono: 'aviso' })
  }
  if (completo?.recortado) {
    avisos.push({
      texto: `${avisoParcial(longitudDe(completo.valor, modo), completo.longitud, binario)}: es el tope del visor.`,
      tono: 'aviso'
    })
  }
  if (hex && hex.mostrados < hex.bytes) {
    avisos.push({
      texto: `Volcado de los primeros ${describirLongitud(hex.mostrados, true)} de ${describirLongitud(hex.bytes, true)}. «Copiar» copia el valor entero.`,
      tono: 'info'
    })
  }
  return avisos
}

/** La capa opaca sobre el editor para NULL, la cadena vacía y el binario vacío (el host no se oculta). */
function capaDelVisor(modo: ModoVisor, crudo: string, hex: HexAgrupado | null): React.JSX.Element | null {
  if (modo === 'nulo') return <EstadoVacio titulo="NULL" pista="La celda no tiene valor." />
  if (crudo === '') return <EstadoVacio titulo="Cadena vacía" pista="La celda tiene un valor vacío, que no es NULL." />
  if (hex && hex.bytes === 0) return <EstadoVacio titulo="Binario vacío" pista="La celda tiene cero bytes, que no es NULL." />
  return null
}

/** «Formateado / Crudo»: dice qué se está leyendo (identidad, como las partes de la fuente). */
function ConmutadorJson(p: { vistaJson: VistaJson; setVistaJson: (v: VistaJson) => void }): React.JSX.Element {
  return (
    <div className="db-fuente-partes" role="radiogroup" aria-label="Vista del JSON">
      {(['formateado', 'crudo'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={p.vistaJson === v}
          className="db-fuente-parte"
          onClick={() => p.setVistaJson(v)}
        >
          {v === 'formateado' ? 'Formateado' : 'Crudo'}
        </button>
      ))}
    </div>
  )
}

/** Cabecera: columna y metadatos, conmutador del JSON, «Copiar» y cerrar. */
function CabeceraVisor(p: {
  columna: DbColumnaResultado
  idTitulo: string
  meta: string
  modo: ModoVisor
  vistaJson: VistaJson
  setVistaJson: (v: VistaJson) => void
  aCopiar: string
  incompleto: boolean
  onCerrar: () => void
}): React.JSX.Element {
  const { columna, modo, vistaJson, incompleto } = p
  const copiar = (): void => {
    window.tessera.clipboard
      .write(p.aCopiar)
      .then(() => {
        if (incompleto) notify('warn', 'Copiado el valor recortado', 'Lo copiado no es el valor entero.')
        else notify('success', 'Copiado')
      })
      .catch((err: unknown) => notifyError('No se pudo copiar', err))
  }
  return (
    <header className="db-visor-cab">
      <div className="db-visor-identidad">
        <span className="db-visor-columna" id={p.idTitulo} title={columna.nombre}>
          {columna.nombre}
        </span>
        <span className="db-visor-meta">{p.meta}</span>
      </div>
      {modo === 'json' && <ConmutadorJson vistaJson={vistaJson} setVistaJson={p.setVistaJson} />}
      <div className="panel-actions">
        <span className="btn-envoltura" title={modo === 'nulo' ? 'NULL no tiene texto que copiar' : undefined}>
          <button
            type="button"
            className="btn btn-icon"
            onClick={copiar}
            disabled={modo === 'nulo'}
            title={modo === 'nulo' ? undefined : tituloCopiar(modo, vistaJson)}
            aria-label="Copiar"
          >
            <IconoCopiar />
          </button>
        </span>
        <span className="panel-actions-sep" aria-hidden="true" />
        <button type="button" className="btn btn-icon" onClick={p.onCerrar} title="Cerrar (Esc)" aria-label="Cerrar">
          <IconoCerrar />
        </button>
      </div>
    </header>
  )
}

/** Las líneas de estado y, si falló la carga, el error con «Reintentar». */
function AvisosVisor(p: { avisos: Aviso[]; error: DbErrorSql | null; reintentar: () => void }): React.JSX.Element | null {
  const { avisos, error } = p
  if (avisos.length === 0 && !error) return null
  return (
    <div className="db-visor-avisos">
      {avisos.map((a) => (
        <div key={a.texto} className={`db-visor-aviso${a.tono === 'aviso' ? ' tono-aviso' : ''}`} role="status">
          {a.texto}
        </div>
      ))}
      {error && (
        <div className="db-visor-aviso tono-error" role="alert">
          <span className="db-visor-aviso-texto">
            No se pudo cargar el valor completo: {error.codigo ? `[${error.codigo}] ` : ''}
            {error.mensaje}
          </span>
          <button type="button" className="db-pildora-btn" onClick={p.reintentar}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}

export function VisorValor(props: VisorValorProps): React.JSX.Element {
  const { columna, longitudOriginal, onCerrar } = props
  const dlg = useDialogo({ onClose: onCerrar })
  const idTitulo = useId()
  const recortada = longitudOriginal !== undefined
  const puedeCompletar = recortada && props.cargarCompleto !== undefined
  const { completo, cargando, error, cargar } = useValorCompleto(props, puedeCompletar)
  const [vistaJson, setVistaJson] = useState<VistaJson>('formateado')

  const valor: DbCelda = completo ? completo.valor : props.valor
  const tipoLogico = completo?.tipoLogico ?? columna.tipoLogico
  const modo = useMemo(() => modoVisor(valor, tipoLogico, columna.tipoMotor), [valor, tipoLogico, columna.tipoMotor])
  const crudo = useMemo(() => textoDeCelda(valor), [valor])
  const formateado = useMemo(() => (modo === 'json' ? resangrarJson(crudo) : null), [modo, crudo])
  const hex = useMemo(() => (modo === 'binario' ? hexAgrupado(crudo) : null), [modo, crudo])
  const texto = textoVisible(modo, crudo, hex, formateado, vistaJson)
  const binario = modo === 'binario'
  const hostRef = useMonacoVisor(texto, lenguajeVisor(modo, crudo.length), binario)

  // Longitud REAL: la del valor completo si llegó, la que dijo el main al recortar si
  // no, y si no hubo recorte, la de lo que hay.
  const longitudTotal = completo ? completo.longitud : (longitudOriginal ?? longitudDe(props.valor, modo))
  const meta = metadatosVisor(tipoVisible(columna), modo, longitudTotal)
  const avisos = avisosDelVisor({ props, modo, binario, cargando, completo, puedeCompletar, hex })
  const capa = capaDelVisor(modo, crudo, hex)

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCerrar}>
      <div
        ref={dlg.ref}
        className="modal-card db-visor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dlg.alPulsarTecla}
      >
        <CabeceraVisor
          columna={columna}
          idTitulo={idTitulo}
          meta={meta}
          modo={modo}
          vistaJson={vistaJson}
          setVistaJson={setVistaJson}
          // Se copia el VALOR (el hex `0x…` en binario, no el volcado: es lo que se puede
          // volver a usar), salvo el JSON, que se copia como se está leyendo.
          aCopiar={modo === 'json' ? texto : crudo}
          incompleto={recortada && (completo === null || completo.recortado)}
          onCerrar={onCerrar}
        />
        <AvisosVisor avisos={avisos} error={error} reintentar={() => void cargar()} />
        <div className="db-visor-cuerpo">
          <div ref={hostRef} className="db-visor-host" />
          {capa && <div className="db-visor-capa">{capa}</div>}
        </div>
      </div>
    </div>
  )
}
