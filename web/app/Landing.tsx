import Link from "next/link";
import type { ReactNode } from "react";
import Rings from "./Rings";
import ThemeToggle from "./ThemeToggle";
import type { Content } from "./content";
import { en as deckEn, es as deckEs, section } from "./pitch/deck";
import type { Mark } from "./pitch/deck";

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

// Same order as the "solution" and "cases" cards in the deck.
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

const caseIcons = [
  <Icon key="ticket">
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
    <path d="M14 6v12" strokeDasharray="2 2.5" />
  </Icon>,
  <Icon key="home">
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v9h12v-9" />
    <path d="M10 19v-5h4v5" />
  </Icon>,
  <Icon key="bank">
    <path d="M3 9l9-5 9 5" />
    <path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18" />
  </Icon>,
  <Icon key="code">
    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
  </Icon>,
];

// Cards whose stage is not live yet show the phase label (see content.roadmap).
const solutionStages: (string | undefined)[] = [
  undefined,
  undefined,
  "C",
  "D",
];

function MarkIcon({ v }: { v: Mark["v"] }) {
  const path =
    v === "yes"
      ? "M4.5 12.5l5 5L19.5 7"
      : v === "no"
        ? "M6 6l12 12M18 6L6 18"
        : "M5 12h14";
  return (
    <svg
      className={`mark mark-${v}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

function SectionHead({
  id,
  title,
  intro,
}: {
  id: string;
  title: string;
  intro?: string;
}) {
  return (
    <header className="sec-head">
      <span className="bar" aria-hidden="true" />
      <h2 id={id}>{title}</h2>
      {intro && <p>{intro}</p>}
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
  const problem = section(deck, "problem", "list");
  const solution = section(deck, "solution", "cards");
  const how = section(deck, "how", "steps");
  const cases = section(deck, "cases", "cards");
  const stellar = section(deck, "stellar", "list");
  const compare = section(deck, "compare", "table");
  const road = section(deck, "roadmap", "roadmap");
  const team = section(deck, "team", "team");
  const join = section(deck, "close", "close");

  const links = [
    { href: "#solution", text: nav.solution },
    { href: "#how", text: nav.how },
    { href: "#cases", text: nav.cases },
    { href: "#roadmap", text: nav.roadmap },
    { href: "#team", text: nav.team },
  ];

  return (
    <div lang={lang} id="top">
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
              <p className="badge">{content.badge}</p>
              <h1>{cover.title}</h1>
              <p className="tagline">{cover.tagline}</p>
              <p className="lead">{cover.sub}</p>
              <p className="actions">
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

        <section className="sec" id="problem" aria-labelledby="h-problem">
          <div className="wrap">
            <SectionHead id="h-problem" title={problem.title} />
            <ul className="problems">
              {problem.items.map((item, i) => (
                <li key={item.text}>
                  <span className="num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec" id="solution" aria-labelledby="h-solution">
          <div className="wrap">
            <SectionHead id="h-solution" title={solution.title} />
            <ul className="cards cards-4">
              {solution.items.map((card, i) => {
                const stage = solutionStages[i];
                const phase = stage
                  ? roadmap.stages.find((s) => s.key === stage)
                  : undefined;
                return (
                  <li key={card.head} className="card">
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
            <ol className="steps">
              {how.items.map((item, i) => (
                <li key={item.text}>
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

        <section className="sec" id="cases" aria-labelledby="h-cases">
          <div className="wrap">
            <SectionHead id="h-cases" title={cases.title} />
            <ul className="cards cards-4">
              {cases.items.map((card, i) => (
                <li key={card.head} className="card">
                  <span className="card-icon">{caseIcons[i]}</span>
                  <h3>{card.head}</h3>
                  <p>{card.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec" id="stellar" aria-labelledby="h-stellar">
          <div className="wrap">
            <SectionHead id="h-stellar" title={stellar.title} />
            <ul className="points">
              {stellar.items.map((item) => (
                <li key={item.text}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M4.5 12.5l5 5L19.5 7" />
                  </svg>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec" id="different" aria-labelledby="h-different">
          <div className="wrap">
            <SectionHead id="h-different" title={compare.title} />
            <table className="cmp-table">
              <caption className="sr-only">{compare.caption}</caption>
              <thead>
                <tr>
                  <td />
                  {compare.cols.map((col) => (
                    <th key={col} scope="col">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((row) => (
                  <tr key={row.name} className={row.highlight ? "me" : undefined}>
                    <th scope="row">{row.name}</th>
                    {row.cells.map((cell, i) => (
                      <td key={compare.cols[i]}>
                        <span className="cell">
                          <MarkIcon v={cell.v} />
                          {cell.text}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="cmp-cards">
              {compare.rows.map((row) => (
                <li key={row.name} className={row.highlight ? "me" : undefined}>
                  <h3>{row.name}</h3>
                  <dl>
                    {row.cells.map((cell, i) => (
                      <div key={compare.cols[i]}>
                        <dt>{compare.cols[i]}</dt>
                        <dd>
                          <MarkIcon v={cell.v} />
                          {cell.text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec" id="roadmap" aria-labelledby="h-roadmap">
          <div className="wrap">
            <SectionHead
              id="h-roadmap"
              title={road.title}
              intro={roadmap.intro}
            />
            <ol className="road">
              {roadmap.stages.map((stage) => (
                <li
                  key={stage.key}
                  className={
                    stage.now ? "now" : stage.soon ? "soon" : undefined
                  }
                >
                  <span className="name">
                    {stage.name}
                    {stage.now && (
                      <span className="pill">{roadmap.nowLabel}</span>
                    )}
                  </span>
                  <span className="what">{stage.what}</span>
                  <span className="when">{stage.when}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="sec" id="team" aria-labelledby="h-team">
          <div className="wrap">
            <SectionHead id="h-team" title={team.title} />
            <ul className="people">
              {team.people.map((p) => (
                <li key={p.name}>
                  <span className="avatar" aria-hidden="true">
                    {p.name.slice(0, 1)}
                  </span>
                  <h3>{p.name}</h3>
                  <p>{p.role}</p>
                </li>
              ))}
            </ul>
            <p className="team-foot">{team.footer}</p>
          </div>
        </section>

        <section className="join" id="join" aria-labelledby="h-join">
          <div className="wrap join-in">
            <h2 id="h-join">{join.title}</h2>
            <p>{join.text}</p>
            <p className="actions">
              <a className="btn btn-primary" href={GITHUB_URL}>
                {actions.github}
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">{content.footer}</div>
      </footer>
    </div>
  );
}
