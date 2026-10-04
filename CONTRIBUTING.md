# Contributing to PromiseDecay

Thanks for looking at this. PromiseDecay is early, opinionated, and small — contributions that
respect its shape are far more likely to land than contributions that add to it.

## What the project is

A public memory layer for promises. It records what was said, tracks how it changed, and uses
GenLayer consensus to decide what was delivered. The contract is authoritative; everything else is
a projection or an interface to it.

Three principles break more arguments than any style guide here:

1. **The contract decides. The backend never does.** If you find yourself re-implementing a
   lifecycle rule in TypeScript, the logic belongs in `contracts/PromiseDecay.py` instead.
2. **The user signs their own writes.** Never add a server-side signer, never accept a private key
   over HTTP, never mark a transaction final before the chain says so.
3. **Consensus is not a security boundary.** Prompt injection is handled deterministically, before
   non-determinism. A validator being convinced by hostile text is a known failure mode, not a bug
   to patch at the prompt.

## Getting set up

```bash
pnpm install
cp .env.example .env
pnpm --filter @promisedecay/api migrate
python3 -m venv .venv && .venv/bin/pip install "genlayer-test==0.29.2" pytest
```

See the [README](README.md) for the full local setup.

## Before you open a pull request

Everything below must be green. A change that cannot pass these is not ready to be reviewed.

```bash
pnpm -r typecheck
pnpm --filter @promisedecay/api test
pnpm --filter @promisedecay/web test
.venv/bin/pytest tests/contract
```

If you touched the frontend:

```bash
pnpm --filter @promisedecay/web exec playwright test
pnpm --filter @promisedecay/web screenshots   # then actually look at them
```

That last command is not optional. "Playwright passes" is not evidence that a page looks good, and
the design language is a real acceptance criterion rather than a nice-to-have.

If you touched the contract:

```bash
.venv/bin/pytest tests/contract          # Direct Mode
```

Then deploy to Studionet and run the lifecycle, and re-run read-method certification against the
**new** address. Never report an address from a superseded deployment.

## Style

- Match the file you are editing. There is no house style; there is the local style.
- Comments explain *why*, especially where a simpler thing would look plausible. If a non-obvious
  guard exists, say what breaks without it.
- Prefer deleting code to adding an abstraction. Ponytail discipline: no dependency, helper or
  interface without a concrete caller that needs it today.
- Keep collections and strings bounded in the contract. Unbounded input is a bug.

## Good first contributions

- **Evidence and drift UX** — the timeline is the signature component and can always be clearer.
- **Docs** — if something here confused you, that is a bug in the docs.
- **More adversarial test cases** for `tests/contract/test_prompt_injection.py`.
- **Accessibility** — keyboard paths, focus management, contrast against the glass surfaces.

## Reporting security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the [MIT licence](LICENSE).
