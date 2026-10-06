#!/usr/bin/env node
// =============================================================================
// Prueba de la lista de conexiones SSH (npm run test:lista-ssh): el orden («Sin grupo» primero y solo si
// tiene conexiones), el filtro sin tildes ni mayúsculas con varias palabras, la búsqueda por alias, host,
// usuario y grupo (nunca por puerto ni id), los plegados, la lista plana sin grupos y el teclado en
// Windows y en Mac (Supr y ⌘⌫ borran, ⌫ suelto no), las reglas del riel de pantalla completa (cuándo
// cabe, hasta dónde se ensancha, qué ve el usuario) y las del lanzador: un solo grupo abierto y ninguno
// al abrirlo, las conexiones recientes, dónde se enseña la lista cuando la piden y cuándo se ve su ▾.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/riel-de-conexiones.md,
// docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import {
  accionTeclaLista,
  cabeceraDe,
  construirFilas,
  destinoSsh,
  NOMBRE_CONEXIONES,
  NOMBRE_RECIENTES,
  plegadosDeAcordeon,
  primeraConexion,
  RECIENTES_MAX,
  recientesDe,
  siguienteGrupoAbierto,
  textoSinCoincidencias,
  type AccionLista,
  type FilaLista,
  type TeclaLista
} from './listaSsh.ts'
import {
  anchoMaximoRiel,
  dondeConectar,
  flechaLanzadorVisible,
  ID_LANZADOR_SSH,
  ID_RIEL_SSH,
  lanzadorSeCierra,
  RIEL_DIVISOR,
  RIEL_MARGEN_PLIEGUE,
  resolverRiel,
  rielCabe,
  TERMINAL_ANCHO_MIN,
  type EntradaRiel,
  type ModoLanzador
} from './rielSsh.ts'
import { SSH_RIEL_ANCHO_MAX, SSH_RIEL_ANCHO_MIN, SSH_RIEL_ANCHO_POR_DEFECTO } from '../../../../shared/ajustesTerminal.ts'
import type { Plataforma } from '../../../../shared/plataforma.ts'
import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc.ts'

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

function con(id: string, alias: string, extra: Partial<SshConexion> = {}): SshConexion {
  return {
    id,
    profileId: 'personal',
    alias,
    grupoId: null,
    host: `${id}.ejemplo`,
    puerto: 22,
    usuario: 'root',
    metodo: 'contrasena',
    tieneSecreto: false,
    disponibleAgentes: true,
    huellaServidor: [],
    ...extra
  }
}
const grupo = (id: string, nombre: string): SshGrupo => ({ id, profileId: 'personal', nombre })

const GRUPOS = [grupo('gB', 'Bases'), grupo('gA', 'Árboles'), grupo('gV', 'Vacío')]
const CONEXIONES = [
  con('c1', 'router casa', { usuario: 'admin', host: '192.0.2.1', puerto: 2222 }),
  con('c2', 'Servidor 10', { grupoId: 'gB', usuario: 'postgres' }),
  con('c3', 'servidor 2', { grupoId: 'gB' }),
  con('c4', 'Nube', { grupoId: 'gA', host: 'nube.ejemplo' }),
  con('c5', 'Ñandú', { grupoId: null, usuario: 'Zoe' }),
  con('c6', 'Huérfana', { grupoId: null, grupoDesconocido: true })
]

function filas(
  extra: { filtro?: string; plegados?: string[]; grupos?: SshGrupo[]; conexiones?: SshConexion[]; recientes?: SshConexion[] } = {}
): FilaLista[] {
  return construirFilas({
    grupos: extra.grupos ?? GRUPOS,
    conexiones: extra.conexiones ?? CONEXIONES,
    filtro: extra.filtro ?? '',
    plegados: new Set(extra.plegados ?? []),
    recientes: extra.recientes
  })
}
/** Las filas como texto: `{Rótulo}`, `[Cabecera n]`, `conexión` y `r:conexión` (la de «Recientes»), para ver el orden de un vistazo. */
function ver(fs: FilaLista[]): string {
  return fs
    .map((f) => {
      if (f.tipo === 'seccion') return `{${f.nombre}}`
      if (f.tipo === 'grupo') return `[${f.nombre} ${f.total}${f.abierto ? '' : ' plegado'}]`
      return f.reciente ? `r:${f.conexion.alias}` : f.conexion.alias
    })
    .join(' | ')
}

hr('(1) El orden: «Sin grupo» primero y solo si tiene conexiones, luego los grupos, y dentro las conexiones')
{
  const f = filas()
  check(
    'Sin grupo, luego los grupos por nombre (sin tildes: Árboles antes que Bases) y las conexiones por alias',
    ver(f) === '[Sin grupo 3] | Huérfana | Ñandú | router casa | [Árboles 1] | Nube | [Bases 2] | servidor 2 | Servidor 10 | [Vacío 0]',
    ver(f)
  )
  check('los números se ordenan por su valor: «servidor 2» antes que «Servidor 10»', ver(f).indexOf('servidor 2') < ver(f).indexOf('Servidor 10'), 'servidor 2 < Servidor 10')
  check('un grupo vacío se ve (para poder renombrarlo, borrarlo o llenarlo)', ver(f).includes('[Vacío 0]'), '[Vacío 0]')
  check('un grupo que esta versión no conoce se enseña en Sin grupo', ver(f).includes('Huérfana'), 'Huérfana en Sin grupo')
  const sinSueltas = filas({ conexiones: CONEXIONES.filter((c) => c.grupoId !== null && !c.grupoDesconocido) })
  check('sin conexiones sueltas no hay cabecera «Sin grupo»', !ver(sinSueltas).includes('Sin grupo'), ver(sinSueltas))
  const cab = f.find((x) => x.tipo === 'grupo' && x.grupoId === 'gB')
  check('cada cabecera dice su clave, si es real y su recuento', cab?.tipo === 'grupo' && cab.clave === 'g:gB' && cab.real && cab.total === 2, j(cab))
  check('«Sin grupo» no es un grupo real (no se renombra ni se borra)', f[0].tipo === 'grupo' && !f[0].real && f[0].grupoId === '', j(f[0]))
}

hr('(2) Sin grupos en el perfil: lista plana, sin cabeceras')
{
  const plana = filas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })) })
  check('ninguna cabecera y todas a nivel 1', plana.every((x) => x.tipo === 'conexion' && x.nivel === 1), ver(plana))
  check('ordenadas por alias', ver(plana) === 'Huérfana | Nube | Ñandú | router casa | servidor 2 | Servidor 10', ver(plana))
  const anidada = filas()
  check('con grupos, las conexiones cuelgan a nivel 2', anidada.filter((x) => x.tipo === 'conexion').every((x) => x.tipo === 'conexion' && x.nivel === 2), 'nivel 2')
}

