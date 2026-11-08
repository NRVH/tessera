// =============================================================================
// El diálogo del contexto de los agentes: a la izquierda los niveles (global, cada perfil y, aparte, el agente en
// su equipo); a la derecha el nivel elegido, con sus secciones: reglas, documentos, configuración de Docker (en un
// perfil, con el ámbito: todas sus cuentas o una) y, en un perfil, lo que recibe un agente. Ir a otro nivel, a otra
// sección o cerrar con cambios sin guardar pide confirmarlo, también al cerrarlo para revisar una propuesta. Lo
// pinta una sola capa en la raíz de la ventana.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import '../../../comun/formularioModal.css'
import '../configAgente.css'
import './contexto.css'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { AgentAccount } from '../../../../../shared/agent-accounts-ipc'
import type { AgenteConConfig } from '../../../../../shared/configAgente-ipc'
import { ID_REGLAS_GLOBALES } from '../../../../../shared/reglas-ipc'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import { AvisoModal, Modal, PieModal } from '../../../comun/Modal'
import { IconoCerrar } from '../../../comun/iconosMenu'
import { SobreAjustes } from '../GestionAgentes'
import { AYUDA, BotonAyuda } from '../../academy'
import { despacharTabs, revisarPropuesta, useStorePestanas, useStorePropuestasReglas } from '../../pestanas'
import { EditorConfigAgente } from '../EditorConfigAgente'
import { Cruce, Presente } from '../../../comun/Presente'
import { Segmentado } from '../../../comun/Segmentado'
import { IconoPanelDerecho } from '../iconosGestionAgentes'
import { nombreVisible } from '../selectorCuenta.ts'
import { propuestaPara, revisarPropuestaConfig, useStorePropuestasConfig } from '../storePropuestasConfig.ts'
import { txPane } from '../textosPane.ts'
import { txConfigAgente } from '../textosConfigAgente.ts'
import { claveNivel, nivelDelRiel, perfilDelNivel, refConfiguracion, seccionesDe, seccionInicial, type ContextoAbierto, type NivelContexto, type SeccionContexto } from './modeloContexto.ts'
import { PanelDocumentos } from './PanelDocumentos'
import { PanelReglas } from './PanelReglas'
import { AGENTES_CONFIG, nombreAgente, RielContexto, useCuentasDelPerfil } from './RielContexto'
import { cerrarContexto, useStoreContextoAbierto } from './storeContextoAbierto'
import { guardarContextoGlobal, iniciarContextoGlobal, useStoreContextoGlobal } from './storeContextoGlobal'
import { txContexto } from './textosContexto.ts'
import { VistaRecibe } from './VistaRecibe'

interface Vista {
  nivel: NivelContexto
  seccion: SeccionContexto | null
  agente: AgenteConConfig
}

type Destino = Vista | 'cerrar'

/** Ir a un destino; `luego` corre una vez hecho, como abrir otro diálogo tras cerrar este. */
type Ir = (d: Destino, luego?: () => void) => void

const mismaVista = (a: Vista, b: Vista): boolean => claveNivel(a.nivel) === claveNivel(b.nivel) && a.seccion === b.seccion && a.agente === b.agente

/**
 * Ir a otra vista o cerrar. Con cambios sin guardar no se va: queda pendiente hasta que el usuario descarte o
 * siga editando. Ir a la vista en la que ya se está no hace nada: descartar ahí dejaría el texto a la vista sin
 * la confirmación.
 */
function useNavegacion(inicial: Vista, onCerrar: () => void): {
  vista: Vista
  pendiente: Destino | null
  seguir: () => void
  descartar: () => void
  alSinGuardar: (hay: boolean) => void
  hayCambios: boolean
  ir: Ir
} {
  const [vista, setVista] = useState<Vista>(inicial)
  const [pendiente, setPendiente] = useState<{ d: Destino; luego?: () => void } | null>(null)
  const sinGuardar = useRef(false)
  const [hayCambios, setHayCambios] = useState(false)
  const alSinGuardar = useCallback((hay: boolean) => {
    sinGuardar.current = hay
    setHayCambios(hay)
  }, [])
  const ejecutar = (d: Destino, luego?: () => void): void => {
    setPendiente(null)
    if (d === 'cerrar') onCerrar()
    else {
      sinGuardar.current = false
      setHayCambios(false)
      setVista(d)
    }
    luego?.()
  }
  const ir: Ir = (d, luego) => {
    if (d !== 'cerrar' && mismaVista(d, vista)) return
    if (sinGuardar.current) setPendiente({ d, luego })
    else ejecutar(d, luego)
  }
  return {
    vista,
    pendiente: pendiente?.d ?? null,
    seguir: () => setPendiente(null),
    descartar: () => pendiente !== null && ejecutar(pendiente.d, pendiente.luego),
    alSinGuardar,
    hayCambios,
    ir
  }
}

