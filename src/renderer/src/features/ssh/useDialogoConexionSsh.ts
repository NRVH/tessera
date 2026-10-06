// =============================================================================
// Todo lo que sabe y hace `DialogoConexionSsh`: el borrador (con el secreto de solo escritura), las
// marcas tras intentar guardar, los grupos que se pueden elegir (también el recién creado desde el
// diálogo anidado «Nuevo grupo…»), importar el archivo de clave, guardar (y conectar, si se vino del
// menú), «Probar» (`usePruebaConexionSsh`) y el foco inicial. Devuelve la VISTA que pinta el componente
// y las acciones. `useDialogo` va el PRIMERO: apunta a quién tenía el foco al montar.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useDialogo, type Dialogo } from '../../comun/useDialogo'
import type { SshClaveElegida, SshConexion, SshGrupo } from '../../../../shared/ssh-ipc'
import {
  borradorDesde,
  borradorNuevo,
  camposAMarcar,
  claveElegida,
  conCambio,
  entradaDe,
  hayCambios,
  marcasVisibles,
  trasGuardar,
  type BorradorSsh,
  type CampoSsh
} from './borradorSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import type { ImportacionEnFormulario } from './importacionOpenSsh'
import { compararNombres } from './listaSsh'
import { destinoSecreto, type DestinoSecreto } from './secretoSsh'
import { datosDePerfil, useStoreSsh } from './store'
import { usePruebaConexionSsh, type PruebaSsh } from './usePruebaConexionSsh'

/** Lo que recibe el diálogo. */
export interface OpcionesDialogoConexionSsh {
  perfilId: string
  /** `null` = alta. */
  conexion: SshConexion | null
  /** El grupo con el que nace un alta (la de «Nueva conexión en este grupo…»). */
  grupoInicial: string | null
  /** Abrir con el foco en el selector de grupo («Mover a grupo…»). */
  enfocarGrupo: boolean
  /** Un alta que nace rellena con el único `Host` de un archivo de OpenSSH. */
  importada?: ImportacionEnFormulario
  onCerrar: () => void
}

/** El estado de «Nuevo grupo…»: el diálogo anidado, si está ocupado y el error del main. */
export interface EstadoGrupoNuevo {
  abierto: boolean
  ocupado: boolean
  error: string | null
}

/** La importación del archivo de clave: si está en curso y el error del main (sin rutas). */
export interface EstadoClave {
  importando: boolean
  error: string | null
}

/** Lo que pinta `DialogoConexionSsh`. */
export interface VistaDialogoConexionSsh extends PruebaSsh {
  dialogo: Dialogo
  idTitulo: string
  nombreRadioMetodo: string
  idAyudaMetodo: string
  idAyudaAgentes: string
  borrador: BorradorSsh
  /** Se abrió para editar una conexión (un alta lo sigue siendo aunque «Probar» ya la haya guardado). */
  esEdicion: boolean
  marcados: readonly CampoSsh[]
  /** Los grupos entre los que se elige, por nombre. */
  grupos: readonly SshGrupo[]
  guardando: boolean
  error: string | null
  cambios: boolean
  /** Qué pasará con la contraseña (o la frase) guardada si se guarda ahora. */
  destinoSecreto: DestinoSecreto
  grupoNuevo: EstadoGrupoNuevo
  clave: EstadoClave
  editar: (parcial: Partial<BorradorSsh>) => void
  /** «Elegir…»: el diálogo nativo; el main importa una copia y el borrador se queda con su ficha. */
  elegirClave: () => Promise<void>
  /** Un archivo soltado sobre el campo de la clave. */
  soltarClave: (archivo: File) => Promise<void>
  guardar: () => Promise<void>
  abrirGrupoNuevo: () => void
  cerrarGrupoNuevo: () => void
  crearGrupo: (nombre: string) => Promise<void>
}

/** Lleva el foco a un campo del formulario por su `data-campo`. */
function enfocarCampo(raiz: HTMLElement | null, campo: CampoSsh | 'grupo'): void {
  raiz?.querySelector<HTMLElement>(`[data-campo="${campo}"]`)?.focus()
}

