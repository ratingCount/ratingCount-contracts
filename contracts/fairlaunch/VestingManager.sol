// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/*
 *  ____    _  _____ ___ _   _  ____    ____  ___  _   _ _   _ _____       _    ___
 * |  _ \  / \|_   _|_ _| \ | |/ ___|  / ___|/ _ \| | | | \ | |_   _|     / \  |_ _|
 * | |_) |/ _ \ | |  | ||  \| | |  _  | |   | | | | | | |  \| | | |      / _ \  | |
 * |  _ </ ___ \| |  | || |\  | |_| | | |___| |_| | |_| | |\  | | |  _  / ___ \ | |
 * |_| \_\_/   \_\_| |___|_| \_|\____|  \____|\___/ \___/|_| \_| |_| (_)/_/   \_\___|
 *
 * RATE Token Vesting Manager Contract
 * Manages vesting schedules for Team, Ecosystem, Marketing, and Seed allocations
 *
 * Vesting Schedules:
 * - Team (22B): 20% TGE, 36-month linear vesting
 * - Ecosystem (15B): 12-month cliff, 36-month linear vesting
 * - Marketing (10B): 36-month linear vesting
 * - Seed (5B): 1-month lockup, then 100% release
 *
 * Supports multiple schedules per address (single-operator setup)
 *
 * Website: https://ratingcount.ai
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title VestingManager
 * @dev Manages token vesting schedules with cliff and linear release.
 *      Supports multiple schedules per beneficiary address.
 */
