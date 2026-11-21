// =============================================================================
// Ventanas de franja por perfil y destinos físicos de sus anfitriones.
// El registro permite devolver los nodos síncronamente antes de confirmar el cierre.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { useLayoutEffect } from 'react'
import { create } from 'zustand'
import { PREFIJO_MARCO_FRANJA } from '../../../../shared/franja-ipc'
import { conMaximizado, type PanelInferiorCentro } from './layoutCentro'
import { useStoreLayout } from './store'
import { prepararDocumentoFranja } from './documentoFranja'
import { conCompactaDeFranja, conVentanaDeFranja, panelDeHija, sinPerfilDeFranja } from './franjaDesacoplada'

export type VentanaFranja = ReturnType<typeof prepararDocumentoFranja> & {
  ventana: Window
  panelInicial: PanelInferiorCentro
}

export const useStoreVentanasFranja = create<{
  abiertas: ReadonlyMap<string, VentanaFranja>
  anchos: ReadonlyMap<string, number>
  enfocada: string | null
  compactaPorPerfil: Readonly<Record<string, boolean>>
}>(() => ({ abiertas: new Map(), anchos: new Map(), enfocada: null, compactaPorPerfil: {} }))

type Traslado = (hija: VentanaFranja | undefined) => void
const anfitriones = new Map<string, Set<Traslado>>()
const pendientes = new Map<string, VentanaFranja>()
const cerrando = new Set<string>()

function cerrarHija(perfil: string): void {
  if (cerrando.has(perfil)) return
  cerrando.add(perfil)
  void window.tessera.franja.cerrarAcoplada(perfil)
    .catch((error) => console.error('[franja] no se pudo cerrar la ventana:', error))
    .finally(() => cerrando.delete(perfil))
}

export function registrarAnfitrion(perfil: string, mover: Traslado): () => void {
  const delPerfil = anfitriones.get(perfil) ?? new Set<Traslado>()
  anfitriones.set(perfil, delPerfil)
  delPerfil.add(mover)
  mover(useStoreVentanasFranja.getState().abiertas.get(perfil))
  return () => {
    delPerfil.delete(mover)
    if (delPerfil.size === 0) anfitriones.delete(perfil)
  }
}

function cambiarDestino(perfil: string, hija?: VentanaFranja): void {
  for (const mover of anfitriones.get(perfil) ?? []) mover(hija)
  useStoreVentanasFranja.setState((s) => ({
    abiertas: conVentanaDeFranja(s.abiertas, perfil, hija),
    anchos: conVentanaDeFranja(s.anchos, perfil, hija?.ventana.innerWidth),
    enfocada: hija?.ventana.document.hasFocus() ? perfil : s.enfocada === perfil ? null : s.enfocada
  }))
}

export function desacoplarFranja(perfil: string, panel: PanelInferiorCentro, tituloInicial?: string): void {
  if (!perfil || cerrando.has(perfil) || pendientes.has(perfil) || useStoreVentanasFranja.getState().abiertas.has(perfil)) return
  const ventana = window.open('about:blank', PREFIJO_MARCO_FRANJA + perfil)
  if (ventana === null) return
  try {
    const hija = { ...prepararDocumentoFranja(ventana, tituloInicial), ventana, panelInicial: panel }
    pendientes.set(perfil, hija)
    void hija.estilosListos.then((listos) => {
      if (pendientes.get(perfil) !== hija) return
      pendientes.delete(perfil)
      if (!listos) {
        hija.dejarDeReflejar()
        cerrarHija(perfil)
        return
      }
      ventana.addEventListener('focus', () => {
        if (useStoreVentanasFranja.getState().abiertas.get(perfil) === hija) {
          useStoreVentanasFranja.setState({ enfocada: perfil })
        }
      })
      ventana.addEventListener('blur', () => {
        if (useStoreVentanasFranja.getState().enfocada === perfil) useStoreVentanasFranja.setState({ enfocada: null })
      })
      ventana.addEventListener('resize', () => {
        useStoreVentanasFranja.setState((s) => {
          if (s.abiertas.get(perfil) !== hija || s.anchos.get(perfil) === ventana.innerWidth) return s
          return { anchos: conVentanaDeFranja(s.anchos, perfil, ventana.innerWidth) }
        })
      })
      cambiarDestino(perfil, hija)
    }).catch((error) => {
      console.error('[franja] no se pudo trasladar la franja:', error)
      cambiarDestino(perfil)
      hija.dejarDeReflejar()
      cerrarHija(perfil)
    })
  } catch (error) {
    console.error('[franja] no se pudo preparar la ventana:', error)
    cerrarHija(perfil)
  }
}

