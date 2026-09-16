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
      <p className="cta">
        <a href="https://github.com/kosmovia/kosmovia">Follow the code on GitHub</a>
      </p>
      <footer>Early development · testnet only</footer>
    </main>
  );
}