function InterruptorGlobal({ profileId }: { profileId: string }): React.JSX.Element {
  const t = txContexto()
  const usar = useStorePestanas((s) => s.tabs.profiles.find((x) => x.id === profileId)?.contextoGlobal !== false)
  return (
    <div className="nivel-interruptor">
      <span>
        <span className="nivel-interruptor-texto">{t.usarGlobal}</span>
        <Cruce clave={usar ? 'si' : 'no'} className="nivel-alcance">
          {usar ? t.usarGlobalSi : t.usarGlobalNo}
        </Cruce>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={usar}
        aria-label={t.usarGlobal}
        className={`ajustes-switch${usar ? ' on' : ''}`}
        onClick={() => despacharTabs({ type: 'setProfileContextoGlobal', profileId, usar: !usar })}
      >
        <span className="ajustes-switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}

/** Qué nivel se ve y a qué afecta; en un perfil, si usa el global. Una cuenta se ve dentro de su perfil. */
function Cabecera({ nivel: visto, onResumen }: { nivel: NivelContexto; onResumen: () => void }): React.JSX.Element {
  const t = txContexto()
  const nivel = nivelDelRiel(visto)
  const nombrePerfil = useNombrePerfil(perfilDelNivel(nivel))
  let titulo: string
  let alcance: string
  switch (nivel.tipo) {
    case 'global':
      titulo = t.tituloGlobal
      alcance = t.alcanceGlobal
      break
    case 'perfil':
    case 'cuenta':
      titulo = t.tituloPerfil(nombrePerfil)
      alcance = t.alcancePerfil
      break
    case 'equipo':
      titulo = t.tituloEquipo(nombreAgente(nivel.agente), nombresSistema(window.tessera.plataforma).sistema)
      alcance = t.alcanceEquipo
  }
  return (
    <div className="nivel-cabecera">
      <div className="contexto-cabecera-fila">
        <div className="nivel-titulo">{titulo}</div>
        {nivel.tipo === 'perfil' && (
          <button type="button" className="btn contexto-boton-resumen" title={t.resumenAyuda} onClick={onResumen}>
            <IconoPanelDerecho />
            {t.resumen}
          </button>
        )}
      </div>
      <div className="nivel-alcance">{alcance}</div>
      {nivel.tipo === 'perfil' && <InterruptorGlobal profileId={nivel.profileId} />}
    </div>
  )
}

function Secciones({ vista, ir }: { vista: Vista; ir: Ir }): React.JSX.Element | null {
  const t = txContexto()
  const lista = seccionesDe(vista.nivel)
  if (lista.length === 0) return null
  return (
    <div className="config-agente-pestanas" role="tablist" aria-label={t.secciones}>
      {lista.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={s === vista.seccion}
          className={`config-agente-pestana${s === vista.seccion ? ' activa' : ''}`}
          // Otra sección es del perfil entero: se sale del ámbito de una cuenta.
          onClick={() => s !== vista.seccion && ir({ ...vista, nivel: nivelDelRiel(vista.nivel), seccion: s })}
        >
          {t[s]}
        </button>
      ))}
    </div>
  )
}

/**
 * El ámbito de la configuración de Docker de un perfil: todas sus cuentas (su capa) o una cuenta, con sus propios
 * archivos, de las del agente elegido. Son las capas de una misma cascada, así que se eligen aquí y no en el riel.
 */
function SelectorAmbito({ vista, cuentas, ir }: { vista: Vista; cuentas: AgentAccount[] | null; ir: Ir }): React.JSX.Element | null {
  const t = txContexto()
  const id = useId()
  const profileId = perfilDelNivel(vista.nivel)
  const nombrePerfil = useNombrePerfil(profileId)
  if (profileId === null) return null
  const predeterminada = txPane().menus.predeterminada
  const delAgente = (cuentas ?? []).filter((c) => c.agente === vista.agente)
  const valor = vista.nivel.tipo === 'cuenta' ? vista.nivel.accountId : ''
  const elegir = (accountId: string): void =>
    ir({ ...vista, nivel: accountId === '' ? { tipo: 'perfil', profileId } : { tipo: 'cuenta', profileId, agente: vista.agente, accountId } })
  return (
    <div className="contexto-ambito">
      <label htmlFor={id}>{t.ambito}</label>
      {/* Sin cuentas de este agente solo queda una opción: no se abre, y el texto de al lado dice por qué. */}
      <select id={id} value={valor} disabled={delAgente.length === 0} onChange={(e) => elegir(e.target.value)}>
        <option value="">{t.ambitoTodas(nombrePerfil)}</option>
        {delAgente.map((c) => (
          <option key={c.id} value={c.id}>
            {t.ambitoCuenta(nombreVisible(c, predeterminada))}
          </option>
        ))}
      </select>
      <Presente visible={cuentas !== null && delAgente.length === 0} como="span" className="contexto-ambito-vacio mov-aparece">
        {t.sinCuentasAgente(nombreAgente(vista.agente))}
      </Presente>
    </div>
  )
}

