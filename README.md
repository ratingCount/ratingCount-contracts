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

See [SECURITY.md](./SECURITY.md) for disclosure.

## License

MIT — see [LICENSE](./LICENSE).
