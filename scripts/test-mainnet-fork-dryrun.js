/**
 * RATE Token - Mainnet Fork Dry Run
 *
 * Deploys fresh contracts on a mainnet fork and runs the full lifecycle:
 *   deploy -> startSale -> contribute (3.2 ETH cap) -> finalize (LP) ->
 *   claimTokens (verify no maxWalletAmount issue) -> enableTrading ->
 *   trade on Uniswap -> triggerTGE
 *
 * Usage:
 *   FORK_MAINNET=true npx hardhat run scripts/test-mainnet-fork-dryrun.js
 *
 * Prerequisites:
 *   - MAINNET_RPC_URL set in .env (Alchemy/Infura)
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ============ Constants ============

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const TIER_DURATION = 14 * 24 * 60 * 60; // 14 days
const formatEther = ethers.formatEther;
const parseEther = ethers.parseEther;

// ============ Test Tracking ============

const results = [];
let stepNum = 0;
let totalGas = 0n;

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

async function trackGas(tx, label) {
  const receipt = await tx.wait();
  const gasUsed = receipt.gasUsed;
  totalGas += gasUsed;
  console.log(`    Gas used (${label}): ${gasUsed.toLocaleString()}`);
  return receipt;
}

function printSummary() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  DRY RUN SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  results.forEach((r) => {
    const icon = r.status === "PASS" ? "[PASS]" : "[FAIL]";
    console.log(`  ${icon} Step ${r.step}: ${r.name}`);
    if (r.error) console.log(`         Error: ${r.error}`);
  });

  // Gas cost estimates
  const gasAt20 = totalGas * 20n * 1000000000n;
  const gasAt50 = totalGas * 50n * 1000000000n;

  console.log(`\n  Total gas used: ${totalGas.toLocaleString()}`);
  console.log(`  Estimated cost @20 gwei: ${formatEther(gasAt20)} ETH`);
  console.log(`  Estimated cost @50 gwei: ${formatEther(gasAt50)} ETH`);
  console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`${"=".repeat(60)}\n`);

  return failed === 0;
}

// ============ Main ============

async function main() {
  console.log("========================================");
  console.log("  RATE Token Mainnet Fork Dry Run");
  console.log("  (New 3.2 ETH contribution limits)");
  console.log("========================================\n");

  const [deployer, buyer1, buyer2, buyer3, buyer4, buyer5, treasury] =
    await ethers.getSigners();

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Buyer1:   ${buyer1.address}`);
  console.log(`Buyer2:   ${buyer2.address}`);

  // ==============================
  // Step 1: Deploy all 3 contracts
  // ==============================
  logStep("Deploy RATEToken, FairLaunchSale, VestingManager");

  let rateToken, fairLaunch, vesting;

  try {
    // Deploy RATEToken
    const RATEToken = await ethers.getContractFactory("RatingCountAI");
    rateToken = await RATEToken.deploy(UNISWAP_V2_ROUTER);
    await rateToken.waitForDeployment();
    console.log(`    RATEToken: ${await rateToken.getAddress()}`);

    // Deploy FairLaunchSale
    const FairLaunchSale = await ethers.getContractFactory("FairLaunchSale");
    fairLaunch = await FairLaunchSale.deploy(
      await rateToken.getAddress(),
      UNISWAP_V2_ROUTER
    );
    await fairLaunch.waitForDeployment();
    console.log(`    FairLaunchSale: ${await fairLaunch.getAddress()}`);

    // Deploy VestingManager
    const VestingManager = await ethers.getContractFactory("VestingManager");
    vesting = await VestingManager.deploy(await rateToken.getAddress());
    await vesting.waitForDeployment();
    console.log(`    VestingManager: ${await vesting.getAddress()}`);

    // Verify contribution limits
    const maxTx = await fairLaunch.MAX_CONTRIBUTION_PER_TX();
    const maxWallet = await fairLaunch.MAX_CONTRIBUTION_PER_WALLET();
    console.log(`    MAX_CONTRIBUTION_PER_TX: ${formatEther(maxTx)} ETH`);
    console.log(`    MAX_CONTRIBUTION_PER_WALLET: ${formatEther(maxWallet)} ETH`);

    if (maxTx !== parseEther("3.2")) throw new Error("MAX_CONTRIBUTION_PER_TX not 3.2");
    if (maxWallet !== parseEther("3.2")) throw new Error("MAX_CONTRIBUTION_PER_WALLET not 3.2");

    pass("All 3 contracts deployed, limits verified (3.2 ETH)");
  } catch (e) {
    fail("Deploy contracts", e);
    printSummary();
    process.exit(1);
  }

  // ==============================
  // Step 2: Distribute tokens (40B/52B/8B)
  // ==============================
  logStep("Distribute tokens via distributeTokens()");

  try {
    const tx = await rateToken.distributeTokens(
      await fairLaunch.getAddress(),  // publicSale → 40B
      await vesting.getAddress(),     // team → 22B
      await vesting.getAddress(),     // ecosystem → 15B
      await vesting.getAddress(),     // marketing → 10B
      treasury.address,               // treasury → 8B
      await vesting.getAddress()      // seed → 5B
    );
    await trackGas(tx, "distributeTokens");

    const flBalance = await rateToken.balanceOf(await fairLaunch.getAddress());
    const vmBalance = await rateToken.balanceOf(await vesting.getAddress());
    const trBalance = await rateToken.balanceOf(treasury.address);

    console.log(`    FairLaunch: ${formatEther(flBalance)} RATE`);
    console.log(`    Vesting:    ${formatEther(vmBalance)} RATE`);
    console.log(`    Treasury:   ${formatEther(trBalance)} RATE`);

    if (flBalance !== parseEther("40000000000")) throw new Error("FairLaunch balance wrong");
    if (vmBalance !== parseEther("52000000000")) throw new Error("Vesting balance wrong");
    if (trBalance !== parseEther("8000000000")) throw new Error("Treasury balance wrong");

    pass("Token distribution verified (40B/52B/8B)");
  } catch (e) {
    fail("Distribute tokens", e);
  }

  // ==============================
  // Step 3: Configure vesting
  // ==============================
  logStep("Configure vesting schedules");

  try {
    const tx = await vesting.configureVesting(
      deployer.address, // team
      deployer.address, // ecosystem
      deployer.address, // marketing
      deployer.address  // seed
    );
    await trackGas(tx, "configureVesting");
    pass("Vesting configured (all wallets = deployer for testing)");
  } catch (e) {
    fail("Configure vesting", e);
  }

  // ==============================
  // Step 4: Start sale
  // ==============================
  logStep("Start sale");

  try {
    const tx = await fairLaunch.startSale();
    await trackGas(tx, "startSale");

    const state = await fairLaunch.saleState();
    if (Number(state) !== 1) throw new Error(`Expected ACTIVE(1), got ${state}`);

    pass("Sale started", "state=ACTIVE");
  } catch (e) {
    fail("Start sale", e);
  }

  // ==============================
  // Step 5: Contribute with multiple wallets (3.2 ETH each)
  // ==============================
  logStep("Contribute from 5 wallets (3.2 ETH each = 16 ETH total)");

  try {
    const buyers = [buyer1, buyer2, buyer3, buyer4, buyer5];

    for (let i = 0; i < buyers.length; i++) {
      const tx = await fairLaunch.connect(buyers[i]).contribute({
        value: parseEther("3.2"),
      });
      await tx.wait();
    }

    const stats = await fairLaunch.getSaleStats();
    console.log(`    Total ETH raised: ${formatEther(stats[1])}`);
    console.log(`    Total tokens sold: ${formatEther(stats[2])}`);
    console.log(`    Contributors: ${stats[3]}`);

    if (stats[1] !== parseEther("16")) throw new Error("Total ETH mismatch");
    if (Number(stats[3]) !== 5) throw new Error("Contributor count mismatch");

    // Verify wallet cap enforcement
    try {
      await fairLaunch.connect(buyer1).contribute({ value: parseEther("0.05") });
      throw new Error("Should have reverted — buyer1 already at 3.2 ETH cap");
    } catch (e) {
      if (!e.message.includes("Above max per wallet")) throw e;
      console.log(`    Wallet cap enforced: buyer1 rejected at 3.2 ETH`);
    }

    // Verify buyer1 tokens: 3.2 ETH at T1 (0.008/1M) = 400M tokens
    const contrib = await fairLaunch.getContribution(buyer1.address);
    const expectedTokens = parseEther("400000000"); // 400M
    if (contrib[1] !== expectedTokens) {
      throw new Error(`Token mismatch: expected 400M, got ${formatEther(contrib[1])}`);
    }
    console.log(`    Buyer1 tokens: ${formatEther(contrib[1])} RATE (400M expected)`);

    pass("5 wallets contributed 3.2 ETH each, cap enforced, 400M tokens per wallet");
  } catch (e) {
    fail("Contribute", e);
  }

  // ==============================
  // Step 6: Verify maxWalletAmount compatibility
  // ==============================
  logStep("Verify maxWalletAmount compatibility (400M < 1B limit)");

  try {
    const maxWalletAmount = await rateToken.maxWalletAmount();
    const maxSellAmount = await rateToken.maxSellAmount();
    const tokensPerWallet = parseEther("400000000"); // 400M max at 3.2 ETH, T1

    console.log(`    maxWalletAmount: ${formatEther(maxWalletAmount)} RATE`);
    console.log(`    maxSellAmount:   ${formatEther(maxSellAmount)} RATE`);
    console.log(`    Max tokens/wallet: ${formatEther(tokensPerWallet)} RATE`);

    if (tokensPerWallet >= maxWalletAmount) {
      throw new Error("CRITICAL: tokens per wallet >= maxWalletAmount! Claims will fail!");
    }
    if (tokensPerWallet >= maxSellAmount) {
      throw new Error("WARNING: tokens per wallet >= maxSellAmount! Sells may fail!");
    }

    console.log(`    400M < ${formatEther(maxWalletAmount)} (maxWallet) -- SAFE`);
    console.log(`    400M < ${formatEther(maxSellAmount)} (maxSell) -- SAFE`);

    pass("maxWalletAmount finding RESOLVED", "400M tokens < 1B limit");
  } catch (e) {
    fail("maxWalletAmount check", e);
  }

  // ==============================
  // Step 7: Complete sale (advance all tiers via time)
  // ==============================
  logStep("Advance through all 5 tiers, complete sale");

  try {
    for (let i = 0; i < 5; i++) {
      await time.increase(TIER_DURATION + 1);
      await fairLaunch.checkTierAdvancement();
      const tier = await fairLaunch.currentTier();
      console.log(`    After advance ${i + 1}: tier=${tier}`);
    }

    const state = await fairLaunch.saleState();
    if (Number(state) !== 3) throw new Error(`Expected COMPLETED(3), got ${state}`);

    pass("Sale completed", "All 5 tiers expired");
  } catch (e) {
    fail("Complete sale", e);
  }

  // ==============================
  // Step 8: Finalize (creates LP, burns unsold)
  // ==============================
  logStep("Finalize sale (Uniswap LP creation)");

  try {
    const tx = await fairLaunch.finalize();
    const receipt = await trackGas(tx, "finalize");

    const state = await fairLaunch.saleState();
    if (Number(state) !== 5) throw new Error(`Expected FINALIZED(5), got ${state}`);

    const lpInfo = await fairLaunch.getLPInfo();
    console.log(`    LP created: ${lpInfo[0]}`);
    console.log(`    Pair: ${lpInfo[1]}`);
    console.log(`    LP tokens: ${formatEther(lpInfo[2])}`);

    const contractEth = await ethers.provider.getBalance(await fairLaunch.getAddress());
    console.log(`    FairLaunch ETH remaining: ${formatEther(contractEth)}`);
    if (contractEth !== 0n) throw new Error("FairLaunch should have 0 ETH after LP");

    // Check burned tokens
    const burned = await rateToken.balanceOf("0x000000000000000000000000000000000000dEaD");
    console.log(`    Unsold tokens burned: ${formatEther(burned)} RATE`);

    pass("Sale finalized", `LP created, ${formatEther(burned)} tokens burned`);
  } catch (e) {
    fail("Finalize", e);
  }

  // ==============================
  // Step 9: Claim tokens WITHOUT raising maxWalletAmount
  // ==============================
  logStep("Claim tokens (verify no maxWalletAmount block)");

  try {
    // Claim for buyer1 (400M tokens — should work without raising limits)
    const balBefore = await rateToken.balanceOf(buyer1.address);
    const tx = await fairLaunch.connect(buyer1).claimTokens();
    await trackGas(tx, "claimTokens");

    const balAfter = await rateToken.balanceOf(buyer1.address);
    const received = balAfter - balBefore;
    console.log(`    Buyer1 claimed: ${formatEther(received)} RATE`);

    const expectedTokens = parseEther("400000000");
    if (received !== expectedTokens) {
      throw new Error(`Expected 400M, got ${formatEther(received)}`);
    }

    // Claim for buyer2 too
    const tx2 = await fairLaunch.connect(buyer2).claimTokens();
    await tx2.wait();
    console.log(`    Buyer2 claimed successfully`);

    pass("Claims work WITHOUT raising maxWalletAmount", "400M < 1B limit confirmed");
  } catch (e) {
    fail("Claim tokens", e);
  }

  // ==============================
  // Step 10: Enable trading
  // ==============================
  logStep("Enable trading");

  try {
    const tx = await rateToken.enableTrading();
    await trackGas(tx, "enableTrading");

    const active = await rateToken.tradingActive();
    if (!active) throw new Error("Trading not active");

    pass("Trading enabled", "tradingActive=true");
  } catch (e) {
    fail("Enable trading", e);
  }

  // ==============================
  // Step 11: Test trading on Uniswap
  // ==============================
  logStep("Trade RATE on Uniswap (sell 100M tokens)");

  try {
    // Mine a few blocks to pass dead blocks
    for (let i = 0; i < 3; i++) {
      await hre.network.provider.send("evm_mine");
    }

    const router = await ethers.getContractAt(
      [
        "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) external",
        "function WETH() external view returns (address)",
      ],
      UNISWAP_V2_ROUTER
    );

    const weth = await router.WETH();
    const sellAmount = parseEther("100000000"); // 100M RATE

    // Approve router
    await rateToken.connect(buyer1).approve(UNISWAP_V2_ROUTER, sellAmount);

    const ethBefore = await ethers.provider.getBalance(buyer1.address);

    const tx = await router
      .connect(buyer1)
      .swapExactTokensForETHSupportingFeeOnTransferTokens(
        sellAmount,
        0, // accept any amount
        [await rateToken.getAddress(), weth],
        buyer1.address,
        (await time.latest()) + 3600
      );
    const receipt = await trackGas(tx, "swap");

    const ethAfter = await ethers.provider.getBalance(buyer1.address);
    const ethReceived = ethAfter - ethBefore + receipt.gasUsed * receipt.gasPrice;
    console.log(`    Sold 100M RATE`);
    console.log(`    ETH received (approx): ${formatEther(ethReceived)}`);

    if (ethReceived <= 0n) throw new Error("No ETH received from swap");

    pass("Uniswap trade successful", `Sold 100M RATE for ~${formatEther(ethReceived)} ETH`);
  } catch (e) {
    fail("Uniswap trade", e);
  }

  // ==============================
  // Step 12: Trigger TGE
  // ==============================
  logStep("Trigger TGE on VestingManager");

  try {
    const tx = await vesting.triggerTGE();
    await trackGas(tx, "triggerTGE");

    const triggered = await vesting.tgeTriggered();
    if (!triggered) throw new Error("TGE not triggered");

    pass("TGE triggered", "Vesting clocks started");
  } catch (e) {
    fail("Trigger TGE", e);
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
