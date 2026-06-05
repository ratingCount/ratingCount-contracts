// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IFairLaunchSale {
    function contribute() external payable;
}

/**
 * @dev Test contract to simulate flash loan attack (two contributions in one block)
 */
contract FlashLoanAttacker {
    IFairLaunchSale public target;

    constructor(address _target) {
        target = IFairLaunchSale(_target);
    }

    function attack() external payable {
        uint256 half = msg.value / 2;
        target.contribute{value: half}();
        target.contribute{value: half}();
    }

    receive() external payable {}
}
