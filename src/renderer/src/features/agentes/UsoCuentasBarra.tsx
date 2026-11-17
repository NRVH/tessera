// =============================================================================
// «Uso de las cuentas» en la barra de estado: las cuentas fijadas del perfil, cada una en su cápsula, o su icono si no
// hay ninguna a la vista; un clic abre la lista con todas las del perfil, de los dos agentes y donde corran. Lo que ya
// está a la vista en el pie de un panel no se repite (`cuentasALaVista.ts`). Cuánto se enseña de cada cápsula lo decide
// la escalera de la barra de estado (`data-escalon`).
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { Cruce, Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { HUECO, MARGEN } from '../../comun/popoverFlotante'
import { IconoAjustes, IconoFijar } from '../../comun/iconosMenu'
import type { CuentaFijada } from '../../../../shared/workspace-state-ipc'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { CUENTA_HOST_ID } from './tiposPaneAgente'
import { abrirGestionAgentes } from './abrirGestion'
import { useCuentasALaVista } from './cuentasALaVista'
import { formatoPorcentaje, variableNivelUso } from './formatoUso'
import { usePerfilActivo } from './GestionAgentes'
import { IconoUsoCuentas } from './iconosPaneAgente'
import { construirGrupos, estaALaVista, fijadasEnBarra, fijadasVigentes, filtrarGrupos, peorVentana, sinHueco, ventanasCuenta, type CuentaUso, type GrupoCuentasUso } from './modeloUsoCuentas'
import { CeldaUsoCuenta, ModoCuenta, nombreCuenta } from './piezasUsoCuenta'
import { TarjetaCuenta, useAnclaTarjeta } from './TarjetaCuenta'
import { MIN_CUENTAS_COMPACTO } from './selectorCuenta'
import { alternarCuentaFijada, useStoreAgentes } from './store'
import { txContexto } from './textosContexto'
import { txPane } from './textosPane.ts'
import { useCuentasDeFijadas, useLecturaCuentas } from './useUsoCuentas'
import { useSondeoUso } from './useSondeoUso'

const SIN_FIJADAS: CuentaFijada[] = []
const SIN_CUENTAS: CuentaAgente[] = []
/** Ancho de la lista; en una ventana estrecha, el que quepa. */
const ANCHO_LISTA = 400

/**
 * `visible` en falso (la vista de agentes, que junta varios perfiles y no es la de ninguno) la saca de la barra con un
 * fundido y cierra su lista; las fijadas siguen guardadas en su perfil.
 */
export function UsoCuentasBarra({ visible }: { visible: boolean }): React.JSX.Element | null {
  const { perfilId, nombre } = usePerfilActivo()
  const guardadas = useStoreAgentes((s) => (perfilId ? s.cuentasFijadasPorPerfil[perfilId] : undefined)) ?? SIN_FIJADAS
  const aLaVista = useCuentasALaVista(perfilId)
  const [abierta, ponerAbierta] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)
  const metadatos = useCuentasDeFijadas(perfilId, guardadas, abierta) ?? SIN_CUENTAS
  const enBarra = fijadasEnBarra(guardadas, aLaVista, metadatos).map((f): CuentaUso => ({
    ...f, cuenta: metadatos.find((c) => c.id === f.accountId && c.agente === f.agente) ?? null, foto: null
  }))
  useEffect(() => ponerAbierta(false), [perfilId, visible])
  if (!perfilId) return null
  const t = txContexto().uso
  return (
    <>
      <Presente visible={visible} como="span" className="uso-cuentas-presencia mov-aparece">
        <button
          ref={boton}
          type="button"
          className="status-bar-btn uso-cuentas-boton"
          aria-haspopup="dialog"
          aria-expanded={abierta}
          // Sin `aria-label`: el nombre sale del contenido, con el de cada cápsula fijada; sin ninguna, del título. Con
          // cápsulas no lleva título: cada una enseña su tarjeta, y el tooltip saldría encima.
          title={enBarra.length ? undefined : t.cuentas}
          onClick={() => ponerAbierta((v) => !v)}
        >
          <Presente visible={enBarra.length === 0} como="span" className="uso-cuentas-icono mov-aparece">
            <IconoUsoCuentas />
          </Presente>
          {/* Dos ranuras fijas: al quitar la primera, la segunda pasa a su sitio con un fundido y la otra sale. */}
          <RanuraFijada cuenta={enBarra[0] ?? null} conTarjeta={!abierta} />
          <RanuraFijada cuenta={enBarra[1] ?? null} conTarjeta={!abierta} />
        </button>
      </Presente>
      {visible && abierta && boton.current && (
        <PanelUsoCuentas
          perfilId={perfilId}
          nombrePerfil={nombre}
          fijadas={guardadas}
          aLaVista={aLaVista}
          boton={boton.current}
          onCerrar={(devolverFoco) => {
            ponerAbierta(false)
            if (devolverFoco) boton.current?.focus()
          }}
        />
      )}
    </>
  )
}

