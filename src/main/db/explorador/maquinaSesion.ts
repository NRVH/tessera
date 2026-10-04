// =============================================================================
// Máquina de estados de una sesión SQL del explorador (pura): `transicion(estado, evento)`
// devuelve el estado nuevo y los EFECTOS que el gestor ejecuta en su orden. Es la política de
// transacciones entera: no cerrar con cambios sin confirmar, no pasar a Auto dejando un
// COMMIT escondido, solo lectura siempre en Auto, y qué decir al perder una sesión.
// `ClaseSentencia` y `CapacidadesSesion` se importan SOLO como tipo: el test no carga el léxico.
// Decisiones: docs/decisiones/bd/transacciones-maquina-de-estados.md
// =============================================================================

import type {
  DbAvisoSesion,
  DbEstadoTx,
  DbFaseSesion,
  DbResolverTx,
  DbTxModo
} from '../../../shared/db-explorador-ipc.ts'
import type { CapacidadesSesion } from '../../../shared/motores/index.ts'
import type { ClaseSentencia } from '../../../shared/sql/clasificarSql.ts'

export type { ClaseSentencia }

export interface EstadoMaquinaSesion {
  fase: DbFaseSesion
  txModo: DbTxModo
  tx: DbEstadoTx
  /** Ver `CLASES_QUE_CUENTAN`. Vuelve a 0 con `tx = 'ninguna'`. */
  sentenciasEnTx: number
  /** Esquema actual; `null` hasta que la sesión se abre por primera vez. */
  esquema: string | null
  soloLectura: boolean
  /** Epoch ms del último uso: lo mira el barrido de inactividad. */
  ultimoUso: number
  ocupadaDesde?: number
  aviso?: DbAvisoSesion
}

/** Qué hacer tras resolver una transacción pedida con el efecto `tx`. */
export interface TrasTx {
  /** Cambiar a este modo si la transacción quedó en `ninguna`. */
  modo?: DbTxModo
  /** Cerrar la sesión si la transacción quedó en `ninguna`. */
  cerrar?: MotivoCierre
}

export type MotivoCierre = 'usuario' | 'editada' | 'expulsada' | 'conexionBorrada'

export type MotivoRechazo = 'ocupada' | 'txPendiente' | 'txFallida' | 'soloLectura' | 'cerrada'

export type EventoSesion =
  /** Hace falta la sesión. `soloLectura` es el valor ACTUAL de la conexión. */
  | { tipo: 'abrir'; ahora: number; soloLectura: boolean }
  | { tipo: 'abierta'; ahora: number; esquema: string | null }
  | { tipo: 'errorAbrir'; ahora: number }
  | { tipo: 'ejecutar'; ahora: number }
  /**
   * Terminó la operación de `ejecutar`. `tx` es la leída del servidor tras la
   * sentencia (ausente si la sonda falló: se usa la heurística). `esquema` se
   * pasa solo si se volvió a leer (tras clases `sesion`, `plsql`, `rutina`).
   */
  | {
      tipo: 'terminada'
      ahora: number
      clase: ClaseSentencia
      ok: boolean
      tx?: DbEstadoTx
      esquema?: string | null
    }
  /**
   * El servidor mató la sesión (`caida`: murió el proceso de la conexión).
   * `commitEnCamino`: se perdió con una confirmación viajando: con la tx pendiente, el aviso
   * dice que NO se sabe si se aplicó. `porDentro`: es la que un bloque o una rutina de
   * Oracle puede hacer por dentro (`confirmaEnVuelo`), con su texto.
   */
  | { tipo: 'perdida'; ahora: number; caida?: boolean; mensaje?: string; commitEnCamino?: boolean; porDentro?: boolean }
  /**
   * El Stop MATÓ el proceso de la sesión (un motor que no se interrumpe, `procesoPorSesion`).
   * No es una pérdida: sin cambios pendientes se cierra en silencio; con ellos (el gestor no
   * mata así, pero la máquina no se fía), el aviso dice que se revirtió.
   */
  | { tipo: 'detenida'; ahora: number }
  | { tipo: 'inactividad'; ahora: number; umbralMs: number }
  | { tipo: 'cambioModo'; ahora: number; modo: DbTxModo; resolver?: DbResolverTx }
  | { tipo: 'commit'; ahora: number }
  | { tipo: 'rollback'; ahora: number }
  /**
   * Resultado del efecto `tx`: estado REAL leído del servidor y el `tras` recibido.
   * `esquema`: el de la sesión tras resolver (PG: un ROLLBACK deshace el `SET
   * search_path` hecho dentro de la transacción y el gestor vuelve a aplicar el
   * elegido); ausente = no cambia.
   */
  | { tipo: 'txResuelta'; ahora: number; tx: DbEstadoTx; tras?: TrasTx; esquema?: string | null }
  /**
   * El esquema de una sesión SIN operación en curso (`cerrada`, `perdida` o `lista`):
   * la consola eligió uno y la sesión no está abierta (se aplicará al reabrir), o se
   * volvió a aplicar fuera de una sentencia. No cuenta como uso ni toca la tx.
   */
  | { tipo: 'esquema'; ahora: number; esquema: string | null }
  | { tipo: 'cierre'; ahora: number; motivo: MotivoCierre; resolver?: DbResolverTx }

