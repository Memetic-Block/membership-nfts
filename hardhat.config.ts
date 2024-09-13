import type { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox-viem'
import 'solidity-coverage'

const config: HardhatUserConfig = { solidity: "0.8.24" }

export default config