/** Una cápsula fijada, con su propio sondeo. Conserva el último contenido mientras sale y cruza al cambiar de cuenta. */
function RanuraFijada({ cuenta, conTarjeta }: { cuenta: CuentaUso | null; conTarjeta: boolean }): React.JSX.Element {
  const { foto } = useSondeoUso({ agente: cuenta?.agente ?? 'codex', cuentaId: cuenta?.accountId ?? CUENTA_HOST_ID, modo: cuenta?.accountId ? 'container' : 'host', habilitado: !!cuenta })
  const ultima = useUltimoValor(cuenta ? { ...cuenta, foto } : null)
  const { ancla, eventos } = useAnclaTarjeta()
  return <Presente visible={!!cuenta} como="span" className="uso-fijada-presencia mov-aparece" {...eventos}>
    {ultima && <Cruce clave={`${ultima.agente}|${ultima.accountId}`} className="uso-fijada-cruce"><CapsulaFijada cuenta={ultima} /></Cruce>}
    {/* Con la lista abierta no: la lista ya tapa ese sitio y enseña lo mismo. */}
    {cuenta && ultima && ancla && conTarjeta && <TarjetaCuenta cuenta={ultima} ancla={ancla} lado="arriba" />}
  </Presente>
}

/** Nivel de la cápsula por la ventana que más aprieta, con los umbrales de las barras: sin color mientras no aprieta. */
function claseNivel(porcentaje: number): string {
  const nivel = variableNivelUso(porcentaje)
  return nivel === '--red' ? ' es-critico' : nivel === '--yellow' ? ' es-alto' : ''
}

function CapsulaFijada({ cuenta }: { cuenta: CuentaUso }): React.JSX.Element {
  const t = txContexto().uso
  const [corta, larga] = ventanasCuenta(cuenta.foto)
  const peor = peorVentana(cuenta.foto)
  const porcentaje = (w: typeof corta): string => (w ? formatoPorcentaje(w.porcentaje) : t.guion)
  return <span className={`uso-fijada${claseNivel(Math.max(corta?.porcentaje ?? 0, larga?.porcentaje ?? 0))}`}
    aria-label={t.ariaFijada(nombreCuenta(cuenta), porcentaje(corta), porcentaje(larga))}>
    <ModoCuenta cuenta={cuenta} tam={13} />
    <span className="uso-fijada-nombre">{nombreCuenta(cuenta)}</span>
    <CeldaUsoCuenta ventana={corta} etiqueta="5h" clase={peor === 0 ? '' : 'secundaria'} />
    <span className="uso-fijada-sep" aria-hidden="true" />
    <CeldaUsoCuenta ventana={larga} etiqueta="7d" clase={peor === 1 ? '' : 'secundaria'} />
  </span>
}

interface PropsPanel {
  perfilId: string
  nombrePerfil: string
  fijadas: readonly CuentaFijada[]
  aLaVista: readonly CuentaFijada[]
  boton: HTMLElement
  onCerrar: (devolverFoco: boolean) => void
}

/**
 * La lista de las cuentas del perfil, sobre la barra de estado y alineada por la derecha con su botón. Se cierra con
 * un clic fuera o con Escape (que devuelve el foco al botón); al abrirse, el foco va al filtro o a la propia lista.
 */
