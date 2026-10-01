# Kosmovia

**Explore. Connect. Belong.**

Communities with a wallet and payments built in, on Stellar. For people, builders and businesses — starting in Bolivia, built for the world.

## Status

Early development, testnet only. Web first, mobile next.

Live: **https://kosmovia.vercel.app** (the landing is in English, and in Spanish at `/es`)

## What it does

- Communities with channels, roles and chat, run by people, builders or companies
- A wallet from day one: sign in with Google or email and your USDC wallet is ready. No seed phrases, no extensions, fees covered
- Payments and transfers: send money by @username, get paid with a link or QR, and close deals with escrow contracts
- Verified businesses (banks, fintechs, car dealers, real estate agencies) that open their own communities to reach users and builders
- Bolivia first, then the world

No paid channels and no subscriptions.

## Roadmap

Bolivia first, then the world. Stages A to D are what we commit to for October 2026; the rest follows in 2027.

| Stage | What gets built | When | Done when |
| --- | --- | --- | --- |
| A · Communities + wallet | Sign in with Google or email, USDC wallet, communities, channels and chat | Now | A community chatting, every member with a wallet, on testnet |
| B · Explore | Discover communities, profiles and what's happening now | Oct 2026 | People finding and joining communities they did not know |
| C · Payments | Send and request money by @username, community payments, escrow and split contracts | Oct 2026 | Money sent between members and a deal closed with an escrow contract, on testnet |
| D · Verified businesses | Business verification (KYC), company communities, API connections | Oct 2026 | A verified business running its own community |
| E · Mini apps | Apps running inside, opened from a post | 2027 | — |
| F · Open to others | A public SDK so anyone can publish an app | 2027 | — |
| G · Beyond Bolivia | More countries, mainnet and cash on-ramps | 2027 | — |

## Stack

| When | Tools and protocols |
| --- | --- |
| Oct 2026 (A–D) | Next.js on Vercel · Pollar SDK (sign-in, USDC wallet, sponsored fees) · Firebase (database) · Stellar testnet with USDC · Soroban contracts for escrow and split payments · a KYC provider for businesses (to be chosen) |
| 2027 | Mini apps: sandboxed iframe + our own TypeScript SDK · Scale: mainnet, cash on-ramps (SEP-24), PWA |

Free tools only, testnet until the team decides otherwise.

## Team

- **Roberto** — backend, business verification (KYC)
- **Alejandro** — product and backend: wallet and payments, deploys
- **Victor** — frontend, UX/UI and the presentation
- **Carla** — social media, marketing and brand

Built in the Stellar Elite Bolivia (TechRebel) program.

## Repo structure

| Folder | Owner | What it holds |
| --- | --- | --- |
| `web` | Alejandro and Victor | Landing + web app, deployed on Vercel |
| `app` | Victor | Victor — the dApp (web client: login, communities, chat, wallet). Victor's landing can replace web/ through a PR. |
| `server` | Roberto and Alejandro | Backend services |
| `contracts` | Roberto | Soroban contracts (Rust): escrow and split payments |
| `design` | Carla | Brand assets and Figma exports |

Anyone can open a Pull Request on any folder; its owner reviews it.

## Contributing

One branch per task → Pull Request → review → merge.
Never commit keys, seed phrases or `.env` files. Rules: [AGENTS.md](AGENTS.md).
