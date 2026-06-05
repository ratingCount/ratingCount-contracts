/**
 * swap-test.js — Test swap via Uniswap V2 Router on Sepolia
 *
 * Uses swapExactETHForTokensSupportingFeeOnTransferTokens which handles
 * fee-on-transfer (tax) tokens like RATE.
 *
 * Usage:
 *   npx hardhat run scripts/swap-test.js --network sepolia
 *
 * Env:
 *   PRIVATE_KEY — wallet private key (must have Sepolia ETH)
 *   SEPOLIA_RPC_URL — Sepolia RPC endpoint
 */

const { ethers } = require("hardhat");

// Testnet-fast addresses
const RATE_TOKEN = "0x8508056cDeBA98c528163BEEb45f00d26ecf2162";
const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; // Sepolia WETH

// Minimal Uniswap V2 Router ABI
const ROUTER_ABI = [
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Wallet:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("ETH balance:", ethers.formatEther(balance), "ETH");

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);
  const token = new ethers.Contract(RATE_TOKEN, ERC20_ABI, signer);

  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const balanceBefore = await token.balanceOf(signer.address);
  console.log(`${symbol} balance before:`, ethers.formatUnits(balanceBefore, decimals));

  // Swap amount: 0.001 ETH (small test)
  const swapAmount = ethers.parseEther("0.001");
  console.log("\nSwapping", ethers.formatEther(swapAmount), "ETH for", symbol, "...");

  // Get expected output (pre-tax) for info
  try {
    const amounts = await router.getAmountsOut(swapAmount, [WETH, RATE_TOKEN]);
    console.log("Expected output (pre-tax):", ethers.formatUnits(amounts[1], decimals), symbol);
    console.log("After 5% buy tax: ~", ethers.formatUnits(amounts[1] * 95n / 100n, decimals), symbol);
  } catch (e) {
    console.log("Could not get quote (this is OK for tax tokens):", e.message?.slice(0, 80));
  }

  // Set amountOutMin to 0 for testing (in production, calculate proper minimum)
  const amountOutMin = 0;
  const path = [WETH, RATE_TOKEN];
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  try {
    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      amountOutMin,
      path,
      signer.address,
      deadline,
      { value: swapAmount }
    );
    console.log("Tx hash:", tx.hash);
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await token.balanceOf(signer.address);
    const received = balanceAfter - balanceBefore;
    console.log(`\n${symbol} balance after:`, ethers.formatUnits(balanceAfter, decimals));
    console.log(`${symbol} received:`, ethers.formatUnits(received, decimals));
  } catch (e) {
    console.error("\nSwap FAILED:", e.message);
    if (e.data) console.error("Revert data:", e.data);
  }
}

main().catch(console.error);
