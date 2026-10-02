import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import Reveal from "./Reveal";
import Rings from "./Rings";
import ThemeToggle from "./ThemeToggle";
import type { Content } from "./content";
import { en as deckEn, es as deckEs, section } from "./pitch/deck";

const GITHUB_URL = "https://github.com/kosmovia/kosmovia";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Same order as the "solution" cards in the deck.
const solutionIcons = [
  <Icon key="chat">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
  </Icon>,
  <Icon key="wallet">
    <path d="M4 7a2 2 0 0 1 2-2h11v4" />
    <path d="M4 7v11a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2z" />
    <circle cx="16" cy="14.5" r="1.2" />
  </Icon>,
  <Icon key="send">
    <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />
  </Icon>,
  <Icon key="shield">
    <path d="M12 3l7 3v5.5c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Icon>,
];

// Cards whose stage is not live yet show the phase label (see content.roadmap).
const solutionStages: (string | undefined)[] = [
  undefined,
  undefined,
  "C",
  "D",
];

// Marks an element for the scroll reveal; --i staggers siblings by 80ms.
function rv(i = 0) {
  return {
    "data-reveal": "",
    style: { "--i": i } as CSSProperties,
  };
}

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <header className="sec-head" {...rv()}>
      <span className="bar" aria-hidden="true" />
      <h2 id={id}>{title}</h2>
    </header>
  );
}

export default function Landing({
  lang,
  content,
}: {
  lang: "en" | "es";
  content: Content;
}) {
  const { ui, roadmap, nav, actions } = content;
  const deck = lang === "en" ? deckEn : deckEs;

  const cover = section(deck, "cover", "cover");
  const solution = section(deck, "solution", "cards");
  const how = section(deck, "how", "steps");
  const road = section(deck, "roadmap", "roadmap");
  const join = section(deck, "close", "close");

  const later = roadmap.stages.filter((s) => !s.now && !s.soon);
  const laterNames = later
    .map((s) => s.name.split(" · ").slice(1).join(" · "))
    .join(" · ");

  const links = [
    { href: "#solution", text: nav.solution },
    { href: "#how", text: nav.how },
    { href: "#roadmap", text: nav.roadmap },
  ];

  return (
    <div lang={lang} id="top">
      <Reveal />
      <a className="skip" href="#main">
        {nav.skip}
      </a>
      <header className="nav">
        <div className="nav-in">
          <a href="#top" className="wordmark">
            Kosmovia
          </a>
          <nav aria-label={nav.label} className="nav-links">
            <ul>
              {links.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.text}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="controls">
            <Link
              href={ui.switchHref}
              className="control"
              aria-label={ui.switchLabel}
              title={ui.switchLabel}
              hrefLang={lang === "en" ? "es" : "en"}
              lang={lang === "en" ? "es" : "en"}
            >
              {ui.switchText}
            </Link>
            <ThemeToggle toLight={ui.themeToLight} toDark={ui.themeToDark} />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-label="Kosmovia">
          <div className="wrap hero-in">
            <Rings />
            <div className="hero-text">
              <h1 {...rv(0)}>{cover.title}</h1>
              <p className="tagline" {...rv(1)}>{cover.tagline}</p>
              <p className="lead" {...rv(2)}>{cover.sub}</p>
              <p className="actions" {...rv(3)}>
                <a className="btn btn-primary" href="#how">
                  {actions.how}
                </a>
                <a className="btn btn-ghost" href={GITHUB_URL}>
                  {actions.github}
                </a>
              </p>
            </div>
          </div>
        </section>

        <section className="sec" id="solution" aria-labelledby="h-solution">
          <div className="wrap">
            <SectionHead id="h-solution" title={solution.title} />
            <ul className="cards cards-4" role="list">
              {solution.items.map((card, i) => {
                const stage = solutionStages[i];
                const phase = stage
                  ? roadmap.stages.find((s) => s.key === stage)
                  : undefined;
                return (
                  <li key={card.head} className="card" {...rv(i)}>
                    <span className="card-icon">{solutionIcons[i]}</span>
                    <h3>{card.head}</h3>
                    {phase && <span className="phase">{phase.when}</span>}
                    <p>{card.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="sec" id="how" aria-labelledby="h-how">
          <div className="wrap">
            <SectionHead id="h-how" title={how.title} />
            <ol className="steps" role="list">
              {how.items.map((item, i) => (
                <li key={item.text} {...rv(i)}>
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <p>
                    {item.lead && <strong>{item.lead} </strong>}
                    {item.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="sec" id="roadmap" aria-labelledby="h-roadmap">
          <div className="wrap">
            <SectionHead id="h-roadmap" title={road.title} />
            <ol className="road" role="list">
              {roadmap.stages
                .filter((s) => s.now || s.soon)
                .map((stage, i) => (
                  <li
                    key={stage.key}
                    className={stage.now ? "now" : undefined}
                    {...rv(i)}
                  >
                    <span className="name">
                      {stage.name}
                      {stage.now && (
                        <span className="pill">{roadmap.nowLabel}</span>
                      )}
                    </span>
                    <span className="when">{stage.when}</span>
                  </li>
                ))}
            </ol>
            {later.length > 0 && (
              <p className="road-later" {...rv()}>
                <strong>{later[0].when}:</strong> {laterNames}
              </p>
            )}
          </div>
        </section>

        <section className="join" id="join" aria-labelledby="h-join">
          <div className="wrap join-in">
            <h2 id="h-join" {...rv(0)}>{join.title}</h2>
            <p {...rv(1)}>{join.text}</p>
            <p className="actions" {...rv(2)}>
              <a className="btn btn-primary" href={GITHUB_URL}>
                {actions.github}
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <p>{content.footer}</p>
          <p>{content.footerTeam}</p>
        </div>
      </footer>
    </div>
  );
}
