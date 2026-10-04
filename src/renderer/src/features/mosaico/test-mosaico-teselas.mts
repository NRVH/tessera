#!/usr/bin/env node
// =============================================================================
// Prueba de mosaicoTeselas: qué sesiones son teselas del mosaico y en qué orden.
// (node src/renderer/src/features/mosaico/test-mosaico-teselas.mts)
// Las claves de los fixtures salen de agentTargetKey para que su forma sea la real.
// La sección (9) comprueba propiedades sobre miles de universos aleatorios con
// semilla FIJA, así que un fallo se reproduce igual en las dos plataformas.
// Decisiones: docs/decisiones/mosaico/teselas-y-orden.md
// =============================================================================

import {
  MAX_TESELAS,
  MAX_RECIENTES,
  accionPeticion,
  alternarTesela,
  claveVista,
  compararCandidatos,
  limiteTeselas,
  ordenarCandidatos,
  ordenarClaves,
  reconciliarTeselas,
  reemplazarTesela,
  seleccionInicial,
  tocarReciente,
  type CandidatoMosaico,
  type SenalesMosaico
} from './mosaicoTeselas.ts'
import { agentTargetKey } from '../pestanas/tabsModel.ts'
import type { Agente } from '../../../../main/profiles/types.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function cand(
  profileId: string,
  ordenPerfil: number,
  projectHostPath: string,
  ordenProyecto: number,
  agente: Agente
): CandidatoMosaico {
  return {
    key: agentTargetKey(profileId, projectHostPath, agente),
    profileId,
    projectHostPath,
    agente,
    ordenPerfil,
    ordenProyecto
  }
}

/** Nombre corto de una clave para la evidencia: "perfil/proyecto/cc|cx". */
function corto(key: string): string {
  const [perfil, proyecto, agente] = key.split('|')
  const base = proyecto.split(/[\\/]/).pop() ?? proyecto
  return `${perfil}/${base}/${agente === 'claude-code' ? 'cc' : 'cx'}`
}
function lista(keys: readonly string[]): string {
  return '[' + keys.map(corto).join(', ') + ']'
}
function igual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i])
}

function senales(
  activa: string | null,
  terminadas: readonly string[] = [],
  trabajando: readonly string[] = []
): SenalesMosaico {
  return { activa, terminadasSinVer: new Set(terminadas), trabajando: new Set(trabajando) }
}

// Banda: "personal" a la IZQUIERDA (0) de "gamma" (1). En personal hay dos
// pestañas (web, api); en gamma, dos (erp, legacy). Cada proyecto, CC y Codex.
const P_WEB_CC = cand('personal', 0, 'C:\\p\\web', 0, 'claude-code')
const P_WEB_CX = cand('personal', 0, 'C:\\p\\web', 0, 'codex')
const P_API_CC = cand('personal', 0, 'C:\\p\\api', 1, 'claude-code')
const P_API_CX = cand('personal', 0, 'C:\\p\\api', 1, 'codex')
const S_ERP_CC = cand('gamma', 1, '/Users/n/erp', 0, 'claude-code')
const S_ERP_CX = cand('gamma', 1, '/Users/n/erp', 0, 'codex')
const S_LEG_CC = cand('gamma', 1, '/Users/n/legacy', 1, 'claude-code')
const S_LEG_CX = cand('gamma', 1, '/Users/n/legacy', 1, 'codex')

/** Los 8 en orden canónico. */
const TODOS: CandidatoMosaico[] = [P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_ERP_CX, S_LEG_CC, S_LEG_CX]
const CLAVES_TODOS = TODOS.map((c) => c.key)
/** Los 8 barajados a mano (ni canónico ni inverso). */
const BARAJADOS: CandidatoMosaico[] = [S_LEG_CX, P_API_CX, S_ERP_CC, P_WEB_CX, S_LEG_CC, P_WEB_CC, S_ERP_CX, P_API_CC]

function existen(...c: readonly CandidatoMosaico[]): ReadonlySet<string> {
  return new Set(c.map((x) => x.key))
}
function claves(...c: readonly CandidatoMosaico[]): string[] {
  return c.map((x) => x.key)
}

