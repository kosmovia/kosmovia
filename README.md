# Kosmovia

**Explore. Connect. Belong.**

A free, Discord-style community platform for Stellar, with a built-in non-custodial wallet.
The gateway to Stellar for newcomers, users, communities and builders.

## Status

Early development, testnet only. Web first, mobile next.

## What it does

- Communities, channels and chat, in the browser and on the phone
- A Stellar wallet created at sign-up: no seed phrases, no extensions, sponsored fees
- Send and tip USDC or XLM by @username, inside the chat
- Explore communities, projects and events of the Stellar ecosystem

No paid channels and no subscriptions.

## Roadmap

| Stage | Dates (2026) | Goal |
| --- | --- | --- |
| 0 · Base | Sep 15–21 | Repo, website, brand, confirmed stack |
| 1 · Chat | Sep 22 – Oct 5 | Communities and chat working on the web |
| 2 · Wallet | Oct 6–12 | Passkey sign-up, send and tips on testnet |
| 3 · Test & demo | Oct 13–19 | 10 new users test it, public demo |

## Stack (to confirm)

Soroban (Rust) · Stellar SDK and Stellar RPC (TypeScript) · Smart Account Kit with passkeys · OpenZeppelin Relayer for sponsored fees

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
