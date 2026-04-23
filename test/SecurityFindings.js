const { expect } = require("chai");
const { ethers } = require("hardhat");

// Regression tests for security audit round 1 findings.
// These tests reproduce the verified bugs against the current contracts.
// They are EXPECTED TO FAIL on the vulnerable contracts and PASS after fixes.
describe("Security audit - regression tests", function () {
    let CPOOL, vesting, deployer, user;
    let VestingBegin, VestingCliff, VestingEnd;

    beforeEach(async function () {
        [deployer, user] = await ethers.getSigners();
        const Token = await ethers.getContractFactory("CPOOL");
        CPOOL = await Token.deploy(deployer.address);
        await CPOOL.deployed();

        VestingBegin = (await ethers.provider.getBlock()).timestamp + 100;
        VestingCliff = VestingBegin + 1;
        VestingEnd = VestingBegin + 31536000;

        const Vesting = await ethers.getContractFactory("AutoVesting");
        vesting = await Vesting.deploy(CPOOL.address, VestingBegin, VestingEnd);
    });

    it("AutoVesting.claim must not revert with 256 vesting entries (uint8 overflow)", async function () {
        // Create 260 vesting entries for user across multiple batches.
        // Each batch of 200 params also uses uint8 i internally in holdTokens,
        // so we cap each call at 200 to isolate the claim overflow.
        const perBatch = 200;
        const totalEntries = 260;
        const approveAmount = ethers.BigNumber.from(totalEntries).mul(2);
        await CPOOL.approve(vesting.address, approveAmount);

        let made = 0;
        while (made < totalEntries) {
            const size = Math.min(perBatch, totalEntries - made);
            const params = [];
            for (let j = 0; j < size; j++) {
                params.push({
                    recipient: user.address,
                    amount: 2,
                    unlocked: 0,
                    vestingCliff: VestingCliff,
                });
            }
            await vesting.holdTokens(params);
            made += size;
        }

        expect(await vesting.vestingCountOf(user.address)).to.equal(totalEntries);

        // Fast-forward past cliff
        await ethers.provider.send('evm_increaseTime', [10]);
        await ethers.provider.send('evm_mine', []);

        // With uint8 counter, this reverts with arithmetic panic when i overflows 255.
        // After fix (uint256 counter), it must succeed.
        await expect(vesting.claim(user.address)).to.not.be.reverted;
    });
});