export type EfectoSesion =
  | { tipo: 'abrirSesion' }
  /** Cerrar la sesión en el trabajador (su cierre hace rollback de lo pendiente). */
  | { tipo: 'cerrarSesion' }
  /** Los cursores murieron con la sesión: las rejillas ofrecen "Volver a ejecutar". */
  | { tipo: 'olvidarLectores' }
  /** Ejecutar COMMIT/ROLLBACK y responder con `txResuelta` devolviendo `tras`. */
  | { tipo: 'tx'; accion: DbResolverTx; silencioso: boolean; tras?: TrasTx }
  /** Solo lectura: el servidor dijo que hay tx; se revierte sin cambiar de fase. */
  | { tipo: 'rollbackSilencioso' }
  | { tipo: 'rechazar'; motivo: MotivoRechazo; mensaje: string }
  /** Para la Salida de la consola. */
  | { tipo: 'aviso'; mensaje: string }
  /** Se reabre tras un cierre anómalo: la Salida debe decir qué se perdió. */
  | { tipo: 'avisoReapertura'; aviso: DbAvisoSesion }

export interface Transicion {
  estado: EstadoMaquinaSesion
  efectos: EfectoSesion[]
}

type Evento<T extends EventoSesion['tipo']> = Extract<EventoSesion, { tipo: T }>

// --- Textos --------------------------------------------------------------------

