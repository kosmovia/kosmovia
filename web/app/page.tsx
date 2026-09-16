const features = [
  {
    title: "Communities",
    text: "Channels, threads and direct messages, in the browser and on the phone.",
  },
  {
    title: "A wallet from day one",
    text: "Created at sign-up. No seed phrases, no extensions, fees sponsored.",
  },
  {
    title: "Tips by @username",
    text: "Send USDC or XLM inside the chat, to a name instead of an address.",
  },
];

export default function Home() {
  return (
    <main>
      <p className="badge">Building in public · Stellar Elite Bolivia</p>
      <h1>Kosmovia</h1>
      <p className="tagline">Explore. Connect. Belong.</p>
      <p className="lead">
        A free, Discord-style community platform for Stellar, with a built-in
        non-custodial wallet. The gateway to Stellar for newcomers, users,
        communities and builders.
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
