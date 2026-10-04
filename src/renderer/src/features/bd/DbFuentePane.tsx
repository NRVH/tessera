// =============================================================================
// DbFuentePane: la pestaña de FUENTE (paquete, rutina, disparador o tipo; definición de una
// vista) y, con `modo: 'ddl'`, la de «Ver DDL». Monaco de solo lectura con modelo propio
// (`tessera-db://fuente/…`), que nace en el primer `visible` y con caja de verdad. Varias
// partes (Especificación / Cuerpo) con un conmutador; Refrescar salta la caché del main.
// Pide por `dbExplorador.fuente`/`ddl`; los textos de error, de `panesBd.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-visor-fuente.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { DbErrorSql, DbFuente, DbRespuesta } from '../../../../shared/db-explorador-ipc'
import { dialectoDeMotor } from '../../../../shared/sql/dialectosSql'
import { nombreCalificado } from '../../../../shared/sql/identificadoresSql'
import type { DbFuentePaneProps } from './propsBd'
import { MONACO_THEME, OPCIONES_BASE_MONACO, ensureMonaco } from '../../comun/monacoSetup'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IconoConsola, IconoRefrescar } from './iconosBd'
import { IconoCopiar } from '../../comun/iconosMenu'
import { BotonBarraBd } from './rejilla/DatosBotonBarra'
import { notify, notifyError } from '../../comun/notifications'
import { describirError, errorDeInvoke, lenguajeFuente, rutaModeloFuente } from './panesBd'
import { retenerSilencioCancelaciones } from './silencioCancelacionesMonaco'
import './rejilla.css'

type Parte = DbFuente['partes'][number]

/** Los refs del editor que comparten la carga y el Monaco. */
interface RefsEditorFuente {
  hostRef: React.RefObject<HTMLDivElement>
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>
  modeloRef: React.MutableRefObject<editor.ITextModel | null>
  /** Vista (scroll, cursor) de cada parte, para volver a donde estabas. */
  vistasRef: React.MutableRefObject<Map<number, editor.ICodeEditorViewState | null>>
  parteRef: React.MutableRefObject<number>
}

interface CargaFuente {
  fuente: DbFuente | null
  error: DbErrorSql | null
  cargando: boolean
  parte: number
  setParte: (i: number) => void
  cargar: (refrescar?: boolean) => Promise<void>
}

/** Pide la fuente en el primer `visible` y con cada Refrescar; la última petición manda. */
function useCargaFuente(
  propsRef: React.MutableRefObject<DbFuentePaneProps>,
  refs: RefsEditorFuente,
  visible: boolean,
  haSidoVisible: boolean,
  setHaSidoVisible: (v: boolean) => void
): CargaFuente {
  const { editorRef, vistasRef, parteRef } = refs
  const [fuente, setFuente] = useState<DbFuente | null>(null)
  const [error, setError] = useState<DbErrorSql | null>(null)
  const [cargando, setCargando] = useState(false)
  const [parte, setParte] = useState(0)
  const pedidoRef = useRef(0)
  const vivoRef = useRef(true)

  /** `refrescar`: el botón Refrescar, que salta la caché del main. */
  const cargar = useCallback(
    async (refrescar = false): Promise<void> => {
      const { conexion: con, objeto: obj, modo } = propsRef.current
      const id = ++pedidoRef.current
      // Un Refrescar vuelve a la MISMA altura: se guarda la vista antes de cambiar el
      // texto (setValue la reinicia).
      const ed = editorRef.current
      if (ed) vistasRef.current.set(parteRef.current, ed.saveViewState())
      setCargando(true)
      setError(null)
      let r: DbRespuesta<DbFuente>
      try {
        const api = window.tessera.dbExplorador
        r = modo === 'ddl' ? await api.ddl(con.id, obj, refrescar) : await api.fuente(con.id, obj, refrescar)
      } catch (err) {
        r = { ok: false, error: errorDeInvoke(err) }
      }
      // Una respuesta vieja (Refrescar dos veces) o de una pestaña ya cerrada no pinta.
      if (!vivoRef.current || id !== pedidoRef.current) return
      setCargando(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const valor = r.valor
      setFuente(valor)
      setParte((p) => (p < valor.partes.length ? p : 0))
    },
    [propsRef, editorRef, vistasRef, parteRef]
  )

  useEffect(() => {
    if (!visible || haSidoVisible) return
    setHaSidoVisible(true)
    void cargar()
  }, [visible, haSidoVisible, cargar, setHaSidoVisible])

  // Al desmontar, ninguna respuesta tardía debe tocar el estado.
  useEffect(() => {
    vivoRef.current = true
    return () => {
      vivoRef.current = false
    }
  }, [])

  return { fuente, error, cargando, parte, setParte, cargar }
}

/** Crea el editor de solo lectura con su modelo propio sobre un host que ya mide algo. */
function crearEditorFuente(
  host: HTMLDivElement,
  props: DbFuentePaneProps
): { ed: editor.IStandaloneCodeEditor; modelo: editor.ITextModel } {
  const monaco = ensureMonaco()
  const uri = monaco.Uri.from({ scheme: 'tessera-db', authority: 'fuente', path: rutaModeloFuente(props.paneKey) })
  // Un modelo con la misma URI solo puede ser un resto de esta misma pestaña
  // (cerrada y reabierta antes de que se desechara): se tira y se crea limpio.
  monaco.editor.getModel(uri)?.dispose()
  const modelo = monaco.editor.createModel('', lenguajeFuente(props.conexion.motor), uri)
  const ed = monaco.editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    model: modelo,
    theme: MONACO_THEME,
    readOnly: true,
    // Sin minimapa: la pestaña comparte el ancho con el árbol y el agente.
    minimap: { enabled: false },
    renderWhitespace: 'none',
    cursorBlinking: 'solid',
    wordBasedSuggestions: 'off',
    quickSuggestions: false,
    scrollbar: { alwaysConsumeMouseWheel: false }
  })
  ed.layout({ width: host.clientWidth, height: host.clientHeight })
  return { ed, modelo }
}