/** La configuración de Docker de un nivel: el agente y el ámbito se eligen arriba, y cada uno tiene su archivo. */
function SeccionDocker({ vista, cuentas, ir, alSinGuardar }: { vista: Vista; cuentas: AgentAccount[] | null; ir: Ir; alSinGuardar: (hay: boolean) => void }): React.JSX.Element {
  const t = txContexto()
  const ref = refConfiguracion(vista.nivel, vista.agente)
  const propuesta = useStorePropuestasConfig((s) => (ref.capa ? propuestaPara(s.pendientes, ref.capa, vista.agente) : null))
  const nombrePerfil = useNombrePerfil(perfilDelNivel(vista.nivel))
  // A qué se aplica la capa, en la línea que en una cuenta ocupa su carpeta: el bloque mide lo mismo en los dos ámbitos.
  const descripcion = vista.nivel.tipo === 'global' ? t.capaGlobalLinea(nombreAgente(vista.agente)) : t.capaPerfilLinea(nombreAgente(vista.agente), nombrePerfil)
  return (
    <div className="contexto-panel">
      <p className="dbc-ayuda">{t.dockerAyuda}</p>
      <Presente visible={propuesta !== null} className="contexto-aviso-propuesta mov-despliega" role="status">
        <span>{t.dockerHayPropuesta}</span>
        {/* La revisión es su propio diálogo: este se cierra para no taparla, con la confirmación si hay cambios. */}
        <button type="button" className="btn btn-ghost" onClick={() => propuesta && ir('cerrar', () => revisarPropuestaConfig(propuesta))}>
          {t.revisarPropuesta}
        </button>
      </Presente>
      <div className="contexto-docker-controles">
        {/* Una cuenta es de un solo agente: cambiar de agente vuelve a todas las cuentas del perfil. */}
        <Segmentado
          etiqueta={t.dockerAgentes}
          opciones={AGENTES_CONFIG.map((a) => ({ valor: a.id, etiqueta: a.nombre }))}
          valor={vista.agente}
          onCambio={(agente) => ir({ ...vista, nivel: nivelDelRiel(vista.nivel), agente })}
        />
        <SelectorAmbito vista={vista} cuentas={cuentas} ir={ir} />
      </div>
      <EditorConfigAgente key={`${claveNivel(vista.nivel)}:${vista.agente}`} nivel={ref} onSinGuardar={alSinGuardar} descripcion={descripcion} />
    </div>
  )
}

function useNombrePerfil(profileId: string | null): string {
  return useStorePestanas((s) => (profileId === null ? '' : (s.tabs.profiles.find((x) => x.id === profileId)?.nombre ?? profileId)))
}

/** Un nivel con reglas y documentos propios: el global o un perfil, con lo vigente y cómo guardarlo. */
interface NivelEditable {
  clave: string
  /** El id de sus propuestas de reglas. */
  idPropuesta: string
  nombre: string
  reglas: string
  documentos: readonly string[]
  guardarReglas: (reglas: string) => Promise<void>
  guardarDocumentos: (documentos: string[]) => Promise<void>
}

function useNivelEditable(nivel: NivelContexto): NivelEditable | null {
  const t = txContexto()
  const global = useStoreContextoGlobal((s) => s.global)
  const profileId = nivel.tipo === 'perfil' ? nivel.profileId : null
  const perfil = useStorePestanas((s) => (profileId === null ? undefined : s.tabs.profiles.find((x) => x.id === profileId)))
  if (nivel.tipo === 'global') {
    return {
      clave: 'global',
      idPropuesta: ID_REGLAS_GLOBALES,
      nombre: t.tituloGlobal,
      reglas: global.reglas,
      documentos: global.documentos,
      guardarReglas: async (reglas) => void (await guardarContextoGlobal({ reglas })),
      guardarDocumentos: async (documentos) => void (await guardarContextoGlobal({ documentos }))
    }
  }
  if (!perfil) return null
  return {
    clave: `perfil:${perfil.id}`,
    idPropuesta: perfil.id,
    nombre: t.tituloPerfil(perfil.nombre),
    reglas: perfil.reglas ?? '',
    documentos: perfil.documentos ?? [],
    guardarReglas: async (reglas) => despacharTabs({ type: 'setProfileReglas', profileId: perfil.id, reglas }),
    guardarDocumentos: async (documentos) => despacharTabs({ type: 'setProfileDocumentos', profileId: perfil.id, documentos })
  }
}