export const MENSAJES = {
  perdidaConTx: 'Sesión perdida; el servidor revirtió la transacción',
  perdidaSinTx: 'Sesión perdida; se reabrirá en la siguiente operación',
  caidaConTx: 'El proceso de la conexión terminó de forma inesperada; el servidor revirtió la transacción',
  caidaSinTx: 'El proceso de la conexión terminó de forma inesperada; se reabrirá en la siguiente operación',
  // Una pérdida con una confirmación en camino: mandan a comprobar en vez de a repetir, como
  // `mensajeFalloCommit` en «Enviar».
  perdidaEnCommit:
    'Sesión perdida con el COMMIT en camino: no se sabe si llegó a aplicarse. Comprueba los datos antes de repetir los cambios',
  caidaEnCommit:
    'El proceso de la conexión terminó con el COMMIT en camino: no se sabe si llegó a aplicarse. Comprueba los datos antes de repetir los cambios',
  perdidaEnAuto:
    'Sesión perdida con la sentencia en camino, que se confirma sola (Auto, o un DDL de Oracle): no se sabe si llegó a aplicarse. Comprueba los datos antes de repetirla',
  caidaEnAuto:
    'El proceso de la conexión terminó con la sentencia en camino, que se confirma sola (Auto, o un DDL de Oracle): no se sabe si llegó a aplicarse. Comprueba los datos antes de repetirla',
  // Un bloque PL/SQL o una rutina de Oracle en Manual, que pueden confirmar POR DENTRO.
  perdidaPorDentro:
    'Sesión perdida con un bloque PL/SQL o una rutina en camino, que pueden confirmar por dentro: no se sabe si se aplicó. Comprueba los datos antes de repetir los cambios',
  caidaPorDentro:
    'El proceso de la conexión terminó con un bloque PL/SQL o una rutina en camino, que pueden confirmar por dentro: no se sabe si se aplicó. Comprueba los datos antes de repetir los cambios',
  inactividad:
    'Sesión cerrada por inactividad; se reabrirá al usarla y se pierden sus ALTER SESSION y SET',
  // El Stop de un motor que no se interrumpe mata el proceso de la consola.
  detenidaConTx:
    'Consulta detenida: para pararla se cerró la sesión de la consola, y la transacción que tenía abierta se revirtió',
  editada: 'La conexión se editó; la sesión se reabrirá con los datos nuevos',
  expulsada: 'Sesión cerrada para dejar sitio a otra (límite de sesiones vivas)',
  commitImplicito: 'El DDL confirmó de forma implícita los cambios pendientes',
  ocupada: 'La sesión está ocupada con otra operación',
  txPendiente: 'Confirma o revierte primero',
  txFallida: 'La transacción falló; solo se puede revertir',
  soloLectura: 'La conexión es de solo lectura',
  cerrada: 'La sesión no está abierta'
} as const

/**
 * Clases que cuentan en `sentenciasEnTx`: las que pueden dejar cambios en la
 * transacción. `consulta` no escribe; `ddl` en Oracle confirma y en PG va dentro
 * de la tx pero el usuario no lo percibe como "cambio pendiente"; `tx`, `sesion`
 * y `cliente` no son trabajo de la transacción.
 */
export const CLASES_QUE_CUENTAN: readonly ClaseSentencia[] = ['dml', 'plsql', 'rutina', 'bloqueo', 'otra']

// --- Construcción ----------------------------------------------------------------

/** Estado de una sesión que aún no se ha abierto. Cada consola nueva nace en Auto. */
export function estadoInicial(opciones: { soloLectura: boolean; ahora: number; txModo?: DbTxModo }): EstadoMaquinaSesion {
  return {
    fase: 'cerrada',
    txModo: opciones.soloLectura ? 'auto' : (opciones.txModo ?? 'auto'),
    tx: 'ninguna',
    sentenciasEnTx: 0,
    esquema: null,
    soloLectura: opciones.soloLectura,
    ultimoUso: opciones.ahora
  }
}

// --- Transición --------------------------------------------------------------------

const SIN_CAMBIO: EfectoSesion[] = []

function igual(estado: EstadoMaquinaSesion): Transicion {
  return { estado, efectos: SIN_CAMBIO }
}

function rechazo(estado: EstadoMaquinaSesion, motivo: MotivoRechazo): Transicion {
  return { estado, efectos: [{ tipo: 'rechazar', motivo, mensaje: MENSAJES[motivo] }] }
}

/** Copia sin las claves opcionales que el cambio deja sin sentido. */
function con(estado: EstadoMaquinaSesion, cambios: Partial<EstadoMaquinaSesion>): EstadoMaquinaSesion {
  const nuevo: EstadoMaquinaSesion = { ...estado, ...cambios }
  if (nuevo.fase !== 'ocupada') delete nuevo.ocupadaDesde
  if (nuevo.tx === 'ninguna') nuevo.sentenciasEnTx = 0
  if (nuevo.aviso === undefined) delete nuevo.aviso
  return nuevo
}

