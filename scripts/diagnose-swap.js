/**
 * diagnose-swap.js — Check all state that could block Uniswap swaps
 *
 * Usage: npx hardhat run scripts/diagnose-swap.js --network sepolia
 */
const { ethers } = require("hardhat");

const RATE_TOKEN = "0x23eA986a5f68c95e2ea6Fc9c713EC69537ecD2c0";
const FAIR_LAUNCH = "0x75E0f90A50a05Ab6fF183086142cCD5D440E02D3";
const UNISWAP_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

const FACTORY_ABI = [
  "function getPair(address, address) view returns (address)"
];

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)"
];

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH() view returns (address)"
];

const TOKEN_ABI = [
  "function tradingActive() view returns (bool)",
  "function swapEnabled() view returns (bool)",
  "function limitsInEffect() view returns (bool)",
  "function tokensDistributed() view returns (bool)",
  "function owner() view returns (address)",
  "function uniswapV2Pair() view returns (address)",
  "function uniswapV2Router() view returns (address)",
  "function automatedMarketMakerPairs(address) view returns (bool)",
  "function _isExcludedMaxTransactionAmount(address) view returns (bool)",
  "function isExcludedFromFees(address) view returns (bool)",
  "function maxBuyAmount() view returns (uint256)",
  "function maxSellAmount() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)",
  "function buyTaxRate() view returns (uint256)",
  "function sellTaxRate() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function _isBlacklisted(address) view returns (bool)"
];

const SALE_ABI = [
  "function saleState() view returns (uint8)",
  "function liquidityCreated() view returns (bool)",
  "function uniswapPair() view returns (address)",
  "function uniswapRouter() view returns (address)",
  "function totalTokensSold() view returns (uint256)",
  "function totalEthRaised() view returns (uint256)",
  "function lpTokenAmount() view returns (uint256)",
  "function owner() view returns (address)"
];

