/**
 * RATE Token Fair Launch Deployment Script
 *
 * This script deploys and configures:
 * 1. RATEToken (ERC20)
 * 2. FairLaunchSale (Public sale with tiered pricing)
 * 3. VestingManager (Team/Ecosystem/Marketing/Seed vesting)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-fairlaunch.js --network <network>
 *
 * Networks: localhost, sepolia, mainnet
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");

// ============ Uniswap V2 Router Addresses ============

const UNISWAP_ROUTERS = {
  mainnet:   "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  sepolia:   "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
  localhost: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  hardhat:   "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
};

// ============ Configuration ============

const CONFIG = {
  // Wallet addresses (MUST BE SET BEFORE MAINNET DEPLOYMENT)
  OWNER_MULTISIG: process.env.OWNER_MULTISIG || "",
  TREASURY_MULTISIG: process.env.TREASURY_MULTISIG || "",
  TEAM_MULTISIG: process.env.TEAM_MULTISIG || "",
  ECOSYSTEM_MULTISIG: process.env.ECOSYSTEM_MULTISIG || "",
  MARKETING_MULTISIG: process.env.MARKETING_MULTISIG || "",
  SEED_MULTISIG: process.env.SEED_MULTISIG || "",

  // Gas price safety cap (gwei) — abort mainnet deployment if gas exceeds this
  MAX_GAS_PRICE_GWEI: 100,

  // Token allocations
  TOTAL_SUPPLY: ethers.parseEther("100000000000"), // 100B
  FAIR_LAUNCH_ALLOCATION: ethers.parseEther("40000000000"), // 40B
  VESTING_ALLOCATION: ethers.parseEther("52000000000"), // 52B (Team + Ecosystem + Marketing + Seed)
  TREASURY_ALLOCATION: ethers.parseEther("8000000000"), // 8B

  // Deployment mode
  DRY_RUN: process.env.DRY_RUN === "true",
  SKIP_VERIFY: process.env.SKIP_VERIFY === "true",
};

// ============ Helper Functions ============

function validateConfig(network) {
  const errors = [];

  if (network !== "localhost" && network !== "hardhat") {
    if (!CONFIG.OWNER_MULTISIG) errors.push("OWNER_MULTISIG not set");
    if (!CONFIG.TREASURY_MULTISIG) errors.push("TREASURY_MULTISIG not set");
    if (!CONFIG.TEAM_MULTISIG) errors.push("TEAM_MULTISIG not set");
    if (!CONFIG.ECOSYSTEM_MULTISIG) errors.push("ECOSYSTEM_MULTISIG not set");
    if (!CONFIG.MARKETING_MULTISIG) errors.push("MARKETING_MULTISIG not set");
    if (!CONFIG.SEED_MULTISIG) errors.push("SEED_MULTISIG not set");
  }

  if (errors.length > 0) {
    console.error("\n========== CONFIGURATION ERRORS ==========");
    errors.forEach((e) => console.error(`  - ${e}`));
    console.error("==========================================\n");
    console.error("Set these in your .env file or as environment variables.");
    process.exit(1);
  }
}

async function getGasPrice() {
  const feeData = await ethers.provider.getFeeData();
  return feeData.gasPrice;
}

async function estimateDeploymentCost(factory, args = []) {
  const deployTx = await factory.getDeployTransaction(...args);
  const estimatedGas = await ethers.provider.estimateGas(deployTx);
  const gasPrice = await getGasPrice();
  return estimatedGas * gasPrice;
}

function formatEther(wei) {
  return ethers.formatEther(wei);
}

function getConfirmations(network) {
  return (network === "mainnet") ? 3 : 1;
}

async function verifyContract(address, constructorArguments = []) {
  if (CONFIG.SKIP_VERIFY) {
    console.log("    Skipping verification (SKIP_VERIFY=true)");
    return;
  }

  console.log("    Verifying on Etherscan...");
  try {
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    console.log("    Verified!");
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("    Already verified.");
    } else {
      console.error("    Verification failed:", error.message);
    }
  }
}

// ============ Deployment Functions ============

async function deployRATEToken(deployer, network) {
  console.log("\n1. Deploying RATEToken...");

  const routerAddress = UNISWAP_ROUTERS[network];
  if (!routerAddress) {
    throw new Error(`No Uniswap V2 Router configured for network: ${network}`);
  }
  console.log(`    Uniswap V2 Router: ${routerAddress} (${network})`);

  const RATEToken = await ethers.getContractFactory("RatingCountAI");

  // Estimate cost
  const estimatedCost = await estimateDeploymentCost(RATEToken, [routerAddress]);
  console.log(`    Estimated gas cost: ${formatEther(estimatedCost)} ETH`);

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping deployment");
    return { address: "0x0000000000000000000000000000000000000001" };
  }

  const rateToken = await RATEToken.deploy(routerAddress);
  await rateToken.waitForDeployment();
  const address = await rateToken.getAddress();

  console.log(`    RATEToken deployed to: ${address}`);

  // Verify initial state
  const totalSupply = await rateToken.totalSupply();
  const ownerBalance = await rateToken.balanceOf(deployer.address);
  console.log(`    Total supply: ${formatEther(totalSupply)} RATE`);
  console.log(`    Owner balance: ${formatEther(ownerBalance)} RATE`);

  return rateToken;
}

async function deployFairLaunchSale(rateTokenAddress, network) {
  console.log("\n2. Deploying FairLaunchSale...");

  const routerAddress = UNISWAP_ROUTERS[network];
  if (!routerAddress) {
    throw new Error(`No Uniswap V2 Router configured for network: ${network}`);
  }
  console.log(`    Uniswap V2 Router: ${routerAddress} (${network})`);

  const FairLaunchSale = await ethers.getContractFactory("FairLaunchSale");

  // Estimate cost
  const estimatedCost = await estimateDeploymentCost(FairLaunchSale, [
    rateTokenAddress,
    routerAddress,
  ]);
  console.log(`    Estimated gas cost: ${formatEther(estimatedCost)} ETH`);

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping deployment");
    return { address: "0x0000000000000000000000000000000000000002" };
  }

  const fairLaunch = await FairLaunchSale.deploy(rateTokenAddress, routerAddress);
  await fairLaunch.waitForDeployment();
  const address = await fairLaunch.getAddress();

  console.log(`    FairLaunchSale deployed to: ${address}`);

  // Verify initial state
  const state = await fairLaunch.saleState();
  console.log(`    Initial state: ${state} (NOT_STARTED)`);

  return fairLaunch;
}

async function deployVestingManager(rateTokenAddress) {
  console.log("\n3. Deploying VestingManager...");

  const VestingManager = await ethers.getContractFactory("VestingManager");

  // Estimate cost
  const estimatedCost = await estimateDeploymentCost(VestingManager, [
    rateTokenAddress,
  ]);
  console.log(`    Estimated gas cost: ${formatEther(estimatedCost)} ETH`);

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping deployment");
    return { address: "0x0000000000000000000000000000000000000003" };
  }

  const vesting = await VestingManager.deploy(rateTokenAddress);
  await vesting.waitForDeployment();
  const address = await vesting.getAddress();

  console.log(`    VestingManager deployed to: ${address}`);

  return vesting;
}

async function distributeTokens(rateToken, fairLaunchAddress, vestingAddress, treasuryAddress, network) {
  const confirmations = getConfirmations(network);
  console.log("\n4. Distributing tokens via distributeTokens()...");
  console.log("    publicSale  → FairLaunchSale (40B)");
  console.log("    team        → VestingManager (22B)");
  console.log("    ecosystem   → VestingManager (15B)");
  console.log("    marketing   → VestingManager (10B)");
  console.log("    treasury    → Treasury Wallet (8B)");
  console.log("    seed        → VestingManager (5B)");
  console.log(`    VestingManager total: 52B (22+15+10+5)`);

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping token distribution");
    return;
  }

  // Call the contract's distributeTokens() function
  // VestingManager receives team + ecosystem + marketing + seed allocations
  // Fee/limit exclusions are idempotent (multiple calls to same address = harmless)
  const tx = await rateToken.distributeTokens(
    fairLaunchAddress,   // publicSale  → FairLaunchSale gets 40B
    vestingAddress,      // team        → VestingManager gets 22B
    vestingAddress,      // ecosystem   → VestingManager gets 15B
    vestingAddress,      // marketing   → VestingManager gets 10B
    treasuryAddress,     // treasury    → Treasury gets 8B
    vestingAddress       // seed        → VestingManager gets 5B
  );
  await tx.wait(confirmations);
  console.log(`    Done. TX: ${tx.hash}`);

  // Verify tokensDistributed flag
  const distributed = await rateToken.tokensDistributed();
  console.log(`    tokensDistributed: ${distributed}`);

  // Verify balances
  const fairLaunchBalance = await rateToken.balanceOf(fairLaunchAddress);
  const vestingBalance = await rateToken.balanceOf(vestingAddress);
  const treasuryBalance = await rateToken.balanceOf(treasuryAddress);

  console.log("\n    Token Distribution Verification:");
  console.log(`    - FairLaunch: ${formatEther(fairLaunchBalance)} RATE`);
  console.log(`    - Vesting: ${formatEther(vestingBalance)} RATE`);
  console.log(`    - Treasury: ${formatEther(treasuryBalance)} RATE`);
}

async function configureVesting(vesting, network) {
  const confirmations = getConfirmations(network);
  console.log("\n5. Configuring vesting schedules...");

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping vesting configuration");
    return;
  }

  const tx = await vesting.configureVesting(
    CONFIG.TEAM_MULTISIG,
    CONFIG.ECOSYSTEM_MULTISIG,
    CONFIG.MARKETING_MULTISIG,
    CONFIG.SEED_MULTISIG
  );
  await tx.wait(confirmations);

  console.log(`    Vesting configured. TX: ${tx.hash}`);
  console.log(`    - Team wallet: ${CONFIG.TEAM_MULTISIG}`);
  console.log(`    - Ecosystem wallet: ${CONFIG.ECOSYSTEM_MULTISIG}`);
  console.log(`    - Marketing wallet: ${CONFIG.MARKETING_MULTISIG}`);
  console.log(`    - Seed wallet: ${CONFIG.SEED_MULTISIG}`);
}

async function transferOwnership(contracts, ownerMultisig, network) {
  const confirmations = getConfirmations(network);
  console.log("\n6. Transferring ownership to Owner Wallet...");

  if (CONFIG.DRY_RUN) {
    console.log("    [DRY RUN] Skipping ownership transfer");
    return;
  }

  const { rateToken, fairLaunch, vesting, deployer } = contracts;

  // Ownable2Step: acceptOwnership() must be called by the NEW owner.
  // This only works in-script when deployer == ownerMultisig (same EOA).
  const canAcceptInScript = deployer.address.toLowerCase() === ownerMultisig.toLowerCase();

  // Transfer + accept RATEToken ownership (Ownable2Step)
  console.log("    Transferring RATEToken ownership...");
  const tx1 = await rateToken.transferOwnership(ownerMultisig);
  await tx1.wait(confirmations);
  console.log(`    Done. TX: ${tx1.hash}`);

  if (canAcceptInScript) {
    console.log("    Accepting RATEToken ownership...");
    const tx1a = await rateToken.acceptOwnership();
    await tx1a.wait(confirmations);
    console.log(`    Done. TX: ${tx1a.hash}`);
  }

  // Transfer + accept FairLaunchSale ownership (Ownable2Step)
  console.log("    Transferring FairLaunchSale ownership...");
  const tx2 = await fairLaunch.transferOwnership(ownerMultisig);
  await tx2.wait(confirmations);
  console.log(`    Done. TX: ${tx2.hash}`);

  if (canAcceptInScript) {
    console.log("    Accepting FairLaunchSale ownership...");
    const tx2a = await fairLaunch.acceptOwnership();
    await tx2a.wait(confirmations);
    console.log(`    Done. TX: ${tx2a.hash}`);
  }

  // Transfer + accept VestingManager ownership (Ownable2Step)
  console.log("    Transferring VestingManager ownership...");
  const tx3 = await vesting.transferOwnership(ownerMultisig);
  await tx3.wait(confirmations);
  console.log(`    Done. TX: ${tx3.hash}`);

  if (canAcceptInScript) {
    console.log("    Accepting VestingManager ownership...");
    const tx3a = await vesting.acceptOwnership();
    await tx3a.wait(confirmations);
    console.log(`    Done. TX: ${tx3a.hash}`);
  }

  if (!canAcceptInScript) {
    console.log("\n    WARNING: Owner wallet differs from deployer.");
    console.log("    acceptOwnership() must be called from the owner wallet for each contract:");
    console.log(`      - RATEToken:       ${await rateToken.getAddress()}`);
    console.log(`      - FairLaunchSale:  ${await fairLaunch.getAddress()}`);
    console.log(`      - VestingManager:  ${await vesting.getAddress()}`);
  }

  console.log(`\n    New owner: ${ownerMultisig}`);
}

// ============ Main Deployment Script ============

async function main() {
  console.log("========================================");
  console.log("  RATE Token Fair Launch Deployment");
  console.log("========================================\n");

  // Get network info
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network: ${network}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${formatEther(balance)} ETH`);

  if (CONFIG.DRY_RUN) {
    console.log("\n*** DRY RUN MODE - No actual transactions ***\n");
  }

  // C3: Gas price safety cap for mainnet
  if (network === "mainnet") {
    const feeData = await ethers.provider.getFeeData();
    const gasPriceGwei = Number(feeData.gasPrice / 1000000000n);
    console.log(`\nCurrent gas price: ${gasPriceGwei} gwei`);
    if (gasPriceGwei > CONFIG.MAX_GAS_PRICE_GWEI) {
      console.error(`\nGas price ${gasPriceGwei} gwei exceeds ${CONFIG.MAX_GAS_PRICE_GWEI} gwei safety cap. Aborting.`);
      process.exit(1);
    }
    console.log(`Gas price OK (within ${CONFIG.MAX_GAS_PRICE_GWEI} gwei cap)\n`);
  }

  // Validate configuration
  validateConfig(network);

  // For local/sepolia testing, use deployer address
  const isLocal = network === "localhost" || network === "hardhat";
  if (isLocal || network === "sepolia") {
    CONFIG.OWNER_MULTISIG = deployer.address;
    CONFIG.TREASURY_MULTISIG = deployer.address;
    CONFIG.TEAM_MULTISIG = deployer.address;
    CONFIG.ECOSYSTEM_MULTISIG = deployer.address;
    CONFIG.MARKETING_MULTISIG = deployer.address;
    CONFIG.SEED_MULTISIG = deployer.address;
    console.log(`\n[${network.toUpperCase()}] Using deployer address for all wallets\n`);
  }

  // Deploy contracts
  const rateToken = await deployRATEToken(deployer, network);
  const rateTokenAddress = await rateToken.getAddress();

  const fairLaunch = await deployFairLaunchSale(rateTokenAddress, network);
  const fairLaunchAddress = await fairLaunch.getAddress();

  const vesting = await deployVestingManager(rateTokenAddress);
  const vestingAddress = await vesting.getAddress();

  // Distribute tokens
  await distributeTokens(
    rateToken,
    fairLaunchAddress,
    vestingAddress,
    CONFIG.TREASURY_MULTISIG,
    network
  );

  // Configure vesting
  await configureVesting(vesting, network);

  // Transfer ownership (skip for local/sepolia testing to allow further testing)
  if (!isLocal && network !== "sepolia") {
    await transferOwnership(
      { rateToken, fairLaunch, vesting, deployer },
      CONFIG.OWNER_MULTISIG,
      network
    );
  } else if (network === "sepolia") {
    console.log("\n6. Skipping ownership transfer (Sepolia testing mode)");
    console.log(`    Owner remains: ${deployer.address}`);
  }

  // Verify contracts
  if (network !== "localhost" && network !== "hardhat") {
    console.log("\n7. Verifying contracts...");
    await verifyContract(rateTokenAddress, [UNISWAP_ROUTERS[network]]);
    await verifyContract(fairLaunchAddress, [rateTokenAddress, UNISWAP_ROUTERS[network]]);
    await verifyContract(vestingAddress, [rateTokenAddress]);
  }

  // Print summary
  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================\n");

  console.log("Contract Addresses:");
  console.log(`  RATEToken:       ${rateTokenAddress}`);
  console.log(`  FairLaunchSale:  ${fairLaunchAddress}`);
  console.log(`  VestingManager:  ${vestingAddress}`);

  console.log("\nWallet Addresses:");
  console.log(`  Owner Wallet:      ${CONFIG.OWNER_MULTISIG}`);
  console.log(`  Treasury Wallet:   ${CONFIG.TREASURY_MULTISIG}`);
  console.log(`  Team Wallet:       ${CONFIG.TEAM_MULTISIG}`);
  console.log(`  Ecosystem Wallet:  ${CONFIG.ECOSYSTEM_MULTISIG}`);
  console.log(`  Marketing Wallet:  ${CONFIG.MARKETING_MULTISIG}`);
  console.log(`  Seed Wallet:       ${CONFIG.SEED_MULTISIG}`);

  console.log("\nNext Steps:");
  console.log("  1. Verify all contract deployments on Etherscan");
  console.log("  2. Test token transfers and sale functionality");
  console.log("  3. Call fairLaunch.startSale() to begin the sale");
  console.log("  4. After sale: call fairLaunch.finalize() (creates LP + burns unsold)");
  console.log("  5. After finalize: call vesting.triggerTGE()");

  // Save deployment info to file
  const deploymentInfo = {
    network: network,
    timestamp: new Date().toISOString(),
    contracts: {
      RATEToken: rateTokenAddress,
      FairLaunchSale: fairLaunchAddress,
      VestingManager: vestingAddress,
    },
    wallets: {
      owner: CONFIG.OWNER_MULTISIG,
      treasury: CONFIG.TREASURY_MULTISIG,
      team: CONFIG.TEAM_MULTISIG,
      ecosystem: CONFIG.ECOSYSTEM_MULTISIG,
      marketing: CONFIG.MARKETING_MULTISIG,
      seed: CONFIG.SEED_MULTISIG,
    },
  };

  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.join(__dirname, "../deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `${network}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`\nDeployment info saved to: deployments/${filename}`);
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n========================================");
    console.error("  DEPLOYMENT FAILED");
    console.error("========================================\n");
    console.error(error);
    process.exit(1);
  });
