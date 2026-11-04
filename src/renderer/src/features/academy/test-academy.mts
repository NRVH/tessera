#!/usr/bin/env node
// =============================================================================
// Prueba de Tessera Academy (node src/renderer/src/features/academy/test-academy.mts): el marcado,
// que el español y el inglés de cada artículo tengan la misma forma (secciones, bloques, enlaces,
// capturas), que todo enlace y todo botón ⓘ llegue a un artículo y una sección que existen, que
// los ids no choquen con los ajustes y el vocabulario de la app. Con un argumento, solo los
// artículos cuyo id lo contenga.
// =============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fijarIdioma } from '../../../../shared/i18n.ts'
import { nombresSistema } from '../../../../shared/nombresSistema.ts'
import { CATEGORIAS } from '../ajustes/catalogo.ts'
import { ARTICULOS } from './articulos.ts'
import { AYUDA } from './ayudas.ts'
import { ARTICULOS_EN_ORDEN, esArticulo, gruposBuscables, type ArticuloId } from './indice.ts'
import { destinosDe, llavesDe, NOMBRES_ADMITIDOS, partirMarcado, sustituirNombres, textoPlano } from './marcado.ts'
import { partirDestino, plataformasDe, textosDe, tipoDeBloque, type Articulo } from './modelo.ts'

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

const filtro = process.argv[2] ?? ''
const ids = ARTICULOS_EN_ORDEN.filter((id) => id.includes(filtro))

function enIdioma(idioma: 'es' | 'en', id: ArticuloId): Articulo {
  fijarIdioma(idioma)
  const a = ARTICULOS[id]() as Articulo
  fijarIdioma('es')
  return a
}

/** Todos los textos con marcado de un artículo, con dónde están. */
function textosConSitio(a: Articulo): { sitio: string; texto: string }[] {
  const out = [{ sitio: 'resumen', texto: a.resumen }]
  for (const s of a.secciones) {
    out.push({ sitio: `${s.ancla}·título`, texto: s.titulo })
    s.bloques.forEach((b, i) => textosDe(b).forEach((texto) => out.push({ sitio: `${s.ancla}·${i}`, texto })))
  }
  return out
}

/** La forma de un artículo sin el texto: lo que tiene que coincidir entre idiomas. */
function forma(a: Articulo): string[] {
  return a.secciones.flatMap((s) => [
    `§${s.ancla}`,
    ...s.bloques.map((b, i) => {
      const extra = typeof b !== 'string' && 'captura' in b ? `=${b.captura}` : ''
      const n = textosDe(b).length
      const solo = plataformasDe(b)?.join('+') ?? '*'
      const enlaces = textosDe(b).flatMap(destinosDe).join(',')
      const llaves = textosDe(b).flatMap(llavesDe).join(',')
      return `${i}:${tipoDeBloque(b)}${extra}·${n}·${solo}·[${enlaces}]·{${llaves}}`
    })
  ])
}

/**
 * El texto de todos los `textos*.ts` de la interfaz (y de la ventana del relevo), tal cual: una negrita de un artículo cita una
 * etiqueta, y si la etiqueta cambia, el artículo tiene que cambiar con ella.
 */
const TEXTOS_INTERFAZ = (() => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const out: string[] = []
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'academy') recorrer(ruta)
      } else if (/^textos.*\.ts$/.test(e.name)) out.push(readFileSync(ruta, 'utf8'))
    }
  }
  recorrer(raiz)
  // La ventana de la actualización vive en el main, pero también es interfaz que se ve.
  recorrer(join(raiz, '..', '..', 'main', 'relevo'))
  return out.join('\n').replace(/\\'/g, "'")
})()