hr('(3) El filtro: sin tildes ni mayúsculas, todas las palabras, y en qué campos busca')
{
  check('«nandu» encuentra «Ñandú» (sin tildes ni eñes)', ver(filas({ filtro: 'nandu' })).includes('Ñandú'), ver(filas({ filtro: 'nandu' })))
  check('«ARBOLES» casa con el grupo «Árboles»', ver(filas({ filtro: 'ARBOLES' })) === '[Árboles 1] | Nube', ver(filas({ filtro: 'ARBOLES' })))
  check('busca por usuario: «postgres»', ver(filas({ filtro: 'postgres' })) === '[Bases 1] | Servidor 10', ver(filas({ filtro: 'postgres' })))
  check('busca por host: «nube.ejem»', ver(filas({ filtro: 'nube.ejem' })).includes('Nube'), ver(filas({ filtro: 'nube.ejem' })))
  check('varias palabras = todas: «servidor postgres» deja solo la que cumple las dos', ver(filas({ filtro: 'servidor postgres' })) === '[Bases 1] | Servidor 10', ver(filas({ filtro: 'servidor postgres' })))
  check('las palabras pueden salir de campos distintos: «bases servidor» (grupo y alias)', ver(filas({ filtro: 'bases servidor' })) === '[Bases 2] | servidor 2 | Servidor 10', ver(filas({ filtro: 'bases servidor' })))
  check('si casa el grupo salen todas sus conexiones, aunque su alias no case', ver(filas({ filtro: 'bases' })) === '[Bases 2] | servidor 2 | Servidor 10', ver(filas({ filtro: 'bases' })))
  check('un grupo vacío cuyo nombre casa se ve', ver(filas({ filtro: 'vacio' })) === '[Vacío 0]', ver(filas({ filtro: 'vacio' })))
  check('los grupos sin coincidencias desaparecen', !ver(filas({ filtro: 'nube' })).includes('Bases'), ver(filas({ filtro: 'nube' })))
  check('con espacios de más y en mayúsculas sigue casando', ver(filas({ filtro: '  NUBE  ' })) === '[Árboles 1] | Nube', ver(filas({ filtro: '  NUBE  ' })))
  check('sin coincidencias no hay filas', filas({ filtro: 'zzz' }).length === 0, String(filas({ filtro: 'zzz' }).length))
  check('el texto del estado sin coincidencias', textoSinCoincidencias(' zz ') === 'Ninguna conexión coincide con "zz"', textoSinCoincidencias(' zz '))
}

hr('(4) Mitades negativas del filtro: nunca por puerto ni por id')
{
  check('el puerto no casa: «2222» no encuentra «router casa», que lo tiene', filas({ filtro: '2222' }).length === 0, ver(filas({ filtro: '2222' })))
  const conId = [con('zzid9', 'Alfa', { host: 'alfa.ejemplo' })]
  const buscar = (filtro: string): number => construirFilas({ grupos: [], conexiones: conId, filtro, plegados: new Set() }).length
  check('el id no casa: «zzid9» no encuentra «Alfa»', buscar('zzid9') === 0, `${buscar('zzid9')} filas`)
  check('y el alias de esa misma conexión sí la encuentra', buscar('alfa') === 1, `${buscar('alfa')} fila`)
}

hr('(5) Los plegados: con filtro se ignoran')
{
  const plegado = filas({ plegados: ['gB', ''] })
  check('un grupo plegado enseña su cabecera con el recuento y no sus conexiones', ver(plegado) === '[Sin grupo 3 plegado] | [Árboles 1] | Nube | [Bases 2 plegado] | [Vacío 0]', ver(plegado))
  const conFiltro = filas({ plegados: ['gB'], filtro: 'servidor' })
  check('con filtro, un grupo plegado se enseña abierto', ver(conFiltro) === '[Bases 2] | servidor 2 | Servidor 10', ver(conFiltro))
  const sinSueltas = filas({ plegados: [''] })
  check(
    'plegar «Sin grupo» se nombra con la cadena vacía y deja el resto abierto',
    ver(sinSueltas) === '[Sin grupo 3 plegado] | [Árboles 1] | Nube | [Bases 2] | servidor 2 | Servidor 10 | [Vacío 0]',
    ver(sinSueltas)
  )
  check('nada plegado enseña las diez filas', filas().length === 10, String(filas().length))
}

hr('(6) Cabeceras y cursor')
{
  const f = filas()
  check('el cursor nace en la primera conexión', primeraConexion(f) === 1, String(primeraConexion(f)))
  check('solo cabeceras: nace en la primera fila; sin filas, -1', primeraConexion(filas({ conexiones: [] })) === 0 && primeraConexion([]) === -1, '0 · -1')
  check('la cabecera de una conexión de nivel 2 es la de su grupo', cabeceraDe(f, 7) === 6 && cabeceraDe(f, 6) === -1, `${cabeceraDe(f, 7)} · ${cabeceraDe(f, 6)}`)
  const plana = filas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })) })
  check('una conexión de la lista plana no tiene cabecera', cabeceraDe(plana, 0) === -1, String(cabeceraDe(plana, 0)))
}

hr('(7) El destino: usuario@host, con el puerto solo si no es el 22')
{
  check('puerto 22: sin puerto', destinoSsh({ usuario: 'root', host: 'srv.ejemplo', puerto: 22 }) === 'root@srv.ejemplo', destinoSsh({ usuario: 'root', host: 'srv.ejemplo', puerto: 22 }))
  check('otro puerto: se escribe', destinoSsh({ usuario: 'admin', host: '192.0.2.1', puerto: 2222 }) === 'admin@192.0.2.1:2222', destinoSsh({ usuario: 'admin', host: '192.0.2.1', puerto: 2222 }))
}

// --- Teclado ---------------------------------------------------------------
const tecla = (key: string, extra: Partial<TeclaLista> = {}): TeclaLista => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
const F = filas()
/** índices: 0 [Sin grupo] 1 Huérfana 2 Ñandú 3 router casa 4 [Árboles] 5 Nube 6 [Bases] 7 servidor 2 8 Servidor 10 9 [Vacío] */
function accion(e: TeclaLista, activo: number, o: { filtroVacio?: boolean; plataforma?: Plataforma; filas?: FilaLista[] } = {}): AccionLista | null {
  return accionTeclaLista(e, { filas: o.filas ?? F, activo, filtroVacio: o.filtroVacio ?? true }, o.plataforma ?? 'windows')
}

