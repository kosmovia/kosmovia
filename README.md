# Kosmovia

**Explore. Connect. Belong.**

A free social network for Stellar: Discord-style communities, a feed that carries what you build, a built-in non-custodial wallet, and mini apps that run inside.
The gateway to Stellar for newcomers, users, communities and builders.

## Status

Early development, testnet only. Web first, mobile next.

Live: **https://kosmovia.vercel.app**

## What it does

- Communities with channels, threads and roles, in the browser and on the phone
- A feed with posts from your communities and the people you follow
- A Stellar wallet created at sign-up: no seed phrases, no extensions, sponsored fees
- Send and tip USDC or XLM by @username, inside the chat
- Explore communities, projects and events of the Stellar ecosystem
- Mini apps that run inside Kosmovia, with `@username` identity and payments in USDC

No paid channels and no subscriptions.

## Roadmap

Built in stages, one at a time. Stages A, B and C are what we commit to for now. From E onward there are no dates yet: we schedule them once the first three are done.

Mini apps come last on purpose: they multiply an audience that already exists.

| Stage | What gets built | Dates | Done when |
| --- | --- | --- | --- |
| A · Social base | Identity, communities, channels, chat | Sep 21 – Oct 19 | 15 people talking for a week on their own |
| B · Feed | Posts, follows, Home, Explore | Oct 20 – Nov 9 | A full day of the feed moving without us |
| C · Wallet | Passkey wallet at sign-up, balance, tips by @username | Nov 10 – Dec 7 | Tips circulating on testnet |
| D · Payments | Event tickets, pools, raffles, receipts | Dec 8 – Jan 4 | A community charged for something real |
| E · Our mini apps | Sandboxed container, internal SDK, 2-3 apps by the team | Not scheduled | An app opened straight from a post |
| F · Open to others | Public SDK, app registry, weekly reward, bridges | Not scheduled | The first app published by someone outside |
| G · Scale | Mainnet, mobile, MoneyGram Ramps, budgeted agents | Not scheduled | — |

## Stack

| Stage | Tools and protocols |
| --- | --- |
| A–B | Next.js on Vercel · Supabase (Postgres, Auth, Realtime) · GitHub Actions |
| C | Stellar SDK and Stellar RPC (TypeScript) · passkeys (WebAuthn) · OpenZeppelin Smart Account Kit · OpenZeppelin Relayer · SEP-10 |
| D | USDC on testnet · Stellar DEX and AMM · Soroban (Rust) only where a contract is needed |
| E | Sandboxed iframe + message bridge · our own TypeScript SDK · x402 for instant USDC payments |
| F | App registry · Matrix with mautrix bridges if federation is worth it · Groq free tier for AI |
| G | Mainnet · SEP-24 with MoneyGram Ramps · PWA first, native later |

Free tools only, and everything runs on testnet until the team decides otherwise. Anything past stage B is still to confirm.

## Team

- **Roberto** — full-stack: backend, Soroban contracts, SDK
- **Victor** — frontend: web client, UX/UI
- **Carla** — design and marketing: brand, Figma, community
- **Alejandro** — product and full stack: landing site, glue services, deploys

Built in the Stellar Elite Bolivia (TechRebel) program.

## Repo structure

| Folder | Owner | What it holds |
| --- | --- | --- |
| `web` | Alejandro | Landing site, deployed on Vercel |
| `app` | Victor | Web client: communities, channels, chat |
| `server` | Roberto | Chat server and backend services |
| `contracts` | Roberto | Soroban contracts (Rust), testnet only |
| `design` | Carla | Brand assets and Figma exports |

Anyone can open a Pull Request on any folder; its owner reviews it.

## Contributing

One branch per task → Pull Request → review → merge.
Never commit keys, seed phrases or `.env` files. Rules: [AGENTS.md](AGENTS.md).
