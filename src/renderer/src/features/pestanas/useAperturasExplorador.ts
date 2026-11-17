// =============================================================================
// useAperturasExplorador: el lado del renderer de «Abrir con Tessera». El main resuelve
// la ruta y la deja en una cola; aquí se recoge (`integracionShell.tomar`) y se ejecuta:
// abrir o activar el proyecto, y después abrir el archivo o revelarlo en el árbol en
// cuanto el proyecto es el que se ve. Depende de los ajustes y las pestañas cargados, del
// perfil activo y del objetivo que se ve; las decisiones puras están en planAperturas.
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { notify } from '../../comun/notificaciones'
import type { AperturaResuelta, MotivoFalloApertura } from '../../../../shared/shell-windows-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { Plataforma } from '../../../../shared/plataforma'
import { peticionTomar, planApertura } from './planAperturas'
import { txPestanas } from './textos.ts'

/** Una apertura recogida que todavía no se ha podido completar del todo. */
interface Pendiente {
  apertura: AperturaResuelta
  /**
   * Perfil donde ya se abrió o activó el proyecto, o `null` si aún no se pudo. Impide
   * abrirlo dos veces al reintentar.
   */
  perfilId: string | null
  /** Cuándo se recogió, para poder rendirse en vez de esperar para siempre. */
  desde: number
}

/**
 * Cuánto se espera a que aparezca un perfil o a que el backend confirme el proyecto
 * antes de rendirse y avisar. Generoso: abrir en frío arranca el escaneo de repos y
 * el candado de orden, y en un disco lento no es instantáneo.
 */
const PACIENCIA_MS = 20_000

/**
 * Por qué no se pudo abrir, a media frase («La ruta …»). Es una función porque
 * `sin-permiso` nombra a quien deniega, que depende del sistema (`nombresSistema`).
 */
function textoFallo(plataforma: Plataforma): Record<MotivoFalloApertura, string> {
  const t = txPestanas().aperturas
  return {
    'no-existe': t.noExiste,
    'sin-permiso': t.sinPermiso(nombresSistema(plataforma).sistema),
    'ruta-invalida': t.rutaInvalida,
    'fuera-de-la-contenedora': t.fuera
  }
}

export interface AperturasExploradorArgs {
  /** ¿Están ya los ajustes cargados? Antes de eso no se toca nada. */
  ajustesCargados: boolean
  /** ¿Se restauraron ya las pestañas? Antes de eso se recoge, pero no se abre nada. */
  pestanasCargadas: boolean
  /** Perfil activo, o null si aún no hay ninguno. */
  perfilActivoId: string | null
  /** Proyectos abiertos ahora mismo, de todos los perfiles. */
  abiertos: readonly { profileId: string; projectHostPath: string }[]
  /** El perfil y el proyecto que se ven (`objetivoVisto`), o null. */
  visto: { perfilId: string; rutaHostProyecto: string } | null
  /** Abre/activa un proyecto de ruta conocida (la acuñó el main). */
  abrirProyectoConocido: (
    perfilId: string,
    proyecto: { projectHostPath: string; name: string },
    opciones?: { agenteDiferido?: boolean }
  ) => void
  /** Quita la marca de agente diferido de un proyecto abierto (no-op si no la lleva). */
  quitarAgenteDiferido: (perfilId: string, rutaHostProyecto: string) => void
  /** Activa un proyecto que ya estaba abierto; con `entrar`, además pasa a su perfil (puede no ser el que se mira). */
  setActiveProject: (perfilId: string, rutaHostProyecto: string, opciones?: { entrar?: boolean }) => void
  /** Abre un archivo en el editor (ruta POSIX relativa a la contenedora). */
  abrirArchivo: (archivo: { ruta: string; nombre: string }) => void
  /** Despliega y hace scroll hasta esa ruta en el árbol de archivos. */
  revelarEnArbol: (rel: string) => void
}

/**
 * Abre o activa el proyecto de una apertura (paso 1; una sola vez por apertura) y
 * devuelve el perfil donde quedó, que puede no ser el activo.
 */