hr('(8) Teclado: ↑ y ↓ no dan la vuelta; ← y → solo con el filtro vacío')
{
  check('↓ baja una fila', j(accion(tecla('ArrowDown'), 1)) === j({ tipo: 'mover', indice: 2 }), j(accion(tecla('ArrowDown'), 1)))
  check('↓ en la última fila se queda (no da la vuelta)', j(accion(tecla('ArrowDown'), 9)) === j({ tipo: 'mover', indice: 9 }), j(accion(tecla('ArrowDown'), 9)))
  check('↑ en la primera fila se queda', j(accion(tecla('ArrowUp'), 0)) === j({ tipo: 'mover', indice: 0 }), j(accion(tecla('ArrowUp'), 0)))
  check('sin fila activa, ↓ va a la primera', j(accion(tecla('ArrowDown'), -1)) === j({ tipo: 'mover', indice: 0 }), j(accion(tecla('ArrowDown'), -1)))
  check('sin filas no hay movimiento', accion(tecla('ArrowDown'), -1, { filas: [] }) === null, 'null')
  check('→ sobre un grupo plegado lo despliega', j(accion(tecla('ArrowRight'), 6, { filas: filas({ plegados: ['gB'] }) })) === j({ tipo: 'plegar', grupoId: 'gB', plegar: false }), j(accion(tecla('ArrowRight'), 6, { filas: filas({ plegados: ['gB'] }) })))
  check('→ sobre un grupo abierto baja a su primera conexión', j(accion(tecla('ArrowRight'), 6)) === j({ tipo: 'mover', indice: 7 }), j(accion(tecla('ArrowRight'), 6)))
  check('← sobre un grupo abierto lo pliega', j(accion(tecla('ArrowLeft'), 6)) === j({ tipo: 'plegar', grupoId: 'gB', plegar: true }), j(accion(tecla('ArrowLeft'), 6)))
  check('← sobre una conexión sube a su cabecera', j(accion(tecla('ArrowLeft'), 7)) === j({ tipo: 'mover', indice: 6 }), j(accion(tecla('ArrowLeft'), 7)))
  check('MITAD NEGATIVA: con texto en el filtro, ← y → son del campo', accion(tecla('ArrowLeft'), 6, { filtroVacio: false }) === null && accion(tecla('ArrowRight'), 6, { filtroVacio: false }) === null, 'null · null')
  check('con texto en el filtro, ↑ y ↓ siguen moviendo la lista', accion(tecla('ArrowDown'), 1, { filtroVacio: false })?.tipo === 'mover', 'mover')
  check('Inicio y Fin: a los extremos, solo con el filtro vacío', j(accion(tecla('Home'), 5)) === j({ tipo: 'mover', indice: 0 }) && j(accion(tecla('End'), 5)) === j({ tipo: 'mover', indice: 9 }) && accion(tecla('Home'), 5, { filtroVacio: false }) === null, 'Home -> 0 · End -> 9 · con texto -> null')
  check('con un modificador (Ctrl+↓) no es de la lista', accion(tecla('ArrowDown', { ctrlKey: true }), 1) === null, 'null')
}

hr('(9) Teclado: Intro conecta o pliega, F2 edita o renombra, Mayús+F10 abre el menú')
{
  check('Intro sobre una conexión conecta', j(accion(tecla('Enter'), 1)) === j({ tipo: 'conectar', conexionId: 'c6' }), j(accion(tecla('Enter'), 1)))
  check('Intro sobre una cabecera la pliega (o despliega)', j(accion(tecla('Enter'), 6)) === j({ tipo: 'plegar', grupoId: 'gB', plegar: true }), j(accion(tecla('Enter'), 6)))
  check('con filtro, Intro sobre una cabecera no hace nada: no se pliega', accion(tecla('Enter'), 6, { filtroVacio: false }) === null, 'null')
  check('F2 sobre una conexión la edita', j(accion(tecla('F2'), 8)) === j({ tipo: 'editar', conexionId: 'c2' }), j(accion(tecla('F2'), 8)))
  check('F2 sobre un grupo real lo renombra', j(accion(tecla('F2'), 4)) === j({ tipo: 'renombrarGrupo', grupoId: 'gA' }), j(accion(tecla('F2'), 4)))
  check('MITAD NEGATIVA: F2 sobre «Sin grupo» no renombra nada', accion(tecla('F2'), 0) === null, 'null')
  check('Mayús+F10 abre el menú de la fila activa', j(accion(tecla('F10', { shiftKey: true }), 3)) === j({ tipo: 'menu', indice: 3 }), j(accion(tecla('F10', { shiftKey: true }), 3)))
  check('la tecla de menú también', j(accion(tecla('ContextMenu'), 3)) === j({ tipo: 'menu', indice: 3 }), j(accion(tecla('ContextMenu'), 3)))
  check('F10 a secas no abre el menú', accion(tecla('F10'), 3) === null, 'null')
}

hr('(10) Teclado: Supr (Windows) y ⌘⌫ (Mac) eliminan; ⌫ suelto no')
{
  const eliminarC2 = j({ tipo: 'eliminarConexion', conexionId: 'c2' })
  check('Windows: Supr elimina la conexión activa', j(accion(tecla('Delete'), 8, { plataforma: 'windows' })) === eliminarC2, j(accion(tecla('Delete'), 8, { plataforma: 'windows' })))
  check('Mac: ⌘⌫ elimina la conexión activa', j(accion(tecla('Backspace', { metaKey: true }), 8, { plataforma: 'mac' })) === eliminarC2, j(accion(tecla('Backspace', { metaKey: true }), 8, { plataforma: 'mac' })))
  check('Mac: Supr (⌦ de un teclado completo) también', j(accion(tecla('Delete'), 8, { plataforma: 'mac' })) === eliminarC2, 'Delete')
  check('MITAD NEGATIVA: ⌫ suelto no elimina en ninguna plataforma', accion(tecla('Backspace'), 8, { plataforma: 'windows' }) === null && accion(tecla('Backspace'), 8, { plataforma: 'mac' }) === null, 'null · null')
  check('MITAD NEGATIVA: Ctrl+⌫ en Windows ni ⌘⌫ en Windows eliminan', accion(tecla('Backspace', { ctrlKey: true }), 8, { plataforma: 'windows' }) === null && accion(tecla('Backspace', { metaKey: true }), 8, { plataforma: 'windows' }) === null, 'null · null')
  check('MITAD NEGATIVA: Mayús+Supr no elimina', accion(tecla('Delete', { shiftKey: true }), 8) === null, 'null')
  check('sobre un grupo real, elimina el grupo; sobre «Sin grupo», nada', j(accion(tecla('Delete'), 6)) === j({ tipo: 'eliminarGrupo', grupoId: 'gB' }) && accion(tecla('Delete'), 0) === null, 'eliminarGrupo · null')
  check('MITAD NEGATIVA: con texto en el filtro, Supr es del campo y no elimina', accion(tecla('Delete'), 8, { filtroVacio: false }) === null, 'null')
  check('sin fila activa no elimina', accion(tecla('Delete'), -1) === null, 'null')
}

