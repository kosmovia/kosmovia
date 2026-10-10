"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Rings from "../Rings";
import type { Deck, Mark, Slide } from "./deck";
import { SOCIALS } from "./socials";
import "./pitch.css";

const CLOSE_UI = {
  es: { cta: "Prueba Kosmovia", scan: "Escanea y entra", web: "Sitio y pitch", code: "Código", follow: "Síguenos" },
  en: { cta: "Try Kosmovia", scan: "Scan to join", web: "Site and pitch", code: "Code", follow: "Follow us" },
} as const;

function hashToIndex(total: number): number {
  const n = parseInt(window.location.hash.replace("#", ""), 10);
  if (Number.isNaN(n)) return 0;
  return Math.min(Math.max(n, 1), total) - 1;
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("a, button, input, textarea, select"));
}

function MarkIcon({ v }: { v: Mark["v"] }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
  if (v === "yes") {
    return (
      <svg {...common} className="mark-icon mark-yes">
        <path d="M4.5 12.5l5 5L19.5 7" />
      </svg>
    );
  }
  if (v === "no") {
    return (
      <svg {...common} className="mark-icon mark-no">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  return (
    <svg {...common} className="mark-icon mark-partial">
      <path d="M5 12h14" />
    </svg>
  );
}

function Title({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="slide-title">
      {children}
    </h2>
  );
}

function SlideBody({
  slide,
  id,
  lang,
}: {
  slide: Slide;
  id: string;
  lang: "es" | "en";
}) {
  switch (slide.kind) {
    case "cover":
      return (
        <div className="body cover-body">
          <Rings />
          <h1 id={id} className="cover-title">
            {slide.title}
          </h1>
          <p className="cover-tagline">{slide.tagline}</p>
          <p className="cover-sub">{slide.sub}</p>
          <p className="cover-meta">{slide.meta}</p>
        </div>
      );
    case "list":
      return (
        <div className="body split">
          <Title id={id}>{slide.title}</Title>
          <ul className="points">
            {slide.items.map((item) => (
              <li key={item.text}>
                <p>
                  {item.lead && <strong>{item.lead} </strong>}
                  {item.text}
                </p>
                {item.link && (
                  <a href={`https://${item.link}`} className="point-link">
                    {item.link}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    case "cards":
      return (
        <div className="body stack">
          <Title id={id}>{slide.title}</Title>
          <ul className="cards">
            {slide.items.map((card) => (
              <li key={card.head}>
                <h3>{card.head}</h3>
                <p>{card.text}</p>
              </li>
            ))}
          </ul>
        </div>
      );
    case "steps":
      return (
        <div className="body stack">
          <Title id={id}>{slide.title}</Title>
          <ol className="steps">
            {slide.items.map((step, i) => (
              <li key={step.text}>
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <p>
                  {step.lead && <strong>{step.lead} </strong>}
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      );
    case "table":
      return (
        <div className="body stack">
          <Title id={id}>{slide.title}</Title>
          <div className="table-wrap">
            <table className="compare" role="table">
              <caption className="sr-only">{slide.caption}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <td role="presentation" />
                  {slide.cols.map((col) => (
                    <th key={col} scope="col" role="columnheader">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {slide.rows.map((row) => (
                  <tr
                    key={row.name}
                    role="row"
                    className={row.highlight ? "me" : undefined}
                  >
                    <th scope="row" role="rowheader">
                      {row.name}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={i} role="cell" data-label={slide.cols[i]}>
                        <span className="cell">
                          <MarkIcon v={cell.v} />
                          <span>{cell.text}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "roadmap":
      return (
        <div className="body stack">
          <Title id={id}>{slide.title}</Title>
          <ol className="road">
            {slide.stages.map((stage) => (
              <li
                key={stage.key}
                className={stage.now ? "now" : stage.soon ? "soon" : "later"}
              >
                <span className="road-name">
                  {stage.name}
                  {stage.now && <span className="pill">{slide.nowLabel}</span>}
                </span>
                <span className="road-what">{stage.what}</span>
                <span className="road-when">{stage.when}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "team":
      return (
        <div className="body stack">
          <Title id={id}>{slide.title}</Title>
          <ul className="team">
            {slide.people.map((p) => (
              <li key={p.name}>
                <span className="avatar avatar-kosmonauta" aria-hidden="true">
                  {/* Kosmonauta de cada persona: web/public/team/<nombre>.svg (scripts/team-avatars.mjs). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/team/${p.name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.svg`}
                    alt=""
                    width={96}
                    height={96}
                  />
                </span>
                <h3>{p.name}</h3>
                <p>{p.role}</p>
              </li>
            ))}
          </ul>
          <p className="team-footer">{slide.footer}</p>
        </div>
      );
    case "close":
      return (
        <div className="body close-body close-v2">
          <Rings />
          <div className="close-main">
            <Title id={id}>{slide.title}</Title>
            <p className="close-text">{slide.text}</p>
            <a className="close-cta" href="https://kosmovia.onrender.com" target="_blank" rel="noopener noreferrer">
              {CLOSE_UI[lang].cta} <span aria-hidden="true">→</span>
              <small>kosmovia.onrender.com</small>
            </a>
            <p className="close-chips">
              <a href="https://kosmovia.vercel.app" target="_blank" rel="noopener noreferrer">
                {CLOSE_UI[lang].web} · kosmovia.vercel.app
              </a>
              <a href="https://github.com/kosmovia/kosmovia" target="_blank" rel="noopener noreferrer">
                {CLOSE_UI[lang].code} · GitHub
              </a>
            </p>
            <ul className="close-social" aria-label={CLOSE_UI[lang].follow}>
              {SOCIALS.filter((s) => s.name !== "GitHub").map((s) => (
                <li key={s.name}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${s.name}: ${s.handle}`}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                      {s.path}
                    </svg>
                    <span>{s.handle}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="close-big">{slide.big}</p>
          </div>
          <figure className="close-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/qr-kosmovia.svg" alt="QR: kosmovia.vercel.app" width={220} height={220} />
            <figcaption>{CLOSE_UI[lang].scan}</figcaption>
          </figure>
        </div>
      );
  }
}

export default function PitchViewer({ deck }: { deck: Deck }) {
  const { ui, slides, lang } = deck;
  const total = slides.length;
  const [index, setIndex] = useState(0);
  const [fsSupported, setFsSupported] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const focusInStage = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (n: number) => setIndex(Math.min(Math.max(n, 0), total - 1)),
    [total],
  );

  // Open on the slide given in the URL hash, and follow hash changes.
  useEffect(() => {
    setIndex(hashToIndex(total));
    const onHash = () => setIndex(hashToIndex(total));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [total]);

  // Keep the hash in sync with the slide (without adding history entries).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const next = `#${index + 1}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [index]);

  // If focus was inside the slide that just went inert, carry it to the new one.
  useEffect(() => {
    const ae = document.activeElement;
    if (
      focusInStage.current &&
      (!ae || ae === document.body || ae.closest("[inert]"))
    ) {
      deckRef.current
        ?.querySelector<HTMLElement>(".slide.active")
        ?.focus({ preventScroll: true });
    }
  }, [index]);

  useEffect(() => {
    setFsSupported(Boolean(document.documentElement.requestFullscreen));
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, total - 1));
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
        case " ":
          // Space activates a focused button or link; leave that alone.
          if (isInteractive(e.target)) return;
          e.preventDefault();
          setIndex((i) =>
            e.shiftKey ? Math.max(i - 1, 0) : Math.min(i + 1, total - 1),
          );
          break;
        case "Home":
          e.preventDefault();
          setIndex(0);
          break;
        case "End":
          e.preventDefault();
          setIndex(total - 1);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void deckRef.current?.requestFullscreen?.();
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(index + (dx < 0 ? 1 : -1));
    }
  }

  const otherLang = lang === "en" ? "es" : "en";
  const progress = ((index + 1) / total) * 100;

  return (
    <div
      lang={lang}
      className="deck"
      ref={deckRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={ui.deckLabel}
    >
      <main
        className="stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onFocusCapture={() => {
          focusInStage.current = true;
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && !e.currentTarget.contains(next)) {
            focusInStage.current = false;
          }
        }}
      >
        {slides.map((slide, i) => {
          const active = i === index;
          const id = `slide-title-${i + 1}`;
          return (
            <section
              key={i}
              className={`slide slide-${slide.kind}${active ? " active" : ""}`}
              aria-labelledby={id}
              aria-roledescription="slide"
              aria-hidden={!active}
              inert={!active}
              tabIndex={0}
            >
              <SlideBody slide={slide} id={id} lang={lang === "es" ? "es" : "en"} />
              {slide.kind !== "cover" && (
                <div className="slide-foot" aria-hidden="true">
                  <span>Kosmovia</span>
                  <span>
                    {i + 1} / {total}
                  </span>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <div className="controls top">
        <Link href={ui.backHref} className="pill-btn" aria-label={ui.back}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {ui.backText}
        </Link>
        <div className="top-right">
          {fsSupported && (
            <button
              type="button"
              className="pill-btn"
              onClick={toggleFullscreen}
              aria-label={isFs ? ui.exitFullscreen : ui.fullscreen}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {isFs ? (
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                ) : (
                  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                )}
              </svg>
              <span className="btn-text">
                {isFs ? ui.exitFullscreen : ui.fullscreen}
              </span>
            </button>
          )}
          <Link
            href={`${ui.switchHref}#${index + 1}`}
            className="pill-btn round"
            aria-label={ui.switchLabel}
            title={ui.switchLabel}
            hrefLang={otherLang}
            lang={otherLang}
            replace
          >
            {ui.switchText}
          </Link>
        </div>
      </div>

      <nav className="controls bottom" aria-label={ui.deckLabel}>
        <button
          type="button"
          className="nav-btn"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label={ui.prev}
          title={ui.prev}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="counter" role="status">
          <span className="sr-only">
            {ui.slideOf
              .replace("{n}", String(index + 1))
              .replace("{total}", String(total))}
            {": "}
            {slides[index].title}
          </span>
          <span aria-hidden="true">
            {index + 1} / {total}
          </span>
        </span>
        <button
          type="button"
          className="nav-btn"
          onClick={() => go(index + 1)}
          disabled={index === total - 1}
          aria-label={ui.next}
          title={ui.next}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </nav>

      <div className="progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
