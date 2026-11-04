# Came In

Find out which of your posts bring people through the door.

Came In reads the posts a shop has already sent through Buffer. Customers (or
the staff) tap the post that brought them in, on a card by the till. The
owner's phone rings: "Someone just came in because of Tuesday's sourdough
post."

Built for Buffer Commit 2026.

- Live: https://came-in.walkertbrown.workers.dev
- The sample bakery, no account needed: https://came-in.walkertbrown.workers.dev/sample

## How it is built

One Cloudflare Worker (Hono, TypeScript) with Workers Static Assets for the
owner app (Vite + Preact). D1 holds the data, R2 the image copies, and a
Durable Object per shop (`ShopRoom`) holds the open screens' WebSockets for
the bell, refreshes Buffer tokens in one place and runs the first sync page
by page. Cron triggers poll Buffer within its rate limits.

| Path | What |
|---|---|
| `src/worker/` | The Worker: routes, Buffer client, sync, taps, the ShopRoom |
| `src/worker/render/` | Server-rendered pages: the tap page, landing, privacy |
| `src/app/` | The owner app: the wall, first run, the sample bakery |
| `src/shared/` | Names, shop time, tokens, the sample bakery's posts |
| `migrations/` | D1 schema |
| `tests/` | Vitest in the Workers runtime; Buffer is mocked at the fetch layer |

Buffer is reached only through OAuth (an App Client), never a personal key.
A customer's tap never calls Buffer.

## Run it

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Local secrets go in `.dev.vars` (never committed): `BUFFER_CLIENT_ID`,
`BUFFER_CLIENT_SECRET`, `TOKEN_ENC_KEY` (32 bytes, base64url) and
`COOKIE_SECRET`.

## Test it

```sh
npm run check
npm test
```

GitHub Actions runs both on every commit. A pull request deploys to
`came-in-staging`; merging to `main` deploys to `came-in`.

## Credits

Fonts: Big Shoulders and Libre Franklin (SIL Open Font License). Icons:
Phosphor (MIT). Channel marks: Simple Icons (CC0). The sample bakery's photos
are from Wikimedia Commons, CC0 and CC BY 2.0, credited at `/credits`.