hr('(11) El riel de pantalla completa: cuándo cabe, hasta dónde se ensancha y qué se ve')
{
  const umbral = (ancho: number): number => TERMINAL_ANCHO_MIN + RIEL_DIVISOR + ancho
  check(
    'la terminal no baja de 420 px: el mínimo y el divisor son los de la regla',
    TERMINAL_ANCHO_MIN === 420 && RIEL_DIVISOR === 6,
    `${TERMINAL_ANCHO_MIN} · ${RIEL_DIVISOR}`
  )
  check(
    'el riel de 260 px cabe justo en 686 px y deja de caber en 685 (420 de terminal + 6 del divisor + 260)',
    rielCabe(686, 260) && !rielCabe(685, 260),
    `${rielCabe(686, 260)} · ${rielCabe(685, 260)}`
  )
  check(
    'el borde es el mismo con el mínimo (180) y con el máximo (480)',
    rielCabe(umbral(180), 180) && !rielCabe(umbral(180) - 1, 180) && rielCabe(umbral(480), 480) && !rielCabe(umbral(480) - 1, 480),
    `${umbral(180)} · ${umbral(480)}`
  )
  check('sin medir (0 px) o con un ancho absurdo, no cabe', !rielCabe(0, 260) && !rielCabe(-10, 180), 'false · false')
  check(
    'un riel más ancho necesita más sitio: con 700 px cabe el mínimo y no el máximo',
    rielCabe(700, SSH_RIEL_ANCHO_MIN) && !rielCabe(700, SSH_RIEL_ANCHO_MAX),
    `${rielCabe(700, SSH_RIEL_ANCHO_MIN)} · ${rielCabe(700, SSH_RIEL_ANCHO_MAX)}`
  )
  let barrido = true
  for (let d = 0; d <= 2500; d += 7) {
    for (const a of [SSH_RIEL_ANCHO_MIN, 200, SSH_RIEL_ANCHO_POR_DEFECTO, 333, SSH_RIEL_ANCHO_MAX]) {
      // Cabe si y solo si el ancho no pasa de lo que sobra; y entonces el tope de su divisor nunca queda por debajo
      // de su ancho (si no, `aria-valuenow` pasaría de `aria-valuemax` y al agarrarlo el riel se encogería solo).
      const sobra = d - TERMINAL_ANCHO_MIN - RIEL_DIVISOR
      if (rielCabe(d, a) !== (a <= sobra)) barrido = false
      if (rielCabe(d, a) && a > anchoMaximoRiel(d, a)) barrido = false
    }
  }
  check('barrido 0..2500 px: cabe ⇔ el ancho no pasa de lo que sobra, y lo que cabe nunca supera el tope de su divisor', barrido, 'sin discrepancias')

  check(
    'el tope del divisor es lo que deja la terminal en su mínimo MÁS el margen: 2000 px -> tope 480; 800 -> 334; 686 -> 220',
    anchoMaximoRiel(2000) === SSH_RIEL_ANCHO_MAX && anchoMaximoRiel(800) === 334 && anchoMaximoRiel(686) === 220,
    `${anchoMaximoRiel(2000)} · ${anchoMaximoRiel(800)} · ${anchoMaximoRiel(686)}`
  )
  check(
    'con tan poco sitio que ni el mínimo cabe, el tope no baja del suelo del riel (180)',
    anchoMaximoRiel(300) === SSH_RIEL_ANCHO_MIN && anchoMaximoRiel(0) === SSH_RIEL_ANCHO_MIN,
    `${anchoMaximoRiel(300)} · ${anchoMaximoRiel(0)}`
  )

  // El margen de pliegue: llevado al tope, el riel no queda al borde de plegarse.
  const tope800 = anchoMaximoRiel(800)
  check(
    'el margen es de 40 px: el caso del hallazgo, en 800 px con el riel al tope, perder 1 px del cuerpo (o hasta 40) no lo pliega',
    RIEL_MARGEN_PLIEGUE === 40 &&
      rielCabe(800, tope800) &&
      rielCabe(799, tope800) &&
      rielCabe(800 - RIEL_MARGEN_PLIEGUE, tope800) &&
      !rielCabe(800 - RIEL_MARGEN_PLIEGUE - 1, tope800),
    `tope ${tope800} · cabe en 800/799/760: ${rielCabe(800, tope800)}/${rielCabe(799, tope800)}/${rielCabe(760, tope800)} · en 759: ${rielCabe(759, tope800)}`
  )
  // Desde que el sitio da al menos el suelo del riel (180) el tope lo fija el sitio, no el suelo.
  const sitioConSuelo = TERMINAL_ANCHO_MIN + RIEL_DIVISOR + RIEL_MARGEN_PLIEGUE + SSH_RIEL_ANCHO_MIN
  let holgura = true
  let exacta = true
  let enRango = true
  for (let d = 0; d <= 2500; d++) {
    const tope = anchoMaximoRiel(d)
    if (tope < SSH_RIEL_ANCHO_MIN || tope > SSH_RIEL_ANCHO_MAX) enRango = false
    if (d < sitioConSuelo) continue
    if (!rielCabe(d - RIEL_MARGEN_PLIEGUE, tope)) holgura = false
    // Mientras lo limita el sitio (y no el máximo del rango) la holgura es justo el margen: un píxel más y se pliega.
    if (tope < SSH_RIEL_ANCHO_MAX && rielCabe(d - RIEL_MARGEN_PLIEGUE - 1, tope)) exacta = false
  }
  check(
    `barrido ${sitioConSuelo}..2500 px: arrastrado al tope, el riel aguanta que el cuerpo pierda el margen entero, y no más si lo limita el sitio`,
    holgura && exacta,
    `holgura ${holgura} · exacta ${exacta}`
  )
  check('barrido 0..2500 px: el tope siempre está dentro del rango del riel (180..480)', enRango, `${enRango}`)
  check(
    'un riel que ya mide más que ese tope (ventana estrecha) no se encoge al agarrarlo: su ancho es el tope, y uno más estrecho sigue limitado por el sitio',
    anchoMaximoRiel(930) === 464 && anchoMaximoRiel(930, 480) === 480 && anchoMaximoRiel(930, 400) === 464 && rielCabe(930, 480),
    `${anchoMaximoRiel(930)} · ${anchoMaximoRiel(930, 480)} · ${anchoMaximoRiel(930, 400)}`
  )

  const base: EntradaRiel = { pantallaCompleta: true, perfilId: 'personal', oculto: false, disponible: 1400, ancho: 260 }
  const ve = (e: Partial<EntradaRiel>): string => j(resolverRiel({ ...base, ...e }))
  check('a pantalla completa, con perfil y sitio, el riel se ve', ve({}) === j({ enRiel: true, visible: true }), ve({}))
  check(
    'MITAD NEGATIVA: fuera de pantalla completa no hay riel, aunque haya sitio y el perfil no lo oculte',
    ve({ pantallaCompleta: false }) === j({ enRiel: false, visible: false }),
    ve({ pantallaCompleta: false })
  )
  check('sin perfil no hay conexiones que enseñar: ni riel', ve({ perfilId: '' }) === j({ enRiel: false, visible: false }), ve({ perfilId: '' }))
  check(
    'un perfil que lo ocultó sigue en modo riel (el botón lo alterna) pero no lo ve',
    ve({ oculto: true }) === j({ enRiel: true, visible: false }),
    ve({ oculto: true })
  )
  check(
    'sin sitio el riel se pliega solo y deja de ser riel (el botón vuelve al popover): 600 px no admiten 260',
    ve({ disponible: 600 }) === j({ enRiel: false, visible: false }),
    ve({ disponible: 600 })
  )
  check(
    'y reaparece solo al ensanchar, con la misma preferencia: no hay nada que guardar ni deshacer',
    ve({ disponible: 600 }) === j({ enRiel: false, visible: false }) && ve({ disponible: 1400 }) === j({ enRiel: true, visible: true }),
    `${ve({ disponible: 600 })} -> ${ve({ disponible: 1400 })}`
  )
  check(
    'lo que decide es el ancho que pide: con 900 px cabe el de 260 y no el de 480',
    ve({ disponible: 900, ancho: 260 }) === j({ enRiel: true, visible: true }) && ve({ disponible: 900, ancho: 480 }) === j({ enRiel: false, visible: false }),
    `${ve({ disponible: 900, ancho: 260 })} · ${ve({ disponible: 900, ancho: 480 })}`
  )
  check(
    'la resolución no devuelve preferencia alguna: plegar por falta de sitio no la toca',
    j(Object.keys(resolverRiel(base)).sort()) === j(['enRiel', 'visible']),
    j(Object.keys(resolverRiel(base)))
  )
  let coherente = true
  for (const pantallaCompleta of [true, false]) {
    for (const perfilId of ['', 'personal']) {
      for (const oculto of [true, false]) {
        for (const disponible of [0, 500, 686, 1400]) {
          const r = resolverRiel({ pantallaCompleta, perfilId, oculto, disponible, ancho: 260 })
          if (r.visible && !r.enRiel) coherente = false
        }
      }
    }
  }
  check('todas las combinaciones: lo que se ve siempre está en modo riel', coherente, '2 · 2 · 2 · 4 casos')
  check(
    'el id del riel y su rango: ssh-riel, 180 ≤ 260 ≤ 480',
    ID_RIEL_SSH === 'ssh-riel' && SSH_RIEL_ANCHO_MIN <= SSH_RIEL_ANCHO_POR_DEFECTO && SSH_RIEL_ANCHO_POR_DEFECTO <= SSH_RIEL_ANCHO_MAX,
    `${ID_RIEL_SSH} · ${SSH_RIEL_ANCHO_MIN}/${SSH_RIEL_ANCHO_POR_DEFECTO}/${SSH_RIEL_ANCHO_MAX}`
  )
}

