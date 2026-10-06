#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura del explorador SFTP (node src/renderer/src/features/sftp/test-sftp.mts):
// rutas remotas, orden y formato del listado, selección (clic, Ctrl/⌘, Mayús, flechas), progreso de
// las operaciones, textos de los avisos y teclado por plataforma con sus mitades negativas, y las
// pestañas SFTP del modelo de pestañas SSH. Corre bajo `node` llano: nada de React, DOM ni IPC.
// =============================================================================

import type { SftpEntrada, SftpProgreso } from '../../../../shared/sftp-ipc.ts'
import { abiertasPorConexion, abrirSsh, initialSshTabsState, nombreSsh, renombrarSsh, sshDePerfil } from '../terminales/sshTabsModel.ts'
import { esDescargable, esNavegable, formatoFecha, formatoTamano, ordenarEntradas } from './listadoSftp.ts'
import {
  aplicarProgreso,
  debeRefrescar,
  mensajeBorrado,
  mensajeConflictos,
  porcentaje,
  quitarOperacion,
  seQuitaSola,
  textoAvance,
  tituloConflictos,
  verboOperacion
} from './operacionesSftp.ts'
import { destinoDeSoltar, migasDe, nombreDe, normalizarRuta, padreDe, unirRuta, validarNombre } from './rutasSftp.ts'
import {
  asegurarFila,
  moverActivo,
  podarSeleccion,
  SELECCION_VACIA,
  seleccionarConClic,
  seleccionarTodo
} from './seleccionSftp.ts'
import { accionTecla, type TeclaSftp } from './teclasSftp.ts'

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

const ent = (nombre: string, tipo: SftpEntrada['tipo'], extra: Partial<SftpEntrada> = {}): SftpEntrada => ({
  nombre,
  tipo,
  tamano: null,
  modificado: null,
  permisos: null,
  ...extra
})

function rutas(): void {
  hr('Rutas remotas')
  check('normalizar: vacía y barras repetidas', normalizarRuta('') === '/' && normalizarRuta('//a///b/') === '/a/b', j([normalizarRuta(''), normalizarRuta('//a///b/')]))
  check(
    'soltar: sobre una carpeta de la lista va dentro; fuera de las filas, a la que se ve',
    destinoDeSoltar('/srv/app', 'releases') === '/srv/app/releases' && destinoDeSoltar('/', 'etc') === '/etc' && destinoDeSoltar('/srv/app/', null) === '/srv/app',
    j([destinoDeSoltar('/srv/app', 'releases'), destinoDeSoltar('/', 'etc'), destinoDeSoltar('/srv/app/', null)])
  )
  check('unir: raíz y carpeta', unirRuta('/', 'x') === '/x' && unirRuta('/a/b', 'x') === '/a/b/x' && unirRuta('/a/', 'x') === '/a/x', j([unirRuta('/', 'x'), unirRuta('/a/b', 'x')]))
  check('padre: la raíz es su propio padre', padreDe('/') === '/' && padreDe('/a') === '/' && padreDe('/a/b/') === '/a', j([padreDe('/'), padreDe('/a'), padreDe('/a/b/')]))
  check('nombre: lo último, vacío en la raíz', nombreDe('/a/b') === 'b' && nombreDe('/') === '', j([nombreDe('/a/b'), nombreDe('/')]))
  const m = migasDe('/home/ana/x')
  check('migas: de la raíz a la carpeta', m.map((x) => x.nombre).join('|') === '/|home|ana|x' && m[3].ruta === '/home/ana/x' && m[1].ruta === '/home', j(m))
  check('migas: la raíz es una sola', migasDe('/').length === 1 && migasDe('/')[0].ruta === '/', j(migasDe('/')))
  check('nombre válido', validarNombre('docs') === null && validarNombre('a b.txt') === null, 'ok')
  check('nombre inválido: vacío, puntos, barra, NUL', [validarNombre('  '), validarNombre('..'), validarNombre('.'), validarNombre('a/b'), validarNombre('a\0b')].every((e) => e !== null), 'todos con motivo')
}

