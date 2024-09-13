// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

import {
  AccessControl
} from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {
  ERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

import "hardhat/console.sol";

contract MembershipCard is
  ERC721Enumerable,
  AccessControl
{
  uint256 private _nextTokenId;

  address payable public feeReceiverAddress;
  bool public isMintingPaused;
  uint256 public subcriptionPeriodInBlocks;

  mapping(uint256 => uint) public membershipTierFees;
  mapping(uint256 => uint256) public tokenSubscriptionExpirationBlocks;
  mapping(uint256 => uint256) public tokenMembershipTiers;

  event MintingPaused(address indexed account);
  event MintingUnpaused(address indexed account);

  constructor(
    string memory name_,
    string memory symbol_,
    address payable feeReceiverAddress_,
    uint256 defaultTier1Fee_,
    uint256 subcriptionPeriodInBlocks_
  ) ERC721(name_, symbol_) {
    feeReceiverAddress = feeReceiverAddress_;
    membershipTierFees[1] = defaultTier1Fee_;
    subcriptionPeriodInBlocks = subcriptionPeriodInBlocks_;
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _nextTokenId = 1;    
    isMintingPaused = true;
    emit MintingPaused(msg.sender);
  }

  function supportsInterface(bytes4 interfaceId)
    public
    view
    override(AccessControl, ERC721Enumerable)
    returns (bool)
  {
    return super.supportsInterface(interfaceId);
  }

  function setFeeReceiverAddress(address payable feeReceiverAddress_)
    public
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    feeReceiverAddress = feeReceiverAddress_;
  }

  function setMembershipTierFee(
    uint256 tierId,
    uint256 fee
  )
    public
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    require(tierId > 0, "Cannot set fee for tier 0 membership (unsubbed)");
    require(
      membershipTierFees[tierId - 1] < fee,
      "Cannot set a higher tier to a lower fee"
    );
    require(
      tierId - 1 == 0 || membershipTierFees[tierId - 1] != 0,
      "Cannot skip a membership tier"
    );

    membershipTierFees[tierId] = fee;
  }

  function unpauseMinting() public onlyRole(DEFAULT_ADMIN_ROLE) {
    isMintingPaused = false;
    emit MintingUnpaused(msg.sender);
  }

  function pauseMinting() public onlyRole(DEFAULT_ADMIN_ROLE) {
    isMintingPaused = true;
    emit MintingPaused(msg.sender);
  }

  function setSubscriptionPeriod(uint256 subcriptionPeriodInBlocks_)
    public
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    subcriptionPeriodInBlocks = subcriptionPeriodInBlocks_;
  }

  function mint(uint256 tierId, address to) public payable returns (uint256) {
    bool isFeeRequired = !hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
    if (isFeeRequired) {
      require(!isMintingPaused, "Minting is paused");
    }

    uint256 tokenId = _nextTokenId++;
    fundSubscription(tierId, tokenId, 1);
    _safeMint(to, tokenId);

    return tokenId;
  }

  function mint(uint256 tierId) public payable returns (uint256) {
    return mint(tierId, msg.sender);
  }

  function fundSubscription(
    uint256 tokenId,
    uint256 tierId,    
    uint256 times
  ) public payable {
    bool isFeeRequired = !hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
    if (isFeeRequired) {
      uint fee = membershipTierFees[tierId] * times;
      require(fee > 0, "Membership tier is disabled");
      require(msg.value >= fee, "Fee too small");
      uint remainder = msg.value - fee;
      feeReceiverAddress.transfer(fee);
      payable(msg.sender).transfer(remainder);
    } else {
      payable(msg.sender).transfer(msg.value);
    }

    tokenMembershipTiers[tokenId] = tierId;
    tokenSubscriptionExpirationBlocks[tokenId] = block.number
      + subcriptionPeriodInBlocks;
  }
}
