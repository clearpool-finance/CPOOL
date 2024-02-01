// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const autoVestingArgs = require('./config')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile 
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy

  const [ deployer ] = await ethers.getSigners();

  const CPOOL = await hre.ethers.getContractFactory("CPOOL");
  const cpool = await CPOOL.deploy(deployer.address);
  await cpool.deployed();
  console.log("cpool deployed to:", cpool.address);

  const Vesting = await hre.ethers.getContractFactory("Vesting");
  const vesting = await Vesting.deploy(cpool.address);
  await vesting.deployed();
  console.log("Vesting deployed to:", vesting.address);

  const AutoVesting = await hre.ethers.getContractFactory('AutoVesting')
  const autoVesting = await AutoVesting.deploy(autoVestingArgs.cpool, autoVestingArgs.vestingBegin, autoVestingArgs.vestingEnd)
  await autoVesting.deployed()
  console.log("Auto-Vesting deployed to:", autoVesting.address)

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