function txViva(tx: DbEstadoTx): boolean {
  return tx === 'pendiente' || tx === 'fallida'
}

/**
 * Respaldo cuando la sonda de la transacción falló: no hay forma de saberlo, así
 * que se conserva lo que había salvo que una sentencia que escribe en Manual deja,
 * como mínimo, cambios pendientes.
 */
export function txHeuristica(estado: EstadoMaquinaSesion, clase: ClaseSentencia, ok: boolean): DbEstadoTx {
  if (estado.soloLectura) return 'ninguna'
  if (estado.txModo === 'manual' && ok && CLASES_QUE_CUENTAN.indexOf(clase) >= 0) return 'pendiente'
  return estado.tx
}

/** Aplica un evento: una función por evento, en el orden de siempre. */
export function transicion(estado: EstadoMaquinaSesion, evento: EventoSesion): Transicion {
  switch (evento.tipo) {
    case 'abrir':
      return alAbrir(estado, evento)
    case 'abierta':
      return alAbrirse(estado, evento)
    case 'errorAbrir':
      return alFallarLaApertura(estado)
    case 'ejecutar':
      return alEjecutar(estado, evento)
    case 'terminada':
      return alTerminar(estado, evento)
    case 'perdida':
      return alPerderse(estado, evento)
    case 'detenida':
      return alDetenerse(estado, evento)
    case 'inactividad':
      return porInactividad(estado, evento)
    case 'cambioModo':
      return alCambiarDeModo(estado, evento)
    case 'commit':
    case 'rollback':
      return alPedirTx(estado, evento)
    case 'esquema':
      return alCambiarDeEsquema(estado, evento)
    case 'txResuelta':
      return alResolverseLaTx(estado, evento)
    case 'cierre':
      return alCerrar(estado, evento)
  }
}

function alAbrir(estado: EstadoMaquinaSesion, evento: Evento<'abrir'>): Transicion {
  if (estado.fase !== 'cerrada' && estado.fase !== 'perdida') return igual(estado)
  const efectos: EfectoSesion[] = [{ tipo: 'abrirSesion' }]
  if (estado.aviso) efectos.push({ tipo: 'avisoReapertura', aviso: estado.aviso })
  return {
    estado: con(estado, {
      fase: 'abriendo',
      soloLectura: evento.soloLectura,
      // Una conexión que pasó a solo lectura no puede seguir en Manual.
      txModo: evento.soloLectura ? 'auto' : estado.txModo,
      tx: 'ninguna',
      ultimoUso: evento.ahora
    }),
    efectos
  }
}

function alAbrirse(estado: EstadoMaquinaSesion, evento: Evento<'abierta'>): Transicion {
  if (estado.fase === 'abriendo') {
    return {
      estado: con(estado, {
        fase: 'lista',
        tx: 'ninguna',
        esquema: evento.esquema,
        ultimoUso: evento.ahora,
        aviso: undefined
      }),
      efectos: SIN_CAMBIO
    }
  }
  // Se cerró (o se perdió) mientras abría: la sesión recién abierta es huérfana.
  if (estado.fase === 'cerrada' || estado.fase === 'perdida') {
    return { estado, efectos: [{ tipo: 'cerrarSesion' }] }
  }
  return igual(estado)
}

function alFallarLaApertura(estado: EstadoMaquinaSesion): Transicion {
  if (estado.fase !== 'abriendo') return igual(estado)
  return { estado: con(estado, { fase: 'cerrada', tx: 'ninguna' }), efectos: SIN_CAMBIO }
}

function alEjecutar(estado: EstadoMaquinaSesion, evento: Evento<'ejecutar'>): Transicion {
  if (estado.fase === 'ocupada' || estado.fase === 'abriendo') return rechazo(estado, 'ocupada')
  if (estado.fase !== 'lista') return rechazo(estado, 'cerrada')
  return {
    estado: con(estado, { fase: 'ocupada', ocupadaDesde: evento.ahora, ultimoUso: evento.ahora }),
    efectos: SIN_CAMBIO
  }
}

