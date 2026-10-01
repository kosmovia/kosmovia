# Kosmovia

**Explore. Connect. Belong.**

Communities with a wallet and payments built in, on Stellar. For people, builders and businesses — starting in Bolivia, built for the world.

## Status

Early development, testnet only. Web first, mobile next.

Live: **https://kosmovia.vercel.app**

## What it does

- Communities with channels, roles and chat, run by people, builders or companies
- A wallet from day one: sign in with Google or email and your USDC wallet is ready. No seed phrases, no extensions, fees covered
- Payments inside the community: event tickets with a QR at the door, pools, and sending money by @username
- Verified businesses (banks, fintechs, car dealers, real estate agencies) that open their own communities to reach users and builders
- Bolivia first, then the world

No paid channels and no subscriptions.

## Roadmap

Bolivia first, then the world. Stages A, B and C are what we commit to; the rest has no date yet.

| Stage | What gets built | When | Done when |
| --- | --- | --- | --- |
| A · Communities + wallet | Sign in with Google or email, USDC wallet, communities, channels and chat | Now | A community chatting, every member with a wallet, on testnet |
| B · Payments | Event tickets with QR, pools, send by @username | Oct – Nov | A ticket sold and checked in with its QR |
| C · Verified businesses | Business verification (KYC), company communities, API connections | Nov – Dec | A verified business running its own community |
| D · Feed | Posts, follows, Home and Explore | Not scheduled | — |
| E · Mini apps | Apps running inside, opened from a post | Not scheduled | — |
| F · Open to others | A public SDK so anyone can publish an app | Not scheduled | — |
| G · Beyond Bolivia | More countries, mainnet and cash on-ramps | Not scheduled | — |

## Stack

| When | Tools and protocols |
| --- | --- |
| Now (A–C) | Next.js on Vercel · Pollar SDK (sign-in, USDC wallet, sponsored fees) · Firebase (database) · Stellar testnet with USDC · a KYC provider for businesses (to be chosen) |
| Later | Mini apps: sandboxed iframe + our own TypeScript SDK · Scale: mainnet, cash on-ramps (SEP-24), PWA |

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
| `app` | Victor | Web client: communities, channels, chat |
| `server` | Roberto and Alejandro | Backend services |
| `contracts` | Roberto | Soroban contracts (Rust), only if a contract is needed |
| `design` | Carla | Brand assets and Figma exports |

Anyone can open a Pull Request on any folder; its owner reviews it.

## Contributing

One branch per task → Pull Request → review → merge.
Never commit keys, seed phrases or `.env` files. Rules: [AGENTS.md](AGENTS.md).