contract VestingManager is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    /**
     * @dev Vesting schedule configuration for a beneficiary
     */
    struct VestingSchedule {
        uint256 totalAmount;        // Total tokens to vest
        uint256 releasedAmount;     // Already released tokens
        uint256 tgeAmount;          // Amount released at TGE
        uint256 cliffDuration;      // Cliff period in seconds
        uint256 vestingDuration;    // Vesting period in seconds (after cliff)
        uint256 startTime;          // TGE timestamp (set when TGE triggered)
        bool initialized;           // Schedule has been created
        bool tgeClaimed;            // TGE amount has been claimed
        string vestingType;         // Type identifier (Team, Ecosystem, Marketing, Seed)
    }

    // ============ Constants ============

    uint256 public constant TEAM_ALLOCATION = 22_000_000_000 * 1e18;       // 22B RATE
    uint256 public constant ECOSYSTEM_ALLOCATION = 15_000_000_000 * 1e18;  // 15B RATE
    uint256 public constant MARKETING_ALLOCATION = 10_000_000_000 * 1e18;  // 10B RATE
    uint256 public constant SEED_ALLOCATION = 5_000_000_000 * 1e18;        // 5B RATE
    uint256 public constant TOTAL_VESTING = 52_000_000_000 * 1e18;         // 52B RATE total

    uint256 public constant TEAM_TGE_PERCENT = 20;          // 20% at TGE
    uint256 public constant TEAM_CLIFF = 0;                 // No cliff
    uint256 public constant TEAM_VESTING = 36 * 30 days;    // 36 months

    uint256 public constant ECOSYSTEM_TGE_PERCENT = 0;      // 0% at TGE
    uint256 public constant ECOSYSTEM_CLIFF = 12 * 30 days; // 12 month cliff
    uint256 public constant ECOSYSTEM_VESTING = 36 * 30 days; // 36 months after cliff

    uint256 public constant MARKETING_TGE_PERCENT = 0;      // 0% at TGE
    uint256 public constant MARKETING_CLIFF = 0;            // No cliff
    uint256 public constant MARKETING_VESTING = 36 * 30 days; // 36 months

    uint256 public constant SEED_TGE_PERCENT = 0;           // 0% at TGE
    uint256 public constant SEED_CLIFF = 30 days;           // 1 month cliff
    uint256 public constant SEED_VESTING = 1;               // Instant after cliff

    // ============ State Variables ============

    IERC20 public immutable rateToken;

    uint256 public tgeTime;
    bool public tgeTriggered;
    bool public vestingConfigured;

    /// @dev Multiple schedules per beneficiary (supports duplicate addresses)
    mapping(address => VestingSchedule[]) internal _vestingSchedules;
    address[] public beneficiaries;

    // Wallet addresses
    address public teamWallet;
    address public ecosystemWallet;
    address public marketingWallet;
    address public seedWallet;

    // ============ Events ============

    event VestingScheduleCreated(
        address indexed beneficiary,
        uint256 amount,
        uint256 tgePercent,
        uint256 cliff,
        uint256 duration,
        string vestingType
    );
    event TGETriggered(uint256 timestamp);
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event TGEClaimed(address indexed beneficiary, uint256 amount);
    event VestingConfigured(
        address teamWallet,
        address ecosystemWallet,
        address marketingWallet,
        address seedWallet
    );
    event BeneficiaryUpdated(
        address indexed oldBeneficiary,
        address indexed newBeneficiary,
        string vestingType
    );

    // ============ Constructor ============

    /**
     * @dev Initialize the vesting manager
     * @param _rateToken Address of the RATE token contract
     */
    constructor(address _rateToken) Ownable(msg.sender) {
        require(_rateToken != address(0), "Invalid token address");
        rateToken = IERC20(_rateToken);
    }

    // ============ Admin Functions ============

    /**
     * @dev Configure all vesting schedules in one transaction.
     *      Supports duplicate addresses (e.g., same wallet for multiple allocations).
     * @param _teamWallet Team multi-sig wallet
     * @param _ecosystemWallet Ecosystem multi-sig wallet
     * @param _marketingWallet Marketing multi-sig wallet
     * @param _seedWallet Seed investor wallet
     */
    function configureVesting(
        address _teamWallet,
        address _ecosystemWallet,
        address _marketingWallet,
        address _seedWallet
    ) external onlyOwner {
        require(!vestingConfigured, "Already configured");
        require(_teamWallet != address(0), "Invalid team wallet");
        require(_ecosystemWallet != address(0), "Invalid ecosystem wallet");
        require(_marketingWallet != address(0), "Invalid marketing wallet");
        require(_seedWallet != address(0), "Invalid seed wallet");
        require(
            rateToken.balanceOf(address(this)) >= TOTAL_VESTING,
            "Insufficient tokens"
        );

        // Store wallet addresses
        teamWallet = _teamWallet;
        ecosystemWallet = _ecosystemWallet;
        marketingWallet = _marketingWallet;
        seedWallet = _seedWallet;

        // Create Team schedule (20% TGE, 36 month linear)
        _createVestingSchedule(
            _teamWallet,
            TEAM_ALLOCATION,
            TEAM_TGE_PERCENT,
            TEAM_CLIFF,
            TEAM_VESTING,
            "Team"
        );

        // Create Ecosystem schedule (12 month cliff, 36 month linear)
        _createVestingSchedule(
            _ecosystemWallet,
            ECOSYSTEM_ALLOCATION,
            ECOSYSTEM_TGE_PERCENT,
            ECOSYSTEM_CLIFF,
            ECOSYSTEM_VESTING,
            "Ecosystem"
        );

        // Create Marketing schedule (36 month linear)
        _createVestingSchedule(
            _marketingWallet,
            MARKETING_ALLOCATION,
            MARKETING_TGE_PERCENT,
            MARKETING_CLIFF,
            MARKETING_VESTING,
            "Marketing"
        );

        // Create Seed schedule (1 month lock, instant release)
        _createVestingSchedule(
            _seedWallet,
            SEED_ALLOCATION,
            SEED_TGE_PERCENT,
            SEED_CLIFF,
            SEED_VESTING,
            "Seed"
        );

        vestingConfigured = true;

        emit VestingConfigured(
            _teamWallet,
            _ecosystemWallet,
            _marketingWallet,
            _seedWallet
        );
    }

    /**
     * @dev Trigger Token Generation Event
     * Starts all vesting clocks
     */
    function triggerTGE() external onlyOwner {
        require(vestingConfigured, "Vesting not configured");
        require(!tgeTriggered, "TGE already triggered");

        tgeTriggered = true;
        tgeTime = block.timestamp;

        // Set start time for all schedules of all beneficiaries
        uint256 beneficiaryCount = beneficiaries.length;
        for (uint256 i = 0; i < beneficiaryCount; i++) {
            VestingSchedule[] storage schedules = _vestingSchedules[beneficiaries[i]];
            uint256 scheduleCount = schedules.length;
            for (uint256 j = 0; j < scheduleCount; j++) {
                schedules[j].startTime = block.timestamp;
            }
        }

        emit TGETriggered(block.timestamp);
    }

    /**
     * @dev Update beneficiary address (for wallet migration).
     *      Moves ALL schedules from old to new address.
     * @param oldBeneficiary Current beneficiary address
     * @param newBeneficiary New beneficiary address
     */
    function updateBeneficiary(
        address oldBeneficiary,
        address newBeneficiary
    ) external onlyOwner {
        require(newBeneficiary != address(0), "Invalid address");
        require(
            _vestingSchedules[oldBeneficiary].length > 0,
            "No schedule for old address"
        );
        require(
            _vestingSchedules[newBeneficiary].length == 0,
            "New address has schedule"
        );

        // Move all schedules from old to new
        VestingSchedule[] storage oldSchedules = _vestingSchedules[oldBeneficiary];
        string memory vestingType = oldSchedules[0].vestingType;

        uint256 oldLen = oldSchedules.length;
        for (uint256 i = 0; i < oldLen; i++) {
            _vestingSchedules[newBeneficiary].push(oldSchedules[i]);
        }

        // Clear old schedules
        delete _vestingSchedules[oldBeneficiary];

        // Update beneficiaries array
        uint256 len = beneficiaries.length;
        for (uint256 i = 0; i < len; i++) {
            if (beneficiaries[i] == oldBeneficiary) {
                beneficiaries[i] = newBeneficiary;
                break;
            }
        }

        // Update wallet references
        if (oldBeneficiary == teamWallet) {
            teamWallet = newBeneficiary;
        }
        if (oldBeneficiary == ecosystemWallet) {
            ecosystemWallet = newBeneficiary;
        }
        if (oldBeneficiary == marketingWallet) {
            marketingWallet = newBeneficiary;
        }
        if (oldBeneficiary == seedWallet) {
            seedWallet = newBeneficiary;
        }

        emit BeneficiaryUpdated(oldBeneficiary, newBeneficiary, vestingType);
    }

    /**
     * @dev Create a custom vesting schedule (for additional allocations)
     * @param beneficiary Address to receive tokens
     * @param totalAmount Total tokens to vest
     * @param tgePercent Percentage to release at TGE (0-100)
     * @param cliffDuration Cliff period in seconds
     * @param vestingDuration Vesting period in seconds
     * @param vestingType Type identifier
     */
    function createCustomVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 tgePercent,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string calldata vestingType
    ) external onlyOwner {
        require(!tgeTriggered, "TGE already triggered");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(totalAmount > 0, "Invalid amount");
        require(tgePercent <= 100, "Invalid TGE percent");
        require(_vestingSchedules[beneficiary].length == 0, "Already exists");
        require(
            rateToken.balanceOf(address(this)) >= totalAmount,
            "Insufficient tokens"
        );

        _createVestingSchedule(
            beneficiary,
            totalAmount,
            tgePercent,
            cliffDuration,
            vestingDuration,
            vestingType
        );
    }

    // ============ Public Functions ============

    /**
     * @dev Claim TGE allocation across all schedules
     */
    function claimTGE() external nonReentrant {
        require(tgeTriggered, "TGE not triggered");

        VestingSchedule[] storage schedules = _vestingSchedules[msg.sender];
        require(schedules.length > 0, "No vesting schedule");

        uint256 totalTGE = 0;

        for (uint256 i = 0; i < schedules.length; i++) {
            if (!schedules[i].tgeClaimed && schedules[i].tgeAmount > 0) {
                schedules[i].tgeClaimed = true;
                schedules[i].releasedAmount += schedules[i].tgeAmount;
                totalTGE += schedules[i].tgeAmount;
            }
        }

        require(totalTGE > 0, "No TGE amount");

        rateToken.safeTransfer(msg.sender, totalTGE);

        emit TGEClaimed(msg.sender, totalTGE);
    }

    /**
     * @dev Release vested tokens across all schedules
     */
    function release() external nonReentrant {
        require(tgeTriggered, "TGE not triggered");

        VestingSchedule[] storage schedules = _vestingSchedules[msg.sender];
        require(schedules.length > 0, "No vesting schedule");

        uint256 totalReleasable = 0;

        for (uint256 i = 0; i < schedules.length; i++) {
            uint256 releasable = _computeReleasable(schedules[i]);
            if (releasable > 0) {
                schedules[i].releasedAmount += releasable;
                totalReleasable += releasable;
            }
        }

        require(totalReleasable > 0, "Nothing to release");

        rateToken.safeTransfer(msg.sender, totalReleasable);

        emit TokensReleased(msg.sender, totalReleasable);
    }

    /**
     * @dev Claim both TGE and vested tokens in one transaction across all schedules
     */
    function claimAll() external nonReentrant {
        require(tgeTriggered, "TGE not triggered");

        VestingSchedule[] storage schedules = _vestingSchedules[msg.sender];
        require(schedules.length > 0, "No vesting schedule");

        uint256 totalClaim = 0;
        uint256 totalTGE = 0;
        uint256 totalVested = 0;

        for (uint256 i = 0; i < schedules.length; i++) {
            // Claim TGE if not claimed
            if (!schedules[i].tgeClaimed && schedules[i].tgeAmount > 0) {
                schedules[i].tgeClaimed = true;
                schedules[i].releasedAmount += schedules[i].tgeAmount;
                totalTGE += schedules[i].tgeAmount;
            }

            // Claim vested tokens
            uint256 releasable = _computeReleasable(schedules[i]);
            if (releasable > 0) {
                schedules[i].releasedAmount += releasable;
                totalVested += releasable;
            }
        }

        if (totalTGE > 0) {
            emit TGEClaimed(msg.sender, totalTGE);
        }
        if (totalVested > 0) {
            emit TokensReleased(msg.sender, totalVested);
        }

        totalClaim = totalTGE + totalVested;
        require(totalClaim > 0, "Nothing to claim");
        rateToken.safeTransfer(msg.sender, totalClaim);
    }

    // ============ Internal Functions ============

    /**
     * @dev Internal function to create a vesting schedule.
     *      Pushes to the beneficiary's schedule array (supports multiple per address).
     *      Only adds to the beneficiaries array if the address is new.
     */
    function _createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 tgePercent,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string memory vestingType
    ) internal {
        uint256 tgeAmount = (totalAmount * tgePercent) / 100;

        _vestingSchedules[beneficiary].push(VestingSchedule({
            totalAmount: totalAmount,
            releasedAmount: 0,
            tgeAmount: tgeAmount,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            startTime: 0,
            initialized: true,
            tgeClaimed: false,
            vestingType: vestingType
        }));

        // Only add to beneficiaries array if this is a new address
        if (_vestingSchedules[beneficiary].length == 1) {
            beneficiaries.push(beneficiary);
        }

        emit VestingScheduleCreated(
            beneficiary,
            totalAmount,
            tgePercent,
            cliffDuration,
            vestingDuration,
            vestingType
        );
    }

    /**
     * @dev Compute releasable amount for a schedule
     * @param schedule The vesting schedule to compute for
     */
    function _computeReleasable(
        VestingSchedule storage schedule
    ) internal view returns (uint256) {
        if (!tgeTriggered || schedule.startTime == 0) return 0;

        uint256 vestingStart = schedule.startTime + schedule.cliffDuration;

        // Still in cliff period
        if (block.timestamp < vestingStart) {
            return 0;
        }

        uint256 vestedAmount;
        uint256 vestingAmount = schedule.totalAmount - schedule.tgeAmount;

        if (schedule.vestingDuration == 0 || schedule.vestingDuration == 1) {
            // Instant vesting after cliff (for Seed)
            vestedAmount = vestingAmount;
        } else {
            // Linear vesting
            uint256 elapsed = block.timestamp - vestingStart;
            if (elapsed >= schedule.vestingDuration) {
                vestedAmount = vestingAmount;
            } else {
                vestedAmount = (vestingAmount * elapsed) / schedule.vestingDuration;
            }
        }

        uint256 totalVested = schedule.tgeAmount + vestedAmount;

        // Account for already released (including TGE if claimed)
        if (totalVested <= schedule.releasedAmount) {
            return 0;
        }

        return totalVested - schedule.releasedAmount;
    }

    // ============ View Functions ============

    /**
     * @dev Get the first vesting schedule for an address (backward compatible).
     *      Use getScheduleCount() and getVestingScheduleAt() for multi-schedule access.
     * @param beneficiary Address to query
     */
    function getVestingSchedule(address beneficiary) external view returns (
        uint256 totalAmount,
        uint256 releasedAmount,
        uint256 tgeAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 startTime,
        bool initialized,
        bool tgeClaimed,
        string memory vestingType
    ) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0) {
            return (0, 0, 0, 0, 0, 0, false, false, "");
        }
        VestingSchedule storage s = schedules[0];
        return (
            s.totalAmount,
            s.releasedAmount,
            s.tgeAmount,
            s.cliffDuration,
            s.vestingDuration,
            s.startTime,
            s.initialized,
            s.tgeClaimed,
            s.vestingType
        );
    }

    /**
     * @dev Get a specific vesting schedule by index
     * @param beneficiary Address to query
     * @param index Schedule index (0-based)
     */
    function getVestingScheduleAt(address beneficiary, uint256 index) external view returns (
        uint256 totalAmount,
        uint256 releasedAmount,
        uint256 tgeAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 startTime,
        bool initialized,
        bool tgeClaimed,
        string memory vestingType
    ) {
        require(index < _vestingSchedules[beneficiary].length, "Index out of bounds");
        VestingSchedule storage s = _vestingSchedules[beneficiary][index];
        return (
            s.totalAmount,
            s.releasedAmount,
            s.tgeAmount,
            s.cliffDuration,
            s.vestingDuration,
            s.startTime,
            s.initialized,
            s.tgeClaimed,
            s.vestingType
        );
    }

    /**
     * @dev Get number of vesting schedules for an address
     * @param beneficiary Address to query
     */
    function getScheduleCount(address beneficiary) external view returns (uint256) {
        return _vestingSchedules[beneficiary].length;
    }

    /**
     * @dev Get total releasable amount across all schedules for an address
     * @param beneficiary Address to query
     */
    function getReleasable(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0) return 0;

        uint256 total = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            total += _computeReleasable(schedules[i]);
        }
        return total;
    }

    /**
     * @dev Get total vested amount across all schedules for an address
     * @param beneficiary Address to query
     */
    function getVestedAmount(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0 || !tgeTriggered) return 0;

        uint256 total = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            VestingSchedule storage schedule = schedules[i];
            uint256 vestingStart = schedule.startTime + schedule.cliffDuration;

            if (block.timestamp < vestingStart) {
                // In cliff period, only TGE amount is vested
                if (schedule.tgeClaimed) {
                    total += schedule.tgeAmount;
                }
                continue;
            }

            uint256 vestingAmount = schedule.totalAmount - schedule.tgeAmount;
            uint256 elapsed = block.timestamp - vestingStart;

            if (schedule.vestingDuration == 0 || elapsed >= schedule.vestingDuration) {
                total += schedule.totalAmount;
            } else {
                total += schedule.tgeAmount + (vestingAmount * elapsed) / schedule.vestingDuration;
            }
        }
        return total;
    }

    /**
     * @dev Get total pending (claimable) amount across all schedules for an address
     * @param beneficiary Address to query
     */
    function getPendingAmount(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0 || !tgeTriggered) return 0;

        uint256 pending = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            if (!schedules[i].tgeClaimed) {
                pending += schedules[i].tgeAmount;
            }
            pending += _computeReleasable(schedules[i]);
        }
        return pending;
    }

    /**
     * @dev Get total locked (not yet vested) amount across all schedules for an address
     * @param beneficiary Address to query
     */
    function getLockedAmount(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0) return 0;

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            totalAmount += schedules[i].totalAmount;
        }

        if (!tgeTriggered) {
            return totalAmount;
        }

        uint256 vested = this.getVestedAmount(beneficiary);
        return totalAmount > vested ? totalAmount - vested : 0;
    }

    /**
     * @dev Get number of unique beneficiaries
     */
    function getBeneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }

    /**
     * @dev Get all unique beneficiary addresses
     */
    function getAllBeneficiaries() external view returns (address[] memory) {
        return beneficiaries;
    }

    /**
     * @dev Get vesting summary for all allocations.
     *      When wallets share an address, each returns the total for that address
     *      across all its schedules.
     */
    function getVestingSummary() external view returns (
        uint256 teamTotal,
        uint256 teamReleased,
        uint256 ecosystemTotal,
        uint256 ecosystemReleased,
        uint256 marketingTotal,
        uint256 marketingReleased,
        uint256 seedTotal,
        uint256 seedReleased
    ) {
        return (
            _getScheduleTotalByType(teamWallet, "Team"),
            _getScheduleReleasedByType(teamWallet, "Team"),
            _getScheduleTotalByType(ecosystemWallet, "Ecosystem"),
            _getScheduleReleasedByType(ecosystemWallet, "Ecosystem"),
            _getScheduleTotalByType(marketingWallet, "Marketing"),
            _getScheduleReleasedByType(marketingWallet, "Marketing"),
            _getScheduleTotalByType(seedWallet, "Seed"),
            _getScheduleReleasedByType(seedWallet, "Seed")
        );
    }

    /**
     * @dev Calculate next unlock time for a beneficiary (earliest across all schedules)
     * @param beneficiary Address to query
     */
    function getNextUnlockTime(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (schedules.length == 0 || !tgeTriggered) return 0;

        uint256 earliest = type(uint256).max;
        bool found = false;

        for (uint256 i = 0; i < schedules.length; i++) {
            VestingSchedule storage schedule = schedules[i];
            uint256 vestingStart = schedule.startTime + schedule.cliffDuration;

            if (block.timestamp < vestingStart) {
                // In cliff, next unlock is cliff end
                if (vestingStart < earliest) {
                    earliest = vestingStart;
                    found = true;
                }
            } else {
                uint256 vestingEnd = vestingStart + schedule.vestingDuration;
                if (block.timestamp < vestingEnd) {
                    // Linear vesting - tokens available now
                    return block.timestamp;
                }
                // Fully vested, skip
            }
        }

        return found ? earliest : 0;
    }

    /**
     * @dev Check if TGE has been triggered
     */
    function isTGETriggered() external view returns (bool) {
        return tgeTriggered;
    }

    /**
     * @dev Get TGE timestamp
     */
    function getTGETime() external view returns (uint256) {
        return tgeTime;
    }

    // ============ Internal View Helpers ============

    /**
     * @dev Get totalAmount for a specific vestingType at a wallet address
     */
    function _getScheduleTotalByType(address wallet, string memory vestingType) internal view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[wallet];
        for (uint256 i = 0; i < schedules.length; i++) {
            if (keccak256(bytes(schedules[i].vestingType)) == keccak256(bytes(vestingType))) {
                return schedules[i].totalAmount;
            }
        }
        return 0;
    }

    /**
     * @dev Get releasedAmount for a specific vestingType at a wallet address
     */
    function _getScheduleReleasedByType(address wallet, string memory vestingType) internal view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[wallet];
        for (uint256 i = 0; i < schedules.length; i++) {
            if (keccak256(bytes(schedules[i].vestingType)) == keccak256(bytes(vestingType))) {
                return schedules[i].releasedAmount;
            }
        }
        return 0;
    }
}
