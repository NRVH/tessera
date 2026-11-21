// =============================================================================
// «Uso de las cuentas» en la barra de estado: su botón siempre a la derecha de las cápsulas fijadas del perfil.
// El botón abre la lista; cada cápsula enseña sus límites con puntero o foco de teclado y ofrece un menú contextual. Lo que ya
// está a la vista en el pie de un panel no se repite (`cuentasALaVista.ts`). Cuánto se enseña de cada cápsula lo decide
// la escalera de la barra de estado (`data-escalon`). El menú se apoya encima de la cápsula con ratón y teclado.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cruce, Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { MenuContextual } from '../../comun/MenuContextual'
import { HUECO, MARGEN } from '../../comun/popoverFlotante'
import { IconoAjustes, IconoDesfijar, IconoFijar } from '../../comun/iconosMenu'
import type { CuentaFijada } from '../../../../shared/workspace-state-ipc'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { CUENTA_HOST_ID } from './tiposPaneAgente'
import { abrirGestionAgentes } from './abrirGestion'
import { useCuentasALaVista } from './cuentasALaVista'
import { formatoPorcentaje, variableNivelUso } from './formatoUso'
import { usePerfilActivo } from './GestionAgentes'
import { IconoUsoCuentas } from './iconosPaneAgente'
import { useCierresInicioSesion } from './InicioSesionCuenta'
import { construirGrupos, controlesFilaCuenta, estaALaVista, fijadasEnBarra, fijadasVigentes, filtrarGrupos, mismaCuenta, ofreceMenuDesfijar, peorVentana, sinHueco, ventanasCuenta, type CuentaUso, type GrupoCuentasUso } from './modeloUsoCuentas'
import { BotonIniciarSesionCuenta, CeldaUsoCuenta, ModoCuenta, nombreCuenta } from './piezasUsoCuenta'
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

type CierreInicioSesion = { perfilId: string | null; contador: number; cuentasRefrescadas: Set<string> }

/**
 * `visible` en falso (la vista de agentes, que junta varios perfiles y no es la de ninguno) la saca de la barra con un
 * fundido y cierra su lista; las fijadas siguen guardadas en su perfil.
 */
export function UsoCuentasBarra({ visible }: { visible: boolean }): React.JSX.Element | null {
  const { perfilId, nombre } = usePerfilActivo()
  const contador = useCierresInicioSesion(perfilId)
  const cierre = useMemo<CierreInicioSesion>(() => ({ perfilId, contador, cuentasRefrescadas: new Set() }), [perfilId, contador])
  const guardadas = useStoreAgentes((s) => (perfilId ? s.cuentasFijadasPorPerfil[perfilId] : undefined)) ?? SIN_FIJADAS
  const aLaVista = useCuentasALaVista(perfilId)
  const [abierta, ponerAbierta] = useState(false)
  const [puntero, ponerPuntero] = useState<number | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const disparador = useRef<HTMLElement | null>(null)
  const [menu, ponerMenu] = useState<{ cuenta: CuentaUso; x: number; y: number } | null>(null)
  const metadatos = useCuentasDeFijadas(perfilId, guardadas, abierta) ?? SIN_CUENTAS
  const enBarra = fijadasEnBarra(guardadas, aLaVista, metadatos).map((f): CuentaUso => ({
    ...f, cuenta: metadatos.find((c) => c.id === f.accountId && c.agente === f.agente) ?? null, foto: null
  }))
  useEffect(() => { ponerAbierta(false); ponerMenu(null); ponerPuntero(null) }, [perfilId, visible])
  if (!perfilId) return null
  const t = txContexto().uso
  return (
    <>
      <Presente visible={visible} como="span" className="uso-cuentas-presencia mov-aparece">
        {/* Dos ranuras fijas: al quitar la primera, la segunda pasa a su sitio con un fundido y la otra sale. */}
        {[0, 1].map((indice) => <RanuraFijada key={indice} cuenta={enBarra[indice] ?? null} conTarjeta={!abierta && !menu && (puntero === null || puntero === indice)}
          cierre={cierre} metadatos={metadatos} indice={indice} ponerPuntero={ponerPuntero}
          alMenu={(cuenta, elemento, x, y) => {
            disparador.current = elemento
            ponerMenu({ cuenta, x, y })
          }} />)}
        <button
          ref={boton} type="button" className="status-bar-btn uso-cuentas-boton"
          aria-haspopup="dialog" aria-expanded={abierta}
          title={t.consultarYFijar} aria-label={t.consultarYFijar}
          onClick={() => ponerAbierta((v) => !v)}
        >
          <span className="uso-cuentas-icono">
            <IconoUsoCuentas />
          </span>
        </button>
      </Presente>
      {visible && menu && <EnCapaFlotante><MenuContextual x={menu.x} y={menu.y} anclaje="encima" disparador={disparador}
        onCerrar={() => ponerMenu(null)} items={[
          { label: t.desfijar(nombreCuenta(menu.cuenta)), icon: <IconoDesfijar />, onClick: () => {
            boton.current?.focus()
            alternarCuentaFijada(perfilId, { agente: menu.cuenta.agente, accountId: menu.cuenta.accountId })
          } },
          { label: t.abrirCuentas, icon: <IconoUsoCuentas />, onClick: () => { boton.current?.focus(); ponerAbierta(true) } }
        ]} /></EnCapaFlotante>}
      {visible && abierta && boton.current && (
        <PanelUsoCuentas
          perfilId={perfilId} nombrePerfil={nombre}
          fijadas={guardadas} aLaVista={aLaVista} boton={boton.current}
          onCerrar={(devolverFoco) => {
            ponerAbierta(false)
            if (devolverFoco) boton.current?.focus()
          }}
        />
      )}
    </>
  )
}

