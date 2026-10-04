// =============================================================================
// El estado de la pestaña de datos, en el mismo componente (`DbDatosPane`): sus refs,
// sus `useState` y el NÚCLEO estable (refs y setters, memorizado una vez) que reciben
// sus acciones. El espejo de las props se actualiza en un efecto de layout.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'
import type { DbFiltroGuiado } from '../../../../../shared/filtroGuiado'
import { FILTRO_GUIADO_VACIO, FILTRO_TABLA_VACIO, type ErrorBarraFiltro } from '../filtro/modeloFiltro'
import type { DbDatosPaneProps } from '../propsBd'
import { SIN_CAMBIOS, type CambiosRejilla } from './cambiosRejilla'
import type { DatosRejilla } from './celdasRejilla'
import type { AccionesEdicionRejilla, EdicionRejilla } from './rejillaTipos'
import type { OrigenPagina } from './traerTodas'
import type {
  Envio,
  EstadoDatos,
  Filtro,
  FinPagina,
  NucleoDatos,
  RefsDatos,
  Resultado,
  SinLector
} from './datosTipos'

/** Refs de la pestaña; `propsRef` sigue a las props vigentes. */
function useRefsDatos(props: DbDatosPaneProps): RefsDatos {
  // Los callbacks asíncronos leen las props de aquí: una respuesta que tarda no debe
  // actuar con la conexión o el objeto de cuando se pidió.
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const refs = {
    aplicadoRef: useRef<Filtro>(FILTRO_TABLA_VACIO),
    intentoRef: useRef<{ filtro: Filtro; maxFilas?: number }>({ filtro: FILTRO_TABLA_VACIO }),
    botonExportarRef: useRef<HTMLButtonElement | null>(null),
    cambiosRef: useRef<CambiosRejilla>(SIN_CAMBIOS),
    tokenErrorRef: useRef(0),
    accionesRef: useRef<AccionesEdicionRejilla | null>(null),
    envioRef: useRef<Envio | null>(null),
    envioIdRef: useRef<string | null>(null),
    envioInciertoRef: useRef(false),
    descarteRef: useRef<{ promesa: Promise<boolean>; resolver: (ok: boolean) => void } | null>(null),
    peticionRef: useRef<string | null>(null),
    cargandoRef: useRef(false),
    lectorRef: useRef<string | null>(null),
    contarRef: useRef<string | null>(null),
    masRef: useRef<string | null>(null),
    cargandoMasRef: useRef(false),
    paginaRef: useRef<Promise<FinPagina> | null>(null),
    origenPaginaRef: useRef<OrigenPagina>('desplazar'),
    traerRef: useRef<string | null>(null),
    resRef: useRef<Resultado | null>(null),
    usoRef: useRef(0),
    haSidoVisibleRef: useRef(false),
    whereRef: useRef<HTMLInputElement>(null),
    guiadoRef: useRef<HTMLDivElement>(null)
  }
  // Todas son refs: el objeto se fija en el primer render.
  const [fijas] = useState<RefsDatos>(() => ({ propsRef, ...refs }))
  return fijas
}

/** El estado de la pestaña y el núcleo estable (refs y setters). */
export function useEstadoDatos(props: DbDatosPaneProps): { estado: EstadoDatos; n: NucleoDatos } {
  const refs = useRefsDatos(props)
  const [modo, setModo] = useState<Filtro['modo']>('guiado')
  const [guiadoTxt, setGuiadoTxt] = useState<DbFiltroGuiado>(FILTRO_GUIADO_VACIO)
  const [errorGuiado, setErrorGuiado] = useState<ErrorBarraFiltro | null>(null)
  const [whereTxt, setWhereTxt] = useState('')
  const [aplicado, setAplicado] = useState<Filtro>(FILTRO_TABLA_VACIO)
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [error, setError] = useState<DbErrorSql | null>(null)
  const [errorCampo, setErrorCampo] = useState<DbErrorSql | null>(null)
  const [detenida, setDetenida] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [contando, setContando] = useState(false)
  const [sinLector, setSinLector] = useState<SinLector | null>(null)
  const [hayLector, setHayLector] = useState(false)
  const [trayendo, setTrayendo] = useState(false)
  const [sinEsperar, setSinEsperar] = useState(false)
  const [menuExportar, setMenuExportar] = useState<{ x: number; y: number } | null>(null)
  const [cambios, setCambios] = useState<CambiosRejilla>(SIN_CAMBIOS)
  const [filaError, setFilaError] = useState<EdicionRejilla['filaError']>(null)
  const [filasSel, setFilasSel] = useState(0)
  const [envio, setEnvio] = useState<Envio | null>(null)
  const [descarte, setDescarte] = useState<{ n: number } | null>(null)
  const [conservarPara, setConservarPara] = useState<DatosRejilla | null>(null)
  // Refs y setters no cambian nunca: el núcleo es el mismo objeto en todos los renders.
  const n = useMemo<NucleoDatos>(
    () => ({
      ...refs,
      setModo, setGuiadoTxt, setErrorGuiado, setWhereTxt, setAplicado,
      setCargando, setRes, setError, setErrorCampo, setDetenida, setCargandoMas, setContando,
      setSinLector, setHayLector, setTrayendo, setSinEsperar, setMenuExportar,
      setCambios, setFilaError, setFilasSel, setEnvio, setDescarte, setConservarPara
    }),
    [refs]
  )
  const estado: EstadoDatos = {
    modo, guiadoTxt, errorGuiado, whereTxt, aplicado,
    cargando, res, error, errorCampo, detenida, cargandoMas, contando,
    sinLector, hayLector, trayendo, sinEsperar, menuExportar,
    cambios, filaError, filasSel, envio, descarte, conservarPara
  }
  return { estado, n }
}