function alTerminar(estado: EstadoMaquinaSesion, evento: Evento<'terminada'>): Transicion {
  // Una pérdida o un cierre llegaron antes que la respuesta: manda lo último.
  if (estado.fase !== 'ocupada') return igual(estado)
  const efectos: EfectoSesion[] = []
  let tx = evento.tx ?? txHeuristica(estado, evento.clase, evento.ok)
  if (estado.soloLectura && tx !== 'ninguna') {
    // El candado por sentencia debería impedirlo; si el servidor dice otra
    // cosa, se revierte en vez de enseñar un Commit que no debe existir.
    efectos.push({ tipo: 'rollbackSilencioso' })
    tx = 'ninguna'
  }
  if (estado.tx === 'pendiente' && tx === 'ninguna' && evento.clase === 'ddl' && evento.ok) {
    // Solo pasa en Oracle: el DDL hace COMMIT de lo que hubiera antes.
    efectos.push({ tipo: 'aviso', mensaje: MENSAJES.commitImplicito })
  }
  const base = estado.tx === 'ninguna' ? 0 : estado.sentenciasEnTx
  const suma = evento.ok && CLASES_QUE_CUENTAN.indexOf(evento.clase) >= 0 ? 1 : 0
  const cambios: Partial<EstadoMaquinaSesion> = {
    fase: 'lista',
    tx,
    sentenciasEnTx: tx === 'ninguna' ? 0 : base + suma,
    ultimoUso: evento.ahora
  }
  if (evento.esquema !== undefined) cambios.esquema = evento.esquema
  return { estado: con(estado, cambios), efectos }
}

/** El texto de una pérdida, según si fue caída, si había tx y si una confirmación viajaba. */
function mensajeDePerdida(enDuda: boolean, porDentro: boolean, caida: boolean, txPerdida: boolean): string {
  if (enDuda) {
    if (porDentro) return caida ? MENSAJES.caidaPorDentro : MENSAJES.perdidaPorDentro
    return caida ? MENSAJES.caidaEnCommit : MENSAJES.perdidaEnCommit
  }
  if (caida) return txPerdida ? MENSAJES.caidaConTx : MENSAJES.caidaSinTx
  return txPerdida ? MENSAJES.perdidaConTx : MENSAJES.perdidaSinTx
}

function alPerderse(estado: EstadoMaquinaSesion, evento: Evento<'perdida'>): Transicion {
  if (estado.fase === 'cerrada' || estado.fase === 'perdida') return igual(estado)
  // `fallida` también cuenta: el usuario tenía una transacción que la UI le pedía resolver.
  // Con el COMMIT en camino y cambios pendientes NO se sabe si se aplicó: ni «revertida» ni
  // `txPerdida`. Una `fallida` no entra: su COMMIT es un ROLLBACK y nadie lo manda.
  const enDuda = evento.commitEnCamino === true && estado.tx === 'pendiente'
  const txPerdida = txViva(estado.tx) && !enDuda
  const caida = evento.caida === true
  const mensaje = evento.mensaje ?? mensajeDePerdida(enDuda, evento.porDentro === true, caida, txPerdida)
  return {
    estado: con(estado, {
      fase: 'perdida',
      tx: 'ninguna',
      aviso: { tipo: caida ? 'caida' : 'perdida', txPerdida, mensaje, en: evento.ahora }
    }),
    efectos: [{ tipo: 'olvidarLectores' }]
  }
}

function alDetenerse(estado: EstadoMaquinaSesion, evento: Evento<'detenida'>): Transicion {
  if (estado.fase === 'cerrada' || estado.fase === 'perdida') return igual(estado)
  const txPerdida = txViva(estado.tx)
  const aviso: DbAvisoSesion | undefined = txPerdida
    ? { tipo: 'perdida', txPerdida: true, mensaje: MENSAJES.detenidaConTx, en: evento.ahora }
    : undefined
  return {
    estado: con(estado, { fase: 'cerrada', tx: 'ninguna', sentenciasEnTx: 0, aviso }),
    efectos: [{ tipo: 'olvidarLectores' }]
  }
}

