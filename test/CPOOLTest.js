const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { expectRevert } = require("@openzeppelin/test-helpers");
const {
    mineBlock,
    signMessage,
    expectObject,
    startMining,
    stopMining,
} = require("./Utils");
const { AddressZero, MaxUint256 } = ethers.constants;
const { parseUnits } = ethers.utils;

describe("CPOOL Test", function () {
    let CPOOL;
    let accounts, deployer, adr1, adr2;
    let adr1Address;
    let adr2Address;
    let chainId;

    const name = "Clearpool";
    const symbol = "CPOOL";
    const totalSupply = 1000000000;

    beforeEach(async function () {
        ClearpoolToken = await ethers.getContractFactory("CPOOL");
        [deployer, adr1, adr2, ...accounts] = await ethers.getSigners();
        adr1Address = await adr1.getAddress();
        adr2Address = await adr2.getAddress();

        chainId = network.config.chainId;

        CPOOL = await ClearpoolToken.deploy(
            deployer.address //should be hex multisig set deployer jsut for tests
        );
        await CPOOL.deployed();
    });

    describe("Deployment", function () {
        it("Should set the right name and symbol", async function () {
            expect(await CPOOL.name()).to.equal(name);
            expect(await CPOOL.symbol()).to.equal(symbol);
        });

        it("Should distribute the right amounts to the right addresses as init ", async function () {
            expect((await CPOOL.balanceOf(deployer.address)) / 1e18).to.equal(
                totalSupply
            );
        });
    });

    describe("Token", function () {
        const MaxUint96 = ethers.BigNumber.from(
            "79228162514264337593543950335"
        );

        it("Correct allowance", async () => {
            expect(
                await CPOOL.allowance(deployer.address, adr1.address)
            ).to.equal(0);

            await CPOOL.approve(adr1.address, 100);
            expect(
                await CPOOL.allowance(deployer.address, adr1.address)
            ).to.equal(100);

            await CPOOL.approve(adr1.address, MaxUint256);
            expect(
                await CPOOL.allowance(deployer.address, adr1.address)
            ).to.equal(MaxUint96);
        });

        it("Approving max and almost max", async () => {
            await expect(
                CPOOL.approve(adr1.address, MaxUint96.add(1))
            ).to.be.revertedWith("Cpool::approve: amount exceeds 96 bits");
        });

        it("Nested delegation", async () => {
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

    describe("Delegation by signature", () => {
        const Domain = (CPOOL) => ({
            name,
            chainId,
            verifyingContract: CPOOL.address,
        });
        const Types = {
            Delegation: [
                { name: "delegatee", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" },
            ],
        };

        it("reverts if the signatory is invalid", async () => {
            const badBytes =
                "0x6c00000000000000000000000000000000000000000000000000000000000000";
            const delegatee = deployer,
                nonce = 0,
                expiry = 0;
            await expectRevert(
                CPOOL.delegateBySig(
                    delegatee.address,
                    nonce,
                    expiry,
                    0,
                    badBytes,
                    badBytes
                ),
                "Cpool::delegateBySig: invalid signature"
            );
        });

        it("reverts if the nonce is bad ", async () => {
            const delegatee = deployer,
                nonce = 1,
                expiry = 0;
            const { v, r, s } = await signMessage(adr1, Domain(CPOOL), Types, {
                delegatee: delegatee.address,
                nonce: nonce,
                expiry: expiry,
            });

            await expectRevert(
                CPOOL.delegateBySig(delegatee.address, nonce, expiry, v, r, s),
                "Cpool::delegateBySig: invalid nonce"
            );
        });

        it("reverts if the signature has expired", async () => {
            const delegatee = deployer,
                nonce = 0,
                expiry = 0;
            const { v, r, s } = await signMessage(adr1, Domain(CPOOL), Types, {
                delegatee: delegatee.address,
                nonce: nonce,
                expiry: expiry,
            });

            await expectRevert(
                CPOOL.delegateBySig(delegatee.address, nonce, expiry, v, r, s),
                "Cpool::delegateBySig: signature expired"
            );
        });

        it("delegates on behalf of the signatory", async () => {
            const delegatee = deployer,
                nonce = 0,
                expiry = 10e9;
            const { v, r, s } = await signMessage(adr1, Domain(CPOOL), Types, {
                delegatee: delegatee.address,
                nonce: nonce,
                expiry: expiry,
            });

            expect(await CPOOL.delegates(adr1.address)).to.equal(AddressZero);

            let tx = await CPOOL.delegateBySig(
                delegatee.address,
                nonce,
                expiry,
                v,
                r,
                s
            );
            tx = await tx.wait();
            expect(tx.gasUsed.toNumber()).lessThan(100000);
            expect(await CPOOL.delegates(adr1.address)).to.equal(
                deployer.address
            );
        });
    });

    describe("numCheckpoints", () => {
        it("returns the number of checkpoints for a delegate", async () => {
            let tx = await CPOOL.transfer(adr2.address, 100);
            await tx.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(0);

            let t1 = await CPOOL.connect(adr2).delegate(adr1.address);
            t1 = await t1.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(1);

            let t2 = await CPOOL.transfer(adr2.address, 10);
            t2 = await t2.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(2);

            let t3 = await CPOOL.transfer(adr2.address, 10);
            t3 = await t3.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(3);

            let t4 = await CPOOL.connect(adr2).transfer(deployer.address, 20);
            t4 = await t4.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(4);

            expectObject(await CPOOL.checkpoints(adr1.address, 0), {
                fromBlock: t1.blockNumber,
                votes: 100,
            });
            expectObject(await CPOOL.checkpoints(adr1.address, 1), {
                fromBlock: t2.blockNumber,
                votes: 110,
            });
            expectObject(await CPOOL.checkpoints(adr1.address, 2), {
                fromBlock: t3.blockNumber,
                votes: 120,
            });
            expectObject(await CPOOL.checkpoints(adr1.address, 3), {
                fromBlock: t4.blockNumber,
                votes: 100,
            });
        });

        it("does not add more than one checkpoint in a block", async () => {
            await CPOOL.transfer(adr2.address, 100);
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(0);

            await stopMining();

            let t1 = await CPOOL.connect(adr2).delegate(adr1.address);
            let t2 = await CPOOL.transfer(adr2.address, 10);
            let t3 = await CPOOL.transfer(adr2.address, 10);

            await startMining();

            t1 = await t1.wait();
            t2 = await t2.wait();
            t3 = await t3.wait();

            expect(await CPOOL.numCheckpoints(adr1.address)).equal(1);

            expectObject(await CPOOL.checkpoints(adr1.address, 0), {
                fromBlock: t1.blockNumber,
                votes: 120,
            });
            expectObject(await CPOOL.checkpoints(adr1.address, 1), {
                fromBlock: 0,
                votes: 0,
            });
            expectObject(await CPOOL.checkpoints(adr1.address, 2), {
                fromBlock: 0,
                votes: 0,
            });

            let t4 = await CPOOL.transfer(adr2.address, 20);
            t4 = await t4.wait();
            expect(await CPOOL.numCheckpoints(adr1.address)).to.equal(2);
            expectObject(await CPOOL.checkpoints(adr1.address, 1), {
                fromBlock: t4.blockNumber,
                votes: 140,
            });
        });
    });

    describe("getPriorVotes", () => {
        it("reverts if block number >= current block", async () => {
            await expectRevert(
                CPOOL.getPriorVotes(adr1.address, 5e10),
                "Cpool::getPriorVotes: not yet determined"
            );
        });

        it("returns 0 if there are no checkpoints", async () => {
            expect(await CPOOL.getPriorVotes(adr1.address, 0)).to.equal(0);
        });

        it("returns the latest block if >= last checkpoint block", async () => {
            const t1 = await (
                await CPOOL.connect(deployer).delegate(adr1.address)
            ).wait();
            await mineBlock(2);

            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber)
            ).to.equal(parseUnits("1000000000"));
            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber + 1)
            ).to.equal(parseUnits("1000000000"));
        });

        it("returns zero if < first checkpoint block", async () => {
            const t1 = await (
                await CPOOL.connect(deployer).delegate(adr1.address)
            ).wait();
            await mineBlock(2);

            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber - 1)
            ).to.equal(0);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber + 1)
            ).to.equal(parseUnits("1000000000"));
        });

        it("generally returns the voting balance at the appropriate checkpoint", async () => {
            let t1 = await CPOOL.connect(adr2).delegate(adr1.address);
            t1 = await t1.wait();
            await mineBlock(2);

            let t2 = await CPOOL.transfer(adr2.address, 10);
            t2 = await t2.wait();
            await mineBlock(2);

            let t3 = await CPOOL.transfer(adr2.address, 10);
            t3 = await t3.wait();
            await mineBlock(2);

            let t4 = await CPOOL.transfer(adr2.address, 10);
            t4 = await t4.wait();
            await mineBlock(2);

            let t5 = await CPOOL.transfer(adr2.address, 10);
            t5 = await t5.wait();
            await mineBlock(2);

            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber - 1)
            ).to.equal(0);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber)
            ).to.equal(0);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t1.blockNumber + 1)
            ).to.equal(0);

            expect(
                await CPOOL.getPriorVotes(adr1.address, t2.blockNumber)
            ).to.equal(10);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t3.blockNumber)
            ).to.equal(20);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t4.blockNumber)
            ).to.equal(30);

            expect(
                await CPOOL.getPriorVotes(adr1.address, t5.blockNumber - 1)
            ).to.equal(30);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t5.blockNumber)
            ).to.equal(40);
            expect(
                await CPOOL.getPriorVotes(adr1.address, t5.blockNumber + 1)
            ).to.equal(40);
        });
    });
});
