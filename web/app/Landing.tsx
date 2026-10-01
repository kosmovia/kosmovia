import Link from "next/link";
import Rings from "./Rings";
import ThemeToggle from "./ThemeToggle";
import type { Content } from "./content";

export default function Landing({
  lang,
  content,
}: {
  lang: "en" | "es";
  content: Content;
}) {
  const { ui, roadmap } = content;
  return (
    <div lang={lang}>
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
      <main>
        <div className="hero">
          <Rings />
          <p className="badge">{content.badge}</p>
          <h1>Kosmovia</h1>
          <p className="tagline">{content.tagline}</p>
          <p className="lead">{content.lead}</p>
          <p className="cta">
            <a href="https://github.com/kosmovia/kosmovia">{content.cta}</a>
          </p>
        </div>
        <ul className="features">
          {content.features.map((feature) => {
            const phase = feature.stage
              ? roadmap.stages.find((s) => s.key === feature.stage)
              : undefined;
            return (
            <li key={feature.title}>
              <h2>{feature.title}</h2>
              {phase && <span className="feature-phase">{phase.when}</span>}
              <p>{feature.text}</p>
            </li>
            );
          })}
        </ul>
        <section className="roadmap">
          <h2>{roadmap.title}</h2>
          <p>{roadmap.intro}</p>
          <ol>
            {roadmap.stages.map((stage) => (
              <li
                key={stage.key}
                className={stage.now ? "now" : stage.soon ? "soon" : undefined}
              >
                <span className="name">
                  {stage.name}
                  {stage.now && <span className="pill">{roadmap.nowLabel}</span>}
                </span>
                <span className="what">{stage.what}</span>
                <span className="when">{stage.when}</span>
              </li>
            ))}
          </ol>
        </section>
        <footer>{content.footer}</footer>
      </main>
    </div>
  );
}