function SeccionReglas({ n, vista, ir, alSinGuardar }: { n: NivelEditable; vista: Vista; ir: Ir; alSinGuardar: (hay: boolean) => void }): React.JSX.Element {
  const hayPropuesta = useStorePropuestasReglas((s) => s.pendientes.has(n.idPropuesta))
  // La revisión es su propio diálogo: este se cierra para no taparla, con la confirmación si hay cambios sin guardar.
  const revisar = (): void => ir('cerrar', () => void revisarPropuesta(n.idPropuesta))
  return (
    <PanelReglas
      key={n.clave}
      nombreNivel={n.nombre}
      vigentes={n.reglas}
      onSinGuardar={alSinGuardar}
      onGuardar={n.guardarReglas}
      onRevisarPropuesta={hayPropuesta ? revisar : undefined}
      onIrADocumentos={() => ir({ ...vista, nivel: nivelDelRiel(vista.nivel), seccion: 'documentos' })}
    />
  )
}

/** Lo que se ve de un nivel global o de perfil en su sección. */
function SeccionNivel(p: { vista: Vista; cuentas: AgentAccount[] | null; ir: Ir; alSinGuardar: (hay: boolean) => void }): React.JSX.Element | null {
  const { vista, ir, alSinGuardar } = p
  const n = useNivelEditable(nivelDelRiel(vista.nivel))
  if (!n) return null
  if (vista.seccion === 'reglas') return <SeccionReglas n={n} vista={vista} ir={ir} alSinGuardar={alSinGuardar} />
  if (vista.seccion === 'documentos') return <PanelDocumentos carpetas={n.documentos} onGuardar={n.guardarDocumentos} />
  if (vista.seccion === 'docker') return <SeccionDocker vista={vista} cuentas={p.cuentas} ir={ir} alSinGuardar={alSinGuardar} />
  return null
}

/**
 * El resumen de un perfil: lo que reciben sus agentes, de solo lectura, en un panel que se abre sobre el lado
 * derecho del detalle. No es una sección porque no se configura nada en ella: se mira el resultado y se vuelve.
 */
function PanelResumen({ profileId, visible, onCerrar }: { profileId: string; visible: boolean; onCerrar: () => void }): React.JSX.Element | null {
  const t = txContexto()
  const idTitulo = useId()
  const global = useStoreContextoGlobal((s) => s.global)
  const perfil = useStorePestanas((s) => s.tabs.profiles.find((x) => x.id === profileId))
  const cerrar = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (visible) cerrar.current?.focus()
  }, [visible])
  if (!perfil) return null
  return (
    // Entra deslizándose desde el borde derecho y sale hacia él (`movimiento.css`).
    <Presente
      visible={visible}
      como="aside"
      className="contexto-resumen mov-aparece mov-desde-derecha"
      aria-labelledby={idTitulo}
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCerrar())}
    >
      <div className="contexto-resumen-cabecera">
        <div id={idTitulo} className="nivel-titulo">
          {t.tituloResumen(perfil.nombre)}
        </div>
        <button ref={cerrar} type="button" className="btn btn-icon" title={t.cerrarResumen} aria-label={t.cerrarResumen} onClick={onCerrar}>
          <IconoCerrar />
        </button>
      </div>
      <div className="contexto-resumen-cuerpo">
        <VistaRecibe perfil={perfil} global={global} />
      </div>
    </Presente>
  )
}

/** La confirmación de dejar cambios sin guardar. */
function Pie(p: { onSeguir: () => void; onDescartar: () => void }): React.JSX.Element {
  const t = txConfigAgente()
  return (
    <PieModal>
      <button type="button" className="btn btn-ghost" onClick={p.onDescartar}>{t.descartar}</button>
      <button type="button" className="btn primary" autoFocus onClick={p.onSeguir}>{t.seguir}</button>
    </PieModal>
  )
}