function porInactividad(estado: EstadoMaquinaSesion, evento: Evento<'inactividad'>): Transicion {
  // Solo una sesión ociosa: nunca a mitad de una operación ni abriendo.
  if (estado.fase !== 'lista') return igual(estado)
  // NUNCA con cambios sin confirmar o una transacción fallida sin resolver.
  if (txViva(estado.tx)) return igual(estado)
  if (evento.ahora - estado.ultimoUso < evento.umbralMs) return igual(estado)
  return {
    estado: con(estado, {
      fase: 'cerrada',
      tx: 'ninguna',
      aviso: { tipo: 'inactividad', txPerdida: false, mensaje: MENSAJES.inactividad, en: evento.ahora }
    }),
    // `abierta` (PG: BEGIN sin cambios) se revierte al cerrar, sin pérdida.
    efectos: [{ tipo: 'olvidarLectores' }, { tipo: 'cerrarSesion' }]
  }
}

function alCambiarDeModo(estado: EstadoMaquinaSesion, evento: Evento<'cambioModo'>): Transicion {
  if (evento.modo === estado.txModo) return igual(estado)
  if (evento.modo === 'manual') {
    if (estado.soloLectura) return rechazo(estado, 'soloLectura')
    if (estado.fase === 'ocupada' || estado.fase === 'abriendo') return rechazo(estado, 'ocupada')
    return { estado: con(estado, { txModo: 'manual', ultimoUso: evento.ahora }), efectos: SIN_CAMBIO }
  }
  // Manual -> Auto.
  if (estado.fase === 'ocupada' || estado.fase === 'abriendo') return rechazo(estado, 'ocupada')
  if (estado.tx === 'ninguna') {
    return { estado: con(estado, { txModo: 'auto', ultimoUso: evento.ahora }), efectos: SIN_CAMBIO }
  }
  if (estado.tx === 'abierta') {
    // PG: un BEGIN sin cambios. Cerrarlo con COMMIT no pierde ni confirma nada.
    return pedirTx(estado, evento.ahora, 'commit', true, { modo: 'auto' })
  }
  if (!evento.resolver) return rechazo(estado, 'txPendiente')
  if (evento.resolver === 'commit' && estado.tx === 'fallida') return rechazo(estado, 'txFallida')
  return pedirTx(estado, evento.ahora, evento.resolver, false, { modo: 'auto' })
}

function alPedirTx(estado: EstadoMaquinaSesion, evento: Evento<'commit' | 'rollback'>): Transicion {
  if (estado.soloLectura) return rechazo(estado, 'soloLectura')
  if (estado.fase === 'ocupada' || estado.fase === 'abriendo') return rechazo(estado, 'ocupada')
  if (estado.fase !== 'lista' || estado.tx === 'ninguna') return igual(estado)
  if (evento.tipo === 'commit' && estado.tx === 'fallida') return rechazo(estado, 'txFallida')
  return pedirTx(estado, evento.ahora, evento.tipo, false)
}

function alCambiarDeEsquema(estado: EstadoMaquinaSesion, evento: Evento<'esquema'>): Transicion {
  // Con una operación en curso (o abriendo), el esquema lo trae su final.
  if (estado.fase === 'ocupada' || estado.fase === 'abriendo') return igual(estado)
  if (estado.esquema === evento.esquema) return igual(estado)
  return { estado: con(estado, { esquema: evento.esquema }), efectos: SIN_CAMBIO }
}

