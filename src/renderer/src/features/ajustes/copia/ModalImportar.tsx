// =============================================================================
// Modal de IMPORTAR la configuración de un archivo ya elegido: la frase (o el aviso si va sin cifrar), lo que trae frente a lo que
// hay aquí como lista de casillas para elegir qué entra y a qué perfil va (`ListaImportar.tsx`), la confirmación si
// algo existente va a sustituirse (`ConfirmarSustitucion.tsx`) y, al importar solo lo
// marcado, el resumen: lo añadido, lo que se saltó y por qué, y lo que conviene revisar porque depende del
// equipo. Cerrar sin importar suelta el archivo en el main. La operación vive en `operacionesCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================
import '../../../comun/formularioModal.css'
import './copia.css'
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import { AvisoConPresencia, AvisoModal, Modal, PieModal } from '../../../comun/Modal'
import type { AbrirResult, ResumenHistorialImportado } from '../../../../../shared/copia-configuracion-ipc'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import { destinosDeSerie, importarCopia, reglasDelArchivo, vistaPrevia, type Descifrado, type ResumenImportacion } from './operacionesCopia'
import {
  alternar,
  haySeleccion,
  seleccionInicial,
  seleccionParaImportar,
  seleccionTodo,
  seleccionTrasCambiarDestino,
  type ArbolImportar,
  type AvisoSeleccion,
  type SeleccionImportar
} from '../../../../../shared/seleccionCopia'
import { sustitucionesElegidas, type ItemSustitucion } from '../../../../../shared/sustitucionesCopia'
import { leerTabs, useStorePestanas } from '../../pestanas'
import { CampoFrase } from './camposCopia'
import { ConfirmarSustitucion } from './ConfirmarSustitucion'
import { ListaImportar } from './ListaImportar'
import { txCopia } from './textosCopia.ts'

type Abierto = Extract<AbrirResult, { estado: 'abierto' }>
type Fase =
  | { tipo: 'frase'; ocupado: boolean }
  | {
      tipo: 'previa'
      d: Descifrado
      /** El perfil de aquí que recibe cada perfil del archivo; null, uno nuevo. */
      destinos: Readonly<Record<string, string | null>>
      /** Los perfiles del archivo cuyas reglas distintas sustituyen a las de su destino. */
      sustituir: ReadonlySet<string>
      /** Los archivos de agentes distintos que sustituyen a los de aquí, por clave del elemento. */
      sustituirArchivos: ReadonlySet<string>
      arbol: ArbolImportar
      seleccion: ReadonlySet<string>
      avisos: AvisoSeleccion[]
      /** Lo que se va a sustituir, mientras se confirma; null, en la lista. */
      confirmar: ItemSustitucion[] | null
    }
  | { tipo: 'importando' }
  | { tipo: 'hecho'; r: ResumenImportacion }
  /** Falló a medias: el archivo ya se soltó en el main, así que no se ofrece reintentar aquí. */
  | { tipo: 'fallo' }


/** El nombre del sistema en que se exportó; uno que esta versión no conoce, tal cual. */
function sistemaDe(p: string): string {
  return p === 'windows' || p === 'mac' || p === 'linux' ? nombresSistema(p).sistema : p
}

