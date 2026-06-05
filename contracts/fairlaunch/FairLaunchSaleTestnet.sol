// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/*
 *  ____    _  _____ ___ _   _  ____    ____  ___  _   _ _   _ _____       _    ___
 * |  _ \  / \|_   _|_ _| \ | |/ ___|  / ___|/ _ \| | | | \ | |_   _|     / \  |_ _|
 * | |_) |/ _ \ | |  | ||  \| | |  _  | |   | | | | | | |  \| | | |      / _ \  | |
 * |  _ </ ___ \| |  | || |\  | |_| | | |___| |_| | |_| | |\  | | |  _  / ___ \ | |
 * |_| \_\_/   \_\_| |___|_| \_|\____|  \____|\___/ \___/|_| \_| |_| (_)/_/   \_\___|
 *
 * RATE Token Fair Launch Sale Contract — TESTNET ONLY
 * Hybrid pricing model: Time (5 minutes) OR Sellout triggers tier advancement
 * Hard Cap: 0.0778 ETH (matches sellout)
 * Sale Allocation: 4M RATE (mirrors production 12/10/8/6/4 ratio)
 * Tier Allocations: 1.2M / 1.0M / 0.8M / 0.6M / 0.4M (front-loaded)
 *
 * @notice TESTNET ONLY — DO NOT DEPLOY TO MAINNET
 * @dev Identical logic to FairLaunchSale but with tiny allocations and short durations
 *      for rapid tier-progression testing. Front-loaded tiers, 5-minute durations, 0.0778 ETH hard cap.
 *
 * Website: https://ratingcount.ai
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUniswapV2RouterTestnet {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function addLiquidityETH(
        address token, uint256 amountTokenDesired, uint256 amountTokenMin,
        uint256 amountETHMin, address to, uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2FactoryTestnet {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title FairLaunchSaleTestnet
 * @notice TESTNET ONLY — DO NOT DEPLOY TO MAINNET
 * @dev Fair launch sale contract with tiered pricing, cancellation, and refund mechanisms.
 *      Test-friendly constants for rapid tier-progression testing.
 *      Mirrors production front-loaded tier structure (12/10/8/6/4 ratio) at 1/10000 scale.
 */
contract FairLaunchSaleTestnet is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum SaleState {
        NOT_STARTED,
        ACTIVE,
        PAUSED,
        COMPLETED,
        CANCELLED,
        FINALIZED
    }

    // ============ Structs ============

    struct Tier {
        uint256 price;
        uint256 allocation;
        uint256 sold;
        uint256 ethRaised;
        uint256 startTime;
        bool completed;
    }

    struct ContributorData {
        uint256 totalEth;
        uint256 totalTokens;
        bool refundClaimed;
        bool tokensClaimed;
    }

    // ============ Constants (TESTNET VALUES) ============

    uint256 public constant TIER_DURATION = 5 minutes;
    uint256 public constant TOTAL_TIERS = 5;
    uint256 public constant TOTAL_SALE_TOKENS = 4_000_000 * 1e18;        // 4M RATE total
    uint256 public constant HARD_CAP = 0.0778 ether;

    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;
    uint256 public constant MAX_CONTRIBUTION_PER_TX = 0.032 ether;
    uint256 public constant MAX_CONTRIBUTION_PER_WALLET = 0.032 ether;

    uint256 public constant GRACE_PERIOD = 5 minutes;

    // Tier prices (ETH per 1M RATE tokens) — matches production prices
    uint256 private constant TIER_1_PRICE = 0.0080 ether;
    uint256 private constant TIER_2_PRICE = 0.0120 ether;
    uint256 private constant TIER_3_PRICE = 0.0180 ether;
    uint256 private constant TIER_4_PRICE = 0.0270 ether;
    uint256 private constant TIER_5_PRICE = 0.0640 ether;

    // Tier allocations (front-loaded: mirrors production 12/10/8/6/4 ratio)
    uint256 private constant TIER_1_ALLOCATION = 1_200_000 * 1e18;       // 1.2M RATE
    uint256 private constant TIER_2_ALLOCATION = 1_000_000 * 1e18;       // 1.0M RATE
    uint256 private constant TIER_3_ALLOCATION =   800_000 * 1e18;       // 0.8M RATE
    uint256 private constant TIER_4_ALLOCATION =   600_000 * 1e18;       // 0.6M RATE
    uint256 private constant TIER_5_ALLOCATION =   400_000 * 1e18;       // 0.4M RATE

    // ============ State Variables ============

    IERC20 public immutable rateToken;
    IUniswapV2RouterTestnet public immutable uniswapRouter;
    address public uniswapPair;
    uint256 public lpTokenAmount;
    uint256 public lpUnlockTime;
    bool public liquidityCreated;
    uint256 public constant LP_LOCK_DURATION = 10 minutes;
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

    constructor(address _rateToken, address _uniswapRouter) Ownable(msg.sender) {
        require(_rateToken != address(0), "Invalid token address");
        require(_uniswapRouter != address(0), "Invalid router address");

        rateToken = IERC20(_rateToken);
        uniswapRouter = IUniswapV2RouterTestnet(_uniswapRouter);
        saleState = SaleState.NOT_STARTED;

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

    function pause() external onlyOwner whenActive {
        saleState = SaleState.PAUSED;
        emit SalePaused(block.timestamp);
    }

    function unpause() external onlyOwner {
        require(saleState == SaleState.PAUSED, "Not paused");
        saleState = SaleState.ACTIVE;
        emit SaleUnpaused(block.timestamp);
    }

    function cancel(string calldata reason) external onlyOwner {
        require(
            saleState == SaleState.ACTIVE || saleState == SaleState.PAUSED,
            "Cannot cancel"
        );

        saleState = SaleState.CANCELLED;
        cancellationTime = block.timestamp;

        emit SaleCancelled(block.timestamp, reason);
    }

    function finalize() external onlyOwner nonReentrant {
        require(saleState == SaleState.COMPLETED, "Not completed");
        require(!liquidityCreated, "Liquidity already created");

        saleState = SaleState.FINALIZED;
        emit SaleFinalized(block.timestamp);

        uint256 ethForLP = address(this).balance;
        uint256 tokensForLP = (ethForLP * 1e24) / TIER_5_PRICE;

        uint256 contractBalance = rateToken.balanceOf(address(this));
        uint256 unclaimedTokens = totalTokensSold - totalTokensClaimed;
        uint256 availableTokens = contractBalance > unclaimedTokens
            ? contractBalance - unclaimedTokens
            : 0;

        if (tokensForLP > availableTokens) {
            tokensForLP = availableTokens;
        }

        address factory = uniswapRouter.factory();
        address weth = uniswapRouter.WETH();
        uniswapPair = IUniswapV2FactoryTestnet(factory).getPair(address(rateToken), weth);

        rateToken.forceApprove(address(uniswapRouter), tokensForLP);

        (uint256 amountToken, uint256 amountETH, uint256 liquidity) = uniswapRouter.addLiquidityETH{value: ethForLP}(
            address(rateToken),
            tokensForLP,
            0,
            0,
            address(this),
            block.timestamp
        );

        if (uniswapPair == address(0)) {
            uniswapPair = IUniswapV2FactoryTestnet(factory).getPair(address(rateToken), weth);
        }

        lpTokenAmount = liquidity;
        lpUnlockTime = block.timestamp + LP_LOCK_DURATION;
        liquidityCreated = true;

        emit LiquidityCreated(uniswapPair, amountToken, amountETH, liquidity);

        uint256 remainingUnsold = rateToken.balanceOf(address(this)) - (totalTokensSold - totalTokensClaimed);
        if (remainingUnsold > 0) {
            rateToken.safeTransfer(BURN_ADDRESS, remainingUnsold);
            emit UnsoldTokensBurned(remainingUnsold);
        }
    }

    function withdrawLPTokens(address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(liquidityCreated, "Liquidity not created");
        require(block.timestamp >= lpUnlockTime, "LP tokens still locked");

        uint256 amount = IERC20(uniswapPair).balanceOf(address(this));
        require(amount > 0, "No LP tokens");

        IERC20(uniswapPair).safeTransfer(to, amount);
        emit LPTokensWithdrawn(to, amount);
    }

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
                    data.refundClaimed = false;
                    totalRefundsClaimed -= amount;
                }
            }
        }
    }

    // ============ Public Functions ============

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

        _checkAndAdvanceTier();

        uint256 ethRemaining = msg.value;
        uint256 totalTokensBought = 0;

        while (ethRemaining > 0 && currentTier < TOTAL_TIERS) {
            Tier storage tier = tiers[currentTier];
            uint256 tokensRemaining = tier.allocation - tier.sold;

            if (tokensRemaining == 0) {
                _advanceTier("Tier sold out");
                continue;
            }

            uint256 maxTokensWithEth = (ethRemaining * 1e24) / tier.price;

            uint256 ethForThisTier;
            uint256 tokensForThisTier;

            if (maxTokensWithEth <= tokensRemaining) {
                tokensForThisTier = maxTokensWithEth;
                ethForThisTier = ethRemaining;
            } else {
                tokensForThisTier = tokensRemaining;
                ethForThisTier = (tokensForThisTier * tier.price) / 1e24;
            }

            tier.sold += tokensForThisTier;
            tier.ethRaised += ethForThisTier;

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

            if (tier.sold >= tier.allocation) {
                _advanceTier("Tier sold out");
            }
        }

        uint256 ethUsed = msg.value - ethRemaining;
        contributions[msg.sender].totalEth += ethUsed;
        contributions[msg.sender].totalTokens += totalTokensBought;
        totalEthRaised += ethUsed;
        totalTokensSold += totalTokensBought;

        if (!isContributor[msg.sender]) {
            isContributor[msg.sender] = true;
            contributors.push(msg.sender);
        }

        if (ethRemaining > 0) {
            (bool success, ) = msg.sender.call{value: ethRemaining, gas: 50000}("");
            require(success, "Excess refund failed");
            emit ExcessRefunded(msg.sender, ethRemaining);
        }

        if (currentTier >= TOTAL_TIERS || totalEthRaised >= HARD_CAP) {
            _completeSale();
        }
    }

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

    function checkTierAdvancement() external {
        require(saleState == SaleState.ACTIVE, "Not active");
        _checkAndAdvanceTier();

        if (currentTier >= TOTAL_TIERS) {
            _completeSale();
        }
    }

    // ============ Internal Functions ============

    function _checkAndAdvanceTier() internal {
        while (currentTier < TOTAL_TIERS) {
            Tier storage tier = tiers[currentTier];

            if (tier.startTime > 0 && block.timestamp >= tier.startTime + TIER_DURATION) {
                _advanceTier("Time elapsed");
            } else {
                break;
            }
        }
    }

    function _advanceTier(string memory reason) internal {
        if (currentTier >= TOTAL_TIERS) return;

        tiers[currentTier].completed = true;
        emit TierAdvanced(currentTier, block.timestamp, reason);

        currentTier++;

        if (currentTier < TOTAL_TIERS) {
            tiers[currentTier].startTime = block.timestamp;
        }
    }

    function _completeSale() internal {
        saleState = SaleState.COMPLETED;
        saleEndTime = block.timestamp;
        emit SaleCompleted(totalEthRaised, totalTokensSold, block.timestamp);
    }

    // ============ View Functions ============

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

    function getContribution(address contributor) external view returns (
        uint256 totalEth,
        uint256 totalTokens,
        bool refundClaimed,
        bool tokensClaimed
    ) {
        ContributorData storage c = contributions[contributor];
        return (c.totalEth, c.totalTokens, c.refundClaimed, c.tokensClaimed);
    }

    function getContributorCount() external view returns (uint256) {
        return contributors.length;
    }

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

        uint256 maxTokens = (ethAmount * 1e24) / tier.price;

        if (maxTokens <= tokensRemaining) {
            return (maxTokens, ethAmount, currentTier);
        } else {
            uint256 ethNeeded = (tokensRemaining * tier.price) / 1e24;
            return (tokensRemaining, ethNeeded, currentTier);
        }
    }

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

    function hasContributed(address addr) external view returns (bool) {
        return isContributor[addr];
    }

    function getRemainingAllowance(address wallet) external view returns (uint256) {
        uint256 contributed = contributions[wallet].totalEth;
        if (contributed >= MAX_CONTRIBUTION_PER_WALLET) {
            return 0;
        }
        return MAX_CONTRIBUTION_PER_WALLET - contributed;
    }

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

    receive() external payable {
        revert("Use contribute()");
    }
}
