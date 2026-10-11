# Deployment

The address of record lives in [`deployments/studionet.json`](deployments/studionet.json).
That file is written by `scripts/record_deployment.mjs` from what the **chain**
reports, and refuses to write if the on-chain source does not normalise to
`contracts/falk.py` byte-for-byte.

## Network

| | |
| --- | --- |
| Network | GenLayer StudioNet |
| Chain id | 61999 (`0xf22f`) |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |
| Currency | GEN (18 decimals) |

## Deploy a new instance

Prerequisites: the `genlayer` CLI, set to StudioNet, with an unlocked account that
holds a little GEN.

```bash
genlayer network set studionet            # or confirm with: genlayer config get
genlayer account show                     # the active account pays for the deploy
python scripts/fetch_genvm_bundle.py
genvm-lint check contracts/falk.py        # lint must pass
python -m pytest tests/pure tests/direct -q
genlayer deploy --contract contracts/falk.py
```

The command prints a transaction hash and a contract address. Then:

```bash
FALK_DEPLOYER=<deployer address> node scripts/record_deployment.mjs <address> <deploy tx hash>
npm run verify:live
npm run verify:safety
node scripts/arc.mjs                      # optional but recommended: the full live proof
npm run verify:arc
```

`record_deployment.mjs` reads `gen_getContractCode`, `gen_getContractSchema` and
`get_protocol_info`, and writes the manifest including `sourceSha256`,
`publicMethods` / `readMethods` / `writeMethods`, the runner id and the revision.
Commit the manifest with the code that produced it; CI's `live` job fails if the
repository source and the chain differ.

### Why byte-verification normalises

The chain stores the source as transported, and `gen_getContractCode` may return a
leading `Result:` banner, CRLF line endings, a BOM, or trailing blank lines.
`normalizeSource` strips exactly those and nothing else, so a one-character edit to
the contract changes the hash. `.gitattributes` forces LF for `*.py`.

## The web app

```bash
npm ci
npm run dev        # http://localhost:3000
npm run build && npm start
```

Configuration is public flags only (see `.env.example`); all three are optional.

| Variable | Default | Use |
| --- | --- | --- |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | manifest `rpcUrl` | alternative RPC |
| `NEXT_PUBLIC_EXPLORER_URL` | manifest `explorerUrl` | alternative explorer |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | manifest address | point a preview at another deploy (the footer says "NOT the address of record") |

Vercel: import the repository; the build command is `next build`; no environment
variables are required. `GET /api/health` is the keyless liveness/consistency probe
(chain id, revision, ABI counts, and — for the address of record — whether the
on-chain source hashes to the manifest).

The app has **no database, no server signer, no simulator fallback and no seeded
data**. Wallet connection is EIP-1193 (MetaMask); it can add StudioNet with
`wallet_addEthereumChain`.

## Redeploying after a contract change

There is no upgrade path (by design). To ship a fix: change `contracts/falk.py`,
run the full test bar (pure, direct, mutation sweep), deploy a **new** instance,
record it, rerun the arc, and publish the new address. Existing mandates stay on
the old instance and settle under its rules; the old instance can never be paused or
altered, which is the property being bought.

## Rollback

There is no rollback of an on-chain deploy. Point `NEXT_PUBLIC_CONTRACT_ADDRESS` (or
the manifest) back at the previous address; mandates on either instance remain
independent and fully functional.
