import {
  loadFixture,
  mineUpTo
} from '@nomicfoundation/hardhat-toolbox-viem/network-helpers'
import { expect } from 'chai'
import hre from 'hardhat'
import { getAddress, parseEther } from 'viem'

describe('MembershipCard', function () {
  async function deploy() {
    const name = "ABCMembershipCard"
    const symbol = "ABCMEMBER"
    const defaultTier1Fee = parseEther('0.01')
    const defaultSubscriptionPeriod = 216_000n
    const [ owner, alice, bob, charls ] = await hre.viem.getWalletClients()

    const publicClient = await hre.viem.getPublicClient()

    const membershipCard = await hre.viem.deployContract(
      "MembershipCard",
      [
        name,
        symbol,
        owner.account.address,
        defaultTier1Fee,
        defaultSubscriptionPeriod
      ]
    )

    const aliceMembershipCard = await hre.viem.getContractAt(
      "MembershipCard",
      membershipCard.address,
      { client: { wallet: alice } }
    )

    return {
      name, symbol, defaultTier1Fee, defaultSubscriptionPeriod,
      owner, alice, bob, charls,
      publicClient,
      membershipCard,
      aliceMembershipCard
    }
  }

  describe('Deployment', function () {
    it('Should ERC165 supportInterface', async function () {
      const { membershipCard } = await loadFixture(deploy)

      expect(
        await membershipCard.read.supportsInterface([ '0x01ffc9a7' ])
      ).to.be.true
    })

    it('Should set name and symbol', async function () {
      const { name, symbol, membershipCard } = await loadFixture(deploy)

      expect(await membershipCard.read.name()).to.equal(name)
      expect(await membershipCard.read.symbol()).to.equal(symbol)
    })

    it('Should grant default admin role to deployer', async function () {
      const { owner, membershipCard } = await loadFixture(deploy)
      
      const defaultAdminRole = await membershipCard.read.DEFAULT_ADMIN_ROLE()

      expect(
        await membershipCard.read.hasRole(
          [ defaultAdminRole, owner.account.address ]
        )
      )
    })

    it('Should set feeReceiverAddress', async function () {
      const { owner, membershipCard } = await loadFixture(deploy)
        
      expect(
        await membershipCard.read.feeReceiverAddress()
      ).to.equal(getAddress(owner.account.address))
    })

    it('Should set default tier 1 fee', async function () {
      const { membershipCard, defaultTier1Fee } = await loadFixture(deploy)

      expect(
        await membershipCard.read.membershipTierFees([ 1n ])
      ).to.equal(defaultTier1Fee)
    })

    it('Should deploy paused', async function () {
      const { membershipCard } = await loadFixture(deploy)

      expect(await membershipCard.read.isMintingPaused()).to.be.true
    })

    it('Should set default subscription period', async function () {
      const {
        membershipCard,
        defaultSubscriptionPeriod
      } = await loadFixture(deploy)

      expect(
        await membershipCard.read.subcriptionPeriodInBlocks()
      ).to.equal(defaultSubscriptionPeriod)
    })
  })

  describe('Access Control', function () {
    describe('Fee Receiver', function () {
      it('Allows admin to set fee receiver', async function () {
        const { alice, membershipCard } = await loadFixture(deploy)

        await membershipCard.write.setFeeReceiverAddress(
          [ alice.account.address ]
        )

        expect(await membershipCard.read.feeReceiverAddress()).to.equal(
          getAddress(alice.account.address)
        )
      })

      it('Prevents others from setting fee receiver', async function () {
        const { alice, aliceMembershipCard } = await loadFixture(deploy)

        await expect(
          aliceMembershipCard.write.setFeeReceiverAddress(
            [ alice.account.address ]
          )
        ).to.be.rejectedWith("AccessControlUnauthorizedAccount")
      })
    })
  })

  describe('Membership Tiers', function () {
    it('Allows admin to set membership tier fees', async function () {
      const { membershipCard } = await loadFixture(deploy)
      const fee = parseEther('0.5')
      const higherFee = fee + parseEther('0.5')

      await membershipCard.write.setMembershipTierFee([ 1n, fee ])

      expect(await membershipCard.read.membershipTierFees([ 1n ])).to.equal(fee)

      await membershipCard.write.setMembershipTierFee([ 2n, higherFee ])

      expect(
        await membershipCard.read.membershipTierFees([ 2n ])
      ).to.equal(higherFee)
    })    

    it('Prevents others from setting membership tier fees', async function () {
      const { aliceMembershipCard, defaultTier1Fee } = await loadFixture(deploy)
      const aliceFee = defaultTier1Fee + parseEther('1')

      await expect(
        aliceMembershipCard.write.setMembershipTierFee([ 0n, aliceFee ])
      ).to.be.rejectedWith('AccessControlUnauthorizedAccount')
    })

    it('Throws if higher tier is set to lower fee', async function () {
      const { membershipCard, defaultTier1Fee } = await loadFixture(deploy)
      const lowerFee = defaultTier1Fee / 2n

      await expect(
        membershipCard.write.setMembershipTierFee([ 2n, lowerFee ])
      ).to.be.rejectedWith('Cannot set a higher tier to a lower fee')
    })

    it('Throws if a tier is skipped', async function () {
      const { membershipCard, defaultTier1Fee } = await loadFixture(deploy)
      const higherFee = defaultTier1Fee + parseEther('2')

      await expect(
        membershipCard.write.setMembershipTierFee([ 3n, higherFee ])
      ).to.be.rejectedWith('Cannot skip a membership tier')
    })

    it('Throws if trying to set a fee for tier 0', async function () {
      const { membershipCard, defaultTier1Fee } = await loadFixture(deploy)
      const tier0Fee = defaultTier1Fee / 2n

      await expect(
        membershipCard.write.setMembershipTierFee([ 0n, tier0Fee ])
      ).to.be.rejectedWith('Cannot set fee for tier 0 membership (unsubbed)')
    })
  })

  describe('Minting', function () {
    it('Allows users to mint for tier 1', async function () {
      const {
        aliceMembershipCard,
        defaultTier1Fee,
        membershipCard
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      const { result: tokenId } = await aliceMembershipCard.simulate.mint(
        [ 1n ],
        { value: defaultTier1Fee }
      )
      
      expect(tokenId).to.equal(1n)
    })

    it('Allows users to mint at higher tiers', async function () {
      const {
        aliceMembershipCard,
        membershipCard,
        defaultTier1Fee
      } = await loadFixture(deploy)
      const tier2Fee = defaultTier1Fee * 2n
      await membershipCard.write.setMembershipTierFee([ 2n, tier2Fee ])
      await membershipCard.write.unpauseMinting()

      const {
        result: tokenId
      } = await aliceMembershipCard.simulate.mint([ 2n ], { value: tier2Fee })

      expect(tokenId).to.equal(1n)
    })

    it('Sends mint fee to feeReceiverAddress', async function () {
      const {
        aliceMembershipCard,
        membershipCard,
        defaultTier1Fee,
        publicClient,
        owner
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      const startingBalance = await publicClient.getBalance({
        address: owner.account.address
      })

      await aliceMembershipCard.write.mint(
        [ 1n ], { value: defaultTier1Fee }
      )

      const endingBalance = await publicClient.getBalance({
        address: owner.account.address
      })

      expect(endingBalance).to.equal(startingBalance + defaultTier1Fee)
    })

    it('Rejects mints not meeting minimum fee', async function () {
      const {
        aliceMembershipCard,
        defaultTier1Fee,
        membershipCard
      } = await loadFixture(deploy)
      const value = defaultTier1Fee / 2n
      await membershipCard.write.unpauseMinting()

      await expect(
        aliceMembershipCard.write.mint([ 1n ], { value })
      ).to.be.rejectedWith('Fee too small')
    })

    it('Rejects mints for disabled tiers (fee=0)', async function () {
      const { aliceMembershipCard, membershipCard } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      await expect(
        aliceMembershipCard.write.mint([ 6n ], { value: 1n })
      ).to.be.rejectedWith('Membership tier is disabled')
    })

    it('Refunds any remaining ether sent over the fee', async function () {
      const {
        alice,
        aliceMembershipCard,
        defaultTier1Fee,
        membershipCard,
        publicClient
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()
      const aliceInitialBalance = await publicClient.getBalance({
        address: alice.account.address
      })
      const value = defaultTier1Fee * 2n

      await aliceMembershipCard.write.mint([ 1n ], { value })

      const aliceEndingBalance = await publicClient.getBalance({
        address: alice.account.address
      })

      expect(aliceEndingBalance >= aliceInitialBalance - value).to.be.true
    })

    it('Allows users to gift mint', async function () {
      const {
        aliceMembershipCard,
        bob,
        membershipCard,
        defaultTier1Fee
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      await aliceMembershipCard.write.mint(
        [ 1n, bob.account.address ],
        { value: defaultTier1Fee }
      )

      const ownerOfTokenOne = await membershipCard.read.ownerOf([ 1n ])
      expect(ownerOfTokenOne).to.equal(getAddress(bob.account.address))
    })

    it('Allows users to gift mint at higher tiers', async function () {
      const {
        aliceMembershipCard,
        bob,
        membershipCard,
        defaultTier1Fee
      } = await loadFixture(deploy)
      const value = defaultTier1Fee * 2n
      await membershipCard.write.unpauseMinting()
      await membershipCard.write.setMembershipTierFee(
        [ 1n, value ]
      )

      await aliceMembershipCard.write.mint(
        [ 1n, bob.account.address ],
        { value }
      )

      const ownerOfTokenOne = await membershipCard.read.ownerOf([ 1n ])
      expect(ownerOfTokenOne).to.equal(getAddress(bob.account.address))
    })

    it('Allows admin to gift mint for no fee', async function () {
      const { alice, membershipCard } = await loadFixture(deploy)

      await membershipCard.write.mint([ 1n, alice.account.address ])

      const ownerOfTokenOne = await membershipCard.read.ownerOf([ 1n ])
      expect(ownerOfTokenOne).to.equal(getAddress(alice.account.address))
    })

    it('Prevents others from gift minting for no fee', async function () {
      const {
        aliceMembershipCard,
        bob,
        membershipCard
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      await expect(
        aliceMembershipCard.write.mint([ 1n, bob.account.address ])
      ).to.be.rejectedWith('Fee too small')
    })

    it('Sends back any sent ether if fee is not required', async function () {
      const { owner, membershipCard, publicClient } = await loadFixture(deploy)
      const value = parseEther('1')
      const startingBalance = await publicClient.getBalance({
        address: owner.account.address
      })

      await membershipCard.write.mint([ 1n ], { value })

      const endingBalance = await publicClient.getBalance({
        address: owner.account.address
      })

      expect(startingBalance - endingBalance < parseEther('1')).to.be.true
    })
  })

  describe('Pausing', function () {
    it('Allows admin to unpause minting', async function () {
      const { membershipCard } = await loadFixture(deploy)

      await membershipCard.write.unpauseMinting()

      expect(await membershipCard.read.isMintingPaused()).to.be.false
    })

    it('Prevents others from unpausing minting', async function () {
      const { aliceMembershipCard } = await loadFixture(deploy)

      await expect(
        aliceMembershipCard.write.unpauseMinting()
      ).to.be.rejectedWith('AccessControlUnauthorizedAccount')
    })

    it('Allows admin to pause minting', async function () {
      const { membershipCard } = await loadFixture(deploy)

      await membershipCard.write.unpauseMinting()
      expect(await membershipCard.read.isMintingPaused()).to.be.false

      await membershipCard.write.pauseMinting()
      expect(await membershipCard.read.isMintingPaused()).to.be.true
    })

    it('Prevents others from pausing minting', async function () {
      const { aliceMembershipCard } = await loadFixture(deploy)

      await expect(
        aliceMembershipCard.write.pauseMinting()
      ).to.be.rejectedWith('AccessControlUnauthorizedAccount')
    })

    it('Emits an event when minting is paused', async function () {
      const { owner, membershipCard } = await loadFixture(deploy)

      await membershipCard.write.pauseMinting()

      const pauseEvents = await membershipCard.getEvents.MintingPaused()
      expect(pauseEvents).to.have.lengthOf(1)
      expect(
        pauseEvents[0].args.account
      ).to.equal(getAddress(owner.account.address))
    })

    it('Emits an event when minting is unpaused', async function () {
      const { owner, membershipCard } = await loadFixture(deploy)

      await membershipCard.write.unpauseMinting()

      const unpauseEvents = await membershipCard.getEvents.MintingUnpaused()
      expect(unpauseEvents).to.have.lengthOf(1)
      expect(
        unpauseEvents[0].args.account
      ).to.equal(getAddress(owner.account.address))
    })

    it('Prevents minting while paused', async function () { 
      const { aliceMembershipCard, defaultTier1Fee } = await loadFixture(deploy)

      await expect(
        aliceMembershipCard.write.mint([ 0n ], { value: defaultTier1Fee })
      ).to.be.rejectedWith('Minting is paused')
    })
  })

  describe('Subscription Status', function () {
    it('Allows admin to set subscription period', async function () {
      const {
        membershipCard,
        defaultSubscriptionPeriod
      } = await loadFixture(deploy)
      const newSubscriptionPeriod = defaultSubscriptionPeriod * 2n

      await membershipCard.write.setSubscriptionPeriod(
        [ newSubscriptionPeriod ]
      )

      expect(
        await membershipCard.read.subcriptionPeriodInBlocks()
      ).to.equal(newSubscriptionPeriod)
    })

    it('Prevents others from setting subscription period', async function () {
      const { aliceMembershipCard } = await loadFixture(deploy)

      await expect(
        aliceMembershipCard.write.setSubscriptionPeriod([ 1n ])
      ).to.be.rejectedWith('AccessControlUnauthorizedAccount')
    })

    it('Charges up a sub when minted', async function () {
      const {
        aliceMembershipCard,
        defaultTier1Fee,
        membershipCard
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()

      await aliceMembershipCard.write.mint([ 1n ], { value: defaultTier1Fee })

      expect(
        await membershipCard.read.tokenMembershipTiers([ 1n ])
      ).to.equal(1n)
    })

    it('Allows users to fund their sub additional times', async function () {
      const {
        aliceMembershipCard,
        defaultTier1Fee,
        defaultSubscriptionPeriod,
        membershipCard
      } = await loadFixture(deploy)
      await membershipCard.write.unpauseMinting()
      await aliceMembershipCard.write.mint([ 1n ], { value: defaultTier1Fee })
      const initialSubscriptionExpirationBlock =
        await membershipCard.read.tokenSubscriptionExpirationBlocks([ 1n ])
      
      // await aliceMembershipCard.write.fundSubscription([])
      
      expect(initialSubscriptionExpirationBlock)
    })

    it('Allows users to upgrade their up')

    it('Allows users to recharge their sub at higher tiers')
    it('Allows users to recharge subs for others at tier 1')
    it('Allows users to recharge subs for others at higher tiers')
    it('Rejects recharge for disabled tiers')
    it('Rejects recharge for lower tier')
    it('Refunds excess ether on recharge')
    it('Allows admin to gift recharge')
  })
})