/** Los grupos del perfil más los creados desde este diálogo que aún no llegaron en la lista, por nombre. */
function useGruposElegibles(perfilId: string, creados: readonly SshGrupo[]): readonly SshGrupo[] {
  const delStore = useStoreSsh((s) => datosDePerfil(s, perfilId).grupos)
  return useMemo(() => {
    const conocidos = new Set(delStore.map((g) => g.id))
    return [...delStore, ...creados.filter((g) => !conocidos.has(g.id))].sort((a, b) => compararNombres(a.nombre, b.nombre))
  }, [delStore, creados])
}

type Editar = (parcial: Partial<BorradorSsh>) => void

/** Elegir o soltar el archivo de clave: lo importa el main, y el borrador se queda con la ficha y el nombre. */
function useImportacionClave(
  perfilId: string,
  editar: Editar
): Pick<VistaDialogoConexionSsh, 'clave' | 'elegirClave' | 'soltarClave'> {
  const [clave, setClave] = useState<EstadoClave>({ importando: false, error: null })
  const importar = async (pedir: () => Promise<SshClaveElegida | null>): Promise<void> => {
    if (clave.importando) return
    setClave({ importando: true, error: null })
    try {
      const elegida = await pedir()
      if (elegida !== null) editar({ clave: claveElegida(elegida) })
      setClave({ importando: false, error: null })
    } catch (err) {
      setClave({ importando: false, error: mensajeDeErrorSsh(err) })
    }
  }
  return {
    clave,
    elegirClave: () => importar(() => window.tessera.ssh.elegirClave({ profileId: perfilId })),
    soltarClave: (archivo) => importar(() => window.tessera.ssh.claveSoltada({ profileId: perfilId }, archivo))
  }
}

/** «Nuevo grupo…» desde el formulario: el diálogo anidado, los grupos creados aquí y crear uno, que queda elegido. */
function useGrupoNuevo(
  perfilId: string,
  editar: Editar,
  raiz: { current: HTMLElement | null }
): Pick<VistaDialogoConexionSsh, 'grupos' | 'grupoNuevo' | 'abrirGrupoNuevo' | 'cerrarGrupoNuevo' | 'crearGrupo'> {
  const [grupoNuevo, setGrupoNuevo] = useState<EstadoGrupoNuevo>({ abierto: false, ocupado: false, error: null })
  const [creados, setCreados] = useState<SshGrupo[]>([])
  const grupos = useGruposElegibles(perfilId, creados)
  const crearGrupo = async (nombre: string): Promise<void> => {
    if (grupoNuevo.ocupado) return
    setGrupoNuevo({ abierto: true, ocupado: true, error: null })
    try {
      const g = await window.tessera.ssh.crearGrupo({ profileId: perfilId, nombre })
      setCreados((c) => [...c, g])
      editar({ grupoId: g.id })
      setGrupoNuevo({ abierto: false, ocupado: false, error: null })
      requestAnimationFrame(() => enfocarCampo(raiz.current, 'grupo'))
    } catch (err) {
      setGrupoNuevo({ abierto: true, ocupado: false, error: mensajeDeErrorSsh(err) })
    }
  }
  return {
    grupos,
    grupoNuevo,
    crearGrupo,
    abrirGrupoNuevo: () => setGrupoNuevo({ abierto: true, ocupado: false, error: null }),
    cerrarGrupoNuevo: () => setGrupoNuevo({ abierto: false, ocupado: false, error: null })
  }
}

