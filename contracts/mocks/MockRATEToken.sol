// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockRATEToken
 * @dev Simple ERC20 token for testing FairLaunchSale and VestingManager
 * Does not include Uniswap integration or tax functionality
 */
contract MockRATEToken is ERC20, Ownable {
    uint256 private constant TOTAL_SUPPLY = 100_000_000_000 * 1e18; // 100 billion

    constructor() ERC20("ratingCount.ai", "RATE") Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    /**
     * @dev Mint additional tokens (for testing only)
     * @param to Address to receive tokens
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
