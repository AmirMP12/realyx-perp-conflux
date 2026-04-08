// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing and testnet deployments
 * @dev Uses 6 decimals like real USDC
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _decimals = 6;

    uint256 public constant MAX_MINT_PER_WALLET = 1_000 * 10 ** 6;
    mapping(address => uint256) public mintedAmount;

    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Public mint function with wallet cap
     * @param amount Amount to mint (in 6 decimals)
     */
    function mint(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(mintedAmount[msg.sender] + amount <= MAX_MINT_PER_WALLET, "Exceeds max wallet mint");

        mintedAmount[msg.sender] += amount;
        _mint(msg.sender, amount);
    }

    /**
     * @notice Owner mint (unlimited) for protocol setup
     */
    function mintTo(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from caller
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function faucet() external {
        uint256 remaining = MAX_MINT_PER_WALLET > mintedAmount[msg.sender]
            ? MAX_MINT_PER_WALLET - mintedAmount[msg.sender]
            : 0;
        require(remaining > 0, "Faucet limit reached");

        uint256 amount = remaining > 1000 * 10 ** 6 ? 1000 * 10 ** 6 : remaining;
        mintedAmount[msg.sender] += amount;
        _mint(msg.sender, amount);
    }
}
