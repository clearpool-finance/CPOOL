// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract Vesting is Ownable {
    IERC20 public CPOOL;

    struct VestingParams {
        uint256 amount;
        uint256 vestingBegin;
        uint256 vestingCliff;
        uint256 vestingEnd;
        uint256 lastUpdate;
        uint256 claimed;
    }

    mapping (address => VestingParams) public recipients;
    uint256 public vestedAmount;

    constructor(address tokenAddress) {
        CPOOL = IERC20(tokenAddress);
    }


    function holdTokens(
        address recipient_,
        uint256 amount_,
        uint256 vestingBegin_,
        uint256 vestingCliff_,
        uint256 vestingEnd_
    )
        onlyOwner
        external
    {
        require(vestingBegin_ >= block.timestamp, 'Vesting::holdTokens: vesting begin too early');
        require(vestingEnd_ > vestingCliff_, 'Vesting::holdTokens: end is too early');
        require(vestingCliff_ >= vestingBegin_, 'Vesting::holdTokens: cliff is too early');
        require(vestedAmount + amount_ <= CPOOL.balanceOf(address(this)), 'Vesting::holdTokens: notEnoughFunds');
        require(recipients[recipient_].amount == 0, 'Vesting::holdTokens: recipient already have lockup');

        vestedAmount += amount_;
        recipients[recipient_] = VestingParams({
            amount: amount_,
            vestingBegin: vestingBegin_,
            vestingCliff: vestingCliff_,
            vestingEnd: vestingEnd_,
            lastUpdate: vestingBegin_,
            claimed: 0
        });
    }

    function claim(address recipient_) external {
        require(block.timestamp >= recipients[recipient_].vestingCliff, 'Vesting::claim: not time yet');
        require(recipients[recipient_].amount > 0, 'Vesting::claim: recipient not valid');

        uint256 amount = getAvailableBalance(recipient_);
        recipients[recipient_].lastUpdate = block.timestamp;
        recipients[recipient_].claimed += amount;
        require(IERC20(CPOOL).transfer(recipient_, amount), 'Vesting::claim: transfer error');
    }

    function getAvailableBalance(address recipient_) public view returns(uint256) {
        VestingParams memory vestParams = recipients[recipient_];
        uint256 amount;
        if (block.timestamp < vestParams.vestingCliff) {
            return 0;
        }
        if (block.timestamp >= vestParams.vestingEnd) {
            amount = vestParams.amount - vestParams.claimed;
        } else {
            amount = vestParams.amount * (block.timestamp - vestParams.lastUpdate) / (vestParams.vestingEnd - vestParams.vestingBegin);
        }
        return amount;
    }
}
