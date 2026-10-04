#!/usr/bin/env node
// =============================================================================
// Prueba de lo que el árbol de BD hace con sus filas (npm run test:db-arbol-filas): errores
// del IPC, punto de sesión y diálogo de transacciones, tooltips y contraseña, orden optimista,
// cargas y acción de error, copiar, navegación, textos de confirmación, popover de esquemas,
// conexiones ajenas (un solo criterio en todas las superficies), registro con formato ajeno y
// nivel «Bases».
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import {
  ETIQUETA_CARPETA,
  ETIQUETA_PARTE,
  accionDeError,
  aliasParaConfirmar,
  aplicarOrden,
  avisoSecreto,
  cargaDeFila,
  conexionDeFila,
  contarCoincidencias,
  destinoConexion,
  esNavegable,
  estadoSesionConexion,
  filtrarEsquemas,
  listaNatural,
  mensajeDeError,
  mismaConfigEsquemas,
  motivoSoloRevertir,
  avisoRevertidas,
  opcionesTxArbol,
  nombreCualificadoDeFila,
  nombreDeFila,
  nombresDeRefs,
  ordenarEsquemasPopover,
  primeraCoincidencia,
  saltoNavegable,
  sesionesConCambios,
  sesionesConTx,
  siguienteNavegable,
  soloSePuedeRevertir,
  textoEliminarConexion,
  tieneSesiones,
  tooltipConexion,
  TEXTO_AJENA,
  TEXTO_AJENA_FORMA,
  PISTA_SOLO_AJENAS,
  TITULO_SOLO_AJENAS,
  textoAjena,
  causaAjena,
  explicacionAjena,
  filaMontajeAjena,
  textoVacioMontaje,
  MOTIVO_FORMATO_AJENO,
  NOTA_FORMATO_AJENO,
  NOTA_MONTAJE_FORMATO_AJENO,
  TITULO_FORMATO_AJENO,
  motivosCabeceraArbol,
  accionDesconectarCabecera,
  MOTIVO_DESCONECTAR_SIN_SELECCION,
  vacioAreaSinConexiones,
  vistaPopoverMontaje,
  accionTeclaArbol,
  accionesDeAjena,
  borradoDeFila,
  componerFilasArbol,
  esContenedorArbol,
  motorAjeno,
  textoEliminarAjena,
  tooltipAjena,
  ajenasMontadasPopover,
  objetoInterno,
  textoSubtipo,
  baseDeFila,
  type FilaAjena,
  type FilaArbol
} from './filasArbolBd.ts'
import {
  aplanarArbolBd,
  claveBd,
  conexionDeClave,
  consolaDeClave,
  type FilaBd,
  type FilaPlaceholder
} from './arbolBd.ts'
import { IDS_MOTORES, IDS_MOTORES_SQL, descriptor, descriptorSql } from '../../../../shared/motores/index.ts'
import type {
  DbConsolaInfo,
  DbEsquema,
  DbEsquemasRespuesta,
  DbEstadoSesion,
  DbObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

// --- Datos --------------------------------------------------------------------------

function conexion(id: string, parcial: Partial<DbConnection> = {}): DbConnection {
  return {
    id,
    profileId: 'P',
    alias: `ALIAS-${id}`,
    motor: 'oracle',
    host: '10.0.0.1',
    port: 1521,
    database: 'ORCL',
    user: 'scott',
    tieneSecreto: true,
    readonly: true,
    ...parcial
  }
}

function sesion(conexionId: string, fase: DbEstadoSesion['fase'], tx: DbEstadoSesion['tx'] = 'ninguna', consolaId?: string): DbEstadoSesion {
  return {
    ref: consolaId ? { rol: 'consola', perfilId: 'P', consolaId } : { rol: 'meta', conexionId },
    conexionId,
    fase,
    txModo: 'auto',
    tx,
    sentenciasEnTx: 0,
    esquema: null,
    soloLectura: true
  }
}

const consolas: DbConsolaInfo[] = [
  { id: 'k1', perfilId: 'P', conexionId: 'C1', nombre: 'consola_1', rutaRelativa: 'consolas/consola_1.sql', modificadaEn: 0, bytes: 0 },
  { id: 'k2', perfilId: 'P', conexionId: 'C1', nombre: 'ventas', rutaRelativa: 'consolas/ventas.sql', modificadaEn: 0, bytes: 0 }
]

const RESP: DbEsquemasRespuesta = {
  esquemas: [
    { nombre: 'HR', sistema: false, visible: true, porDefecto: true },
    { nombre: 'SYS', sistema: true, visible: false, porDefecto: false },
    { nombre: 'PUBLIC', sistema: false, visible: false, porDefecto: false, pseudo: true },
    { nombre: 'VENTAS', sistema: false, visible: false, porDefecto: false }
  ],
  porDefecto: 'HR',
  config: { modo: 'todos' },
  nVisibles: 4
}

const OBJS: DbObjeto[] = [
  { esquema: 'HR', nombre: 'EMP', tipo: 'tabla' },
  { esquema: 'HR', nombre: 'emp_min', tipo: 'tabla' }
]

/** Un árbol con conexión, consolas, esquema, carpeta y un objeto desplegado sin detalle. */
function filasDemo(filtro = ''): FilaBd[] {
  const C1 = conexion('C1', { esquemas: { modo: 'lista', porDefecto: true, esquemas: [] } })
  const kc = claveBd.conexion('C1')
  const ke = claveBd.esquema('C1', 'HR')
  const kt = claveBd.carpeta('C1', 'HR', 'tabla')
  const ko = claveBd.objeto('C1', 'HR', 'tabla', 'EMP')
  return aplanarArbolBd({
    conexiones: [C1],
    consolas,
    esquemas: new Map([[kc, RESP]]),
    conteos: new Map([[ke, { tabla: 2, vista: 0 }]]),
    objetos: new Map([[kt, OBJS]]),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([kc, claveBd.consolas('C1'), ke, kt, ko]),
    filtro
  })
}

// ---------------------------------------------------------------------------------
hr('(1) mensajeDeError')
check(
  'quita el prefijo de Electron',
  mensajeDeError(new Error("Error invoking remote method 'db:update': Error: Confirma o revierte primero")) ===
    'Confirma o revierte primero',
  mensajeDeError(new Error("Error invoking remote method 'db:update': Error: Confirma o revierte primero"))
)
check('texto suelto', mensajeDeError('boom') === 'boom', mensajeDeError('boom'))

// ---------------------------------------------------------------------------------
hr('(2) sesiones')
check('sin sesiones: null', estadoSesionConexion([], 'C1') === null, 'null')
check('lista: conectada', estadoSesionConexion([sesion('C1', 'lista')], 'C1') === 'conectada', 'conectada')
check('ocupada: conectada', estadoSesionConexion([sesion('C1', 'ocupada')], 'C1') === 'conectada', 'conectada')
check('abriendo: conectando', estadoSesionConexion([sesion('C1', 'abriendo')], 'C1') === 'conectando', 'conectando')
check('perdida sola: caída', estadoSesionConexion([sesion('C1', 'perdida')], 'C1') === 'caida', 'caida')
check(
  'perdida + viva: conectada (una consola caída no es la conexión caída)',
  estadoSesionConexion([sesion('C1', 'perdida', 'ninguna', 'k1'), sesion('C1', 'lista')], 'C1') === 'conectada',
  'conectada'
)
check('otra conexión no cuenta', estadoSesionConexion([sesion('C2', 'lista')], 'C1') === null, 'null')
check('cerrada: nada', estadoSesionConexion([sesion('C1', 'cerrada')], 'C1') === null, 'null')
check('tieneSesiones: perdida cuenta', tieneSesiones([sesion('C1', 'perdida')], 'C1'), 'true')
check('tieneSesiones: cerrada no', !tieneSesiones([sesion('C1', 'cerrada')], 'C1'), 'false')
const conTx = [sesion('C1', 'lista', 'abierta', 'k1'), sesion('C1', 'lista', 'pendiente', 'k2'), sesion('C1', 'lista')]
check('sesionesConTx incluye abierta', sesionesConTx(conTx, 'C1').length === 2, `${sesionesConTx(conTx, 'C1').length}`)
check('sesionesConCambios excluye abierta (solo leyó)', sesionesConCambios(conTx, 'C1').length === 1, `${sesionesConCambios(conTx, 'C1').length}`)

// ---------------------------------------------------------------------------------
hr('(3) nombresDeRefs')
{
  const n = nombresDeRefs(
    [
      { rol: 'consola', perfilId: 'P', consolaId: 'k2' },
      { rol: 'consola', perfilId: 'P', consolaId: 'k2' },
      { rol: 'consola', perfilId: 'P', consolaId: 'zz' },
      { rol: 'datos', conexionId: 'C1' }
    ],
    consolas
  )
  check('consola por nombre, sin repetidos, internas por rol', j(n) === j(['ventas', 'una consola', 'las pestañas de datos']), j(n))
}

// ---------------------------------------------------------------------------------
hr('(3b) soloSePuedeRevertir: el diálogo del árbol sin «Confirmar»')
{
  const k1 = { rol: 'consola' as const, perfilId: 'P', consolaId: 'k1' }
  const k2 = { rol: 'consola' as const, perfilId: 'P', consolaId: 'k2' }
  const fallidas = [sesion('C1', 'lista', 'fallida', 'k1'), sesion('C1', 'lista', 'fallida', 'k2')]
  check('todas fallidas: solo revertir', soloSePuedeRevertir([k1, k2], fallidas), 'k1+k2 fallidas')
  check('una sola, fallida: solo revertir', soloSePuedeRevertir([k1], fallidas), 'k1 fallida')
  // Mitades negativas: con una que SÍ se puede confirmar, Confirmar se queda.
  const mezcla = [sesion('C1', 'lista', 'fallida', 'k1'), sesion('C1', 'lista', 'pendiente', 'k2')]
  check('NO: una fallida y una pendiente', !soloSePuedeRevertir([k1, k2], mezcla), 'k1 fallida, k2 pendiente')
  check('NO: sin refs', !soloSePuedeRevertir([], fallidas), '[]')
  // Una ref sin sesión conocida (la lista va un evento por detrás) no se supone fallida.
  check('NO: ref sin sesión conocida', !soloSePuedeRevertir([k1, { ...k2, consolaId: 'k9' }], fallidas), 'k9 desconocida')
  check('NO: misma consola de OTRO perfil', !soloSePuedeRevertir([{ ...k1, perfilId: 'Q' }], fallidas), 'perfil Q')
  const datosFallida: DbEstadoSesion = { ...sesion('C1', 'lista', 'fallida'), ref: { rol: 'datos', conexionId: 'C1' } }
  check('sesión interna por rol y conexión', soloSePuedeRevertir([{ rol: 'datos', conexionId: 'C1' }], [datosFallida]), 'datos C1')
  check('NO: la de datos de otra conexión', !soloSePuedeRevertir([{ rol: 'datos', conexionId: 'C2' }], [datosFallida]), 'datos C2')
  check('motivo en singular', motivoSoloRevertir(1) === 'La transacción falló: solo se puede revertir.', motivoSoloRevertir(1))
  check('motivo con el número', motivoSoloRevertir(2).startsWith('Las 2 transacciones fallaron'), motivoSoloRevertir(2))
}

hr('(3c) opcionesTxArbol: los botones del diálogo por las tres mitades')
{
  const k = (id: string) => ({ rol: 'consola' as const, perfilId: 'P', consolaId: id })
  // (a) NINGUNA fallida: Confirmar a secas, sin nota.
  const pendientes = [sesion('C1', 'lista', 'pendiente', 'k1'), sesion('C1', 'lista', 'pendiente', 'k2')]
  const o1 = opcionesTxArbol([k('k1'), k('k2')], pendientes, true)
  check('ninguna fallida: «Confirmar todas» sin nota', o1.confirmar === 'Confirmar todas' && o1.revertir === 'Revertir todas' && o1.nota === null, j(o1))
  const o1b = opcionesTxArbol([k('k1')], pendientes, false)
  check('ninguna fallida, una sola: «Confirmar» / «Revertir»', o1b.confirmar === 'Confirmar' && o1b.revertir === 'Revertir' && o1b.nota === null, j(o1b))
  // El plural va por el NÚMERO: desconectar (varias) con una sola sesión pendiente.
  const o1c = opcionesTxArbol([k('k1')], pendientes, true)
  check('desconectar con UNA sesión: singular aunque sea «varias»', o1c.confirmar === 'Confirmar' && o1c.revertir === 'Revertir', j(o1c))
  const o1d = opcionesTxArbol([], pendientes, true)
  check('sin lista del main: el plural lo decide «varias»', o1d.confirmar === 'Confirmar todas' && o1d.nota === null, j(o1d))

  // (b) MEZCLA: el botón dice qué pasa con las fallidas y la nota cuántas.
  const mezcla1 = [sesion('C1', 'lista', 'fallida', 'k1'), sesion('C1', 'lista', 'pendiente', 'k2'), sesion('C1', 'lista', 'pendiente', 'k3')]
  const o2 = opcionesTxArbol([k('k1'), k('k2'), k('k3')], mezcla1, true)
  check('mezcla con una fallida: el botón lo dice en singular', o2.confirmar === 'Confirmar (la fallida se revierte)', j(o2))
  check('…y la nota cuenta 1 de 3', o2.nota !== null && o2.nota.startsWith('1 de las 3 transacciones falló y se revertirá'), j(o2.nota))
  check('…y Revertir sigue', o2.revertir === 'Revertir todas', o2.revertir)
  const mezcla2 = [sesion('C1', 'lista', 'fallida', 'k1'), sesion('C1', 'lista', 'fallida', 'k2'), sesion('C1', 'lista', 'pendiente', 'k3')]
  const o3 = opcionesTxArbol([k('k1'), k('k2'), k('k3')], mezcla2, true)
  check('mezcla con dos fallidas: en plural', o3.confirmar === 'Confirmar (las fallidas se revierten)', j(o3))
  check('…y la nota cuenta 2 de 3', o3.nota !== null && o3.nota.startsWith('2 de las 3 transacciones fallaron y se revertirán'), j(o3.nota))
  // Una ref sin sesión conocida cuenta como confirmable (la lista puede ir detrás).
  const o4 = opcionesTxArbol([k('k1'), k('k9')], [sesion('C1', 'lista', 'fallida', 'k1')], true)
  check('fallida + ref desconocida: mezcla, no «solo revertir»', o4.confirmar === 'Confirmar (la fallida se revierte)' && o4.nota !== null, j(o4))

  // (c) TODAS fallidas: sin Confirmar, con el porqué.
  const todas = [sesion('C1', 'lista', 'fallida', 'k1'), sesion('C1', 'lista', 'fallida', 'k2')]
  const o5 = opcionesTxArbol([k('k1'), k('k2')], todas, true)
  check('todas fallidas: sin Confirmar', o5.confirmar === null, j(o5))
  check('…con el motivo por el número', o5.nota === motivoSoloRevertir(2), j(o5.nota))
  const o6 = opcionesTxArbol([k('k1')], todas, false)
  check('una sola y fallida: sin Confirmar, motivo en singular', o6.confirmar === null && o6.nota === motivoSoloRevertir(1) && o6.revertir === 'Revertir', j(o6))
  // Mitades negativas: ni la nota de mezcla sin fallidas, ni Confirmar con todas fallidas.
  check('NO: sin fallidas no hay nota de mezcla', o1.nota === null && o1b.nota === null, 'null')
  check('NO: con todas fallidas no se ofrece ningún Confirmar', o5.confirmar === null && o6.confirmar === null, 'null')
}

hr('(3d) avisoRevertidas: lo que se revirtió al confirmar en bloque')
{
  const k = (id: string) => ({ rol: 'consola' as const, perfilId: 'P', consolaId: id })
  check('NO: nada revertido, nada que avisar', avisoRevertidas('QA', [], consolas) === null, 'null')
  const una = avisoRevertidas('QA', [k('k2')], consolas)
  check('una: la nombra', una === 'QA: se confirmó lo pendiente y se revirtió la transacción fallida (ventas).', j(una))
  const dos = avisoRevertidas('QA', [k('k1'), { rol: 'datos', conexionId: 'C1' }], consolas)
  check('dos: cuenta y nombra (las internas por su papel)', dos !== null && dos.includes('las 2 transacciones fallidas') && dos.includes('consola_1, las pestañas de datos'), j(dos))
}

// ---------------------------------------------------------------------------------
hr('(4) destino, tooltip y aviso de contraseña')
check('con base', destinoConexion(conexion('C1')) === 'scott@10.0.0.1:1521/ORCL', destinoConexion(conexion('C1')))
check(
  'con SID',
  destinoConexion(conexion('C1', { database: undefined, sid: 'XE' })) === 'scott@10.0.0.1:1521 (SID XE)',
  destinoConexion(conexion('C1', { database: undefined, sid: 'XE' }))
)
check(
  'sin base ni SID: solo usuario, host y puerto',
  destinoConexion(conexion('C1', { database: undefined })) === 'scott@10.0.0.1:1521',
  destinoConexion(conexion('C1', { database: undefined }))
)
check(
  'con base Y SID: gana la base',
  destinoConexion(conexion('C1', { sid: 'XE' })) === 'scott@10.0.0.1:1521/ORCL',
  destinoConexion(conexion('C1', { sid: 'XE' }))
)
{
  // La expresión de referencia del destino de un motor de red: el del descriptor tiene que
  // ser el mismo, al byte, en toda la rejilla.
  const aMano = (c: DbConnection): string => {
    const base = `${c.user}@${c.host}:${c.port}`
    if (c.database) return `${base}/${c.database}`
    if (c.sid) return `${base} (SID ${c.sid})`
    return base
  }
  const distintos: string[] = []
  let casos = 0
  const vacioONulo = [undefined, '', null as unknown as string]
  // La referencia es la de los motores de RED; uno de ARCHIVO enseña el nombre de su archivo
  // (abajo), y SQL Server el suyo, con instancia y sin SID (lo fija test-motores de shared).
  for (const motor of IDS_MOTORES.filter((m) => !descriptor(m).conexion.deArchivo && descriptor(m).conexion.opcionales.length === 0))
    for (const database of [...vacioONulo, 'ORCL', 'mi base'])
      for (const sid of [...vacioONulo, 'XE'])
        for (const host of ['10.0.0.1', 'srv-bd', ''])
          for (const port of [1521, 5432, 0])
            for (const user of ['scott', '']) {
              casos++
              const c = conexion('C1', { motor, database, sid, host, port, user })
              if (destinoConexion(c) !== aMano(c)) distintos.push(`${j(c)}: ${destinoConexion(c)} vs ${aMano(c)}`)
            }
  check(`destino: el del descriptor es el de siempre (${casos} casos)`, distintos.length === 0, distintos.slice(0, 2).join(' | ') || 'igual en todos')
  for (const motor of IDS_MOTORES.filter((m) => descriptor(m).conexion.deArchivo)) {
    const c = { ...conexion('C1', { motor, host: '10.0.0.1', port: 1521, user: 'scott' }), archivoVisible: 'inventario.db' }
    check(`destino de ${motor}: el nombre del archivo, sin usuario ni host`, destinoConexion(c) === 'inventario.db', destinoConexion(c))
  }
  const pg = tooltipConexion(conexion('C2', { motor: 'postgres', port: 5432, database: 'app', user: 'u' }))
  check('tooltip de PostgreSQL: su nombre y su destino', pg.split('\n')[1] === 'PostgreSQL · u@10.0.0.1:5432/app', pg.split('\n')[1])
}
{
  const t = tooltipConexion(conexion('C1', { notas: 'x'.repeat(700) }))
  check('tooltip: motor y destino', t.indexOf('Oracle · scott@10.0.0.1:1521/ORCL') !== -1, t.split('\n')[1])
  // La casilla es de los agentes, y el tooltip lo dice.
  check('tooltip: solo lectura PARA LOS AGENTES', t.split('\n').indexOf('Solo lectura para los agentes') !== -1, j(t.split('\n').slice(0, 3)))
  check('tooltip: notas recortadas', t.length < 700 && t.endsWith('…'), `${t.length}`)
  const sinNotas = tooltipConexion(conexion('C1', { readonly: false }))
  check('tooltip sin notas ni RO', sinNotas.split('\n').length === 2, j(sinNotas))
  // Entorno: con palabras, en su línea; sin él (o con basura), nada.
  const prod = tooltipConexion(conexion('C1', { entorno: 'produccion' }))
  check('tooltip: el entorno con palabras', prod.split('\n').indexOf('Entorno: Producción') === 2, j(prod))
  check('tooltip: y el RO sigue detrás', prod.split('\n')[3] === 'Solo lectura para los agentes', j(prod))
  check('tooltip: sin entorno, ninguna línea de entorno', tooltipConexion(conexion('C1')).indexOf('Entorno') === -1, j(tooltipConexion(conexion('C1'))))
  const basura = tooltipConexion(conexion('C1', { entorno: 'prod' as unknown as 'produccion' }))
  check('tooltip: un valor que no es entorno se ignora', basura.indexOf('Entorno') === -1, j(basura))
  check('aliasParaConfirmar: producción lo dice', aliasParaConfirmar(conexion('C1', { entorno: 'produccion' })) === 'ALIAS-C1 (producción)', aliasParaConfirmar(conexion('C1', { entorno: 'produccion' })))
  for (const e of [undefined, 'desarrollo', 'pruebas'] as const) {
    check(`aliasParaConfirmar: ${e ?? 'sin entorno'} no añade nada`, aliasParaConfirmar(conexion('C1', { entorno: e })) === 'ALIAS-C1', aliasParaConfirmar(conexion('C1', { entorno: e })))
  }
}
{
  const ilegible = avisoSecreto(conexion('C1', { secretoIlegible: true }), 'EL ALMACÉN')
  check('ilegible nombra el almacén que se le pasa', ilegible !== null && ilegible.indexOf('EL ALMACÉN') !== -1, j(ilegible))
  check('sin contraseña', avisoSecreto(conexion('C1', { tieneSecreto: false }), 'x') === 'Sin contraseña guardada.', 'sin')
  check('bien: null', avisoSecreto(conexion('C1'), 'x') === null, 'null')
  // Un motor sin credenciales no tiene contraseña que echar en falta.
  check('SQLite sin contraseña: null', avisoSecreto(conexion('C1', { motor: 'sqlite', tieneSecreto: false }), 'x') === null, 'null')
  // Con el usuario opcional, la contraseña también lo es.
  for (const motor of ['mongodb', 'redis'] as const) {
    check(`${motor} sin contraseña: null`, avisoSecreto(conexion('C1', { motor, tieneSecreto: false }), 'x') === null, 'null')
    check(
      `${motor} con contraseña ilegible: sigue avisando`,
      (avisoSecreto(conexion('C1', { motor, secretoIlegible: true }), 'EL ALMACÉN') ?? '').includes('EL ALMACÉN'),
      'aviso'
    )
  }
  check('Oracle sin contraseña: sigue avisando', avisoSecreto(conexion('C1', { motor: 'oracle', tieneSecreto: false }), 'x') === 'Sin contraseña guardada.', 'sin')
}

// ---------------------------------------------------------------------------------
hr('(5) aplicarOrden')
{
  const lista = [conexion('A'), conexion('B'), conexion('C')]
  const r = aplicarOrden(lista, ['C', 'A', 'B'])
  check('orden nuevo', j(r.map((c) => c.id)) === j(['C', 'A', 'B']), j(r.map((c) => c.id)))
  const r2 = aplicarOrden([...lista, conexion('D')], ['C', 'X', 'A', 'B'])
  check('lo nuevo al final, lo desconocido fuera', j(r2.map((c) => c.id)) === j(['C', 'A', 'B', 'D']), j(r2.map((c) => c.id)))
}

// ---------------------------------------------------------------------------------
hr('(5b) objetos internos del motor: atenuados y explicados')
{
  check(
    "'sombra' y 'sistema' son internos; 'sinRowid', un relkind de PG, 'PROCEDURE' o nada, no (ni `constructor`)",
    objetoInterno({ subtipo: 'sombra' }) &&
      objetoInterno({ subtipo: 'sistema' }) &&
      !objetoInterno({ subtipo: 'sinRowid' }) &&
      !objetoInterno({ subtipo: 'r' }) &&
      !objetoInterno({ subtipo: 'PROCEDURE' }) &&
      !objetoInterno({}) &&
      !objetoInterno({ subtipo: 'constructor' }),
    'ok'
  )
  check(
    'el tooltip explica los del contrato y deja los demás tal cual (Oracle y PG, como antes)',
    textoSubtipo({ subtipo: 'sombra' })?.startsWith('Tabla interna de una tabla virtual') === true &&
      textoSubtipo({ subtipo: 'sinRowid' })?.startsWith('WITHOUT ROWID') === true &&
      textoSubtipo({ subtipo: 'PROCEDURE' }) === 'PROCEDURE' &&
      textoSubtipo({ subtipo: 'constructor' }) === 'constructor' &&
      textoSubtipo({}) === null,
    'ok'
  )
}

// ---------------------------------------------------------------------------------
hr('(6) cargaDeFila y accionDeError')
{
  const filas = filasDemo()
  const porKind = (k: FilaBd['kind']): FilaBd | undefined => filas.find((f) => f.kind === k)
  const fc = porKind('conexion')
  const fe = porKind('esquema')
  const fk = porKind('carpeta')
  const fo = filas.find((f) => f.kind === 'objeto' && f.objeto.nombre === 'EMP')
  const ffc = porKind('carpeta-consolas')
  check('conexión -> esquemas', fc !== undefined && cargaDeFila(fc)?.tipo === 'esquemas', j(fc && cargaDeFila(fc)))
  check('esquema -> resumen', fe !== undefined && cargaDeFila(fe)?.tipo === 'resumen', j(fe && cargaDeFila(fe)))
  const cc = fk && cargaDeFila(fk)
  check('carpeta -> objetos de su tipo', cc?.tipo === 'objetos' && cc.tipoObjeto === 'tabla', j(cc))
  const co = fo && cargaDeFila(fo)
  check(
    'tabla -> detalle con sus tres partes',
    co?.tipo === 'detalle' && j(co.partes) === j(['columnas', 'indices', 'restricciones']),
    j(co)
  )
  check('carpeta de consolas -> nada', ffc !== undefined && cargaDeFila(ffc) === null, 'null')
  const cargando = filas.find((f) => f.kind === 'placeholder' && f.variante === 'loading')
  check('el objeto desplegado sin detalle pinta «Cargando…»', cargando !== undefined, j(cargando?.key))
}
{
  const base: FilaPlaceholder = {
    kind: 'placeholder',
    variante: 'error',
    key: 'x',
    depth: 1,
    padre: claveBd.conexion('C1'),
    mensaje: 'fallo',
    reintentar: { tipo: 'esquemas', clave: claveBd.conexion('C1'), conexionId: 'C1' },
    motivo: 'servidor'
  }
  const c = conexion('C1')
  const aDriver = accionDeError(
    { ...base, motivo: 'driver', requiereDriver: { packId: 'oracle-ic-19', motivo: 'Oracle 11.2 necesita…' } },
    c
  )
  check('driver -> Instalar cliente…', aDriver?.tipo === 'instalarCliente' && aDriver.etiqueta === 'Instalar cliente…', j(aDriver))
  const aSec = accionDeError({ ...base, motivo: 'sinSecreto' }, c)
  check('sinSecreto -> Vuelve a escribir la contraseña', aSec?.tipo === 'editarConexion', j(aSec))
  const aIleg = accionDeError(base, conexion('C1', { secretoIlegible: true }))
  check('contraseña ilegible -> editar aunque el motivo sea otro', aIleg?.tipo === 'editarConexion', j(aIleg))
  const aRe = accionDeError(base, c)
  check('lo demás -> Reintentar', aRe?.tipo === 'reintentar' && aRe.etiqueta === 'Reintentar', j(aRe))
  check('no error -> null', accionDeError({ ...base, variante: 'loading' }, c) === null, 'null')
  check('placeholder -> su conexión', conexionDeFila(base) === 'C1', j(conexionDeFila(base)))
}

// ---------------------------------------------------------------------------------
hr('(7) nombres para copiar')
{
  const filas = filasDemo()
  const fo = filas.find((f) => f.kind === 'objeto' && f.objeto.nombre === 'EMP')
  const fmin = filas.find((f) => f.kind === 'objeto' && f.objeto.nombre === 'emp_min')
  const fk = filas.find((f) => f.kind === 'carpeta')
  const fcons = filas.find((f) => f.kind === 'consola')
  check('objeto: su nombre', fo !== undefined && nombreDeFila(fo) === 'EMP', j(fo && nombreDeFila(fo)))
  check('consola: su nombre', fcons !== undefined && nombreDeFila(fcons) === 'consola_1', j(fcons && nombreDeFila(fcons)))
  check('carpeta: nada', fk !== undefined && nombreDeFila(fk) === null, 'null')
  check('cualificado oracle', fo !== undefined && nombreCualificadoDeFila(fo, 'oracle') === 'HR.EMP', j(fo && nombreCualificadoDeFila(fo, 'oracle')))
  check(
    'minúsculas en Oracle van citadas',
    fmin !== undefined && nombreCualificadoDeFila(fmin, 'oracle') === 'HR."emp_min"',
    j(fmin && nombreCualificadoDeFila(fmin, 'oracle'))
  )
  check(
    'mayúsculas en PG van citadas',
    fo !== undefined && nombreCualificadoDeFila(fo, 'postgres') === '"HR"."EMP"',
    j(fo && nombreCualificadoDeFila(fo, 'postgres'))
  )
  check('cualificado de algo que no es objeto: null', fk !== undefined && nombreCualificadoDeFila(fk, 'oracle') === null, 'null')
}

// ---------------------------------------------------------------------------------
hr('(8) navegación')
{
  const filas = filasDemo()
  const iCargando = filas.findIndex((f) => f.kind === 'placeholder' && f.variante === 'loading')
  check('«Cargando…» no es navegable', !esNavegable(filas[iCargando]), `${iCargando}`)
  const antes = iCargando - 1
  const sig = siguienteNavegable(filas, antes, 1)
  check('↓ salta el marcador', sig === iCargando + 1, `${antes} -> ${sig}`)
  const ant = siguienteNavegable(filas, iCargando + 1, -1)
  check('↑ también', ant === antes, `${iCargando + 1} -> ${ant}`)
  check('entrar por arriba', siguienteNavegable(filas, -1, 1) === 0, `${siguienteNavegable(filas, -1, 1)}`)
  check('entrar por abajo', siguienteNavegable(filas, filas.length, -1) === filas.length - 1, `${siguienteNavegable(filas, filas.length, -1)}`)
  check('en el borde se queda', siguienteNavegable(filas, filas.length - 1, 1) === filas.length - 1, 'borde')
  check('página hacia abajo', saltoNavegable(filas, 0, 1, 3) === 3, `${saltoNavegable(filas, 0, 1, 3)}`)
  check('página que se pasa: el último', saltoNavegable(filas, 0, 1, 999) === filas.length - 1, `${saltoNavegable(filas, 0, 1, 999)}`)
  const err: FilaPlaceholder = { kind: 'placeholder', variante: 'error', key: 'e', depth: 1, padre: 'p' }
  check('un error sí es navegable (Enter lo resuelve)', esNavegable(err), 'true')
}

// ---------------------------------------------------------------------------------
hr('(9) búsqueda')
{
  const filas = filasDemo('emp')
  const i = primeraCoincidencia(filas)
  check('primera coincidencia', i >= 0 && nombreDeFila(filas[i]) === 'EMP', j(i >= 0 ? nombreDeFila(filas[i]) : null))
  check('cuenta', contarCoincidencias(filas) === 2, `${contarCoincidencias(filas)}`)
  check('sin filtro: ninguna', contarCoincidencias(filasDemo()) === 0, '0')
}

// ---------------------------------------------------------------------------------
hr('(10) textos de confirmación')
check('uno', listaNatural(['a']) === '«a»', listaNatural(['a']))
check('dos', listaNatural(['a', 'b']) === '«a» y «b»', listaNatural(['a', 'b']))
check('tres', listaNatural(['a', 'b', 'c']) === '«a», «b» y «c»', listaNatural(['a', 'b', 'c']))
check(
  'más de cinco',
  listaNatural(['a', 'b', 'c', 'd', 'e', 'f', 'g']) === '«a», «b», «c», «d», «e» y 2 más',
  listaNatural(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
)
{
  const t = textoEliminarConexion({ alias: 'QA', proyectos: null, consolas: [], conTx: [] })
  check('sin saber los proyectos: en general', t.indexOf('todos los proyectos donde la tuvieras') !== -1, j(t))
  const t2 = textoEliminarConexion({ alias: 'QA', proyectos: ['api', 'web'], consolas: ['consola_1'], conTx: ['consola_1'] })
  check('nombra los proyectos', t2.indexOf('Se desmontará de «api» y «web».') !== -1, j(t2))
  check('una consola por su nombre', t2.indexOf('Su consola «consola_1» irá a la papelera.') !== -1, j(t2))
  check('los cambios que se revierten', t2.indexOf('Se revertirán los cambios sin confirmar de «consola_1».') !== -1, j(t2))
  const t3 = textoEliminarConexion({ alias: 'QA', proyectos: [], consolas: ['a', 'b'], conTx: [] })
  check('sin montar: no habla de proyectos', t3.indexOf('desmontará') === -1, j(t3))
  check('varias consolas: cuántas', t3.indexOf('Sus 2 consolas irán a la papelera.') !== -1, j(t3))
  check('NEGATIVO: sin ediciones pendientes no habla de ellas', t3.indexOf('sin enviar') === -1 && t2.indexOf('sin enviar') === -1, j(t3))
  const t4 = textoEliminarConexion({ alias: 'QA', proyectos: [], consolas: [], conTx: [], sinEnviar: 1 })
  check('una edición sin enviar: en singular', t4.indexOf('Se descartará 1 cambio sin enviar de sus pestañas de datos.') !== -1, j(t4))
  const t5 = textoEliminarConexion({ alias: 'QA', proyectos: [], consolas: [], conTx: [], sinEnviar: 4 })
  check('varias ediciones sin enviar: cuántas', t5.indexOf('Se descartarán 4 cambios sin enviar de sus pestañas de datos.') !== -1, j(t5))
}

// ---------------------------------------------------------------------------------
hr('(11) popover de esquemas')
{
  const orden = ordenarEsquemasPopover(RESP.esquemas).map((x: DbEsquema) => x.nombre)
  check('normales, sistema, PUBLIC', j(orden) === j(['HR', 'VENTAS', 'SYS', 'PUBLIC']), j(orden))
  check('filtro por subcadena sin mayúsculas', j(filtrarEsquemas(RESP.esquemas, 'ven').map((x) => x.nombre)) === j(['VENTAS']), 'ven')
  check('filtro vacío: todos', filtrarEsquemas(RESP.esquemas, '  ').length === 4, '4')
  check(
    'config igual con otro orden',
    mismaConfigEsquemas(
      { modo: 'lista', porDefecto: true, esquemas: ['A', 'B'] },
      { modo: 'lista', porDefecto: true, esquemas: ['B', 'A'] }
    ),
    'true'
  )
  check(
    'config distinta por la bandera',
    !mismaConfigEsquemas(
      { modo: 'lista', porDefecto: true, esquemas: ['A'] },
      { modo: 'lista', porDefecto: false, esquemas: ['A'] }
    ),
    'false'
  )
  check('todos == todos', mismaConfigEsquemas({ modo: 'todos' }, { modo: 'todos' }), 'true')
  check(
    'todos != lista',
    !mismaConfigEsquemas({ modo: 'todos' }, { modo: 'lista', porDefecto: true, esquemas: [] }),
    'false'
  )
}

// ---------------------------------------------------------------------------------
hr('(12) etiquetas')
{
  const faltan: string[] = []
  // (Las carpetas por tipo de objeto son del catálogo SQL.)
  for (const motor of IDS_MOTORES_SQL) {
    for (const t of descriptorSql(motor).catalogo.carpetas) if (!ETIQUETA_CARPETA[t]) faltan.push(`${motor}:${t}`)
  }
  check('todas las carpetas tienen nombre', faltan.length === 0, j(faltan))
  check('partes de detalle', ETIQUETA_PARTE.indices === 'índices', ETIQUETA_PARTE.indices)
}

// ---------------------------------------------------------------------------------
// Las dos ajenas van en un orden que NO es el alfabético ('SQLS-VENTAS' antes que
// 'local.db'): si alguien las reordenara aquí, el caso del orden en que llegan lo
// cazaría. El orden lo fija el main (`ajenasDelPerfil`: su `orden` y, sin él, el alias),
// y el renderer no lo toca.
const AJENAS: DbConexionAjena[] = [
  { id: 'S1', profileId: 'P', alias: 'SQLS-VENTAS', motor: 'mysql' },
  { id: 'L1', profileId: 'P', alias: 'local.db', motor: 'sqlite' }
]
const esAjena = (f: FilaArbol | undefined): f is FilaAjena => f !== undefined && f.kind === 'ajena'

hr('(13a) ajenas: al FINAL, en el orden en que llegan del main, sin mover las filas del árbol')
{
  const arbol = filasDemo()
  const todas = componerFilasArbol(arbol, AJENAS)
  const n = arbol.length
  check('una fila por ajena, además de las del árbol', todas.length === n + 2, `${todas.length} vs ${n}+2`)
  check(
    'las filas del árbol son LAS MISMAS y en los mismos índices',
    arbol.every((f, i) => todas[i] === f),
    'identidad por índice'
  )
  const ultimas = todas.slice(n)
  check(
    'detrás de la última fila del árbol (también de lo desplegado), no entre conexiones',
    ultimas.every(esAjena) && todas.slice(0, n).every((f) => f.kind !== 'ajena'),
    j(todas.map((f) => f.kind))
  )
  check(
    'en el orden en que LLEGAN, sin reordenar (no alfabético)',
    j(ultimas.map((f) => (esAjena(f) ? f.ajena.id : '?'))) === '["S1","L1"]',
    j(ultimas.map((f) => (esAjena(f) ? f.ajena.alias : '?')))
  )
  check('en la raíz (profundidad 0), como una conexión', ultimas.every((f) => f.depth === 0), j(ultimas.map((f) => f.depth)))
  check('sin ajenas: la MISMA lista (la identidad mueve la lista virtual)', componerFilasArbol(arbol, []) === arbol, 'identidad')
  const claves = todas.map((f) => f.key)
  check('claves únicas en todo el lateral', new Set(claves).size === claves.length, `${new Set(claves).size}/${claves.length}`)
  check(
    'la clave de una ajena no choca con la de una conexión del mismo id',
    claveBd.ajena('C1') !== claveBd.conexion('C1'),
    j([claveBd.ajena('C1'), claveBd.conexion('C1')])
  )
  check(
    'conexionDeClave encuentra su id (la poda por conexión la trata como a las demás)',
    conexionDeClave(claveBd.ajena('S1')) === 'S1',
    j(conexionDeClave(claveBd.ajena('S1')))
  )
}

hr('(13b) ajenas: lo que dicen')
{
  check('el aviso de la fila', TEXTO_AJENA === 'Requiere una versión más nueva de Tessera', j(TEXTO_AJENA))
  check(
    'motor desconocido: «requiere una versión más nueva»; motor CONOCIDO con forma no reconocida: «no reconoce cómo está guardada»',
    textoAjena({ id: 'x', profileId: 'p', alias: 'X', motor: 'mysql' }) === TEXTO_AJENA &&
      textoAjena({ id: 'y', profileId: 'p', alias: 'Y', motor: 'postgres' }) === TEXTO_AJENA_FORMA &&
      textoAjena({ id: 'z', profileId: 'p', alias: 'Z', motor: 'oracle' }) === TEXTO_AJENA_FORMA,
    'ok'
  )
  check(
    'NEGATIVO: un motor que se llame como una propiedad de Object («toString», «constructor») no se toma por conocido',
    textoAjena({ id: 'w', profileId: 'p', alias: 'W', motor: 'toString' }) === TEXTO_AJENA &&
      textoAjena({ id: 'v', profileId: 'p', alias: 'V', motor: 'constructor' }) === TEXTO_AJENA,
    'ok'
  )
  check(
    'el tooltip de una ajena por FORMA no dice «la creó una versión más nueva»',
    !tooltipAjena({ id: 'y', profileId: 'p', alias: 'Y', motor: 'postgres' }).includes('la creó una versión más nueva') &&
      tooltipAjena({ id: 'y', profileId: 'p', alias: 'Y', motor: 'postgres' }).includes(TEXTO_AJENA_FORMA),
    'ok'
  )
  const t = tooltipAjena(AJENAS[0])
  check('el tooltip: alias, motor tal cual y el porqué', t.startsWith('SQLS-VENTAS\nMotor: mysql\n') && t.includes(TEXTO_AJENA), j(t))
  check('el tooltip ofrece las dos salidas', t.includes('actualiza Tessera') && t.includes('elimínala'), j(t))
  check('un motor normal se enseña tal cual', motorAjeno(AJENAS[1]) === 'sqlite', motorAjeno(AJENAS[1]))
  const largo = motorAjeno({ motor: 'x'.repeat(200) })
  check('un motor absurdo se recorta (viene de otra versión o de una edición a mano)', largo.length === 33 && largo.endsWith('…'), `${largo.length}`)
  const e = textoEliminarAjena({ alias: 'SQLS-VENTAS', motor: 'mysql', proyectos: null, consolas: [] })
  check('eliminar: nombra la conexión y avisa de que es irreversible', e.includes('«SQLS-VENTAS»') && e.includes('No se puede deshacer'), j(e))
  check('eliminar: la base de datos no se toca', e.includes('la base de datos no se toca'), j(e))
  check('eliminar: dice de qué motor es y que actualizar es la otra salida', e.includes('mysql') && e.includes('actualiza Tessera'), j(e))
  check('eliminar sin saber los proyectos: en general', e.includes('todos los proyectos donde la tuvieras'), j(e))
  const e2 = textoEliminarAjena({ alias: 'X', motor: 'sqlite', proyectos: ['api'], consolas: ['informe'] })
  check('eliminar: nombra dónde estaba montada', e2.includes('Se desmontará de «api».'), j(e2))
  // El main manda sus consolas a la papelera por id, como las de cualquier conexión:
  // si el perfil las lista, el diálogo lo dice.
  check('eliminar: su consola va a la papelera, por su nombre', e2.includes('Su consola «informe» irá a la papelera.'), j(e2))
  const e3 = textoEliminarAjena({ alias: 'X', motor: 'sqlite', proyectos: [], consolas: ['a', 'b'] })
  check('eliminar: varias consolas, cuántas', e3.includes('Sus 2 consolas irán a la papelera.'), j(e3))
  check('NEGATIVO: sin montar, no habla de proyectos', !e3.includes('desmontará'), j(e3))
  check('NEGATIVO: sin consolas, no habla de la papelera', !e.includes('papelera'), j(e))
  // Una CONOCIDA con el mismo id (edición a mano). Se borra solo la ajena, y los
  // montajes y las consolas de ese id son de la conocida: anunciarlos como perdidos sería falso.
  const e4 = textoEliminarAjena({ alias: 'X', motor: 'sqlite', proyectos: ['api'], consolas: ['informe'], compartidaCon: 'Ventas PROD' })
  check(
    'eliminar una ajena que COMPARTE id con una conocida: dice que la otra no se toca, y no anuncia desmontar ni la papelera',
    e4.includes('«Ventas PROD» comparte su identificador y no se toca') && !e4.includes('desmontará') && !e4.includes('papelera') && e4.includes('No se puede deshacer'),
    j(e4)
  )
  const e5 = textoEliminarAjena({ alias: 'X', motor: 'sqlite', proyectos: ['api'], consolas: ['informe'], compartidaCon: null })
  check('NEGATIVO: sin conocida que la comparta (null), el mensaje de siempre', e5 === e2 && !e5.includes('comparte'), j(e5))
  check(
    'NEGATIVO: ni transacciones ni ediciones sin enviar (una ajena no abre sesiones)',
    !e3.includes('sin confirmar') && !e3.includes('sin enviar'),
    j(e3)
  )
}

hr('(13c) ajenas: no se despliegan ni se abren; su única acción es eliminar')
{
  const todas = componerFilasArbol(filasDemo(), AJENAS)
  const ajena = todas.find(esAjena)
  if (!ajena) {
    check('hay fila ajena', false, 'no')
  } else {
    check('Enter / doble clic: nada', accionTeclaArbol(ajena, 'abrir') === 'nada', accionTeclaArbol(ajena, 'abrir'))
    check('→: nada (no se despliega)', accionTeclaArbol(ajena, 'dcha') === 'nada', accionTeclaArbol(ajena, 'dcha'))
    check('←: nada (no hay padre)', accionTeclaArbol(ajena, 'izq') === 'nada', accionTeclaArbol(ajena, 'izq'))
    check('no es contenedor (sin chevron, Espacio no hace nada)', !esContenedorArbol(ajena), 'false')
    // Contraprueba: sobre las filas del árbol, la misma función sigue haciendo lo suyo.
    const con = todas.find((f) => f.kind === 'conexion')
    check(
      '(contraprueba) sobre una conexión desplegada sigue plegando y es contenedor',
      con !== undefined && accionTeclaArbol(con, 'abrir') === 'plegar' && esContenedorArbol(con),
      con ? accionTeclaArbol(con, 'abrir') : 'sin conexión'
    )
    check('nada que copiar (Mod+C no hace nada)', nombreDeFila(ajena) === null, j(nombreDeFila(ajena)))
    const menu = accionesDeAjena()
    check('el menú: SOLO eliminar', menu.length === 1 && menu[0].accion === 'eliminar', j(menu))
    check('…con la etiqueta de las conexiones', menu[0]?.etiqueta === 'Eliminar conexión…', j(menu[0]?.etiqueta))
    const b = borradoDeFila(ajena)
    check('Supr / ⌘⌫ piden eliminarla', b !== null && b.tipo === 'ajena' && b.ajena.id === 'S1', j(b))
    const bc = con ? borradoDeFila(con) : null
    check('(contraprueba) sobre una conexión, la conexión', bc !== null && bc.tipo === 'conexion', j(bc?.tipo))
    const esq = todas.find((f) => f.kind === 'esquema')
    check('NEGATIVO: un esquema no se borra con la tecla', esq !== undefined && borradoDeFila(esq) === null, j(esq?.kind))
  }
}

hr('(13d) ajenas: se recorren con el teclado')
{
  const arbol = filasDemo()
  const todas = componerFilasArbol(arbol, AJENAS)
  const n = arbol.length
  check('se puede posar el cursor en una (es por donde se llega a Eliminar)', esNavegable(todas[n]), todas[n].kind)
  check('Fin lleva a la última ajena', siguienteNavegable(todas, todas.length, -1) === n + 1, `${siguienteNavegable(todas, todas.length, -1)}`)
  check('↓ desde la última del árbol entra en las ajenas', siguienteNavegable(todas, n - 1, 1) === n, `${siguienteNavegable(todas, n - 1, 1)}`)
  const ultimaArbol = siguienteNavegable(arbol, n, -1)
  check('↑ desde la primera ajena vuelve al árbol', siguienteNavegable(todas, n, -1) === ultimaArbol, `${siguienteNavegable(todas, n, -1)} vs ${ultimaArbol}`)
  // Un árbol cuyo final es un «Cargando…» (la conexión desplegada, sin esquemas aún):
  // la flecha lo salta y cae en la ajena.
  const kc = claveBd.conexion('C9')
  const cargando = aplanarArbolBd({
    conexiones: [conexion('C9')],
    consolas: [],
    esquemas: new Map(),
    conteos: new Map(),
    objetos: new Map(),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([kc])
  })
  const ultima = cargando[cargando.length - 1]
  const conCargando = componerFilasArbol(cargando, AJENAS)
  check(
    '↓ salta el «Cargando…» del final del árbol y entra en la ajena',
    ultima.kind === 'placeholder' && siguienteNavegable(conCargando, cargando.length - 2, 1) === cargando.length,
    `${j(cargando.map((f) => f.kind))} -> ${siguienteNavegable(conCargando, cargando.length - 2, 1)}`
  )
  check(
    'página hacia abajo termina en la última ajena',
    saltoNavegable(todas, 0, 1, 999) === todas.length - 1,
    `${saltoNavegable(todas, 0, 1, 999)}`
  )
}

hr('(13e) ajenas: la búsqueda al teclear las encuentra por el alias')
{
  const arbol = filasDemo('ventas')
  const todas = componerFilasArbol(arbol, AJENAS, 'ventas')
  const ajenas = todas.filter(esAjena)
  check('solo las que coinciden', j(ajenas.map((f) => f.ajena.id)) === '["S1"]', j(ajenas.map((f) => f.ajena.id)))
  check('sin distinguir mayúsculas, con la coincidencia marcada', j(ajenas[0]?.coincidencia) === '[5,11]', j(ajenas[0]?.coincidencia))
  check('cuentan en el total', contarCoincidencias(todas) === contarCoincidencias(arbol) + 1, `${contarCoincidencias(todas)}`)
  const conEspacios = componerFilasArbol(arbol, AJENAS, '  VENTAS ').filter(esAjena)
  check('con el mismo recorte que el aplanador', conEspacios.length === 1, `${conEspacios.length}`)
  const nada = filasDemo('zzz')
  check('ninguna coincide: la MISMA lista del árbol', componerFilasArbol(nada, AJENAS, 'zzz') === nada, 'identidad')
  check(
    'sin búsqueda: todas, sin marca',
    componerFilasArbol(filasDemo(), AJENAS).filter(esAjena).every((f) => f.coincidencia === undefined),
    'sin coincidencia'
  )
}

// ---------------------------------------------------------------------------------
// La fila, el tooltip, el diálogo de eliminar, la pista del área vacía y el popover de
// montaje del agente dicen lo MISMO de la misma entrada, por su causa, y ninguno aconseja
// borrarla y crearla otra vez (en la versión que la escribió puede funcionar).
hr('(13f) ajenas: UN solo criterio en todas las superficies')
{
  const porMotor: DbConexionAjena = { id: 'S1', profileId: 'P', alias: 'SQLS-VENTAS', motor: 'mysql' }
  const porForma: DbConexionAjena = { id: 'G1', profileId: 'P', alias: 'PG-SOCKET', motor: 'postgres' }
  const eliminar = (a: DbConexionAjena): string =>
    textoEliminarAjena({ alias: a.alias, motor: a.motor, proyectos: ['api'], consolas: [] })
  check(
    'la causa: motor desconocido = «motor»; Oracle o PostgreSQL = «forma»',
    causaAjena(porMotor) === 'motor' &&
      causaAjena(porForma) === 'forma' &&
      causaAjena({ motor: 'oracle' }) === 'forma' &&
      causaAjena({ motor: 'constructor' }) === 'motor',
    j([causaAjena(porMotor), causaAjena(porForma)])
  )
  // La pregunta «¿lo conoce esta versión?» es la del registro (`esMotor`). Todo
  // motor del registro es «forma», y lo que solo está en el prototipo, «motor».
  check(
    'la causa: todo motor del registro es «forma»; lo del prototipo, «motor»',
    IDS_MOTORES.every((m) => causaAjena({ motor: m }) === 'forma') &&
      ['toString', '__proto__', 'hasOwnProperty', '', 'ORACLE'].every((m) => causaAjena({ motor: m }) === 'motor'),
    j(IDS_MOTORES.map((m) => causaAjena({ motor: m })))
  )
  for (const a of [porMotor, porForma]) {
    const q = `(${a.motor})`
    const corto = textoAjena(a)
    const porque = explicacionAjena(a)
    const montaje = filaMontajeAjena(a)
    const superficies: Array<[string, string]> = [
      ['fila', corto],
      ['tooltip del árbol', tooltipAjena(a)],
      ['diálogo de eliminar', eliminar(a)],
      ['destino del popover', montaje.destino],
      ['tooltip del popover', montaje.tooltip]
    ]
    check(
      `${q} el MISMO aviso corto en la fila y en el popover, y en los textos largos`,
      superficies.every(([, t]) => t.includes(corto)),
      j(superficies.filter(([, t]) => !t.includes(corto)).map(([s]) => s))
    )
    check(
      `${q} la MISMA explicación en el tooltip, el diálogo y el popover`,
      tooltipAjena(a).includes(porque) && eliminar(a).includes(porque) && montaje.tooltip.includes(porque),
      j(porque)
    )
    check(
      `${q} NEGATIVO: ninguna superficie aconseja borrarla y crearla otra vez`,
      [...superficies.map(([, t]) => t), PISTA_SOLO_AJENAS].every((t) => !/vuelve a crear|volver a crear|créala|crearla/i.test(t)),
      j(superficies.filter(([, t]) => /vuelve a crear|volver a crear|créala|crearla/i.test(t)).map(([s]) => s))
    )
    check(
      `${q} el diálogo dice que eliminar es solo para quien ya no la quiere`,
      eliminar(a).includes('Eliminarla solo hace falta si ya no la quieres.'),
      j(eliminar(a))
    )
    check(`${q} se conserva tal cual (lo dice su explicación)`, porque.includes('Se conserva tal cual'), j(porque))
  }
  // Motor desconocido: solo lo escribe una versión más nueva, y actualizar es cómo se usa.
  check(
    'motor: «requiere una versión más nueva» y actualizar para usarla',
    explicacionAjena(porMotor).startsWith(TEXTO_AJENA) && explicacionAjena(porMotor).includes('actualiza Tessera para usarla'),
    j(explicacionAjena(porMotor))
  )
  check('motor: NEGATIVO, no habla de ediciones a mano', !explicacionAjena(porMotor).includes('a mano'), j(explicacionAjena(porMotor)))
  // Forma: dice las DOS posibilidades y no afirma ninguna.
  const fForma = explicacionAjena(porForma)
  check(
    'forma: las dos posibilidades (versión más nueva, con su salida, o edición a mano)',
    fForma.startsWith(TEXTO_AJENA_FORMA) && fForma.includes('versión más nueva') && fForma.includes('actualiza') && fForma.includes('edición a mano'),
    j(fForma)
  )
  check(
    'forma: NEGATIVO, el diálogo no afirma que la creó una versión más nueva (la fila dice otra cosa)',
    !/creó una versión más nueva/.test(eliminar(porForma)) && !eliminar(porForma).includes(TEXTO_AJENA),
    j(eliminar(porForma))
  )
  check('forma: el diálogo nombra su motor', eliminar(porForma).includes('Es una conexión de postgres.'), j(eliminar(porForma)))
  // El popover: la salida de allí es desmontar, no eliminar (allí no se puede).
  const mM = filaMontajeAjena(porMotor)
  check(
    'popover: su tooltip da la salida de allí (desmontar), no la del árbol',
    mM.tooltip.includes('desmontar') && !mM.tooltip.includes('elimínala'),
    j(mM.tooltip)
  )
  check(
    '(contraprueba) el tooltip del árbol da la de allí (eliminar), no la del popover',
    tooltipAjena(porMotor).includes('elimínala') && !tooltipAjena(porMotor).includes('desmontar'),
    j(tooltipAjena(porMotor))
  )
  check('popover: «motor · aviso»', mM.destino === 'mysql · Requiere una versión más nueva de Tessera', j(mM.destino))
  const larga = filaMontajeAjena({ id: 'X', profileId: 'P', alias: 'X', motor: 'm'.repeat(300) })
  check(
    'popover: un motor absurdo se recorta, como en el árbol, y el aviso sigue a la vista',
    larga.motor === motorAjeno({ motor: 'm'.repeat(300) }) &&
      larga.motor.length === 33 &&
      larga.destino.endsWith(` · ${TEXTO_AJENA}`) &&
      larga.destino.length < 100 &&
      !larga.tooltip.includes('m'.repeat(34)),
    `${larga.destino.length} caracteres`
  )
  check('popover de una de forma: el aviso de forma', filaMontajeAjena(porForma).destino === `postgres · ${TEXTO_AJENA_FORMA}`, j(filaMontajeAjena(porForma).destino))
  // El área vacía no sabe de qué causa es cada una: no afirma ninguna.
  check('área vacía: el título de siempre', TITULO_SOLO_AJENAS === 'Ninguna conexión que esta versión pueda abrir', j(TITULO_SOLO_AJENAS))
  check(
    'área vacía: NEGATIVO, no afirma que las creó una versión más nueva',
    !/creó una versión más nueva|las creó/.test(PISTA_SOLO_AJENAS),
    j(PISTA_SOLO_AJENAS)
  )
  check(
    'área vacía: remite a la fila, se conservan, y las dos salidas (actualizar si toca, o crear una nueva)',
    PISTA_SOLO_AJENAS.includes('cada una dice por qué') &&
      PISTA_SOLO_AJENAS.includes('se conservan tal cual') &&
      PISTA_SOLO_AJENAS.includes('Actualiza Tessera si vienen de una más nueva') &&
      PISTA_SOLO_AJENAS.includes('crea una aquí'),
    j(PISTA_SOLO_AJENAS)
  )
  // El vacío del popover de montaje: con ajenas sin montar no dice que el perfil no tiene
  // conexiones (el árbol las enseña), sino el título del área vacía; sin ajenas, el de siempre.
  const vacioConAjenas = textoVacioMontaje(true)
  check(
    'popover vacío CON ajenas: NEGATIVO, no dice que el perfil no tiene conexiones',
    !/no tiene conexiones|Añádelas/.test(vacioConAjenas),
    j(vacioConAjenas)
  )
  check(
    'popover vacío CON ajenas: el título del área vacía, remite al árbol y a crear una',
    vacioConAjenas.startsWith(TITULO_SOLO_AJENAS) &&
      vacioConAjenas.includes('vista Bases de datos') &&
      vacioConAjenas.includes('Crea allí una'),
    j(vacioConAjenas)
  )
  check(
    'popover vacío CON ajenas: NEGATIVO, ni afirma una causa ni aconseja recrearlas',
    !/versión más nueva|a mano|vuelve a crear|volver a crear|créala|crearla/i.test(vacioConAjenas),
    j(vacioConAjenas)
  )
  check(
    'popover vacío SIN ajenas: el texto de siempre',
    textoVacioMontaje(false) === 'Este perfil no tiene conexiones. Añádelas en la vista Bases de datos.',
    j(textoVacioMontaje(false))
  )
}

// ---------------------------------------------------------------------------------
// La clave de las ajenas y su búsqueda salen de `arbolBd` (`claveBd.ajena`,
// `normalizarBusqueda`, `coincidenciaDe`), no de copias: esto fija que las dos mitades del
// lateral se entienden (con una copia, cambiar el separador o la regla las desincroniza).
hr('(13g) ajenas: la clave y la búsqueda son las de `arbolBd`, no copias')
{
  const fila = componerFilasArbol([], [AJENAS[0]]).find(esAjena)
  check('la fila lleva la clave de `claveBd.ajena`', fila?.key === claveBd.ajena('S1'), j(fila?.key))
  check(
    'conexionDeClave da su conexión y consolaDeClave no la toma por una consola',
    conexionDeClave(claveBd.ajena('S1')) === 'S1' && consolaDeClave(claveBd.ajena('S1')) === null,
    j([conexionDeClave(claveBd.ajena('S1')), consolaDeClave(claveBd.ajena('S1'))])
  )
  // La MISMA coincidencia para el mismo alias, sea una conexión del árbol o una ajena:
  // con mayúsculas, con espacios en el filtro, con la İ turca (cambia de longitud al
  // pasar a minúsculas) y con la ß, y la mitad negativa (no coincide en ninguna).
  const alias = ['Ventas-PROD', 'İSTANBUL-ventas', 'Straße-VENTAS', 'réplica ventas']
  const filtros = ['ventas', '  VENTAS ', 'STAN', 'istanbul', 'ß', 'RÉPLICA', 'zzz']
  const distintas: string[] = []
  for (const al of alias) {
    for (const f of filtros) {
      const arbol = aplanarArbolBd({
        conexiones: [conexion('C1', { alias: al })],
        consolas: [],
        esquemas: new Map(),
        conteos: new Map(),
        objetos: new Map(),
        detalles: new Map(),
        errores: new Map(),
        expandidos: new Set(),
        filtro: f
      })
      const deArbol = arbol.find((x) => x.kind === 'conexion')?.coincidencia ?? null
      const deAjena =
        componerFilasArbol([], [{ id: 'A1', profileId: 'P', alias: al, motor: 'mysql' }], f).find(esAjena)?.coincidencia ?? null
      if (j(deArbol) !== j(deAjena)) distintas.push(`${al} / ${j(f)}: ${j(deArbol)} vs ${j(deAjena)}`)
    }
  }
  check('la misma coincidencia que una conexión del árbol con el mismo alias (28 casos)', distintas.length === 0, j(distintas))
}

// ---------------------------------------------------------------------------------
// La COPIA de una conexión con su mismo id (pegada a mano) llega del
// main como ajena por id repetido (`DbConexionAjena.idRepetido`). Su motor es uno que esta
// versión conoce, así que por el motor saldría «no reconoce cómo está guardada», que no es
// su causa, y «actualiza» no la arregla.
hr('(13h) ajenas por id REPETIDO: su causa, sus textos, su clave y el popover')
{
  const copia: DbConexionAjena = { id: 'C1', profileId: 'P', alias: 'Copia', motor: 'oracle', idRepetido: { tipo: 'conexion', alias: 'Original' } }
  const deOtro: DbConexionAjena = { id: 'C1', profileId: 'P', alias: 'De otro', motor: 'oracle', idRepetido: { tipo: 'otroPerfil' } }
  const huerfana: DbConexionAjena = { id: 'C1', profileId: 'P', alias: 'Huérfana', motor: 'postgres', idRepetido: { tipo: 'eliminada' } }
  check(
    'la causa es el id repetido aunque su motor sea conocido (no «forma»)',
    [copia, deOtro, huerfana].every((a) => causaAjena(a) === 'idRepetido') && causaAjena({ motor: 'oracle' }) === 'forma',
    j([copia, deOtro, huerfana].map((a) => causaAjena(a)))
  )
  check(
    'la fila dice con quién comparte el id: su alias si es de este perfil; sin nombrarla si es de otro; o que se eliminó',
    textoAjena(copia) === 'Comparte el identificador con «Original»' &&
      textoAjena(deOtro) === 'Comparte el identificador con una conexión de otro perfil' &&
      textoAjena(huerfana) === 'Compartía el identificador con una conexión eliminada',
    j([textoAjena(copia), textoAjena(deOtro), textoAjena(huerfana)])
  )
  const eCopia = explicacionAjena(copia)
  check(
    'la explicación: no se pueden distinguir, se conserva, y elimínala si sobra; NEGATIVO: ni «versión más nueva» ni «actualiza» ni «cómo está guardada»',
    eCopia.includes('«Original»') &&
      eCopia.includes('no puede distinguirlas') &&
      eCopia.includes('Se conserva tal cual') &&
      eCopia.includes('elimínala si sobra') &&
      !/versión más nueva|actualiza/i.test(eCopia) &&
      !eCopia.includes(TEXTO_AJENA_FORMA),
    j(eCopia)
  )
  check('la de otro perfil: NEGATIVO, no la nombra', !explicacionAjena(deOtro).includes('Original') && explicacionAjena(deOtro).includes('otro perfil'), j(explicacionAjena(deOtro)))
  check(
    'la que se quedó sin la otra (eliminada): se podrá usar al reiniciar, y se dice',
    explicacionAjena(huerfana).includes('reinicia Tessera para usarla') && explicacionAjena(huerfana).includes('Se conserva tal cual'),
    j(explicacionAjena(huerfana))
  )
  const dialogo = (a: DbConexionAjena, compartidaCon: string | null): string =>
    textoEliminarAjena({ alias: a.alias, motor: a.motor, proyectos: ['api'], consolas: ['informe'], compartidaCon, idRepetido: a.idRepetido })
  for (const a of [copia, deOtro, huerfana]) {
    const q = `(${a.idRepetido?.tipo})`
    const corto = textoAjena(a)
    const porque = explicacionAjena(a)
    const montaje = filaMontajeAjena(a)
    const d = dialogo(a, a.idRepetido?.tipo === 'conexion' ? 'Original' : null)
    const superficies: Array<[string, string]> = [
      ['fila', corto],
      ['tooltip del árbol', tooltipAjena(a)],
      ['diálogo de eliminar', d],
      ['destino del popover', montaje.destino],
      ['tooltip del popover', montaje.tooltip]
    ]
    check(
      `${q} UN solo criterio: el aviso corto y la explicación en todas las superficies`,
      superficies.every(([s, t]) => t.includes(corto) || s === 'diálogo de eliminar') &&
        tooltipAjena(a).includes(porque) &&
        d.includes(porque) &&
        montaje.tooltip.includes(porque),
      j(superficies.filter(([, t]) => !t.includes(porque) && !t.includes(corto)).map(([s]) => s))
    )
    check(`${q} NEGATIVO: el diálogo no repite «Eliminarla solo hace falta…» (su explicación ya lo dice)`, !d.includes('Eliminarla solo hace falta'), j(d))
  }
  check(
    'el tooltip del árbol: eliminarla no toca la otra (ni sus montajes ni sus consolas)',
    tooltipAjena(copia).endsWith('Eliminarla no toca «Original»: ni sus montajes ni sus consolas.') &&
      tooltipAjena(deOtro).endsWith('Eliminarla no toca una conexión de otro perfil: ni sus montajes ni sus consolas.') &&
      tooltipAjena(huerfana).endsWith('Si ya no la quieres, elimínala.'),
    j([tooltipAjena(copia), tooltipAjena(huerfana)])
  )
  const dCopia = dialogo(copia, 'Original')
  check(
    'el diálogo de la copia: «Original» comparte su identificador y no se toca; NEGATIVO: ni desmontar ni papelera',
    dCopia.includes('«Original» comparte su identificador y no se toca') && !dCopia.includes('Se desmontará') && !dCopia.includes('papelera'),
    j(dCopia)
  )
  const dOtro = dialogo(deOtro, null)
  // Borrar la copia de otro perfil limpia lo de ESTE
  // (el main manda sus consolas a la papelera y el renderer la desmonta en este perfil), así
  // que se anuncia; y lo del otro perfil sigue sin tocarse, y se dice.
  check(
    'el de la de otro perfil: se desmonta de los proyectos de ESTE perfil y sus consolas de aquí van a la papelera; la otra no se toca',
    dOtro.includes('Se desmontará de «api».') &&
      dOtro.includes('Su consola «informe» irá a la papelera.') &&
      dOtro.endsWith('La conexión de otro perfil que comparte su identificador no se toca: ni sus montajes ni sus consolas.'),
    j(dOtro)
  )
  const dOtroSinSaber = textoEliminarAjena({ alias: deOtro.alias, motor: deOtro.motor, proyectos: null, consolas: [], idRepetido: deOtro.idRepetido })
  check(
    'sin saber los proyectos: «de los proyectos de ESTE perfil», NEGATIVO: no «de todos los proyectos» (los del otro perfil siguen montados); sin consolas, sin papelera',
    dOtroSinSaber.includes('Se desmontará de los proyectos de este perfil donde la tuvieras.') &&
      !dOtroSinSaber.includes('todos los proyectos') &&
      !dOtroSinSaber.includes('papelera'),
    j(dOtroSinSaber)
  )
  const dHuerfana = dialogo(huerfana, null)
  check('el de la eliminada: lo de siempre (se desmonta y sus consolas a la papelera)', dHuerfana.includes('Se desmontará de «api».') && dHuerfana.includes('papelera'), j(dHuerfana))
  // Dos ajenas con el MISMO id: cada fila con su clave (antes, las dos con la misma), la
  // primera con la de siempre; y la clave no cambia al buscar.
  const filas = componerFilasArbol([], [copia, deOtro]).filter(esAjena)
  const conFiltro = componerFilasArbol([], [copia, deOtro], 'de otro').filter(esAjena)
  check(
    'dos ajenas del mismo id: claves distintas, la primera la de siempre, las dos dan su conexión, y la segunda la conserva al buscar',
    filas.length === 2 &&
      filas[0].key === claveBd.ajena('C1') &&
      filas[1].key !== filas[0].key &&
      filas.every((f) => conexionDeClave(f.key) === 'C1') &&
      conFiltro.length === 1 &&
      conFiltro[0].key === filas[1].key,
    j({ claves: filas.map((f) => f.key), conFiltro: conFiltro.map((f) => f.key) })
  )
  // El popover de montaje: un montaje es de un ID; si una conocida lo usa, es suyo.
  const sqls: DbConexionAjena = { id: 'S1', profileId: 'P', alias: 'SQLS', motor: 'mysql' }
  const conConocida = ajenasMontadasPopover([copia, sqls], ['C1', 'S1'], [conexion('C1')])
  const sinConocida = ajenasMontadasPopover([copia, sqls], ['C1', 'S1'], [])
  const sinMontar = ajenasMontadasPopover([copia, sqls], ['C1'], [])
  check(
    'popover: la copia de una conocida del perfil NO sale como montada (el montaje es de la conocida); sin conocida, sí; y sin montar, no',
    j(conConocida.map((a) => a.alias)) === '["SQLS"]' &&
      j(sinConocida.map((a) => a.alias)) === '["Copia","SQLS"]' &&
      j(sinMontar.map((a) => a.alias)) === '["Copia"]',
    j({ conConocida: conConocida.map((a) => a.alias), sinConocida: sinConocida.map((a) => a.alias) })
  )
}

// ---------------------------------------------------------------------------------
// Con el registro ENTERO en un formato que esta versión no reconoce, las listas llegan
// vacías aunque el archivo esté lleno: las tres superficies no pueden decir «Sin conexiones»
// ni ofrecer un alta que el main rechaza. El aviso es el del main (aquí, uno de muestra).
hr('(14) registro con FORMATO AJENO: aviso en vez de «Sin conexiones», y sin altas')
{
  const AVISO = 'Esta versión de Tessera no reconoce el formato del registro de conexiones (db-connections.json)…'

  // La cabecera del árbol: Nueva conexión y Nueva consola apagadas CON su porqué.
  const conFormato = motivosCabeceraArbol({ perfilId: 'P', conexiones: 0, ajenas: 0, avisoFormato: AVISO })
  check(
    'cabecera: «Nueva conexión» y «Nueva consola» apagadas, con el porqué del formato',
    conFormato.nuevaConexion === MOTIVO_FORMATO_AJENO && conFormato.nuevaConsola === MOTIVO_FORMATO_AJENO,
    j(conFormato)
  )
  check(
    'cabecera: Refrescar/Plegar dicen el MISMO porqué, no «Todavía no hay conexiones» (que es falso)',
    conFormato.sinConexiones === MOTIVO_FORMATO_AJENO,
    j(conFormato.sinConexiones)
  )
  check('el porqué nombra el registro de conexiones', /registro de conexiones/.test(MOTIVO_FORMATO_AJENO), j(MOTIVO_FORMATO_AJENO))
  // La misma marca llega con DOS causas —un formato que esta versión no reconoce y un
  // archivo que no se puede leer (un JSON roto a mano)—, y la causa la dice el aviso del
  // main. Un título o un porqué que afirmara una («esta versión no reconoce el formato»)
  // mandaría a actualizar a quien dejó una coma de más.
  check(
    'NEGATIVO: ni el título ni el porqué afirman una causa (versión, formato, JSON): la dice el aviso',
    ![TITULO_FORMATO_AJENO, MOTIVO_FORMATO_AJENO, NOTA_FORMATO_AJENO, NOTA_MONTAJE_FORMATO_AJENO].some((t) =>
      /versión|formato|JSON|no reconoce/i.test(t)
    ),
    j([TITULO_FORMATO_AJENO, MOTIVO_FORMATO_AJENO, NOTA_MONTAJE_FORMATO_AJENO])
  )
  // Y el aviso de un registro ilegible (uno de muestra, como el de arriba) llega por el
  // MISMO camino: mismos botones apagados, la misma área sin alta, el mismo popover.
  const ILEGIBLE = 'No se puede leer el registro de conexiones (db-connections.json): no es JSON válido…'
  check(
    'un registro ilegible sigue el mismo camino: cabecera, área y popover con su aviso',
    motivosCabeceraArbol({ perfilId: 'P', conexiones: 0, ajenas: 0, avisoFormato: ILEGIBLE }).nuevaConexion === MOTIVO_FORMATO_AJENO &&
      j(vacioAreaSinConexiones({ hayAjenas: false, avisoFormato: ILEGIBLE })) ===
        j({ titulo: TITULO_FORMATO_AJENO, pista: ILEGIBLE, nota: NOTA_FORMATO_AJENO, ofrecerAlta: false }) &&
      j(vistaPopoverMontaje({ conexiones: [], ajenas: [], montadas: ['c1'], avisoFormato: ILEGIBLE })) ===
        j({ tipo: 'formato', aviso: ILEGIBLE }),
    'ok'
  )
  // Las mitades negativas: sin la marca, lo de siempre.
  const normal = motivosCabeceraArbol({ perfilId: 'P', conexiones: 0, ajenas: 0, avisoFormato: null })
  check(
    'NEGATIVO: sin la marca, las altas siguen vivas y el vacío dice «Todavía no hay conexiones»',
    normal.nuevaConexion === null && normal.nuevaConsola === null && normal.sinConexiones === 'Todavía no hay conexiones',
    j(normal)
  )
  check(
    'NEGATIVO: con solo ajenas, el título de siempre; con conexiones, nada apagado',
    motivosCabeceraArbol({ perfilId: 'P', conexiones: 0, ajenas: 2, avisoFormato: null }).sinConexiones === TITULO_SOLO_AJENAS &&
      j(motivosCabeceraArbol({ perfilId: 'P', conexiones: 1, ajenas: 0, avisoFormato: null })) ===
        j({ nuevaConexion: null, nuevaConsola: null, sinConexiones: null }),
    'ok'
  )
  check(
    'sin perfil manda «Abre un perfil», también con la marca',
    motivosCabeceraArbol({ perfilId: null, conexiones: 0, ajenas: 0, avisoFormato: AVISO }).nuevaConexion ===
      'Abre un perfil para usar las bases de datos',
    'ok'
  )

  // El área vacía.
  const area = vacioAreaSinConexiones({ hayAjenas: false, avisoFormato: AVISO })
  check(
    'área vacía: el título del formato, el aviso del main como pista y la nota',
    area.titulo === TITULO_FORMATO_AJENO && area.pista === AVISO && area.nota === NOTA_FORMATO_AJENO,
    j(area)
  )
  check('área vacía: NO ofrece «Nueva conexión…» (el main rechazaría el alta)', area.ofrecerAlta === false, j(area.ofrecerAlta))
  check(
    'área vacía: NEGATIVO, no dice «Sin conexiones» ni manda a crear',
    area.titulo !== 'Sin conexiones' && !/Crea la primera|crea una/i.test(`${area.titulo} ${area.pista}`),
    j(area)
  )
  check(
    'NEGATIVO: sin la marca, el vacío de siempre (con y sin ajenas), y ofrece el alta',
    j(vacioAreaSinConexiones({ hayAjenas: false, avisoFormato: null })) ===
      j({ titulo: 'Sin conexiones', pista: 'Crea la primera para explorar sus datos.', nota: null, ofrecerAlta: true }) &&
      j(vacioAreaSinConexiones({ hayAjenas: true, avisoFormato: null })) ===
        j({ titulo: TITULO_SOLO_AJENAS, pista: PISTA_SOLO_AJENAS, nota: null, ofrecerAlta: true }),
    'ok'
  )
  check(
    'la nota dice que no se pierde nada: el archivo no se toca y los montajes se conservan',
    NOTA_FORMATO_AJENO.includes('no se pierde nada') &&
      NOTA_FORMATO_AJENO.includes('no se modifica') &&
      NOTA_FORMATO_AJENO.includes('montadas en los proyectos se conservan'),
    j(NOTA_FORMATO_AJENO)
  )

  // El popover de montaje del agente.
  const pop = vistaPopoverMontaje({ conexiones: [], ajenas: [], montadas: ['c1', 'c2'], avisoFormato: AVISO })
  check('popover: con la marca, el AVISO (no el vacío «no tiene conexiones»)', j(pop) === j({ tipo: 'formato', aviso: AVISO }), j(pop))
  check(
    'popover: «Cargando…» sigue ganando mientras no hay respuesta',
    vistaPopoverMontaje({ conexiones: null, ajenas: [], montadas: [], avisoFormato: AVISO }).tipo === 'cargando',
    'ok'
  )
  check(
    'popover: la nota del montaje dice que las montadas se conservan',
    NOTA_MONTAJE_FORMATO_AJENO.includes('se conservan') && !/no tiene conexiones|Añádelas/.test(NOTA_MONTAJE_FORMATO_AJENO),
    j(NOTA_MONTAJE_FORMATO_AJENO)
  )
  // Mitades negativas: sin la marca, el comportamiento de siempre.
  const vacio = vistaPopoverMontaje({ conexiones: [], ajenas: [], montadas: [], avisoFormato: null })
  check(
    'NEGATIVO: sin la marca y sin nada, el vacío de siempre',
    j(vacio) === j({ tipo: 'vacio', texto: textoVacioMontaje(false) }),
    j(vacio)
  )
  check(
    'NEGATIVO: con solo ajenas sin montar, el vacío de las ajenas; con una MONTADA, la lista (para desmontarla)',
    j(vistaPopoverMontaje({ conexiones: [], ajenas: [{ id: 'a' }], montadas: [], avisoFormato: null })) ===
      j({ tipo: 'vacio', texto: textoVacioMontaje(true) }) &&
      vistaPopoverMontaje({ conexiones: [], ajenas: [{ id: 'a' }], montadas: ['a'], avisoFormato: null }).tipo === 'lista',
    'ok'
  )
  check(
    'NEGATIVO: con conexiones, la lista',
    vistaPopoverMontaje({ conexiones: [{}], ajenas: [], montadas: [], avisoFormato: null }).tipo === 'lista',
    'ok'
  )
  // Ningún texto de la UI nombra el sistema: el aviso sale igual en las dos plataformas.
  check(
    'NEGATIVO: ninguno de sus textos nombra el sistema',
    ![TITULO_FORMATO_AJENO, NOTA_FORMATO_AJENO, MOTIVO_FORMATO_AJENO, NOTA_MONTAJE_FORMATO_AJENO].some((t) =>
      /Windows|macOS|Finder|Explorador de/.test(t)
    ),
    'ok'
  )
}

// ---------------------------------------------------------------------------------
hr('(15) SQL Server: la base de las filas, su carga y el nombre de tres partes')
{
  const S: DbConnection = {
    id: 's1',
    profileId: 'P',
    alias: 'SQLS',
    motor: 'sqlserver',
    host: 'h',
    port: 1433,
    user: 'u',
    tieneSecreto: true,
    readonly: true,
    // Lo que se ve lo decide la configuración de la CONEXIÓN (sin ella, solo la por defecto).
    bases: { modo: 'todos' }
  }
  const filas = aplanarArbolBd({
    conexiones: [S],
    consolas: [],
    esquemas: new Map([
      [
        claveBd.base('s1', 'ventas'),
        { esquemas: [{ nombre: 'dbo', sistema: false, visible: true, porDefecto: true }], porDefecto: 'dbo', config: { modo: 'lista' as const, porDefecto: true, esquemas: [] }, nVisibles: 1 }
      ]
    ]),
    bases: new Map([
      [
        claveBd.bases('s1'),
        {
          bases: [
            { nombre: 'ventas', sistema: false, visible: true, porDefecto: true, accesible: true },
            { nombre: 'cerrada', sistema: false, visible: true, porDefecto: false, accesible: false }
          ],
          porDefecto: 'ventas',
          config: { modo: 'todos' },
          nVisibles: 2
        }
      ]
    ]),
    conteos: new Map([[claveBd.esquema('s1', 'dbo', 'ventas'), { tabla: 1 }]]),
    objetos: new Map([[claveBd.carpeta('s1', 'dbo', 'tabla', 'ventas'), [{ esquema: 'dbo', nombre: 'mi tabla', tipo: 'tabla' as const, base: 'ventas' }]]]),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([
      claveBd.conexion('s1'),
      claveBd.base('s1', 'ventas'),
      claveBd.esquema('s1', 'dbo', 'ventas'),
      claveBd.carpeta('s1', 'dbo', 'tabla', 'ventas')
    ])
  })
  const de = (kind: FilaBd['kind']): FilaBd | undefined => filas.find((f) => f.kind === kind)
  const fc = de('conexion')
  const fb = filas.find((f) => f.kind === 'base' && f.base === 'ventas')
  const fCerrada = filas.find((f) => f.kind === 'base' && f.base === 'cerrada')
  const fe = de('esquema')
  const fk = de('carpeta')
  const fo = de('objeto')
  check('conexión con nivel «Bases» -> `bases` (en claveBd.bases)', fc !== undefined && j(cargaDeFila(fc)) === j({ tipo: 'bases', clave: claveBd.bases('s1'), conexionId: 's1' }), j(fc && cargaDeFila(fc)))
  check('base -> sus esquemas, con la base', fb !== undefined && j(cargaDeFila(fb)) === j({ tipo: 'esquemas', clave: claveBd.base('s1', 'ventas'), conexionId: 's1', base: 'ventas' }), j(fb && cargaDeFila(fb)))
  check('base sin acceso -> nada', fCerrada !== undefined && cargaDeFila(fCerrada) === null, 'null')
  check('esquema de una base -> resumen con la base', fe !== undefined && cargaDeFila(fe)?.tipo === 'resumen' && (cargaDeFila(fe) as { base?: string }).base === 'ventas', j(fe && cargaDeFila(fe)))
  check('carpeta -> objetos con la base', fk !== undefined && (cargaDeFila(fk) as { base?: string } | null)?.base === 'ventas', j(fk && cargaDeFila(fk)))
  check('baseDeFila: la de la base y la de lo que cuelga de ella', fb !== undefined && fo !== undefined && baseDeFila(fb) === 'ventas' && baseDeFila(fo) === 'ventas' && fc !== undefined && baseDeFila(fc) === null, 'ok')
  check('copiar nombre de una base: la base', fb !== undefined && nombreDeFila(fb) === 'ventas', j(fb && nombreDeFila(fb)))
  const cual = fo ? nombreCualificadoDeFila(fo, 'sqlserver') : null
  check('nombre cualificado: TRES partes, citando lo que hace falta', cual !== null && cual.startsWith('ventas.dbo.') && cual.includes('mi tabla') && cual !== 'ventas.dbo.mi tabla', String(cual))
  check('conexionDeFila de una base', fb !== undefined && conexionDeFila(fb) === 's1', 'ok')
  // La mitad negativa: sin base (Oracle), el cualificado de siempre y ninguna base.
  const foOra = aplanarArbolBd({
    conexiones: [conexion('C1')],
    consolas: [],
    esquemas: new Map([[claveBd.conexion('C1'), { esquemas: [{ nombre: 'HR', sistema: false, visible: true, porDefecto: true }], porDefecto: 'HR', config: { modo: 'todos' }, nVisibles: 1 }]]),
    conteos: new Map([[claveBd.esquema('C1', 'HR'), { tabla: 1 }]]),
    objetos: new Map([[claveBd.carpeta('C1', 'HR', 'tabla'), [{ esquema: 'HR', nombre: 'EMP', tipo: 'tabla' as const }]]]),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([claveBd.conexion('C1'), claveBd.esquema('C1', 'HR'), claveBd.carpeta('C1', 'HR', 'tabla')])
  }).find((f) => f.kind === 'objeto')
  check('Oracle: sin base y el cualificado de siempre', foOra !== undefined && baseDeFila(foOra) === null && nombreCualificadoDeFila(foOra, 'oracle') === 'HR.EMP', j(foOra && nombreCualificadoDeFila(foOra, 'oracle')))
}

// ---------------------------------------------------------------------------------
// «Desconectar» de la cabecera: misma regla que el menú contextual de la conexión
// (`tieneSesiones`).
hr('(D) «Desconectar» de la cabecera: vivo solo con una conexión conectada seleccionada')
{
  const c1 = { id: 'C1', alias: 'Ventas' }
  const conectada = accionDesconectarCabecera(c1, [sesion('C1', 'lista')])
  check('conexión con sesión abierta: vivo, y el título la nombra', conectada.motivo === null && conectada.titulo === 'Desconectar Ventas', j(conectada))
  check(
    'NEGATIVO: sin nada seleccionado (o una ajena), apagado con su porqué',
    j(accionDesconectarCabecera(null, [sesion('C1', 'lista')])) === j({ titulo: 'Desconectar', motivo: MOTIVO_DESCONECTAR_SIN_SELECCION }),
    j(accionDesconectarCabecera(null, []))
  )
  const sinSesion = accionDesconectarCabecera(c1, [sesion('C2', 'lista')])
  check('NEGATIVO: la conexión seleccionada sin sesión (otra sí conectada): apagado', sinSesion.motivo === 'Ventas no está conectada', j(sinSesion))
  check(
    'NEGATIVO: una sesión ya CERRADA no cuenta como conectada (como en el menú contextual)',
    accionDesconectarCabecera(c1, [sesion('C1', 'cerrada')]).motivo !== null &&
      tieneSesiones([sesion('C1', 'cerrada')], 'C1') === false,
    'ok'
  )
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
