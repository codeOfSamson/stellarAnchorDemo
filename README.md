# Stellar Anchor Auth POC

A proof-of-concept built for a client to demonstrate how a web app authenticates with a **Stellar anchor** using the Stellar Ecosystem Proposals [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) (Web Authentication) and [SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md) (Interactive Deposit/Withdrawal) protocols.

The goal was to show, end to end, how a client app can prove ownership of a Stellar account to an anchor and receive a JWT it can use to initiate deposits and withdrawals — without the user's secret key ever leaving their browser.

## What this demonstrates

**SEP-10 — Web Authentication**
A three-party signature flow between the browser, this app's backend, and the anchor:

1. The backend fetches the anchor's `stellar.toml` to discover its `WEB_AUTH_ENDPOINT`, then requests a challenge transaction on behalf of the user's account (including this app's `client_domain`).
2. The anchor returns a challenge transaction, already signed by the anchor.
3. The **frontend signs the challenge client-side** with the user's secret key — the secret never touches the backend or leaves the browser.
4. The backend adds its own `client_domain` signature (proving this app is who it claims to be) and submits the fully-signed transaction back to the anchor.
5. The anchor verifies all signatures and returns a JWT.

**SEP-24 — Interactive Deposit/Withdrawal**
Using the SEP-10 JWT, the app demonstrates:

1. Discovering the anchor's `TRANSFER_SERVER_SEP0024` from `stellar.toml`.
2. Calling `/info` (unauthenticated) and `/transactions/deposit|withdraw/interactive` (authenticated with the JWT) to kick off a deposit or withdrawal.
3. Opening the anchor-hosted interactive URL (KYC/payment UI) in a new tab.
4. Polling `/transaction` with the JWT to monitor status until the transaction completes.

## Why the split between frontend and backend

The backend exists to hold the `client_domain` signing key and make server-to-server calls to the anchor (avoiding CORS and keeping that key off the client). The **user's own secret key stays in the browser** and is used only to sign the SEP-10 challenge locally — this mirrors how a real wallet integration would work, where the backend never has custody of user keys.

## Project structure

```
.
├── backend/
│   ├── server.js              # Express server: SEP-10 + SEP-24 endpoints
│   ├── .well-known/
│   │   └── stellar.toml       # This app's own TOML (client_domain identity)
│   └── .env.example           # Copy to .env and fill in
└── frontend/
    ├── src/App.jsx            # Step-by-step SEP-10 / SEP-24 UI
    └── vite.config.js         # Proxies /api to the backend
```

## Running it locally

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values below
node server.js
```

`.env` values:

| Variable | Description |
|---|---|
| `HOME_DOMAIN` | The anchor's domain (its `stellar.toml` must live at `HOME_DOMAIN/.well-known/stellar.toml`) |
| `CLIENT_DOMAIN` | This app's own public domain, used as the SEP-10 `client_domain`. When developing locally, expose the backend with a tunnel (e.g. `tunnelmole`, `ngrok`) and put that hostname here — it must serve `backend/.well-known/stellar.toml` at `/.well-known/stellar.toml` |
| `CLIENT_SIGNING_KEY` | Secret key for the keypair whose **public key** is listed as `SIGNING_KEY` in `backend/.well-known/stellar.toml`. Generate a dedicated keypair for this — never reuse a funding account |
| `PORT` | Port for the backend server (defaults to `3001`) |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` requests to `http://localhost:3001` (see `frontend/vite.config.js`).

### 3. Try it

1. Open the frontend, enter a testnet Stellar public/secret keypair (fund one via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) if needed).
2. Walk through the SEP-10 flow to get a JWT.
3. Once authenticated, try a SEP-24 deposit or withdrawal against the configured anchor.

## Security notes (POC only — not production-ready)

- This is a demo: the secret-key input field is a convenience for testing and should never exist in a production wallet-integrated app. Real integrations sign with a wallet (e.g. Freighter, Ledger) that never exposes the secret key to the app at all.
- `CLIENT_SIGNING_KEY` should be a dedicated key used only for `client_domain` signing, kept out of version control (`.env` is gitignored — see `.env.example` for the required shape), and rotated if ever exposed.
- `HOME_DOMAIN`/`CLIENT_DOMAIN` in this repo point at the anchor and tunnel used during development; update them for your environment.