function listado(): void {
  hr('Orden y formato del listado')
  const orden = ordenarEntradas([
    ent('zeta.txt', 'archivo'),
    ent('Beta', 'carpeta'),
    ent('alfa', 'carpeta'),
    ent('enlace-dir', 'enlace', { destinoEnlace: 'carpeta' }),
    ent('Archivo2.txt', 'archivo'),
    ent('archivo10.txt', 'archivo'),
    ent('roto', 'enlace', { destinoEnlace: 'roto' })
  ]).map((e) => e.nombre)
  check('carpetas (y enlaces a carpeta) primero, sin distinguir mayúsculas', orden.slice(0, 3).join('|') === 'alfa|Beta|enlace-dir', orden.join('|'))
  check('después los archivos por nombre, con números naturales', orden.slice(3).join('|') === 'Archivo2.txt|archivo10.txt|roto|zeta.txt', orden.slice(3).join('|'))
  const orig = [ent('b', 'archivo'), ent('a', 'archivo')]
  ordenarEntradas(orig)
  check('no toca el original', orig[0].nombre === 'b', orig[0].nombre)
  check('navegable', esNavegable(ent('d', 'carpeta')) && esNavegable(ent('l', 'enlace', { destinoEnlace: 'carpeta' })) && !esNavegable(ent('l', 'enlace', { destinoEnlace: 'archivo' })) && !esNavegable(ent('f', 'archivo')), 'ok')
  check(
    'descargable: no un socket ni un enlace roto',
    esDescargable(ent('f', 'archivo')) && esDescargable(ent('d', 'carpeta')) && !esDescargable(ent('s', 'otro')) && !esDescargable(ent('r', 'enlace', { destinoEnlace: 'roto' })),
    'ok'
  )
  check('tamaño: bytes, KB, MB, GB', [formatoTamano(0), formatoTamano(512), formatoTamano(1536), formatoTamano(10 * 1024), formatoTamano(5 * 1024 * 1024), formatoTamano(3 * 1024 ** 3)].join('|') === '0 B|512 B|1,5 KB|10 KB|5,0 MB|3,0 GB', [formatoTamano(512), formatoTamano(1536), formatoTamano(10 * 1024)].join('|'))
  check('tamaño: desconocido y absurdo', formatoTamano(null) === '—' && formatoTamano(-1) === '—' && formatoTamano(NaN) === '—', 'ok')
  check('fecha: null es «—» y una fecha da texto con el año', formatoFecha(null) === '—' && /2026/.test(formatoFecha(Date.UTC(2026, 9, 6, 12, 0))), formatoFecha(Date.UTC(2026, 9, 6, 12, 0)))
}

