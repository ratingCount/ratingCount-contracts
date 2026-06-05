// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockWETH
 * @dev Simple WETH mock for testing
 */
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
}

/**
 * @title MockUniswapV2Pair
 * @dev ERC20 that represents LP tokens
 */
contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;

    constructor(address _token0, address _token1) ERC20("Uniswap V2", "UNI-V2") {
        token0 = _token0;
        token1 = _token1;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockUniswapV2Factory
 * @dev Stores pair mappings, supports getPair()
 */
contract MockUniswapV2Factory {
    mapping(address => mapping(address => address)) public pairs;

    function getPair(address tokenA, address tokenB) external view returns (address) {
        address pair = pairs[tokenA][tokenB];
        if (pair != address(0)) return pair;
        return pairs[tokenB][tokenA];
    }

    function setPair(address tokenA, address tokenB, address pair) external {
        pairs[tokenA][tokenB] = pair;
        pairs[tokenB][tokenA] = pair;
    }
}

/**
 * @title MockUniswapV2Router
 * @dev Mock router implementing addLiquidityETH for testing
 */
contract MockUniswapV2Router {
    MockUniswapV2Factory public immutable factoryContract;
    MockWETH public immutable wethContract;

    constructor() {
        factoryContract = new MockUniswapV2Factory();
        wethContract = new MockWETH();
    }

    function factory() external view returns (address) {
        return address(factoryContract);
    }

    function WETH() external view returns (address) {
        return address(wethContract);
    }

    /**
     * @dev Set up a mock pair for a token. Call before using addLiquidityETH.
     */
    function setupPair(address token) external returns (address pair) {
        MockUniswapV2Pair newPair = new MockUniswapV2Pair(token, address(wethContract));
        pair = address(newPair);
        factoryContract.setPair(token, address(wethContract), pair);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 /* amountTokenMin */,
        uint256 /* amountETHMin */,
        address to,
        uint256 /* deadline */
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        // Transfer tokens from caller
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);

        amountToken = amountTokenDesired;
        amountETH = msg.value;

        // Mint LP tokens (use geometric mean like real Uniswap)
        liquidity = sqrt(amountToken * amountETH);

        // Get pair and mint LP tokens to recipient
        address pair = factoryContract.getPair(token, address(wethContract));
        require(pair != address(0), "Pair not found");
        MockUniswapV2Pair(pair).mint(to, liquidity);
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