hr('(12) Dónde se enseña la lista cuando la piden («Conectar por SSH…»), cuándo se ve la ▾ y cuándo se cierra el lanzador abierto')
{
  const donde = (e: { enRiel: boolean; visible: boolean }): string => dondeConectar(e)
  check('con el riel a la vista, la lista que se pide es el riel (se le da el foco): no se abre el lanzador', donde({ enRiel: true, visible: true }) === 'riel', donde({ enRiel: true, visible: true }))
  check(
    'con el riel plegado a mano sigue el lanzador, sin mostrar el riel: no hay preferencia que guardar',
    donde({ enRiel: true, visible: false }) === 'lanzador',
    donde({ enRiel: true, visible: false })
  )
  check(
    'fuera de pantalla completa, o sin sitio para el riel: el lanzador de siempre',
    donde({ enRiel: false, visible: false }) === 'lanzador',
    donde({ enRiel: false, visible: false })
  )
  let coherente = true
  for (const enRiel of [true, false]) {
    for (const visible of [true, false]) {
      if (visible && !enRiel) continue
      if ((dondeConectar({ enRiel, visible }) === 'riel') !== visible) coherente = false
    }
  }
  check('todas las vistas coherentes: va al riel si y solo si se ve', coherente, '3 casos')
  const entrada = (e: Partial<EntradaRiel> = {}): EntradaRiel => ({
    pantallaCompleta: true,
    perfilId: 'personal',
    oculto: false,
    disponible: 1400,
    ancho: 260,
    ...e
  })
  const resuelve = (e: Partial<EntradaRiel>): string => dondeConectar(resolverRiel(entrada(e)))
  check(
    'alimentada por `resolverRiel`: a la vista -> riel; ocultado a mano, estrecho o sin pantalla completa -> lanzador',
    resuelve({}) === 'riel' && resuelve({ oculto: true }) === 'lanzador' && resuelve({ disponible: 600 }) === 'lanzador' && resuelve({ pantallaCompleta: false }) === 'lanzador',
    `${resuelve({})} · ${resuelve({ oculto: true })} · ${resuelve({ disponible: 600 })} · ${resuelve({ pantallaCompleta: false })}`
  )
  // La ▾ del lanzador: se ve solo cuando la lista no está ya a la vista en el riel (los cuatro estados, por `resolverRiel`).
  const flecha = (e: Partial<EntradaRiel> = {}): boolean => flechaLanzadorVisible(resolverRiel(entrada(e)))
  check('fuera de pantalla completa la ▾ se ve: no hay riel y nada cambia', flecha({ pantallaCompleta: false }), String(flecha({ pantallaCompleta: false })))
  check('MITAD NEGATIVA: a pantalla completa con el riel a la vista la ▾ no se ve, porque el riel ya es la lista', !flecha(), String(flecha()))
  check('con el riel plegado a mano la ▾ vuelve: la lista nunca se queda sin entrada', flecha({ oculto: true }), String(flecha({ oculto: true })))
  check(
    'con el riel plegado solo por falta de sitio (600 px no admiten 260) la ▾ vuelve, y se va otra vez al ensanchar',
    flecha({ disponible: 600 }) && !flecha({ disponible: 1400 }),
    `${flecha({ disponible: 600 })} -> ${flecha({ disponible: 1400 })}`
  )
  check(
    'lo que decide es el ancho que pide el riel: con 900 px cabe el de 260 (sin ▾) y no el de 480 (con ▾)',
    !flecha({ disponible: 900, ancho: 260 }) && flecha({ disponible: 900, ancho: 480 }),
    `${flecha({ disponible: 900, ancho: 260 })} · ${flecha({ disponible: 900, ancho: 480 })}`
  )
  check('sin perfil no hay riel y la ▾ sigue en su sitio (la cabecera la deshabilita)', flecha({ perfilId: '' }), String(flecha({ perfilId: '' })))
  let siempreUna = true
  let nuncaDos = true
  let comoDondeConectar = true
  let casos = 0
  for (const pantallaCompleta of [true, false]) {
    for (const perfilId of ['', 'personal']) {
      for (const oculto of [true, false]) {
        for (const disponible of [0, 500, 686, 1400]) {
          for (const ancho of [SSH_RIEL_ANCHO_MIN, SSH_RIEL_ANCHO_POR_DEFECTO, SSH_RIEL_ANCHO_MAX]) {
            const r = resolverRiel({ pantallaCompleta, perfilId, oculto, disponible, ancho })
            const conFlecha = flechaLanzadorVisible(r)
            if (!r.visible && !conFlecha) siempreUna = false
            if (r.visible && conFlecha) nuncaDos = false
            if (conFlecha !== (dondeConectar(r) === 'lanzador')) comoDondeConectar = false
            casos++
          }
        }
      }
    }
  }
  check('todas las combinaciones: la lista nunca se queda sin entrada (el riel o la ▾)', siempreUna, `${casos} casos`)
  check('y nunca tiene las dos a la vez', nuncaDos, `${casos} casos`)
  check('la ▾ es la otra cara de dónde se pide la lista: se ve si y solo si se pide al lanzador', comoDondeConectar, `${casos} casos`)

  const modo = (pantallaCompleta: boolean, flechaVisible: boolean): ModoLanzador => ({ pantallaCompleta, flechaVisible })
  check(
    'el lanzador abierto se cierra si cambia la pantalla completa (la ▾ ya no está donde se midió), en los dos sentidos',
    lanzadorSeCierra(modo(false, true), modo(true, true)) && lanzadorSeCierra(modo(true, true), modo(false, true)),
    'true · true'
  )
  check('y se cierra si la ▾ deja de verse con el mismo modo: el riel pasa a enseñar la lista', lanzadorSeCierra(modo(true, true), modo(true, false)), 'true')
  const modoDe = (e: Partial<EntradaRiel>): ModoLanzador => ({ pantallaCompleta: entrada(e).pantallaCompleta, flechaVisible: flecha(e) })
  check(
    'alimentada por `resolverRiel`: mostrar el riel (con su conmutador o al ensanchar la ventana) lo cierra; plegarlo, no',
    lanzadorSeCierra(modoDe({ oculto: true }), modoDe({ oculto: false })) &&
      lanzadorSeCierra(modoDe({ disponible: 600 }), modoDe({ disponible: 1400 })) &&
      !lanzadorSeCierra(modoDe({ oculto: false }), modoDe({ oculto: true })) &&
      !lanzadorSeCierra(modoDe({ disponible: 1400 }), modoDe({ disponible: 600 })),
    'true · true · false · false'
  )
  check(
    'MITAD NEGATIVA: si ni el modo ni la ▾ cambian no se cierra',
    [true, false].every((pc) => [true, false].every((f) => !lanzadorSeCierra(modo(pc, f), modo(pc, f)))),
    'false en los 4 casos'
  )
  check('el lanzador y el riel tienen id propio y estable', ID_LANZADOR_SSH === 'lanzador-ssh' && new Set([ID_LANZADOR_SSH, ID_RIEL_SSH]).size === 2, `${ID_LANZADOR_SSH} · ${ID_RIEL_SSH}`)
}