function alResolverseLaTx(estado: EstadoMaquinaSesion, evento: Evento<'txResuelta'>): Transicion {
  if (estado.fase !== 'ocupada') return igual(estado)
  const tx = estado.soloLectura ? 'ninguna' : evento.tx
  const cambios: Partial<EstadoMaquinaSesion> = { fase: 'lista', tx, ultimoUso: evento.ahora }
  if (evento.esquema !== undefined) cambios.esquema = evento.esquema
  if (tx === 'ninguna' && evento.tras?.modo) cambios.txModo = evento.tras.modo
  const intermedio = con(estado, cambios)
  if (tx === 'ninguna' && evento.tras?.cerrar) {
    return cerrar(intermedio, evento.ahora, evento.tras.cerrar)
  }
  return { estado: intermedio, efectos: SIN_CAMBIO }
}

function alCerrar(estado: EstadoMaquinaSesion, evento: Evento<'cierre'>): Transicion {
  if (estado.fase === 'ocupada') return rechazo(estado, 'ocupada')
  if (estado.fase === 'lista' && txViva(estado.tx)) {
    if (!evento.resolver) return rechazo(estado, 'txPendiente')
    if (evento.resolver === 'commit') {
      if (estado.tx === 'fallida') return rechazo(estado, 'txFallida')
      // Primero confirmar; si el COMMIT no deja la tx en `ninguna`, no se cierra.
      return pedirTx(estado, evento.ahora, 'commit', false, { cerrar: evento.motivo })
    }
    // Revertir = cerrar: el cierre de la sesión en el trabajador hace rollback.
  }
  return cerrar(estado, evento.ahora, evento.motivo)
}

function pedirTx(
  estado: EstadoMaquinaSesion,
  ahora: number,
  accion: DbResolverTx,
  silencioso: boolean,
  tras?: TrasTx
): Transicion {
  const efecto: EfectoSesion = tras ? { tipo: 'tx', accion, silencioso, tras } : { tipo: 'tx', accion, silencioso }
  return {
    estado: con(estado, { fase: 'ocupada', ocupadaDesde: ahora, ultimoUso: ahora }),
    efectos: [efecto]
  }
}

function cerrar(estado: EstadoMaquinaSesion, ahora: number, motivo: MotivoCierre): Transicion {
  // El cierre que pide el usuario (o el borrado de la conexión) no deja aviso: no
  // hay nada que explicarle. Los que decide Tessera sí.
  let aviso: DbAvisoSesion | undefined
  if (motivo === 'editada') aviso = { tipo: 'editada', txPerdida: false, mensaje: MENSAJES.editada, en: ahora }
  else if (motivo === 'expulsada') {
    aviso = { tipo: 'expulsada', txPerdida: false, mensaje: MENSAJES.expulsada, en: ahora }
  }
  if (estado.fase === 'cerrada' && aviso === undefined && estado.aviso === undefined) return igual(estado)
  // Solo `lista` tiene una sesión viva que cerrar. En `abriendo` aún no la hay:
  // cuando llegue `abierta` se cerrará como huérfana. En `perdida` ya se
  // olvidaron los lectores al perderla.
  const efectos: EfectoSesion[] =
    estado.fase === 'lista' ? [{ tipo: 'olvidarLectores' }, { tipo: 'cerrarSesion' }] : []
  return {
    estado: con(estado, { fase: 'cerrada', tx: 'ninguna', aviso }),
    efectos
  }
}

// --- Utilidades para el gestor y los tests ------------------------------------------

export { aEstadoSesion, invariantesRotas } from './sesiones/estadoMaquina.ts'

/** ¿Tiene algo que el cierre perdería? (el diálogo de salida y la edición lo usan) */
export function tieneTxPendiente(e: EstadoMaquinaSesion): boolean {
  return txViva(e.tx)
}

/**
 * Clases que, en Auto y sin transacción abierta, el servidor CONFIRMA al terminar la
 * propia sentencia (el autocommit de Oracle viaja con el `execute`; PG confirma cada
 * sentencia suelta). `consulta`, `bloqueo` y `sesion` no escriben datos; `tx` se mira
 * aparte por su verbo; `cliente` no se envía.
 */
