#!/usr/bin/env node
// =============================================================================
// Prueba de la DECISIÓN de vista del botón de actualización (vistaUpdate.ts).
// (node src/renderer/src/features/actualizaciones/test-vista-update.mts)
// Fija el reposo, `avisoAplicada` (verde y abrible, incluso durante un chequeo de fondo),
// la precedencia completa (fallo > downloading > available > ready > installing > error >
// aplicada > checking > reposo), `available` desde cualquier sistema (la plataforma viaja
// en el estado), el punto como `tono !== 'neutro'`, `tieneContenido` y `debeDescartarAlCerrar`.
// =============================================================================

import {
  debeDescartarAlCerrar,
  decidirVistaUpdate,
  tieneContenido,
  type VistaUpdate
} from './vistaUpdate.ts'
import { initialUpdateState, type UpdateState } from '../../../../shared/update-ipc.ts'

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
function base(over: Partial<UpdateState> = {}): UpdateState {
  return { ...initialUpdateState('0.32.0', true), ...over }
}
const APLICADA = { desde: '0.32.0', hasta: '0.33.0' }
const FALLO = {
  versionEsperada: '0.33.0',
  intentos: 2,
  agotado: true,
  mensaje: null,
  detalle: null
}

function resumen(v: VistaUpdate): string {
  return `icono=${v.icono} tono=${v.tono} punto=${v.punto} accion=${v.accion} off=${v.deshabilitado}`
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Reposo: el botón es "Buscar actualizaciones" y NO tiene punto')
  // -------------------------------------------------------------------------
  const idle = decidirVistaUpdate(base())
  check(
    'idle -> buscar/neutro/sin punto/comprobar',
    idle.icono === 'buscar' && idle.tono === 'neutro' && !idle.punto && idle.accion === 'comprobar',
    resumen(idle)
  )

  // -------------------------------------------------------------------------
  hr('(2) "Tessera se actualizó": punto verde y popover abrible')
  // -------------------------------------------------------------------------
  const aplicada = decidirVistaUpdate(base({ avisoAplicada: APLICADA }))
  check(
    'avisoAplicada -> hecho/verde/punto/abrir, habilitado',
    aplicada.icono === 'hecho' &&
      aplicada.tono === 'verde' &&
      aplicada.punto &&
      aplicada.accion === 'abrir' &&
      !aplicada.deshabilitado,
    resumen(aplicada)
  )
  check(
    'la etiqueta nombra la versión de destino',
    aplicada.etiqueta.includes('0.33.0') && aplicada.titulo.includes('0.32.0'),
    `${aplicada.etiqueta} / ${aplicada.titulo}`
  )

  // -------------------------------------------------------------------------
  hr('(3) EL FALLO: un chequeo de fondo no puede tapar la noticia sin leer')
  // -------------------------------------------------------------------------
  // A los 8 s de arrancar hay un chequeo automático, o sea que esto pasaba
  // SIEMPRE justo después de actualizar: el punto verde se apagaba, el botón se
  // deshabilitaba y la noticia quedaba inalcanzable hasta que el chequeo acababa.
  const aplicadaChecking = decidirVistaUpdate(base({ status: 'checking', avisoAplicada: APLICADA }))
  check(
    'aplicada + checking -> sigue verde y con punto',
    aplicadaChecking.tono === 'verde' && aplicadaChecking.punto,
    resumen(aplicadaChecking)
  )
  check(
    'aplicada + checking -> el botón sigue abriendo el aviso',
    aplicadaChecking.accion === 'abrir' && !aplicadaChecking.deshabilitado,
    resumen(aplicadaChecking)
  )

  // -------------------------------------------------------------------------
  hr('(4) `checking` a secas no enciende punto y sí deshabilita')
  // -------------------------------------------------------------------------
  const checking = decidirVistaUpdate(base({ status: 'checking' }))
  check(
    'checking -> buscar-girando/neutro/sin punto/nada/deshabilitado',
    checking.icono === 'buscar-girando' &&
      checking.tono === 'neutro' &&
      !checking.punto &&
      checking.accion === 'nada' &&
      checking.deshabilitado,
    resumen(checking)
  )

  // -------------------------------------------------------------------------
  hr('(5) Precedencia: lo que PIDE algo manda sobre la noticia ya leída')
  // -------------------------------------------------------------------------
  const fallo = decidirVistaUpdate(
    base({ status: 'ready', newVersion: '0.33.0', avisoAplicada: APLICADA, avisoFallo: FALLO })
  )
  check(
    'avisoFallo manda sobre ready y sobre avisoAplicada',
    fallo.icono === 'aviso' && fallo.tono === 'rojo' && fallo.accion === 'abrir',
    resumen(fallo)
  )

  const bajando = decidirVistaUpdate(
    base({ status: 'downloading', newVersion: '0.34.0', percent: 42, avisoAplicada: APLICADA })
  )
  check(
    'downloading manda sobre avisoAplicada',
    bajando.icono === 'anillo' && bajando.tono === 'acento' && bajando.etiqueta.includes('42'),
    resumen(bajando) + ` etiqueta="${bajando.etiqueta}"`
  )

  const lista = decidirVistaUpdate(
    base({ status: 'ready', aplicable: true, newVersion: '0.34.0', avisoAplicada: APLICADA })
  )
  check(
    'ready manda sobre avisoAplicada y su acción es instalar',
    lista.icono === 'descarga' && lista.tono === 'acento' && lista.accion === 'instalar',
    resumen(lista)
  )
  const listaAlCerrar = decidirVistaUpdate(
    base({ status: 'ready', aplicable: true, newVersion: '0.34.0', seAplicaAlCerrar: true })
  )
  check(
    'ready dice si se aplicará sola al cerrar',
    listaAlCerrar.titulo.includes('al cerrar') && !lista.titulo.includes('al cerrar'),
    `${listaAlCerrar.titulo} // ${lista.titulo}`
  )

  // Una preparada del marcador que aún no se ha confirmado con el feed NO puede
  // prometer que se aplicará sola: el cierre no podría cumplirlo.
  const sinConfirmar = decidirVistaUpdate(
    base({ status: 'ready', aplicable: false, newVersion: '0.34.0', seAplicaAlCerrar: true })
  )
  check(
    'ready SIN confirmar no promete aplicarse sola, y sigue ofreciendo instalar',
    sinConfirmar.titulo.includes('confirmarla') &&
      !sinConfirmar.titulo.includes('sola al cerrar') &&
      sinConfirmar.accion === 'instalar',
    sinConfirmar.titulo
  )

  // -------------------------------------------------------------------------
  hr('(5b) `available`: donde NO se puede auto-instalar (macOS sin firmar)')
  // -------------------------------------------------------------------------
  // `available` describe una COPIA, no una plataforma: en macOS el ciclo normal llega a
  // `ready` y se aplica solo con el relevo de `main/update/relevoMac.ts`. Se cae aquí
  // cuando ESTA copia no puede dar el último paso (no se localiza el `.app`, su
  // contenedor no es escribible, el feed no publica un `.zip` con sha512), y entonces el
  // main ni siquiera descarga. El ciclo sigue sirviendo (comprobar y avisar), pero el
  // botón no puede prometer un reinicio que no va a ocurrir.
  const disponible = decidirVistaUpdate(base({ status: 'available', newVersion: '0.34.0' }))
  check(
    'available -> descarga/acento/punto: ofrece DESCARGAR con la versión',
    disponible.icono === 'descarga' &&
      disponible.tono === 'acento' &&
      disponible.punto &&
      disponible.etiqueta === 'Descargar 0.34.0',
    resumen(disponible) + ` etiqueta="${disponible.etiqueta}"`
  )
  check(
    'no promete instalar ni reiniciar, y nombra la versión',
    disponible.titulo.includes('0.34.0') &&
      !disponible.titulo.toLowerCase().includes('reiniciar') &&
      !disponible.titulo.includes('al cerrar'),
    disponible.titulo
  )
  check(
    'dice explícitamente que esta copia no puede instalarse sola',
    disponible.titulo.includes('no puede instalarse sola'),
    disponible.titulo
  )
  // La acción tiene que ser `abrir` y NO `instalar`. Con `instalar`, `alPulsar` manda
  // directo a la descarga y el bloque del popover que explica que hay que sustituir la
  // app a mano no se llega a pintar nunca: sólo alterna la caja la acción `abrir`. El
  // botón de descargar vive DENTRO de ese bloque.
  check(
    'la ACCIÓN es `abrir` (si fuera `instalar`, el popover que lo explica sería inalcanzable)',
    disponible.accion === 'abrir' && !disponible.deshabilitado,
    resumen(disponible)
  )

  // `newVersion` es opcional en el contrato: sin ella la etiqueta es "Descargar" a
  // secas y el título no puede decir "Tessera null".
  const sinVersion = decidirVistaUpdate(base({ status: 'available', newVersion: null }))
  check(
    'available SIN newVersion -> "Descargar" a secas y sin "null" ni "undefined"',
    sinVersion.etiqueta === 'Descargar' &&
      !sinVersion.titulo.includes('null') &&
      !sinVersion.titulo.includes('undefined') &&
      sinVersion.accion === 'abrir',
    `etiqueta="${sinVersion.etiqueta}" // ${sinVersion.titulo}`
  )

  // Precedencia: `available` PIDE algo (descargar), así que manda sobre la noticia ya
  // leída; y un fallo de aplicación sigue mandando sobre él.
  const disponibleConNoticia = decidirVistaUpdate(
    base({ status: 'available', newVersion: '0.34.0', avisoAplicada: APLICADA })
  )
  check(
    'available manda sobre avisoAplicada',
    disponibleConNoticia.icono === 'descarga' &&
      disponibleConNoticia.tono === 'acento' &&
      disponibleConNoticia.accion === 'abrir',
    resumen(disponibleConNoticia)
  )
  const disponibleConFallo = decidirVistaUpdate(
    base({ status: 'available', newVersion: '0.34.0', avisoFallo: FALLO })
  )
  check(
    'avisoFallo manda sobre available',
    disponibleConFallo.icono === 'aviso' &&
      disponibleConFallo.tono === 'rojo' &&
      disponibleConFallo.accion === 'abrir',
    resumen(disponibleConFallo)
  )
  // Y Windows no se entera: `ready` sigue siendo "Actualizar ahora". La plataforma
  // ya no es un parámetro de esta función; viaja en el `status` que emite el main.
  check(
    'ready sigue siendo "Actualizar ahora": available no le roba nada a Windows',
    decidirVistaUpdate(base({ status: 'ready', aplicable: true, newVersion: '0.34.0' })).etiqueta ===
      'Actualizar ahora',
    decidirVistaUpdate(base({ status: 'ready', aplicable: true, newVersion: '0.34.0' })).etiqueta
  )

  const instalando = decidirVistaUpdate(base({ status: 'installing', avisoAplicada: APLICADA }))
  check(
    'installing manda sobre avisoAplicada y bloquea el botón',
    instalando.icono === 'anillo-indeterminado' &&
      instalando.accion === 'nada' &&
      instalando.deshabilitado,
    resumen(instalando)
  )

  const error = decidirVistaUpdate(base({ status: 'error', avisoAplicada: APLICADA }))
  check(
    'error manda sobre avisoAplicada',
    error.icono === 'aviso' && error.tono === 'rojo' && error.accion === 'abrir',
    resumen(error)
  )

  // -------------------------------------------------------------------------
  hr('(6) El punto es SIEMPRE `tono !== neutro`')
  // -------------------------------------------------------------------------
  const todos: UpdateState[] = [
    base(),
    base({ status: 'checking' }),
    base({ status: 'downloading', percent: 7 }),
    base({ status: 'available', newVersion: '0.34.0' }),
    base({ status: 'ready', newVersion: '0.34.0' }),
    base({ status: 'installing' }),
    base({ status: 'error' }),
    base({ avisoAplicada: APLICADA }),
    base({ avisoFallo: FALLO }),
    base({ status: 'checking', avisoAplicada: APLICADA })
  ]
  const coherente = todos.every((s) => {
    const v = decidirVistaUpdate(s)
    return v.punto === (v.tono !== 'neutro')
  })
  check('punto === (tono !== neutro) en los 10 estados', coherente, `${todos.length} estados`)

  // -------------------------------------------------------------------------
  hr('(7) `tieneContenido`: qué puede abrir el popover')
  // -------------------------------------------------------------------------
  check('null -> false', !tieneContenido(null), 'sin estado no hay caja')
  check('idle -> false', !tieneContenido(base()), 'nada que enseñar')
  check('checking -> false', !tieneContenido(base({ status: 'checking' })), 'no hay bloque propio')
  check(
    'ready / downloading / available / error -> true',
    tieneContenido(base({ status: 'ready' })) &&
      tieneContenido(base({ status: 'downloading' })) &&
      tieneContenido(base({ status: 'available', newVersion: '0.34.0' })) &&
      tieneContenido(base({ status: 'error' })),
    'los cuatro tienen bloque'
  )
  check(
    'los dos avisos -> true',
    tieneContenido(base({ avisoAplicada: APLICADA })) && tieneContenido(base({ avisoFallo: FALLO })),
    'noticia y fallo'
  )

  // -------------------------------------------------------------------------
  hr('(8) `debeDescartarAlCerrar`: cerrar es leer, pero sólo la noticia')
  // -------------------------------------------------------------------------
  check('null -> false', !debeDescartarAlCerrar(null), 'sin estado no se descarta nada')
  check('sin avisos -> false', !debeDescartarAlCerrar(base()), 'nada que descartar')
  check(
    'avisoAplicada -> true',
    debeDescartarAlCerrar(base({ avisoAplicada: APLICADA })),
    'la noticia se retira al leerla'
  )
  check(
    'sólo avisoFallo -> false',
    !debeDescartarAlCerrar(base({ avisoFallo: FALLO })),
    'un fallo PIDE algo: exige Descartar explícito'
  )
  check(
    'los dos a la vez -> true (se retira la noticia, el fallo se queda)',
    debeDescartarAlCerrar(base({ avisoAplicada: APLICADA, avisoFallo: FALLO })),
    'DISMISS es por aviso, no por popover'
  )

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