function abrirProyecto(ap: AperturaResuelta, perfilActivo: string, a: AperturasExploradorArgs): string {
  const plan = planApertura(ap, perfilActivo, a.abiertos)
  if (plan.tipo === 'activar') {
    // Abierto como carpeta: aunque naciera para ver un archivo, ahora se quiere el proyecto. Antes
    // de activarlo: no hay ningún instante con él a la vista y aún diferido.
    if (plan.quitarDiferido) a.quitarAgenteDiferido(plan.perfilId, plan.rutaHostProyecto)
    // Entrando también en su perfil (`objetivoConfirmado` sigue al perfil ACTIVO), en la misma
    // acción: entrar por separado despertaba (y arrancaba el agente de) el activo del perfil.
    a.setActiveProject(plan.perfilId, plan.rutaHostProyecto, { entrar: true })
    return plan.perfilId
  }
  // La marca de agente diferido va en la MISMA acción que crea el proyecto: no existe
  // ningún instante con el proyecto abierto y sin ella, en el que su agente arrancaría.
  a.abrirProyectoConocido(plan.perfilId, ap.contenedora, { agenteDiferido: plan.agenteDiferido })
  return plan.perfilId
}

/**
 * Hace avanzar UNA apertura pendiente. Devuelve lo que queda de ella (para reintentar)
 * o null si terminó o se rindió con un aviso.
 */
function avanzarPendiente(p: Pendiente, a: AperturasExploradorArgs, ahora: number): Pendiente | null {
  const vencida = ahora - p.desde > PACIENCIA_MS
  const ap = p.apertura
  let perfil = p.perfilId
  if (perfil === null) {
    // Sin las pestañas restauradas no se sabe qué está abierto: decidir ahora podría
    // abrir como nuevo un proyecto que va a restaurarse.
    const activo = a.pestanasCargadas ? a.perfilActivoId : null
    if (activo === null) {
      if (!vencida) return p
      notify(
        'warn',
        txPestanas().aperturas.noSePudoAbrir(ap.contenedora.name),
        a.pestanasCargadas ? txPestanas().aperturas.sinPerfil : txPestanas().aperturas.sinCargar
      )
      return null
    }
    perfil = abrirProyecto(ap, activo, a)
  }

  // Una carpeta que ERA la contenedora se abre y punto, sin esperar a ninguna confirmación.
  if (ap.archivo === null && ap.revelar === null) return null

  // El editor y el árbol son los del proyecto que se ve, y piden al main con su proyecto: basta
  // con que el destino sea el que se ve. Antes, `abrirPestanaEditor` abriría en el anterior.
  const destino = ap.contenedora.projectHostPath
  const listo =
    a.visto !== null &&
    a.visto.perfilId === perfil &&
    a.visto.rutaHostProyecto.toLowerCase() === destino.toLowerCase()
  if (!listo) {
    if (!vencida) return { ...p, perfilId: perfil }
    notify(
      'warn',
      txPestanas().aperturas.tardoDemasiado(ap.contenedora.name),
      txPestanas().aperturas.tardoDetalle
    )
    return null
  }

  // En el MISMO turno que la confirmación: así la pestaña del archivo llega antes de que se
  // pinte nada, y la columna de un proyecto con el agente diferido no asoma un instante.
  if (ap.archivo !== null) a.abrirArchivo(ap.archivo)
  if (ap.revelar !== null) a.revelarEnArbol(ap.revelar)
  return null
}

/**
 * Devuelve `procesar`: hace avanzar todo lo pendiente hasta donde se pueda y descarta
 * con un aviso lo que lleve demasiado atascado. Idempotente. Arma el temporizador de
 * respaldo (ver el ADR) y lo limpia al desmontar.
 */
