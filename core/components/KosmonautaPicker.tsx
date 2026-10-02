"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIAS,
  RASGOS,
  RAREZA,
  SIZE,
  aleatorio,
  atributos,
  azarFijo,
  codificar,
  combinaciones,
  hash32,
  rects,
  siguiente,
  type Categoria,
  type Seleccion,
} from "@/lib/avatar/kosmonautas";

export interface KosmonautaPickerProps {
  /** Dirección de la wallet: de aquí salen el avatar inicial y las 6 sugerencias (estables). */
  address: string;
  /** Recibe el código a guardar (avatarSeed, con avatarStyle "kosmonauta"). */
  onChange?: (code: string) => void;
}

const COUNT = 6;

function Kosmonauta({ sel, label }: { sel: Seleccion; label: string }) {
  const rs = useMemo(() => rects(sel), [sel]);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      {rs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

function sugerenciasDe(rnd: () => number): Seleccion[] {
  return Array.from({ length: COUNT }, () => aleatorio(undefined, {}, rnd));
}

export function KosmonautaPicker({ address, onChange }: KosmonautaPickerProps) {
  const inicial = useMemo(() => sugerenciasDe(azarFijo(hash32(address))), [address]);
  const [sugerencias, setSugerencias] = useState<Seleccion[]>(inicial);
  const [sel, setSel] = useState<Seleccion>(inicial[0]);
  const [candados, setCandados] = useState<Partial<Record<Categoria, boolean>>>({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Si cambia la wallet, se vuelve a sus sugerencias.
  useEffect(() => {
    setSugerencias(inicial);
    setSel(inicial[0]);
  }, [inicial]);

  const code = codificar(sel);
  useEffect(() => {
    onChangeRef.current?.(code);
  }, [code]);

  return (
    <fieldset className="gen">
      <legend className="avatar-picker-label">Arma tu Kosmonauta</legend>

      <section className="gen-preview" aria-label="Tu Kosmonauta">
        <div className="gen-canvas">
          <Kosmonauta sel={sel} label="Vista previa de tu Kosmonauta" />
        </div>
        <ul className="gen-traits" aria-label="Rasgos">
          {atributos(sel).map((a) => (
            <li key={a.trait_type}>
              <span className="muted">{a.trait_type}</span>
              <strong>{a.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="gen-controls" aria-label="Rasgos del Kosmonauta">
        {CATEGORIAS.map(({ key, label }) => {
          const lista = RASGOS[key];
          const i = lista.findIndex((r) => r.id === sel[key]);
          const bloqueado = !!candados[key];
          return (
            <div className="gen-row" key={key}>
              <span className="gen-row-label">{label}</span>
              <button
                type="button"
                className="btn gen-arrow"
                aria-label={`${label} anterior`}
                onClick={() => setSel((s) => siguiente(s, key, -1))}
              >
                ‹
              </button>
              <span className="gen-row-value" aria-live="polite">
                {lista[i]?.nombre}
                <small className="muted">
                  {" "}
                  {i + 1}/{lista.length}
                </small>
              </span>
              <button
                type="button"
                className="btn gen-arrow"
                aria-label={`${label} siguiente`}
                onClick={() => setSel((s) => siguiente(s, key, 1))}
              >
                ›
              </button>
              <button
                type="button"
                className="btn gen-lock"
                aria-pressed={bloqueado}
                aria-label={`${bloqueado ? "Desbloquear" : "Bloquear"} ${label.toLowerCase()}`}
                onClick={() => setCandados((c) => ({ ...c, [key]: !c[key] }))}
              >
                {bloqueado ? "🔒" : "🔓"}
              </button>
            </div>
          );
        })}

        <div className="gen-actions">
          <button type="button" className="btn btn-primary" onClick={() => setSel((s) => aleatorio(s, candados))}>
            Aleatorio
          </button>
        </div>
        <p className="muted gen-hint">
          Con el candado dejas fijo un rasgo y Aleatorio cambia solo el resto. Rareza: {RAREZA}.{" "}
          {combinaciones().toLocaleString("es")} combinaciones; cada una es de una sola persona.
        </p>
      </section>

      <section className="gen-suggest" aria-label="Sugerencias">
        <div className="gen-suggest-head">
          <h3>Sugerencias</h3>
          <button type="button" className="btn btn-ghost" onClick={() => setSugerencias(sugerenciasDe(Math.random))}>
            Otras
          </button>
        </div>
        <div className="gen-suggest-grid">
          {sugerencias.map((s, i) => (
            <button
              key={i}
              type="button"
              className="gen-suggest-item"
              aria-pressed={codificar(s) === code}
              onClick={() => setSel(s)}
            >
              <Kosmonauta sel={s} label={`Usar sugerencia ${i + 1}`} />
            </button>
          ))}
        </div>
      </section>
    </fieldset>
  );
}