hr('(13) El acordeón del lanzador: un solo grupo abierto, y con filtro no cuenta')
{
  const orden = (s: Set<string>): string => j([...s].sort())
  check(
    'se pliega todo menos el grupo abierto, y «Sin grupo» (id vacío) cuenta como uno más',
    orden(plegadosDeAcordeon(GRUPOS, 'gB')) === j(['', 'gA', 'gV']) && orden(plegadosDeAcordeon(GRUPOS, '')) === j(['gA', 'gB', 'gV']),
    `${orden(plegadosDeAcordeon(GRUPOS, 'gB'))} · ${orden(plegadosDeAcordeon(GRUPOS, ''))}`
  )
  check(
    'sin ningún grupo abierto, o con un id que no es de ninguno, se pliegan todos',
    orden(plegadosDeAcordeon(GRUPOS, null)) === j(['', 'gA', 'gB', 'gV']) && orden(plegadosDeAcordeon(GRUPOS, 'gZ')) === j(['', 'gA', 'gB', 'gV']),
    `${orden(plegadosDeAcordeon(GRUPOS, null))} · ${orden(plegadosDeAcordeon(GRUPOS, 'gZ'))}`
  )
  const con1 = (abierto: string | null): string => ver(filas({ plegados: [...plegadosDeAcordeon(GRUPOS, abierto)] }))
  check(
    'con «Bases» abierto, solo «Bases» enseña sus conexiones',
    con1('gB') === '[Sin grupo 3 plegado] | [Árboles 1 plegado] | [Bases 2] | servidor 2 | Servidor 10 | [Vacío 0 plegado]',
    con1('gB')
  )
  check(
    'con «Sin grupo» abierto, solo él',
    con1('') === '[Sin grupo 3] | Huérfana | Ñandú | router casa | [Árboles 1 plegado] | [Bases 2 plegado] | [Vacío 0 plegado]',
    con1('')
  )
  check('con ninguno abierto, solo las cabeceras con su recuento', con1(null) === '[Sin grupo 3 plegado] | [Árboles 1 plegado] | [Bases 2 plegado] | [Vacío 0 plegado]', con1(null))
  let uno = true
  for (const a of [null, '', 'gA', 'gB', 'gV', 'gZ']) {
    const abiertas = filas({ plegados: [...plegadosDeAcordeon(GRUPOS, a)] }).filter((x) => x.tipo === 'grupo' && x.abierto).length
    if (abiertas > 1) uno = false
  }
  check('sea cual sea el grupo abierto, nunca hay dos cabeceras abiertas', uno, '6 casos')
  const todosPlegados = [...plegadosDeAcordeon(GRUPOS, null)]
  check(
    'con filtro el acordeón no cuenta: salen las coincidencias de TODOS los grupos («ejemplo» casa con el host de cinco conexiones, en tres grupos)',
    ver(filas({ filtro: 'ejemplo', plegados: todosPlegados })) === '[Sin grupo 2] | Huérfana | Ñandú | [Árboles 1] | Nube | [Bases 2] | servidor 2 | Servidor 10',
    ver(filas({ filtro: 'ejemplo', plegados: todosPlegados }))
  )
  check(
    'MITAD NEGATIVA: el riel NO es un acordeón: lo que decide es el conjunto de plegados, y con uno solo plegado quedan abiertos todos los demás',
    ver(filas({ plegados: ['gV'] })) === '[Sin grupo 3] | Huérfana | Ñandú | router casa | [Árboles 1] | Nube | [Bases 2] | servidor 2 | Servidor 10 | [Vacío 0 plegado]',
    ver(filas({ plegados: ['gV'] }))
  )
  check(
    'desplegar un grupo cierra el que hubiera: con «Bases» abierto, desplegar «Árboles» deja «Árboles»',
    siguienteGrupoAbierto('gB', 'gA', false) === 'gA',
    String(siguienteGrupoAbierto('gB', 'gA', false))
  )
  check(
    'desplegar con nada abierto lo abre, y desplegar el que ya está abierto lo deja',
    siguienteGrupoAbierto(null, 'gA', false) === 'gA' && siguienteGrupoAbierto('gA', 'gA', false) === 'gA',
    `${siguienteGrupoAbierto(null, 'gA', false)} · ${siguienteGrupoAbierto('gA', 'gA', false)}`
  )
  check('plegar el abierto no deja ninguno', siguienteGrupoAbierto('gA', 'gA', true) === null, String(siguienteGrupoAbierto('gA', 'gA', true)))
  check(
    'MITAD NEGATIVA: plegar uno que no es el abierto no cierra el abierto',
    siguienteGrupoAbierto('gB', 'gA', true) === 'gB' && siguienteGrupoAbierto(null, 'gA', true) === null,
    `${siguienteGrupoAbierto('gB', 'gA', true)} · ${siguienteGrupoAbierto(null, 'gA', true)}`
  )
  check(
    '«Sin grupo» se abre y se cierra como cualquier otro',
    siguienteGrupoAbierto(null, '', false) === '' && siguienteGrupoAbierto('', '', true) === null && siguienteGrupoAbierto('gB', '', false) === '',
    `${siguienteGrupoAbierto(null, '', false)} · ${siguienteGrupoAbierto('', '', true)} · ${siguienteGrupoAbierto('gB', '', false)}`
  )
}

