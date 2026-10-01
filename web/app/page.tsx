import Rings from "./Rings";

const features = [
  {
    title: "Communities",
    text: "Channels, roles and chat, with the layout you already know. Run by people, builders or companies.",
  },
  {
    title: "A wallet from day one",
    text: "Sign in with Google or email and your USDC wallet is ready. No seed phrases, no extensions, fees covered.",
  },
  {
    title: "Payments inside the community",
    text: "Sell event tickets with a QR at the door, run pools and send money by @username.",
  },
  {
    title: "Verified businesses",
    text: "Banks, fintechs, car dealers and real estate agencies get verified and open their own communities to reach users and builders.",
  },
];

const stages = [
  {
    name: "A · Communities + wallet",
    what: "Sign in with Google or email, USDC wallet, communities, channels and chat",
    when: "Now",
    now: true,
  },
  {
    name: "B · Payments",
    what: "Event tickets with QR, pools, send by @username",
    when: "Oct – Nov",
  },
  {
    name: "C · Verified businesses",
    what: "Business verification (KYC), company communities, API connections",
    when: "Nov – Dec",
  },
  {
    name: "D · Feed",
    what: "Posts, follows, Home and Explore",
    when: "Not scheduled",
  },
  {
    name: "E · Mini apps",
    what: "Apps running inside, opened from a post",
    when: "Not scheduled",
  },
  {
    name: "F · Open to others",
    what: "A public SDK so anyone can publish an app",
    when: "Not scheduled",
  },
  {
    name: "G · Beyond Bolivia",
    what: "More countries, mainnet and cash on-ramps",
    when: "Not scheduled",
  },
];

export default function Home() {
  return (
    <main>
      <div className="hero">
        <Rings />
        <p className="badge">Building in public · Stellar Elite Bolivia</p>
        <h1>Kosmovia</h1>
        <p className="tagline">Explore. Connect. Belong.</p>
        <p className="lead">
          Communities with a wallet and payments built in, on Stellar. For
          people, builders and businesses — starting in Bolivia, built for the
          world.
        </p>
      </div>
      <ul className="features">
        {features.map((feature) => (
          <li key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </li>
        ))}
      </ul>
      <section className="roadmap">
        <h2>How we get there</h2>
        <p>
          Bolivia first, then the world. We commit to the first three stages;
          the rest has no date yet.
        </p>
        <ol>
          {stages.map((stage) => (
            <li key={stage.name} className={stage.now ? "now" : undefined}>
              <span className="name">{stage.name}</span>
              <span className="what">{stage.what}</span>
              <span className="when">{stage.when}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="cta">
        <a href="https://github.com/kosmovia/kosmovia">Follow the code on GitHub</a>
      </p>
      <footer>Early development · testnet only · Built on Stellar</footer>
    </main>
  );
}