function useProcesarPendientes(
  ref: MutableRefObject<AperturasExploradorArgs>,
  pendientes: MutableRefObject<Pendiente[]>
): () => void {
  /** Temporizador de respaldo, o null. */
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const procesar = useCallback(() => {
    const a = ref.current
    if (pendientes.current.length === 0) return
    const ahora = Date.now()
    const quedan: Pendiente[] = []
    for (const p of pendientes.current) {
      const resto = avanzarPendiente(p, a, ahora)
      if (resto !== null) quedan.push(resto)
    }
    pendientes.current = quedan
    // El respaldo se arma aquí y no en un efecto: lo que AÑADE pendientes es `recoger`,
    // que llama a `procesar` sin cambiar las deps de ningún efecto. Apunta al
    // vencimiento del MÁS VIEJO, que es el primero que puede caducar.
    if (temporizador.current !== null) clearTimeout(temporizador.current)
    temporizador.current = null
    if (quedan.length > 0) {
      const masViejo = Math.min(...quedan.map((p) => p.desde))
      const espera = Math.max(250, masViejo + PACIENCIA_MS + 500 - ahora)
      temporizador.current = setTimeout(() => {
        temporizador.current = null
        procesarRef.current()
      }, espera)
    }
  }, [ref, pendientes])
  // El temporizador se llama a sí mismo por ref: la recursión es intencionada y sobrevive
  // a cualquier cambio futuro de memoización.
  const procesarRef = useRef(procesar)
  procesarRef.current = procesar

  // Al desmontar no puede quedar un temporizador vivo apuntando a un componente muerto.
  useEffect(
    () => () => {
      if (temporizador.current !== null) clearTimeout(temporizador.current)
    },
    []
  )
  return procesar
}

/**
 * Devuelve `recoger`: vacía la cola del main y deja el trabajo listo para `procesar`.
 * Una recogida en vuelo no se solapa con otra (`tomar` VACÍA la cola): un aviso que
 * llegue entretanto se anota y se repite al terminar, para no perder aperturas.
 */
function useRecogerAperturas(
  ref: MutableRefObject<AperturasExploradorArgs>,
  pendientes: MutableRefObject<Pendiente[]>,
  procesar: () => void
): () => Promise<void> {
  /** Hay una recogida en vuelo (`tomar` es asíncrono). */
  const enMarcha = useRef(false)
  /** Llegó un aviso mientras había una recogida en vuelo: hay que repetirla al acabar. */
  const otraVez = useRef(false)

  const recoger = useCallback(async () => {
    const peticion = peticionTomar(ref.current)
    if (peticion === null) return
    if (enMarcha.current) {
      otraVez.current = true
      return
    }
    enMarcha.current = true
    try {
      const resultados = await window.tessera.integracionShell.tomar(peticion)
      for (const r of resultados) {
        if (!r.ok) {
          notify(
            'warn',
            txPestanas().aperturas.noSePudoAbrir(r.nombre),
            txPestanas().aperturas.laRuta(textoFallo(window.tessera.plataforma)[r.motivo])
          )
          continue
        }
        pendientes.current.push({ apertura: r.apertura, perfilId: null, desde: Date.now() })
      }
      procesar()
    } catch (err) {
      // «del gestor de archivos», no «del Explorador»: la cola la llenan el Explorador
      // de Windows y el Finder, y así este archivo no necesita exención en el guardián
      // de nombres de sistema.
      console.error('[shell] no se pudieron recoger las aperturas del gestor de archivos:', err)
    } finally {
      enMarcha.current = false
      if (otraVez.current) {
        otraVez.current = false
        void recoger()
      }
    }
  }, [ref, pendientes, procesar])
  return recoger
}

/** Recoge y ejecuta las aperturas de «Abrir con Tessera» en cuanto se puede. */
export function useAperturasExplorador(args: AperturasExploradorArgs): void {
  // Solo se desestructura lo que gobierna CUÁNDO corren los efectos; lo demás se lee por
  // ref, porque meterlo en las deps volvería a suscribir el canal en cada render.
  const { ajustesCargados, pestanasCargadas, perfilActivoId, visto } = args
  const ref = useRef(args)
  ref.current = args

  const pendientes = useRef<Pendiente[]>([])
  const procesar = useProcesarPendientes(ref, pendientes)
  const recoger = useRecogerAperturas(ref, pendientes, procesar)

  // Suscripción al empujón del main + una recogida inicial en cuanto se puede: la
  // recogida inicial atiende el ARRANQUE EN FRÍO, donde la ruta ya estaba en la cola.
  useEffect(() => {
    if (!ajustesCargados) return
    void recoger()
    return window.tessera.integracionShell.alHaberAperturas(() => void recoger())
  }, [ajustesCargados, recoger])

  // Lo pendiente avanza en cuanto el proyecto es el que se ve, aparece un perfil o terminan de
  // cargarse las pestañas. De LAYOUT: el archivo se abre antes de pintar el commit en que su
  // proyecto pasa a verse, así no se pinta un fotograma con la columna sin él.
  useLayoutEffect(() => {
    procesar()
  }, [visto, perfilActivoId, pestanasCargadas, procesar])
}