/** El borrador, lo guardado y el guardado en sí: la puerta común de «Guardar» y de «Probar». Solo estado: sin efectos. */
function useGuardadoSsh(o: OpcionesDialogoConexionSsh) {
  const [original, setOriginal] = useState<BorradorSsh>(() => (o.conexion ? borradorDesde(o.conexion) : borradorNuevo(o.perfilId, o.grupoInicial)))
  // Un alta importada nace rellena pero con el original vacío: cuenta como cambios (el velo no la cierra).
  const [borrador, setBorrador] = useState<BorradorSsh>(() => (o.importada ? { ...original, ...o.importada.prefijo } : original))
  const [guardada, setGuardada] = useState<SshConexion | null>(o.conexion)
  const [intentado, setIntentado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  /** Guarda el borrador; lo guardado pasa a ser el original (con el secreto otra vez «sin cambios»). */
  const guardarBorrador = async (raiz: HTMLElement | null): Promise<SshConexion | null> => {
    setIntentado(true)
    const marcas = camposAMarcar(borrador)
    if (marcas.length > 0) {
      enfocarCampo(raiz, marcas[0])
      return null
    }
    setGuardando(true)
    setError(null)
    const enviado = borrador
    try {
      const entrada = entradaDe(enviado)
      const c = enviado.id === undefined ? await window.tessera.ssh.crear(entrada) : await window.tessera.ssh.editar({ id: enviado.id, input: entrada })
      const b = borradorDesde(c)
      // Lo tecleado mientras volvía el guardado (unas decenas de ms) se conserva: no se pisa con lo guardado.
      setBorrador((actual) => trasGuardar(actual, enviado, b))
      setOriginal(b)
      setGuardada(c)
      setIntentado(false)
      return c
    } catch (err) {
      setError(mensajeDeErrorSsh(err))
      return null
    } finally {
      setGuardando(false)
    }
  }
  return { original, borrador, setBorrador, guardada, intentado, error, setError, guardando, guardarBorrador }
}

/** El estado, los efectos y las acciones del diálogo de una conexión SSH. */
export function useDialogoConexionSsh(o: OpcionesDialogoConexionSsh): VistaDialogoConexionSsh {
  // Solo estado antes de `useDialogo`: su efecto apunta al foco anterior y tiene que ir el primero.
  const g = useGuardadoSsh(o)
  const cambios = hayCambios(g.borrador, g.original)
  const prueba = usePruebaConexionSsh({
    guardadaSinCambios: () => (g.borrador.id !== undefined && !cambios ? g.borrador.id : null),
    // Como el botón principal: con una clave a medio importar no se guarda, o su ficha se perdería.
    guardar: () => (importacion.clave.importando ? Promise.resolve(null) : g.guardarBorrador(dialogo.ref.current)),
    ponerError: g.setError
  })
  const dialogo = useDialogo({ onClose: o.onCerrar, cerrable: !g.guardando })
  const idTitulo = useId()
  const nombreRadioMetodo = useId()
  const idAyudaMetodo = useId()
  const idAyudaAgentes = useId()
  const esEdicion = o.conexion !== null
  // Después de `useDialogo`, que apunta al foco anterior en su efecto: un `autoFocus` nativo lo pisaría.
  const enfoqueInicial = useRef(o.enfocarGrupo ? 'grupo' : 'alias')
  useEffect(() => enfocarCampo(dialogo.ref.current, enfoqueInicial.current as CampoSsh | 'grupo'), [dialogo.ref])

  const editar: Editar = (parcial) => g.setBorrador((b) => conCambio(b, parcial))
  const importacion = useImportacionClave(o.perfilId, editar)
  const grupo = useGrupoNuevo(o.perfilId, editar, dialogo.ref)
  const guardar = async (): Promise<void> => {
    if (g.guardando || importacion.clave.importando) return
    // Lo ya guardado (por «Probar», o una edición sin tocar) no se vuelve a mandar.
    const c = g.borrador.id !== undefined && !cambios ? g.guardada : await g.guardarBorrador(dialogo.ref.current)
    if (c !== null) o.onCerrar()
  }
  return {
    dialogo, idTitulo, nombreRadioMetodo, idAyudaMetodo, idAyudaAgentes, esEdicion, cambios, editar, guardar,
    borrador: g.borrador,
    guardando: g.guardando,
    error: g.error,
    marcados: marcasVisibles(g.borrador, g.intentado),
    destinoSecreto: destinoSecreto(g.borrador, g.original),
    ...importacion,
    ...grupo,
    ...prueba
  }
}
