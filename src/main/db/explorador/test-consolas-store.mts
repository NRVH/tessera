#!/usr/bin/env node
// =============================================================================
// Prueba de las consolas como archivos del espacio de datos (`ConsolasStore.ts`) contra una carpeta temporal real: índice
// frente a archivos, nombres por plataforma, conflictos con lo que escribe el agente, papelera y escrituras coalescidas.
// (node src/main/db/explorador/test-consolas-store.mts  ·  npm run test:db-consolas)
// =============================================================================

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeFileAtomic } from '../../util/atomicWrite.ts'
import {
  ConsolasStore,
  ErrorConsolas,
  respuestaConsolas,
  sanearNombreArchivo,
  validarNombreConsola
} from './ConsolasStore.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { DbConsolaInfo } from '../../../shared/db-explorador-ipc.ts'

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

/** Todos los mensajes de error vistos: al final se comprueba que ninguno lleva rutas. */
const mensajes: string[] = []

async function error(fn: () => Promise<unknown>): Promise<ErrorConsolas | null> {
  try {
    await fn()
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    mensajes.push(msg)
    return err instanceof ErrorConsolas ? err : new ErrorConsolas('fs', `NO ES ErrorConsolas: ${msg}`)
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const base = mkdtempSync(path.join(os.tmpdir(), 'tessera-consolas-'))
  const conexiones = path.join(base, 'conexiones')
  const papeleraDir = path.join(base, 'papelera')
  mkdirSync(papeleraDir, { recursive: true })
  const vivos = new Set(['p1', 'p2', 'p3', 'p4', 'p5'])
  const dirPerfil = (id: string): string | null => (vivos.has(id) ? path.join(conexiones, id) : null)
  const consolas = (id: string): string => path.join(conexiones, id, 'consolas')

  const enPapelera: string[] = []
  let papeleraRota = false
  const papelera = async (ruta: string): Promise<void> => {
    if (papeleraRota) throw new Error(`EPERM: operation not permitted, trash '${ruta}'`)
    enPapelera.push(ruta)
    renameSync(ruta, path.join(papeleraDir, `${enPapelera.length}-${path.basename(ruta)}`))
  }
  let n = 0
  const nuevoId = (): string => `id-${++n}`

  const crearStore = (plataforma: Plataforma, extra: Partial<ConstructorParameters<typeof ConsolasStore>[0]> = {}) =>
    new ConsolasStore({ dirPerfil, papelera, plataforma, nuevoId, ahora: () => 1000 + n, ...extra })
  const store = crearStore('windows')

  try {
    // -----------------------------------------------------------------------
    hr('(1) crear y listar: consola_N sobre toda la carpeta')
    // -----------------------------------------------------------------------
    const vacio = await store.listar('p1')
    check(
      'perfil sin consolas: lista vacía y no crea la carpeta',
      vacio.length === 0 && !existsSync(consolas('p1')),
      `${vacio.length}, carpeta=${existsSync(consolas('p1'))}`
    )
    const c1 = await store.crear('p1', 'A')
    check(
      'la primera es consola_1, vacía, con ruta relativa POSIX',
      c1.nombre === 'consola_1' &&
        c1.rutaRelativa === 'consolas/consola_1.sql' &&
        c1.bytes === 0 &&
        c1.perfilId === 'p1' &&
        c1.conexionId === 'A' &&
        existsSync(path.join(consolas('p1'), 'consola_1.sql')),
      JSON.stringify(c1)
    )
    const c2 = await store.crear('p1', 'B')
    check(
      'otra conexión NO reinicia la cuenta: consola_2',
      c2.nombre === 'consola_2' && c2.conexionId === 'B',
      c2.nombre
    )
    const indice = JSON.parse(readFileSync(path.join(consolas('p1'), 'indice.json'), 'utf-8')) as {
      version: number
      consolas: Array<{ id: string; conexionId: string; nombre: string; creadaEn: number }>
    }
    check(
      'indice.json {version:1, consolas:[{id, conexionId, nombre, creadaEn}]}',
      indice.version === 1 &&
        indice.consolas.length === 2 &&
        indice.consolas.every((e) => typeof e.creadaEn === 'number') &&
        indice.consolas[0].id === c1.id &&
        indice.consolas[1].conexionId === 'B',
      JSON.stringify(indice)
    )
    writeFileSync(path.join(consolas('p1'), 'consola_3.sql'), 'de fuera')
    const c4 = await store.crear('p1', 'A')
    check('un archivo ajeno consola_3.sql también ocupa el número', c4.nombre === 'consola_4', c4.nombre)
    const lista1 = await store.listar('p1')
    check(
      'listar: las del índice, en orden, sin el archivo ajeno',
      lista1.map((c) => c.nombre).join(',') === 'consola_1,consola_2,consola_4',
      lista1.map((c) => c.nombre).join(',')
    )
    await store.borrar('p1', c1.id)
    const c1b = await store.crear('p1', 'B')
    check('tras borrar consola_1, la siguiente reutiliza el 1 (menor libre)', c1b.nombre === 'consola_1', c1b.nombre)
    check(
      'la consola vacía se borró con unlink, sin pasar por la papelera',
      enPapelera.length === 0,
      `papelera=${enPapelera.length}`
    )

    // -----------------------------------------------------------------------
    hr('(2) leer / escribir / conflicto')
    // -----------------------------------------------------------------------
    const l0 = await store.leer('p1', c2.id)
    check('leer una recién creada: texto vacío y versión (de cero bytes)', l0.texto === '' && /^0:/.test(l0.version), l0.version)
    const e1 = await store.escribir('p1', c2.id, 'select 1 from dual;')
    check(
      'escribir: ok con versión nueva y el texto en disco',
      e1.ok &&
        e1.version !== l0.version &&
        readFileSync(path.join(consolas('p1'), 'consola_2.sql'), 'utf-8') === 'select 1 from dual;',
      JSON.stringify(e1)
    )
    const seguidas: boolean[] = []
    for (const t of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) {
      seguidas.push((await store.escribir('p1', c2.id, t)).ok)
    }
    check(
      'SIN falso conflicto: 5 escrituras propias seguidas del MISMO tamaño',
      seguidas.every(Boolean),
      seguidas.join(',')
    )
    const rafaga = await Promise.all(['r1', 'r22', 'r333'].map((t) => store.escribir('p1', c2.id, t)))
    check(
      'SIN falso conflicto: ráfaga sin esperar, gana la última',
      rafaga.every((r) => r.ok) &&
        readFileSync(path.join(consolas('p1'), 'consola_2.sql'), 'utf-8') === 'r333',
      JSON.stringify(rafaga.map((r) => r.ok))
    )
    const rutaC2 = path.join(consolas('p1'), 'consola_2.sql')
    writeFileSync(rutaC2, 'select * from agente_escribio;')
    const conflicto = await store.escribir('p1', c2.id, 'mi texto')
    check(
      'CONFLICTO: el disco cambió por fuera -> {conflicto, texto del disco, version}',
      !conflicto.ok &&
        conflicto.conflicto &&
        conflicto.texto === 'select * from agente_escribio;' &&
        readFileSync(rutaC2, 'utf-8') === 'select * from agente_escribio;',
      JSON.stringify(conflicto)
    )
    const conservar = await store.escribir('p1', c2.id, 'mi texto')
    check(
      '"Conservar la mía": volver a escribir ya no es conflicto',
      conservar.ok && readFileSync(rutaC2, 'utf-8') === 'mi texto',
      JSON.stringify(conservar)
    )
    writeFileSync(rutaC2, 'lo mismo que mando')
    const igual = await store.escribir('p1', c2.id, 'lo mismo que mando')
    check('cambio por fuera IDÉNTICO a lo que se escribe: sin conflicto', igual.ok, JSON.stringify(igual))
    writeFileSync(rutaC2, '\ufeffselect bom;')
    const conBom = await store.leer('p1', c2.id)
    check('leer quita el BOM', conBom.texto === 'select bom;', JSON.stringify(conBom.texto))
    unlinkSync(rutaC2)
    const errAusente = await error(() => store.leer('p1', c2.id))
    check(
      'archivo borrado por fuera: leer -> noExiste (sin tocar el índice)',
      errAusente?.codigo === 'noExiste' &&
        (JSON.parse(readFileSync(path.join(consolas('p1'), 'indice.json'), 'utf-8')) as {
          consolas: Array<{ id: string }>
        }).consolas.some((e) => e.id === c2.id),
      String(errAusente?.message)
    )
    const trasBorrar = await store.escribir('p1', c2.id, 'recupero')
    check(
      'archivo borrado por fuera: escribir -> conflicto con texto vacío',
      !trasBorrar.ok && trasBorrar.texto === '' && trasBorrar.version === 'ausente',
      JSON.stringify(trasBorrar)
    )
    const recrea = await store.escribir('p1', c2.id, 'recupero')
    check(
      '... y "Conservar la mía" lo vuelve a crear',
      recrea.ok && readFileSync(rutaC2, 'utf-8') === 'recupero',
      JSON.stringify(recrea)
    )
    const grande = 'x'.repeat(5 * 1024 * 1024 + 1)
    const errGrande = await error(() => store.escribir('p1', c2.id, grande))
    check('tope de 5 MiB al escribir', errGrande?.codigo === 'tamano', String(errGrande?.message))
    const resp = await respuestaConsolas(() => store.escribir('p1', c2.id, grande))
    check(
      'respuestaConsolas: el tope viaja como ok:false motivo limite',
      !resp.ok && resp.error.motivo === 'limite',
      JSON.stringify(resp.ok ? null : resp.error)
    )
    writeFileSync(rutaC2, grande)
    const errLeerGrande = await error(() => store.leer('p1', c2.id))
    check('tope de 5 MiB al leer un archivo que creció por fuera', errLeerGrande?.codigo === 'tamano', String(errLeerGrande?.message))
    await store.leer('p1', c2.id).catch(() => undefined)
    writeFileSync(rutaC2, 'normal')
    await store.leer('p1', c2.id)
    const restos = readdirSync(consolas('p1')).filter((f) => f.endsWith('.tmp'))
    check('no quedan .tmp del escritor atómico', restos.length === 0, restos.join(','))

    // -----------------------------------------------------------------------
    hr('(3) coalescencia y vaciar()')
    // -----------------------------------------------------------------------
    const llamadas: string[] = []
    const espia = crearStore('windows', {
      escribirArchivo: async (ruta: string, texto: string) => {
        llamadas.push(texto)
        await esperar(40)
        await writeFileAtomic(ruta, texto)
      }
    })
    const k = await espia.crear('p2', 'A')
    const rutaK = path.join(consolas('p2'), `${k.nombre}.sql`)
    const tres = await Promise.all([
      espia.escribir('p2', k.id, 'uno'),
      espia.escribir('p2', k.id, 'dos'),
      espia.escribir('p2', k.id, 'tres')
    ])
    check(
      'con una escritura en vuelo, las siguientes se funden: 2 escrituras, gana la última',
      llamadas.join(',') === 'uno,tres' && readFileSync(rutaK, 'utf-8') === 'tres',
      llamadas.join(',')
    )
    check(
      'todos los que esperaban reciben ok; los fundidos, la misma versión',
      tres.every((r) => r.ok) && tres[1].ok && tres[2].ok && tres[1].version === tres[2].version,
      JSON.stringify(tres)
    )
    llamadas.length = 0
    void espia.escribir('p2', k.id, 'cuatro')
    void espia.escribir('p2', k.id, 'cinco')
    void espia.escribir('p2', k.id, 'seis')
    await espia.vaciar()
    check(
      'vaciar() espera a toda la cadena: en disco queda la última',
      readFileSync(rutaK, 'utf-8') === 'seis' && llamadas.join(',') === 'cuatro,seis',
      `${readFileSync(rutaK, 'utf-8')} / ${llamadas.join(',')}`
    )
    const otra = await espia.crear('p2', 'A')
    const [ra, rb] = await Promise.all([
      espia.escribir('p2', k.id, 'para k'),
      espia.escribir('p2', otra.id, 'para otra')
    ])
    check(
      'dos consolas distintas no se funden entre sí',
      ra.ok &&
        rb.ok &&
        readFileSync(rutaK, 'utf-8') === 'para k' &&
        readFileSync(path.join(consolas('p2'), `${otra.nombre}.sql`), 'utf-8') === 'para otra',
      `${ra.ok} ${rb.ok}`
    )

    // -----------------------------------------------------------------------
    hr('(4) renombrar: unicidad, NFC y nombres por plataforma')
    // -----------------------------------------------------------------------
    await store.escribir('p1', c2.id, 'select renombrada;')
    const ventas = await store.renombrar('p1', c2.id, 'ventas')
    check(
      'renombra archivo e índice',
      ventas.nombre === 'ventas' &&
        ventas.rutaRelativa === 'consolas/ventas.sql' &&
        existsSync(path.join(consolas('p1'), 'ventas.sql')) &&
        !existsSync(rutaC2) &&
        (await store.listar('p1')).some((c) => c.id === c2.id && c.nombre === 'ventas'),
      JSON.stringify(ventas)
    )
    const trasRenombrar = await store.escribir('p1', c2.id, 'sigue siendo mía')
    check(
      'tras renombrar, escribir sigue sin conflicto y va al archivo nuevo',
      trasRenombrar.ok && readFileSync(path.join(consolas('p1'), 'ventas.sql'), 'utf-8') === 'sigue siendo mía',
      JSON.stringify(trasRenombrar)
    )
    const dup = await error(() => store.renombrar('p1', c4.id, 'VENTAS'))
    check('duplicado sin distinguir mayúsculas -> error', dup?.codigo === 'nombre', String(dup?.message))
    const mayus = await store.renombrar('p1', c2.id, 'Ventas')
    check('cambiar solo mayúsculas de la MISMA consola se permite', mayus.nombre === 'Ventas', mayus.nombre)
    const anio = await store.renombrar('p1', c4.id, 'A\u00f1o')
    const nfd = await error(() => store.renombrar('p1', c1b.id, 'An\u0303o'))
    check(
      'NFC: "Año" en NFD choca con "Año" en NFC',
      anio.nombre === 'A\u00f1o' && nfd?.codigo === 'nombre',
      String(nfd?.message)
    )
    const nfdMayus = await error(() => store.renombrar('p1', c1b.id, 'A\u00d1O'))
    check('NFC + minúsculas: "AÑO" también choca', nfdMayus?.codigo === 'nombre', String(nfdMayus?.message))
    const pina = await store.renombrar('p1', c1b.id, '  Pin\u0303a  ')
    check(
      'un nombre en NFD se guarda en NFC y sin espacios en los extremos',
      pina.nombre === 'Pi\u00f1a' && existsSync(path.join(consolas('p1'), 'Pi\u00f1a.sql')),
      JSON.stringify(pina.nombre)
    )
    const invalidos = ['../fuera', 'a/b', 'a\\b', '..', 'x..y', '', '   ', '.oculto', 'a'.repeat(101), 'con\ttab']
    const resInvalidos: string[] = []
    for (const nombre of invalidos) {
      const e = await error(() => store.renombrar('p1', c4.id, nombre))
      if (e?.codigo !== 'nombre') resInvalidos.push(JSON.stringify(nombre))
    }
    check(
      'saneado: separadores, "..", vacío, oculto, >100 y control se rechazan',
      resInvalidos.length === 0,
      resInvalidos.length === 0 ? `${invalidos.length} rechazados` : `aceptados: ${resInvalidos.join(' ')}`
    )
    const largoBytes = validarNombreConsola('\u{1F600}'.repeat(70), 'mac')
    check(
      'tope de 255 bytes UTF-8 del nombre de archivo (70 emojis caben en 100 caracteres, no en bytes)',
      !largoBytes.ok,
      JSON.stringify(largoBytes)
    )
    const reservados = ['CON', 'con', 'Prn', 'AUX', 'nul', 'COM1', 'com9', 'Lpt1', 'LPT9', 'aux.algo', 'CON ', 'COM\u00b9']
    const winRes = reservados.map((r) => validarNombreConsola(r, 'windows'))
    const macRes = reservados.map((r) => validarNombreConsola(r, 'mac'))
    check(
      "windows: nombres reservados rechazados",
      winRes.every((r) => !r.ok),
      winRes.map((r, i) => `${reservados[i]}:${r.ok}`).join(' ')
    )
    check(
      'NEGATIVA mac: los mismos nombres son válidos',
      macRes.every((r) => r.ok),
      macRes.map((r, i) => `${reservados[i]}:${r.ok}`).join(' ')
    )
    const noReservados = ['COM10', 'CONSOLA', 'console', 'nulo', 'LPT', 'auxiliar']
    check(
      'NEGATIVA windows: parecidos que NO son reservados se aceptan',
      noReservados.every((r) => validarNombreConsola(r, 'windows').ok),
      noReservados.join(',')
    )
    const winCaracteres = ['a:b', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'fin.']
    check(
      'windows: < > : " | ? * y el punto final se rechazan',
      winCaracteres.every((r) => !validarNombreConsola(r, 'windows').ok),
      winCaracteres.join(' ')
    )
    check(
      'NEGATIVA mac: esos caracteres y el punto final se aceptan',
      winCaracteres.every((r) => validarNombreConsola(r, 'mac').ok),
      winCaracteres.join(' ')
    )
    const conWin = await error(() => store.renombrar('p1', c4.id, 'CON'))
    check(
      "store 'windows': renombrar a CON se rechaza sin tocar el disco",
      conWin?.codigo === 'nombre' && existsSync(path.join(consolas('p1'), 'A\u00f1o.sql')),
      String(conWin?.message)
    )

    // -----------------------------------------------------------------------
    hr('(5) borrar y borrarDeConexion')
    // -----------------------------------------------------------------------
    const antes = enPapelera.length
    await store.borrar('p1', c2.id)
    check(
      'borrar una consola con texto -> a la papelera, fuera del índice',
      enPapelera.length === antes + 1 &&
        path.dirname(enPapelera[enPapelera.length - 1]) === consolas('p1') &&
        !existsSync(path.join(consolas('p1'), 'Ventas.sql')) &&
        !(await store.listar('p1')).some((c) => c.id === c2.id),
      path.basename(enPapelera[enPapelera.length - 1] ?? '')
    )
    const blanca = await store.crear('p1', 'B')
    await store.escribir('p1', blanca.id, '  \n\t\n')
    const antesBlanca = enPapelera.length
    await store.borrar('p1', blanca.id)
    check(
      'una consola con solo espacios cuenta como vacía: unlink',
      enPapelera.length === antesBlanca && !existsSync(path.join(consolas('p1'), `${blanca.nombre}.sql`)),
      blanca.nombre
    )
    const idem = await error(() => store.borrar('p1', 'no-existe'))
    check('borrar una consola que ya no existe no es error', idem === null, String(idem?.message))
    const rota = await store.crear('p1', 'B')
    await store.escribir('p1', rota.id, 'con texto')
    papeleraRota = true
    const errPapelera = await error(() => store.borrar('p1', rota.id))
    papeleraRota = false
    check(
      'si la papelera falla NO se borra en firme',
      errPapelera?.codigo === 'papelera' &&
        existsSync(path.join(consolas('p1'), `${rota.nombre}.sql`)) &&
        (await store.listar('p1')).some((c) => c.id === rota.id),
      String(errPapelera?.message)
    )
    const zombi = await store.crear('p1', 'B')
    const pEscribe = store.escribir('p1', zombi.id, 'antes de borrar')
    const pBorra = store.borrar('p1', zombi.id)
    await Promise.all([pEscribe, pBorra])
    const errZombi = await error(() => store.escribir('p1', zombi.id, 'despues de borrar'))
    check(
      'una escritura tras el borrado no resucita el archivo',
      errZombi?.codigo === 'noExiste' && !existsSync(path.join(consolas('p1'), `${zombi.nombre}.sql`)),
      String(errZombi?.message)
    )
    const deA = (await store.listar('p1')).filter((c) => c.conexionId === 'A')
    for (const c of deA) await store.escribir('p1', c.id, `texto de ${c.nombre}`)
    const antesConexion = enPapelera.length
    const borradas = await store.borrarDeConexion('p1', 'A')
    const tras = await store.listar('p1')
    check(
      'borrarDeConexion: solo las de esa conexión, a la papelera',
      borradas === deA.length &&
        deA.length > 0 &&
        enPapelera.length === antesConexion + deA.length &&
        tras.every((c) => c.conexionId !== 'A') &&
        tras.some((c) => c.conexionId === 'B'),
      `borradas=${borradas} quedan=${tras.map((c) => `${c.nombre}:${c.conexionId}`).join(',')}`
    )

    // -----------------------------------------------------------------------
    hr('(6) reconciliación del índice')
    // -----------------------------------------------------------------------
    const r1 = await store.crear('p3', 'A')
    await store.escribir('p3', r1.id, 'select reconciliar;')
    renameSync(path.join(consolas('p3'), 'consola_1.sql'), path.join(consolas('p3'), 'renombrada.sql'))
    const trasCaida = await store.listar('p3')
    const indiceP3 = JSON.parse(readFileSync(path.join(consolas('p3'), 'indice.json'), 'utf-8')) as {
      consolas: Array<{ id: string; nombre: string; conexionId: string }>
    }
    check(
      'renombrado a medias (archivo sí, índice no): se empareja 1 a 1 y conserva id y conexión',
      trasCaida.length === 1 &&
        trasCaida[0].id === r1.id &&
        trasCaida[0].nombre === 'renombrada' &&
        trasCaida[0].conexionId === 'A' &&
        indiceP3.consolas[0].nombre === 'renombrada',
      JSON.stringify(trasCaida.map((c) => [c.id, c.nombre]))
    )
    {
      // Un `.js` suelto (no es de nadie) no cuenta como huérfano de una `.sql`.
      vivos.add('pjs')
      const rj = await store.crear('pjs', 'A')
      await store.escribir('pjs', rj.id, 'select 1;')
      writeFileSync(path.join(consolas('pjs'), 'notas.js'), '// suelto')
      renameSync(path.join(consolas('pjs'), 'consola_1.sql'), path.join(consolas('pjs'), 'ventas.sql'))
      const l = await store.listar('pjs')
      check(
        'un .js suelto no impide emparejar la .sql renombrada por fuera',
        l.length === 1 && l[0].id === rj.id && l[0].nombre === 'ventas',
        JSON.stringify(l.map((c) => [c.id, c.nombre]))
      )
    }
    renameSync(path.join(consolas('p3'), 'renombrada.sql'), path.join(consolas('p3'), 'RENOMBRADA.sql'))
    const trasMayus = await store.listar('p3')
    check(
      'cambio de mayúsculas por fuera: la entrada adopta el nombre real',
      trasMayus.length === 1 && trasMayus[0].nombre === 'RENOMBRADA',
      JSON.stringify(trasMayus.map((c) => c.nombre))
    )
    const r2 = await store.crear('p3', 'A')
    const r3 = await store.crear('p3', 'B')
    writeFileSync(path.join(consolas('p3'), 'ajena_1.sql'), 'x')
    writeFileSync(path.join(consolas('p3'), 'ajena_2.sql'), 'y')
    unlinkSync(path.join(consolas('p3'), `${r2.nombre}.sql`))
    unlinkSync(path.join(consolas('p3'), `${r3.nombre}.sql`))
    const ambiguo = await store.listar('p3')
    check(
      'dos sin archivo y dos huérfanos: no se adivina; se podan las entradas y los huérfanos no se listan',
      ambiguo.length === 1 &&
        ambiguo[0].id === r1.id &&
        existsSync(path.join(consolas('p3'), 'ajena_1.sql')) &&
        existsSync(path.join(consolas('p3'), 'ajena_2.sql')),
      JSON.stringify(ambiguo.map((c) => c.nombre))
    )
    unlinkSync(path.join(consolas('p3'), 'RENOMBRADA.sql'))
    const borradoFuera = await store.listar('p3')
    check('borrado por fuera sin huérfano que emparejar: se poda', borradoFuera.length === 0, `${borradoFuera.length}`)

    // Índice corrupto con .bak: el .bak de writeFileAtomic va una escritura por detrás.
    const b1 = await store.crear('p4', 'A')
    await store.crear('p4', 'A')
    writeFileSync(path.join(consolas('p4'), 'indice.json'), '{ esto no es json')
    const desdeBak = await store.listar('p4')
    check(
      'índice corrupto: se recupera del .bak (lo que el .bak no conoce queda sin listar)',
      desdeBak.length === 1 && desdeBak[0].id === b1.id,
      JSON.stringify(desdeBak.map((c) => [c.id, c.nombre]))
    )

    // Entradas manipuladas en el índice (el agente puede editarlo).
    const fuera = path.join(conexiones, 'fuera.sql')
    writeFileSync(fuera, 'no me toques')
    const manipulado = {
      version: 1,
      consolas: [
        { id: 'trampa-1', conexionId: 'A', nombre: '../../fuera', creadaEn: 1 },
        { id: 'trampa-2', conexionId: 'A', nombre: '..\\..\\fuera', creadaEn: 1 },
        { id: 'trampa-3', conexionId: 'A', nombre: '..', creadaEn: 1 },
        { id: 'trampa-4', conexionId: 'A', nombre: 'C:\\fuera', creadaEn: 1 },
        null,
        { id: 42, conexionId: 'A', nombre: 'x' }
      ]
    }
    mkdirSync(consolas('p5'), { recursive: true })
    writeFileSync(path.join(consolas('p5'), 'indice.json'), JSON.stringify(manipulado))
    const listaTrampa = await store.listar('p5')
    const leerTrampa = await error(() => store.leer('p5', 'trampa-1'))
    const escribirTrampa = await error(() => store.escribir('p5', 'trampa-2', 'pisado'))
    check(
      'TRAVERSAL por el índice: entradas con ../ ni se listan ni se leen ni se escriben',
      listaTrampa.length === 0 &&
        leerTrampa?.codigo === 'noExiste' &&
        escribirTrampa?.codigo === 'noExiste' &&
        readFileSync(fuera, 'utf-8') === 'no me toques',
      `${listaTrampa.length} / ${leerTrampa?.codigo} / ${escribirTrampa?.codigo}`
    )

    // -----------------------------------------------------------------------
    hr('(7) seguridad: perfiles y errores sin rutas')
    // -----------------------------------------------------------------------
    const muerto = await error(() => store.listar('muerto'))
    check('perfil no vivo (dirPerfil null) -> error perfil', muerto?.codigo === 'perfil', String(muerto?.message))
    const idsMalos = ['../p1', 'p1/../p2', '..\\p1', '..', '.', '']
    const aceptados: string[] = []
    for (const id of idsMalos) {
      const e = await error(() => store.crear(id, 'A'))
      if (e?.codigo !== 'perfil') aceptados.push(JSON.stringify(id))
    }
    check(
      'TRAVERSAL en el id de perfil -> error perfil',
      aceptados.length === 0,
      aceptados.length === 0 ? `${idsMalos.length} rechazados` : `aceptados: ${aceptados.join(' ')}`
    )
    vivos.add('p6')
    mkdirSync(path.join(conexiones, 'p6'), { recursive: true })
    writeFileSync(path.join(conexiones, 'p6', 'consolas'), 'soy un archivo, no una carpeta')
    const errFs = await error(() => store.crear('p6', 'A'))
    check(
      'error de fs real (consolas es un archivo) -> ErrorConsolas fs sin ruta',
      errFs?.codigo === 'fs' && !errFs.message.includes(base) && errFs.message.includes('carpeta de consolas'),
      String(errFs?.message)
    )
    const envuelto = await respuestaConsolas(async () => {
      throw new Error(`ENOENT: no such file or directory, open '${path.join(base, 'x.sql')}'`)
    })
    check(
      'respuestaConsolas nunca deja pasar el mensaje de un error ajeno',
      !envuelto.ok && !envuelto.error.mensaje.includes(base) && envuelto.error.motivo === 'interno',
      JSON.stringify(envuelto.ok ? null : envuelto.error)
    )
    const conRuta = mensajes.filter(
      (m) => m.includes(base) || m.includes(os.tmpdir()) || m.includes('NO ES ErrorConsolas')
    )
    check(
      `ninguno de los ${mensajes.length} errores vistos lleva una ruta del host ni es ajeno`,
      conRuta.length === 0 && mensajes.length > 10,
      conRuta.length === 0 ? `${mensajes.length} mensajes limpios` : conRuta.join(' | ')
    )
    const todas: DbConsolaInfo[] = [...(await store.listar('p1')), ...(await store.listar('p2'))]
    check(
      'rutaRelativa siempre POSIX relativa ("consolas/<nombre>.sql")',
      todas.length > 0 &&
        todas.every((c) => c.rutaRelativa === `consolas/${c.nombre}.sql` && !c.rutaRelativa.includes('\\')),
      todas.map((c) => c.rutaRelativa).join(',')
    )
    // -----------------------------------------------------------------------
    hr('(8) esquema elegido de la consola (en el índice) y saneado de nombres')
    // -----------------------------------------------------------------------
    const c8 = await store.crear('p1', 'CX')
    const f8 = await store.fijarEsquema('p1', c8.id, 'VENTAS')
    const l8 = (await store.listar('p1')).find((c) => c.id === c8.id)
    check('fijar: la respuesta y listar traen el esquema', f8.esquema === 'VENTAS' && l8?.esquema === 'VENTAS', JSON.stringify(l8))
    const indice8 = JSON.parse(readFileSync(path.join(consolas('p1'), 'indice.json'), 'utf8')) as {
      consolas: Array<{ id: string; esquema?: string }>
    }
    check(
      'va en indice.json, no en el .sql (el agente no tropieza con una línea que no escribió)',
      indice8.consolas.find((e) => e.id === c8.id)?.esquema === 'VENTAS' &&
        readFileSync(path.join(consolas('p1'), `${c8.nombre}.sql`), 'utf8') === '',
      JSON.stringify(indice8.consolas.find((e) => e.id === c8.id))
    )
    const ren8 = await store.renombrar('p1', c8.id, 'con_esquema')
    check('renombrar conserva el esquema', ren8.esquema === 'VENTAS', JSON.stringify(ren8))
    const q8 = await store.fijarEsquema('p1', c8.id, null)
    const l8b = (await store.listar('p1')).find((c) => c.id === c8.id)
    check('null lo quita: vuelve al de la conexión', !('esquema' in q8) && l8b !== undefined && !('esquema' in l8b), JSON.stringify(l8b))
    const vacio8 = await error(() => store.fijarEsquema('p1', c8.id, ''))
    check('esquema vacío: rechazado', vacio8?.codigo === 'entrada', String(vacio8?.message))
    const nada8 = await error(() => store.fijarEsquema('p1', 'no-existe', 'X'))
    check('consola que no existe: noExiste', nada8?.codigo === 'noExiste', String(nada8?.message))
    // El índice lo puede tocar cualquiera: un esquema raro se ignora sin perder la consola.
    const doc8 = JSON.parse(readFileSync(path.join(consolas('p1'), 'indice.json'), 'utf8')) as {
      consolas: Array<Record<string, unknown>>
    }
    for (const e of doc8.consolas) if (e.id === c8.id) e.esquema = 42
    writeFileSync(path.join(consolas('p1'), 'indice.json'), JSON.stringify(doc8))
    const l8c = (await store.listar('p1')).find((c) => c.id === c8.id)
    check('un esquema que no es texto en el índice se ignora (la consola sigue)', l8c !== undefined && !('esquema' in l8c), JSON.stringify(l8c))
    const brutos = [
      'HR.EMPLEADOS',
      '"Mi/Tabla":x',
      'CON',
      'con.txt',
      ' .oculto',
      'fin. ',
      'a<b>c|d?e*f"g',
      '',
      'x'.repeat(300),
      'año 😀 ñ'.repeat(40),
      'a..b',
      'tab\tla\u0000',
      '..',
      'LPT¹'
    ]
    const saneadosMal: string[] = []
    for (const pl of ['windows', 'mac'] as const) {
      for (const b of brutos) {
        const s = sanearNombreArchivo(b, pl)
        const v = validarNombreConsola(s, pl)
        if (!v.ok || v.nombre !== s || Buffer.byteLength(s, 'utf8') > 255 - 8) saneadosMal.push(`${pl}:${JSON.stringify(b)}->${JSON.stringify(s)}`)
      }
    }
    check('sanearNombreArchivo: el resultado SIEMPRE pasa validarNombreConsola en las dos plataformas', saneadosMal.length === 0, saneadosMal.join(' | ') || `${brutos.length * 2} casos`)
    check(
      'sanear: lo válido no se toca; lo prohibido pasa a _; reservado de Windows con _ delante solo allí',
      sanearNombreArchivo('HR.EMPLEADOS', 'windows') === 'HR.EMPLEADOS' &&
        sanearNombreArchivo('"Mi/Tabla":x', 'mac') === '"Mi_Tabla"_x' &&
        sanearNombreArchivo('"Mi/Tabla":x', 'windows') === '_Mi_Tabla__x' &&
        sanearNombreArchivo('CON', 'windows') === '_CON' &&
        sanearNombreArchivo('CON', 'mac') === 'CON' &&
        sanearNombreArchivo('', 'mac') === 'exportacion',
      [sanearNombreArchivo('"Mi/Tabla":x', 'mac'), sanearNombreArchivo('"Mi/Tabla":x', 'windows'), sanearNombreArchivo('CON', 'windows')].join(' · ')
    )

    // -----------------------------------------------------------------------
    hr('(9) el candado por perfil (KeyedMutex) y la versión por contenido')
    // -----------------------------------------------------------------------
    vivos.add('p7')
    vivos.add('p8')
    // Instrumentado: `dirPerfil` es lo PRIMERO que hace cada operación ya dentro del
    // candado (`carpeta()`), y el escritor lento marca cuándo hay una escritura de p7 en
    // vuelo. Si una operación de p7 entra con esa marca puesta, el candado no serializa.
    const enVuelo = { p7: false }
    const violaciones: string[] = []
    const fallo9 = { dir: false }
    const dirInstr = (id: string): string | null => {
      if (fallo9.dir && id === 'p7') {
        fallo9.dir = false
        throw Object.assign(new Error(`EACCES: permission denied, open '${path.join(base, 'secreto')}'`), { code: 'EACCES' })
      }
      if (id === 'p7' && enVuelo.p7) violaciones.push('una operación de p7 entró con una escritura de p7 en vuelo')
      return dirPerfil(id)
    }
    const lento = crearStore('windows', {
      dirPerfil: dirInstr,
      escribirArchivo: async (ruta: string, texto: string) => {
        const esP7 = ruta.startsWith(consolas('p7'))
        if (esP7) enVuelo.p7 = true
        try {
          await esperar(150)
          await writeFileAtomic(ruta, texto)
        } finally {
          if (esP7) enVuelo.p7 = false
        }
      }
    })
    const k7 = await lento.crear('p7', 'A')
    await lento.crear('p8', 'A')
    const escritura7 = lento.escribir('p7', k7.id, 'select 7 from dual;')
    await esperar(20)
    const enVueloAlPedir = enVuelo.p7
    const lista7 = lento.listar('p7')
    const lista8 = await lento.listar('p8')
    const p7SeguiaEscribiendo = enVuelo.p7
    await Promise.all([escritura7, lista7])
    check(
      'H1 mismo perfil EN SERIE: listar(p7) no entra mientras p7 escribe',
      enVueloAlPedir && violaciones.length === 0 && (await lista7).length === 1,
      `en vuelo al pedir=${enVueloAlPedir} · ${violaciones.join(' | ') || 'sin solapes'}`
    )
    check(
      'H1 perfiles distintos EN PARALELO: listar(p8) acaba con p7 aún escribiendo',
      lista8.length === 1 && p7SeguiaEscribiendo,
      `p8=${lista8.length} consola(s), p7 seguía escribiendo=${p7SeguiaEscribiendo}`
    )

    const orden9: string[] = []
    const escrituraFifo = lento.escribir('p7', k7.id, 'fifo')
    await esperar(10)
    await Promise.all([
      lento.fijarEsquema('p7', k7.id, 'VENTAS').then(() => orden9.push('a')),
      lento.listar('p7').then(() => orden9.push('b')),
      lento.fijarEsquema('p7', k7.id, null).then(() => orden9.push('c'))
    ])
    await escrituraFifo
    const final9 = (await lento.listar('p7')).find((c) => c.id === k7.id)
    check(
      'H1 FIFO dentro del perfil: acaban en el orden de llegada y gana la última escritura del índice',
      orden9.join('') === 'abc' && final9 !== undefined && !('esquema' in final9) && violaciones.length === 0,
      `${orden9.join('')} · esquema final=${JSON.stringify(final9?.esquema)}`
    )

    fallo9.dir = true
    const errAjeno = await error(() => lento.listar('p7'))
    const trasError = await lento.listar('p7')
    check(
      'H1 un error ajeno dentro del candado sale como ErrorConsolas fs SIN ruta, y la cola sigue',
      errAjeno?.codigo === 'fs' && !errAjeno.message.includes(base) && trasError.length === 1,
      `${errAjeno?.codigo}: ${errAjeno?.message} · después: ${trasError.length}`
    )

    const hecho9 = { listar: false }
    void lento.escribir('p7', k7.id, 'vaciar')
    setTimeout(() => {
      void lento.listar('p7').then(() => {
        hecho9.listar = true
      })
    }, 20)
    await lento.vaciar()
    check(
      'H1 vaciar() espera también lo que se encola MIENTRAS espera (hasta que no queda nada)',
      hecho9.listar && readFileSync(path.join(consolas('p7'), `${k7.nombre}.sql`), 'utf-8') === 'vaciar',
      `listar encolado durante vaciar terminado=${hecho9.listar}`
    )

    // B4: todas las escrituras de este store dejan la MISMA hora (el mismo tic, fijado
    // con `utimes` en segundos enteros, exactos en NTFS, APFS y ext4).
    const T = 1_700_000_000
    const tic = crearStore('windows', {
      escribirArchivo: async (ruta: string, texto: string) => {
        await writeFileAtomic(ruta, texto)
        utimesSync(ruta, T, T)
      }
    })
    const v9 = await tic.crear('p8', 'B')
    const rutaV9 = path.join(consolas('p8'), `${v9.nombre}.sql`)
    await tic.leer('p8', v9.id)
    const w1 = await tic.escribir('p8', v9.id, 'aaaa')
    writeFileSync(rutaV9, 'bbbb') // el agente: el MISMO tamaño…
    utimesSync(rutaV9, T, T) // …y la MISMA hora
    const w2 = await tic.escribir('p8', v9.id, 'cccc')
    check(
      'B4 cambio de fuera del MISMO tamaño y la MISMA hora -> conflicto con lo del disco (no se pisa)',
      w1.ok && !w2.ok && w2.conflicto && w2.texto === 'bbbb' && readFileSync(rutaV9, 'utf-8') === 'bbbb',
      `${JSON.stringify(w2)} · disco=${JSON.stringify(readFileSync(rutaV9, 'utf-8'))}`
    )
    const w3 = await tic.escribir('p8', v9.id, 'cccc')
    utimesSync(rutaV9, T + 3600, T + 3600) // un `touch`: otra hora, el mismo contenido
    const w4 = await tic.escribir('p8', v9.id, 'dddd')
    const leida9 = await tic.leer('p8', v9.id)
    check(
      'B4 mitad negativa: un touch (otra hora, mismo contenido) NO es conflicto, y la versión de lo escrito es la de lo leído',
      w3.ok && w4.ok && readFileSync(rutaV9, 'utf-8') === 'dddd' && leida9.version === w4.version,
      `${JSON.stringify(w4)} · leída=${leida9.version}`
    )

    // -----------------------------------------------------------------------
    hr('(10) La extensión por consola (.js de MongoDB, .redis de Redis, .sql el resto)')
    // -----------------------------------------------------------------------
    const dirX = path.join(conexiones, 'px')
    const conX = path.join(dirX, 'consolas')
    const ext = crearStore('mac', { dirPerfil: (id) => (id === 'px' ? dirX : null) })
    const js1 = await ext.crear('px', 'M', '.js')
    const sql2 = await ext.crear('px', 'S')
    check(
      'crear con .js: consola_1.js en disco y en la ruta relativa; sin extensión, consola_2.sql (el nombre es único en toda la carpeta)',
      js1.nombre === 'consola_1' &&
        js1.rutaRelativa === 'consolas/consola_1.js' &&
        existsSync(path.join(conX, 'consola_1.js')) &&
        sql2.nombre === 'consola_2' &&
        sql2.rutaRelativa === 'consolas/consola_2.sql',
      JSON.stringify([js1.rutaRelativa, sql2.rutaRelativa])
    )
    const indiceX = JSON.parse(readFileSync(path.join(conX, 'indice.json'), 'utf-8')) as { consolas: Array<Record<string, unknown>> }
    check(
      'el índice guarda extension: ".js" en la de MongoDB y NADA en la SQL (igual al byte que antes)',
      indiceX.consolas[0].extension === '.js' && !('extension' in indiceX.consolas[1]),
      JSON.stringify(indiceX.consolas)
    )
    await ext.escribir('px', js1.id, 'db.clientes.find()')
    const leidaJs = await ext.leer('px', js1.id)
    check('escribir y leer la consola .js', leidaJs.texto === 'db.clientes.find()' && readFileSync(path.join(conX, 'consola_1.js'), 'utf-8') === 'db.clientes.find()', JSON.stringify(leidaJs.texto))
    writeFileSync(path.join(conX, 'consola_3.js'), 'de fuera')
    const js4 = await ext.crear('px', 'M', '.js')
    const listaX = await ext.listar('px')
    check(
      'un consola_3.js ajeno también ocupa el número, y no se lista',
      js4.nombre === 'consola_4' && listaX.map((c) => c.nombre).join(',') === 'consola_1,consola_2,consola_4',
      `${js4.nombre} · ${listaX.map((c) => c.nombre).join(',')}`
    )
    unlinkSync(path.join(conX, 'consola_3.js'))
    const renJs = await ext.renombrar('px', js1.id, 'mi_consulta')
    const choque = await error(() => ext.renombrar('px', sql2.id, 'MI_CONSULTA'))
    check(
      'renombrar la .js mueve su archivo (con su extensión); la .sql no puede llamarse igual (nombre único sin mirar la extensión)',
      renJs.rutaRelativa === 'consolas/mi_consulta.js' &&
        existsSync(path.join(conX, 'mi_consulta.js')) &&
        !existsSync(path.join(conX, 'consola_1.js')) &&
        choque?.codigo === 'nombre',
      `${renJs.rutaRelativa} · ${choque?.codigo}`
    )
    renameSync(path.join(conX, 'mi_consulta.js'), path.join(conX, 'otro.js'))
    const trasMv = await ext.listar('px')
    const otro = trasMv.find((c) => c.id === js1.id)
    check('un mv por fuera de la .js se reconcilia (una entrada sin archivo + un archivo sin entrada, MISMA extensión)', otro?.nombre === 'otro' && otro.rutaRelativa === 'consolas/otro.js', JSON.stringify(otro))
    unlinkSync(path.join(conX, 'consola_2.sql'))
    writeFileSync(path.join(conX, 'suelto.js'), '')
    const trasMezcla = await ext.listar('px')
    check(
      'mitad negativa: una .sql perdida NO se empareja con un .js suelto',
      !trasMezcla.some((c) => c.id === sql2.id) && !trasMezcla.some((c) => c.nombre === 'suelto'),
      trasMezcla.map((c) => c.rutaRelativa).join(',')
    )
    const indiceRaro = JSON.parse(readFileSync(path.join(conX, 'indice.json'), 'utf-8')) as { version: number; consolas: unknown[] }
    indiceRaro.consolas.push({ id: 'raro', conexionId: 'M', nombre: 'raro', creadaEn: 1, extension: '.py' })
    writeFileSync(path.join(conX, 'indice.json'), JSON.stringify(indiceRaro))
    writeFileSync(path.join(conX, 'raro.py'), 'x')
    const conRaro = await ext.listar('px')
    const malaExt = await error(() => ext.crear('px', 'M', '.exe' as never))
    check(
      'una entrada del índice con una extensión desconocida se descarta; crear con una extensión desconocida es error de entrada',
      !conRaro.some((c) => c.id === 'raro') && malaExt?.codigo === 'entrada',
      `${conRaro.map((c) => c.id).join(',')} · ${malaExt?.codigo}`
    )
    // Redis: `.redis`, con las mismas reglas que la `.js`.
    const kv = await ext.crear('px', 'R', '.redis')
    await ext.escribir('px', kv.id, 'GET usuario:1')
    const leidaKv = await ext.leer('px', kv.id)
    const indiceKv = JSON.parse(readFileSync(path.join(conX, 'indice.json'), 'utf-8')) as { consolas: Array<Record<string, unknown>> }
    const trasKv = await ext.listar('px')
    check(
      'crear con .redis: su archivo en disco, extension ".redis" en el índice, se lee y se lista',
      kv.rutaRelativa === `consolas/${kv.nombre}.redis` &&
        existsSync(path.join(conX, `${kv.nombre}.redis`)) &&
        leidaKv.texto === 'GET usuario:1' &&
        indiceKv.consolas.some((c) => c.id === kv.id && c.extension === '.redis') &&
        trasKv.some((c) => c.id === kv.id),
      `${kv.rutaRelativa} · ${JSON.stringify(leidaKv.texto)}`
    )
    await ext.vaciar()

    await store.vaciar()
    await espia.vaciar()
    await lento.vaciar()
    await tic.vaciar()
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  // -------------------------------------------------------------------------
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
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
