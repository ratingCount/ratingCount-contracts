/**
 * RATE Token - Sepolia Smoke Test (Live On-Chain)
 *
 * Executes real transactions on Sepolia to prove the contracts work.
 * Tests: startSale -> contribute -> cancel -> claimRefund
 *
 * WARNING: After this test, the Sepolia deployment will be in CANCELLED state.
 * This is expected and tests a critical path (refund mechanism).
 *
 * Usage:
 *   npx hardhat run scripts/test-sepolia-smoke.js --network sepolia
 *   # or
 *   npm run test:smoke
 *
 * Prerequisites:
 *   - SEPOLIA_RPC_URL and PRIVATE_KEY set in .env
 *   - Signer must be the contract owner (0x9C9598...)
 *   - Signer must have >= 0.2 Sepolia ETH
 *
 * Cost: ~0.02 Sepolia ETH
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");

// ============ Deployed Contract Addresses (Sepolia) ============

const ADDRESSES = {
  rateToken: "0x205E024F77DfCEEb15C3D39691eea42614398d6b",
  fairLaunch: "0xc3aD323F51bf56AE24e6f61CE6ae7a164e4A3Ef4",
  vesting: "0xe6f1Ed7cf61335576476156f26C5FE283663DE59",
  owner: "0x9C9598CD02E083A3384E212006cDfCffbcC4E469",
  treasury: "0xdB8a3A306d1242E51f8A11eC27d0b0f269291313",
};

const ETHERSCAN_BASE = "https://sepolia.etherscan.io/tx/";
const formatEther = ethers.formatEther;
const parseEther = ethers.parseEther;

// ============ Test Tracking ============

const results = [];
let stepNum = 0;

function logStep(name) {
  stepNum++;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Step ${stepNum}: ${name}`);
  console.log(`${"=".repeat(60)}`);
}

function pass(name, detail, txHash) {
  const entry = { step: stepNum, name, status: "PASS", txHash };
  results.push(entry);
  console.log(`  PASS: ${detail || name}`);
  if (txHash) console.log(`  TX: ${ETHERSCAN_BASE}${txHash}`);
}

function fail(name, error) {
  results.push({ step: stepNum, name, status: "FAIL", error: error.message || error });
  console.error(`  FAIL: ${name} - ${error.message || error}`);
}

function printSummary() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SMOKE TEST SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  results.forEach((r) => {
    const icon = r.status === "PASS" ? "[PASS]" : "[FAIL]";
    console.log(`  ${icon} Step ${r.step}: ${r.name}`);
    if (r.txHash) console.log(`         ${ETHERSCAN_BASE}${r.txHash}`);
    if (r.error) console.log(`         Error: ${r.error}`);
  });

  console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`${"=".repeat(60)}\n`);

  return failed === 0;
}

// ============ Main Test ============

async function main() {
  console.log("========================================");
  console.log("  RATE Token Smoke Test (Sepolia Live)");
  console.log("========================================\n");

  const network = hre.network.name;
  if (network !== "sepolia") {
    console.error("ERROR: Must run on sepolia network");
    console.error("Usage: npx hardhat run scripts/test-sepolia-smoke.js --network sepolia");
    process.exit(1);
  }

  // ==============================
  // Step 1: Preflight checks
  // ==============================
  logStep("Preflight checks");

  let signer, rateToken, fairLaunch, vesting;

  try {
    [signer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(signer.address);

    console.log(`  Signer: ${signer.address}`);
    console.log(`  Balance: ${formatEther(balance)} ETH`);

    // Verify signer is owner
    if (signer.address.toLowerCase() !== ADDRESSES.owner.toLowerCase()) {
      throw new Error(`Signer ${signer.address} is not owner ${ADDRESSES.owner}`);
    }

    // Verify sufficient balance
    if (balance < parseEther("0.2")) {
      throw new Error(`Insufficient balance: ${formatEther(balance)} ETH (need >= 0.2)`);
    }

    // Attach to contracts
    rateToken = await ethers.getContractAt("RatingCountAI", ADDRESSES.rateToken);
    fairLaunch = await ethers.getContractAt("FairLaunchSale", ADDRESSES.fairLaunch);
    vesting = await ethers.getContractAt("VestingManager", ADDRESSES.vesting);

    // Verify sale state
    const saleState = await fairLaunch.saleState();
    if (Number(saleState) !== 0) {
      throw new Error(`Sale state is ${saleState}, expected 0 (NOT_STARTED). Contracts may have been used already.`);
    }

    // Verify token balances
    const fairLaunchBalance = await rateToken.balanceOf(ADDRESSES.fairLaunch);
    const vestingBalance = await rateToken.balanceOf(ADDRESSES.vesting);
    const treasuryBalance = await rateToken.balanceOf(ADDRESSES.treasury);

    console.log(`  FairLaunch RATE: ${formatEther(fairLaunchBalance)}`);
    console.log(`  Vesting RATE: ${formatEther(vestingBalance)}`);
    console.log(`  Treasury RATE: ${formatEther(treasuryBalance)}`);

    const expected40B = parseEther("40000000000");
    const expected52B = parseEther("52000000000");
    const expected8B = parseEther("8000000000");

    if (fairLaunchBalance !== expected40B) throw new Error(`FairLaunch balance: ${formatEther(fairLaunchBalance)}, expected 40B`);
    if (vestingBalance !== expected52B) throw new Error(`Vesting balance: ${formatEther(vestingBalance)}, expected 52B`);
    if (treasuryBalance !== expected8B) throw new Error(`Treasury balance: ${formatEther(treasuryBalance)}, expected 8B`);

    pass("Preflight passed", `owner=${signer.address}, balance=${formatEther(balance)} ETH, state=NOT_STARTED, balances=40B/52B/8B`);
  } catch (e) {
    fail("Preflight checks", e);
    printSummary();
    process.exit(1);
  }

  // ==============================
  // Step 2: Start sale
  // ==============================
  logStep("Start sale");

  try {
    console.log("  Sending startSale()...");
    const tx = await fairLaunch.startSale();
    console.log(`  TX hash: ${tx.hash}`);
    const receipt = await tx.wait(2);

    const state = await fairLaunch.saleState();
    if (Number(state) !== 1) throw new Error(`Expected state=ACTIVE(1), got ${state}`);

    pass("Sale started", `state=ACTIVE`, tx.hash);
  } catch (e) {
    fail("Start sale", e);
    // Can't continue without an active sale
    printSummary();
    process.exit(1);
  }

  // ==============================
  // Step 3: Get quote for 0.05 ETH
  // ==============================
  logStep("Get quote for 0.05 ETH");

  try {
    const quote = await fairLaunch.getQuote(parseEther("0.05"));
    const tokensReceivable = quote[0];
    const ethRequired = quote[1];
    const tierIndex = quote[2];

    console.log(`  Tokens receivable: ${formatEther(tokensReceivable)} RATE`);
    console.log(`  ETH required: ${formatEther(ethRequired)} ETH`);
    console.log(`  Tier index: ${tierIndex}`);

    if (tokensReceivable <= 0n) throw new Error("Quote returned 0 tokens");
    if (Number(tierIndex) !== 0) throw new Error(`Expected tier 0, got ${tierIndex}`);

    pass("Quote received", `${formatEther(tokensReceivable)} RATE for ${formatEther(ethRequired)} ETH at Tier ${tierIndex}`);
  } catch (e) {
    fail("Get quote", e);
  }

  // ==============================
  // Step 4: Contribute 0.05 ETH
  // ==============================
  logStep("Contribute 0.05 ETH");

  try {
    console.log("  Sending contribute() with 0.05 ETH...");
    const tx = await fairLaunch.contribute({ value: parseEther("0.05") });
    console.log(`  TX hash: ${tx.hash}`);
    const receipt = await tx.wait(2);

    const contrib = await fairLaunch.getContribution(signer.address);
    console.log(`  Contribution ETH: ${formatEther(contrib[0])}`);
    console.log(`  Contribution RATE: ${formatEther(contrib[1])}`);

    if (contrib[0] !== parseEther("0.05")) throw new Error("ETH contribution mismatch");
    if (contrib[1] <= 0n) throw new Error("No tokens tracked");

    pass("Contribution recorded", `${formatEther(contrib[0])} ETH -> ${formatEther(contrib[1])} RATE`, tx.hash);
  } catch (e) {
    fail("Contribute", e);
  }

  // ==============================
  // Step 5: Verify sale stats
  // ==============================
  logStep("Verify sale state");

  try {
    const stats = await fairLaunch.getSaleStats();
    const tierInfo = await fairLaunch.getCurrentTierInfo();
    const contrib = await fairLaunch.getContribution(signer.address);

    console.log(`  Sale state: ${stats[0]}`);
    console.log(`  ETH raised: ${formatEther(stats[1])}`);
    console.log(`  Tokens sold: ${formatEther(stats[2])}`);
    console.log(`  Contributors: ${stats[3]}`);
    console.log(`  Current tier: ${stats[4]}`);
    console.log(`  Tier price: ${formatEther(tierInfo[1])} ETH/1M`);
    console.log(`  Tier remaining: ${formatEther(tierInfo[4])} RATE`);

    if (Number(stats[0]) !== 1) throw new Error(`Expected state 1, got ${stats[0]}`);
    if (stats[1] !== parseEther("0.05")) throw new Error("ETH raised mismatch");
    if (Number(stats[3]) !== 1) throw new Error(`Expected 1 contributor, got ${stats[3]}`);

    pass("State verified", `1 contributor, ${formatEther(stats[1])} ETH raised, ${formatEther(stats[2])} RATE sold`);
  } catch (e) {
    fail("Verify state", e);
  }

  // ==============================
  // Step 6: Cancel sale
  // ==============================
  logStep("Cancel sale");

  try {
    console.log('  Sending cancel("Sepolia smoke test")...');
    const tx = await fairLaunch.cancel("Sepolia smoke test");
    console.log(`  TX hash: ${tx.hash}`);
    await tx.wait(2);

    const state = await fairLaunch.saleState();
    if (Number(state) !== 4) throw new Error(`Expected state=CANCELLED(4), got ${state}`);

    pass("Sale cancelled", `state=CANCELLED`, tx.hash);
  } catch (e) {
    fail("Cancel sale", e);
  }

  // ==============================
  // Step 7: Claim refund
  // ==============================
  logStep("Claim refund");

  try {
    const balanceBefore = await ethers.provider.getBalance(signer.address);

    console.log("  Sending claimRefund()...");
    const tx = await fairLaunch.claimRefund();
    console.log(`  TX hash: ${tx.hash}`);
    const receipt = await tx.wait(2);

    const balanceAfter = await ethers.provider.getBalance(signer.address);
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const netRefund = balanceAfter - balanceBefore + gasCost;

    console.log(`  Refund amount: ${formatEther(netRefund)} ETH`);
    console.log(`  Gas cost: ${formatEther(gasCost)} ETH`);

    // Refund should be ~0.05 ETH
    if (netRefund < parseEther("0.049")) throw new Error(`Refund too low: ${formatEther(netRefund)}`);

    // Verify refund claimed
    const contrib = await fairLaunch.getContribution(signer.address);
    if (!contrib[2]) throw new Error("refundClaimed should be true");

    pass("Refund claimed", `${formatEther(netRefund)} ETH returned`, tx.hash);
  } catch (e) {
    fail("Claim refund", e);
  }

  // ==============================
  // Step 8: Final summary
  // ==============================
  logStep("Final summary");

  try {
    const finalState = await fairLaunch.saleState();
    const ethBalance = await ethers.provider.getBalance(ADDRESSES.fairLaunch);
    const signerBalance = await ethers.provider.getBalance(signer.address);

    console.log(`  Final sale state: ${finalState} (CANCELLED)`);
    console.log(`  FairLaunch ETH balance: ${formatEther(ethBalance)}`);
    console.log(`  Signer ETH balance: ${formatEther(signerBalance)}`);
    console.log(`\n  NOTE: Sepolia deployment is now in CANCELLED state.`);
    console.log(`  This is expected - the refund path is a critical flow to test.`);
    console.log(`  Redeploy for further testing if needed.`);

    pass("Smoke test complete", "All transactions confirmed on Sepolia");
  } catch (e) {
    fail("Final summary", e);
  }

  // ==============================
  // Print results
  // ==============================
  const allPassed = printSummary();
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("\nUnhandled error:", error);
  process.exit(1);
});