function Previa({ p, v, cifrado, token }: { p: Extract<Fase, { tipo: 'previa' }>; v: ReturnType<typeof useImportar>; cifrado: boolean; token: string }): React.JSX.Element {
  const t = txCopia()
  const aqui = useStorePestanas((s) => s.tabs.profiles)
  const invalidos = p.d.archivosAgentes.invalidos
  return (
    <div className="copia-resumen">
      {/* El aviso sigue a la vista mientras se elige: es lo que explica por qué no viene nada marcado. */}
      <AvisoConPresencia>{!cifrado && <AvisoModal tono="aviso">{t.importar.sinCifrarPrevia}</AvisoModal>}</AvisoConPresencia>
      <ListaImportar
        arbol={p.arbol}
        seleccion={p.seleccion}
        avisos={p.avisos}
        aqui={aqui}
        reglasArchivo={reglasDelArchivo(p.d)}
        sustituir={p.sustituir}
        sustituirArchivos={p.sustituirArchivos}
        token={token}
        onAlternar={v.alternarCasilla}
        onMarcarTodo={v.marcarTodo}
        onDestino={v.cambiarDestino}
        onSustituir={v.elegirReglas}
        onSustituirArchivo={v.elegirArchivo}
      />
      <AvisoConPresencia>{p.d.perfilesInvalidos > 0 && <AvisoModal tono="aviso">{t.importar.perfilesInvalidos(p.d.perfilesInvalidos)}</AvisoModal>}</AvisoConPresencia>
      <AvisoConPresencia>{invalidos.length > 0 && <AvisoModal tono="aviso">{t.importar.archivosInvalidos(t.comun.lista(invalidos))}</AvisoModal>}</AvisoConPresencia>
    </div>
  )
}

function Saltadas({ titulo, lista }: { titulo: string; lista: Array<{ alias: string; motivo: string }> }): React.JSX.Element | null {
  if (lista.length === 0) return null
  return (
    <>
      <p className="dbc-ayuda">{titulo}</p>
      <ul className="copia-detalle">
        {lista.map((s, i) => (
          <li key={i}>{txCopia().importar.saltada(s.alias, s.motivo)}</li>
        ))}
      </ul>
    </>
  )
}

/** Lo que pasó con el historial: los recuentos y, aparte, lo conservado, lo que no cambió de ruta y lo saltado. */
function HechoHistorial({ h }: { h: ResumenHistorialImportado }): React.JSX.Element {
  const t = txCopia().importar
  return (
    <div className="copia-resumen" data-testid="copia-historial-hecho">
      <p className="dbc-ayuda">{t.historialHecho(h.importadas, h.actualizadas, h.alDia, h.conservadas.length, h.saltadas.length)}</p>
      {h.rutaCambiada > 0 && <p className="dbc-ayuda">{t.historialRutaCambiada(h.rutaCambiada)}</p>}
      <Saltadas titulo={t.historialConservadas} lista={h.conservadas.map((c) => ({ alias: c.ruta, motivo: c.motivo }))} />
      {h.rutaOriginal.length > 0 && (
        <>
          <p className="dbc-ayuda">{t.historialRutaOriginal}</p>
          <ul className="copia-detalle">
            {h.rutaOriginal.map((c) => (
              <li key={c.carpeta}>{t.historialCarpeta(c.carpeta, c.conversaciones, c.motivo)}</li>
            ))}
          </ul>
        </>
      )}
      <Saltadas titulo={t.historialSaltadas} lista={h.saltadas.map((c) => ({ alias: c.ruta, motivo: c.motivo }))} />
      <AvisoConPresencia>{h.error && <AvisoModal tono="error">{h.error}</AvisoModal>}</AvisoConPresencia>
      <p className="dbc-ayuda">{t.historialSesion}</p>
    </div>
  )
}