hr('(14) Al abrir el lanzador no hay ningún grupo abierto: «Recientes» arriba y todos los grupos plegados')
{
  const entrada = [...plegadosDeAcordeon(GRUPOS, null)]
  const recientes = recientesDe(['c2', 'c1', 'c4'], CONEXIONES)
  const conRecientes = ver(filas({ recientes, plegados: entrada }))
  check(
    'con recientes: el rótulo, las recientes y solo las cabeceras, también «Sin grupo» y el grupo vacío, cada una con su recuento',
    conRecientes === '{Recientes} | r:Servidor 10 | r:router casa | r:Nube | [Sin grupo 3 plegado] | [Árboles 1 plegado] | [Bases 2 plegado] | [Vacío 0 plegado]',
    conRecientes
  )
  check(
    'sin recientes (un perfil que nunca conectó) tampoco se abre ninguno: solo las cabeceras',
    ver(filas({ plegados: entrada })) === '[Sin grupo 3 plegado] | [Árboles 1 plegado] | [Bases 2 plegado] | [Vacío 0 plegado]',
    ver(filas({ plegados: entrada }))
  )
  check(
    'sin conexiones sueltas no hay cabecera «Sin grupo» que plegar',
    !ver(filas({ conexiones: CONEXIONES.filter((c) => c.grupoId !== null && !c.grupoDesconocido), plegados: entrada })).includes('Sin grupo'),
    ver(filas({ conexiones: CONEXIONES.filter((c) => c.grupoId !== null && !c.grupoDesconocido), plegados: entrada }))
  )
  const plana = filas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })), recientes: [CONEXIONES[3]], plegados: [...plegadosDeAcordeon([], null)] })
  check(
    'MITAD NEGATIVA: sin grupos en el perfil no hay nada que plegar: la lista plana se ve entera',
    ver(plana) === '{Recientes} | r:Nube | {Conexiones} | Huérfana | Nube | Ñandú | router casa | servidor 2 | Servidor 10',
    ver(plana)
  )
}

hr('(15) Las conexiones recientes: las últimas tres que siguen existiendo, solo en el lanzador y sin filtro')
{
  const rec = (ids: string[] | undefined): string => recientesDe(ids, CONEXIONES).map((c) => c.alias).join(' | ')
  check('van por su orden: la más reciente primero', rec(['c3', 'c1', 'c4']) === 'servidor 2 | router casa | Nube', rec(['c3', 'c1', 'c4']))
  check('no pasan de tres', RECIENTES_MAX === 3 && rec(['c1', 'c2', 'c3', 'c4', 'c5']) === 'router casa | Servidor 10 | servidor 2', rec(['c1', 'c2', 'c3', 'c4', 'c5']))
  check(
    'se podan las que ya no existen, y las que quedan siguen siendo hasta tres',
    rec(['c9', 'c1', 'c8', 'c2', 'c3', 'c4']) === 'router casa | Servidor 10 | servidor 2',
    rec(['c9', 'c1', 'c8', 'c2', 'c3', 'c4'])
  )
  check('una repetida solo cuenta una vez', rec(['c1', 'c1', 'c2']) === 'router casa | Servidor 10', rec(['c1', 'c1', 'c2']))
  check('un perfil que nunca conectó no tiene ninguna', rec(undefined) === '' && rec([]) === '', 'vacío · vacío')

  const recientes = recientesDe(['c2', 'c1', 'c4'], CONEXIONES)
  const conRec = filas({ recientes })
  check(
    'con recientes, delante va su rótulo y sus conexiones, y detrás el árbol de siempre',
    ver(conRec) === '{Recientes} | r:Servidor 10 | r:router casa | r:Nube | [Sin grupo 3] | Huérfana | Ñandú | router casa | [Árboles 1] | Nube | [Bases 2] | servidor 2 | Servidor 10 | [Vacío 0]',
    ver(conRec)
  )
  check(
    'una reciente sigue también en su grupo (sale dos veces) y cada fila tiene su clave',
    conRec.filter((x) => x.tipo === 'conexion' && x.conexion.id === 'c2').length === 2 && new Set(conRec.map((x) => x.clave)).size === conRec.length,
    `${conRec.length} filas, ${new Set(conRec.map((x) => x.clave)).size} claves`
  )
  const deRecientes = conRec.filter((x) => x.tipo === 'conexion' && x.reciente === true)
  const delArbol = conRec.filter((x) => x.tipo === 'conexion' && x.reciente !== true)
  check(
    'las de «Recientes» van a nivel 1 y marcadas; las del árbol no llevan la marca',
    deRecientes.length === 3 && deRecientes.every((x) => x.tipo === 'conexion' && x.nivel === 1) && delArbol.every((x) => x.tipo === 'conexion' && x.reciente === undefined),
    `${deRecientes.length} marcadas · ${delArbol.length} del árbol`
  )
  check(
    'con los grupos plegados las recientes siguen arriba: son del lanzador, no de un grupo',
    ver(filas({ recientes, plegados: ['gB', 'gA', ''] })) === '{Recientes} | r:Servidor 10 | r:router casa | r:Nube | [Sin grupo 3 plegado] | [Árboles 1 plegado] | [Bases 2 plegado] | [Vacío 0]',
    ver(filas({ recientes, plegados: ['gB', 'gA', ''] }))
  )
  check(
    'MITAD NEGATIVA: con filtro no hay «Recientes», solo coincidencias; ni aunque el filtro case con una reciente',
    ver(filas({ recientes, filtro: 'nube' })) === '[Árboles 1] | Nube' && !ver(filas({ recientes, filtro: 'router' })).includes('r:'),
    `${ver(filas({ recientes, filtro: 'nube' }))} · ${ver(filas({ recientes, filtro: 'router' }))}`
  )
  check('un filtro de solo espacios cuenta como sin filtro: siguen las recientes', ver(filas({ recientes, filtro: '   ' })).startsWith('{Recientes} | r:Servidor 10'), ver(filas({ recientes, filtro: '   ' })))
  check(
    'MITAD NEGATIVA: sin recientes (o con una lista vacía) no hay rótulo ni filas de más: el árbol de siempre',
    ver(filas({ recientes: [] })) === ver(filas()) && !ver(filas()).includes('{'),
    ver(filas({ recientes: [] }))
  )
  const plana = filas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })), recientes: [CONEXIONES[3]] })
  check(
    'una lista plana (sin grupos) lleva un segundo rótulo tras las recientes: sin él se leería como una repetición',
    ver(plana) === '{Recientes} | r:Nube | {Conexiones} | Huérfana | Nube | Ñandú | router casa | servidor 2 | Servidor 10',
    ver(plana)
  )
  check('los rótulos son los de la interfaz', NOMBRE_RECIENTES === 'Recientes' && NOMBRE_CONEXIONES === 'Conexiones', `${NOMBRE_RECIENTES} · ${NOMBRE_CONEXIONES}`)
}

