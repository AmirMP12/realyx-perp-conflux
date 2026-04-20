import { expect } from "chai";
import { ethers } from "hardhat";

describe("HealthLib harness branches", function () {
  it("covers healthy and unhealthy updateProtocolHealth arms", async function () {
    const healthLib = await (await ethers.getContractFactory("HealthLib")).deploy();
    const Harness = await ethers.getContractFactory("HealthLibHarness", {
      libraries: {
        "contracts/libraries/HealthLib.sol:HealthLib": await healthLib.getAddress(),
      },
    });
    const h = await Harness.deploy();

    await h.setBadDebt(0n);
    await h.update(0n); // totalAssets == 0 branch
    let [healthy] = await h.getState();
    expect(healthy).to.equal(true);

    await h.setBadDebt(1_000_000n);
    await h.update(1n); // totalAssets > 0 and over threshold => false branch
    [healthy] = await h.getState();
    expect(healthy).to.equal(false);
  });
});