function ListaArchivos({ titulo, lista }: { titulo: string; lista: readonly string[] }): React.JSX.Element | null {
  if (lista.length === 0) return null
  return (
    <>
      <p className="dbc-ayuda">{titulo}</p>
      <ul className="copia-detalle">
        {lista.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </>
  )
}

function Hecho({ r }: { r: ResumenImportacion }): React.JSX.Element {
  const { ssh, bd, revisar } = r.conexiones
  const fallidas = r.capas.filter((c) => !c.resultado.ok || c.resultado.faltan.length > 0)
  const t = txCopia().importar
  return (
    <div className="copia-resumen" role="status">
      <AvisoModal tono="exito">{t.importado}</AvisoModal>
      <p className="dbc-ayuda">{t.hecho(r.perfilesNuevos.length, ssh.anadidas, bd.anadidas, r.agentes, r.ajustes)}</p>
      {r.reglas.length > 0 && <p className="dbc-ayuda">{t.reglasHecho(txCopia().comun.lista(r.reglas))}</p>}
      {r.conexiones.configDocker && <p className="dbc-ayuda">{t.configHecho(r.conexiones.configDocker)}</p>}
      {r.conexiones.archivosAgentes && (
        <div data-testid="copia-archivos-hecho">
          <ListaArchivos titulo={t.archivosCreados} lista={r.conexiones.archivosAgentes.creados} />
          <ListaArchivos titulo={t.archivosSustituidos} lista={r.conexiones.archivosAgentes.sustituidos} />
        </div>
      )}
      <Saltadas titulo={t.saltadasSsh} lista={ssh.saltadas} />
      <Saltadas titulo={t.saltadasBd} lista={bd.saltadas} />
      {r.conexiones.historial && <HechoHistorial h={r.conexiones.historial} />}
      {revisar.length > 0 && (
        <ul className="copia-detalle">
          {revisar.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {fallidas.map((c) => (
        <AvisoModal key={c.perfil} tono="error">
          {t.capaFallida(c.perfil, c.resultado.error ?? null)}
        </AvisoModal>
      ))}
    </div>
  )
}

function conClave(s: ReadonlySet<string>, clave: string, si: boolean): Set<string> {
  const nuevo = new Set(s)
  if (si) nuevo.add(clave)
  else nuevo.delete(clave)
  return nuevo
}

function useImportar(a: Abierto) {
  const [frase, setFrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>({ tipo: 'frase', ocupado: false })
  const descifrar = async (): Promise<void> => {
    setError(null)
    setFase({ tipo: 'frase', ocupado: true })
    const d = await window.tessera.copiaConfiguracion.descifrar(a.token, frase)
    if (!d.ok) {
      setError(d.error)
      return setFase({ tipo: 'frase', ocupado: false })
    }
    const destinos = destinosDeSerie(d)
    const arbol = vistaPrevia(d, destinos)
    // Sin cifrar, cualquiera pudo cambiarlo (añadir un agente con sus órdenes, unos ajustes, unas reglas):
    // nada entra marcado de serie y lo que se importa lo elige el usuario de una en una. Sustituir unas
    // reglas nunca viene elegido.
    setFase({ tipo: 'previa', d, destinos, sustituir: new Set(), sustituirArchivos: new Set(), arbol, seleccion: a.cifrado ? seleccionInicial(arbol) : new Set<string>(), avisos: [], confirmar: null })
  }
  const alternarCasilla = (clave: string): void =>
    setFase((f) => {
      if (f.tipo !== 'previa') return f
      const { seleccion, avisos } = alternar(f.arbol, f.seleccion, clave)
      return { ...f, seleccion, avisos }
    })
  const marcarTodo = (todo: boolean): void =>
    setFase((f) => (f.tipo === 'previa' ? { ...f, seleccion: todo ? seleccionTodo(f.arbol) : new Set<string>(), avisos: [] } : f))
  // Otro destino cambia qué ya está (los agentes del perfil que lo recibe) y qué pasa con las reglas.
  const cambiarDestino = (perfil: string, destino: string | null): void =>
    setFase((f) => {
      if (f.tipo !== 'previa') return f
      const destinos = { ...f.destinos, [perfil]: destino }
      const arbol = vistaPrevia(f.d, destinos)
      const sustituir = new Set(f.sustituir)
      sustituir.delete(perfil)
      // Lo de ese perfil se eligió frente a otro destino.
      const delPerfil = new Set(arbol.perfiles.find((g) => g.perfil.id === perfil)?.hijos.map((h) => h.clave))
      const sustituirArchivos = new Set([...f.sustituirArchivos].filter((c) => !delPerfil.has(c)))
      return { ...f, destinos, sustituir, sustituirArchivos, arbol, seleccion: seleccionTrasCambiarDestino(arbol, f.seleccion, perfil, a.cifrado), avisos: [] }
    })
  const elegirReglas = (perfil: string, sustituye: boolean): void =>
    setFase((f) => (f.tipo === 'previa' ? { ...f, sustituir: conClave(f.sustituir, perfil, sustituye) } : f))
  const elegirArchivo = (clave: string, sustituye: boolean): void =>
    setFase((f) => (f.tipo === 'previa' ? { ...f, sustituirArchivos: conClave(f.sustituirArchivos, clave, sustituye) } : f))
  /** Antes de escribir: si algo existente cambia, se confirma; si solo se crea, se importa directamente. */
  const pedirImportar = (f: Extract<Fase, { tipo: 'previa' }>): void => {
    const items = sustitucionesElegidas(f.arbol, f.seleccion, f.sustituir, f.sustituirArchivos)
    if (items.length > 0) setFase({ ...f, confirmar: items })
    else void importar(f.d, seleccionParaImportar(f.arbol, f.seleccion, f.sustituir, f.sustituirArchivos))
  }
  const volverALaLista = (): void => setFase((f) => (f.tipo === 'previa' ? { ...f, confirmar: null } : f))
  const importar = async (d: Descifrado, sel: SeleccionImportar): Promise<void> => {
    setFase({ tipo: 'importando' })
    try {
      setFase({ tipo: 'hecho', r: await importarCopia(a.token, d, sel) })
    } catch (err) {
      // Importar otra vez el mismo archivo completa lo que falte: lo que ya entró no se duplica.
      setError(txCopia().importar.errorFinal(err instanceof Error ? err.message : String(err)))
      setFase({ tipo: 'fallo' })
    }
  }
  return { frase, setFrase, error, fase, descifrar, alternarCasilla, marcarTodo, cambiarDestino, elegirReglas, elegirArchivo, pedirImportar, volverALaLista, importar }
}

/** «Importar» manda solo lo marcado; sin nada marcado no hay nada que importar. */
function BotonImportar({ fase, pedir }: { fase: Extract<Fase, { tipo: 'previa' }>; pedir: (f: Extract<Fase, { tipo: 'previa' }>) => void }): React.JSX.Element {
  const t = txCopia().importar
  const vacia = !haySeleccion(seleccionParaImportar(fase.arbol, fase.seleccion, fase.sustituir, fase.sustituirArchivos))
  return (
    <button type="button" className="btn primary" disabled={vacia} title={vacia ? t.nadaMarcado : undefined} onClick={() => pedir(fase)}>
      {t.importar}
    </button>
  )
}

/** `cifrado`: sin frase, el primer paso no abre con una frase sino que continúa tras el aviso. */
function Acciones({ v, onCerrar, cifrado, formulario }: { v: ReturnType<typeof useImportar>; onCerrar: () => void; cifrado: boolean; formulario: string }): React.JSX.Element {
  const { fase } = v
  const t = txCopia()
  if (fase.tipo === 'hecho' || fase.tipo === 'fallo') return <></>
  const ocupado = fase.tipo === 'importando' || (fase.tipo === 'frase' && fase.ocupado)
  return (
    <>
      <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCerrar}>{t.comun.cancelar}</button>
      {fase.tipo === 'previa' ? (
        <BotonImportar fase={fase} pedir={v.pedirImportar} />
      ) : (
        <button type="submit" form={formulario} className="btn primary" disabled={ocupado}>
          {fase.tipo === 'importando' ? t.importar.importando : ocupado ? t.importar.abriendo : cifrado ? t.importar.abrir : t.importar.continuar}
        </button>
      )}
    </>
  )
}

/** Cuántos importar hay montados: abrir otra copia en el main suelta la que se está importando. */
let montados = 0
const oyentes = new Set<() => void>()
function suscribir(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}
function cambiarMontados(delta: number): void {
  montados += delta
  for (const fn of oyentes) fn()
}

/** ¿Hay un importar abierto (desde Configuración o desde el sistema)? */
export function useHayImportarAbierto(): boolean {
  return useSyncExternalStore(suscribir, () => montados > 0)
}

export function ModalImportar({ abierto, onCerrar }: { abierto: Abierto; onCerrar: () => void }): React.JSX.Element {
  useEffect(() => {
    cambiarMontados(1)
    return () => cambiarMontados(-1)
  }, [])
  const formulario = useId()
  const v = useImportar(abierto)
  const importado = v.fase.tipo === 'importando' || v.fase.tipo === 'hecho' || v.fase.tipo === 'fallo'
  // Cerrar sin importar suelta el archivo descifrado que guarda el main.
  const cerrar = useCallback(() => {
    if (!importado) void window.tessera.copiaConfiguracion.olvidar(abierto.token)
    onCerrar()
  }, [importado, abierto.token, onCerrar])
  const ocupado = v.fase.tipo === 'importando' || (v.fase.tipo === 'frase' && v.fase.ocupado)
  const creado = new Date(abierto.creado)
  const t = txCopia()
  return (
    <>
    <Modal titulo={t.importar.titulo}
      subtitulo={t.importar.cabecera(abierto.nombre, sistemaDe(abierto.plataforma), Number.isNaN(creado.getTime()) ? abierto.creado : creado.toLocaleString(), abierto.app)}
      tamano="m" className="db-conexion-modal copia-modal" onCerrar={cerrar} cerrable={!ocupado} ocupado={ocupado}
      cierraConVelo={v.fase.tipo === 'hecho' || v.fase.tipo === 'fallo'}
      pie={v.fase.tipo !== 'hecho' && v.fase.tipo !== 'fallo' ? <PieModal><Acciones v={v} onCerrar={cerrar} cifrado={abierto.cifrado} formulario={formulario} /></PieModal> : undefined}>
      <form id={formulario} className="copia-formulario" noValidate onSubmit={(e) => { e.preventDefault(); if (v.fase.tipo === 'frase' && !ocupado) void v.descifrar() }}>
            {v.fase.tipo === 'frase' &&
              (abierto.cifrado ? (
                <CampoFrase etiqueta={t.comun.frase} valor={v.frase} onCambio={v.setFrase} autoFocus ayuda={t.importar.fraseAyuda} />
              ) : (
                // Sin frase no hay nada que pedir, pero sí que avisar antes de enseñar lo que trae.
                <AvisoModal tono="aviso">
                  {t.importar.sinCifrar}
                </AvisoModal>
              ))}
            {v.fase.tipo === 'previa' && <Previa p={v.fase} v={v} cifrado={abierto.cifrado} token={abierto.token} />}
            {v.fase.tipo === 'importando' && <p className="dbc-ayuda">{t.importar.progreso}</p>}
            {v.fase.tipo === 'hecho' && <Hecho r={v.fase.r} />}
            <AvisoConPresencia>{v.error && <AvisoModal tono="error">{v.error}</AvisoModal>}</AvisoConPresencia>
      </form>
    </Modal>
    <AvisoSustitucion v={v} />
    </>
  )
}

/** El aviso de lo que se va a sustituir, sobre la lista, solo si hay algo que confirmar. */
function AvisoSustitucion({ v }: { v: ReturnType<typeof useImportar> }): React.JSX.Element | null {
  const f = v.fase
  if (f.tipo !== 'previa' || !f.confirmar) return null
  return (
    <ConfirmarSustitucion
      items={f.confirmar}
      nombrePerfil={(id) => leerTabs().profiles.find((p) => p.id === id)?.nombre ?? id}
      onVolver={v.volverALaLista}
      onSustituir={() => void v.importar(f.d, seleccionParaImportar(f.arbol, f.seleccion, f.sustituir, f.sustituirArchivos))}
    />
  )
}
