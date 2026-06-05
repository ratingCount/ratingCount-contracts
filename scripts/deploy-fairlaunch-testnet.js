/**
 * RATE Token Fair Launch — Testnet Deployment Script
 *
 * Simplified deployment for rapid testing:
 * 1. Deploy RATEToken
 * 2. Deploy FairLaunchSaleTestnet (tiny allocations, 5-min tiers)
 * 3. Distribute tokens (deployer as all roles)
 * 4. Start sale immediately
 *
 * No VestingManager, no ownership transfer.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-fairlaunch-testnet.js --network sepolia
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const UNISWAP_ROUTERS = {
  sepolia:   "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
  localhost: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  hardhat:   "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
};

function formatEther(wei) {
  return ethers.formatEther(wei);
}

async function main() {
  console.log("==========================================");
  console.log("  RATE Fair Launch — TESTNET Deployment");
  console.log("==========================================\n");

  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${formatEther(balance)} ETH\n`);

  const routerAddress = UNISWAP_ROUTERS[network];
  if (!routerAddress) {
    throw new Error(`No Uniswap router configured for network: ${network}`);
  }

  // 1. Deploy RATEToken
  console.log("1. Deploying RATEToken...");
  const RATEToken = await ethers.getContractFactory("RatingCountAI");
  const rateToken = await RATEToken.deploy(routerAddress);
  await rateToken.waitForDeployment();
  const rateTokenAddress = await rateToken.getAddress();
  console.log(`   RATEToken: ${rateTokenAddress}`);

  // 2. Deploy FairLaunchSaleTestnet
  console.log("\n2. Deploying FairLaunchSaleTestnet...");
  const FairLaunchSale = await ethers.getContractFactory("FairLaunchSaleTestnet");
  const fairLaunch = await FairLaunchSale.deploy(rateTokenAddress, routerAddress);
  await fairLaunch.waitForDeployment();
  const fairLaunchAddress = await fairLaunch.getAddress();
  console.log(`   FairLaunchSaleTestnet: ${fairLaunchAddress}`);

  // 3. Distribute tokens (deployer as all roles)
  console.log("\n3. Distributing tokens...");
  const tx = await rateToken.distributeTokens(
    fairLaunchAddress,    // publicSale
    deployer.address,     // team
    deployer.address,     // ecosystem
    deployer.address,     // marketing
    deployer.address,     // treasury
    deployer.address      // seed
  );
  await tx.wait();

  const saleBalance = await rateToken.balanceOf(fairLaunchAddress);
  console.log(`   Sale contract balance: ${formatEther(saleBalance)} RATE`);

  // 4. Start sale immediately
  console.log("\n4. Starting sale...");
  const startTx = await fairLaunch.startSale();
  await startTx.wait();
  const state = await fairLaunch.saleState();
  console.log(`   Sale state: ${state} (1 = ACTIVE)`);

  // 5. Verify on Etherscan (non-local only)
  if (network !== "localhost" && network !== "hardhat") {
    console.log("\n5. Verifying contracts on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: rateTokenAddress,
        constructorArguments: [routerAddress],
      });
      console.log("   RATEToken verified.");
    } catch (e) {
      console.log("   RATEToken verification:", e.message.includes("Already") ? "Already verified." : e.message);
    }
    try {
      await hre.run("verify:verify", {
        address: fairLaunchAddress,
        constructorArguments: [rateTokenAddress, routerAddress],
      });
      console.log("   FairLaunchSaleTestnet verified.");
    } catch (e) {
      console.log("   FairLaunchSaleTestnet verification:", e.message.includes("Already") ? "Already verified." : e.message);
    }
  }

  // 6. Save deployment info
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const deploymentInfo = {
    network,
    timestamp: new Date().toISOString(),
    type: "testnet-fast",
    contracts: {
      RATEToken: rateTokenAddress,
      FairLaunchSaleTestnet: fairLaunchAddress,
    },
    deployer: deployer.address,
    notes: "Test-friendly: front-loaded tiers (1.2M/1.0M/0.8M/0.6M/0.4M), 5-min tiers, 0.0778 ETH hard cap, production prices, sale started immediately",
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "sepolia-testnet.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Summary
  console.log("\n==========================================");
  console.log("  TESTNET DEPLOYMENT COMPLETE");
  console.log("==========================================\n");
  console.log("Contracts:");
  console.log(`  RATEToken:              ${rateTokenAddress}`);
  console.log(`  FairLaunchSaleTestnet:  ${fairLaunchAddress}`);
  console.log("\nTest Parameters:");
  console.log("  Tier Duration:    5 minutes");
  console.log("  Hard Cap:         0.0778 ETH");
  console.log("  Min Contribution: 0.001 ETH");
  console.log("  Max per TX:       0.032 ETH");
  console.log("  Max per Wallet:   0.032 ETH");
  console.log("\nTier Allocations (front-loaded, mirrors production ratio):");
  console.log("  T1: 1.2M RATE  |  T2: 1.0M RATE  |  T3: 0.8M RATE");
  console.log("  T4: 0.6M RATE  |  T5: 0.4M RATE  |  Total: 4.0M RATE");
  console.log("\nTier Buyout Costs:");
  console.log("  T1: 0.0096 ETH  |  T2: 0.012 ETH  |  T3: 0.0144 ETH");
  console.log("  T4: 0.0162 ETH  |  T5: 0.0256 ETH  |  Total: 0.0778 ETH");
  console.log("\nSaved to: deployments/sepolia-testnet.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDEPLOYMENT FAILED:", error);
    process.exit(1);
  });
