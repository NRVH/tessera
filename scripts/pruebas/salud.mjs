#!/usr/bin/env node
// =============================================================================
// Analiza el registro de salud de las versiones alpha (`salud.jsonl` y `salud.1.jsonl`):
// días cubiertos, tendencia de memoria por proceso en MB/día (regresión lineal por grupos de la misma
// sesión de la app y con el mismo nº de terminales+agentes abiertos: ni un reinicio ni abrir más
// cosas se confunden con una fuga),
// picos, memoria antes y después de cada suspensión y procesos caídos. Marca si cruza la línea
// de corte (fuga >= 100 MB/día). Uso: node scripts/pruebas/salud.mjs [carpeta-de-logs]
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { esMac, esWindows } from '../../src/shared/plataforma.ts'
import { ARCHIVO_SALUD, ARCHIVO_SALUD_ANTERIOR } from '../../src/shared/salud.ts'

const DIA_MS = 86_400_000
/** Línea de corte: una fuga sostenida de este tamaño al día. */
const CORTE_MB_DIA = 100
/** Un grupo (mismo nº de sesiones abiertas) necesita al menos esto para dar una pendiente fiable. */
const MIN_MUESTRAS_GRUPO = 6
const MIN_SPAN_GRUPO_MS = 2 * 3_600_000
/** Lo que tiene que durar un grupo para decidir el corte con él. */
const MIN_SPAN_CORTE_MS = 6 * 3_600_000

function carpetaPorDefecto() {
  if (esWindows()) return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Tessera', 'logs')
  if (esMac()) return join(homedir(), 'Library', 'Application Support', 'Tessera', 'logs')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Tessera', 'logs')
}

function leerLineas(carpeta) {
  const out = []
  for (const nombre of [ARCHIVO_SALUD_ANTERIOR, ARCHIVO_SALUD]) {
    const ruta = join(carpeta, nombre)
    if (!existsSync(ruta)) continue
    for (const l of readFileSync(ruta, 'utf8').split('\n')) {
      if (!l.trim()) continue
      try {
        const o = JSON.parse(l)
        if (o && typeof o.t === 'string' && !Number.isNaN(Date.parse(o.t))) out.push({ ...o, ms: Date.parse(o.t) })
      } catch {
        /* línea a medias (corte de luz o rotación): se salta */
      }
    }
  }
  out.sort((a, b) => a.ms - b.ms)
  // Cada `arranque` abre una sesión de la app: al reiniciar la memoria vuelve a empezar, y mezclar
  // sesiones en una misma recta escondería una fuga.
  let sesion = 0
  for (const l of out) {
    if (l.tipo === 'arranque') sesion++
    l.sesion = sesion
  }
  return out
}

/** Pendiente de la recta de mínimos cuadrados de `puntos` ([ms, mb]), en MB/día. */
function pendienteMbDia(puntos) {
  const n = puntos.length
  const t0 = puntos[0][0]
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const [ms, mb] of puntos) {
    const x = (ms - t0) / DIA_MS
    sx += x
    sy += mb
    sxx += x * x
    sxy += x * mb
  }
  const den = n * sxx - sx * sx
  return den === 0 ? 0 : (n * sxy - sx * sy) / den
}

const SERIES = {
  main: (m) => m.procesos?.main?.mb,
  ventana: (m) => m.procesos?.ventana?.mb,
  gpu: (m) => m.procesos?.gpu?.mb,
  total: (m) => Object.values(m.procesos ?? {}).reduce((s, p) => s + (p.mb ?? 0), 0)
}

