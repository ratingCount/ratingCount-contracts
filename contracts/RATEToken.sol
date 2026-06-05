// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/*
 *  ____    _  _____ ___ _   _  ____    ____  ___  _   _ _   _ _____       _    ___
 * |  _ \  / \|_   _|_ _| \ | |/ ___|  / ___|/ _ \| | | | \ | |_   _|     / \  |_ _|
 * | |_) |/ _ \ | |  | ||  \| | |  _  | |   | | | | | | |  \| | | |      / _ \  | |
 * |  _ </ ___ \| |  | || |\  | |_| | | |___| |_| | |_| | |\  | | |  _  / ___ \ | |
 * |_| \_\_/   \_\_| |___|_| \_|\____|  \____|\___/ \___/|_| \_| |_| (_)/_/   \_\___|
 *
 * Website: https://ratingcount.ai
 * Twitter: https://twitter.com/ratingCount
 * Telegram: https://t.me/ratingCount
 *
 * ratingCount.ai Token (RATE)
 * Aggregate ratings and reviews from across the web using AI
 * Total Supply: 100,000,000,000 RATE (100 Billion)
 *
 * Token Distribution:
 * - Public Sale: 40% (40 Billion) - Fully unlocked
 * - Team & Advisors: 22% (22 Billion) - 20% at TGE, linear vesting over 36 months
 * - Ecosystem: 15% (15 Billion) - 12 month cliff, then linear vesting over 36 months
 * - Marketing: 10% (10 Billion) - Linear vesting over 36 months
 * - Treasury: 8% (8 Billion) - Custom vesting schedule
 * - Seed: 5% (5 Billion) - Fully unlocked 1 month after TGE
 */

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IERC20Metadata is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

contract ERC20 is Context, IERC20, IERC20Metadata {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    string private _name;
    string private _symbol;

    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view virtual override returns (string memory) {
        return _name;
    }

    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - amount);
        }
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender] + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        uint256 currentAllowance = _allowances[_msgSender()][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(_msgSender(), spender, currentAllowance - subtractedValue);
        }
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        uint256 senderBalance = _balances[sender];
        require(senderBalance >= amount, "ERC20: transfer amount exceeds balance");
        unchecked {
            _balances[sender] = senderBalance - amount;
        }
        _balances[recipient] += amount;

        emit Transfer(sender, recipient, amount);
    }

    function _createInitialSupply(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        uint256 accountBalance = _balances[account];
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account] = accountBalance - amount;
        }
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}

