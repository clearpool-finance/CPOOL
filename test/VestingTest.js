const { expect } = require("chai");
const { ethers } = require("hardhat");
const { increaseTime } = require("./Utils");

describe("Vesting Test", function () {
    let CPOOL;
    let vesting;
    let deployer, adr1, adr2;

    beforeEach(async function () {
        [deployer, adr1, adr2, adr3] = await ethers.getSigners();

        ClearpoolToken = await ethers.getContractFactory("CPOOL");
        CPOOL = await ClearpoolToken.deploy(deployer.address);
        await CPOOL.deployed();

        VestingBegin = (await ethers.provider.getBlock()).timestamp + 100;
        VestingCliff = VestingBegin + 10000;
        VestingEnd = VestingBegin + 31536000;

        Vesting = await ethers.getContractFactory("Vesting");
        vesting = await Vesting.deploy(CPOOL.address, VestingBegin, VestingEnd);
    });

    describe("Holding", function () {
        it("Can't hold without approval", async function () {
            await expect(
                vesting.holdTokens([
                    {
                        recipient: adr1.address,
                        amount: 100000,
                        unlocked: 10000,
                        vestingCliff: VestingCliff,
                    },
                ])
            ).to.be.revertedWith(
                "Cpool::transferFrom: transfer amount exceeds spender allowance"
            );
        });

        it("Can't hold with incorrect cliff", async function () {
            await CPOOL.approve(vesting.address, 100000);

            await expect(
                vesting.holdTokens([
                    {
                        recipient: adr1.address,
                        amount: 100000,
                        unlocked: 10000,
                        vestingCliff: VestingBegin - 1,
                    },
                ])
            ).to.be.revertedWith("Vesting::holdTokens: cliff is too early");

            await expect(
                vesting.holdTokens([
                    {
                        recipient: adr1.address,
                        amount: 100000,
                        unlocked: 10000,
                        vestingCliff: VestingEnd,
                    },
                ])
            ).to.be.revertedWith("Vesting::holdTokens: cliff is too late");
        });

        it("Can't hold with incorrect unlock amount", async function () {
            await CPOOL.approve(vesting.address, 100000);
            await expect(
                vesting.holdTokens([
                    {
                        recipient: adr1.address,
                        amount: 100000,
                        unlocked: 100001,
                        vestingCliff: VestingCliff,
                    },
                ])
            ).to.be.revertedWith(
                "Vesting::holdTokens: unlocked can not be greater than amount"
            );
        });

        it("Can't hold zero amount", async function () {
            await expect(
                vesting.holdTokens([
                    {
                        recipient: adr1.address,
                        amount: 0,
                        unlocked: 0,
                        vestingCliff: VestingCliff,
                    },
                ])
            ).to.be.revertedWith(
                "Vesting::holdTokens: can not hold zero amount"
            );
        });

        it("Can hold correct", async function () {
            await CPOOL.approve(vesting.address, 300000);
            await vesting.holdTokens([
                {
                    recipient: adr1.address,
                    amount: 100000,
                    unlocked: 10000,
                    vestingCliff: VestingCliff,
                },
                {
                    recipient: adr2.address,
                    amount: 100000,
                    unlocked: 100000,
                    vestingCliff: VestingCliff,
                },
                {
                    recipient: adr3.address,
                    amount: 100000,
                    unlocked: 0,
                    vestingCliff: VestingBegin,
                },
            ]);

            expect(await CPOOL.balanceOf(adr1.address)).to.equal(10000);
            expect(await CPOOL.balanceOf(adr2.address)).to.equal(100000);
            expect(await CPOOL.balanceOf(adr3.address)).to.equal(0);

            expect(await vesting.vestingCountOf(adr1.address)).to.equal(1);
            expect(await vesting.vestingIds(adr1.address, 0)).to.equal(0);
            const vesting1 = await vesting.vestings(0);
            expect(vesting1.amount).to.equal(90000);
            expect(vesting1.vestingCliff).to.equal(VestingCliff);
            expect(vesting1.lastUpdate).to.equal(VestingBegin);
            expect(vesting1.claimed).to.equal(0);

            expect(await vesting.vestingCountOf(adr2.address)).to.equal(0);

            expect(await vesting.vestingCountOf(adr3.address)).to.equal(1);
            expect(await vesting.vestingIds(adr3.address, 0)).to.equal(1);
            const vesting3 = await vesting.vestings(1);
            expect(vesting3.amount).to.equal(100000);
            expect(vesting3.vestingCliff).to.equal(VestingBegin);
            expect(vesting3.lastUpdate).to.equal(VestingBegin);
            expect(vesting3.claimed).to.equal(0);
        });
    });

    describe("Claim", function () {
        beforeEach(async function () {
            await CPOOL.approve(vesting.address, 100000);
            await vesting.holdTokens([
                {
                    recipient: adr1.address,
                    amount: 100000,
                    unlocked: 10000,
                    vestingCliff: VestingCliff,
                },
            ]);
        });

        it("Claiming zero before cliff", async function () {
            await vesting.claim(adr1.address);
            expect(await CPOOL.balanceOf(adr1.address)).to.equal(10000);
        });

        it("Claiming correct share before vesting end", async function () {
            await increaseTime(100000);
            let tx = await vesting.claim(adr1.address);
            tx = await tx.wait();
            const block = await ethers.provider.getBlock(tx.blockNumber);
            expect(await CPOOL.balanceOf(adr1.address)).to.equal(
                Math.floor(
                    10000 +
                        (90000 * (block.timestamp - VestingBegin)) /
                            (VestingEnd - VestingBegin)
                )
            );
        });

        it("Claiming in parts works correct", async function () {
            await increaseTime(100000);
            await vesting.claim(adr1.address);
            await increaseTime(100000);
            let tx = await vesting.claim(adr1.address);
            tx = await tx.wait();
            const block = await ethers.provider.getBlock(tx.blockNumber);
            expect(await CPOOL.balanceOf(adr1.address)).to.equal(
                Math.floor(
                    10000 +
                        (90000 * (block.timestamp - VestingBegin)) /
                            (VestingEnd - VestingBegin)
                )
            );
        });

        it("Claiming full share after vesting end", async function () {
            await increaseTime(50000000);
            await vesting.claim(adr1.address);
            expect(await CPOOL.balanceOf(adr1.address)).to.equal(100000);
        });
    });
});
