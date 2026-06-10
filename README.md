# ratingCount Contracts

Smart contracts for the ratingCount protocol — a portable-reputation primitive.
**Live on Ethereum mainnet.** See [deployments/mainnet/](./deployments/mainnet/).

## Status

Currently in **fair-launch** phase. RATE token live, FairLaunchSale and VestingManager deployed.
This is the source repository; the website and backend live in a separate private repository.

## Contracts

| Contract | Mainnet address | Etherscan |
|---|---|---|
| RATEToken | `0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6` | [verify](https://etherscan.io/address/0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6#code) |
| FairLaunchSale | `0xce03e154329e1d962667D5B51d4eE2aCc543AA25` | [verify](https://etherscan.io/address/0xce03e154329e1d962667D5B51d4eE2aCc543AA25#code) |
| VestingManager | `0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf` | [verify](https://etherscan.io/address/0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf#code) |

Per-contract deployment metadata (deploy tx, block, constructor arguments, compiler settings,
verification links) is in [deployments/mainnet/](./deployments/mainnet/).

## Build & test

```bash
npm install
cp .env.example .env  # fill in RPC + key for live operations; tests work without
npx hardhat compile
npx hardhat test
```

## Security posture

**These contracts have not been audited by a third-party firm.** This is a deliberate choice
under our self-verification trust model: trust comes from transparency, not from an audit
badge. What you can verify yourself:

- All contract source verified on Etherscan (links above)
- Static-analysis reports: [docs/SLITHER_REPORT.md](./docs/SLITHER_REPORT.md) and [docs/MYTHRIL_REPORT.md](./docs/MYTHRIL_REPORT.md)
- Test suite in [test/](./test/) — 145 tests (64 FairLaunchSale + 81 VestingManager), green on CI
- The exact owner/admin capability list: [Security & Launch Facts](#security--launch-facts) below

See [SECURITY.md](./SECURITY.md) for disclosure.

## Security & Launch Facts

Everything in this section is checkable against the verified on-chain source and public chain
state — none of it requires trusting us. Statements marked *as of 2026-06-10* are live chain
state at the time of writing; re-check them with the commands in
[How to verify](#how-to-verify). Everything else is immutable (fixed in deployed bytecode).

### Launch facts

| Fact | Value |
|---|---|
| Chain | Ethereum mainnet, chainId `1` |
| Token | `RATE` ("ratingCount.ai"), 18 decimals, contract `RatingCountAI` |
| Token address | `0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6` |
| Token deploy tx | [`0xa7da7402c60e9a40c78d33df29c020468bbfafe7945eacf5830564c7bed60c50`](https://etherscan.io/tx/0xa7da7402c60e9a40c78d33df29c020468bbfafe7945eacf5830564c7bed60c50) (block 24656466) |
| Total supply | 100,000,000,000 RATE — minted once in the constructor; **no mint function exists** |
| FairLaunchSale | `0xce03e154329e1d962667D5B51d4eE2aCc543AA25` — deploy tx [`0x9aa690f1…b99aa`](https://etherscan.io/tx/0x9aa690f1e7760a4a045e3d4e61a5e86e43efc4a1cc7de2c80ea22adf575b99aa) (block 24656470) |
| VestingManager | `0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf` — deploy tx [`0xd22c8aad…20fa5`](https://etherscan.io/tx/0xd22c8aad15a87eefdf868ef8519e9ab0f75166f80a6c8ab031183ab345520fa5) (block 24656475) |
| Deployer / current owner | `0x9C9598CD02E083A3384E212006cDfCffbcC4E469` — `owner()` of all three contracts *(as of 2026-06-10)* |
| Trading status | `tradingActive() == false` — sale not started, trading not yet enabled *(as of 2026-06-10)* |
| Compiler | solc `v0.8.30+commit.73712a01`, optimizer enabled (200 runs), EVM `paris` |
| Source verification | Etherscan **Exact Match** on all three contracts (links in [Contracts](#contracts)) |
| Sale terms (hard-coded) | 40B RATE (40% of supply), 5 price tiers (0.0080→0.0640 ETH per 1M RATE), 14 days per tier, hard cap 778 ETH, 0.05 ETH min / 3.2 ETH max per wallet, one contribution per block |
| Liquidity policy (hard-coded) | `finalize()` pairs **all** raised ETH with tokens on Uniswap V2 in one atomic tx; LP tokens self-locked in the sale contract for 365 days; unsold tokens burned to `0xdead` |
| License | MIT |

Per-contract deployment metadata, including raw constructor args, lives in
[deployments/mainnet/](./deployments/mainnet/).

### Admin capabilities — the exact list

These contracts are **not upgradeable** and have **no mint function**, but they are **not
admin-free**: all three are owner-controlled (two-step ownership transfer, renounceable), and
the owner holds exactly the powers listed below — read directly from the source in
[contracts/](./contracts/). Owner of all three, *as of 2026-06-10*, is the deployer EOA
`0x9C9598CD02E083A3384E212006cDfCffbcC4E469`.

**What no one — owner included — can do:**

- **Mint:** supply is fixed at 100B in the constructor; the token exposes no mint or burn
  function after deployment.
- **Upgrade or replace code:** no proxy, no `delegatecall`, no `selfdestruct` in any contract.
- **Withdraw sale ETH:** `FairLaunchSale` has no ETH-withdrawal function. Every raised wei
  either goes into the Uniswap V2 LP at `finalize()` or back to contributors as refunds if the
  sale is cancelled.
- **Seize vested tokens:** `VestingManager` has no revoke or owner-withdrawal function; only
  beneficiaries can claim (but see `updateBeneficiary` below).
- **Disable trading after launch:** `enableTrading()` is one-way; no function sets
  `tradingActive` back to `false`. (Per-address blacklisting still exists — see below.)
- **Take LP early:** `withdrawLPTokens()` reverts until the 365-day lock expires.

**RATEToken — owner can:**

- **Blacklist any address** (`setBlacklist` / `setBlacklistBatch`): a blacklisted address can
  neither send nor receive RATE. The token contract itself and the main Uniswap pair cannot
  be blacklisted. There is no timelock on this power.
- **Set buy/sell tax between 0% and a hard-coded 10% maximum** (`updateTaxRates`; deployed
  defaults are 3% buy / 3% sell). Collected tax is swapped to ETH and sent to the treasury
  wallet.
- **Adjust trading limits** while `limitsInEffect`: max-buy / max-sell / max-wallet, with
  hard-coded floors of 0.1% / 0.1% / 0.3% of supply. `removeLimits()` switches limits off
  permanently (one-way).
- **Exclude any address from fees and limits** (`excludeFromFees`,
  `excludeFromMaxTransaction`), flag additional AMM pairs (the main pair cannot be unflagged),
  change the treasury wallet, force a fee swap (`forceSwapBack`), and withdraw **non-RATE**
  tokens or ETH stuck in the token contract.
- **One-time actions:** `distributeTokens()` (allocates supply to the six allocation wallets,
  once) and `enableTrading()` (once).

**FairLaunchSale — owner can:**

- `startSale()` (once), `pause()` / `unpause()` while the sale is running, and `cancel()` an
  active or paused sale, which puts the contract in refund mode.
- `finalize()` a completed sale — atomic LP creation + 365-day LP self-lock + burn of unsold
  tokens; there is no path that sends raised ETH to the owner.
- `pushRefunds()` — only in the cancelled state and only after a 30-day grace period; sends
  refunds *to contributors*, not to the owner.
- `withdrawLPTokens(to)` — only after the 365-day LP lock expires, to an address of the
  owner's choosing.

**VestingManager — owner can:**

- `configureVesting()` (once) and `triggerTGE()` (once — starts all vesting clocks).
- `createCustomVestingSchedule()` — only before TGE, only from tokens the contract actually
  holds, max one schedule set per address.
- `updateBeneficiary(old, new)` — migrate **all** of a beneficiary's vesting schedules to a
  new address, at any time. This is the strongest owner power in the system: it exists for
  wallet-loss recovery, but it technically lets the owner redirect any vesting stream to a
  different address. We list it here so you don't have to find it yourself.

### How to verify

All three contracts are verified on Etherscan with **Exact Match**
([RATEToken](https://etherscan.io/address/0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6#code) ·
[FairLaunchSale](https://etherscan.io/address/0xce03e154329e1d962667D5B51d4eE2aCc543AA25#code) ·
[VestingManager](https://etherscan.io/address/0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf#code))
— diff the Etherscan source tab against this repo.

Live chain state (Foundry `cast`, any RPC works):

```bash
RPC=https://ethereum-rpc.publicnode.com
TOKEN=0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6
SALE=0xce03e154329e1d962667D5B51d4eE2aCc543AA25
VEST=0x52e1293Ff5621A135Ec884031bD8933Dbc605bdf

cast call $TOKEN "owner()(address)"      --rpc-url $RPC   # current token owner
cast call $SALE  "owner()(address)"      --rpc-url $RPC
cast call $VEST  "owner()(address)"      --rpc-url $RPC
cast call $TOKEN "totalSupply()(uint256)" --rpc-url $RPC  # 100000000000e18, fixed
cast call $TOKEN "buyTaxRate()(uint256)"  --rpc-url $RPC  # basis points (300 = 3%)
cast call $TOKEN "sellTaxRate()(uint256)" --rpc-url $RPC
cast call $TOKEN "tradingActive()(bool)"  --rpc-url $RPC
cast call $TOKEN "limitsInEffect()(bool)" --rpc-url $RPC
```

No Foundry? The same `owner()` check as a raw JSON-RPC call:

```bash
curl -s -X POST https://ethereum-rpc.publicnode.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x14969077E80B0696aCC89db8D1ad2E1dC3a175E6","data":"0x8da5cb5b"},"latest"]}'
```

Compile-and-compare (proves this repo is the deployed code, independently of Etherscan):

```bash
npm install && npx hardhat compile   # hardhat.config.js pins solc 0.8.30, 200 runs, paris
# Compare artifacts/contracts/.../<Name>.json deployedBytecode against:
cast code $TOKEN --rpc-url $RPC
# Expected diffs only: immutable references and the CBOR metadata tail.
# Constructor args: deployments/mainnet/<Name>.json "constructorArgsRaw" must equal the
# tail of the creation tx input data (creation tx hashes in the table above).
```

### Official links

The first three are embedded in the verified contract source header
([contracts/RATEToken.sol](./contracts/RATEToken.sol)), so they are themselves on-chain-verifiable:

- Website: <https://ratingcount.ai>
- X / Twitter: <https://twitter.com/ratingCount>
- Telegram: <https://t.me/ratingCount>
- Web app: <https://www.ratingcount.com>
- Source: <https://github.com/ratingCount/ratingCount-contracts> (this repo)

Anything not on this list claiming to be ratingCount is not us.

> **Etherscan token page note:** the token-info / branding submission is **pending Etherscan
> review** (filed 2026-06-02, queued in their backlog). Until approved, the RATE token page
> shows a placeholder logo and an empty Info tab — that is a review-queue state, not a red
> flag. Contract **source verification** (the part that matters for security) has been live
> since deployment.

## License

MIT — see [LICENSE](./LICENSE).
