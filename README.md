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

| Stage | Dates (2026) | Goal |
| --- | --- | --- |
| 0 · Base | Sep 15–21 | Repo, website, brand, confirmed stack |
| 1 · Chat + apps | Sep 22 – Oct 5 | Chat on the web, plus the container that runs a mini app |
| 2 · Wallet | Oct 6–12 | Passkey sign-up, send and tips on testnet |
| 3 · Mini app & demo | Oct 13–19 | First mini app running inside, tested by 10 new users |

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