function PanelUsoCuentas({ perfilId, nombrePerfil, fijadas, aLaVista, boton, onCerrar }: PropsPanel): React.JSX.Element {
  const t = txContexto().uso
  const tm = txPane().menus
  const raiz = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const [filtro, ponerFiltro] = useState('')
  const { cuentas, leido, agentesLeidos } = useLecturaCuentas(perfilId, true)
  const grupos = construirGrupos(cuentas, aLaVista, fijadas)
  const total = grupos.reduce((n, g) => n + g.filas.length, 0)
  const conFiltro = total >= MIN_CUENTAS_COMPACTO
  const visibles = conFiltro ? filtrarGrupos(grupos, filtro, nombreFila) : grupos
  // Una fijada a la vista sí se lista (para poder quitarla): la nota solo habla de las que no salen.
  const omitidas = aLaVista.filter((c) => !estaALaVista(c, fijadas)).length
  const pos = usePosicionSobreBoton(boton)
  useCierreFuera(raiz, boton, () => onCerrar(false))
  useEffect(() => {
    ;(filtroRef.current ?? raiz.current)?.focus()
  }, [conFiltro])
  // Una fijada de Docker borrada no ocupa hueco: al fijar otra, sale de la lista guardada.
  const vigentes = fijadasVigentes(fijadas, cuentas, agentesLeidos)
  const lleno = sinHueco(vigentes)
  return (
    <EnCapaFlotante>
      <div
        ref={raiz}
        className="uso-cuentas-panel"
        role="dialog"
        aria-label={t.cuentas}
        tabIndex={-1}
        style={pos}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onCerrar(true)
        }}
      >
        <div className="uso-cuentas-cabecera">
          <span className="uso-cuentas-titulo">{t.cuentas}</span>
          <span className="uso-cuentas-perfil">{t.perfil(nombrePerfil)}</span>
        </div>
        {conFiltro && <input ref={filtroRef} className="modal-input uso-cuentas-filtro" placeholder={tm.filtrarCuentas} aria-label={tm.filtrarCuentas}
          value={filtro} spellCheck={false} onChange={(e) => ponerFiltro(e.target.value)} />}
        <div className="uso-cuentas-lista">
          {!leido && <div className="uso-cuentas-vacio">{t.consultando}</div>}
          {leido && total === 0 && <div className="uso-cuentas-vacio">{omitidas ? t.todasALaVista : t.sinCuentas}</div>}
          {leido && total > 0 && visibles.length === 0 && <div className="uso-cuentas-vacio">{tm.sinCoincidencias}</div>}
          {visibles.map((grupo) => <GrupoCuentas key={grupo.agente} grupo={grupo} fijadas={fijadas} lleno={lleno}
            onAlternar={(fila) => alternarCuentaFijada(perfilId, { agente: fila.agente, accountId: fila.accountId }, vigentes)} />)}
          {leido && total > 0 && omitidas > 0 && <div className="uso-cuentas-nota">{omitidas > 1 ? t.notaPaneles : t.notaPanel}</div>}
        </div>
        <div className="uso-cuentas-pie">
          <span className="uso-cuentas-pista" title={t.pistaTitulo}>{t.pista}</span>
          <button type="button" className="uso-cuentas-administrar" onClick={() => { onCerrar(false); abrirGestionAgentes() }}>
            <IconoAjustes />
            {tm.administrarCuentas}
          </button>
        </div>
      </div>
    </EnCapaFlotante>
  )
}

/**
 * Un clic fuera de la lista la cierra antes de llegar a lo de debajo. El botón que la abre no cuenta como fuera: su
 * propio clic la cierra, y si no, se cerraría y volvería a abrirse.
 */
function useCierreFuera(raiz: React.RefObject<HTMLElement>, boton: HTMLElement, alFuera: () => void): void {
  const cerrar = useRef(alFuera)
  cerrar.current = alFuera
  useEffect(() => {
    const fuera = (e: MouseEvent): void => {
      if (e.target instanceof Node && (raiz.current?.contains(e.target) || boton.contains(e.target))) return
      cerrar.current()
    }
    window.addEventListener('mousedown', fuera)
    return () => window.removeEventListener('mousedown', fuera)
  }, [raiz, boton])
}