const CONFIRMAN_EN_AUTO: readonly ClaseSentencia[] = ['dml', 'plsql', 'rutina', 'ddl', 'otra']

/** Qué confirmación lleva en camino una sentencia (`confirmaEnVuelo`). */
export type ConfirmacionEnVuelo = 'commit' | 'implicito' | 'porDentro'

/**
 * La CONFIRMACIÓN que lleva en camino una sentencia de consola, o null (perderla revierte lo
 * pendiente, si hay):
 *   - 'commit': un COMMIT escrito (o el END de PG) con cambios pendientes; o, donde las
 *     rutinas confirman por dentro y en Manual, un bloque PL/SQL con un COMMIT escrito
 *     (`commitEscrito`, calculado por el gestor con la regla compartida con el renderer);
 *   - 'implicito': una escritura en Auto sin transacción abierta, o un DDL en Manual donde el
 *     DDL confirma lo pendiente (`ddlConfirmaImplicito`);
 *   - 'porDentro': en Manual, cualquier OTRO bloque o rutina donde pueden hacer COMMIT sin que
 *     se vea (`rutinasConfirmanPorDentro`), dé igual la tx de antes.
 * `tx` es la de ANTES de la sentencia: un COMMIT sin cambios no confirma nada, y un DML en
 * Auto dentro de un BEGIN escrito a mano (PG) no se confirma solo.
 */
export function confirmaEnVuelo(
  st: { clase: ClaseSentencia; verbo: string; commitEscrito?: boolean },
  manual: boolean,
  motor: Pick<CapacidadesSesion, 'ddlConfirmaImplicito' | 'rutinasConfirmanPorDentro'>,
  tx: DbEstadoTx
): ConfirmacionEnVuelo | null {
  if (st.clase === 'tx') return (st.verbo === 'COMMIT' || st.verbo === 'END') && tx === 'pendiente' ? 'commit' : null
  if (!manual) return tx === 'ninguna' && CONFIRMAN_EN_AUTO.indexOf(st.clase) >= 0 ? 'implicito' : null
  if (st.clase === 'ddl') return motor.ddlConfirmaImplicito ? 'implicito' : null
  if (!motor.rutinasConfirmanPorDentro) return null
  // Un bloque con un COMMIT escrito confirma lo pendiente Y lo que el propio bloque escribió
  // antes de él, así que da igual la tx de antes.
  if (st.clase === 'plsql' && st.commitEscrito === true) return 'commit'
  // Cualquier otro bloque o rutina puede confirmar POR DENTRO sin que se vea. Un DML, una
  // consulta o un ALTER SESSION, no.
  return st.clase === 'plsql' || st.clase === 'rutina' ? 'porDentro' : null
}

/** Lo que `accionEnBloque` decide para una sesión. */
export interface AccionEnBloque {
  /** El evento que se aplica de verdad (`commit` o `rollback`). */
  accion: DbResolverTx
  /** Se pidió `commit` pero la tx estaba `fallida`: se revierte, y hay que decirlo. */
  revertidaPorFallida: boolean
}

/**
 * Qué se ejecuta en una sesión cuando el usuario resolvió VARIAS a la vez (desconectar con
 * «Confirmar», «Confirmar y salir»): `commit` sobre una tx `fallida` pasa a `rollback` y lo
 * marca. El botón Commit de UNA consola no pasa por aquí y sigue rechazando (`txFallida`).
 * Se decide con el estado del MOMENTO de ejecutar (dentro de la cola de la sesión), no con el
 * de cuando se pintó el diálogo.
 */
export function accionEnBloque(e: EstadoMaquinaSesion, pedida: DbResolverTx): AccionEnBloque {
  if (pedida === 'commit' && e.tx === 'fallida') return { accion: 'rollback', revertidaPorFallida: true }
  return { accion: pedida, revertidaPorFallida: false }
}