function seleccion(): void {
  hr('Selección')
  const orden = ['a', 'b', 'c', 'd', 'e']
  const s1 = seleccionarConClic(SELECCION_VACIA, orden, 'b', { mod: false, mayus: false })
  check('clic suelto: solo esa fila, con ancla y activa', [...s1.nombres].join() === 'b' && s1.ancla === 'b' && s1.activo === 'b', j([...s1.nombres]))
  const s2 = seleccionarConClic(s1, orden, 'd', { mod: true, mayus: false })
  check('Ctrl/⌘+clic suma', [...s2.nombres].sort().join() === 'b,d' && s2.ancla === 'd', j([...s2.nombres]))
  const s3 = seleccionarConClic(s2, orden, 'd', { mod: true, mayus: false })
  check('Ctrl/⌘+clic sobre una elegida la quita', [...s3.nombres].join() === 'b', j([...s3.nombres]))
  const s4 = seleccionarConClic(s1, orden, 'd', { mod: false, mayus: true })
  check('Mayús+clic: rango desde el ancla', [...s4.nombres].join() === 'b,c,d' && s4.ancla === 'b', j([...s4.nombres]))
  const s5 = seleccionarConClic(s4, orden, 'a', { mod: false, mayus: true })
  check('Mayús+clic hacia atrás: rango inverso, ancla intacta', [...s5.nombres].sort().join() === 'a,b' && s5.ancla === 'b', j([...s5.nombres]))
  const s6 = seleccionarConClic(SELECCION_VACIA, orden, 'c', { mod: false, mayus: true })
  check('Mayús+clic sin ancla: solo esa fila', [...s6.nombres].join() === 'c', j([...s6.nombres]))
  const s7 = seleccionarConClic(s2, orden, 'e', { mod: true, mayus: true })
  check('Ctrl+Mayús+clic: añade el rango a lo que había', [...s7.nombres].sort().join() === 'b,d,e', j([...s7.nombres]))
  const m1 = moverActivo(SELECCION_VACIA, orden, 1, false)
  check('flecha abajo sin activa: la primera', m1.activo === 'a', String(m1.activo))
  check('flecha arriba sin activa: la última', moverActivo(SELECCION_VACIA, orden, -1, false).activo === 'e', 'e')
  const m2 = moverActivo(s1, orden, 1, false)
  check('flecha abajo: baja y queda sola', m2.activo === 'c' && [...m2.nombres].join() === 'c', j([...m2.nombres]))
  check('no se sale por los extremos', moverActivo(m1, orden, -1, false).activo === 'a' && moverActivo(moverActivo(SELECCION_VACIA, orden, 'fin', false), orden, 1, false).activo === 'e', 'ok')
  const m3 = moverActivo(s1, orden, 2, true)
  check('Mayús+flecha extiende desde el ancla', [...m3.nombres].join() === 'b,c,d' && m3.activo === 'd' && m3.ancla === 'b', j([...m3.nombres]))
  check('Inicio y Fin', moverActivo(s1, orden, 'inicio', false).activo === 'a' && moverActivo(s1, orden, 'fin', false).activo === 'e', 'ok')
  check('lista vacía: nada', moverActivo(s1, [], 1, false) === SELECCION_VACIA, 'vacía')
  check('seleccionar todo', seleccionarTodo(s1, orden).nombres.size === 5, '5')
  const podada = podarSeleccion(s4, ['a', 'b'])
  check('podar quita lo que ya no existe', [...podada.nombres].join() === 'b' && podada.activo === null, j([...podada.nombres]))
  check('podar sin cambios devuelve la misma', podarSeleccion(s4, orden) === s4, 'misma')
  check('clic derecho en una fila ajena: queda sola; en una elegida: se conserva el grupo', [...asegurarFila(s4, 'e').nombres].join() === 'e' && asegurarFila(s4, 'c').nombres.size === 3, 'ok')
}