/** El nombre de la fila: la nativa dice dónde corre, porque su grupo ya dice de qué agente es. */
function nombreFila(fila: CuentaUso): string {
  return fila.accountId === null ? txContexto().uso.equipo : nombreCuenta(fila)
}

interface PropsGrupo {
  grupo: GrupoCuentasUso
  fijadas: readonly CuentaFijada[]
  lleno: boolean
  onAlternar: (fila: CuentaUso) => void
}

function GrupoCuentas({ grupo, fijadas, lleno, onAlternar }: PropsGrupo): React.JSX.Element {
  return <div className="uso-cuentas-grupo">
    <div className="uso-cuentas-agente">{grupo.agente === 'codex' ? 'Codex' : 'Claude Code'}</div>
    {grupo.filas.map((fila) => <FilaCuenta key={fila.accountId ?? 'host'} fila={fila} fijada={estaALaVista(fila, fijadas)} lleno={lleno}
      onAlternar={() => onAlternar(fila)} />)}
  </div>
}

interface PropsFila {
  fila: CuentaUso
  fijada: boolean
  lleno: boolean
  onAlternar: () => void
}

/** Una cuenta de la lista. Una fijada siempre se puede quitar, aunque haya cerrado la sesión. */
function FilaCuenta({ fila, fijada, lleno, onAlternar }: PropsFila): React.JSX.Element {
  const t = txContexto().uso
  const nombre = nombreFila(fila)
  const sinSesion = fila.cuenta?.conSesion === false
  const titulo = fijada ? t.quitar(nombre) : sinSesion ? t.iniciarParaFijar : lleno ? t.sinHueco : t.fijar(nombre)
  const [corta, larga] = ventanasCuenta(fila.foto)
  const { ancla, eventos } = useAnclaTarjeta()
  return <div className={`uso-cuentas-fila${fijada ? ' fijada' : ''}`} {...eventos}>
    <span className="cuenta-uso-nombre"><ModoCuenta cuenta={fila} tam={14} /><span>{nombre}</span></span>
    {sinSesion ? <span className="cuenta-uso-sin-sesion">{t.sinSesion}</span> : <><CeldaUsoCuenta ventana={corta} etiqueta="5h" /><CeldaUsoCuenta ventana={larga} etiqueta="7d" /></>}
    <button type="button" className="cuenta-uso-fijar" aria-pressed={fijada} disabled={!fijada && (sinSesion || lleno)} title={titulo} aria-label={titulo}
      onClick={onAlternar}><IconoFijar /></button>
    {/* A la izquierda de la lista, para no tapar las demás filas. */}
    {ancla && <TarjetaCuenta cuenta={fila} ancla={ancla} lado="izquierda" junto={ancla.closest<HTMLElement>('.uso-cuentas-panel')} />}
  </div>
}

/** La posición sobre el botón, al día con la ventana y con el ancho del botón, que cambia con la escalera de la barra. */
function usePosicionSobreBoton(boton: HTMLElement): ReturnType<typeof posicionSobreBoton> {
  const [, repintar] = useState(0)
  useEffect(() => {
    const avisar = (): void => repintar((n) => n + 1)
    const tamano = new ResizeObserver(avisar)
    tamano.observe(boton)
    window.addEventListener('resize', avisar)
    return () => {
      tamano.disconnect()
      window.removeEventListener('resize', avisar)
    }
  }, [boton])
  return posicionSobreBoton(boton)
}

/**
 * Encima del botón y alineada por su borde derecho, dentro de la ventana. Se ancla por abajo: al filtrar o al llegar
 * la lectura, la lista crece o mengua hacia arriba sin despegarse de la barra.
 */
function posicionSobreBoton(boton: HTMLElement): { left: number; bottom: number; width: number; maxHeight: number } {
  const r = boton.getBoundingClientRect()
  const ancho = Math.min(ANCHO_LISTA, window.innerWidth - 2 * MARGEN)
  const abajo = window.innerHeight - r.top + HUECO
  return { left: Math.max(MARGEN, Math.min(r.right - ancho, window.innerWidth - ancho - MARGEN)), bottom: abajo, width: ancho, maxHeight: window.innerHeight - abajo - MARGEN }
}