function useSondeoFijada(cuenta: CuentaUso | null, cierre: CierreInicioSesion, metadatos: CuentaAgente[]): CuentaUso['foto'] {
  const cuentaDocker = cuenta?.accountId
  const { foto, refrescar } = useSondeoUso({
    agente: cuenta?.agente ?? 'codex', cuentaId: cuentaDocker ?? CUENTA_HOST_ID,
    modo: cuentaDocker ? 'container' : 'host', habilitado: !!cuenta
  })
  const anterior = useRef({ cierre, metadatos, pendiente: false })
  useEffect(() => {
    const previo = anterior.current
    const mismoPerfil = previo.cierre.perfilId === cierre.perfilId
    const nuevoCierre = mismoPerfil && previo.cierre.contador !== cierre.contador
    const releidas = mismoPerfil && previo.pendiente && previo.metadatos !== metadatos
    // Una cuenta sin sesión puede volver a la barra con los metadatos del cierre y desplazar otra ranura.
    anterior.current = { cierre, metadatos, pendiente: nuevoCierre || (mismoPerfil && previo.pendiente && !releidas) }
    if ((nuevoCierre || releidas) && cuentaDocker && !cierre.cuentasRefrescadas.has(cuentaDocker)) {
      cierre.cuentasRefrescadas.add(cuentaDocker)
      void refrescar(true)
    }
  }, [cierre, metadatos, cuentaDocker, refrescar])
  return foto
}

/** Una cápsula fijada, con su propio sondeo. Conserva el último contenido mientras sale y cruza al cambiar de cuenta. */
function RanuraFijada({ cierre, metadatos, cuenta, conTarjeta, indice, ponerPuntero, alMenu }: { cierre: CierreInicioSesion; metadatos: CuentaAgente[]; cuenta: CuentaUso | null; conTarjeta: boolean; indice: number; ponerPuntero: React.Dispatch<React.SetStateAction<number | null>>; alMenu: (cuenta: CuentaUso, elemento: HTMLElement, x: number, y: number) => void }): React.JSX.Element {
  const foto = useSondeoFijada(cuenta, cierre, metadatos)
  const ultima = useUltimoValor(cuenta ? { ...cuenta, foto } : null)
  const { ancla, eventos } = useAnclaTarjeta()
  const [foco, ponerFoco] = useState<HTMLElement | null>(null)
  useEffect(() => {
    ponerFoco(null)
    ponerPuntero((actual) => actual === indice ? null : actual)
  }, [cuenta?.agente, cuenta?.accountId, indice, ponerPuntero])
  const abrirMenu = (elemento: HTMLElement): void => {
    if (!cuenta) return
    const borde = elemento.getBoundingClientRect()
    alMenu(cuenta, elemento, borde.left, borde.top - 4)
  }
  const anclaTarjeta = ancla?.isConnected ? ancla : foco?.isConnected && foco === document.activeElement && foco.matches(':focus-visible') ? foco : null
  return <Presente visible={!!cuenta} como="span" className="uso-fijada-presencia mov-aparece" {...eventos}
    tabIndex={0} role="group" aria-haspopup="menu" aria-label={descripcionFijada(ultima)}
    onMouseEnter={(e) => { eventos.onMouseEnter?.(e); ponerPuntero(indice) }}
    onMouseLeave={(e) => { eventos.onMouseLeave?.(e); ponerPuntero((actual) => actual === indice ? null : actual) }}
    onMouseDown={(e) => { eventos.onMouseDown?.(e); ponerFoco(null) }}
    onFocus={(e) => ponerFoco(e.currentTarget.matches(':focus-visible') ? e.currentTarget : null)} onBlur={() => ponerFoco(null)}
    onContextMenu={(e) => { e.preventDefault(); abrirMenu(e.currentTarget) }}>
    {ultima && <Cruce clave={`${ultima.agente}|${ultima.accountId}`} className="uso-fijada-cruce"><CapsulaFijada cuenta={ultima} /></Cruce>}
    {/* La lista y el menú necesitan el foco y la superficie libres de la tarjeta. */}
    {cuenta && ultima && anclaTarjeta && conTarjeta && <TarjetaCuenta cuenta={ultima} ancla={anclaTarjeta} lado="arriba" conBotonDeInicio={false} />}
  </Presente>
}

