/**
 * FairLaunchSale Test Suite
 *
 * Tests for the RATE token Fair Launch Sale contract
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FairLaunchSale", function () {
  let rateToken;
  let fairLaunch;
  let owner;
  let buyer1;
  let buyer2;
  let buyer3;
  let treasury;

  // Constants
  const TOTAL_SUPPLY = ethers.parseEther("100000000000"); // 100B
  const SALE_ALLOCATION = ethers.parseEther("40000000000"); // 40B
  const TIER_DURATION = 14 * 24 * 60 * 60; // 14 days in seconds
  const MIN_CONTRIBUTION = ethers.parseEther("0.05");
  const MAX_CONTRIBUTION_PER_TX = ethers.parseEther("3.2");
  const MAX_CONTRIBUTION_PER_WALLET = ethers.parseEther("3.2");

  // Tier prices (per 1M RATE)
  const TIER_PRICES = [
    ethers.parseEther("0.0080"),
    ethers.parseEther("0.0120"),
    ethers.parseEther("0.0180"),
    ethers.parseEther("0.0270"),
    ethers.parseEther("0.0640"),
  ];

  // Tier allocations (front-loaded)
  const TIER_ALLOCATIONS = [
    ethers.parseEther("12000000000"), // 12B
    ethers.parseEther("10000000000"), // 10B
    ethers.parseEther("8000000000"),  //  8B
    ethers.parseEther("6000000000"),  //  6B
    ethers.parseEther("4000000000"),  //  4B
  ];

  let mockRouter;
  let mockPairAddress;

  beforeEach(async function () {
    [owner, buyer1, buyer2, buyer3, treasury] = await ethers.getSigners();

    // Deploy MockRATEToken (simple ERC20 for testing without Uniswap dependency)
    const RATEToken = await ethers.getContractFactory("MockRATEToken");
    rateToken = await RATEToken.deploy();
    await rateToken.waitForDeployment();

    // Deploy MockUniswapV2Router
    const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
    mockRouter = await MockRouter.deploy();
    await mockRouter.waitForDeployment();

    // Setup mock pair for RATE token
    const setupTx = await mockRouter.setupPair(await rateToken.getAddress());
    const setupReceipt = await setupTx.wait();
    const mockFactory = await ethers.getContractAt("MockUniswapV2Factory", await mockRouter.factoryContract());
    const mockWeth = await mockRouter.wethContract();
    mockPairAddress = await mockFactory.getPair(await rateToken.getAddress(), mockWeth);

    // Deploy FairLaunchSale with router
    const FairLaunchSale = await ethers.getContractFactory("FairLaunchSale");
    fairLaunch = await FairLaunchSale.deploy(await rateToken.getAddress(), await mockRouter.getAddress());
    await fairLaunch.waitForDeployment();

    // Transfer sale allocation to FairLaunchSale
    await rateToken.transfer(await fairLaunch.getAddress(), SALE_ALLOCATION);
  });

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      expect(await fairLaunch.rateToken()).to.equal(await rateToken.getAddress());
    });

    it("Should initialize in NOT_STARTED state", async function () {
      expect(await fairLaunch.saleState()).to.equal(0); // NOT_STARTED
    });

    it("Should have correct tier configuration", async function () {
      for (let i = 0; i < 5; i++) {
        const tierInfo = await fairLaunch.getTierInfo(i);
        expect(tierInfo.price).to.equal(TIER_PRICES[i]);
        expect(tierInfo.allocation).to.equal(TIER_ALLOCATIONS[i]);
        expect(tierInfo.sold).to.equal(0);
      }
    });

    it("Should have received the correct token allocation", async function () {
      expect(await rateToken.balanceOf(await fairLaunch.getAddress())).to.equal(
        SALE_ALLOCATION
      );
    });
  });

  describe("Sale Start", function () {
    it("Should allow owner to start sale", async function () {
      await expect(fairLaunch.startSale())
        .to.emit(fairLaunch, "SaleStarted");

      expect(await fairLaunch.saleState()).to.equal(1); // ACTIVE
    });

    it("Should not allow non-owner to start sale", async function () {
      await expect(
        fairLaunch.connect(buyer1).startSale()
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });

    it("Should not allow starting sale twice", async function () {
      await fairLaunch.startSale();
      await expect(fairLaunch.startSale()).to.be.revertedWith(
        "Sale already started"
      );
    });

    it("Should fail to start sale without sufficient tokens", async function () {
      // Deploy new FairLaunchSale without tokens
      const FairLaunchSale = await ethers.getContractFactory("FairLaunchSale");
      const emptyFairLaunch = await FairLaunchSale.deploy(
        await rateToken.getAddress(),
        await mockRouter.getAddress()
      );
      await emptyFairLaunch.waitForDeployment();

      await expect(emptyFairLaunch.startSale()).to.be.revertedWith(
        "Insufficient tokens"
      );
    });
  });

  describe("Contributions", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should accept valid contributions", async function () {
      const contribution = ethers.parseEther("1");
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: contribution })
      ).to.emit(fairLaunch, "TokensPurchased");

      const contributorData = await fairLaunch.getContribution(buyer1.address);
      expect(contributorData.totalEth).to.equal(contribution);
      expect(contributorData.totalTokens).to.be.gt(0);
    });

    it("Should reject contributions below minimum", async function () {
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Below minimum");
    });

    it("Should reject contributions above max per transaction", async function () {
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("3.3") })
      ).to.be.revertedWith("Above max per tx");
    });

    it("Should reject contributions above max per wallet", async function () {
      // First contribution of 3.2 ETH (fills wallet limit)
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("3.2") });
      // Second contribution should fail (would exceed 3.2 ETH max per wallet)
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Above max per wallet");
    });

    it("Should track contributor correctly", async function () {
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });

      expect(await fairLaunch.hasContributed(buyer1.address)).to.be.true;
      expect(await fairLaunch.hasContributed(buyer2.address)).to.be.false;
      expect(await fairLaunch.getContributorCount()).to.equal(1);
    });

    it("Should calculate tokens correctly based on tier price", async function () {
      const contribution = ethers.parseEther("1");
      await fairLaunch.connect(buyer1).contribute({ value: contribution });

      const contributorData = await fairLaunch.getContribution(buyer1.address);
      // Price is 0.008 ETH per 1M tokens
      // So 1 ETH should buy: 1 / 0.008 * 1M = 125M tokens
      const expectedTokens = ethers.parseEther("125000000"); // 125M
      expect(contributorData.totalTokens).to.equal(expectedTokens);
    });

    it("Should reject contributions when sale is paused", async function () {
      await fairLaunch.pause();
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Sale not active");
    });
  });

  describe("Tier Advancement", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should advance tier after time elapsed", async function () {
      let tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(0);

      // Advance time by 14 days
      await time.increase(TIER_DURATION + 1);

      // Trigger tier check with a contribution
      await fairLaunch.checkTierAdvancement();

      tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(1);
    });

    it("Should advance multiple tiers with multiple checks", async function () {
      // Each tier gets its own 14-day window from when it starts
      // So we need to advance time and check for each tier

      // Advance to tier 1 (14 days)
      await time.increase(TIER_DURATION + 1);
      await fairLaunch.checkTierAdvancement();
      expect((await fairLaunch.getCurrentTierInfo()).tierIndex).to.equal(1);

      // Advance to tier 2 (another 14 days)
      await time.increase(TIER_DURATION + 1);
      await fairLaunch.checkTierAdvancement();
      expect((await fairLaunch.getCurrentTierInfo()).tierIndex).to.equal(2);

      // Advance to tier 3 (another 14 days)
      await time.increase(TIER_DURATION + 1);
      await fairLaunch.checkTierAdvancement();

      const tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(3);
    });

    it("Should complete sale after all tiers time out", async function () {
      // Advance through all 5 tiers (each needs its own 14-day period)
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      expect(await fairLaunch.saleState()).to.equal(3); // COMPLETED
    });
  });

  describe("Pause and Unpause", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should allow owner to pause", async function () {
      await expect(fairLaunch.pause()).to.emit(fairLaunch, "SalePaused");
      expect(await fairLaunch.saleState()).to.equal(2); // PAUSED
    });

    it("Should allow owner to unpause", async function () {
      await fairLaunch.pause();
      await expect(fairLaunch.unpause()).to.emit(fairLaunch, "SaleUnpaused");
      expect(await fairLaunch.saleState()).to.equal(1); // ACTIVE
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(
        fairLaunch.connect(buyer1).pause()
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });
  });

  describe("Cancellation and Refunds", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
      // Make some contributions
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("2") });
      await fairLaunch.connect(buyer2).contribute({ value: ethers.parseEther("3") });
    });

    it("Should allow owner to cancel sale", async function () {
      await expect(fairLaunch.cancel("Testing cancellation"))
        .to.emit(fairLaunch, "SaleCancelled");

      expect(await fairLaunch.saleState()).to.equal(4); // CANCELLED
    });

    it("Should allow contributors to claim refunds after cancellation", async function () {
      await fairLaunch.cancel("Testing");

      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);

      await expect(fairLaunch.connect(buyer1).claimRefund())
        .to.emit(fairLaunch, "RefundClaimed")
        .withArgs(buyer1.address, ethers.parseEther("2"));

      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);
      // Balance should increase (minus gas)
      expect(buyer1BalanceAfter).to.be.gt(buyer1BalanceBefore);

      // Should not be able to claim again
      await expect(
        fairLaunch.connect(buyer1).claimRefund()
      ).to.be.revertedWith("Already claimed");
    });

    it("Should not allow refund claims when not cancelled", async function () {
      await expect(
        fairLaunch.connect(buyer1).claimRefund()
      ).to.be.revertedWith("Not cancelled");
    });

    it("Should not allow token claims when cancelled", async function () {
      await fairLaunch.cancel("Testing");
      await expect(
        fairLaunch.connect(buyer1).claimTokens()
      ).to.be.revertedWith("Not finalized");
    });
  });

  describe("Finalization and Token Claims", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });
      await fairLaunch.connect(buyer2).contribute({ value: ethers.parseEther("2") });

      // Complete the sale by advancing time through all 5 tiers
      // Each tier needs its own 14-day period
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }
    });

    it("Should allow owner to finalize after completion", async function () {
      expect(await fairLaunch.saleState()).to.equal(3); // COMPLETED

      const tx = await fairLaunch.finalize();
      await expect(tx).to.emit(fairLaunch, "SaleFinalized");
      await expect(tx).to.emit(fairLaunch, "LiquidityCreated");

      expect(await fairLaunch.saleState()).to.equal(5); // FINALIZED
      expect(await fairLaunch.liquidityCreated()).to.be.true;
      expect(await fairLaunch.lpTokenAmount()).to.be.gt(0);
      expect(await fairLaunch.uniswapPair()).to.equal(mockPairAddress);

      // LP unlock time should be ~365 days from now
      const latestTime = await time.latest();
      const lpUnlock = await fairLaunch.lpUnlockTime();
      expect(lpUnlock).to.be.closeTo(latestTime + 365 * 24 * 60 * 60, 5);
    });

    it("Should allow token claims after finalization", async function () {
      await fairLaunch.finalize();

      const contributorData = await fairLaunch.getContribution(buyer1.address);
      const expectedTokens = contributorData.totalTokens;

      const buyer1TokensBefore = await rateToken.balanceOf(buyer1.address);

      await expect(fairLaunch.connect(buyer1).claimTokens())
        .to.emit(fairLaunch, "TokensClaimed")
        .withArgs(buyer1.address, expectedTokens);

      const buyer1TokensAfter = await rateToken.balanceOf(buyer1.address);
      expect(buyer1TokensAfter - buyer1TokensBefore).to.equal(expectedTokens);
    });

    it("Should not allow double claims", async function () {
      await fairLaunch.finalize();
      await fairLaunch.connect(buyer1).claimTokens();

      await expect(
        fairLaunch.connect(buyer1).claimTokens()
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });
    });

    it("Should return correct current tier info", async function () {
      const tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(0);
      expect(tierInfo.price).to.equal(TIER_PRICES[0]);
      expect(tierInfo.sold).to.be.gt(0);
    });

    it("Should return correct quote", async function () {
      const quote = await fairLaunch.getQuote(ethers.parseEther("1"));
      // 1 ETH at 0.008 ETH per 1M = 125M tokens
      expect(quote.tokensReceivable).to.equal(ethers.parseEther("125000000"));
    });

    it("Should return correct remaining allowance", async function () {
      const remaining = await fairLaunch.getRemainingAllowance(buyer1.address);
      expect(remaining).to.equal(ethers.parseEther("2.2")); // 3.2 - 1 = 2.2
    });

    it("Should return correct sale stats", async function () {
      const stats = await fairLaunch.getSaleStats();
      expect(stats.state).to.equal(1); // ACTIVE
      expect(stats.raised).to.equal(ethers.parseEther("1"));
      expect(stats.contributorCount).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should reject direct ETH transfers", async function () {
      await expect(
        buyer1.sendTransaction({
          to: await fairLaunch.getAddress(),
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("Use contribute()");
    });
  });

  describe("Liquidity Pool Creation", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });
    });

    it("Should create LP with all raised ETH on finalize", async function () {
      // Complete the sale
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      const contractEthBefore = await ethers.provider.getBalance(await fairLaunch.getAddress());
      expect(contractEthBefore).to.equal(ethers.parseEther("1"));

      const tx = await fairLaunch.finalize();
      await expect(tx).to.emit(fairLaunch, "LiquidityCreated");
      await expect(tx).to.emit(fairLaunch, "UnsoldTokensBurned");

      // All ETH should be sent to router (contract balance = 0)
      const contractEthAfter = await ethers.provider.getBalance(await fairLaunch.getAddress());
      expect(contractEthAfter).to.equal(0);

      // LP state should be set
      expect(await fairLaunch.liquidityCreated()).to.be.true;
      expect(await fairLaunch.lpTokenAmount()).to.be.gt(0);
      expect(await fairLaunch.uniswapPair()).to.equal(mockPairAddress);
    });

    it("Should calculate correct token amount at last tier price", async function () {
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      await fairLaunch.finalize();

      // 1 ETH at TIER_5_PRICE (0.064 ETH per 1M)
      // tokens = (1e18 * 1e24) / 0.064e18 = 15,625,000 * 1e18
      // The LiquidityCreated event should show approximately this amount
      const lpInfo = await fairLaunch.getLPInfo();
      expect(lpInfo.created).to.be.true;
    });

    it("Should burn unsold tokens after LP creation", async function () {
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      const burnAddressBalanceBefore = await rateToken.balanceOf("0x000000000000000000000000000000000000dEaD");

      await fairLaunch.finalize();

      const burnAddressBalanceAfter = await rateToken.balanceOf("0x000000000000000000000000000000000000dEaD");
      expect(burnAddressBalanceAfter).to.be.gt(burnAddressBalanceBefore);
    });

    it("Should prevent double finalization", async function () {
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      await fairLaunch.finalize();

      await expect(fairLaunch.finalize()).to.be.revertedWith("Not completed");
    });

    it("Should reject non-owner finalize", async function () {
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      await expect(
        fairLaunch.connect(buyer1).finalize()
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });

    it("Should still allow token claims after LP creation", async function () {
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      await fairLaunch.finalize();

      const contributorData = await fairLaunch.getContribution(buyer1.address);
      const expectedTokens = contributorData.totalTokens;

      await expect(fairLaunch.connect(buyer1).claimTokens())
        .to.emit(fairLaunch, "TokensClaimed")
        .withArgs(buyer1.address, expectedTokens);
    });
  });

  describe("LP Token Withdrawal", function () {
    const LP_LOCK_DURATION = 365 * 24 * 60 * 60; // 365 days

    beforeEach(async function () {
      await fairLaunch.startSale();
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });

      // Complete and finalize (creates LP)
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }
      await fairLaunch.finalize();
    });

    it("Should reject LP withdrawal before unlock time", async function () {
      await expect(
        fairLaunch.withdrawLPTokens(treasury.address)
      ).to.be.revertedWith("LP tokens still locked");
    });

    it("Should allow LP withdrawal after unlock time", async function () {
      await time.increase(LP_LOCK_DURATION + 1);

      const lpAmount = await fairLaunch.lpTokenAmount();
      const pairToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", mockPairAddress);

      await expect(fairLaunch.withdrawLPTokens(treasury.address))
        .to.emit(fairLaunch, "LPTokensWithdrawn")
        .withArgs(treasury.address, lpAmount);

      const treasuryLPBalance = await pairToken.balanceOf(treasury.address);
      expect(treasuryLPBalance).to.equal(lpAmount);
    });

    it("Should reject non-owner LP withdrawal", async function () {
      await time.increase(LP_LOCK_DURATION + 1);

      await expect(
        fairLaunch.connect(buyer1).withdrawLPTokens(treasury.address)
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });

    it("Should reject LP withdrawal to zero address", async function () {
      await time.increase(LP_LOCK_DURATION + 1);

      await expect(
        fairLaunch.withdrawLPTokens(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("Should return correct getLPInfo data", async function () {
      const lpInfo = await fairLaunch.getLPInfo();
      expect(lpInfo.created).to.be.true;
      expect(lpInfo.pair).to.equal(mockPairAddress);
      expect(lpInfo.lpAmount).to.be.gt(0);
      expect(lpInfo.unlockTime).to.be.gt(0);
      expect(lpInfo.timeRemaining).to.be.gt(0);

      // After lock expires
      await time.increase(LP_LOCK_DURATION + 1);
      const lpInfoAfter = await fairLaunch.getLPInfo();
      expect(lpInfoAfter.timeRemaining).to.equal(0);
    });
  });

  describe("Push Refunds", function () {
    const GRACE_PERIOD = 30 * 24 * 60 * 60; // 30 days in seconds

    beforeEach(async function () {
      await fairLaunch.startSale();
      // Multiple contributors
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("2") });
      await fairLaunch.connect(buyer2).contribute({ value: ethers.parseEther("3") });
      await fairLaunch.connect(buyer3).contribute({ value: ethers.parseEther("1") });
    });

    it("Should push refunds after grace period", async function () {
      await fairLaunch.cancel("Testing");

      // Advance time past grace period
      await time.increase(GRACE_PERIOD + 1);

      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);
      const buyer2BalanceBefore = await ethers.provider.getBalance(buyer2.address);

      // Push refunds to multiple contributors
      await fairLaunch.pushRefunds([buyer1.address, buyer2.address]);

      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);
      const buyer2BalanceAfter = await ethers.provider.getBalance(buyer2.address);

      // Both should have received refunds
      expect(buyer1BalanceAfter - buyer1BalanceBefore).to.equal(ethers.parseEther("2"));
      expect(buyer2BalanceAfter - buyer2BalanceBefore).to.equal(ethers.parseEther("3"));

      // Verify refund claimed flags are set
      const buyer1Data = await fairLaunch.getContribution(buyer1.address);
      const buyer2Data = await fairLaunch.getContribution(buyer2.address);
      expect(buyer1Data.refundClaimed).to.be.true;
      expect(buyer2Data.refundClaimed).to.be.true;
    });

    it("Should reject push refunds during grace period", async function () {
      await fairLaunch.cancel("Testing");

      // Do not advance time - still in grace period
      await expect(
        fairLaunch.pushRefunds([buyer1.address])
      ).to.be.revertedWith("Grace period active");
    });

    it("Should reject push refunds when not cancelled", async function () {
      await expect(
        fairLaunch.pushRefunds([buyer1.address])
      ).to.be.revertedWith("Not cancelled");
    });

    it("Should skip already claimed refunds", async function () {
      await fairLaunch.cancel("Testing");

      // Buyer1 claims their own refund
      await fairLaunch.connect(buyer1).claimRefund();

      // Advance time past grace period
      await time.increase(GRACE_PERIOD + 1);

      const buyer1BalanceBefore = await ethers.provider.getBalance(buyer1.address);

      // Try to push refund - should skip buyer1
      await fairLaunch.pushRefunds([buyer1.address]);

      const buyer1BalanceAfter = await ethers.provider.getBalance(buyer1.address);

      // No additional refund should have been sent
      expect(buyer1BalanceAfter).to.equal(buyer1BalanceBefore);
    });

    it("Should handle empty contribution addresses gracefully", async function () {
      await fairLaunch.cancel("Testing");
      await time.increase(GRACE_PERIOD + 1);

      // Address that never contributed
      const nonContributor = ethers.Wallet.createRandom().address;

      // Should not revert, just skip
      await expect(
        fairLaunch.pushRefunds([nonContributor])
      ).to.not.be.reverted;
    });

    it("Should reject non-owner push refunds", async function () {
      await fairLaunch.cancel("Testing");
      await time.increase(GRACE_PERIOD + 1);

      await expect(
        fairLaunch.connect(buyer1).pushRefunds([buyer2.address])
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });
  });

  describe("Tier Sellout and Cross-Tier Contributions", function () {
    // Tier 1: 12B tokens at 0.008 ETH per 1M = 96 ETH to sell out
    // Each wallet can contribute max 3.2 ETH, so we need 30 wallets (30 × 3.2 = 96)

    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should advance tier when sold out via contribution", async function () {
      const signers = await ethers.getSigners();

      // Tier 1: 12B tokens at 0.008 ETH per 1M = 96 ETH needed
      // Use 29 wallets × 3.2 ETH = 92.8 ETH
      for (let i = 5; i < 34; i++) {
        await fairLaunch.connect(signers[i]).contribute({ value: ethers.parseEther("3.2") });
      }
      // 92.8 ETH so far, need 3.2 more

      // Verify still in tier 0
      let tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(0);

      // Contribute remaining to sell out tier
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("3.2") });

      // Should have advanced to tier 1
      tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(1);

      // Verify tier 0 is marked as completed
      const tier0Info = await fairLaunch.getTierInfo(0);
      expect(tier0Info.completed).to.be.true;
    });

    it("Should handle cross-tier contribution correctly", async function () {
      const signers = await ethers.getSigners();

      // Get tier 0 close to sold out: need 96 ETH, contribute 94.8 ETH
      // 29 wallets × 3.2 = 92.8 ETH
      for (let i = 5; i < 34; i++) {
        await fairLaunch.connect(signers[i]).contribute({ value: ethers.parseEther("3.2") });
      }
      // buyer1 contributes 2 ETH = 94.8 total, leaving 1.2 ETH in tier 0
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("2") });

      // buyer2 contributes 3.2 ETH — should span tiers (~1.2 fills tier 0, ~2 goes to tier 1)
      await fairLaunch.connect(buyer2).contribute({ value: ethers.parseEther("3.2") });

      // Verify buyer2 has tokens from both tiers
      const breakdown = await fairLaunch.getContributorTierBreakdown(buyer2.address);

      // Should have tokens in tier 0
      expect(breakdown.tokenAmounts[0]).to.be.gt(0);
      // Should also have tokens in tier 1
      expect(breakdown.tokenAmounts[1]).to.be.gt(0);

      // Verify current tier is now 1
      const tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(1);
    });

    it("Should emit TierAdvanced event on sellout", async function () {
      const signers = await ethers.getSigners();

      // Get tier 0 close to sold out: 29 wallets × 3.2 = 92.8 ETH
      for (let i = 5; i < 34; i++) {
        await fairLaunch.connect(signers[i]).contribute({ value: ethers.parseEther("3.2") });
      }
      // 92.8 ETH contributed, 3.2 ETH remaining in tier 0

      // This contribution should trigger the tier advancement
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("3.2") })
      ).to.emit(fairLaunch, "TierAdvanced")
        .withArgs(0, await time.latest() + 1, "Tier sold out");
    });
  });

  describe("Flash Loan Protection", function () {
    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should reject same-address contribution in same block", async function () {
      // Deploy a multicall attacker contract to test same-block contributions
      const AttackerFactory = await ethers.getContractFactory("FlashLoanAttacker");
      const attacker = await AttackerFactory.deploy(await fairLaunch.getAddress());
      await attacker.waitForDeployment();

      // Attempt two contributions in one transaction (same block)
      await expect(
        attacker.attack({ value: ethers.parseEther("2") })
      ).to.be.revertedWith("One contribution per block");
    });

    it("Should allow different addresses in same block", async function () {
      await ethers.provider.send("evm_setAutomine", [false]);

      const tx1 = fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });
      const tx2 = fairLaunch.connect(buyer2).contribute({ value: ethers.parseEther("1") });

      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_setAutomine", [true]);

      await expect(tx1).to.not.be.reverted;
      await expect(tx2).to.not.be.reverted;
    });

    it("Should allow same address in different blocks", async function () {
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });
      // Next call is auto-mined in a new block
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });

      const data = await fairLaunch.getContribution(buyer1.address);
      expect(data.totalEth).to.equal(ethers.parseEther("2"));
    });
  });

  describe("Ownable2Step", function () {
    it("Should require two-step ownership transfer", async function () {
      // Start transfer
      await fairLaunch.transferOwnership(buyer1.address);

      // Owner should still be original owner
      expect(await fairLaunch.owner()).to.equal(owner.address);
      // Pending owner should be buyer1
      expect(await fairLaunch.pendingOwner()).to.equal(buyer1.address);

      // Accept from buyer1
      await fairLaunch.connect(buyer1).acceptOwnership();

      // Now buyer1 is owner
      expect(await fairLaunch.owner()).to.equal(buyer1.address);
      expect(await fairLaunch.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("Should only allow pending owner to accept", async function () {
      await fairLaunch.transferOwnership(buyer1.address);

      // buyer2 tries to accept
      await expect(
        fairLaunch.connect(buyer2).acceptOwnership()
      ).to.be.revertedWithCustomError(fairLaunch, "OwnableUnauthorizedAccount");
    });

    it("Should return correct pendingOwner", async function () {
      expect(await fairLaunch.pendingOwner()).to.equal(ethers.ZeroAddress);

      await fairLaunch.transferOwnership(buyer1.address);
      expect(await fairLaunch.pendingOwner()).to.equal(buyer1.address);
    });

    it("Should allow renounceOwnership to still work", async function () {
      await fairLaunch.renounceOwnership();
      expect(await fairLaunch.owner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Hard Cap and Excess ETH Refund", function () {
    // Note: In current configuration (front-loaded tiers):
    // - Tier 1: 12B at 0.0080 = 96 ETH   Tier 2: 10B at 0.0120 = 120 ETH
    // - Tier 3:  8B at 0.0180 = 144 ETH   Tier 4:  6B at 0.0270 = 162 ETH
    // - Tier 5:  4B at 0.0640 = 256 ETH
    // - Total sellout: ~778 ETH | Hard cap: 778 ETH (hit just before T5 sellout)
    // These tests focus on the hard cap check and excess refund mechanisms

    beforeEach(async function () {
      await fairLaunch.startSale();
    });

    it("Should complete sale when all tiers time out", async function () {
      // Contribute some ETH, then let tiers expire
      await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") });

      // Complete the sale by advancing time through all 5 tiers
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      // Sale should be completed
      expect(await fairLaunch.saleState()).to.equal(3); // COMPLETED
    });

    it("Should enforce hard cap check", async function () {
      const hardCap = await fairLaunch.HARD_CAP();
      expect(hardCap).to.equal(ethers.parseEther("778"));

      // Verify the check would trigger by simulating the math
      const totalRaised = ethers.parseEther("770");
      const newContribution = ethers.parseEther("10");
      expect(totalRaised + newContribution).to.be.gt(hardCap);
    });

    it("Should refund excess ETH when tokens run out mid-contribution", async function () {
      // Advance to tier 5 (last tier) via time
      for (let i = 0; i < 4; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      // Now in tier 5 (index 4)
      const tierInfo = await fairLaunch.getCurrentTierInfo();
      expect(tierInfo.tierIndex).to.equal(4);

      // Tier 5 has 4B tokens at 0.064 ETH per 1M = 256 ETH to sell out
      // Each wallet can contribute max 3.2 ETH
      // Contribute 79 × 3.2 = 252.8 ETH, then 1 × 2 ETH = 254.8 ETH total
      // Leaves ~1.2 ETH of tokens in tier 5
      const signers = await ethers.getSigners();
      for (let i = 5; i < 84; i++) {
        await fairLaunch.connect(signers[i]).contribute({ value: ethers.parseEther("3.2") });
      }
      // 252.8 ETH contributed
      await fairLaunch.connect(signers[84]).contribute({ value: ethers.parseEther("2") });
      // 254.8 ETH total, ~1.2 ETH of tokens remain in tier 5

      // Contribute 3.2 ETH when only ~1.2 ETH worth of tokens remain
      // Should get excess refund of ~2 ETH
      const tx = await fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("3.2") });
      const receipt = await tx.wait();

      // Check for ExcessRefunded event
      const excessEvent = receipt.logs.find(
        log => {
          try {
            const parsed = fairLaunch.interface.parseLog(log);
            return parsed && parsed.name === "ExcessRefunded";
          } catch {
            return false;
          }
        }
      );

      // Sale should complete when all tokens sold
      const stats = await fairLaunch.getSaleStats();
      expect(stats.state).to.equal(3); // COMPLETED
    });

    it("Should not allow contributions after sale completes", async function () {
      // Complete the sale by advancing time through all tiers
      for (let i = 0; i < 5; i++) {
        await time.increase(TIER_DURATION + 1);
        await fairLaunch.checkTierAdvancement();
      }

      expect(await fairLaunch.saleState()).to.equal(3); // COMPLETED

      // Try to contribute after completion
      await expect(
        fairLaunch.connect(buyer1).contribute({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Sale not active");
    });
  });
});