hr('(16) Teclado con «Recientes»: los rótulos no se alcanzan, ni con las flechas ni con Inicio y Fin')
{
  const R = filas({ recientes: recientesDe(['c2', 'c1', 'c4'], CONEXIONES) })
  /** índices: 0 {Recientes} 1 r:Servidor 10 2 r:router casa 3 r:Nube 4 [Sin grupo] 5 Huérfana 6 Ñandú 7 router casa 8 [Árboles] 9 Nube 10 [Bases] 11 servidor 2 12 Servidor 10 13 [Vacío] */
  const en = (fs: FilaLista[], e: TeclaLista, activo: number): AccionLista | null => accionTeclaLista(e, { filas: fs, activo, filtroVacio: true }, 'windows')
  const acc = (e: TeclaLista, activo: number): AccionLista | null => en(R, e, activo)
  check('el cursor nace en la primera reciente, no en el rótulo', primeraConexion(R) === 1, String(primeraConexion(R)))
  check('↑ desde la primera reciente se queda donde está: el rótulo no se alcanza', j(acc(tecla('ArrowUp'), 1)) === j({ tipo: 'mover', indice: 1 }), j(acc(tecla('ArrowUp'), 1)))
  check('↓ desde la última reciente baja a la primera cabecera', j(acc(tecla('ArrowDown'), 3)) === j({ tipo: 'mover', indice: 4 }), j(acc(tecla('ArrowDown'), 3)))
  check(
    'sin fila activa, ↓ y ↑ van a la primera alcanzable, no al rótulo',
    j(acc(tecla('ArrowDown'), -1)) === j({ tipo: 'mover', indice: 1 }) && j(acc(tecla('ArrowUp'), -1)) === j({ tipo: 'mover', indice: 1 }),
    `${j(acc(tecla('ArrowDown'), -1))} · ${j(acc(tecla('ArrowUp'), -1))}`
  )
  check(
    'Inicio va a la primera alcanzable y Fin a la última',
    j(acc(tecla('Home'), 9)) === j({ tipo: 'mover', indice: 1 }) && j(acc(tecla('End'), 2)) === j({ tipo: 'mover', indice: 13 }),
    `${j(acc(tecla('Home'), 9))} · ${j(acc(tecla('End'), 2))}`
  )
  check('Intro sobre una reciente conecta con ella', j(acc(tecla('Enter'), 1)) === j({ tipo: 'conectar', conexionId: 'c2' }), j(acc(tecla('Enter'), 1)))
  check(
    'F2 y Supr sobre una reciente son de su conexión, como en su grupo',
    j(acc(tecla('F2'), 2)) === j({ tipo: 'editar', conexionId: 'c1' }) && j(acc(tecla('Delete'), 2)) === j({ tipo: 'eliminarConexion', conexionId: 'c1' }),
    `${j(acc(tecla('F2'), 2))} · ${j(acc(tecla('Delete'), 2))}`
  )
  check(
    '← y → sobre una reciente no hacen nada (no cuelga de ninguna cabecera), y ← desde una conexión de un grupo sube a SU cabecera',
    acc(tecla('ArrowLeft'), 2) === null && acc(tecla('ArrowRight'), 2) === null && cabeceraDe(R, 2) === -1 && j(acc(tecla('ArrowLeft'), 12)) === j({ tipo: 'mover', indice: 10 }),
    `${acc(tecla('ArrowLeft'), 2)} · ${j(acc(tecla('ArrowLeft'), 12))}`
  )
  check(
    'MITAD NEGATIVA: con el rótulo como fila activa (no debería pasar) ninguna tecla de acción hace nada',
    ['Enter', 'F2', 'Delete', 'ArrowLeft', 'ArrowRight'].every((k) => acc(tecla(k), 0) === null) && acc(tecla('F10', { shiftKey: true }), 0) === null && acc(tecla('ContextMenu'), 0) === null,
    'null en todas'
  )
  const P = filas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })), recientes: [CONEXIONES[3]] })
  /** índices: 0 {Recientes} 1 r:Nube 2 {Conexiones} 3 Huérfana … */
  check(
    'en una lista plana, las flechas saltan también el segundo rótulo: de la reciente baja a la primera conexión y de ella vuelve',
    j(en(P, tecla('ArrowDown'), 1)) === j({ tipo: 'mover', indice: 3 }) && j(en(P, tecla('ArrowUp'), 3)) === j({ tipo: 'mover', indice: 1 }),
    `${j(en(P, tecla('ArrowDown'), 1))} · ${j(en(P, tecla('ArrowUp'), 3))}`
  )
}

hr('(17) El acordeón por teclado: → abre un grupo cerrando el otro; ← e Intro lo cierran')
{
  let abierto: string | null = 'gB'
  const pulsar = (e: TeclaLista, indice: number): void => {
    const fs = filas({ plegados: [...plegadosDeAcordeon(GRUPOS, abierto)] })
    const a = accionTeclaLista(e, { filas: fs, activo: indice, filtroVacio: true }, 'windows')
    if (a?.tipo === 'plegar') abierto = siguienteGrupoAbierto(abierto, a.grupoId, a.plegar)
  }
  /** Con «Bases» abierto: 0 [Sin grupo] 1 [Árboles] 2 [Bases] 3 servidor 2 4 Servidor 10 5 [Vacío]. */
  pulsar(tecla('ArrowRight'), 1)
  check('→ sobre «Árboles», plegado, lo abre y «Bases» se cierra', abierto === 'gA', String(abierto))
  /** Con «Árboles» abierto: 0 [Sin grupo] 1 [Árboles] 2 Nube 3 [Bases] 4 [Vacío]. */
  pulsar(tecla('ArrowLeft'), 1)
  check('← sobre el grupo abierto lo cierra y no queda ninguno', abierto === null, String(abierto))
  /** Con ninguno abierto: 0 [Sin grupo] 1 [Árboles] 2 [Bases] 3 [Vacío]. */
  pulsar(tecla('Enter'), 2)
  check('Intro sobre «Bases», plegado, lo abre', abierto === 'gB', String(abierto))
  pulsar(tecla('Enter'), 2)
  check('y Intro sobre el abierto lo cierra', abierto === null, String(abierto))
  pulsar(tecla('Enter'), 0)
  check('«Sin grupo» se abre con Intro como cualquier otro', abierto === '', String(abierto))
  pulsar(tecla('ArrowRight'), 0)
  check('MITAD NEGATIVA: → sobre un grupo ya abierto no lo cierra ni cierra otro (baja a su primera conexión)', abierto === '', String(abierto))
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