async function main() {
  console.log("=== SWAP DIAGNOSTIC ===\n");

  const token = new ethers.Contract(RATE_TOKEN, TOKEN_ABI, ethers.provider);
  const sale = new ethers.Contract(FAIR_LAUNCH, SALE_ABI, ethers.provider);
  const router = new ethers.Contract(UNISWAP_ROUTER, ROUTER_ABI, ethers.provider);

  // 1. Sale state
  console.log("--- FAIR LAUNCH SALE STATE ---");
  const saleState = await sale.saleState();
  const states = ["NOT_STARTED", "ACTIVE", "COMPLETED", "FINALIZED", "CANCELLED"];
  console.log("  saleState:", states[saleState] || saleState);
  console.log("  liquidityCreated:", await sale.liquidityCreated());
  console.log("  uniswapPair (from sale):", await sale.uniswapPair());
  console.log("  uniswapRouter (from sale):", await sale.uniswapRouter());
  console.log("  totalTokensSold:", ethers.formatEther(await sale.totalTokensSold()));
  console.log("  totalEthRaised:", ethers.formatEther(await sale.totalEthRaised()));
  console.log("  lpTokenAmount:", ethers.formatEther(await sale.lpTokenAmount()));
  console.log("  sale owner:", await sale.owner());

  // 2. Token state
  console.log("\n--- RATE TOKEN STATE ---");
  console.log("  tradingActive:", await token.tradingActive());
  console.log("  swapEnabled:", await token.swapEnabled());
  console.log("  limitsInEffect:", await token.limitsInEffect());
  console.log("  tokensDistributed:", await token.tokensDistributed());
  console.log("  token owner:", await token.owner());
  const tokenPair = await token.uniswapV2Pair();
  console.log("  uniswapV2Pair (from token):", tokenPair);
  console.log("  uniswapV2Router (from token):", await token.uniswapV2Router());
  console.log("  buyTaxRate:", (await token.buyTaxRate()).toString(), "bps");
  console.log("  sellTaxRate:", (await token.sellTaxRate()).toString(), "bps");
  console.log("  maxBuyAmount:", ethers.formatEther(await token.maxBuyAmount()));
  console.log("  maxSellAmount:", ethers.formatEther(await token.maxSellAmount()));
  console.log("  maxWalletAmount:", ethers.formatEther(await token.maxWalletAmount()));

  // 3. Check pair from factory
  console.log("\n--- UNISWAP PAIR CHECK ---");
  const factoryAddr = await router.factory();
  console.log("  Factory address:", factoryAddr);
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, ethers.provider);
  const pairFromFactory = await factory.getPair(RATE_TOKEN, WETH);
  console.log("  Pair from factory (RATE/WETH):", pairFromFactory);

  const salePair = await sale.uniswapPair();
  console.log("  Pair from sale contract:", salePair);
  console.log("  Pair from token contract:", tokenPair);
  console.log("  MATCH (sale vs factory)?", pairFromFactory.toLowerCase() === salePair.toLowerCase());
  console.log("  MATCH (token vs factory)?", pairFromFactory.toLowerCase() === tokenPair.toLowerCase());

  // 4. Check pair reserves
  if (pairFromFactory !== ethers.ZeroAddress) {
    const pair = new ethers.Contract(pairFromFactory, PAIR_ABI, ethers.provider);
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    const [reserve0, reserve1, ts] = await pair.getReserves();
    const totalLP = await pair.totalSupply();
    console.log("\n--- PAIR RESERVES ---");
    console.log("  token0:", token0);
    console.log("  token1:", token1);
    console.log("  reserve0:", ethers.formatEther(reserve0));
    console.log("  reserve1:", ethers.formatEther(reserve1));
    console.log("  totalSupply (LP):", ethers.formatEther(totalLP));

    // Check if pair is registered as AMM pair in token
    console.log("\n--- AMM PAIR REGISTRATION ---");
    console.log("  automatedMarketMakerPairs[factoryPair]:", await token.automatedMarketMakerPairs(pairFromFactory));
    console.log("  automatedMarketMakerPairs[tokenPair]:", await token.automatedMarketMakerPairs(tokenPair));
    if (salePair !== ethers.ZeroAddress && salePair.toLowerCase() !== pairFromFactory.toLowerCase()) {
      console.log("  automatedMarketMakerPairs[salePair]:", await token.automatedMarketMakerPairs(salePair));
    }

    // Check exclusions for the pair
    console.log("\n--- PAIR EXCLUSIONS ---");
    console.log("  isExcludedMaxTx[factoryPair]:", await token._isExcludedMaxTransactionAmount(pairFromFactory));
    console.log("  isExcludedFromFees[factoryPair]:", await token.isExcludedFromFees(pairFromFactory));
  } else {
    console.log("\n  *** NO PAIR EXISTS! LP was never created. ***");
  }

  // 5. Check sale contract exclusions
  console.log("\n--- SALE CONTRACT EXCLUSIONS ---");
  console.log("  isExcludedFromFees[sale]:", await token.isExcludedFromFees(FAIR_LAUNCH));
  console.log("  isExcludedMaxTx[sale]:", await token._isExcludedMaxTransactionAmount(FAIR_LAUNCH));

  // 6. Summary of blocking issues
  console.log("\n========================================");
  console.log("  DIAGNOSIS SUMMARY");
  console.log("========================================");

  const tradingActive = await token.tradingActive();
  const liquidityCreated = await sale.liquidityCreated();
  const pairMatch = pairFromFactory.toLowerCase() === tokenPair.toLowerCase();

  if (!liquidityCreated) {
    console.log("  [BLOCKER] finalize() has NOT been called — no liquidity exists");
  }
  if (!tradingActive) {
    console.log("  [BLOCKER] tradingActive = false — enableTrading() has NOT been called on RATEToken");
    console.log("            The token _transfer() will revert with 'Trading not active'");
    console.log("            for any non-excluded address trying to swap.");
  }
  if (pairFromFactory !== ethers.ZeroAddress && !pairMatch) {
    console.log("  [BLOCKER] Pair mismatch — token's uniswapV2Pair != factory pair");
    console.log("            The token created a pair in constructor, but LP may have gone to a different pair");
  }
  if (pairFromFactory !== ethers.ZeroAddress) {
    const isAMM = await token.automatedMarketMakerPairs(pairFromFactory);
    if (!isAMM) {
      console.log("  [BLOCKER] Factory pair is NOT registered as automatedMarketMakerPair in the token");
      console.log("            Tax logic and limit checks won't work correctly for this pair");
    }
  }
  if (tradingActive && liquidityCreated && pairMatch) {
    console.log("  No obvious blockers found. Check Uniswap UI for token import issues.");
  }
}

main().catch(console.error);