// ---------------------------------------------------------------------------
// Azar REPRODUCIBLE (mulberry32 con semilla fija) y utilidades de propiedades
// ---------------------------------------------------------------------------
function generador(semilla: number): () => number {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function barajar<T>(xs: readonly T[], azar: () => number): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
function subconjunto<T>(xs: readonly T[], azar: () => number, p: number): T[] {
  return xs.filter(() => azar() < p)
}
function elegir<T>(xs: readonly T[], azar: () => number): T {
  return xs[Math.floor(azar() * xs.length)]
}
function sinRepetidas(xs: readonly string[]): boolean {
  return new Set(xs).size === xs.length
}

const AGENTES: readonly Agente[] = ['claude-code', 'codex']
const PERFILES = ['personal', 'gamma', 'cliente']
const PROYECTOS = ['C:\\p\\web', '/Users/n/erp', 'C:\\p\\api', '/Users/n/legacy']

/** Un universo al azar: banda de perfiles barajada, 0-4 proyectos por perfil, CC y Codex en cada uno. */
function universo(azar: () => number): CandidatoMosaico[] {
  const out: CandidatoMosaico[] = []
  barajar(PERFILES, azar).forEach((perfil, ordenPerfil) => {
    const n = Math.floor(azar() * (PROYECTOS.length + 1))
    barajar(PROYECTOS, azar)
      .slice(0, n)
      .forEach((proyecto, ordenProyecto) => {
        for (const agente of AGENTES) out.push(cand(perfil, ordenPerfil, proyecto, ordenProyecto, agente))
      })
  })
  return out
}

/** Orden canónico de REFERENCIA, escrito aparte del módulo (en un universo no hay empates). */
function canonicoRef(c: readonly CandidatoMosaico[]): string[] {
  const rango = (a: Agente): number => (a === 'claude-code' ? 0 : 1)
  return [...c]
    .sort(
      (a, b) =>
        a.ordenPerfil - b.ordenPerfil || a.ordenProyecto - b.ordenProyecto || rango(a.agente) - rango(b.agente)
    )
    .map((x) => x.key)
}

/** Grupo de prioridad de REFERENCIA de seleccionInicial. */
function grupoRef(k: string, s: SenalesMosaico): number {
  if (k === s.activa) return 0
  if (s.terminadasSinVer.has(k)) return 1
  if (s.trabajando.has(k)) return 2
  return 3
}

interface Propiedad {
  casos: number
  fallo: string | null
}
const propiedades = new Map<string, Propiedad>()
/** Registra un caso; guarda sólo el PRIMER contraejemplo (la evidencia se calcula perezosa). */
function prop(nombre: string, ok: boolean, detalle: () => string): void {
  const p = propiedades.get(nombre) ?? { casos: 0, fallo: null }
  p.casos++
  if (!ok && p.fallo === null) p.fallo = detalle()
  propiedades.set(nombre, p)
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) ordenarCandidatos: orden canónico')
  // ---------------------------------------------------------------------------
  {
    // Mezcla: el proyecto de gamma con ordenProyecto 0 no puede adelantar al de
    // personal con ordenProyecto 1: manda el perfil.
    const entrada = [S_ERP_CX, P_API_CC, P_WEB_CX, S_ERP_CC, P_WEB_CC]
    const copia = [...entrada]
    const out = ordenarCandidatos(entrada)
    const esperado = claves(P_WEB_CC, P_WEB_CX, P_API_CC, S_ERP_CC, S_ERP_CX)
    check(
      '(1a) perfil antes que proyecto, CC antes que Codex',
      igual(
        out.map((c) => c.key),
        esperado
      ),
      lista(out.map((c) => c.key))
    )
    check(
      '(1b) personal/api (proyecto 1) va ANTES que gamma/erp (proyecto 0)',
      out.findIndex((c) => c.key === P_API_CC.key) < out.findIndex((c) => c.key === S_ERP_CC.key),
      'el orden del perfil gana al del proyecto'
    )
    check(
      '(1c) devuelve un array NUEVO y no muta la entrada',
      out !== entrada && igual(entrada.map((c) => c.key), copia.map((c) => c.key)),
      `entrada intacta: ${lista(entrada.map((c) => c.key))}`
    )
    const todos = ordenarCandidatos(BARAJADOS)
    check(
      '(1d) los 8 barajados salen canónicos',
      igual(
        todos.map((c) => c.key),
        CLAVES_TODOS
      ),
      lista(todos.map((c) => c.key))
    )
    // Empate total en perfil/proyecto/agente (dato incoherente): desempata la
    // clave, sea cual sea el orden de entrada.
    const x = { ...P_WEB_CC, key: 'b|x|claude-code' }
    const y = { ...P_WEB_CC, key: 'a|x|claude-code' }
    const d1 = ordenarCandidatos([x, y]).map((c) => c.key)
    const d2 = ordenarCandidatos([y, x]).map((c) => c.key)
    check(
      '(1e) empate total -> desempata la clave (estable, independiente de la entrada)',
      igual(d1, ['a|x|claude-code', 'b|x|claude-code']) && igual(d1, d2),
      d1.join(', ')
    )
    check('(1f) lista vacía -> vacía', ordenarCandidatos([]).length === 0, '[]')
    check(
      '(1g) ordenarClaves: canónico, desconocidas al final en su orden, sin repetidas',
      igual(ordenarClaves(['zz', S_ERP_CC.key, 'aa', P_WEB_CX.key, S_ERP_CC.key], TODOS), [
        P_WEB_CX.key,
        S_ERP_CC.key,
        'zz',
        'aa'
      ]),
      'zz y aa conservan su orden relativo'
    )

    // Robustez: un índice NaN no puede romper el comparador. Con el de resta, NaN
    // no era menor, mayor ni igual a nada y `sort` desordenaba TAMBIÉN a los sanos
    // según el orden de entrada.
    const roto = cand('roto', Number.NaN, 'C:\\p\\roto', 0, 'claude-code')
    const conNaN = [...TODOS, roto]
    const azar1 = generador(11)
    const salidasNaN = new Set<string>()
    for (let i = 0; i < 300; i++) {
      salidasNaN.add(
        ordenarCandidatos(barajar(conNaN, azar1))
          .map((c) => c.key)
          .join(' ')
      )
    }
    const unaNaN = ordenarCandidatos(conNaN).map((c) => c.key)
    check(
      '(1h) ordenPerfil NaN -> al final, y el orden no depende de la entrada (300 barajados)',
      salidasNaN.size === 1 && igual(unaNaN.slice(0, 8), CLAVES_TODOS) && unaNaN[8] === roto.key,
      `${salidasNaN.size} orden(es) distinto(s); último=${corto(unaNaN[unaNaN.length - 1])}`
    )

    const proyNaN = cand('personal', 0, 'C:\\p\\raro', Number.NaN, 'codex')
    const conProyNaN = ordenarCandidatos([S_ERP_CC, proyNaN, P_API_CC, P_WEB_CC]).map((c) => c.key)
    check(
      '(1i) ordenProyecto NaN -> al final de SU perfil, antes del perfil siguiente',
      igual(conProyNaN, claves(P_WEB_CC, P_API_CC, proyNaN, S_ERP_CC)),
      lista(conProyNaN)
    )

    // Un agente que el tipo no conoce (clave persistida por otra versión).
    const raro: CandidatoMosaico = {
      ...P_WEB_CC,
      key: 'personal|C:\\p\\web|gemini',
      agente: 'gemini' as string as Agente
    }
    const salidasRaro = new Set<string>()
    for (let i = 0; i < 100; i++) {
      salidasRaro.add(
        ordenarCandidatos(barajar([raro, P_WEB_CC, P_WEB_CX, P_API_CC], azar1))
          .map((c) => c.key)
          .join(' ')
      )
    }
    const conRaro = ordenarCandidatos([raro, P_API_CC, P_WEB_CX, P_WEB_CC]).map((c) => c.key)
    check(
      '(1j) agente desconocido -> detrás de CC y Codex de su proyecto, y determinista',
      salidasRaro.size === 1 && igual(conRaro, [P_WEB_CC.key, P_WEB_CX.key, raro.key, P_API_CC.key]),
      `${salidasRaro.size} orden(es); ${conRaro.map((k) => k.split('|')[2]).join(', ')}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(2) limiteTeselas')
  // ---------------------------------------------------------------------------
  check('(2a) sin max -> MAX_TESELAS', limiteTeselas() === MAX_TESELAS && MAX_TESELAS === 6, `${limiteTeselas()}`)
  check('(2b) max 10 -> 6 (la rejilla no sabe más)', limiteTeselas(10) === 6, `${limiteTeselas(10)}`)
  check('(2c) max -1 -> 0', limiteTeselas(-1) === 0, `${limiteTeselas(-1)}`)
  check('(2d) max 2.7 -> 2', limiteTeselas(2.7) === 2, `${limiteTeselas(2.7)}`)
  check('(2e) max NaN -> 6', limiteTeselas(Number.NaN) === 6, `${limiteTeselas(Number.NaN)}`)
  check(
    '(2f) max +Infinity -> 6',
    limiteTeselas(Number.POSITIVE_INFINITY) === 6,
    `${limiteTeselas(Number.POSITIVE_INFINITY)}`
  )
  check(
    '(2g) max -Infinity -> 0 (como -1; antes daba 6)',
    limiteTeselas(Number.NEGATIVE_INFINITY) === 0,
    `${limiteTeselas(Number.NEGATIVE_INFINITY)}`
  )
  check('(2h) max 0 -> 0', limiteTeselas(0) === 0, `${limiteTeselas(0)}`)

  // ---------------------------------------------------------------------------
  hr('(3) seleccionInicial: sólo lo que trabaja')
  // ---------------------------------------------------------------------------
  {
    // Ocho vivas, tres trabajando: entran las tres, en orden canónico. Es el caso
    // que motivó la regla (diez proyectos abiertos, tres agentes en marcha).
    const tres = senales(P_WEB_CX.key, [], [S_ERP_CC.key, P_WEB_CC.key, S_LEG_CX.key])
    const out3 = seleccionInicial(BARAJADOS, tres)
    check(
      '(3a) 8 vivas y 3 trabajando -> sólo esas 3, en orden canónico',
      igual(out3, claves(P_WEB_CC, S_ERP_CC, S_LEG_CX)),
      lista(out3)
    )

    // Las paradas NO entran aunque sean la activa o hayan terminado sin verse: si
    // entraran, volveríamos al mosaico que había que ir vaciando a mano.
    check(
      '(3b) la activa y las terminadas sin ver NO entran si no trabajan',
      !out3.includes(P_WEB_CX.key) && !out3.includes(S_LEG_CC.key),
      lista(out3)
    )

    // Nada trabaja: UNA casilla, la que estabas usando. Nunca vacío.
    const nadaTrabaja = seleccionInicial(BARAJADOS, senales(S_ERP_CX.key, [S_LEG_CC.key]))
    check(
      '(3c) sin nadie trabajando -> sólo la activa (aunque haya terminadas sin ver)',
      igual(nadaTrabaja, claves(S_ERP_CX)),
      lista(nadaTrabaja)
    )
    const activaFantasma = seleccionInicial(BARAJADOS, senales('fantasma|x|codex'))
    check(
      '(3d) sin nadie trabajando y activa no viva -> la primera canónica',
      igual(activaFantasma, claves(P_WEB_CC)),
      lista(activaFantasma)
    )
    const sinActiva = seleccionInicial(BARAJADOS, senales(null))
    check('(3e) sin nadie trabajando y sin activa -> la primera canónica', igual(sinActiva, claves(P_WEB_CC)), lista(sinActiva))

    // UNA POR PROYECTO: seis sesiones trabajando en TRES proyectos son tres casillas,
    // no seis. Con los dos agentes del mismo proyecto empatados, entra Claude Code
    // (el primero en orden canónico).
    const seisTrabajando = senales(null, [], CLAVES_TODOS.slice(0, 6))
    const out6 = seleccionInicial(BARAJADOS, seisTrabajando)
    check(
      '(3f) 6 trabajando en 3 proyectos -> 3 casillas, una por proyecto',
      igual(out6, claves(P_WEB_CC, P_API_CC, S_ERP_CC)),
      lista(out6)
    )

    // Trabajan las 8, en cuatro proyectos: una casilla por proyecto, y dentro de cada
    // uno gana el de más prioridad (la activa en legacy, la terminada sin ver en erp).
    const ocho = senales(S_LEG_CX.key, [S_LEG_CC.key, S_ERP_CX.key], CLAVES_TODOS)
    const out8 = seleccionInicial(BARAJADOS, ocho)
    check(
      '(3g) 8 trabajando -> 4 casillas, y en cada proyecto gana la de más prioridad',
      igual(out8, claves(P_WEB_CC, P_API_CC, S_ERP_CX, S_LEG_CX)),
      lista(out8)
    )
    check(
      '(3h) el resultado va en orden CANÓNICO, no de prioridad (la activa no va primero)',
      out8[0] === P_WEB_CC.key && out8[out8.length - 1] === S_LEG_CX.key,
      `primera=${corto(out8[0])} última=${corto(out8[out8.length - 1])}`
    )
    const outMax2 = seleccionInicial(TODOS, senales(S_LEG_CC.key, [P_API_CX.key], CLAVES_TODOS), 2)
    check(
      '(3i) max 2 entre 8 trabajando: la activa y la terminada sin ver',
      igual(outMax2, claves(P_API_CX, S_LEG_CC)),
      lista(outMax2)
    )

    const dup = seleccionInicial([P_WEB_CC, P_WEB_CC, S_ERP_CC], senales(null, [], [P_WEB_CC.key, S_ERP_CC.key]))
    check('(3j) vivos repetidos no duplican teselas', igual(dup, claves(P_WEB_CC, S_ERP_CC)), lista(dup))
    check('(3k) sin vivos -> vacío', seleccionInicial([], senales(null)).length === 0, '[]')
    check(
      '(3l) max 0 -> vacío aunque haya trabajando',
      seleccionInicial(TODOS, senales(P_WEB_CC.key, [], [P_WEB_CC.key]), 0).length === 0,
      '[]'
    )
    // Una que trabaja pero NO está viva (cerró su pestaña entre el snapshot de
    // actividad y el de targets) no puede colarse: se elige sobre `vivos`.
    const trabajaFantasma = seleccionInicial([P_WEB_CC, S_ERP_CC], senales(null, [], ['fantasma|x|codex', S_ERP_CC.key]))
    check('(3m) una clave trabajando que no está viva no entra', igual(trabajaFantasma, claves(S_ERP_CC)), lista(trabajaFantasma))

    const antes = BARAJADOS.map((c) => c.key)
    seleccionInicial(BARAJADOS, ocho)
    check('(3n) no muta vivos', igual(BARAJADOS.map((c) => c.key), antes), 'entrada intacta')
  }

  // ---------------------------------------------------------------------------
  hr('(4) reconciliarTeselas: pertenencia estable, sin entradas automáticas')
  // ---------------------------------------------------------------------------
  {
    const prev = claves(P_WEB_CC, P_API_CC, S_ERP_CC)

    const igualSinCambios = reconciliarTeselas(prev, {
      vivos: [P_WEB_CC, P_API_CC, S_ERP_CC],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check('(4a) nada cambia -> MISMA referencia', igualSinCambios === prev, lista(igualSinCambios))

    const cerrado = reconciliarTeselas(prev, {
      vivos: [P_WEB_CC, S_ERP_CC],
      orden: TODOS.filter((c) => c !== P_API_CC),
      existentes: existen(...TODOS.filter((c) => c !== P_API_CC))
    })
    check(
      '(4b) target cerrado (fuera de existentes) -> sale',
      igual(cerrado, claves(P_WEB_CC, S_ERP_CC)) && cerrado !== prev,
      lista(cerrado)
    )

    // P_API_CC salió (ya no está vivo) pero su pestaña sigue ahí: se queda.
    const salido = reconciliarTeselas(prev, {
      vivos: [P_WEB_CC, S_ERP_CC],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check(
      '(4c) agente salido pero target existente -> se QUEDA (misma referencia)',
      salido === prev,
      lista(salido)
    )

    // NADA ENTRA SOLO: una sesión nueva (o una que arranca a trabajar) con el
    // mosaico a medio llenar NO se mete en el hueco. La pone el usuario.
    const nueva = reconciliarTeselas(prev, {
      vivos: [P_WEB_CC, P_API_CC, S_ERP_CC, P_WEB_CX],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check('(4d) viva NUEVA con hueco -> no entra sola (misma referencia)', nueva === prev, lista(nueva))

    const desdeVacio = reconciliarTeselas([], {
      vivos: BARAJADOS,
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check('(4e) desde vacío con 8 vivas -> sigue vacío', desdeVacio.length === 0, lista(desdeVacio))

    const lleno = claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_ERP_CX)
    const sinHueco = reconciliarTeselas(lleno, {
      vivos: TODOS,
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check('(4f) lleno (6) y hay una 7ª viva -> no entra, misma referencia', sinHueco === lleno, lista(sinHueco))

    // Hibernar gamma/erp: sus DOS targets dejan de existir (y de estar vivos).
    const conErp = claves(P_WEB_CC, S_ERP_CC, S_ERP_CX)
    const sinErp = TODOS.filter((c) => c.projectHostPath !== S_ERP_CC.projectHostPath)
    const hibernado = reconciliarTeselas(conErp, {
      vivos: [P_WEB_CC],
      orden: TODOS,
      existentes: existen(...sinErp)
    })
    check(
      '(4g) proyecto hibernado (fuera de existentes) -> salen CC y Codex',
      igual(hibernado, claves(P_WEB_CC)),
      lista(hibernado)
    )

    // Se cierra una tesela del mosaico lleno: queda un hueco, y NADIE lo ocupa.
    const relevo = reconciliarTeselas(lleno, {
      vivos: TODOS.filter((c) => c !== P_API_CX),
      orden: TODOS,
      existentes: existen(...TODOS.filter((c) => c !== P_API_CX))
    })
    check(
      '(4h) sale una y el hueco se queda libre (la 7ª viva no lo ocupa)',
      igual(relevo, claves(P_WEB_CC, P_WEB_CX, P_API_CC, S_ERP_CC, S_ERP_CX)),
      lista(relevo)
    )

    // Claves que `orden` no conoce pero siguen existiendo: al final, en su orden.
    const raras = ['otro|b|codex', P_WEB_CC.key, 'otro|a|codex']
    const conRaras = reconciliarTeselas(raras, {
      vivos: [P_WEB_CC],
      orden: TODOS,
      existentes: new Set([...raras])
    })
    check(
      '(4i) desconocidas para orden -> al final, conservando su orden relativo',
      igual(conRaras, [P_WEB_CC.key, 'otro|b|codex', 'otro|a|codex']),
      conRaras.join(', ')
    )

    // Teselas salidas (no vivas) se ordenan por `orden` aunque no estén en vivos.
    const desorden = claves(S_ERP_CX, S_ERP_CC)
    const reordenado = reconciliarTeselas(desorden, {
      vivos: [],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check(
      '(4j) prev desordenado y sin vivos -> sale canónico según orden',
      igual(reordenado, claves(S_ERP_CC, S_ERP_CX)),
      lista(reordenado)
    )

    // El tope baja a 4 con 6 teselas: salen primero las no vivas, luego las
    // últimas canónicas.
    const recorte = reconciliarTeselas(lleno, {
      vivos: TODOS.filter((c) => c !== P_WEB_CX),
      orden: TODOS,
      existentes: existen(...TODOS),
      max: 4
    })
    check(
      '(4k) tope baja 6 -> 4: sale la no viva y luego la última canónica',
      igual(recorte, claves(P_WEB_CC, P_API_CC, P_API_CX, S_ERP_CC)),
      lista(recorte)
    )

    const conRepetidas = [P_WEB_CC.key, P_API_CC.key, P_WEB_CC.key, S_ERP_CC.key]
    const sinRep = reconciliarTeselas(conRepetidas, {
      vivos: [P_WEB_CC, P_API_CC, S_ERP_CC],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check(
      '(4l) prev con repetidas -> se quitan (array nuevo)',
      igual(sinRep, prev) && sinRep !== conRepetidas,
      lista(sinRep)
    )

    const tope0 = reconciliarTeselas(prev, {
      vivos: TODOS,
      orden: TODOS,
      existentes: existen(...TODOS),
      max: 0
    })
    check('(4m) max 0 -> vacío', tope0.length === 0, lista(tope0))

    // Una tesela que `orden` no conoce (sólo `vivos`) se coloca según sus datos.
    const soloVivos = reconciliarTeselas(claves(P_WEB_CC, S_ERP_CC, S_LEG_CC), {
      vivos: [P_WEB_CC, S_ERP_CC, S_LEG_CC],
      orden: TODOS.filter((c) => c !== S_ERP_CC),
      existentes: existen(...TODOS)
    })
    check(
      '(4n) tesela que sólo conoce `vivos` -> en su sitio según sus propios datos',
      igual(soloVivos, claves(P_WEB_CC, S_ERP_CC, S_LEG_CC)),
      lista(soloVivos)
    )

    // `orden` y `vivos` discrepan (datos de dos momentos distintos): manda `orden`
    // para decidir DÓNDE se pinta cada tesela.
    const segunVivos: CandidatoMosaico = { ...S_LEG_CX, ordenPerfil: -1, ordenProyecto: 0 }
    const desfase = reconciliarTeselas(claves(S_LEG_CX, P_WEB_CC), {
      vivos: [segunVivos, P_WEB_CC],
      orden: TODOS,
      existentes: existen(...TODOS)
    })
    check(
      '(4o) orden y vivos discrepan -> manda orden para colocarlas',
      igual(desfase, claves(P_WEB_CC, S_LEG_CX)),
      lista(desfase)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(5) alternarTesela')
  // ---------------------------------------------------------------------------
  {
    const prev = claves(P_WEB_CC, P_API_CC, S_ERP_CC)

    const quitada = alternarTesela(prev, P_API_CC.key, { orden: TODOS, recientes: [] })
    check('(5a) clave ya tesela -> se quita', igual(quitada, claves(P_WEB_CC, S_ERP_CC)), lista(quitada))

    const metida = alternarTesela(prev, S_LEG_CC.key, { orden: TODOS, recientes: [] })
    check(
      '(5b) proyecto nuevo con hueco -> entra en su sitio canónico',
      igual(metida, claves(P_WEB_CC, P_API_CC, S_ERP_CC, S_LEG_CC)),
      lista(metida)
    )

    // UNA CASILLA POR PROYECTO: el otro agente de un proyecto que ya es casilla
    // SUSTITUYE al que había, no abre una segunda del mismo árbol de trabajo.
    const hermano = alternarTesela(prev, P_API_CX.key, { orden: TODOS, recientes: [] })
    check(
      '(5c) el otro agente de un proyecto que ya es casilla -> sustituye, no añade',
      igual(hermano, claves(P_WEB_CC, P_API_CX, S_ERP_CC)),
      lista(hermano)
    )

    // `lleno` es un prev ARTIFICIAL (lleva los dos agentes de tres proyectos): sirve
    // para fijar el DESALOJO, que mira la antigüedad y no los proyectos. La invariante
    // de una casilla por proyecto la fijan (5c) y las propiedades de más abajo.
    const lleno = claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_ERP_CX)
    // Todas en recientes; la menos reciente es P_WEB_CX (la última de la lista).
    const recientes = claves(S_ERP_CX, P_API_CC, S_ERP_CC, P_WEB_CC, P_API_CX, P_WEB_CX)
    const sustituida = alternarTesela(lleno, S_LEG_CC.key, { orden: TODOS, recientes })
    check(
      '(5d) lleno -> sustituye a la enfocada hace MÁS tiempo',
      igual(sustituida, claves(P_WEB_CC, P_API_CC, P_API_CX, S_ERP_CC, S_ERP_CX, S_LEG_CC)),
      lista(sustituida)
    )
    check(
      '(5e) tras sustituir, sigue siendo de 6 y en orden canónico',
      sustituida.length === 6 && igual(sustituida, ordenarClaves(sustituida, TODOS)),
      `${sustituida.length} teselas`
    )

    // Dos teselas no aparecen en recientes (P_WEB_CC y S_ERP_CC): cuentan como
    // más viejas que cualquiera presente; entre ellas, sale la ÚLTIMA canónica.
    const parciales = claves(S_ERP_CX, P_API_CC, P_WEB_CX, P_API_CX)
    const ausente = alternarTesela(lleno, S_LEG_CX.key, { orden: TODOS, recientes: parciales })
    check(
      '(5f) ausentes de recientes = más viejas; entre ellas sale la última canónica',
      igual(ausente, claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CX, S_LEG_CX)),
      lista(ausente)
    )

    const sinRecientes = alternarTesela(lleno, S_LEG_CC.key, { orden: TODOS, recientes: [] })
    check(
      '(5g) sin recientes -> sale la última canónica (S_ERP_CX)',
      igual(sinRecientes, claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_LEG_CC)),
      lista(sinRecientes)
    )

    const desconocida = alternarTesela(prev, 'nadie|x|codex', { orden: TODOS, recientes: [] })
    check('(5h) clave desconocida para orden -> MISMA referencia', desconocida === prev, lista(desconocida))

    // Que la clave nueva ya esté en recientes no altera a quién se sustituye.
    const conNueva = alternarTesela(lleno, S_LEG_CC.key, {
      orden: TODOS,
      recientes: [S_LEG_CC.key, ...recientes]
    })
    check(
      '(5i) la clave nueva en recientes no cuenta como tesela',
      igual(conNueva, sustituida),
      lista(conNueva)
    )

    const deUno = alternarTesela([P_WEB_CC.key], S_ERP_CC.key, { orden: TODOS, recientes: [], max: 1 })
    check('(5j) max 1 -> sustituye la única', igual(deUno, claves(S_ERP_CC)), lista(deUno))

    // Tesela que `orden` no conoce: el contrato manda la MISMA referencia (no se
    // alterna nada que el selector no sepa listar).
    const conAjena = [P_WEB_CC.key, 'ajena|/x|codex']
    const ajena = alternarTesela(conAjena, 'ajena|/x|codex', { orden: TODOS, recientes: [] })
    check('(5k) tesela desconocida para orden -> MISMA referencia', ajena === conAjena, ajena.join(', '))

    const quitadaCanon = alternarTesela(claves(S_ERP_CC, P_API_CC, P_WEB_CC), P_API_CC.key, {
      orden: TODOS,
      recientes: []
    })
    check(
      '(5l) quitar de un prev desordenado -> el resto en orden canónico',
      igual(quitadaCanon, claves(P_WEB_CC, S_ERP_CC)),
      lista(quitadaCanon)
    )

    // Tope 4 con 6 teselas: para que quepa la nueva salen las TRES menos recientes
    // (P_WEB_CX, P_API_CX y P_WEB_CC, por `recientes`).
    const encoge = alternarTesela(lleno, S_LEG_CC.key, { orden: TODOS, recientes, max: 4 })
    check(
      '(5m) tope 4 con 6 teselas -> salen las 3 menos recientes y entra la nueva',
      igual(encoge, claves(P_API_CC, S_ERP_CC, S_ERP_CX, S_LEG_CC)),
      lista(encoge)
    )

    check(
      '(5n) max 0 y clave nueva -> MISMA referencia',
      alternarTesela(prev, P_API_CX.key, { orden: TODOS, recientes: [], max: 0 }) === prev,
      'prev'
    )

    // Repetida en recientes: cuenta su PRIMERA aparición (la más reciente). Si
    // contara la última, P_WEB_CC pasaría por la más vieja y saldría ella.
    const recRep = [...claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_ERP_CX), P_WEB_CC.key]
    const conRecRep = alternarTesela(lleno, S_LEG_CC.key, { orden: TODOS, recientes: recRep })
    check(
      '(5o) repetida en recientes -> cuenta la aparición más reciente',
      igual(conRecRep, claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC, S_LEG_CC)),
      lista(conRecRep)
    )

    // Con un PROYECTO nuevo (si fuera el otro agente de uno que ya es casilla, la ida
    // sustituiría y la vuelta dejaría el proyecto fuera: ver (5c)).
    const ida = alternarTesela(prev, S_LEG_CX.key, { orden: TODOS, recientes: [] })
    const vuelta = alternarTesela(ida, S_LEG_CX.key, { orden: TODOS, recientes: [] })
    check('(5p) marcar y desmarcar con hueco -> vuelve al mismo conjunto', igual(vuelta, prev), lista(vuelta))

    // Sustituir al hermano NO es excusa para pasarse del tope: con seis teselas y
    // tope 4, la que entra ocupa el hueco de su hermano y el recorte sigue corriendo.
    const cinco = claves(P_WEB_CC, P_WEB_CX, P_API_CC, P_API_CX, S_ERP_CC)
    const hermanoConTope = alternarTesela(cinco, S_ERP_CX.key, { orden: TODOS, recientes, max: 3 })
    check(
      '(5q) sustituir al otro agente respeta el tope si el prev venía pasado',
      hermanoConTope.length === 3 &&
        hermanoConTope.includes(S_ERP_CX.key) &&
        !hermanoConTope.includes(S_ERP_CC.key),
      lista(hermanoConTope)
    )

    const copiaLleno = [...lleno]
    alternarTesela(lleno, S_LEG_CC.key, { orden: TODOS, recientes })
    check('(5r) no muta prev', igual(lleno, copiaLleno), lista(lleno))
  }

  // ---------------------------------------------------------------------------
  hr('(6) reemplazarTesela: la casilla cambia de destino')
  // ---------------------------------------------------------------------------
  {
    const prev = claves(P_WEB_CC, P_API_CC, S_ERP_CC)

    // Terminé en personal/api y me paso a gamma/legacy: mismo número de casillas, y
    // el resultado en orden canónico (la nueva va a SU rincón, no al que dejó).
    const otroProyecto = reemplazarTesela(prev, P_API_CC.key, S_LEG_CC.key, { orden: TODOS })
    check(
      '(6a) a otro proyecto -> misma cantidad, en orden canónico',
      igual(otroProyecto, claves(P_WEB_CC, S_ERP_CC, S_LEG_CC)),
      lista(otroProyecto)
    )

    // El chip CC/Cdx de la cabecera: el mismo proyecto, el otro agente.
    const otroAgente = reemplazarTesela(prev, P_API_CC.key, P_API_CX.key, { orden: TODOS })
    check(
      '(6b) al otro agente del mismo proyecto -> ocupa su sitio canónico',
      igual(otroAgente, claves(P_WEB_CC, P_API_CX, S_ERP_CC)),
      lista(otroAgente)
    )

    check(
      '(6c) destino que YA es tesela -> misma referencia (no se duplica una sesión)',
      reemplazarTesela(prev, P_API_CC.key, S_ERP_CC.key, { orden: TODOS }) === prev,
      lista(prev)
    )
    check(
      '(6d) la casilla de origen no es tesela -> misma referencia',
      reemplazarTesela(prev, S_LEG_CX.key, P_WEB_CX.key, { orden: TODOS }) === prev,
      lista(prev)
    )
    check(
      '(6e) destino desconocido para orden -> misma referencia',
      reemplazarTesela(prev, P_API_CC.key, 'fantasma|x|codex', { orden: TODOS }) === prev,
      lista(prev)
    )
    check(
      '(6f) origen y destino iguales -> misma referencia',
      reemplazarTesela(prev, P_API_CC.key, P_API_CC.key, { orden: TODOS }) === prev,
      lista(prev)
    )

    const conRepetidas = [P_WEB_CC.key, P_API_CC.key, P_WEB_CC.key]
    const limpio = reemplazarTesela(conRepetidas, P_API_CC.key, S_ERP_CC.key, { orden: TODOS })
    check(
      '(6g) prev con repetidas -> resultado sin repetidas',
      igual(limpio, claves(P_WEB_CC, S_ERP_CC)) && sinRepetidas(limpio),
      lista(limpio)
    )

    const antes = [...prev]
    reemplazarTesela(prev, P_API_CC.key, S_LEG_CC.key, { orden: TODOS })
    check('(6h) no muta prev', igual(prev, antes), lista(prev))

    // Una casilla que ya no está viva (su agente salió) también se puede mandar a
    // otro sitio: es un hueco, no una sesión.
    const desdeMuerta = reemplazarTesela(claves(P_WEB_CC), P_WEB_CC.key, S_LEG_CX.key, { orden: TODOS })
    check('(6i) una casilla sola cambia de destino', igual(desdeMuerta, claves(S_LEG_CX)), lista(desdeMuerta))

    // UNA CASILLA POR PROYECTO: el destino puede venir con el OTRO agente de un
    // proyecto que ya se ve en otra casilla. No se duplica; quien llama la enfoca.
    check(
      '(6j) destino cuyo proyecto ya está en otra casilla (con el otro agente) -> misma referencia',
      reemplazarTesela(prev, P_WEB_CC.key, P_API_CX.key, { orden: TODOS }) === prev,
      lista(prev)
    )
    // Pero el otro agente del proyecto de LA PROPIA casilla sí se acepta: es el chip.
    const chip = reemplazarTesela(prev, P_API_CC.key, P_API_CX.key, { orden: TODOS })
    check(
      '(6k) el otro agente de ESTA casilla sí entra (el chip CC/Cdx)',
      igual(chip, claves(P_WEB_CC, P_API_CX, S_ERP_CC)),
      lista(chip)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) tocarReciente')
  // ---------------------------------------------------------------------------
  {
    const r = ['a', 'b', 'c']
    const movida = tocarReciente(r, 'c')
    check('(7a) mueve al frente y quita la repetida', igual(movida, ['c', 'a', 'b']), movida.join(','))
    check('(7b) ya primera -> MISMA referencia', tocarReciente(r, 'a') === r, 'a ya estaba primera')
    const nueva = tocarReciente(r, 'z')
    check('(7c) clave nueva -> al frente', igual(nueva, ['z', 'a', 'b', 'c']), nueva.join(','))
    const larga = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const recortada = tocarReciente(larga, 'nueva')
    check(
      `(7d) tope de ${MAX_RECIENTES}`,
      recortada.length === 32 && MAX_RECIENTES === 32 && recortada[0] === 'nueva' && recortada[31] === 'k30',
      `len=${recortada.length} última=${recortada[recortada.length - 1]}`
    )
    check('(7e) no muta la entrada', igual(r, ['a', 'b', 'c']), r.join(','))
    const vacia = tocarReciente([], 'a')
    check('(7f) lista vacía -> [key]', igual(vacia, ['a']), vacia.join(','))
    const conRep = ['a', 'b', 'a']
    check(
      '(7g) ya primera -> misma referencia aunque traiga repetidas (lo dice el contrato)',
      tocarReciente(conRep, 'a') === conRep,
      conRep.join(',')
    )
    const limpia = tocarReciente(conRep, 'b')
    check('(7h) al mover, también limpia repetidas previas', igual(limpia, ['b', 'a']), limpia.join(','))
  }

  // ---------------------------------------------------------------------------
  hr('(8) claveVista')
  // ---------------------------------------------------------------------------
  {
    const teselas = claves(P_WEB_CC, S_ERP_CC)
    const normal = { mosaico: false, enfocada: null, teselas, activeTargetKey: P_API_CC.key }
    check(
      '(8a) vista normal con columna visible -> activeTargetKey',
      claveVista({ ...normal, ccVisible: true }) === P_API_CC.key,
      'activeTargetKey'
    )
    check(
      '(8b) vista normal con columna oculta -> null',
      claveVista({ ...normal, ccVisible: false }) === null,
      'null'
    )
    check(
      '(8c) mosaico, enfocada es tesela -> enfocada',
      claveVista({
        mosaico: true,
        enfocada: S_ERP_CC.key,
        teselas,
        activeTargetKey: P_WEB_CC.key,
        ccVisible: true
      }) === S_ERP_CC.key,
      'sólo la enfocada, aunque la activa también sea tesela'
    )
    check(
      '(8d) mosaico, enfocada NO es tesela -> null',
      claveVista({ mosaico: true, enfocada: P_API_CC.key, teselas, activeTargetKey: P_API_CC.key, ccVisible: true }) ===
        null,
      'null'
    )
    check(
      '(8e) mosaico sin enfocada -> null (aunque ccVisible y activa sean tesela)',
      claveVista({ mosaico: true, enfocada: null, teselas, activeTargetKey: P_WEB_CC.key, ccVisible: true }) === null,
      'null'
    )
    check(
      '(8f) mosaico: ccVisible no influye (la enfocada cuenta con la columna oculta)',
      claveVista({ mosaico: true, enfocada: S_ERP_CC.key, teselas, activeTargetKey: null, ccVisible: false }) ===
        S_ERP_CC.key,
      'enfocada'
    )
    check(
      '(8g) vista normal, columna visible pero sin activa -> null',
      claveVista({ ...normal, activeTargetKey: null, ccVisible: true }) === null,
      'null'
    )
    check(
      '(8h) vista normal ignora la enfocada',
      claveVista({ mosaico: false, enfocada: S_ERP_CC.key, teselas, activeTargetKey: P_API_CC.key, ccVisible: true }) ===
        P_API_CC.key,
      'activeTargetKey'
    )
  }

  // ---------------------------------------------------------------------------
  hr('(9) propiedades sobre universos aleatorios (semilla fija)')
  // ---------------------------------------------------------------------------
  {
    const P = {
      ordenRef: '(9a) ordenarCandidatos = orden de referencia, sea cual sea la entrada',
      ordenSucio: '(9b) ordenarCandidatos con NaN / agente raro: determinista, el NaN al final',
      ordenTotal: '(9c) compararCandidatos: orden total (antisimétrico y consistente por pares)',
      selTamano: '(9d) seleccionInicial: tamaño = min(vivas que trabajan, tope), o 1 si no trabaja ninguna',
      selForma: '(9e) seleccionInicial: sólo vivas que trabajan (o el respaldo), sin repetidas y en orden canónico',
      selRespaldo: '(9f) seleccionInicial: sin nadie trabajando -> sólo la activa viva, o la primera canónica',
      selPrioridad: '(9g) seleccionInicial: ninguna excluida tenía más prioridad que una incluida',
      selEntrada: '(9h) seleccionInicial: no depende del orden de entrada',
      selActiva: '(9i) seleccionInicial: la activa que trabaja entra siempre (tope >= 1)',
      recForma: '(9j) reconciliar: sin repetidas, dentro de existentes y del tope',
      recOrden: '(9k) reconciliar: orden canónico, desconocidas al final',
      recEstable: '(9l) reconciliar: conserva toda tesela que sigue existiendo (si cabe)',
      recSinEntradas: '(9m) reconciliar: NADA entra solo (todo estaba ya en prev)',
      recRecorte: '(9n) reconciliar: al recortar sale antes la no viva, luego la última canónica',
      recRef: '(9o) reconciliar: misma referencia si y sólo si no cambia nada',
      recIdem: '(9p) reconciliar: idempotente (la 2ª pasada devuelve la misma referencia)',
      altAjena: '(9q) alternar: clave desconocida -> misma referencia',
      altQuitar: '(9r) alternar: quitar deja el resto, sin repetidas y canónico',
      altTope0: '(9s) alternar: tope 0 y clave nueva -> misma referencia',
      altMeter: '(9t) alternar: meter -> entra, tamaño min(n+1, tope), canónico, sin repetidas',
      altVictima: '(9u) alternar: sale la enfocada hace más tiempo (ausente = más vieja; empate -> última canónica)',
      altIdaVuelta: '(9v) alternar: marcar y desmarcar con hueco vuelve al conjunto de partida',
      repForma: '(9w) reemplazar: entra el destino, sale el origen, mismo tamaño, canónico y sin repetidas',
      repNoop: '(9x) reemplazar: destino desconocido/ya tesela u origen que no lo es -> misma referencia',
      recPrimera: '(9y) tocarReciente: ya primera -> misma referencia',
      recFrente: '(9z) tocarReciente: al frente, sin repetidas, tope 32, el resto en su orden'
    }
    // Registradas de antemano: una propiedad condicional que no se ejercite ni una
    // vez es un FAIL, no un PASS por omisión.
    for (const nombre of Object.values(P)) propiedades.set(nombre, { casos: 0, fallo: null })

    const azar = generador(20260918)
    const VUELTAS = 3000
    const AJENA = 'ajena|/x|codex'
    const ROTO = 'roto|/r|codex'
    const TOPES: readonly (number | undefined)[] = [undefined, 0, 1, 2, 3, 4, 5, 6, 7, 10]

    for (let v = 0; v < VUELTAS; v++) {
      const uni = universo(azar)
      const ref = canonicoRef(uni)
      const idx = new Map(ref.map((k, i) => [k, i] as const))
      const pos = (k: string): number => idx.get(k) ?? Number.POSITIVE_INFINITY
      const enOrden = (xs: readonly string[]): boolean =>
        xs.every((k, i) => i === 0 || pos(xs[i - 1]) < pos(k) || (pos(xs[i - 1]) === Infinity && pos(k) === Infinity))
      const claveAlAzar = (): string => (uni.length > 0 && azar() < 0.8 ? elegir(uni, azar).key : AJENA)
      // Proyecto de cada clave: la unidad de "una casilla por proyecto".
      const proyRef = new Map(uni.map((c) => [c.key, `${c.profileId}|${c.projectHostPath}`] as const))
      const proy = (k: string): string => proyRef.get(k) ?? k

      // --- orden ------------------------------------------------------------
      const ordenado = ordenarCandidatos(barajar(uni, azar)).map((c) => c.key)
      prop(P.ordenRef, igual(ordenado, ref), () => `${lista(ordenado)} vs ${lista(ref)}`)

      const sucio: CandidatoMosaico[] = [...uni]
      const conNaN = azar() < 0.5
      if (conNaN) {
        sucio.push({
          key: ROTO,
          profileId: 'roto',
          projectHostPath: '/r',
          agente: 'codex',
          ordenPerfil: Number.NaN,
          ordenProyecto: 0
        })
      }
      if (azar() < 0.5) {
        sucio.push({
          key: 'personal|/r|gemini',
          profileId: 'personal',
          projectHostPath: '/r',
          agente: 'gemini' as string as Agente,
          ordenPerfil: 0,
          ordenProyecto: azar() < 0.5 ? 0 : Number.NaN
        })
      }
      const o1 = ordenarCandidatos(barajar(sucio, azar))
      const o2 = ordenarCandidatos(barajar(sucio, azar))
      const k1 = o1.map((c) => c.key)
      prop(
        P.ordenSucio,
        igual(
          k1,
          o2.map((c) => c.key)
        ) && (!conNaN || k1[k1.length - 1] === ROTO),
        () => `${lista(k1)} vs ${lista(o2.map((c) => c.key))}`
      )
      let total = true
      for (let i = 0; i < o1.length && total; i++) {
        for (let j = i + 1; j < o1.length && total; j++) {
          total = compararCandidatos(o1[i], o1[j]) < 0 && compararCandidatos(o1[j], o1[i]) > 0
        }
      }
      prop(P.ordenTotal, total, () => `par incoherente en ${lista(k1)}`)

      // --- seleccionInicial -------------------------------------------------
      const vivos = barajar(subconjunto(uni, azar, 0.6), azar)
      if (vivos.length > 0 && azar() < 0.2) vivos.push(elegir(vivos, azar))
      const sen = senales(
        azar() < 0.2 ? null : claveAlAzar(),
        subconjunto(uni, azar, 0.25).map((c) => c.key),
        subconjunto(uni, azar, 0.25).map((c) => c.key)
      )
      const max = elegir(TOPES, azar)
      const lim = limiteTeselas(max)
      const sel = seleccionInicial(vivos, sen, max)
      const vivosU = [...new Set(vivos.map((c) => c.key))]
      const trabajando = vivosU.filter((k) => sen.trabajando.has(k))
      const proyectosTrabajando = new Set(trabajando.map(proy)).size
      const esperadoTam =
        lim === 0 || vivosU.length === 0 ? 0 : trabajando.length === 0 ? 1 : Math.min(proyectosTrabajando, lim)
      prop(
        P.selTamano,
        sel.length === esperadoTam,
        () =>
          `${sel.length} (esperado ${esperadoTam}): ${trabajando.length} trabajando en ${proyectosTrabajando} proyectos, tope ${lim}`
      )
      prop(
        P.selForma,
        sinRepetidas(sel) &&
          sel.every((k) => vivosU.includes(k)) &&
          enOrden(sel) &&
          new Set(sel.map(proy)).size === sel.length &&
          (trabajando.length === 0 || sel.every((k) => sen.trabajando.has(k))),
        () => lista(sel)
      )
      if (trabajando.length === 0 && vivosU.length > 0 && lim >= 1) {
        const respaldo =
          sen.activa !== null && vivosU.includes(sen.activa) ? sen.activa : ordenarClaves(vivosU, uni)[0]
        prop(P.selRespaldo, igual(sel, [respaldo]), () => `${lista(sel)} vs [${corto(respaldo)}]`)
      }
      const excluidas = trabajando.filter((k) => !sel.includes(k))
      prop(
        P.selPrioridad,
        // Una excluida o cedió su sitio al OTRO agente de su proyecto (una por
        // proyecto), o perdió la carrera de prioridad contra todas las que entraron.
        excluidas.every(
          (k) =>
            sel.some((j) => proy(j) === proy(k)) ||
            sel.every(
              (j) => grupoRef(k, sen) > grupoRef(j, sen) || (grupoRef(k, sen) === grupoRef(j, sen) && pos(k) > pos(j))
            )
        ),
        () => `dentro ${lista(sel)} fuera ${lista(excluidas)}`
      )
      prop(P.selEntrada, igual(seleccionInicial(barajar(vivos, azar), sen, max), sel), () => lista(sel))
      if (sen.activa !== null && vivosU.includes(sen.activa) && sen.trabajando.has(sen.activa) && lim >= 1) {
        const activa = sen.activa
        prop(P.selActiva, sel.includes(activa), () => `${corto(activa)} fuera de ${lista(sel)}`)
      }

      // --- reconciliarTeselas -----------------------------------------------
      const existentesArr = subconjunto(uni, azar, 0.85).map((c) => c.key)
      if (azar() < 0.5) existentesArr.push(AJENA)
      const existentes = new Set(existentesArr)
      const prevR = barajar(
        [...subconjunto(uni, azar, 0.35).map((c) => c.key), ...(azar() < 0.2 ? [AJENA] : [])],
        azar
      )
      if (prevR.length > 0 && azar() < 0.15) prevR.push(elegir(prevR, azar))
      const ent = { vivos, orden: barajar(uni, azar), existentes, max }
      const rec = reconciliarTeselas(prevR, ent)
      const prevU = [...new Set(prevR)]
      const quedan = prevU.filter((k) => existentes.has(k))
      const vivas = new Set(vivos.map((c) => c.key))
      const evRec = (): string => `prev ${lista(prevR)} -> ${lista(rec)} (tope ${lim})`

      prop(P.recForma, sinRepetidas(rec) && rec.every((k) => existentes.has(k)) && rec.length <= lim, evRec)
      prop(P.recOrden, enOrden(rec), evRec)
      prop(P.recEstable, quedan.length > lim || quedan.every((k) => rec.includes(k)), evRec)
      prop(P.recSinEntradas, rec.every((k) => prevU.includes(k)), evRec)
      if (quedan.length > lim) {
        const fuera = quedan.filter((k) => !rec.includes(k))
        prop(
          P.recRecorte,
          rec.length === lim &&
            rec.every((k) => quedan.includes(k)) &&
            fuera.every((d) =>
              rec.every((r) => (vivas.has(d) !== vivas.has(r) ? !vivas.has(d) : pos(d) > pos(r)))
            ),
          evRec
        )
      }
      prop(P.recRef, (rec === prevR) === igual(rec, prevR), evRec)
      prop(P.recIdem, reconciliarTeselas(rec, ent) === rec, evRec)

      // --- alternarTesela ---------------------------------------------------
      const recientes = barajar(
        [...subconjunto(uni, azar, 0.5).map((c) => c.key), ...(azar() < 0.3 ? [AJENA] : [])],
        azar
      )
      if (recientes.length > 0 && azar() < 0.2) recientes.push(elegir(recientes, azar))
      const clave = azar() < 0.3 && prevU.length > 0 ? elegir(prevU, azar) : claveAlAzar()
      const entAlt = { orden: ent.orden, recientes, max }
      const alt = alternarTesela(prevR, clave, entAlt)
      const evAlt = (): string => `prev ${lista(prevR)} ± ${corto(clave)} -> ${lista(alt)} (tope ${lim})`
      if (!idx.has(clave)) {
        prop(P.altAjena, alt === prevR, evAlt)
      } else if (prevU.includes(clave)) {
        prop(
          P.altQuitar,
          sinRepetidas(alt) &&
            !alt.includes(clave) &&
            alt.length === prevU.length - 1 &&
            alt.every((k) => prevU.includes(k)) &&
            enOrden(alt),
          evAlt
        )
      } else if (lim === 0) {
        prop(P.altTope0, alt === prevR, evAlt)
      } else if (prevU.some((k) => proy(k) === proy(clave))) {
        // UNA CASILLA POR PROYECTO: el otro agente de un proyecto que ya es casilla
        // sustituye al que había, sin desalojar a un tercero... salvo que el prev que
        // llega ya pase del tope, en cuyo caso se recorta igual (sustituir no es
        // excusa para pasarse).
        const hermana = prevU.find((k) => proy(k) === proy(clave))!
        prop(
          P.altMeter,
          alt.includes(clave) &&
            !alt.includes(hermana) &&
            alt.length === Math.min(prevU.length, lim) &&
            sinRepetidas(alt) &&
            enOrden(alt) &&
            alt.every((k) => k === clave || prevU.includes(k)),
          evAlt
        )
      } else {
        const edad = (k: string): number => {
          const i = recientes.indexOf(k)
          return i < 0 ? Number.POSITIVE_INFINITY : i
        }
        const siguen = alt.filter((k) => k !== clave)
        const fuera = prevU.filter((k) => !alt.includes(k))
        prop(
          P.altMeter,
          alt.includes(clave) &&
            alt.length === Math.min(prevU.length + 1, lim) &&
            sinRepetidas(alt) &&
            enOrden(alt) &&
            siguen.every((k) => prevU.includes(k)),
          evAlt
        )
        prop(
          P.altVictima,
          fuera.every((d) =>
            siguen.every(
              (r) => edad(d) > edad(r) || (edad(d) === Infinity && edad(r) === Infinity && pos(d) > pos(r))
            )
          ),
          evAlt
        )
        if (prevU.length < lim) {
          const deVuelta = alternarTesela(alt, clave, entAlt)
          prop(P.altIdaVuelta, igual(deVuelta, ordenarClaves(prevU, ent.orden)), evAlt)
        }
      }

      // --- reemplazarTesela -------------------------------------------------
      const origen = prevU.length > 0 && azar() < 0.8 ? elegir(prevU, azar) : claveAlAzar()
      const destino = claveAlAzar()
      const rep = reemplazarTesela(prevR, origen, destino, { orden: ent.orden })
      const evRep = (): string => `prev ${lista(prevR)}: ${corto(origen)} -> ${corto(destino)} => ${lista(rep)}`
      const sustituye =
        origen !== destino &&
        idx.has(destino) &&
        prevU.includes(origen) &&
        !prevU.includes(destino) &&
        // Y su PROYECTO no está ya en otra casilla (una por proyecto).
        !prevU.some((k) => k !== origen && proy(k) === proy(destino))
      if (sustituye) {
        prop(
          P.repForma,
          rep.includes(destino) &&
            !rep.includes(origen) &&
            rep.length === prevU.length &&
            sinRepetidas(rep) &&
            enOrden(rep) &&
            rep.every((k) => k === destino || prevU.includes(k)),
          evRep
        )
      } else {
        prop(P.repNoop, rep === prevR, evRep)
      }

      // --- tocarReciente ----------------------------------------------------
      const lista0 = Array.from({ length: Math.floor(azar() * 45) }, () => claveAlAzar())
      const tocada = lista0.length > 0 && azar() < 0.2 ? lista0[0] : claveAlAzar()
      const tr = tocarReciente(lista0, tocada)
      if (lista0[0] === tocada) {
        prop(P.recPrimera, tr === lista0, () => lista(tr))
      } else {
        const esperado = [tocada, ...[...new Set(lista0)].filter((k) => k !== tocada)].slice(0, MAX_RECIENTES)
        prop(P.recFrente, igual(tr, esperado), () => `${lista(tr)} vs ${lista(esperado)}`)
      }
    }

    const ordenadas = [...propiedades].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [nombre, p] of ordenadas) {
      check(
        nombre,
        p.fallo === null && p.casos > 0,
        p.fallo ?? (p.casos > 0 ? `${p.casos} casos` : 'NUNCA se ejercitó')
      )
    }
  }

  // ---------------------------------------------------------------------------
  hr('(10) accionPeticion: destinos pedidos que aún no se pueden aplicar')
  // ---------------------------------------------------------------------------
  {
    const PROY = 'personal|C:\\p\\api'
    const pet = { casilla: P_WEB_CC.key, key: P_API_CC.key, proyecto: PROY }
    const base = {
      mosaico: true,
      teselas: claves(P_WEB_CC, S_ERP_CC),
      existe: true,
      hibernado: false,
      proyectoAbierto: true
    }

    check('(10a) todo listo y lo pidió una casilla -> reemplazar', accionPeticion(pet, base) === 'reemplazar', 'reemplazar')
    check(
      '(10b) todo listo y lo pidió la barra (casilla null) -> alternar',
      accionPeticion({ ...pet, casilla: null }, base) === 'alternar',
      'alternar'
    )
    check(
      '(10c) el target aún no existe (proyecto recién abierto) -> esperar',
      accionPeticion(pet, { ...base, existe: false }) === 'esperar',
      'esperar'
    )
    check(
      '(10d) existe pero sigue hibernado -> esperar (la reconciliación lo sacaría)',
      accionPeticion(pet, { ...base, hibernado: true }) === 'esperar',
      'esperar'
    )
    check('(10e) mosaico cerrado -> descartar', accionPeticion(pet, { ...base, mosaico: false }) === 'descartar', 'descartar')
    check(
      '(10f) la casilla que lo pidió ya no está -> descartar',
      accionPeticion(pet, { ...base, teselas: claves(S_ERP_CC) }) === 'descartar',
      'descartar'
    )
    // LA CADUCIDAD que evita el secuestro: si el proyecto se cierra mientras se
    // espera, la petición muere; si sólo se esperara por "no existe", quedaría armada
    // y al reabrir ese proyecto —minutos después— se comería la casilla de entonces.
    check(
      '(10g) su proyecto se cerró -> descartar, aunque siga faltando el target',
      accionPeticion(pet, { ...base, existe: false, proyectoAbierto: false }) === 'descartar',
      'descartar'
    )
    check(
      '(10h) la barra no exige casilla viva: con el mosaico abierto, sigue',
      accionPeticion({ ...pet, casilla: null }, { ...base, teselas: [] }) === 'alternar',
      'alternar'
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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

main()