function tendencia(muestras, valor) {
  const grupos = new Map()
  for (const m of muestras) {
    const v = valor(m)
    if (typeof v !== 'number') continue
    const k = `${m.sesion}|${(m.abierto?.terminales ?? 0) + (m.abierto?.agentes ?? 0)}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push([m.ms, v])
  }
  let suma = 0, peso = 0, usados = 0, peor = null
  for (const pts of grupos.values()) {
    if (pts.length < MIN_MUESTRAS_GRUPO || pts[pts.length - 1][0] - pts[0][0] < MIN_SPAN_GRUPO_MS) continue
    const p = pendienteMbDia(pts)
    suma += p * pts.length
    peso += pts.length
    usados++
    // Para el corte, solo grupos largos: en dos horas el vaivén normal de la memoria da pendientes falsas.
    if (pts[pts.length - 1][0] - pts[0][0] >= MIN_SPAN_CORTE_MS && (peor === null || p > peor)) peor = p
  }
  // El corte se decide con el PEOR grupo: la media diluye una fuga de una sesión entre las sanas.
  return { mbDia: peso > 0 ? suma / peso : null, peor, grupos: usados }
}

const redondear = (v, d = 1) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : '-')

function main() {
  const carpeta = process.argv[2] ?? carpetaPorDefecto()
  const lineas = leerLineas(carpeta)
  const muestras = lineas.filter((l) => l.tipo === 'muestra')
  console.log(`Carpeta: ${carpeta}`)
  if (muestras.length === 0) {
    console.log('Sin muestras: el registro solo existe en las versiones alpha y con el ajuste encendido.')
    return
  }
  const dias = (muestras.at(-1).ms - muestras[0].ms) / DIA_MS
  const suspensiones = lineas.filter((l) => l.tipo === 'suspend').length
  const arranques = lineas.filter((l) => l.tipo === 'arranque')
  console.log(`\nCobertura: ${redondear(dias, 2)} días (${muestras[0].t} -> ${muestras.at(-1).t})`)
  console.log(`Muestras: ${muestras.length}   Suspensiones: ${suspensiones}   Arranques: ${arranques.length}` +
    (arranques.length > 0 ? `   Versiones: ${[...new Set(arranques.map((a) => a.version))].join(', ')}` : ''))

  console.log('\nTendencia de memoria (grupos con el mismo nº de terminales+agentes abiertos)')
  const filas = []
  let cruza = false
  for (const [nombre, valor] of Object.entries(SERIES)) {
    const vals = muestras.map(valor).filter((v) => typeof v === 'number')
    const { mbDia, peor, grupos } = tendencia(muestras, valor)
    const sobre = peor !== null && peor >= CORTE_MB_DIA
    if (sobre) cruza = true
    filas.push({
      proceso: nombre,
      'MB/día': mbDia === null ? 'sin datos' : redondear(mbDia),
      'peor grupo': peor === null ? '-' : redondear(peor),
      grupos,
      'MB mín': vals.length > 0 ? redondear(Math.min(...vals)) : '-',
      'MB pico': vals.length > 0 ? redondear(Math.max(...vals)) : '-',
      'MB último': redondear(vals.at(-1)),
      corte: mbDia === null ? '?' : sobre ? 'CRUZA' : 'ok'
    })
  }
  console.table(filas)
  if (filas.every((f) => f.grupos === 0)) {
    console.log('Aún no hay grupos con muestras suficientes (>= 6 muestras y >= 2 h en una misma sesión de la app con el mismo nº de terminales y agentes).')
  }

  const susp = []
  for (const s of lineas.filter((l) => l.tipo === 'suspend')) {
    const antes = muestras.filter((m) => m.ms <= s.ms).at(-1)
    const despues = muestras.find((m) => m.ms > s.ms)
    if (!antes || !despues) continue
    const a = SERIES.total(antes)
    const d = SERIES.total(despues)
    susp.push({ suspendido: s.t, 'MB antes': redondear(a), 'MB después': redondear(d), 'delta MB': redondear(d - a) })
  }
  console.log('\nMemoria total antes/después de cada suspensión')
  if (susp.length > 0) console.table(susp)
  else console.log('Sin suspensiones con muestras a los dos lados.')

  const caidas = lineas.filter((l) => l.tipo === 'gone')
  console.log('\nProcesos caídos')
  if (caidas.length === 0) console.log('Ninguno.')
  else console.table(caidas.map((g) => ({ cuando: g.t, proceso: g.proceso, reason: g.reason, exitCode: g.exitCode ?? '-' })))

  informeBloqueos(lineas)

  console.log(`\nLínea de corte (fuga >= ${CORTE_MB_DIA} MB/día): ${cruza ? 'CRUZADA, hay que investigar' : 'no cruzada'}`)
  process.exitCode = cruza ? 2 : 0
}

/** La pantalla de un suceso, legible: `2560x1440@144Hz x1.5`, o `-`. */
const pantalla = (v) => (v?.pantalla ? `${v.pantalla.ancho}x${v.pantalla.alto}@${v.pantalla.hz}Hz x${v.pantalla.escala}` : '-')

/** Bloqueos del main, ventana sin respuesta, lo lento de la ventana y los cambios de monitor. */
function informeBloqueos(lineas) {
  const bloqueos = lineas.filter((l) => l.tipo === 'bloqueo-main')
  console.log(`\nBloqueos del proceso principal (>= 1 s): ${bloqueos.length}`)
  if (bloqueos.length > 0) {
    console.table(
      bloqueos.map((b) => ({
        cuando: b.t,
        ms: b.ms,
        enfocada: b.ventana?.enfocada ?? '-',
        pantalla: pantalla(b.ventana),
        'RAM libre MB': b.sistema?.libreMb ?? '-',
        peticiones: (b.ipc ?? []).map((p) => `${p.canal} ${p.ms}ms${p.enCurso ? '…' : ''}`).join(', ') || '-'
      }))
    )
  }
  const sinResp = lineas.filter((l) => l.tipo === 'responde')
  console.log(`\nVentana sin responder: ${lineas.filter((l) => l.tipo === 'sin-respuesta').length} veces`)
  if (sinResp.length > 0) console.table(sinResp.map((r) => ({ volvió: r.t, 'duró ms': r.ms ?? '?', pantalla: pantalla(r.ventana), 'RAM libre MB': r.sistema?.libreMb ?? '-' })))
  const lentos = lineas.filter((l) => l.tipo === 'renderer-lento')
  console.log(`\nMinutos con la ventana lenta: ${lentos.length}`)
  if (lentos.length > 0) {
    console.table(
      lentos.map((r) => ({
        cuando: r.t,
        'tareas largas': `${r.tareasLargas.n} (máx ${r.tareasLargas.maxMs} ms)`,
        'fotogramas largos': `${r.fotogramasLargos.n} (máx ${r.fotogramasLargos.maxMs} ms)`,
        'teclas/clics lentos': `${r.entradasLentas.n} (máx ${r.entradasLentas.maxMs} ms)`
      }))
    )
  }
  const pantallas = lineas.filter((l) => l.tipo === 'pantalla')
  const ventana = lineas.filter((l) => l.tipo === 'ventana')
  console.log(`\nCambios de monitor o de pantalla: ${pantallas.length}   Eventos de la ventana: ${ventana.length}`)
  const lentasIpc = {}
  for (const m of lineas.filter((l) => l.tipo === 'muestra' && l.ipcLentas)) {
    for (const [canal, v] of Object.entries(m.ipcLentas)) {
      const a = (lentasIpc[canal] ??= { canal, n: 0, 'máx ms': 0 })
      a.n += v.n
      a['máx ms'] = Math.max(a['máx ms'], v.maxMs)
    }
  }
  const filasIpc = Object.values(lentasIpc).sort((a, b) => b.n - a.n)
  console.log('\nPeticiones lentas de la ventana (>= 1 s), por canal')
  if (filasIpc.length > 0) console.table(filasIpc.slice(0, 15))
  else console.log('Ninguna.')
  for (const g of lineas.filter((l) => l.tipo === 'gpu').slice(-1)) {
    console.log(`\nGPU (último arranque): ${g.adaptadores.map((a) => `${a.vendor}:${a.device}${a.activo ? ' activa' : ''}${a.driver ? ` driver ${a.driver}` : ''}`).join(' | ')}`)
  }
}

main()
