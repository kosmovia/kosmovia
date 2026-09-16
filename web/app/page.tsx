const features = [
  {
    title: "Communities",
    text: "Channels, threads, roles and direct messages, with the layout you already know.",
  },
  {
    title: "A feed that spreads",
    text: "Posts from your communities and the people you follow. Mini apps open straight from a post.",
  },
  {
    title: "A wallet from day one",
    text: "Created at sign-up. No seed phrases, no extensions, fees sponsored. Tip by @username.",
  },
  {
    title: "Mini apps inside",
    text: "Build an app, publish it in Kosmovia and charge in USDC. No app store, no review queue.",
  },
];

const stages = [
  {
    name: "A · Social base",
    what: "Identity, communities, channels and chat",
    when: "Sep – Oct",
    now: true,
  },
  {
    name: "B · Feed",
    what: "Posts, follows, Home and Explore",
    when: "Oct – Nov",
  },
  {
    name: "C · Wallet",
    what: "A Stellar wallet at sign-up, tips by @username",
    when: "Nov – Dec",
  },
  {
    name: "D · Payments",
    what: "Tickets, pools and raffles inside a community",
    when: "Dec – Jan",
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
    name: "G · Scale",
    what: "Mainnet, mobile and cash on-ramps",
    when: "Not scheduled",
  },
];

export default function Home() {
  return (
    <main>
      <p className="badge">Building in public · Stellar Elite Bolivia</p>
      <h1>Kosmovia</h1>
      <p className="tagline">Explore. Connect. Belong.</p>
      <p className="lead">
        A free social network for Stellar: Discord-style communities, a feed that
        carries what you build, a built-in non-custodial wallet, and mini apps
        that run inside it.
      </p>
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
          One stage at a time. The first three are what we commit to; from mini
          apps onward there are no dates yet. They come last on purpose: apps
          multiply an audience that already exists.
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
      <footer>Early development · testnet only</footer>
    </main>
  );
}
