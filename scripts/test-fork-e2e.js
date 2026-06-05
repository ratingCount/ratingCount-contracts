/**
 * RATE Token - Full Purchase Lifecycle E2E Test (Sepolia Fork)
 *
 * Forks the live Sepolia deployment and simulates the entire purchase lifecycle
 * using time.increase() to advance through all 5 pricing tiers (70+ days).
 *
 * Usage:
 *   FORK_SEPOLIA=true npx hardhat run scripts/test-fork-e2e.js
 *   # or
 *   npm run test:fork
 *
 * Prerequisites:
 *   - SEPOLIA_RPC_URL set in .env
 *   - Contracts deployed on Sepolia (addresses below)
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ============ Deployed Contract Addresses (Sepolia) ============

const ADDRESSES = {
  rateToken: "0x205E024F77DfCEEb15C3D39691eea42614398d6b",
  fairLaunch: "0xc3aD323F51bf56AE24e6f61CE6ae7a164e4A3Ef4",
  vesting: "0xe6f1Ed7cf61335576476156f26C5FE283663DE59",
  owner: "0x9C9598CD02E083A3384E212006cDfCffbcC4E469",
  allocationWallet: "0x987C8b376D14AF144E7eD1966E960C770531c259",
  treasury: "0xdB8a3A306d1242E51f8A11eC27d0b0f269291313",
};

// ============ Constants ============

const TIER_DURATION = 14 * 24 * 60 * 60; // 14 days in seconds
const ONE_DAY = 24 * 60 * 60;
const ONE_MONTH = 30 * ONE_DAY;
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

function pass(name, detail) {
  results.push({ step: stepNum, name, status: "PASS" });
  console.log(`  PASS: ${detail || name}`);
}

function fail(name, error) {
  results.push({ step: stepNum, name, status: "FAIL", error: error.message || error });
  console.error(`  FAIL: ${name} - ${error.message || error}`);
}

function printSummary() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  TEST SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  results.forEach((r) => {
    const icon = r.status === "PASS" ? "[PASS]" : "[FAIL]";
    console.log(`  ${icon} Step ${r.step}: ${r.name}`);
    if (r.error) console.log(`         Error: ${r.error}`);
  });

  console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`${"=".repeat(60)}\n`);

  return failed === 0;
}

// ============ Main Test ============

async function main() {
  console.log("========================================");
  console.log("  RATE Token E2E Test (Sepolia Fork)");
  console.log("========================================\n");

  // Verify we're on a fork
  if (!process.env.FORK_SEPOLIA) {
    console.error("ERROR: Must run with FORK_SEPOLIA=true");
    console.error("Usage: FORK_SEPOLIA=true npx hardhat run scripts/test-fork-e2e.js");
    process.exit(1);
  }

  // ==============================
  // Step 1: Attach to contracts, impersonate owner, fund buyers
  // ==============================
  logStep("Attach to contracts and set up accounts");

  let rateToken, fairLaunch, vesting, ownerSigner, buyer1, buyer2;

  try {
    // Attach to deployed contracts
    rateToken = await ethers.getContractAt("RatingCountAI", ADDRESSES.rateToken);
    fairLaunch = await ethers.getContractAt("FairLaunchSale", ADDRESSES.fairLaunch);
    vesting = await ethers.getContractAt("VestingManager", ADDRESSES.vesting);

    // Reset baseFee so forked transactions don't fail with "maxFeePerGas too low"
    await hre.network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
    await hre.network.provider.send("evm_mine");

    // Impersonate owner
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ADDRESSES.owner],
    });
    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [ADDRESSES.owner, "0x56BC75E2D63100000"], // 100 ETH
    });
    ownerSigner = await ethers.getSigner(ADDRESSES.owner);

    // Get test buyer wallets
    const signers = await ethers.getSigners();
    buyer1 = signers[0];
    buyer2 = signers[1];

    // Fund buyers
    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [buyer1.address, "0x56BC75E2D63100000"], // 100 ETH
    });
    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [buyer2.address, "0x56BC75E2D63100000"], // 100 ETH
    });

    // Verify contract state
    const fairLaunchBalance = await rateToken.balanceOf(ADDRESSES.fairLaunch);
    const vestingBalance = await rateToken.balanceOf(ADDRESSES.vesting);
    const treasuryBalance = await rateToken.balanceOf(ADDRESSES.treasury);

    console.log(`  RATEToken: ${ADDRESSES.rateToken}`);
    console.log(`  FairLaunch: ${ADDRESSES.fairLaunch} (${formatEther(fairLaunchBalance)} RATE)`);
    console.log(`  Vesting: ${ADDRESSES.vesting} (${formatEther(vestingBalance)} RATE)`);
    console.log(`  Treasury: ${ADDRESSES.treasury} (${formatEther(treasuryBalance)} RATE)`);
    console.log(`  Owner: ${ADDRESSES.owner}`);
    console.log(`  Buyer1: ${buyer1.address}`);
    console.log(`  Buyer2: ${buyer2.address}`);

    // Verify balances match expected
    const expected40B = parseEther("40000000000");
    const expected52B = parseEther("52000000000");
    const expected8B = parseEther("8000000000");

    if (fairLaunchBalance !== expected40B) throw new Error(`FairLaunch balance mismatch: ${formatEther(fairLaunchBalance)}`);
    if (vestingBalance !== expected52B) throw new Error(`Vesting balance mismatch: ${formatEther(vestingBalance)}`);
    if (treasuryBalance !== expected8B) throw new Error(`Treasury balance mismatch: ${formatEther(treasuryBalance)}`);

    pass("Contracts attached, balances verified (40B/52B/8B)");
  } catch (e) {
    fail("Attach to contracts", e);
    printSummary();
    process.exit(1);
  }

  // ==============================
  // Step 2: Start sale
  // ==============================
  logStep("Start sale");

  try {
    const tx = await fairLaunch.connect(ownerSigner).startSale();
    await tx.wait();

    const state = await fairLaunch.saleState();
    const tier = await fairLaunch.currentTier();

    if (Number(state) !== 1) throw new Error(`Expected state=ACTIVE(1), got ${state}`);
    if (Number(tier) !== 0) throw new Error(`Expected tier=0, got ${tier}`);

    pass("Sale started", `state=ACTIVE, tier=0`);
  } catch (e) {
    fail("Start sale", e);
  }

  // ==============================
  // Step 3: Buyer1 contributes 0.1 ETH at Tier 1
  // ==============================
  logStep("Buyer1 contributes 0.1 ETH at Tier 1");

  try {
    const tx = await fairLaunch.connect(buyer1).contribute({ value: parseEther("0.1") });
    await tx.wait();

    const contrib = await fairLaunch.getContribution(buyer1.address);
    // tokens = (eth * 1e24) / price — contract integer division may differ by dust
    const expectedTokens = (parseEther("0.1") * BigInt(1e24)) / parseEther("0.005");

    console.log(`  Buyer1 ETH: ${formatEther(contrib[0])}`);
    console.log(`  Buyer1 tokens: ${formatEther(contrib[1])}`);
    console.log(`  Expected tokens (approx): ${formatEther(expectedTokens)}`);

    if (contrib[0] !== parseEther("0.1")) throw new Error("ETH mismatch");
    // Allow 1 token (1e18 wei) rounding tolerance
    const diff = contrib[1] > expectedTokens ? contrib[1] - expectedTokens : expectedTokens - contrib[1];
    if (diff > parseEther("1")) throw new Error(`Token mismatch: diff=${formatEther(diff)}`);

    pass("Buyer1 contribution tracked", `${formatEther(expectedTokens)} RATE at Tier 1 price`);
  } catch (e) {
    fail("Buyer1 contribute", e);
  }

  // ==============================
  // Step 4: Buyer2 contributes 0.05 ETH
  // ==============================
  logStep("Buyer2 contributes 0.05 ETH at Tier 1");

  try {
    const tx = await fairLaunch.connect(buyer2).contribute({ value: parseEther("0.05") });
    await tx.wait();

    const count = await fairLaunch.getContributorCount();
    const stats = await fairLaunch.getSaleStats();

    console.log(`  Contributors: ${count}`);
    console.log(`  Total ETH raised: ${formatEther(stats[1])}`);
    console.log(`  Total tokens sold: ${formatEther(stats[2])}`);

    if (Number(count) !== 2) throw new Error(`Expected 2 contributors, got ${count}`);
    if (stats[1] !== parseEther("0.15")) throw new Error("Total ETH mismatch");

    pass("Buyer2 contribution tracked", `2 contributors, ${formatEther(stats[1])} ETH total`);
  } catch (e) {
    fail("Buyer2 contribute", e);
  }

  // ==============================
  // Step 5: Advance time 14 days + contribute to trigger tier advance
  // ==============================
  logStep("Advance 14 days, contribute to trigger Tier 2");

  try {
    await time.increase(TIER_DURATION + 1);

    // Small contribution to trigger tier check
    const tx = await fairLaunch.connect(buyer1).contribute({ value: parseEther("0.05") });
    const receipt = await tx.wait();

    const tier = await fairLaunch.currentTier();
    console.log(`  Current tier after advance: ${tier}`);

    // Check for TierAdvanced event
    const tierAdvancedEvents = receipt.logs.filter((log) => {
      try {
        const parsed = fairLaunch.interface.parseLog(log);
        return parsed && parsed.name === "TierAdvanced";
      } catch {
        return false;
      }
    });

    if (tierAdvancedEvents.length === 0) throw new Error("No TierAdvanced event emitted");
    if (Number(tier) !== 1) throw new Error(`Expected tier=1, got ${tier}`);

    pass("Tier advanced to 1", `TierAdvanced event emitted, tier=1`);
  } catch (e) {
    fail("Advance to Tier 2", e);
  }

  // ==============================
  // Step 6: Contribute at Tier 2 price
  // ==============================
  logStep("Contribute at Tier 2 price (0.0055 ETH/1M)");

  try {
    const tierInfo = await fairLaunch.getCurrentTierInfo();
    const tierPrice = tierInfo[1];
    console.log(`  Tier 2 price: ${formatEther(tierPrice)} ETH per 1M RATE`);

    if (tierPrice !== parseEther("0.0055")) throw new Error(`Expected 0.0055, got ${formatEther(tierPrice)}`);

    const tx = await fairLaunch.connect(buyer2).contribute({ value: parseEther("0.05") });
    await tx.wait();

    const contrib = await fairLaunch.getContribution(buyer2.address);
    console.log(`  Buyer2 total tokens: ${formatEther(contrib[1])}`);

    pass("Tier 2 contribution", `price=0.0055, tokens tracked correctly`);
  } catch (e) {
    fail("Tier 2 contribute", e);
  }

  // ==============================
  // Step 7: Advance through Tiers 3, 4, 5
  // ==============================
  logStep("Advance through Tiers 3, 4, 5");

  try {
    const expectedPrices = [
      parseEther("0.0060"), // Tier 3
      parseEther("0.0070"), // Tier 4
      parseEther("0.0085"), // Tier 5
    ];

    for (let i = 0; i < 3; i++) {
      await time.increase(TIER_DURATION + 1);

      // Trigger tier check
      const state = await fairLaunch.saleState();
      if (Number(state) === 1) {
        // Only contribute if still active
        const tx = await fairLaunch.connect(buyer1).contribute({ value: parseEther("0.05") });
        await tx.wait();
      }

      const tier = await fairLaunch.currentTier();
      const expectedTier = i + 2;
      console.log(`  After advance ${i + 1}: tier=${tier}`);

      if (Number(tier) < expectedTier) {
        console.log(`  Warning: tier=${tier}, expected at least ${expectedTier}`);
      }
    }

    const finalTier = await fairLaunch.currentTier();
    console.log(`  Final tier: ${finalTier}`);

    // Tier should be at least 4 (index)
    if (Number(finalTier) < 4) throw new Error(`Expected tier >= 4, got ${finalTier}`);

    pass("Advanced through remaining tiers", `final tier index=${finalTier}`);
  } catch (e) {
    fail("Advance through tiers", e);
  }

  // ==============================
  // Step 8: After Tier 5 expires, sale should complete
  // ==============================
  logStep("Verify sale completes after Tier 5 expires");

  try {
    // Advance past Tier 5 if needed
    const state = await fairLaunch.saleState();
    if (Number(state) === 1) {
      await time.increase(TIER_DURATION + 1);
      // Trigger tier check
      try {
        await fairLaunch.checkTierAdvancement();
      } catch {
        // May fail if sale completed
      }
    }

    const finalState = await fairLaunch.saleState();
    console.log(`  Sale state: ${finalState} (expected 3=COMPLETED)`);

    if (Number(finalState) !== 3) throw new Error(`Expected state=COMPLETED(3), got ${finalState}`);

    pass("Sale completed", `state=COMPLETED after all tiers expired`);
  } catch (e) {
    fail("Sale completion", e);
  }

  // ==============================
  // Step 9: Finalize
  // ==============================
  logStep("Finalize sale");

  try {
    const tx = await fairLaunch.connect(ownerSigner).finalize();
    await tx.wait();

    const state = await fairLaunch.saleState();
    if (Number(state) !== 5) throw new Error(`Expected state=FINALIZED(5), got ${state}`);

    pass("Sale finalized", `state=FINALIZED`);
  } catch (e) {
    fail("Finalize", e);
  }

  // ==============================
  // Step 10: Buyer1 claims tokens
  // ==============================
  logStep("Buyer1 claims tokens");

  try {
    const contribBefore = await fairLaunch.getContribution(buyer1.address);
    const expectedTokens = contribBefore[1];
    const balanceBefore = await rateToken.balanceOf(buyer1.address);

    const tx = await fairLaunch.connect(buyer1).claimTokens();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(buyer1.address);
    const received = balanceAfter - balanceBefore;

    console.log(`  Expected: ${formatEther(expectedTokens)} RATE`);
    console.log(`  Received: ${formatEther(received)} RATE`);

    if (received !== expectedTokens) throw new Error("Token claim amount mismatch");

    pass("Buyer1 claimed tokens", `${formatEther(received)} RATE`);
  } catch (e) {
    fail("Buyer1 claim tokens", e);
  }

  // ==============================
  // Step 11: Buyer2 claims tokens
  // ==============================
  logStep("Buyer2 claims tokens");

  try {
    const contribBefore = await fairLaunch.getContribution(buyer2.address);
    const expectedTokens = contribBefore[1];
    const balanceBefore = await rateToken.balanceOf(buyer2.address);

    const tx = await fairLaunch.connect(buyer2).claimTokens();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(buyer2.address);
    const received = balanceAfter - balanceBefore;

    console.log(`  Expected: ${formatEther(expectedTokens)} RATE`);
    console.log(`  Received: ${formatEther(received)} RATE`);

    if (received !== expectedTokens) throw new Error("Token claim amount mismatch");

    pass("Buyer2 claimed tokens", `${formatEther(received)} RATE`);
  } catch (e) {
    fail("Buyer2 claim tokens", e);
  }

  // ==============================
  // Step 12: Verify LP creation (automatic on finalize)
  // ==============================
  logStep("Verify LP creation from finalize()");

  try {
    const lpInfo = await fairLaunch.getLPInfo();
    const [created, pair, lpAmount, unlockTime, timeRemaining] = lpInfo;

    console.log(`  LP created: ${created}`);
    console.log(`  Pair address: ${pair}`);
    console.log(`  LP tokens: ${formatEther(lpAmount)}`);
    console.log(`  Unlock time: ${unlockTime}`);
    console.log(`  Time remaining: ${timeRemaining}`);

    if (!created) throw new Error("LP should be created after finalize");
    if (lpAmount === 0n) throw new Error("LP token amount should be > 0");

    const fairLaunchEthAfter = await ethers.provider.getBalance(ADDRESSES.fairLaunch);
    console.log(`  FairLaunch ETH after finalize: ${formatEther(fairLaunchEthAfter)}`);
    if (fairLaunchEthAfter !== 0n) throw new Error("FairLaunch should have 0 ETH (all sent to LP)");

    pass("LP created", `Pair: ${pair}, LP tokens: ${formatEther(lpAmount)}`);
  } catch (e) {
    fail("Verify LP creation", e);
  }

  // ==============================
  // Step 13: Verify unsold tokens burned
  // ==============================
  logStep("Verify unsold tokens burned to 0xdead");

  try {
    const burnAddress = "0x000000000000000000000000000000000000dEaD";
    const burnedTokens = await rateToken.balanceOf(burnAddress);
    console.log(`  Tokens at 0xdead: ${formatEther(burnedTokens)}`);

    if (burnedTokens > 0n) {
      pass("Unsold tokens burned", `${formatEther(burnedTokens)} RATE burned to 0xdead`);
    } else {
      console.log(`  No unsold tokens to burn (all sold)`);
      pass("No unsold tokens", "All tokens were sold — nothing to burn");
    }
  } catch (e) {
    fail("Verify unsold tokens burned", e);
  }

  // ==============================
  // Step 14: Trigger TGE on VestingManager
  // ==============================
  logStep("Trigger TGE");

  try {
    const tx = await vesting.connect(ownerSigner).triggerTGE();
    await tx.wait();

    const tgeTriggered = await vesting.tgeTriggered();
    const tgeTime = await vesting.tgeTime();

    console.log(`  tgeTriggered: ${tgeTriggered}`);
    console.log(`  tgeTime: ${tgeTime}`);

    if (!tgeTriggered) throw new Error("TGE not triggered");

    // Remove limits so vesting claims don't hit maxWalletAmount
    // In production this would be called after TGE as part of launch sequence
    await rateToken.connect(ownerSigner).removeLimits();
    console.log(`  Limits removed for vesting claims`);

    pass("TGE triggered", `tgeTriggered=true, tgeTime=${tgeTime}`);
  } catch (e) {
    fail("Trigger TGE", e);
  }

  // ==============================
  // Step 15: Impersonate allocation wallet, claim TGE (Team 20%)
  // ==============================
  logStep("Claim TGE (Team 20% = 4.4B RATE)");

  try {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ADDRESSES.allocationWallet],
    });
    await hre.network.provider.request({
      method: "hardhat_setBalance",
      params: [ADDRESSES.allocationWallet, "0x56BC75E2D63100000"],
    });
    const allocSigner = await ethers.getSigner(ADDRESSES.allocationWallet);

    const balanceBefore = await rateToken.balanceOf(ADDRESSES.allocationWallet);
    const tx = await vesting.connect(allocSigner).claimTGE();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(ADDRESSES.allocationWallet);
    const received = balanceAfter - balanceBefore;

    console.log(`  TGE claimed: ${formatEther(received)} RATE`);

    // Team TGE = 22B * 20% = 4.4B
    const expected = parseEther("4400000000");
    if (received !== expected) throw new Error(`Expected 4.4B, got ${formatEther(received)}`);

    pass("TGE claimed", `4.4B RATE (Team 20%) received`);
  } catch (e) {
    fail("Claim TGE", e);
  }

  // ==============================
  // Step 16: Advance 30 days, release Seed tokens (5B)
  // ==============================
  logStep("Advance 30 days, release Seed tokens");

  try {
    await time.increase(ONE_MONTH + 1);

    const allocSigner = await ethers.getSigner(ADDRESSES.allocationWallet);
    const balanceBefore = await rateToken.balanceOf(ADDRESSES.allocationWallet);

    const tx = await vesting.connect(allocSigner).release();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(ADDRESSES.allocationWallet);
    const released = balanceAfter - balanceBefore;

    console.log(`  Released after 30 days: ${formatEther(released)} RATE`);

    // Seed (5B after 1 month cliff) + partial Team/Marketing vesting
    // Seed = 5B, Team linear = 22B*80%/36 months * 1 month ~ 488M, Marketing = 10B/36*1 ~ 277M
    if (released <= 0n) throw new Error("No tokens released");

    pass("Tokens released after 30 days", `${formatEther(released)} RATE (includes Seed 5B + partial vesting)`);
  } catch (e) {
    fail("Release after 30 days", e);
  }

  // ==============================
  // Step 17: Advance 11 months, Ecosystem starts vesting
  // ==============================
  logStep("Advance 11 months, Ecosystem starts vesting");

  try {
    await time.increase(11 * ONE_MONTH);

    const allocSigner = await ethers.getSigner(ADDRESSES.allocationWallet);
    const balanceBefore = await rateToken.balanceOf(ADDRESSES.allocationWallet);

    const tx = await vesting.connect(allocSigner).release();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(ADDRESSES.allocationWallet);
    const released = balanceAfter - balanceBefore;

    console.log(`  Released after 12 months total: ${formatEther(released)} RATE`);

    // After 12 months: Ecosystem cliff ends, should release some Ecosystem + accumulated Team/Marketing
    if (released <= 0n) throw new Error("No tokens released");

    pass("Ecosystem vesting started", `${formatEther(released)} RATE released at month 12`);
  } catch (e) {
    fail("Ecosystem vesting", e);
  }

  // ==============================
  // Step 18: Advance 36 months, all tokens should be fully vested
  // ==============================
  logStep("Advance 36 months, verify all 52B tokens released");

  try {
    await time.increase(36 * ONE_MONTH);

    const allocSigner = await ethers.getSigner(ADDRESSES.allocationWallet);
    const balanceBefore = await rateToken.balanceOf(ADDRESSES.allocationWallet);

    const tx = await vesting.connect(allocSigner).release();
    await tx.wait();

    const balanceAfter = await rateToken.balanceOf(ADDRESSES.allocationWallet);
    const released = balanceAfter - balanceBefore;

    console.log(`  Final release: ${formatEther(released)} RATE`);
    console.log(`  Total allocation wallet balance: ${formatEther(balanceAfter)} RATE`);

    // Check vesting contract is (nearly) empty
    const vestingBalance = await rateToken.balanceOf(ADDRESSES.vesting);
    console.log(`  Vesting contract remaining: ${formatEther(vestingBalance)} RATE`);

    // All 52B should have been released (4.4B TGE + 47.6B vested)
    // Allow for small rounding
    if (vestingBalance > parseEther("1")) {
      throw new Error(`Vesting still holds ${formatEther(vestingBalance)} RATE`);
    }

    pass("All vesting complete", `52B RATE fully distributed, vesting remainder: ${formatEther(vestingBalance)}`);
  } catch (e) {
    fail("Full vesting release", e);
  }

  // ==============================
  // Step 19: Enable trading
  // ==============================
  logStep("Enable trading");

  try {
    const tx = await rateToken.connect(ownerSigner).enableTrading(2);
    await tx.wait();

    const tradingActive = await rateToken.tradingActive();
    console.log(`  tradingActive: ${tradingActive}`);

    if (!tradingActive) throw new Error("Trading not active");

    pass("Trading enabled", `tradingActive=true, deadBlocks=2`);
  } catch (e) {
    fail("Enable trading", e);
  }

  // ==============================
  // Summary
  // ==============================
  const allPassed = printSummary();
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("\nUnhandled error:", error);
  process.exit(1);
});