/** El Monaco de la pestaña: se crea en el primer visible y solo con caja; sigue al lenguaje y a la parte. */
function useMonacoFuente(
  refs: RefsEditorFuente,
  propsRef: React.MutableRefObject<DbFuentePaneProps>,
  haSidoVisible: boolean,
  lenguaje: string,
  texto: string,
  parte: number
): void {
  const { hostRef, editorRef, modeloRef, vistasRef, parteRef } = refs
  const [editorListo, setEditorListo] = useState(false)

  useEffect(() => {
    if (!haSidoVisible) return
    const host = hostRef.current
    if (!host) return
    let creado: ReturnType<typeof crearEditorFuente> | null = null
    let soltarSilencio: (() => void) | null = null
    const crear = (): void => {
      if (creado || host.clientWidth === 0 || host.clientHeight === 0) return
      soltarSilencio = retenerSilencioCancelaciones()
      creado = crearEditorFuente(host, propsRef.current)
      editorRef.current = creado.ed
      modeloRef.current = creado.modelo
      setEditorListo(true)
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
      setEditorListo(false)
    }
  }, [haSidoVisible, hostRef, editorRef, modeloRef, propsRef])

  // El lenguaje sigue al motor (una conexión editada a otro motor, caso raro).
  useEffect(() => {
    const modelo = modeloRef.current
    if (!modelo || modelo.getLanguageId() === lenguaje) return
    ensureMonaco().editor.setModelLanguage(modelo, lenguaje)
  }, [lenguaje, editorListo, modeloRef])

  // Texto de la parte activa, y la vista que se guardó de ella.
  useEffect(() => {
    const ed = editorRef.current
    const modelo = modeloRef.current
    if (!ed || !modelo) return
    if (modelo.getValue() !== texto) modelo.setValue(texto)
    const vista = vistasRef.current.get(parte)
    if (vista) ed.restoreViewState(vista)
    parteRef.current = parte
  }, [texto, parte, editorListo, editorRef, modeloRef, vistasRef, parteRef])
}

/** Lo que tapa el editor: el error descrito, o el vacío si no hay texto ni aviso. */
function capaFuente(error: DbErrorSql | null, esDdl: boolean, fuente: DbFuente | null): React.JSX.Element | null {
  const descripcion = error ? describirError(error, esDdl ? 'leer el DDL' : 'leer la fuente') : null
  if (descripcion) {
    return (
      <AvisoCaja
        tono={descripcion.tono}
        titulo={descripcion.titulo}
        sugerencia={descripcion.sugerencia}
        detalle={descripcion.detalle}
      />
    )
  }
  const sinTexto = fuente !== null && fuente.partes.every((p) => p.texto.trim() === '')
  if (!sinTexto || fuente.aviso) return null
  return (
    <EstadoVacio
      titulo={esDdl ? 'Sin DDL' : 'Sin fuente'}
      pista={esDdl ? 'El servidor no devolvió DDL para este objeto.' : 'El servidor no devolvió texto para este objeto.'}
    />
  )
}

function tituloCopiarFuente(partes: readonly Parte[], parteActual: Parte | null, esDdl: boolean): string {
  if (partes.length > 1 && parteActual) return `Copiar ${parteActual.titulo.toLowerCase()}`
  return esDdl ? 'Copiar el DDL' : 'Copiar la fuente'
}

interface BarraFuenteProps {
  esDdl: boolean
  fuente: DbFuente | null
  cargando: boolean
  parte: number
  parteActual: Parte | null
  elegirParte: (i: number) => void
  refrescar: () => void
  abrirEnConsola: (texto: string) => void
}