/** Las etiquetas con una parte variable (`Preparar ${n}`), como expresiones: la parte variable casa con lo que sea. */
const PLANTILLAS_INTERFAZ = [...TEXTOS_INTERFAZ.matchAll(/`([^`]*\$\{[^`]*)`/g)].map(
  (m) =>
    new RegExp(
      `^${m[1]
        .split(/\$\{[^}]*\}/)
        .map((p) => p.replace(/[.*+?^()|[\]\\{}$]/g, '\\$&'))
        .join('(.+?)')}$`
    )
)

/** Lo que un artículo puede poner en la parte variable de una etiqueta: un agente, un número, un ejemplo. */
const VALORES_DE_EJEMPLO = new Set(['Claude Code', 'Codex', 'tienda-web', 'Trabajo', 'Work'])

/**
 * Una negrita casa con una plantilla solo si lo que ocupa su parte variable es un valor de ejemplo:
 * «Preparar 3» con «Preparar ${n}» sí, pero «Maximize the git panel» con «Maximize ${x}» no, que
 * dejaría pasar una etiqueta que cambió.
 */
function estaEnLaInterfaz(trozo: string): boolean {
  if (TEXTOS_INTERFAZ.includes(trozo)) return true
  return PLANTILLAS_INTERFAZ.some((re) => {
    const m = re.exec(trozo)
    // La parte variable también puede ser otro texto de la interfaz («de este proyecto»).
    return m !== null && m.slice(1).every((v) => /^\d+$/.test(v) || VALORES_DE_EJEMPLO.has(v) || TEXTOS_INTERFAZ.includes(`'${v}'`))
  })
}

/**
 * Los trozos de una negrita que tienen que estar en la interfaz: una ruta de menús se parte por
 * «›», y lo que va entre llaves (un nombre del sistema) se salta.
 */
function trozosDeEtiqueta(negrita: string): string[] {
  return negrita
    .split(/\s*›\s*/)
    .flatMap((p) => p.split(/\{[a-zA-Z]+\}/))
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * Negritas que no citan una etiqueta de Tessera: las que resaltan una parte de la ventana o una
 * opción, los glifos de un botón y el botón del Llavero de macOS.
 */
const NEGRITAS_QUE_NO_SON_ETIQUETAS = new Set<string>([
  'Full Access', // de la interfaz de Codex, no de la de Tessera
  '⋯', // un icono, sin texto en la interfaz
  'ⓘ',
  '▾',
  'Permitir siempre',
  'Always Allow'
])

/** ¿Existe el destino? `null` si sí; si no, por qué. */
function fallaDestino(destino: string): string | null {
  const d = partirDestino(destino)
  if (!esArticulo(d.articulo)) return `no hay artículo «${d.articulo}»`
  if (d.ancla === null) return null
  const a = enIdioma('es', d.articulo)
  return a.secciones.some((s) => s.ancla === d.ancla) ? null : `«${d.articulo}» no tiene la sección «${d.ancla}»`
}

function main(): void {
  hr('Marcado')
  {
    const t = partirMarcado('Pulsa **Guardar**, mira `tdb ls` y lee [Perfiles](perfiles/color).')
    check(
      'parte negrita, código y enlace',
      JSON.stringify(t.map((x) => x.tipo)) === JSON.stringify(['texto', 'negrita', 'texto', 'codigo', 'texto', 'enlace', 'texto']) &&
        t[5].tipo === 'enlace' &&
        t[5].destino === 'perfiles/color',
      JSON.stringify(t)
    )
    check('texto plano sin marcas', textoPlano('a **b** `c` [d](e)') === 'a b c d', textoPlano('a **b** `c` [d](e)'))
    const win = sustituirNombres('Ábrelo en {gestorArchivos} de {tuEquipo}; {otra} queda.', nombresSistema('windows'))
    check('sustituye los nombres del sistema y deja lo demás', win.includes('{otra}') && !win.includes('{gestorArchivos}'), win)
    const d = partirDestino('cuentas/elegir')
    check('parte un destino', d.articulo === 'cuentas' && d.ancla === 'elegir', JSON.stringify(d))
    check('destino sin ancla', partirDestino('git').ancla === null, JSON.stringify(partirDestino('git')))
  }

  hr(`Artículos${filtro ? ` que contienen «${filtro}»` : ''}`)
  for (const id of ids) {
    const es = enIdioma('es', id)
    const en = enIdioma('en', id)
    const fes = forma(es)
    const fen = forma(en)
    const distinta = fes.findIndex((x, i) => x !== fen[i])
    check(
      `${id}: el inglés tiene la misma forma`,
      fes.length === fen.length && distinta < 0,
      distinta < 0 && fes.length === fen.length ? `${fes.length} piezas` : `es «${fes[distinta] ?? '—'}» / en «${fen[distinta] ?? '—'}»`
    )
    const anclas = es.secciones.map((s) => s.ancla)
    check(`${id}: anclas únicas y en minúscula con guiones`, new Set(anclas).size === anclas.length && anclas.every((a) => /^[a-z0-9-]+$/.test(a)), anclas.join(' '))
    check(`${id}: tiene resumen y al menos una sección con contenido`, es.resumen.trim() !== '' && es.secciones.length > 0 && es.secciones.every((s) => s.bloques.length > 0), `${es.secciones.length} secciones`)

    const rotos: string[] = []
    const llavesMalas: string[] = []
    const vocabulario: string[] = []
    const marcasSueltas: string[] = []
    for (const [idioma, a] of [['es', es], ['en', en]] as const) {
      for (const { sitio, texto } of textosConSitio(a)) {
        for (const dest of destinosDe(texto)) {
          const f = fallaDestino(dest)
          if (f) rotos.push(`${idioma} ${sitio}: ${f}`)
        }
        for (const k of llavesDe(texto)) if (!(NOMBRES_ADMITIDOS as readonly string[]).includes(k)) llavesMalas.push(`${idioma} ${sitio}: {${k}}`)
        if (idioma === 'es' && /dorm|despert|despiert/i.test(texto)) vocabulario.push(`${sitio}: ${texto.slice(0, 60)}`)
        if (idioma === 'en' && /\b(sleep|asleep|wake)/i.test(texto)) vocabulario.push(`en ${sitio}: ${texto.slice(0, 60)}`)
        // Estos nombres ya traen su artículo («el Explorador», «the Recycle Bin»): otro delante
        // lo duplica, y «de»/«a» delante de uno masculino no contrae («de el Explorador»).
        const articuloDoble =
          idioma === 'es'
            ? /\b(el|la|los|las)\s+\{(gestorArchivos|agenteClavesSsh|papelera)\}|\b(de|a)\s+\{(gestorArchivos|agenteClavesSsh)\}/i
            : /\bthe\s+\{(gestorArchivos|agenteClavesSsh|papelera)\}/i
        if (articuloDoble.test(texto)) vocabulario.push(`${idioma} ${sitio}: artículo de más delante de un nombre del sistema`)
        if (/PENDIENTE/.test(texto)) vocabulario.push(`${idioma} ${sitio}: artículo sin escribir`)
        if (/Windows|macOS|Finder|PowerShell|DPAPI|Llavero|Keychain|Papelera de reciclaje|Recycle Bin/.test(texto)) {
          const bloqueSolo = a.secciones.some((s) => s.bloques.some((b) => textosDe(b).includes(texto) && plataformasDe(b) !== null))
          if (!bloqueSolo) vocabulario.push(`${idioma} ${sitio}: nombra un sistema a mano (usa {sistema}, {gestorArchivos}… o un bloque soloEn)`)
        }
        const plano = textoPlano(texto)
        if (/\*\*|`|\]\(/.test(plano)) marcasSueltas.push(`${idioma} ${sitio}: ${plano.slice(0, 60)}`)
      }
    }
    check(`${id}: todos los enlaces llegan`, rotos.length === 0, rotos.join(' | ') || 'ok')
    check(`${id}: solo nombres del sistema conocidos entre llaves`, llavesMalas.length === 0, llavesMalas.join(' | ') || 'ok')
    check(`${id}: vocabulario de la app`, vocabulario.length === 0, vocabulario.join(' | ') || 'ok')
    check(`${id}: sin marcas mal cerradas`, marcasSueltas.length === 0, marcasSueltas.join(' | ') || 'ok')
  }

  hr('Capturas')
  {
    const citadas = new Set(
      ARTICULOS_EN_ORDEN.flatMap((id) =>
        enIdioma('es', id).secciones.flatMap((s) => s.bloques.flatMap((b) => (typeof b !== 'string' && 'captura' in b ? [b.captura] : [])))
      )
    )
    const carpeta = join(dirname(fileURLToPath(import.meta.url)), 'capturas')
    const hay = new Set(existsSync(carpeta) ? readdirSync(carpeta) : [])
    const faltan = [...citadas].flatMap((c) => ['es', 'en'].filter((i) => !hay.has(`${c}.${i}.webp`)).map((i) => `${c}.${i}.webp`))
    const sobran = [...hay].filter((f) => !citadas.has(f.replace(/\.(es|en)\.webp$/, '')))
    check('cada captura citada existe en los dos idiomas (npm run capturas:academy)', faltan.length === 0, faltan.join(', ') || `${citadas.size} capturas`)
    check('no sobra ninguna captura sin artículo que la cite', sobran.length === 0, sobran.join(', ') || 'ok')
  }

  hr('Etiquetas en negrita')
  {
    const malas: string[] = []
    for (const id of ids) {
      for (const idioma of ['es', 'en'] as const) {
        for (const { sitio, texto } of textosConSitio(enIdioma(idioma, id))) {
          for (const t of partirMarcado(texto)) {
            if (t.tipo !== 'negrita') continue
            const falta = trozosDeEtiqueta(t.texto).find((p) => !estaEnLaInterfaz(p))
            if (falta !== undefined && !NEGRITAS_QUE_NO_SON_ETIQUETAS.has(t.texto)) malas.push(`${idioma} ${id} ${sitio}: «${falta}»`)
          }
        }
      }
    }
    check(
      'cada negrita es una etiqueta que existe en la interfaz (o está en NEGRITAS_QUE_NO_SON_ETIQUETAS)',
      malas.length === 0,
      malas.join(' | ') || 'ok'
    )
  }

  hr('Botones ⓘ')
  const ayudasRotas = Object.entries(AYUDA).flatMap(([k, d]) => {
    const f = fallaDestino(d)
    return f ? [`${k}: ${f}`] : []
  })
  check('todo ⓘ lleva a una sección que existe', ayudasRotas.length === 0, ayudasRotas.join(' | ') || `${Object.keys(AYUDA).length} destinos`)

  hr('Índice')
  const idsAjustes = new Set(CATEGORIAS.flatMap((c) => c.grupos.flatMap((g) => g.ajustes.map((a) => a.id as string))))
  const choques = ARTICULOS_EN_ORDEN.filter((id) => idsAjustes.has(id))
  check('ningún artículo se llama como un ajuste (el buscador los confundiría)', choques.length === 0, choques.join(', ') || 'ok')
  for (const idioma of ['es', 'en'] as const) {
    fijarIdioma(idioma)
    const g = gruposBuscables()
    const vacios = g.flatMap((x) => x.ajustes.filter((a) => a.etiqueta.trim() === '' || a.claves.length === 0).map((a) => a.id))
    check(`grupos buscables en ${idioma} con título y palabras`, vacios.length === 0 && g.every((x) => x.titulo.trim() !== ''), vacios.join(', ') || `${g.length} grupos`)
  }
  fijarIdioma('es')

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