/** Pide la vista compacta o la completa; el cambio lo anima `useVistaFranjaConTransicion` al pintarlo. */
export function fijarCompactaFranja(perfil: string, valor: boolean): void {
  useStoreVentanasFranja.setState((s) => {
    const siguiente = conCompactaDeFranja(s.compactaPorPerfil, perfil, valor)
    return siguiente === s.compactaPorPerfil ? s : { compactaPorPerfil: siguiente }
  })
}

export function enfocarFranjaDesacoplada(perfil: string, alEnfocar?: (doc: Document) => void): boolean {
  const hija = useStoreVentanasFranja.getState().abiertas.get(perfil)
  if (!hija || hija.ventana.closed) return false
  void window.tessera.franja.traerAlFrente(perfil)
    .then((traida) => {
      if (traida && !hija.ventana.closed) alEnfocar?.(hija.ventana.document)
    })
    .catch((error) => console.error('[franja] no se pudo traer la ventana al frente:', error))
  return true
}

export function acoplarFranja(perfil: string, borrado = false): void {
  if (borrado) {
    useStoreVentanasFranja.setState((s) => {
      const siguiente = sinPerfilDeFranja(s.compactaPorPerfil, perfil)
      return siguiente === s.compactaPorPerfil ? s : { compactaPorPerfil: siguiente }
    })
  }
  const pendiente = pendientes.get(perfil)
  if (pendiente) {
    pendientes.delete(perfil)
    pendiente.dejarDeReflejar()
    cerrarHija(perfil)
    return
  }
  const hija = useStoreVentanasFranja.getState().abiertas.get(perfil)
  if (!hija) return
  if (!borrado) {
    useStoreLayout.setState((s) => {
      const panel = panelDeHija(s.panelPorPerfil[perfil], hija.panelInicial)
      return {
        maximizadoPorPerfil: conMaximizado(s.maximizadoPorPerfil, perfil, panel, false),
        panelPorPerfil: { ...s.panelPorPerfil, [perfil]: panel },
        vistaPorPerfil: s.vistaPorPerfil[perfil] === 'db' ? { ...s.vistaPorPerfil, [perfil]: 'files' } : s.vistaPorPerfil,
        franjaLibre: true
      }
    })
  }
  cambiarDestino(perfil)
  hija.dejarDeReflejar()
  cerrarHija(perfil)
}

export function useCicloFranjas(perfiles: readonly { id: string }[]): void {
  useLayoutEffect(() => {
    const devolverPanes = (): void => {
      for (const perfil of [...useStoreVentanasFranja.getState().abiertas.keys()]) acoplarFranja(perfil)
    }
    // El documento ya se va y sus anfitriones aún están vivos.
    window.addEventListener('pagehide', devolverPanes)
    return () => window.removeEventListener('pagehide', devolverPanes)
  }, [])
  useLayoutEffect(() => window.tessera.franja.alPedirAcople((perfil) => {
    if (pendientes.has(perfil) || useStoreVentanasFranja.getState().abiertas.has(perfil)) acoplarFranja(perfil)
    else cerrarHija(perfil)
  }), [])
  useLayoutEffect(() => {
    const vivos = new Set(perfiles.map((p) => p.id))
    for (const perfil of [...pendientes.keys(), ...useStoreVentanasFranja.getState().abiertas.keys()]) {
      if (!vivos.has(perfil)) acoplarFranja(perfil, true)
    }
    if (perfiles.length === 0) return
    useStoreVentanasFranja.setState((s) => {
      let compacta = s.compactaPorPerfil
      for (const perfil of Object.keys(compacta)) {
        if (!vivos.has(perfil)) compacta = sinPerfilDeFranja(compacta, perfil)
      }
      return compacta === s.compactaPorPerfil ? s : { compactaPorPerfil: compacta }
    })
  }, [perfiles])
}
