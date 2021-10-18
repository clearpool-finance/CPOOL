const { expect } = require("chai");
const { splitSignature } = require("@ethersproject/bytes");

async function signMessage(signer, domain, types, message) {
    return splitSignature(await signer._signTypedData(domain, types, message));
}

function expectEvent(receipt, contractAddress, eventName, args) {
    const event = receipt.events.find(
        (e) => e.address == contractAddress && e.event == eventName
    );
    expect(event).not.to.equal(undefined);
    if (args) {
        expect(event.args, "No arguments in emitted event");
        for (const arg in args) {
            expect(event.args[arg]).to.equal(
                args[arg],
                `Argument ${arg} differs from expected`
            );
        }
    }
    return event ? event?.args : null;
}

function expectObject(real, expected) {
    for (const key in expected) {
        expect(real[key]).equal(expected[key]);
    }
}

function decimal(value) {
    return Math.floor(value * 10000000000);
}

async function mineBlock(count = 1) {
    for (var i = 0; i < count; i++) {
        await ethers.provider.send("evm_mine", []);
    }
}

async function stopMining() {
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_setIntervalMining", [1e9]);
}

async function startMining(mineNow = true) {
    await ethers.provider.send("evm_setAutomine", [true]);
    await ethers.provider.send("evm_setIntervalMining", [0]);
    if (mineNow) {
        await ethers.provider.send("evm_mine", []);
    }
}

async function increaseTime(seconds, mineNow = true) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    if (mineNow) {
        await mineBlock();
    }
}

async function both(contract, method, args = []) {
    const reply = await contract.callStatic[method](...args);
    const receipt = await contract[method](...args);
    return { reply, receipt };
}

module.exports = {
    signMessage,
    expectEvent,
    expectObject,
    decimal,
    mineBlock,
    stopMining,
    startMining,
    increaseTime,
    both,
};