function progreso(): void {
  hr('Progreso y textos')
  const p = (o: Partial<SftpProgreso>): SftpProgreso => ({ opId: 'o1', sesionId: 's', tipo: 'subida', fase: 'en-curso', hechos: 0, total: null, actual: 'a.txt', carpetaRemota: '/x', ...o })
  let l = aplicarProgreso([], p({}))
  check('un evento nuevo se añade', l.length === 1, String(l.length))
  l = aplicarProgreso(l, p({ hechos: 50, total: 100 }))
  check('un evento de la misma operación la sustituye', l.length === 1 && l[0].hechos === 50, j(l[0]))
  l = aplicarProgreso(l, p({ opId: 'o2', tipo: 'descarga' }))
  check('otra operación se añade al final', l.map((o) => o.opId).join() === 'o1,o2', l.map((o) => o.opId).join())
  l = aplicarProgreso(l, p({ fase: 'hecha', hechos: 100, total: 100 }))
  l = aplicarProgreso(l, p({ fase: 'en-curso', hechos: 60, total: 100 }))
  check('una operación hecha no vuelve a «en curso» por un evento tardío', l[0].fase === 'hecha', l[0].fase)
  check('quitar', quitarOperacion(l, 'o1').map((o) => o.opId).join() === 'o2', 'o2')
  check('porcentaje', porcentaje(p({ hechos: 25, total: 100 })) === 25 && porcentaje(p({ total: null })) === null && porcentaje(p({ hechos: 5, total: 0 })) === null && porcentaje(p({ hechos: 300, total: 100 })) === 100, 'ok')
  check('refresca al terminar una subida o un borrado de la carpeta visible', debeRefrescar(p({ fase: 'hecha' }), '/x') && debeRefrescar(p({ fase: 'error', tipo: 'borrado' }), '/x') && debeRefrescar(p({ fase: 'cancelada' }), '/x'), 'ok')
  check('no refresca: en curso, otra carpeta, una descarga o sin carpeta', !debeRefrescar(p({}), '/x') && !debeRefrescar(p({ fase: 'hecha' }), '/y') && !debeRefrescar(p({ fase: 'hecha', tipo: 'descarga' }), '/x') && !debeRefrescar(p({ fase: 'hecha' }), null), 'ok')
  check('se quita sola: hecha y cancelada, no el error', seQuitaSola('hecha') && seQuitaSola('cancelada') && !seQuitaSola('error') && !seQuitaSola('en-curso'), 'ok')
  check('verbos', verboOperacion(p({})) === 'Subiendo' && verboOperacion(p({ tipo: 'descarga', fase: 'hecha' })) === 'Descarga' && verboOperacion(p({ tipo: 'borrado', fase: 'error' })) === 'No se pudo eliminar', 'ok')
  check('avance en bytes y en elementos', textoAvance(p({ hechos: 1536, total: 10240 })) === '1,5 KB de 10 KB' && textoAvance(p({ tipo: 'borrado', hechos: 2, total: 5 })) === '2 de 5 elementos' && textoAvance(p({})) === '', textoAvance(p({ hechos: 1536, total: 10240 })))
  check('título de conflictos: singular y plural', tituloConflictos(1) === 'Reemplazar 1 elemento' && tituloConflictos(3) === 'Reemplazar 3 elementos', 'ok')
  const nombres = Array.from({ length: 10 }, (_, i) => `f${i}`)
  const cuerpo = mensajeConflictos(nombres)
  check('conflictos: hasta 8 nombres y «y 2 más»', cuerpo.includes('• f7') && !cuerpo.includes('• f8') && cuerpo.includes('… y 2 más'), cuerpo.split('\n').slice(0, 3).join(' / '))
  check('borrado: cuántos y aviso de carpetas solo si las hay', mensajeBorrado(['a'], false).includes('«a»') && !mensajeBorrado(['a'], false).includes('carpetas') && mensajeBorrado(['a', 'b'], true).includes('2 elementos') && mensajeBorrado(['a', 'b'], true).includes('todo su contenido'), 'ok')
}

