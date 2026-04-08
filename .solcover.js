module.exports = {
  skipFiles: [
    'interfaces/',
    'test/',
    'base/AccessControlled.sol',
    'modules/AllowListCompliance.sol',
    'modules/DividendKeeper.sol'
  ],
  providerOptions: {
    gasLimit: "0x1fffffffffffff",
  },
  configureYulOptimizer: true,
};
