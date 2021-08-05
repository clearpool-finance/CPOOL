
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CPOOL and Vesting Test", function() {

    let CPOOL;
    let TreasuryVester;
    let deployer, adr1, adr2;
    let adr1Address;
    let adr2Address;

    let VestingBegin;
    let VestingEnd;
    let VestingCliff;

    const name = "Clearpool";
    const symbol = "CPOOL";
    const totalSupply = 1000000000;

    beforeEach(async function () {
        ClearpoolToken = await ethers.getContractFactory("CPOOL");
        [deployer, adr1, adr2] = await ethers.getSigners();
        adr1Address = await adr1.getAddress();
        adr2Address = await adr2.getAddress();

        CPOOL = await ClearpoolToken.deploy
        (
            deployer.address //should be hex multisig set deployer jsut for tests
        );
        await CPOOL.deployed();

        Vesting = await ethers.getContractFactory("Vesting");

        TreasuryVester = await Vesting.deploy(CPOOL.address);
        await TreasuryVester.deployed();

        VestingBegin = (await ethers.provider._getBlock()).timestamp + 100;
        VestingCliff = VestingBegin + 10000;
        VestingEnd = VestingBegin + 31536000;

        await CPOOL.transfer(TreasuryVester.address, 100010)
        await TreasuryVester.holdTokens(adr1Address, 100000, VestingBegin, VestingCliff, VestingEnd);
    });

    describe("Deployment", function () {
        it("Should set the right name and symbol", async function () {
            expect(await CPOOL.name()).to.equal(name);
            expect(await CPOOL.symbol()).to.equal(symbol);
        });

        it("Should distribute the right amounts to the right addresses as init ", async function () {
            expect((await CPOOL.balanceOf(deployer.address))/1e18).to.equal(totalSupply);
        });
    });

    describe("Token", function (){
        it("nested delegation", async () => {
            await CPOOL.transfer(adr1Address, 1);
            await CPOOL.transfer(adr2Address, 2);

            let currentVotes0 = await CPOOL.getCurrentVotes(adr1Address);
            let currentVotes1 = await CPOOL.getCurrentVotes(adr2Address);
            expect(currentVotes0).to.be.eq(0);
            expect(currentVotes1).to.be.eq(0);

            await CPOOL.connect(adr1).delegate(adr2Address);
            currentVotes1 = await CPOOL.getCurrentVotes(adr2Address);
            expect(currentVotes1).to.be.eq(1);

            await CPOOL.connect(adr2).delegate(adr2Address);
            currentVotes1 = await CPOOL.getCurrentVotes(adr2Address);
            expect(currentVotes1).to.be.eq(3);

            await CPOOL.connect(adr2).delegate(adr1Address);
            currentVotes1 = await CPOOL.getCurrentVotes(adr2.address);
            expect(currentVotes1).to.be.eq(1);
        });
    });

    describe("Vesting", function () {

        it("Should not hold more tokens", async function (){
            await expect(TreasuryVester.holdTokens(adr1Address, 10, VestingBegin, VestingCliff, VestingEnd)).to.be.revertedWith('Vesting::holdTokens: recipient already have lockup');
            await expect(TreasuryVester.holdTokens(adr2Address, 100000, VestingBegin, VestingCliff, VestingEnd)).to.be.revertedWith('Vesting::holdTokens: notEnoughFunds');
        });

        it ("Should not hold tokens with incorrect VestingBegin", async function (){
            IncorrectBegin = (await ethers.provider._getBlock()).timestamp - 1;
            await expect(TreasuryVester.holdTokens(adr2Address, 10, IncorrectBegin, VestingCliff, VestingEnd)).to.be.revertedWith('Vesting::holdTokens: vesting begin too early');
        });

        it ("Should not hold tokens with incorrect VestingCliff", async function (){
            await expect(TreasuryVester.holdTokens(adr2Address, 10, VestingBegin, VestingBegin - 1, VestingEnd)).to.be.revertedWith('Vesting::holdTokens: cliff is too early');
        });

        it ("Should not hold tokens with incorrect VestingCliff", async function (){
            await expect(TreasuryVester.holdTokens(adr2Address, 10, VestingBegin, VestingCliff, VestingCliff - 1)).to.be.revertedWith('Vesting::holdTokens: end is too early');
        });

        it("Should not claim tokens", async function (){
            await expect(TreasuryVester.claim(adr1Address)).to.be.revertedWith("Vesting::claim: not time yet");
            await expect(TreasuryVester.claim("0x0000000000000000000000000000000000000001")).to.be.revertedWith('Vesting::claim: recipient not valid');
            curentTime = (await ethers.provider._getBlock()).timestamp;
            increasing = VestingCliff - curentTime - 10;
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await expect(TreasuryVester.claim(adr1Address)).to.be.revertedWith("Vesting::claim: not time yet");
        });

        it("Should claim cliffAmount%", async function(){
            curentTime = (await ethers.provider._getBlock()).timestamp;
            increasing = VestingCliff - curentTime;
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(31);
        });

        it("Should claim 25%", async function(){
            curentTime = (await ethers.provider._getBlock()).timestamp;
            increasing = (VestingBegin - curentTime + (VestingEnd-VestingBegin)/4);
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(25000);
        });

        it('should not claim tokens for not valid recipient',async function () {
            curentTime = (await ethers.provider._getBlock()).timestamp;
            increasing = (VestingBegin - curentTime + (VestingEnd-VestingBegin) / 2);
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await expect(TreasuryVester.claim("0x0000000000000000000000000000000000000001")).to.be.revertedWith("Vesting::claim: recipient not valid");
        });

        it("Should claim 50% and then 25% more and then 10%", async function(){
            curentTime = (await ethers.provider._getBlock()).timestamp
            increasing = (VestingBegin - curentTime + (VestingEnd - VestingBegin) / 2);
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(50000);
            curentTime = (await ethers.provider._getBlock()).timestamp
            increasing = (VestingBegin - curentTime + (VestingEnd - VestingBegin) * 0.75);
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(75000);

            curentTime = (await ethers.provider._getBlock()).timestamp
            increasing = (VestingBegin - curentTime + (VestingEnd - VestingBegin) * 0.85);
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(85000);
        });

        it("Should claim 100% and no more", async function(){
            curentTime = (await ethers.provider._getBlock()).timestamp;
            increasing = VestingEnd - curentTime;
            await ethers.provider.send('evm_increaseTime', [increasing]);
            await ethers.provider.send('evm_mine', []);
            expect(await TreasuryVester.getAvailableBalance(adr1Address)).to.equal(100000);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(100000);
            expect(await TreasuryVester.getAvailableBalance(adr1Address)).to.equal(0);


            await ethers.provider.send('evm_increaseTime', [1000000]);
            await ethers.provider.send('evm_mine', []);
            await TreasuryVester.claim(adr1Address);
            expect(await CPOOL.balanceOf(adr1Address)).to.equal(100000);
        });
    });
});