/** El nombre accesible conserva los porcentajes aunque la escalera oculte una ventana. */
function descripcionFijada(cuenta: CuentaUso | null): string | undefined {
  if (!cuenta) return undefined
  const t = txContexto().uso
  const porcentajes = ventanasCuenta(cuenta.foto).map((v) => v ? formatoPorcentaje(v.porcentaje) : t.guion)
  return t.ariaFijada(nombreCuenta(cuenta), porcentajes[0], porcentajes[1])
}

/** Nivel de la cápsula por la ventana que más aprieta, con los umbrales de las barras: sin color mientras no aprieta. */
function claseNivel(porcentaje: number): string {
  const nivel = variableNivelUso(porcentaje)
  return nivel === '--red' ? ' es-critico' : nivel === '--yellow' ? ' es-alto' : ''
}

function CapsulaFijada({ cuenta }: { cuenta: CuentaUso }): React.JSX.Element {
  const [corta, larga] = ventanasCuenta(cuenta.foto)
  const peor = peorVentana(cuenta.foto)
  return <span className={`uso-fijada${claseNivel(Math.max(corta?.porcentaje ?? 0, larga?.porcentaje ?? 0))}`}>
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
  const disparador = useRef<HTMLElement | null>(null)
  const [filtro, ponerFiltro] = useState('')
  const [menu, ponerMenu] = useState<{ cuenta: CuentaUso; x: number; y: number } | null>(null)
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
  const filaMenu = menu ? cuentas.find((c) => mismaCuenta(c, menu.cuenta)) : null
  const menuVivo = menu && filaMenu && estaALaVista(filaMenu, fijadas) && ofreceMenuDesfijar(filaMenu, true) ? menu : null
  return (
    <>
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
            {visibles.map((grupo) => <GrupoCuentas key={grupo.agente} perfilId={perfilId} grupo={grupo} fijadas={fijadas} lleno={lleno}
              conTarjeta={!menuVivo} alAbrirAcceso={() => onCerrar(true)}
              onAlternar={(fila) => alternarCuentaFijada(perfilId, { agente: fila.agente, accountId: fila.accountId }, vigentes)}
              onMenu={(fila, elemento, x, y) => {
                disparador.current = elemento ?? raiz.current
                ponerMenu({ cuenta: fila, x, y })
              }} />)}
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
      {/* Fuera del diálogo en el árbol de React para que Escape en el menú no cierre también la lista. */}
      {menuVivo && (
        <EnCapaFlotante>
          <MenuContextual x={menuVivo.x} y={menuVivo.y} disparador={disparador} onCerrar={() => ponerMenu(null)} items={[
            { label: t.desfijar(nombreCuenta(menuVivo.cuenta)), icon: <IconoDesfijar />, onClick: () => {
              ;(estaALaVista(menuVivo.cuenta, aLaVista) ? raiz.current : disparador.current)?.focus()
              alternarCuentaFijada(perfilId, { agente: menuVivo.cuenta.agente, accountId: menuVivo.cuenta.accountId }, vigentes)
            } }
          ]} />
        </EnCapaFlotante>
      )}
    </>
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
      if (e.target instanceof Element && e.target.closest('.ctx-menu')) return
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
  perfilId: string
  grupo: GrupoCuentasUso
  fijadas: readonly CuentaFijada[]
  lleno: boolean
  conTarjeta: boolean
  onAlternar: (fila: CuentaUso) => void
  onMenu: (fila: CuentaUso, elemento: HTMLElement | null, x: number, y: number) => void
  alAbrirAcceso: () => void
}

function GrupoCuentas({ perfilId, grupo, fijadas, lleno, conTarjeta, onAlternar, onMenu, alAbrirAcceso }: PropsGrupo): React.JSX.Element {
  return <div className="uso-cuentas-grupo">
    <div className="uso-cuentas-agente">{grupo.agente === 'codex' ? 'Codex' : 'Claude Code'}</div>
    {grupo.filas.map((fila) => <FilaCuenta key={fila.accountId ?? 'host'} perfilId={perfilId} fila={fila} fijada={estaALaVista(fila, fijadas)} lleno={lleno}
      conTarjeta={conTarjeta} onAlternar={() => onAlternar(fila)} onMenu={(elemento, x, y) => onMenu(fila, elemento, x, y)} alAbrirAcceso={alAbrirAcceso} />)}
  </div>
}

interface PropsFila {
  perfilId: string
  fila: CuentaUso
  fijada: boolean
  lleno: boolean
  conTarjeta: boolean
  onAlternar: () => void
  onMenu: (elemento: HTMLElement | null, x: number, y: number) => void
  alAbrirAcceso: () => void
}

/** Una cuenta de la lista. Una fijada sin sesión oculta el pin y se desfija desde el menú contextual de la fila. */
function FilaCuenta({ perfilId, fila, fijada, lleno, conTarjeta, onAlternar, onMenu, alAbrirAcceso }: PropsFila): React.JSX.Element {
  const t = txContexto().uso
  const nombre = nombreFila(fila)
  const { cuentaParaIniciar, mostrarPin } = controlesFilaCuenta(fila)
  const conMenu = ofreceMenuDesfijar(fila, fijada)
  const acceso = cuentaParaIniciar && <BotonIniciarSesionCuenta perfilId={perfilId} cuenta={cuentaParaIniciar} alAbrir={alAbrirAcceso} />
  const titulo = fijada ? t.quitar(nombre) : lleno ? t.sinHueco : t.fijar(nombre)
  const [corta, larga] = ventanasCuenta(fila.foto)
  const { ancla, eventos } = useAnclaTarjeta()
  return <div className={`uso-cuentas-fila${fijada ? ' fijada' : ''}`} {...eventos}
    onContextMenu={conMenu ? (e) => {
      e.preventDefault()
      const activo = document.activeElement
      const elemento = activo instanceof HTMLElement && e.currentTarget.contains(activo) ? activo : null
      const borde = (elemento ?? e.currentTarget).getBoundingClientRect()
      const conPuntero = e.clientX !== 0 || e.clientY !== 0
      onMenu(elemento, conPuntero ? e.clientX : borde.left, conPuntero ? e.clientY : borde.bottom)
    } : undefined}>
    <span className="cuenta-uso-nombre"><ModoCuenta cuenta={fila} tam={14} /><span>{nombre}</span></span>
    {cuentaParaIniciar
      ? <span className="cuenta-uso-sin-sesion">{t.sinSesion}</span>
      : <><CeldaUsoCuenta ventana={corta} etiqueta="5h" /><CeldaUsoCuenta ventana={larga} etiqueta="7d" /></>}
    <Cruce clave={mostrarPin ? 'fijar' : 'iniciar'}>
      {mostrarPin
        ? <button type="button" className="cuenta-uso-fijar" aria-pressed={fijada} disabled={!fijada && lleno} title={titulo} aria-label={titulo}
          onClick={onAlternar}><IconoFijar /></button>
        : acceso}
    </Cruce>
    {/* A la izquierda de la lista, para no tapar las demás filas. */}
    {conTarjeta && ancla && <TarjetaCuenta cuenta={fila} ancla={ancla} lado="izquierda" conBotonDeInicio={!!acceso} junto={ancla.closest<HTMLElement>('.uso-cuentas-panel')} />}
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