contract Ownable is Context {
    address private _owner;
    address private _pendingOwner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    constructor() {
        address msgSender = _msgSender();
        _owner = msgSender;
        emit OwnershipTransferred(address(0), msgSender);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function pendingOwner() public view returns (address) {
        return _pendingOwner;
    }

    modifier onlyOwner() {
        require(_owner == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

    function renounceOwnership() external virtual onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        _owner = address(0);
        _pendingOwner = address(0);
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    function acceptOwnership() external {
        require(_pendingOwner == _msgSender(), "Ownable2Step: caller is not the new owner");
        emit OwnershipTransferred(_owner, _pendingOwner);
        _owner = _pendingOwner;
        _pendingOwner = address(0);
    }
}

interface IDexRouter {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IDexFactory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

contract RatingCountAI is ERC20, Ownable {
    // Supply constants
    uint256 private constant TOTAL_SUPPLY = 100_000_000_000 * 1e18; // 100 billion

    // Allocation constants
    uint256 private constant PUBLIC_SALE_ALLOCATION = 40_000_000_000 * 1e18; // 40%
    uint256 private constant TEAM_ALLOCATION = 22_000_000_000 * 1e18;        // 22%
    uint256 private constant ECOSYSTEM_ALLOCATION = 15_000_000_000 * 1e18;   // 15%
    uint256 private constant MARKETING_ALLOCATION = 10_000_000_000 * 1e18;   // 10%
    uint256 private constant TREASURY_ALLOCATION = 8_000_000_000 * 1e18;     // 8%
    uint256 private constant SEED_ALLOCATION = 5_000_000_000 * 1e18;         // 5%

    // Trading limits
    uint256 public maxBuyAmount;
    uint256 public maxSellAmount;
    uint256 public maxWalletAmount;

    IDexRouter public immutable uniswapV2Router;
    address public immutable uniswapV2Pair;

    bool private swapping;
    uint256 public swapTokensAtAmount;

    // Allocation wallets
    address public publicSaleWallet;
    address public teamWallet;
    address public ecosystemWallet;
    address public marketingWallet;
    address public treasuryWallet;
    address public seedWallet;

    bool public limitsInEffect = true;
    bool public tradingActive = false;
    bool public swapEnabled = false;
    bool public tokensDistributed = false;

    // Tax rates (in basis points: 100 = 1%)
    uint256 public buyTaxRate = 300;  // 3%
    uint256 public sellTaxRate = 300; // 3%

    uint256 private constant MAX_TAX_RATE = 1000; // 10% max

    uint256 public tokensForTreasury;

    // Mappings
    mapping(address => bool) private _isExcludedFromFees;
    mapping(address => bool) public _isExcludedMaxTransactionAmount;
    mapping(address => bool) public automatedMarketMakerPairs;
    mapping(address => bool) public _isBlacklisted;

    // Events
    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);
    event EnabledTrading();
    event RemovedLimits();
    event ExcludeFromFees(address indexed account, bool isExcluded);
    event UpdatedMaxBuyAmount(uint256 newAmount);
    event UpdatedMaxSellAmount(uint256 newAmount);
    event UpdatedMaxWalletAmount(uint256 newAmount);
    event UpdatedTreasuryWallet(address indexed newWallet);
    event MaxTransactionExclusion(address _address, bool excluded);
    event OwnerForcedSwapBack(uint256 timestamp);
    event TransferForeignToken(address token, uint256 amount);
    event TokensDistributed();
    event BlacklistUpdated(address indexed account, bool isBlacklisted);

    constructor(address _routerAddress) ERC20("ratingCount.ai", "RATE") {
        require(_routerAddress != address(0), "Invalid router address");
        address newOwner = msg.sender;

        // Uniswap V2 Router (network-specific address passed via constructor)
        IDexRouter _uniswapV2Router = IDexRouter(_routerAddress);
        _excludeFromMaxTransaction(address(_uniswapV2Router), true);
        uniswapV2Router = _uniswapV2Router;

        // Create pair
        uniswapV2Pair = IDexFactory(_uniswapV2Router.factory()).createPair(
            address(this),
            _uniswapV2Router.WETH()
        );
        _setAutomatedMarketMakerPair(address(uniswapV2Pair), true);

        // Set initial limits (0.5% buy/sell, 1% wallet)
        maxBuyAmount = TOTAL_SUPPLY * 5 / 1000;      // 0.5%
        maxSellAmount = TOTAL_SUPPLY * 5 / 1000;     // 0.5%
        maxWalletAmount = TOTAL_SUPPLY * 10 / 1000;  // 1%
        swapTokensAtAmount = TOTAL_SUPPLY * 5 / 10000; // 0.05%

        // Exclude from limits
        _excludeFromMaxTransaction(newOwner, true);
        _excludeFromMaxTransaction(address(this), true);
        _excludeFromMaxTransaction(address(0xdead), true);

        // Exclude from fees
        excludeFromFees(newOwner, true);
        excludeFromFees(address(this), true);
        excludeFromFees(address(0xdead), true);

        // Mint total supply to owner (will be distributed later)
        _createInitialSupply(newOwner, TOTAL_SUPPLY);
        transferOwnership(newOwner);
    }

    receive() external payable {}

    /**
     * @dev Distribute tokens to allocation wallets
     * Can only be called once by owner
     */
    function distributeTokens(
        address _publicSale,
        address _team,
        address _ecosystem,
        address _marketing,
        address _treasury,
        address _seed
    ) external onlyOwner {
        require(!tokensDistributed, "Tokens already distributed");
        require(
            _publicSale != address(0) &&
            _team != address(0) &&
            _ecosystem != address(0) &&
            _marketing != address(0) &&
            _treasury != address(0) &&
            _seed != address(0),
            "Invalid addresses"
        );

        publicSaleWallet = _publicSale;
        teamWallet = _team;
        ecosystemWallet = _ecosystem;
        marketingWallet = _marketing;
        treasuryWallet = _treasury;
        seedWallet = _seed;

        // Exclude allocation wallets from fees
        excludeFromFees(_publicSale, true);
        excludeFromFees(_team, true);
        excludeFromFees(_ecosystem, true);
        excludeFromFees(_marketing, true);
        excludeFromFees(_treasury, true);
        excludeFromFees(_seed, true);

        // Exclude from max transaction
        _excludeFromMaxTransaction(_publicSale, true);
        _excludeFromMaxTransaction(_team, true);
        _excludeFromMaxTransaction(_ecosystem, true);
        _excludeFromMaxTransaction(_marketing, true);
        _excludeFromMaxTransaction(_treasury, true);
        _excludeFromMaxTransaction(_seed, true);

        // Transfer allocations
        super._transfer(msg.sender, _publicSale, PUBLIC_SALE_ALLOCATION);
        super._transfer(msg.sender, _team, TEAM_ALLOCATION);
        super._transfer(msg.sender, _ecosystem, ECOSYSTEM_ALLOCATION);
        super._transfer(msg.sender, _marketing, MARKETING_ALLOCATION);
        super._transfer(msg.sender, _treasury, TREASURY_ALLOCATION);
        super._transfer(msg.sender, _seed, SEED_ALLOCATION);

        tokensDistributed = true;
        emit TokensDistributed();
    }

    /**
     * @dev Enable trading - can only be called once
     */
    function enableTrading() external onlyOwner {
        require(!tradingActive, "Trading already active");
        require(tokensDistributed, "Must distribute tokens first");
        tradingActive = true;
        swapEnabled = true;
        emit EnabledTrading();
    }

    /**
     * @dev Remove limits after launch phase
     */
    function removeLimits() external onlyOwner {
        limitsInEffect = false;
        emit RemovedLimits();
    }

    /**
     * @dev Update buy/sell tax rates
     */
    function updateTaxRates(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= MAX_TAX_RATE, "Buy tax too high");
        require(_sellTax <= MAX_TAX_RATE, "Sell tax too high");
        buyTaxRate = _buyTax;
        sellTaxRate = _sellTax;
    }

    /**
     * @dev Update trading limits
     */
    function updateMaxBuyAmount(uint256 newNum) external onlyOwner {
        require(newNum >= (TOTAL_SUPPLY * 1 / 1000) / 1e18, "Cannot set below 0.1%");
        maxBuyAmount = newNum * 1e18;
        emit UpdatedMaxBuyAmount(maxBuyAmount);
    }

    function updateMaxSellAmount(uint256 newNum) external onlyOwner {
        require(newNum >= (TOTAL_SUPPLY * 1 / 1000) / 1e18, "Cannot set below 0.1%");
        maxSellAmount = newNum * 1e18;
        emit UpdatedMaxSellAmount(maxSellAmount);
    }

    function updateMaxWalletAmount(uint256 newNum) external onlyOwner {
        require(newNum >= (TOTAL_SUPPLY * 3 / 1000) / 1e18, "Cannot set below 0.3%");
        maxWalletAmount = newNum * 1e18;
        emit UpdatedMaxWalletAmount(maxWalletAmount);
    }

    function updateSwapTokensAtAmount(uint256 newAmount) external onlyOwner {
        require(newAmount >= (TOTAL_SUPPLY * 1 / 100000), "Swap amount too low");
        require(newAmount <= (TOTAL_SUPPLY * 1 / 1000), "Swap amount too high");
        swapTokensAtAmount = newAmount;
    }

    /**
     * @dev Blacklist management
     */
    function setBlacklist(address account, bool blacklisted) external onlyOwner {
        require(account != address(this) && account != uniswapV2Pair, "Cannot blacklist token or pair");
        _isBlacklisted[account] = blacklisted;
        emit BlacklistUpdated(account, blacklisted);
    }

    function setBlacklistBatch(address[] calldata accounts, bool blacklisted) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] != address(this) && accounts[i] != uniswapV2Pair) {
                _isBlacklisted[accounts[i]] = blacklisted;
                emit BlacklistUpdated(accounts[i], blacklisted);
            }
        }
    }

    /**
     * @dev Fee exclusions
     */
    function excludeFromFees(address account, bool excluded) public onlyOwner {
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
    }

    function excludeFromMaxTransaction(address account, bool excluded) public onlyOwner {
        _isExcludedMaxTransactionAmount[account] = excluded;
        emit MaxTransactionExclusion(account, excluded);
    }

    function _excludeFromMaxTransaction(address account, bool excluded) private {
        _isExcludedMaxTransactionAmount[account] = excluded;
        emit MaxTransactionExclusion(account, excluded);
    }

    /**
     * @dev Set AMM pair
     */
    function setAutomatedMarketMakerPair(address pair, bool value) external onlyOwner {
        require(pair != uniswapV2Pair, "Cannot remove main pair");
        _setAutomatedMarketMakerPair(pair, value);
    }

    function _setAutomatedMarketMakerPair(address pair, bool value) private {
        automatedMarketMakerPairs[pair] = value;
        _excludeFromMaxTransaction(pair, value);
        emit SetAutomatedMarketMakerPair(pair, value);
    }

    /**
     * @dev Update treasury wallet
     */
    function setTreasuryWallet(address _treasuryWallet) external onlyOwner {
        require(_treasuryWallet != address(0), "Cannot be zero address");
        treasuryWallet = _treasuryWallet;
        excludeFromFees(_treasuryWallet, true);
        emit UpdatedTreasuryWallet(_treasuryWallet);
    }

    /**
     * @dev Core transfer function with all checks
     */
    function _transfer(address from, address to, uint256 amount) internal override {
        require(from != address(0), "ERC20: transfer from zero address");
        require(to != address(0), "ERC20: transfer to zero address");
        require(amount > 0, "Transfer amount must be greater than zero");
        require(!_isBlacklisted[from], "Sender is blacklisted");
        require(!_isBlacklisted[to], "Recipient is blacklisted");

        // Apply limits during limit phase
        if (limitsInEffect) {
            if (from != owner() && to != owner() && to != address(0) && to != address(0xdead) && !swapping) {
                if (!tradingActive) {
                    require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading not active");
                }

                // Buy
                if (automatedMarketMakerPairs[from] && !_isExcludedMaxTransactionAmount[to]) {
                    require(amount <= maxBuyAmount, "Buy exceeds max");
                    require(amount + balanceOf(to) <= maxWalletAmount, "Max wallet exceeded");
                }
                // Sell
                else if (automatedMarketMakerPairs[to] && !_isExcludedMaxTransactionAmount[from]) {
                    require(amount <= maxSellAmount, "Sell exceeds max");
                }
                // Transfer
                else if (!_isExcludedMaxTransactionAmount[to]) {
                    require(amount + balanceOf(to) <= maxWalletAmount, "Max wallet exceeded");
                }
            }
        }

        uint256 contractTokenBalance = balanceOf(address(this));
        bool canSwap = contractTokenBalance >= swapTokensAtAmount;

        if (
            canSwap &&
            swapEnabled &&
            !swapping &&
            !automatedMarketMakerPairs[from] &&
            !_isExcludedFromFees[from] &&
            !_isExcludedFromFees[to]
        ) {
            swapping = true;
            swapBack();
            swapping = false;
        }

        bool takeFee = !swapping;

        // Remove fees if excluded
        if (_isExcludedFromFees[from] || _isExcludedFromFees[to]) {
            takeFee = false;
        }

        uint256 fees = 0;

        // Take fees on buys/sells, not transfers
        if (takeFee) {
            // Sell
            if (automatedMarketMakerPairs[to] && sellTaxRate > 0) {
                fees = (amount * sellTaxRate) / 10000;
                tokensForTreasury += fees;
            }
            // Buy
            else if (automatedMarketMakerPairs[from] && buyTaxRate > 0) {
                fees = (amount * buyTaxRate) / 10000;
                tokensForTreasury += fees;
            }

            if (fees > 0) {
                super._transfer(from, address(this), fees);
            }

            amount -= fees;
        }

        super._transfer(from, to, amount);
    }

    /**
     * @dev Swap tokens for ETH
     */
    function swapTokensForEth(uint256 tokenAmount) private {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        _approve(address(this), address(uniswapV2Router), tokenAmount);

        uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    /**
     * @dev Swap back collected fees
     */
    function swapBack() private {
        uint256 contractBalance = balanceOf(address(this));
        uint256 totalTokensToSwap = tokensForTreasury;

        if (contractBalance == 0 || totalTokensToSwap == 0) {
            return;
        }

        // Cap swap at 5x threshold
        if (contractBalance > swapTokensAtAmount * 5) {
            contractBalance = swapTokensAtAmount * 5;
        }

        swapTokensForEth(contractBalance);

        tokensForTreasury = 0;

        // Send ETH to treasury
        if (address(this).balance > 0 && treasuryWallet != address(0)) {
            (bool success, ) = treasuryWallet.call{value: address(this).balance}("");
            require(success, "Transfer failed");
        }
    }

    /**
     * @dev Manual swap trigger
     */
    function forceSwapBack() external onlyOwner {
        require(balanceOf(address(this)) > 0, "No tokens to swap");
        swapping = true;
        swapBack();
        swapping = false;
        emit OwnerForcedSwapBack(block.timestamp);
    }

    /**
     * @dev Withdraw stuck tokens
     */
    function withdrawStuckToken(address _token, address _to) external onlyOwner {
        require(_token != address(0), "Invalid token");
        require(_token != address(this), "Cannot withdraw own token");
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "No stuck tokens");
        (bool success, bytes memory data) = address(_token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, _to, balance)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeTransfer failed");
        emit TransferForeignToken(_token, balance);
    }

    /**
     * @dev Withdraw stuck ETH
     */
    function withdrawStuckEth() external onlyOwner {
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @dev View functions
     */
    function isExcludedFromFees(address account) public view returns (bool) {
        return _isExcludedFromFees[account];
    }

    function getAllocationInfo() external view returns (
        address publicSale,
        address team,
        address ecosystem,
        address marketing,
        address treasury,
        address seed
    ) {
        return (
            publicSaleWallet,
            teamWallet,
            ecosystemWallet,
            marketingWallet,
            treasuryWallet,
            seedWallet
        );
    }
}