/** Al responder la confirmación, devuelve el foco a la ✕ si desapareció el botón enfocado. */
function useFocoTrasConfirmar(confirmando: boolean, ref: React.RefObject<HTMLElement>): void {
  const antes = useRef(confirmando)
  useEffect(() => {
    const respondida = antes.current && !confirmando
    antes.current = confirmando
    const tarjeta = ref.current?.closest('.modal-card')
    if (!respondida || !tarjeta || tarjeta.contains(document.activeElement)) return
    tarjeta.querySelector<HTMLButtonElement>('.modal-cerrar')?.focus()
  }, [confirmando, ref])
}

const vistaInicial = (a: ContextoAbierto): Vista => ({
  nivel: a.nivel,
  seccion: seccionInicial(a.nivel, a.seccion),
  agente: a.nivel.tipo === 'cuenta' || a.nivel.tipo === 'equipo' ? a.nivel.agente : 'claude-code'
})

export function ModalContexto({ abierto, onCerrar }: { abierto: ContextoAbierto; onCerrar: () => void }): React.JSX.Element {
  const t = txContexto()
  const { vista, pendiente, seguir, descartar, alSinGuardar, hayCambios, ir } = useNavegacion(vistaInicial(abierto), onCerrar)
  const marco = useRef<HTMLDivElement>(null)
  useFocoTrasConfirmar(pendiente !== null, marco)
  // Las cuentas del perfil a la vista, para el ámbito de su configuración de Docker.
  const cuentas = useCuentasDelPerfil(perfilDelNivel(vista.nivel))
  const elegir = (nivel: NivelContexto): void =>
    ir({ nivel, seccion: seccionInicial(nivel, vista.seccion ?? undefined), agente: nivel.tipo === 'cuenta' || nivel.tipo === 'equipo' ? nivel.agente : vista.agente })
  const conArchivos = vista.nivel.tipo === 'equipo'
  // El resumen es del perfil a la vista: al ir a otro nivel deja de verse solo.
  const perfilVisto = perfilDelNivel(vista.nivel)
  // El perfil del último resumen se conserva al cerrarlo: el panel lo sigue pintando mientras sale.
  const [resumen, setResumen] = useState<{ profileId: string; abierto: boolean } | null>(null)
  return (
    <Modal titulo={t.titulo} ayuda={<BotonAyuda destino={AYUDA.contextoDeLosAgentes} />}
      tamano="xl" className="db-conexion-modal config-agente-modal contexto-modal" cuerpoClassName="contexto-modal-cuerpo"
      onCerrar={() => pendiente !== null ? seguir() : ir('cerrar')} cierraConVelo={!hayCambios && pendiente === null}
      pie={pendiente !== null ? <Cruce clave="confirmando" className="contexto-confirmacion">
        <Pie onSeguir={seguir} onDescartar={descartar} />
      </Cruce> : undefined}>
      {pendiente !== null && <AvisoModal tono="aviso">{txConfigAgente().sinGuardarTitulo}</AvisoModal>}
          <div ref={marco} className="config-agente-marco">
            <RielContexto nivel={vista.nivel} onElegir={elegir} />
            <div className="config-agente-detalle">
              <Cabecera nivel={vista.nivel} onResumen={() => perfilVisto !== null && setResumen({ profileId: perfilVisto, abierto: true })} />
              <Secciones vista={vista} ir={ir} />
              {/* Al cambiar de nivel o de sección, lo nuevo entra con un fundido corto en vez de aparecer de golpe. */}
              <div key={`${claveNivel(vista.nivel)}:${vista.seccion ?? ''}`} className="contexto-vista">
                {conArchivos ? (
                  <EditorConfigAgente key={claveNivel(vista.nivel)} nivel={refConfiguracion(vista.nivel, vista.agente)} onSinGuardar={alSinGuardar} />
                ) : (
                  <SeccionNivel vista={vista} cuentas={cuentas} ir={ir} alSinGuardar={alSinGuardar} />
                )}
              </div>
            </div>
            {resumen !== null && (
              <PanelResumen
                profileId={resumen.profileId}
                visible={resumen.abierto && resumen.profileId === perfilVisto}
                onCerrar={() => setResumen({ ...resumen, abierto: false })}
              />
            )}
          </div>
    </Modal>
  )
}

/**
 * El diálogo abierto, si lo hay, por encima de Configuración, desde donde también se abre y que si no lo taparía. Montada
 * una sola vez en la raíz de la ventana, mantiene al día el contexto global.
 */
export function CapaContexto(): React.JSX.Element | null {
  useEffect(() => iniciarContextoGlobal(), [])
  const abierto = useStoreContextoAbierto((s) => s.abierto)
  if (!abierto) return null
  return (
    <SobreAjustes>
      <ModalContexto abierto={abierto} onCerrar={cerrarContexto} />
    </SobreAjustes>
  )
}
