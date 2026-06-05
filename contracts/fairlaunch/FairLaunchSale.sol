// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/*
 *  ____    _  _____ ___ _   _  ____    ____  ___  _   _ _   _ _____       _    ___
 * |  _ \  / \|_   _|_ _| \ | |/ ___|  / ___|/ _ \| | | | \ | |_   _|     / \  |_ _|
 * | |_) |/ _ \ | |  | ||  \| | |  _  | |   | | | | | | |  \| | | |      / _ \  | |
 * |  _ </ ___ \| |  | || |\  | |_| | | |___| |_| | |_| | |\  | | |  _  / ___ \ | |
 * |_| \_\_/   \_\_| |___|_| \_|\____|  \____|\___/ \___/|_| \_| |_| (_)/_/   \_\___|
 *
 * RATE Token Fair Launch Sale Contract
 * Hybrid pricing model: Time (14 days) OR Sellout triggers tier advancement
 * Hard Cap: 778 ETH (matches sellout)
 * Public Sale Allocation: 40B RATE (40% of total supply)
 * Tier Allocations: 12B / 10B / 8B / 6B / 4B (front-loaded)
 *
 * Website: https://ratingcount.ai
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUniswapV2Router {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function addLiquidityETH(
        address token, uint256 amountTokenDesired, uint256 amountTokenMin,
        uint256 amountETHMin, address to, uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title FairLaunchSale
 * @dev Fair launch sale contract with tiered pricing, cancellation, and refund mechanisms
 */
contract FairLaunchSale is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    /**
     * @dev Sale lifecycle states
     * NOT_STARTED -> ACTIVE <-> PAUSED -> COMPLETED -> FINALIZED
     *                   \-> CANCELLED (terminal)
     */
    enum SaleState {
        NOT_STARTED,    // Initial state
        ACTIVE,         // Sale is live, accepting contributions
        PAUSED,         // Temporarily halted
        COMPLETED,      // Sale ended (sold out or time expired)
        CANCELLED,      // Sale cancelled, refunds available
        FINALIZED       // TGE complete, tokens claimable
    }

    // ============ Structs ============

    /**
     * @dev Pricing tier configuration
     */
    struct Tier {
        uint256 price;          // Price in wei per 1M RATE tokens
        uint256 allocation;     // Total RATE tokens available in tier
        uint256 sold;           // RATE tokens sold in tier
        uint256 ethRaised;      // ETH raised in tier
        uint256 startTime;      // Unix timestamp when tier started
        bool completed;         // Tier completed flag
    }

    /**
     * @dev Individual contributor tracking
     */
    struct ContributorData {
        uint256 totalEth;       // Total ETH contributed
        uint256 totalTokens;    // Total RATE tokens purchased
        bool refundClaimed;     // Refund claimed flag (if cancelled)
        bool tokensClaimed;     // Tokens claimed flag (if finalized)
    }

    // ============ Constants ============

    uint256 public constant TIER_DURATION = 14 days;
    uint256 public constant TOTAL_TIERS = 5;
    uint256 public constant TOTAL_SALE_TOKENS = 40_000_000_000 * 1e18;  // 40B RATE total
    uint256 public constant HARD_CAP = 778 ether;

    uint256 public constant MIN_CONTRIBUTION = 0.05 ether;
    uint256 public constant MAX_CONTRIBUTION_PER_TX = 3.2 ether;
    uint256 public constant MAX_CONTRIBUTION_PER_WALLET = 3.2 ether;

    uint256 public constant GRACE_PERIOD = 30 days;  // Refund grace period

    // Tier prices (ETH per 1M RATE tokens)
    uint256 private constant TIER_1_PRICE = 0.0080 ether;
    uint256 private constant TIER_2_PRICE = 0.0120 ether;
    uint256 private constant TIER_3_PRICE = 0.0180 ether;
    uint256 private constant TIER_4_PRICE = 0.0270 ether;
    uint256 private constant TIER_5_PRICE = 0.0640 ether;

    // Tier allocations (front-loaded: more tokens at lower prices)
    uint256 private constant TIER_1_ALLOCATION = 12_000_000_000 * 1e18;  // 12B RATE
    uint256 private constant TIER_2_ALLOCATION = 10_000_000_000 * 1e18;  // 10B RATE
    uint256 private constant TIER_3_ALLOCATION =  8_000_000_000 * 1e18;  //  8B RATE
    uint256 private constant TIER_4_ALLOCATION =  6_000_000_000 * 1e18;  //  6B RATE
    uint256 private constant TIER_5_ALLOCATION =  4_000_000_000 * 1e18;  //  4B RATE

    // ============ State Variables ============

    IERC20 public immutable rateToken;
    IUniswapV2Router public immutable uniswapRouter;
    address public uniswapPair;
    uint256 public lpTokenAmount;
    uint256 public lpUnlockTime;
    bool public liquidityCreated;
    uint256 public constant LP_LOCK_DURATION = 365 days;
    address public constant BURN_ADDRESS = address(0xdead);

    SaleState public saleState;

    Tier[5] public tiers;
    uint256 public currentTier;

    uint256 public totalEthRaised;
    uint256 public totalTokensSold;

    uint256 public saleStartTime;
    uint256 public saleEndTime;
    uint256 public cancellationTime;

    mapping(address => ContributorData) public contributions;
    mapping(address => mapping(uint256 => uint256)) public ethPerTier;
    mapping(address => mapping(uint256 => uint256)) public tokensPerTier;

    address[] public contributors;
    mapping(address => bool) public isContributor;

    uint256 public totalRefundsClaimed;
    uint256 public totalTokensClaimed;

    mapping(address => uint256) private _lastContributionBlock;

    // ============ Events ============

    event SaleStarted(uint256 startTime);
    event TierAdvanced(uint256 indexed tierIndex, uint256 timestamp, string reason);
    event TokensPurchased(
        address indexed buyer,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 indexed tier,
        uint256 newTierSold
    );
    event SalePaused(uint256 timestamp);
    event SaleUnpaused(uint256 timestamp);
    event SaleCancelled(uint256 timestamp, string reason);
    event SaleCompleted(uint256 totalEth, uint256 totalTokens, uint256 timestamp);
    event SaleFinalized(uint256 timestamp);
    event RefundClaimed(address indexed contributor, uint256 amount);
    event TokensClaimed(address indexed contributor, uint256 amount);
    event LiquidityCreated(address indexed pair, uint256 tokenAmount, uint256 ethAmount, uint256 lpTokens);
    event UnsoldTokensBurned(uint256 amount);
    event LPTokensWithdrawn(address indexed to, uint256 amount);
    event ExcessRefunded(address indexed contributor, uint256 amount);

    // ============ Modifiers ============

    modifier whenActive() {
        require(saleState == SaleState.ACTIVE, "Sale not active");
        _;
    }

    modifier whenNotStarted() {
        require(saleState == SaleState.NOT_STARTED, "Sale already started");
        _;
    }

    // ============ Constructor ============

    /**
     * @dev Initialize the fair launch sale contract
     * @param _rateToken Address of the RATE token contract
     * @param _uniswapRouter Address of the Uniswap V2 Router
     */
    constructor(address _rateToken, address _uniswapRouter) Ownable(msg.sender) {
        require(_rateToken != address(0), "Invalid token address");
        require(_uniswapRouter != address(0), "Invalid router address");

        rateToken = IERC20(_rateToken);
        uniswapRouter = IUniswapV2Router(_uniswapRouter);
        saleState = SaleState.NOT_STARTED;

        // Initialize tiers with pricing and allocations
        uint256[5] memory prices = [
            TIER_1_PRICE,
            TIER_2_PRICE,
            TIER_3_PRICE,
            TIER_4_PRICE,
            TIER_5_PRICE
        ];
        uint256[5] memory allocations = [
            TIER_1_ALLOCATION,
            TIER_2_ALLOCATION,
            TIER_3_ALLOCATION,
            TIER_4_ALLOCATION,
            TIER_5_ALLOCATION
        ];

        for (uint256 i = 0; i < TOTAL_TIERS; i++) {
            tiers[i] = Tier({
                price: prices[i],
                allocation: allocations[i],
                sold: 0,
                ethRaised: 0,
                startTime: 0,
                completed: false
            });
        }
    }

    // ============ Admin Functions ============

    /**
     * @dev Start the fair launch sale
     * Requirements:
     * - Sale must not have started
     * - Contract must hold sufficient tokens
     */
    function startSale() external onlyOwner whenNotStarted {
        require(
            rateToken.balanceOf(address(this)) >= TOTAL_SALE_TOKENS,
            "Insufficient tokens"
        );

        saleState = SaleState.ACTIVE;
        saleStartTime = block.timestamp;
        tiers[0].startTime = block.timestamp;
        currentTier = 0;

        emit SaleStarted(block.timestamp);
    }

    /**
     * @dev Pause the sale temporarily
     */
    function pause() external onlyOwner whenActive {
        saleState = SaleState.PAUSED;
        emit SalePaused(block.timestamp);
    }

    /**
     * @dev Unpause the sale
     */
    function unpause() external onlyOwner {
        require(saleState == SaleState.PAUSED, "Not paused");
        saleState = SaleState.ACTIVE;
        emit SaleUnpaused(block.timestamp);
    }

    /**
     * @dev Cancel the sale and enable refunds
     * @param reason Reason for cancellation (for transparency)
     */
    function cancel(string calldata reason) external onlyOwner {
        require(
            saleState == SaleState.ACTIVE || saleState == SaleState.PAUSED,
            "Cannot cancel"
        );

        saleState = SaleState.CANCELLED;
        cancellationTime = block.timestamp;

        emit SaleCancelled(block.timestamp, reason);
    }

    /**
     * @dev Finalize the sale: create Uniswap V2 LP, lock LP tokens, burn unsold
     * All in one atomic transaction — no separate withdrawal functions
     */
    function finalize() external onlyOwner nonReentrant {
        require(saleState == SaleState.COMPLETED, "Not completed");
        require(!liquidityCreated, "Liquidity already created");

        saleState = SaleState.FINALIZED;
        emit SaleFinalized(block.timestamp);

        // Calculate tokens for LP at last-tier price (TIER_5_PRICE)
        // tokens = (eth * 1e24) / price — same formula as contribute()
        uint256 ethForLP = address(this).balance;
        uint256 tokensForLP = (ethForLP * 1e24) / TIER_5_PRICE;

        // Cap at available unsold tokens (balance minus unclaimed contributor tokens)
        uint256 contractBalance = rateToken.balanceOf(address(this));
        uint256 unclaimedTokens = totalTokensSold - totalTokensClaimed;
        uint256 availableTokens = contractBalance > unclaimedTokens
            ? contractBalance - unclaimedTokens
            : 0;

        if (tokensForLP > availableTokens) {
            tokensForLP = availableTokens;
        }

        // Look up existing pair via factory
        address factory = uniswapRouter.factory();
        address weth = uniswapRouter.WETH();
        uniswapPair = IUniswapV2Factory(factory).getPair(address(rateToken), weth);

        // Approve router to spend tokens
        rateToken.forceApprove(address(uniswapRouter), tokensForLP);

        // Create liquidity with ALL contract ETH
        (uint256 amountToken, uint256 amountETH, uint256 liquidity) = uniswapRouter.addLiquidityETH{value: ethForLP}(
            address(rateToken),
            tokensForLP,
            0,              // amountTokenMin: accept any slippage (atomic, no frontrun risk)
            0,              // amountETHMin: accept any slippage
            address(this),  // LP tokens sent to this contract (self-lock)
            block.timestamp // deadline
        );

        // Update pair address if it was created during addLiquidityETH
        if (uniswapPair == address(0)) {
            uniswapPair = IUniswapV2Factory(factory).getPair(address(rateToken), weth);
        }

        lpTokenAmount = liquidity;
        lpUnlockTime = block.timestamp + LP_LOCK_DURATION;
        liquidityCreated = true;

        emit LiquidityCreated(uniswapPair, amountToken, amountETH, liquidity);

        // Burn remaining unsold tokens to 0xdead
        uint256 remainingUnsold = rateToken.balanceOf(address(this)) - (totalTokensSold - totalTokensClaimed);
        if (remainingUnsold > 0) {
            rateToken.safeTransfer(BURN_ADDRESS, remainingUnsold);
            emit UnsoldTokensBurned(remainingUnsold);
        }
    }

    /**
     * @dev Withdraw LP tokens after lock period expires
     * @param to Address to receive LP tokens
     */
    function withdrawLPTokens(address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(liquidityCreated, "Liquidity not created");
        require(block.timestamp >= lpUnlockTime, "LP tokens still locked");

        uint256 amount = IERC20(uniswapPair).balanceOf(address(this));
        require(amount > 0, "No LP tokens");

        IERC20(uniswapPair).safeTransfer(to, amount);
        emit LPTokensWithdrawn(to, amount);
    }

    /**
     * @dev Emergency function to push refunds to contributors
     * Only available after grace period in cancelled state
     * @param contributorAddresses Array of contributor addresses
     */
    function pushRefunds(address[] calldata contributorAddresses) external onlyOwner {
        require(saleState == SaleState.CANCELLED, "Not cancelled");
        require(
            block.timestamp > cancellationTime + GRACE_PERIOD,
            "Grace period active"
        );

        for (uint256 i = 0; i < contributorAddresses.length; i++) {
            address contributor = contributorAddresses[i];
            ContributorData storage data = contributions[contributor];

            if (data.totalEth > 0 && !data.refundClaimed) {
                uint256 amount = data.totalEth;
                data.refundClaimed = true;
                totalRefundsClaimed += amount;

                (bool success, ) = contributor.call{value: amount, gas: 30000}("");

                if (success) {
                    emit RefundClaimed(contributor, amount);
                } else {
                    // Revert the claim flag if push failed
                    data.refundClaimed = false;
                    totalRefundsClaimed -= amount;
                }
            }
        }
    }

    // ============ Public Functions ============

    /**
     * @dev Contribute ETH to purchase RATE tokens
     * Automatically handles tier advancement and excess refunds
     */
    function contribute() external payable nonReentrant whenActive {
        require(msg.value >= MIN_CONTRIBUTION, "Below minimum");
        require(msg.value <= MAX_CONTRIBUTION_PER_TX, "Above max per tx");
        require(
            contributions[msg.sender].totalEth + msg.value <= MAX_CONTRIBUTION_PER_WALLET,
            "Above max per wallet"
        );
        require(totalEthRaised + msg.value <= HARD_CAP, "Hard cap exceeded");
        require(block.number > _lastContributionBlock[msg.sender], "One contribution per block");
        _lastContributionBlock[msg.sender] = block.number;

        // Check and advance tier if time trigger met
        _checkAndAdvanceTier();

        uint256 ethRemaining = msg.value;
        uint256 totalTokensBought = 0;

        // Process contribution across tiers
        while (ethRemaining > 0 && currentTier < TOTAL_TIERS) {
            Tier storage tier = tiers[currentTier];
            uint256 tokensRemaining = tier.allocation - tier.sold;

            if (tokensRemaining == 0) {
                _advanceTier("Tier sold out");
                continue;
            }

            // Calculate tokens purchasable with remaining ETH
            // Price is per 1M tokens (1M * 1e18 = 1e24)
            // tokens = (eth * 1e24) / price
            uint256 maxTokensWithEth = (ethRemaining * 1e24) / tier.price;

            uint256 ethForThisTier;
            uint256 tokensForThisTier;

            if (maxTokensWithEth <= tokensRemaining) {
                // Can buy all with remaining ETH
                tokensForThisTier = maxTokensWithEth;
                ethForThisTier = ethRemaining;
            } else {
                // Buy remaining tokens in tier
                tokensForThisTier = tokensRemaining;
                // eth = (tokens * price) / 1e24
                ethForThisTier = (tokensForThisTier * tier.price) / 1e24;
            }

            // Update tier state
            tier.sold += tokensForThisTier;
            tier.ethRaised += ethForThisTier;

            // Update contributor per-tier tracking
            ethPerTier[msg.sender][currentTier] += ethForThisTier;
            tokensPerTier[msg.sender][currentTier] += tokensForThisTier;

            totalTokensBought += tokensForThisTier;
            ethRemaining -= ethForThisTier;

            emit TokensPurchased(
                msg.sender,
                ethForThisTier,
                tokensForThisTier,
                currentTier,
                tier.sold
            );

            // Check if tier sold out
            if (tier.sold >= tier.allocation) {
                _advanceTier("Tier sold out");
            }
        }

        // Update global and contributor totals
        uint256 ethUsed = msg.value - ethRemaining;
        contributions[msg.sender].totalEth += ethUsed;
        contributions[msg.sender].totalTokens += totalTokensBought;
        totalEthRaised += ethUsed;
        totalTokensSold += totalTokensBought;

        // Track contributor
        if (!isContributor[msg.sender]) {
            isContributor[msg.sender] = true;
            contributors.push(msg.sender);
        }

        // Refund excess ETH if any
        if (ethRemaining > 0) {
            (bool success, ) = msg.sender.call{value: ethRemaining, gas: 50000}("");
            require(success, "Excess refund failed");
            emit ExcessRefunded(msg.sender, ethRemaining);
        }

        // Check if sale completed
        if (currentTier >= TOTAL_TIERS || totalEthRaised >= HARD_CAP) {
            _completeSale();
        }
    }

    /**
     * @dev Claim purchased tokens after sale is finalized
     */
    function claimTokens() external nonReentrant {
        require(saleState == SaleState.FINALIZED, "Not finalized");

        ContributorData storage data = contributions[msg.sender];
        require(data.totalTokens > 0, "No tokens to claim");
        require(!data.tokensClaimed, "Already claimed");

        uint256 amount = data.totalTokens;
        data.tokensClaimed = true;
        totalTokensClaimed += amount;

        rateToken.safeTransfer(msg.sender, amount);

        emit TokensClaimed(msg.sender, amount);
    }

    /**
     * @dev Claim refund if sale was cancelled
     */
    function claimRefund() external nonReentrant {
        require(saleState == SaleState.CANCELLED, "Not cancelled");

        ContributorData storage data = contributions[msg.sender];
        require(data.totalEth > 0, "No contribution");
        require(!data.refundClaimed, "Already claimed");

        uint256 amount = data.totalEth;
        data.refundClaimed = true;
        totalRefundsClaimed += amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Refund failed");

        emit RefundClaimed(msg.sender, amount);
    }

    /**
     * @dev Manually trigger tier check (public utility)
     * Useful if no contributions and tier should advance by time
     */
    function checkTierAdvancement() external {
        require(saleState == SaleState.ACTIVE, "Not active");
        _checkAndAdvanceTier();

        // Check if all tiers completed by time
        if (currentTier >= TOTAL_TIERS) {
            _completeSale();
        }
    }

    // ============ Internal Functions ============

    /**
     * @dev Check if current tier should advance due to time
     */
    function _checkAndAdvanceTier() internal {
        while (currentTier < TOTAL_TIERS) {
            Tier storage tier = tiers[currentTier];

            // Check time trigger
            if (tier.startTime > 0 && block.timestamp >= tier.startTime + TIER_DURATION) {
                _advanceTier("Time elapsed");
            } else {
                break;
            }
        }
    }

    /**
     * @dev Advance to next tier
     * @param reason Reason for advancement
     */
    function _advanceTier(string memory reason) internal {
        if (currentTier >= TOTAL_TIERS) return;

        tiers[currentTier].completed = true;
        emit TierAdvanced(currentTier, block.timestamp, reason);

        currentTier++;

        if (currentTier < TOTAL_TIERS) {
            tiers[currentTier].startTime = block.timestamp;
        }
    }

    /**
     * @dev Mark sale as completed
     */
    function _completeSale() internal {
        saleState = SaleState.COMPLETED;
        saleEndTime = block.timestamp;
        emit SaleCompleted(totalEthRaised, totalTokensSold, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @dev Get current tier information
     */
    function getCurrentTierInfo() external view returns (
        uint256 tierIndex,
        uint256 price,
        uint256 allocation,
        uint256 sold,
        uint256 remaining,
        uint256 timeRemaining
    ) {
        if (currentTier >= TOTAL_TIERS) {
            return (TOTAL_TIERS, 0, 0, 0, 0, 0);
        }

        Tier storage tier = tiers[currentTier];
        uint256 timeLeft = 0;

        if (tier.startTime > 0) {
            uint256 endTime = tier.startTime + TIER_DURATION;
            if (block.timestamp < endTime) {
                timeLeft = endTime - block.timestamp;
            }
        }

        return (
            currentTier,
            tier.price,
            tier.allocation,
            tier.sold,
            tier.allocation - tier.sold,
            timeLeft
        );
    }

    /**
     * @dev Get contributor information
     * @param contributor Address to query
     */
    function getContribution(address contributor) external view returns (
        uint256 totalEth,
        uint256 totalTokens,
        bool refundClaimed,
        bool tokensClaimed
    ) {
        ContributorData storage c = contributions[contributor];
        return (c.totalEth, c.totalTokens, c.refundClaimed, c.tokensClaimed);
    }

    /**
     * @dev Get total number of contributors
     */
    function getContributorCount() external view returns (uint256) {
        return contributors.length;
    }

    /**
     * @dev Get specific tier information
     * @param tierIndex Tier index (0-4)
     */
    function getTierInfo(uint256 tierIndex) external view returns (
        uint256 price,
        uint256 allocation,
        uint256 sold,
        uint256 ethRaised,
        uint256 startTime,
        bool completed
    ) {
        require(tierIndex < TOTAL_TIERS, "Invalid tier");
        Tier storage tier = tiers[tierIndex];
        return (
            tier.price,
            tier.allocation,
            tier.sold,
            tier.ethRaised,
            tier.startTime,
            tier.completed
        );
    }

    /**
     * @dev Get contributor's per-tier breakdown
     * @param contributor Address to query
     */
    function getContributorTierBreakdown(address contributor) external view returns (
        uint256[5] memory ethAmounts,
        uint256[5] memory tokenAmounts
    ) {
        for (uint256 i = 0; i < TOTAL_TIERS; i++) {
            ethAmounts[i] = ethPerTier[contributor][i];
            tokenAmounts[i] = tokensPerTier[contributor][i];
        }
        return (ethAmounts, tokenAmounts);
    }

    /**
     * @dev Calculate tokens receivable for a given ETH amount at current tier
     * @param ethAmount ETH amount to quote
     */
    function getQuote(uint256 ethAmount) external view returns (
        uint256 tokensReceivable,
        uint256 ethRequired,
        uint256 tierIndex
    ) {
        if (currentTier >= TOTAL_TIERS) {
            return (0, 0, TOTAL_TIERS);
        }

        Tier storage tier = tiers[currentTier];
        uint256 tokensRemaining = tier.allocation - tier.sold;

        // tokens = (eth * 1e24) / price
        uint256 maxTokens = (ethAmount * 1e24) / tier.price;

        if (maxTokens <= tokensRemaining) {
            return (maxTokens, ethAmount, currentTier);
        } else {
            // eth = (tokens * price) / 1e24
            uint256 ethNeeded = (tokensRemaining * tier.price) / 1e24;
            return (tokensRemaining, ethNeeded, currentTier);
        }
    }

    /**
     * @dev Get sale summary statistics
     */
    function getSaleStats() external view returns (
        SaleState state,
        uint256 raised,
        uint256 sold,
        uint256 contributorCount,
        uint256 tier,
        uint256 startTime,
        uint256 endTime
    ) {
        return (
            saleState,
            totalEthRaised,
            totalTokensSold,
            contributors.length,
            currentTier,
            saleStartTime,
            saleEndTime
        );
    }

    /**
     * @dev Check if address has contributed
     * @param addr Address to check
     */
    function hasContributed(address addr) external view returns (bool) {
        return isContributor[addr];
    }

    /**
     * @dev Get remaining contribution capacity for a wallet
     * @param wallet Address to check
     */
    function getRemainingAllowance(address wallet) external view returns (uint256) {
        uint256 contributed = contributions[wallet].totalEth;
        if (contributed >= MAX_CONTRIBUTION_PER_WALLET) {
            return 0;
        }
        return MAX_CONTRIBUTION_PER_WALLET - contributed;
    }

    /**
     * @dev Get LP token lock information
     */
    function getLPInfo() external view returns (
        bool created,
        address pair,
        uint256 lpAmount,
        uint256 unlockTime,
        uint256 timeRemaining
    ) {
        uint256 remaining = 0;
        if (liquidityCreated && block.timestamp < lpUnlockTime) {
            remaining = lpUnlockTime - block.timestamp;
        }
        return (liquidityCreated, uniswapPair, lpTokenAmount, lpUnlockTime, remaining);
    }

    // ============ Receive ============

    /**
     * @dev Reject direct ETH transfers
     */
    receive() external payable {
        revert("Use contribute()");
    }
}