function teclado(): void {
  hr('Teclado por plataforma')
  const t = (key: string, extra: Partial<TeclaSftp> = {}): TeclaSftp => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
  const tipo = (e: TeclaSftp, pl: 'windows' | 'mac' | 'otra'): string | null => accionTecla(e, pl)?.tipo ?? null
  check('Supr borra en Windows y en Mac', tipo(t('Delete'), 'windows') === 'borrar' && tipo(t('Delete'), 'mac') === 'borrar', 'ok')
  check('⌘⌫ borra en Mac', tipo(t('Backspace', { metaKey: true }), 'mac') === 'borrar', String(tipo(t('Backspace', { metaKey: true }), 'mac')))
  check('Ctrl+⌫ NO borra en Windows', tipo(t('Backspace', { ctrlKey: true }), 'windows') === null, String(tipo(t('Backspace', { ctrlKey: true }), 'windows')))
  check('Retroceso pelado sube de nivel y no borra, en las dos', tipo(t('Backspace'), 'windows') === 'subirNivel' && tipo(t('Backspace'), 'mac') === 'subirNivel', 'ok')
  check('Mayús+Supr no borra', tipo(t('Delete', { shiftKey: true }), 'windows') === null, 'null')
  check('subir de nivel nativo: ⌘↑ en Mac, Alt+↑ en Windows, y no al revés', tipo(t('ArrowUp', { metaKey: true }), 'mac') === 'subirNivel' && tipo(t('ArrowUp', { altKey: true }), 'windows') === 'subirNivel' && tipo(t('ArrowUp', { metaKey: true }), 'windows') === null && tipo(t('ArrowUp', { altKey: true }), 'mac') === null, 'ok')
  const abajo = accionTecla(t('ArrowDown', { shiftKey: true }), 'windows')
  check('Mayús+flecha extiende', abajo?.tipo === 'mover' && abajo.extender && abajo.mov === 1, j(abajo))
  const arriba = accionTecla(t('ArrowUp'), 'mac')
  check('flecha arriba sola mueve', arriba?.tipo === 'mover' && !arriba.extender && arriba.mov === -1, j(arriba))
  check('Inicio y Fin', accionTecla(t('Home'), 'otra')?.tipo === 'mover' && accionTecla(t('End'), 'otra')?.tipo === 'mover', 'ok')
  check('Intro abre; F2 renombra; F5 actualiza', tipo(t('Enter'), 'windows') === 'abrir' && tipo(t('F2'), 'mac') === 'renombrar' && tipo(t('F5'), 'windows') === 'actualizar', 'ok')
  check('Ctrl+A en Windows y ⌘A en Mac seleccionan todo; el otro modificador, no', tipo(t('a', { ctrlKey: true }), 'windows') === 'seleccionarTodo' && tipo(t('a', { metaKey: true }), 'mac') === 'seleccionarTodo' && tipo(t('a', { ctrlKey: true }), 'mac') === null && tipo(t('a', { metaKey: true }), 'windows') === null, 'ok')
  check('una letra suelta no es de la lista', tipo(t('x'), 'windows') === null, 'null')
}

function pestanas(): void {
  hr('Pestañas SFTP en el modelo de pestañas SSH')
  let s = abrirSsh(initialSshTabsState, 'p|', 'p', 'c1', 'srv')
  s = abrirSsh(s, 'p|', 'p', 'c1', 'srv', true)
  s = abrirSsh(s, 'p|', 'p', 'c1', 'srv', true)
  const lista = sshDePerfil(s, 'p')
  check('la SFTP lleva su marca y la SSH no', lista[0].sftp === undefined && lista[1].sftp === true, j(lista.map((t) => t.sftp)))
  check('nombre «SFTP · alias», con (2) desde la segunda', nombreSsh(lista[0]) === 'srv' && nombreSsh(lista[1]) === 'SFTP · srv' && nombreSsh(lista[2]) === 'SFTP · srv (2)', lista.map(nombreSsh).join(' | '))
  check('abrir dos veces la misma abre una segunda pestaña (como las SSH)', lista.length === 3 && new Set(lista.map((t) => t.id)).size === 3, String(lista.length))
  check('el índice de la SFTP no consume el de la SSH', lista[0].indice === 1 && lista[1].indice === 1, j(lista.map((t) => t.indice)))
  check('la lista de conexiones solo cuenta las terminales SSH', abiertasPorConexion(lista).c1 === 1, j(abiertasPorConexion(lista)))
  const r = renombrarSsh(s, 'p', lista[1].id, 'SFTP · srv')
  check('renombrar al nombre automático la deja sin nombre propio', sshDePerfil(r, 'p')[1].nombre === undefined, 'ok')
}

rutas()
listado()
seleccion()
progreso()
teclado()
pestanas()

hr('RESULTADO (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  if (!r.pass) console.log(`      -> ${r.evidence}`)
}
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