/** La barra: conmutador de partes a la izquierda (identidad) y, a la derecha, solo iconos. */
function BarraFuente(p: BarraFuenteProps): React.JSX.Element {
  const { esDdl, fuente, parteActual } = p
  const partes = fuente?.partes ?? []
  const motivoSinTexto = !parteActual || parteActual.texto.trim() === '' ? 'No hay texto que usar' : null
  const copiar = (): void => {
    if (!parteActual) return
    window.tessera.clipboard
      .write(parteActual.texto)
      .then(() => notify('success', 'Copiado', partes.length > 1 ? parteActual.titulo : undefined))
      .catch((err: unknown) => notifyError('No se pudo copiar', err))
  }
  const abrirEnConsola = (): void => {
    if (!parteActual) return
    p.abrirEnConsola(parteActual.texto)
  }
  return (
    <header className="panel-header db-barra">
      {partes.length > 1 && (
        <div className="db-fuente-partes" role="radiogroup" aria-label="Parte de la fuente">
          {partes.map((pt, i) => (
            <button
              key={pt.titulo}
              type="button"
              role="radio"
              aria-checked={i === p.parte}
              className="db-fuente-parte"
              onClick={() => p.elegirParte(i)}
            >
              {pt.titulo}
            </button>
          ))}
        </div>
      )}
      <span className="db-barra-meta" title={fuente ? `Origen: ${fuente.origen}` : undefined}>
        {p.cargando ? 'Cargando…' : partes.length === 1 ? partes[0].titulo : ''}
      </span>
      <div className="panel-actions">
        <BotonBarraBd
          etiqueta="Refrescar"
          titulo={esDdl ? 'Volver a pedir el DDL al servidor' : 'Volver a leer la fuente del servidor'}
          onClick={p.refrescar}
        >
          <IconoRefrescar />
        </BotonBarraBd>
        <span className="panel-actions-sep" aria-hidden="true" />
        <BotonBarraBd etiqueta="Copiar" titulo={tituloCopiarFuente(partes, parteActual, esDdl)} motivo={motivoSinTexto} onClick={copiar}>
          <IconoCopiar />
        </BotonBarraBd>
        <BotonBarraBd
          etiqueta="Abrir en consola"
          titulo="Abrir este texto en una consola nueva"
          motivo={motivoSinTexto}
          onClick={abrirEnConsola}
        >
          <IconoConsola />
        </BotonBarraBd>
      </div>
    </header>
  )
}

export function DbFuentePane(props: DbFuentePaneProps): React.JSX.Element {
  // `paneKey` se lee de `propsRef` al crear el modelo (la URI se fija una vez).
  const { conexion, objeto, visible, onAbrirConsola } = props
  const esDdl = props.modo === 'ddl'
  const lenguaje = lenguajeFuente(conexion.motor)
  const nombre = nombreCalificado(objeto.esquema, objeto.nombre, dialectoDeMotor(conexion.motor))

  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const refs: RefsEditorFuente = {
    hostRef: useRef<HTMLDivElement>(null),
    editorRef: useRef<editor.IStandaloneCodeEditor | null>(null),
    modeloRef: useRef<editor.ITextModel | null>(null),
    vistasRef: useRef(new Map<number, editor.ICodeEditorViewState | null>()),
    parteRef: useRef(0)
  }
  const [haSidoVisible, setHaSidoVisible] = useState(false)

  useVisibleLayout(refs.hostRef, refs.editorRef, visible)
  const { fuente, error, cargando, parte, setParte, cargar } = useCargaFuente(propsRef, refs, visible, haSidoVisible, setHaSidoVisible)

  const partes = fuente?.partes ?? []
  const parteActual = partes[parte] ?? partes[0] ?? null
  useMonacoFuente(refs, propsRef, haSidoVisible, lenguaje, parteActual?.texto ?? '', parte)

  const elegirParte = (i: number): void => {
    if (i === parte) return
    const ed = refs.editorRef.current
    if (ed) refs.vistasRef.current.set(parte, ed.saveViewState())
    setParte(i)
  }

  const capa = capaFuente(error, esDdl, fuente)

  return (
    <section
      className={`db-fuente${esDdl ? ' db-fuente-ddl' : ''}${visible ? '' : ' hidden'}`}
      aria-label={`${esDdl ? 'DDL' : 'Fuente'} de ${nombre}`}
    >
      <BarraFuente
        esDdl={esDdl}
        fuente={fuente}
        cargando={cargando}
        parte={parte}
        parteActual={parteActual}
        elegirParte={elegirParte}
        refrescar={() => void cargar(true)}
        abrirEnConsola={(texto) => onAbrirConsola(conexion.id, texto)}
      />

      {fuente?.aviso && !error && <AvisoCaja tono="info" titulo={fuente.aviso} />}

      <div className="db-fuente-cuerpo">
        <div ref={refs.hostRef} className="db-fuente-host editor-host" />
        {capa && <div className="db-fuente-capa">{capa}</div>}
      </div>
    </section>
  )
}
