// =============================================================================
// Lo que aparece y desaparece con su animación de `movimiento.css`, sin que quien lo usa lleve la cuenta de la
// salida: `Presente` para un elemento que entra y sale, `Cruce` para cambiar un contenido por otro en la misma celda.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { atributosPresencia, MS_SALIDA, movimientoReducido, usePresencia, useUltimoValor } from './presencia.ts'

type Etiqueta = 'div' | 'span' | 'aside' | 'section' | 'p'

/**
 * Un elemento que se muestra mientras `visible` y sale animado al dejar de estarlo. `className` lleva la clase de
 * movimiento (`mov-aparece`, `mov-despliega`…) y las propias; el resto de atributos pasa tal cual.
 */
export function Presente({
  visible,
  como = 'div',
  children,
  ...resto
}: { visible: boolean; como?: Etiqueta; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>): React.JSX.Element | null {
  const p = usePresencia(visible)
  if (!p.montado) return null
  const Elemento = como
  return (
    <Elemento {...resto} {...atributosPresencia(p)}>
      {children}
    </Elemento>
  )
}

/** `inert` como atributo de texto: los tipos de React 18 no lo declaran. */
const INERTE = { inert: '' } as Record<string, string>

interface Saliente {
  clave: string
  nodo: React.ReactNode
}

/**
 * Cambia un contenido por otro con un fundido cruzado: cuando cambia `clave`, el anterior se funde mientras entra el
 * nuevo, los dos en la misma celda. El contenido actual se pinta siempre en directo; del que se va solo se guarda una
 * copia, una vez, al cambiar la clave.
 */
export function Cruce({ clave, children, className }: { clave: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  const [salientes, setSalientes] = useState<Saliente[]>([])
  const anterior = useRef<Saliente>({ clave, nodo: children })
  const vivo = useRef(true)
  useEffect(
    () => () => {
      vivo.current = false
    },
    []
  )
  // Corre con cada contenido nuevo para tener la copia al día, pero solo cambia el estado cuando cambia la clave.
  useLayoutEffect(() => {
    const previo = anterior.current
    anterior.current = { clave, nodo: children }
    if (previo.clave === clave) return
    setSalientes((s) => [...s.filter((x) => x.clave !== clave && x.clave !== previo.clave), previo])
    setTimeout(
      () => {
        if (vivo.current) setSalientes((s) => s.filter((x) => x !== previo))
      },
      movimientoReducido() ? 0 : MS_SALIDA
    )
  }, [clave, children])
  return (
    <div className={`mov-cruce${className ? ` ${className}` : ''}`}>
      {salientes
        .filter((s) => s.clave !== clave)
        .map((s) => (
          // Inerte: la copia que sale no se enfoca ni roba el foco con un `autoFocus` al montarse.
          <div key={`fuera:${s.clave}`} className="mov-cruce-capa" aria-hidden="true" data-saliendo="" {...INERTE}>
            {s.nodo}
          </div>
        ))}
      <div key={clave} className="mov-cruce-capa">
        {children}
      </div>
    </div>
  )
}

/** La insignia retiene su último conteo mientras se retira. */
export function Insignia({ visible, className, children }: { visible: boolean; className: string; children: React.ReactNode }): React.JSX.Element {
  const contenido = useUltimoValor(visible ? children : null)
  return <Presente como="span" visible={visible} className={`${className} mov-aparece mov-insignia`} aria-hidden="true">{contenido}</Presente>
}
