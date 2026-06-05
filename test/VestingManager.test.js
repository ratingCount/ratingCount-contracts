/**
 * VestingManager Test Suite
 *
 * Tests for the RATE token vesting contract
 * Covers Team, Ecosystem, Marketing, and Seed vesting schedules
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VestingManager", function () {
  let rateToken;
  let vestingManager;
  let owner;
  let teamWallet;
  let ecosystemWallet;
  let marketingWallet;
  let seedWallet;
  let newWallet;

  // Constants from contract
  const TOTAL_SUPPLY = ethers.parseEther("100000000000"); // 100B
  const TOTAL_VESTING = ethers.parseEther("52000000000"); // 52B
  const TEAM_ALLOCATION = ethers.parseEther("22000000000"); // 22B
  const ECOSYSTEM_ALLOCATION = ethers.parseEther("15000000000"); // 15B
  const MARKETING_ALLOCATION = ethers.parseEther("10000000000"); // 10B
  const SEED_ALLOCATION = ethers.parseEther("5000000000"); // 5B

  // Vesting parameters
  const TEAM_TGE_PERCENT = 20n; // 20% at TGE
  const TEAM_VESTING_DURATION = 36 * 30 * 24 * 60 * 60; // 36 months

  const ECOSYSTEM_CLIFF = 12 * 30 * 24 * 60 * 60; // 12 months
  const ECOSYSTEM_VESTING_DURATION = 36 * 30 * 24 * 60 * 60; // 36 months

  const MARKETING_VESTING_DURATION = 36 * 30 * 24 * 60 * 60; // 36 months

  const SEED_CLIFF = 30 * 24 * 60 * 60; // 1 month

  beforeEach(async function () {
    [owner, teamWallet, ecosystemWallet, marketingWallet, seedWallet, newWallet] =
      await ethers.getSigners();

    // Deploy MockRATEToken
    const RATEToken = await ethers.getContractFactory("MockRATEToken");
    rateToken = await RATEToken.deploy();
    await rateToken.waitForDeployment();

    // Deploy VestingManager
    const VestingManager = await ethers.getContractFactory("VestingManager");
    vestingManager = await VestingManager.deploy(await rateToken.getAddress());
    await vestingManager.waitForDeployment();

    // Transfer vesting allocation to VestingManager
    await rateToken.transfer(await vestingManager.getAddress(), TOTAL_VESTING);
  });

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      expect(await vestingManager.rateToken()).to.equal(
        await rateToken.getAddress()
      );
    });

    it("Should initialize with vesting not configured", async function () {
      expect(await vestingManager.vestingConfigured()).to.be.false;
    });

    it("Should initialize with TGE not triggered", async function () {
      expect(await vestingManager.tgeTriggered()).to.be.false;
    });

    it("Should have received the correct token allocation", async function () {
      expect(
        await rateToken.balanceOf(await vestingManager.getAddress())
      ).to.equal(TOTAL_VESTING);
    });

    it("Should reject zero address for token", async function () {
      const VestingManager = await ethers.getContractFactory("VestingManager");
      await expect(
        VestingManager.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Vesting Configuration", function () {
    it("Should configure vesting with valid addresses", async function () {
      await expect(
        vestingManager.configureVesting(
          teamWallet.address,
          ecosystemWallet.address,
          marketingWallet.address,
          seedWallet.address
        )
      ).to.emit(vestingManager, "VestingConfigured");

      expect(await vestingManager.vestingConfigured()).to.be.true;
      expect(await vestingManager.teamWallet()).to.equal(teamWallet.address);
      expect(await vestingManager.ecosystemWallet()).to.equal(
        ecosystemWallet.address
      );
      expect(await vestingManager.marketingWallet()).to.equal(
        marketingWallet.address
      );
      expect(await vestingManager.seedWallet()).to.equal(seedWallet.address);
    });

    it("Should create correct vesting schedules for all wallets", async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );

      // Check Team schedule
      const teamSchedule = await vestingManager.getVestingSchedule(
        teamWallet.address
      );
      expect(teamSchedule.totalAmount).to.equal(TEAM_ALLOCATION);
      expect(teamSchedule.tgeAmount).to.equal(
        (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n
      );
      expect(teamSchedule.initialized).to.be.true;
      expect(teamSchedule.vestingType).to.equal("Team");

      // Check Ecosystem schedule
      const ecoSchedule = await vestingManager.getVestingSchedule(
        ecosystemWallet.address
      );
      expect(ecoSchedule.totalAmount).to.equal(ECOSYSTEM_ALLOCATION);
      expect(ecoSchedule.tgeAmount).to.equal(0); // 0% TGE
      expect(ecoSchedule.cliffDuration).to.equal(ECOSYSTEM_CLIFF);
      expect(ecoSchedule.vestingType).to.equal("Ecosystem");

      // Check Marketing schedule
      const marketingSchedule = await vestingManager.getVestingSchedule(
        marketingWallet.address
      );
      expect(marketingSchedule.totalAmount).to.equal(MARKETING_ALLOCATION);
      expect(marketingSchedule.tgeAmount).to.equal(0); // 0% TGE
      expect(marketingSchedule.vestingType).to.equal("Marketing");

      // Check Seed schedule
      const seedSchedule = await vestingManager.getVestingSchedule(
        seedWallet.address
      );
      expect(seedSchedule.totalAmount).to.equal(SEED_ALLOCATION);
      expect(seedSchedule.tgeAmount).to.equal(0); // 0% TGE
      expect(seedSchedule.cliffDuration).to.equal(SEED_CLIFF);
      expect(seedSchedule.vestingType).to.equal("Seed");
    });

    it("Should reject double configuration", async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );

      await expect(
        vestingManager.configureVesting(
          teamWallet.address,
          ecosystemWallet.address,
          marketingWallet.address,
          seedWallet.address
        )
      ).to.be.revertedWith("Already configured");
    });

    it("Should reject invalid team wallet address", async function () {
      await expect(
        vestingManager.configureVesting(
          ethers.ZeroAddress,
          ecosystemWallet.address,
          marketingWallet.address,
          seedWallet.address
        )
      ).to.be.revertedWith("Invalid team wallet");
    });

    it("Should reject invalid ecosystem wallet address", async function () {
      await expect(
        vestingManager.configureVesting(
          teamWallet.address,
          ethers.ZeroAddress,
          marketingWallet.address,
          seedWallet.address
        )
      ).to.be.revertedWith("Invalid ecosystem wallet");
    });

    it("Should reject invalid marketing wallet address", async function () {
      await expect(
        vestingManager.configureVesting(
          teamWallet.address,
          ecosystemWallet.address,
          ethers.ZeroAddress,
          seedWallet.address
        )
      ).to.be.revertedWith("Invalid marketing wallet");
    });

    it("Should reject invalid seed wallet address", async function () {
      await expect(
        vestingManager.configureVesting(
          teamWallet.address,
          ecosystemWallet.address,
          marketingWallet.address,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("Invalid seed wallet");
    });

    it("Should reject configuration without sufficient tokens", async function () {
      // Deploy new VestingManager without tokens
      const VestingManager = await ethers.getContractFactory("VestingManager");
      const emptyVesting = await VestingManager.deploy(
        await rateToken.getAddress()
      );
      await emptyVesting.waitForDeployment();

      await expect(
        emptyVesting.configureVesting(
          teamWallet.address,
          ecosystemWallet.address,
          marketingWallet.address,
          seedWallet.address
        )
      ).to.be.revertedWith("Insufficient tokens");
    });

    it("Should reject non-owner configuration", async function () {
      await expect(
        vestingManager
          .connect(teamWallet)
          .configureVesting(
            teamWallet.address,
            ecosystemWallet.address,
            marketingWallet.address,
            seedWallet.address
          )
      ).to.be.revertedWithCustomError(vestingManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("TGE Trigger", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
    });

    it("Should trigger TGE successfully", async function () {
      await expect(vestingManager.triggerTGE()).to.emit(
        vestingManager,
        "TGETriggered"
      );

      expect(await vestingManager.tgeTriggered()).to.be.true;
      expect(await vestingManager.tgeTime()).to.be.gt(0);
    });

    it("Should set start time for all schedules", async function () {
      await vestingManager.triggerTGE();
      const tgeTime = await vestingManager.tgeTime();

      const teamSchedule = await vestingManager.getVestingSchedule(
        teamWallet.address
      );
      expect(teamSchedule.startTime).to.equal(tgeTime);

      const ecoSchedule = await vestingManager.getVestingSchedule(
        ecosystemWallet.address
      );
      expect(ecoSchedule.startTime).to.equal(tgeTime);
    });

    it("Should reject TGE before configuration", async function () {
      const VestingManager = await ethers.getContractFactory("VestingManager");
      const unconfiguredVesting = await VestingManager.deploy(
        await rateToken.getAddress()
      );

      await expect(unconfiguredVesting.triggerTGE()).to.be.revertedWith(
        "Vesting not configured"
      );
    });

    it("Should reject double TGE trigger", async function () {
      await vestingManager.triggerTGE();

      await expect(vestingManager.triggerTGE()).to.be.revertedWith(
        "TGE already triggered"
      );
    });

    it("Should reject non-owner TGE trigger", async function () {
      await expect(
        vestingManager.connect(teamWallet).triggerTGE()
      ).to.be.revertedWithCustomError(vestingManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("TGE Claims", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should allow Team wallet to claim 20% TGE", async function () {
      const expectedTGE = (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n;
      const balanceBefore = await rateToken.balanceOf(teamWallet.address);

      await expect(vestingManager.connect(teamWallet).claimTGE())
        .to.emit(vestingManager, "TGEClaimed")
        .withArgs(teamWallet.address, expectedTGE);

      const balanceAfter = await rateToken.balanceOf(teamWallet.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedTGE);

      // 22B * 20% = 4.4B
      expect(expectedTGE).to.equal(ethers.parseEther("4400000000"));
    });

    it("Should reject TGE claim for wallets with 0% TGE", async function () {
      // Ecosystem, Marketing, Seed all have 0% TGE
      await expect(
        vestingManager.connect(ecosystemWallet).claimTGE()
      ).to.be.revertedWith("No TGE amount");

      await expect(
        vestingManager.connect(marketingWallet).claimTGE()
      ).to.be.revertedWith("No TGE amount");

      await expect(
        vestingManager.connect(seedWallet).claimTGE()
      ).to.be.revertedWith("No TGE amount");
    });

    it("Should reject double TGE claim", async function () {
      await vestingManager.connect(teamWallet).claimTGE();

      await expect(
        vestingManager.connect(teamWallet).claimTGE()
      ).to.be.revertedWith("No TGE amount");
    });

    it("Should reject TGE claim before TGE triggered", async function () {
      // Deploy fresh token and vesting instance for isolation
      const RATEToken = await ethers.getContractFactory("MockRATEToken");
      const freshToken = await RATEToken.deploy();
      await freshToken.waitForDeployment();

      const VestingManager = await ethers.getContractFactory("VestingManager");
      const freshVesting = await VestingManager.deploy(
        await freshToken.getAddress()
      );
      await freshToken.transfer(await freshVesting.getAddress(), TOTAL_VESTING);
      await freshVesting.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      // Don't trigger TGE

      await expect(
        freshVesting.connect(teamWallet).claimTGE()
      ).to.be.revertedWith("TGE not triggered");
    });

    it("Should reject TGE claim from non-beneficiary", async function () {
      await expect(
        vestingManager.connect(newWallet).claimTGE()
      ).to.be.revertedWith("No vesting schedule");
    });
  });

  describe("Vesting Release - Team", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should have tokens available immediately (no cliff)", async function () {
      // Team has no cliff, just TGE + linear vesting
      // Some tokens should be available right away via linear vesting
      // (though amount is tiny at t=0)

      // Advance time slightly
      await time.increase(30 * 24 * 60 * 60); // 1 month

      const releasable = await vestingManager.getReleasable(teamWallet.address);
      expect(releasable).to.be.gt(0);
    });

    it("Should release linear amount over 36 months", async function () {
      // First claim TGE to isolate the vesting calculation
      await vestingManager.connect(teamWallet).claimTGE();

      const vestingAmount = TEAM_ALLOCATION - (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n;

      // Advance 12 months
      await time.increase(12 * 30 * 24 * 60 * 60);

      const releasable = await vestingManager.getReleasable(teamWallet.address);
      // Should be approximately 1/3 of vesting amount (12/36 months)
      const expectedApprox = vestingAmount / 3n;

      // Allow 2% tolerance for timing variations
      const tolerance = expectedApprox / 50n;
      expect(releasable).to.be.closeTo(expectedApprox, tolerance);
    });

    it("Should release all after 36 months", async function () {
      // Claim TGE first
      await vestingManager.connect(teamWallet).claimTGE();

      // Advance 36 months
      await time.increase(TEAM_VESTING_DURATION + 1);

      const vestingAmount = TEAM_ALLOCATION - (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n;
      const releasable = await vestingManager.getReleasable(teamWallet.address);

      expect(releasable).to.equal(vestingAmount);
    });

    it("Should correctly track released amounts", async function () {
      // Claim TGE
      await vestingManager.connect(teamWallet).claimTGE();

      // Advance 6 months
      await time.increase(6 * 30 * 24 * 60 * 60);

      // Release vested tokens
      await vestingManager.connect(teamWallet).release();

      const schedule = await vestingManager.getVestingSchedule(
        teamWallet.address
      );
      expect(schedule.releasedAmount).to.be.gt(
        (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n
      );
    });
  });

  describe("Vesting Release - Ecosystem", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should have nothing releasable during 12-month cliff", async function () {
      // Advance 6 months (still in cliff)
      await time.increase(6 * 30 * 24 * 60 * 60);

      const releasable = await vestingManager.getReleasable(
        ecosystemWallet.address
      );
      expect(releasable).to.equal(0);
    });

    it("Should start vesting after cliff ends", async function () {
      // Advance past 12-month cliff + 1 month
      await time.increase(13 * 30 * 24 * 60 * 60);

      const releasable = await vestingManager.getReleasable(
        ecosystemWallet.address
      );
      expect(releasable).to.be.gt(0);
    });

    it("Should release all after cliff + 36 month vesting", async function () {
      // Advance past cliff + full vesting
      await time.increase(ECOSYSTEM_CLIFF + ECOSYSTEM_VESTING_DURATION + 1);

      const releasable = await vestingManager.getReleasable(
        ecosystemWallet.address
      );
      expect(releasable).to.equal(ECOSYSTEM_ALLOCATION);
    });
  });

  describe("Vesting Release - Marketing", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should vest linearly over 36 months (no cliff)", async function () {
      // Advance 18 months (halfway)
      await time.increase(18 * 30 * 24 * 60 * 60);

      const releasable = await vestingManager.getReleasable(
        marketingWallet.address
      );
      // Should be approximately half
      const expectedApprox = MARKETING_ALLOCATION / 2n;

      expect(releasable).to.be.closeTo(expectedApprox, expectedApprox / 100n);
    });
  });

  describe("Vesting Release - Seed", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should have nothing during 1-month cliff", async function () {
      // Advance 15 days (still in cliff)
      await time.increase(15 * 24 * 60 * 60);

      const releasable = await vestingManager.getReleasable(seedWallet.address);
      expect(releasable).to.equal(0);
    });

    it("Should release 100% after 1-month cliff", async function () {
      // Advance past 1-month cliff
      await time.increase(SEED_CLIFF + 1);

      const releasable = await vestingManager.getReleasable(seedWallet.address);
      expect(releasable).to.equal(SEED_ALLOCATION);
    });

    it("Should allow full claim after cliff", async function () {
      // Advance past cliff
      await time.increase(SEED_CLIFF + 1);

      const balanceBefore = await rateToken.balanceOf(seedWallet.address);

      await expect(vestingManager.connect(seedWallet).release())
        .to.emit(vestingManager, "TokensReleased")
        .withArgs(seedWallet.address, SEED_ALLOCATION);

      const balanceAfter = await rateToken.balanceOf(seedWallet.address);
      expect(balanceAfter - balanceBefore).to.equal(SEED_ALLOCATION);
    });
  });

  describe("Claim All", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should claim TGE and vested tokens in one transaction", async function () {
      // Advance some time for vesting
      await time.increase(6 * 30 * 24 * 60 * 60);

      const tgeAmount = (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n;
      const balanceBefore = await rateToken.balanceOf(teamWallet.address);

      await vestingManager.connect(teamWallet).claimAll();

      const balanceAfter = await rateToken.balanceOf(teamWallet.address);
      const claimed = balanceAfter - balanceBefore;

      // Should have claimed more than just TGE
      expect(claimed).to.be.gt(tgeAmount);
    });

    it("Should emit both TGEClaimed and TokensReleased events", async function () {
      await time.increase(6 * 30 * 24 * 60 * 60);

      const tx = await vestingManager.connect(teamWallet).claimAll();
      const receipt = await tx.wait();

      // Check for TGEClaimed event
      const tgeEvent = receipt.logs.find((log) => {
        try {
          const parsed = vestingManager.interface.parseLog(log);
          return parsed && parsed.name === "TGEClaimed";
        } catch {
          return false;
        }
      });
      expect(tgeEvent).to.not.be.undefined;

      // Check for TokensReleased event
      const releaseEvent = receipt.logs.find((log) => {
        try {
          const parsed = vestingManager.interface.parseLog(log);
          return parsed && parsed.name === "TokensReleased";
        } catch {
          return false;
        }
      });
      expect(releaseEvent).to.not.be.undefined;
    });

    it("Should only claim vested tokens if TGE already claimed", async function () {
      // First claim TGE separately
      await vestingManager.connect(teamWallet).claimTGE();

      await time.increase(6 * 30 * 24 * 60 * 60);

      const balanceBefore = await rateToken.balanceOf(teamWallet.address);

      await vestingManager.connect(teamWallet).claimAll();

      const balanceAfter = await rateToken.balanceOf(teamWallet.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should revert if nothing to claim", async function () {
      // Use ecosystem wallet which has 0% TGE and is in cliff period
      // At TGE time, ecosystem has nothing to claim (0% TGE + in cliff)
      await expect(
        vestingManager.connect(ecosystemWallet).claimAll()
      ).to.be.revertedWith("Nothing to claim");
    });
  });

  describe("Beneficiary Update", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
    });

    it("Should update beneficiary address", async function () {
      await expect(
        vestingManager.updateBeneficiary(teamWallet.address, newWallet.address)
      )
        .to.emit(vestingManager, "BeneficiaryUpdated")
        .withArgs(teamWallet.address, newWallet.address, "Team");

      // Check old address has no schedule
      const oldSchedule = await vestingManager.getVestingSchedule(
        teamWallet.address
      );
      expect(oldSchedule.initialized).to.be.false;

      // Check new address has the schedule
      const newSchedule = await vestingManager.getVestingSchedule(
        newWallet.address
      );
      expect(newSchedule.initialized).to.be.true;
      expect(newSchedule.totalAmount).to.equal(TEAM_ALLOCATION);
    });

    it("Should update wallet reference for team", async function () {
      await vestingManager.updateBeneficiary(
        teamWallet.address,
        newWallet.address
      );
      expect(await vestingManager.teamWallet()).to.equal(newWallet.address);
    });

    it("Should update wallet reference for ecosystem", async function () {
      await vestingManager.updateBeneficiary(
        ecosystemWallet.address,
        newWallet.address
      );
      expect(await vestingManager.ecosystemWallet()).to.equal(newWallet.address);
    });

    it("Should update wallet reference for marketing", async function () {
      await vestingManager.updateBeneficiary(
        marketingWallet.address,
        newWallet.address
      );
      expect(await vestingManager.marketingWallet()).to.equal(newWallet.address);
    });

    it("Should update wallet reference for seed", async function () {
      await vestingManager.updateBeneficiary(
        seedWallet.address,
        newWallet.address
      );
      expect(await vestingManager.seedWallet()).to.equal(newWallet.address);
    });

    it("Should preserve released amount during transfer", async function () {
      await vestingManager.triggerTGE();
      await vestingManager.connect(teamWallet).claimTGE();

      const oldSchedule = await vestingManager.getVestingSchedule(
        teamWallet.address
      );
      const releasedBefore = oldSchedule.releasedAmount;

      await vestingManager.updateBeneficiary(
        teamWallet.address,
        newWallet.address
      );

      const newSchedule = await vestingManager.getVestingSchedule(
        newWallet.address
      );
      expect(newSchedule.releasedAmount).to.equal(releasedBefore);
      expect(newSchedule.tgeClaimed).to.be.true;
    });

    it("Should reject invalid new address", async function () {
      await expect(
        vestingManager.updateBeneficiary(teamWallet.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("Should reject if old address has no schedule", async function () {
      await expect(
        vestingManager.updateBeneficiary(newWallet.address, owner.address)
      ).to.be.revertedWith("No schedule for old address");
    });

    it("Should reject if new address already has schedule", async function () {
      await expect(
        vestingManager.updateBeneficiary(
          teamWallet.address,
          ecosystemWallet.address
        )
      ).to.be.revertedWith("New address has schedule");
    });

    it("Should reject non-owner update", async function () {
      await expect(
        vestingManager
          .connect(teamWallet)
          .updateBeneficiary(teamWallet.address, newWallet.address)
      ).to.be.revertedWithCustomError(vestingManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Custom Vesting Schedule", function () {
    it("Should create custom vesting schedule", async function () {
      const customAmount = ethers.parseEther("1000000000"); // 1B
      await rateToken.transfer(
        await vestingManager.getAddress(),
        customAmount
      );

      await expect(
        vestingManager.createCustomVestingSchedule(
          newWallet.address,
          customAmount,
          10, // 10% TGE
          90 * 24 * 60 * 60, // 90 day cliff
          365 * 24 * 60 * 60, // 1 year vesting
          "Custom"
        )
      ).to.emit(vestingManager, "VestingScheduleCreated");

      const schedule = await vestingManager.getVestingSchedule(
        newWallet.address
      );
      expect(schedule.totalAmount).to.equal(customAmount);
      expect(schedule.tgeAmount).to.equal(customAmount / 10n);
      expect(schedule.vestingType).to.equal("Custom");
    });

    it("Should reject custom schedule after TGE", async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();

      await expect(
        vestingManager.createCustomVestingSchedule(
          newWallet.address,
          ethers.parseEther("1000000"),
          10,
          0,
          365 * 24 * 60 * 60,
          "Custom"
        )
      ).to.be.revertedWith("TGE already triggered");
    });

    it("Should reject invalid beneficiary", async function () {
      await expect(
        vestingManager.createCustomVestingSchedule(
          ethers.ZeroAddress,
          ethers.parseEther("1000000"),
          10,
          0,
          365 * 24 * 60 * 60,
          "Custom"
        )
      ).to.be.revertedWith("Invalid beneficiary");
    });

    it("Should reject zero amount", async function () {
      await expect(
        vestingManager.createCustomVestingSchedule(
          newWallet.address,
          0,
          10,
          0,
          365 * 24 * 60 * 60,
          "Custom"
        )
      ).to.be.revertedWith("Invalid amount");
    });

    it("Should reject TGE percent over 100", async function () {
      await expect(
        vestingManager.createCustomVestingSchedule(
          newWallet.address,
          ethers.parseEther("1000000"),
          101,
          0,
          365 * 24 * 60 * 60,
          "Custom"
        )
      ).to.be.revertedWith("Invalid TGE percent");
    });

    it("Should reject duplicate beneficiary", async function () {
      await rateToken.transfer(
        await vestingManager.getAddress(),
        ethers.parseEther("2000000")
      );

      await vestingManager.createCustomVestingSchedule(
        newWallet.address,
        ethers.parseEther("1000000"),
        10,
        0,
        365 * 24 * 60 * 60,
        "Custom"
      );

      await expect(
        vestingManager.createCustomVestingSchedule(
          newWallet.address,
          ethers.parseEther("1000000"),
          10,
          0,
          365 * 24 * 60 * 60,
          "Custom2"
        )
      ).to.be.revertedWith("Already exists");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
    });

    it("Should return correct beneficiary count", async function () {
      expect(await vestingManager.getBeneficiaryCount()).to.equal(4);
    });

    it("Should return all beneficiaries", async function () {
      const beneficiaries = await vestingManager.getAllBeneficiaries();
      expect(beneficiaries.length).to.equal(4);
      expect(beneficiaries).to.include(teamWallet.address);
      expect(beneficiaries).to.include(ecosystemWallet.address);
      expect(beneficiaries).to.include(marketingWallet.address);
      expect(beneficiaries).to.include(seedWallet.address);
    });

    it("Should return correct vesting summary", async function () {
      const summary = await vestingManager.getVestingSummary();
      expect(summary.teamTotal).to.equal(TEAM_ALLOCATION);
      expect(summary.ecosystemTotal).to.equal(ECOSYSTEM_ALLOCATION);
      expect(summary.marketingTotal).to.equal(MARKETING_ALLOCATION);
      expect(summary.seedTotal).to.equal(SEED_ALLOCATION);
    });

    it("Should return locked amount before TGE", async function () {
      const locked = await vestingManager.getLockedAmount(teamWallet.address);
      expect(locked).to.equal(TEAM_ALLOCATION);
    });

    it("Should return correct vested amount after time passes", async function () {
      await vestingManager.triggerTGE();
      await time.increase(18 * 30 * 24 * 60 * 60); // 18 months

      const vested = await vestingManager.getVestedAmount(teamWallet.address);
      // TGE (20%) + ~half of remaining (80% * 50% = 40%) = ~60% of total
      const expectedApprox = (TEAM_ALLOCATION * 60n) / 100n;

      expect(vested).to.be.closeTo(expectedApprox, expectedApprox / 50n);
    });

    it("Should return correct pending amount", async function () {
      await vestingManager.triggerTGE();

      // Use ecosystem wallet which has 0% TGE and is in cliff
      // During cliff, pending should be 0
      const pendingEco = await vestingManager.getPendingAmount(ecosystemWallet.address);
      expect(pendingEco).to.equal(0);

      // For team wallet, pending should include TGE
      const pendingTeam = await vestingManager.getPendingAmount(teamWallet.address);
      const tgeAmount = (TEAM_ALLOCATION * TEAM_TGE_PERCENT) / 100n;

      // Pending should be at least the TGE amount
      expect(pendingTeam).to.be.gte(tgeAmount);
    });

    it("Should return next unlock time during cliff", async function () {
      await vestingManager.triggerTGE();

      const nextUnlock = await vestingManager.getNextUnlockTime(
        ecosystemWallet.address
      );
      const tgeTime = await vestingManager.tgeTime();

      // Should be cliff end time
      expect(nextUnlock).to.equal(tgeTime + BigInt(ECOSYSTEM_CLIFF));
    });

    it("Should return 0 for next unlock when fully vested", async function () {
      await vestingManager.triggerTGE();
      await time.increase(SEED_CLIFF + 100); // Past seed cliff

      const nextUnlock = await vestingManager.getNextUnlockTime(
        seedWallet.address
      );
      // Seed has vestingDuration=1 (instant), so fully vested after cliff
      expect(nextUnlock).to.equal(0);
    });

    it("Should return TGE status correctly", async function () {
      expect(await vestingManager.isTGETriggered()).to.be.false;

      await vestingManager.triggerTGE();

      expect(await vestingManager.isTGETriggered()).to.be.true;
    });

    it("Should return TGE time", async function () {
      expect(await vestingManager.getTGETime()).to.equal(0);

      await vestingManager.triggerTGE();

      expect(await vestingManager.getTGETime()).to.be.gt(0);
    });
  });

  describe("Ownable2Step", function () {
    it("Should require two-step ownership transfer", async function () {
      await vestingManager.transferOwnership(newWallet.address);

      // Owner should still be original owner
      expect(await vestingManager.owner()).to.equal(owner.address);
      expect(await vestingManager.pendingOwner()).to.equal(newWallet.address);

      // Accept from newWallet
      await vestingManager.connect(newWallet).acceptOwnership();

      expect(await vestingManager.owner()).to.equal(newWallet.address);
      expect(await vestingManager.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("Should only allow pending owner to accept", async function () {
      await vestingManager.transferOwnership(newWallet.address);

      await expect(
        vestingManager.connect(teamWallet).acceptOwnership()
      ).to.be.revertedWithCustomError(vestingManager, "OwnableUnauthorizedAccount");
    });

    it("Should return correct pendingOwner", async function () {
      expect(await vestingManager.pendingOwner()).to.equal(ethers.ZeroAddress);

      await vestingManager.transferOwnership(newWallet.address);
      expect(await vestingManager.pendingOwner()).to.equal(newWallet.address);
    });

    it("Should allow renounceOwnership to still work", async function () {
      await vestingManager.renounceOwnership();
      expect(await vestingManager.owner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await vestingManager.configureVesting(
        teamWallet.address,
        ecosystemWallet.address,
        marketingWallet.address,
        seedWallet.address
      );
      await vestingManager.triggerTGE();
    });

    it("Should handle release with nothing to release", async function () {
      // Ecosystem wallet has 0% TGE and 12-month cliff
      // During cliff, there's nothing to release
      await expect(
        vestingManager.connect(ecosystemWallet).release()
      ).to.be.revertedWith("Nothing to release");
    });

    it("Should handle non-beneficiary release attempt", async function () {
      await expect(
        vestingManager.connect(newWallet).release()
      ).to.be.revertedWith("No vesting schedule");
    });

    it("Should return 0 releasable for uninitialized address", async function () {
      const releasable = await vestingManager.getReleasable(newWallet.address);
      expect(releasable).to.equal(0);
    });

    it("Should handle multiple claims over time", async function () {
      // Initial claim
      await vestingManager.connect(teamWallet).claimTGE();

      // Claim at 3 months
      await time.increase(3 * 30 * 24 * 60 * 60);
      await vestingManager.connect(teamWallet).release();
      const balance1 = await rateToken.balanceOf(teamWallet.address);

      // Claim at 6 months
      await time.increase(3 * 30 * 24 * 60 * 60);
      await vestingManager.connect(teamWallet).release();
      const balance2 = await rateToken.balanceOf(teamWallet.address);

      // Claim at 36 months (full vesting)
      await time.increase(30 * 30 * 24 * 60 * 60);
      await vestingManager.connect(teamWallet).release();
      const balanceFinal = await rateToken.balanceOf(teamWallet.address);

      expect(balance2).to.be.gt(balance1);
      expect(balanceFinal).to.equal(TEAM_ALLOCATION);
    });
  });

  describe("Duplicate Wallet Addresses (Single-Operator)", function () {
    let singleWallet;
    let singleVesting;
    let freshToken;

    beforeEach(async function () {
      singleWallet = teamWallet; // Use one wallet for all 4 allocations

      // Deploy fresh token and vesting manager for isolation
      const RATEToken = await ethers.getContractFactory("MockRATEToken");
      freshToken = await RATEToken.deploy();
      await freshToken.waitForDeployment();

      const VestingManager = await ethers.getContractFactory("VestingManager");
      singleVesting = await VestingManager.deploy(await freshToken.getAddress());

      // Transfer 52B tokens to vesting
      await freshToken.transfer(
        await singleVesting.getAddress(),
        TOTAL_VESTING
      );
    });

    it("Should configure vesting with same address for all wallets", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );

      expect(await singleVesting.vestingConfigured()).to.be.true;
    });

    it("Should create 4 separate schedules for same address", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );

      const count = await singleVesting.getScheduleCount(singleWallet.address);
      expect(count).to.equal(4);
    });

    it("Should only have 1 unique beneficiary with duplicate addresses", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );

      expect(await singleVesting.getBeneficiaryCount()).to.equal(1);
    });

    it("Should preserve all 52B tokens across 4 schedules", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );

      const summary = await singleVesting.getVestingSummary();
      const totalAcrossSchedules =
        summary.teamTotal +
        summary.ecosystemTotal +
        summary.marketingTotal +
        summary.seedTotal;
      expect(totalAcrossSchedules).to.equal(TOTAL_VESTING);
    });

    it("Should return correct per-type data via getVestingScheduleAt", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );

      const s0 = await singleVesting.getVestingScheduleAt(singleWallet.address, 0);
      expect(s0.totalAmount).to.equal(TEAM_ALLOCATION);
      expect(s0.vestingType).to.equal("Team");

      const s1 = await singleVesting.getVestingScheduleAt(singleWallet.address, 1);
      expect(s1.totalAmount).to.equal(ECOSYSTEM_ALLOCATION);
      expect(s1.vestingType).to.equal("Ecosystem");

      const s2 = await singleVesting.getVestingScheduleAt(singleWallet.address, 2);
      expect(s2.totalAmount).to.equal(MARKETING_ALLOCATION);
      expect(s2.vestingType).to.equal("Marketing");

      const s3 = await singleVesting.getVestingScheduleAt(singleWallet.address, 3);
      expect(s3.totalAmount).to.equal(SEED_ALLOCATION);
      expect(s3.vestingType).to.equal("Seed");
    });

    it("Should claim TGE from Team schedule (20%) with single wallet", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );
      await singleVesting.triggerTGE();

      const balanceBefore = await freshToken.balanceOf(singleWallet.address);
      await singleVesting.connect(singleWallet).claimTGE();
      const balanceAfter = await freshToken.balanceOf(singleWallet.address);

      // Only Team has TGE (20% of 22B = 4.4B)
      const expectedTGE = (TEAM_ALLOCATION * BigInt(TEAM_TGE_PERCENT)) / 100n;
      expect(balanceAfter - balanceBefore).to.equal(expectedTGE);
    });

    it("Should release from all schedules with different timings", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );
      await singleVesting.triggerTGE();
      await singleVesting.connect(singleWallet).claimTGE();

      // After 2 months: Seed cliff (1mo) passed, Team+Marketing vesting active, Ecosystem still in cliff
      await time.increase(2 * 30 * 24 * 60 * 60);

      const balanceBefore = await freshToken.balanceOf(singleWallet.address);
      await singleVesting.connect(singleWallet).release();
      const balanceAfter = await freshToken.balanceOf(singleWallet.address);

      // Should have released Seed (full 5B after cliff) + some Team + some Marketing
      // Ecosystem is still in 12-month cliff, so 0 from it
      expect(balanceAfter - balanceBefore).to.be.gt(SEED_ALLOCATION);
    });

    it("Should release all 52B after full vesting period", async function () {
      await singleVesting.configureVesting(
        singleWallet.address,
        singleWallet.address,
        singleWallet.address,
        singleWallet.address
      );
      await singleVesting.triggerTGE();

      // Fast forward past all vesting periods (12mo cliff + 36mo vesting = 48mo max)
      await time.increase(50 * 30 * 24 * 60 * 60);

      await singleVesting.connect(singleWallet).claimAll();

      const balance = await freshToken.balanceOf(singleWallet.address);
      expect(balance).to.equal(TOTAL_VESTING);
    });
  });
});
