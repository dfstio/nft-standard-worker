import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import {
  Mina,
  VerificationKey,
  Field,
  AccountUpdate,
  UInt32,
  Bool,
  Cache,
  UInt64,
  fetchLastBlock,
  PublicKey,
  Poseidon,
  UInt8,
} from "o1js";
import {
  fetchMinaAccount,
  initBlockchain,
  accountBalanceMina,
  Memory,
  serializeIndexedMap,
  sendTx,
  pinJSON,
  sleep,
} from "zkcloudworker";
import { TEST_ACCOUNTS } from "../config.js";
import {
  NFT,
  NFTAdmin,
  NFTAdvancedAdmin,
  CollectionData,
  fieldFromString,
  NFTData,
  MintParams,
  nftVerificationKeys,
  BidFactory,
  UInt64Option,
  AuctionFactory,
  Auction,
  AdminData,
  NFTCollectionContractConstructor,
  TransferParams,
  NFTTransactionContext,
  NFTSharesFactory,
  NFTOwnerContractConstructor,
  NFTAdminContractConstructor,
  NFTApprovalContractConstructor,
  NFTStandardOwner,
  DefineApprovalFactory,
  DefineOwnerFactory,
  OfferFactory,
  CollectionFactory,
} from "@minatokens/nft";
import {
  VerificationKeyUpgradeAuthority,
  ChainId,
  ValidatorsList,
  ValidatorsState,
  ValidatorsListData,
  ValidatorsVoting,
} from "@minatokens/upgradable";
import { processArguments } from "./helpers/utils.js";
import { randomMetadata } from "./helpers/metadata.js";
import { Whitelist, Storage } from "@minatokens/storage";

let { chain, useAdvancedAdmin, withdraw, noLog, approveTransfer, shares } =
  processArguments();

let local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;
let name = "NFT";

const networkId = chain === "mainnet" ? "mainnet" : "devnet";
const expectedTxStatus = chain === "zeko" ? "pending" : "included";
const vk = nftVerificationKeys[networkId].vk;

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

let nftContractVk: VerificationKey;
let collectionVk: VerificationKey;
let sharesCollectionVk: VerificationKey;
let sharesApprovalVk: VerificationKey;
let adminVk: VerificationKey;
let sharesAdminVk: VerificationKey;
let upgradeAuthorityVk: VerificationKey;
let validatorsVotingVk: VerificationKey;
let offerVk: VerificationKey;
let tokenVk: VerificationKey;
let tokenAdminVk: VerificationKey;
let sharesVk: VerificationKey;
const cache: Cache = Cache.FileSystem("./cache");
const zkNFTKey = TestPublicKey.random();
const zkCollectionKey = TestPublicKey.random();
const zkAdminKey = TestPublicKey.random();
const zkAuctionKey = TestPublicKey.random();
const zkTokenKey = TestPublicKey.random();
const zkTokenAdminKey = TestPublicKey.random();
const zkSharesKey = TestPublicKey.random();
const upgradeAuthority = TestPublicKey.random();
const upgradeAuthorityContract = new VerificationKeyUpgradeAuthority(
  upgradeAuthority
);

// https://github.com/o1-labs/o1js/issues/1317 - issue with #private in SmartContract
// is being fixed by using unknown as ...
// const { Collection, Approval, Owner, Admin } = NonFungibleTokenContractsFactory(
//   {
//     approvalFactory: AuctionFactory as unknown as DefineApprovalFactory,
//     adminContract: useAdvancedAdmin
//       ? (NFTAdvancedAdmin as unknown as NFTAdminContractConstructor)
//       : NFTAdmin,
//   }
// );

export function AuctionContractsFactory(params: {
  useAdvancedAdmin: boolean;
  approval: "auction" | "shares";
}) {
  const { useAdvancedAdmin, approval } = params;

  let Collection: ReturnType<typeof CollectionFactory>;
  let Approval: NFTApprovalContractConstructor;
  let Auction: ReturnType<typeof AuctionFactory>;
  let Admin = useAdvancedAdmin ? NFTAdvancedAdmin : NFTAdmin;
  let { NFTSharesAdmin, NFTSharesOwner, FungibleToken } = NFTSharesFactory({
    auctionContract: () => Auction,
  });

  function getCollection(): NFTCollectionContractConstructor {
    if (!Collection) {
      throw new Error("Collection constructor not set up yet!");
    }
    return Collection as unknown as NFTCollectionContractConstructor;
  }
  function getApproval(): NFTApprovalContractConstructor {
    if (!Approval) {
      throw new Error("Approval constructor not set up yet!");
    }
    return Approval as unknown as NFTApprovalContractConstructor;
  }
  function getOwner(): NFTOwnerContractConstructor {
    if (!NFTSharesOwner) {
      throw new Error("Owner constructor not set up yet!");
    }
    return NFTSharesOwner as unknown as NFTOwnerContractConstructor;
  }

  Auction = AuctionFactory({
    collectionContract: getCollection,
  });

  Approval =
    approval === "auction"
      ? (Auction as unknown as NFTApprovalContractConstructor)
      : (NFTSharesOwner as unknown as NFTApprovalContractConstructor);

  Collection = CollectionFactory({
    adminContract: () => Admin as unknown as NFTAdminContractConstructor,
    ownerContract: getOwner,
    approvalContract: getApproval,
  });

  return {
    Collection,
    Approval,
    Admin,
    NFTSharesAdmin,
    FungibleToken,
    NFTSharesOwner,
  };
}

const {
  Collection,
  Approval,
  Admin,
  NFTSharesAdmin,
  FungibleToken,
  NFTSharesOwner,
} = AuctionContractsFactory({
  useAdvancedAdmin,
  approval: "auction",
});

const {
  Collection: SharesCollection,
  Admin: SharesAdmin,
  NFTSharesOwner: NFTSharesOwner2,
} = AuctionContractsFactory({
  useAdvancedAdmin,
  approval: "shares",
});

const NonFungibleTokenAuctionContract = Approval as unknown as ReturnType<
  typeof AuctionFactory
>;

const collectionContract = new Collection(zkCollectionKey);
const sharesCollectionContract = new SharesCollection(zkCollectionKey);
const tokenContract = new FungibleToken(zkTokenKey);
const tokenAdminContract = new NFTSharesAdmin(zkTokenAdminKey);
const sharesOwnerContract = new NFTSharesOwner(zkSharesKey);
const tokenId = collectionContract.deriveTokenId();
const adminContract = new Admin(zkAdminKey);
const auctionContract = new NonFungibleTokenAuctionContract(zkAuctionKey);
const NUMBER_OF_USERS = 8;
let admin: TestPublicKey;
let faucet: TestPublicKey;
let users: TestPublicKey[] = [];
const whitelistedUsers = TEST_ACCOUNTS.slice(
  NUMBER_OF_USERS,
  NUMBER_OF_USERS * 2
).map((account) => TestPublicKey.fromBase58(account.privateKey));
const validators = [
  TestPublicKey.random(),
  TestPublicKey.random(),
  TestPublicKey.random(),
];
const creator = whitelistedUsers[0];
const auctioneer = whitelistedUsers[4];
const sharesAdmin = whitelistedUsers[6];
let owner = creator;

interface NFTParams {
  name: string;
  address: PublicKey;
  collection: PublicKey;
  privateMetadata: string;
}

const nftParams: NFTParams[] = [];

describe(`Auction contracts tests: ${chain} ${withdraw ? "withdraw " : ""}${
  useAdvancedAdmin ? "advanced " : ""
}${approveTransfer ? "approve " : ""}${shares ? "shares " : ""}${
  noLog ? "noLog" : ""
}`, () => {
  const originalConsoleLog = console.log;

  if (noLog) {
    beforeEach(() => {
      console.log = () => {};
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });
  }

  it("should initialize a blockchain", async () => {
    if (chain === "devnet" || chain === "zeko" || chain === "mainnet") {
      await initBlockchain(chain);
      admin = TestPublicKey.fromBase58(TEST_ACCOUNTS[0].privateKey);
      users = TEST_ACCOUNTS.slice(1).map((account) =>
        TestPublicKey.fromBase58(account.privateKey)
      );
    } else if (chain === "local") {
      // local = await Mina.LocalBlockchain({
      //   proofsEnabled: true,
      // });
      // Mina.setActiveInstance(local);
      // const keys = local.testAccounts;

      const { keys } = await initBlockchain(chain, NUMBER_OF_USERS + 2);
      local = Mina.activeInstance as Awaited<
        ReturnType<typeof Mina.LocalBlockchain>
      >;
      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    } else if (chain === "lightnet") {
      const { keys } = await initBlockchain(chain, NUMBER_OF_USERS + 2);

      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    }
    owner = creator;
    assert(users.length >= NUMBER_OF_USERS);
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());
    console.log("withdraw:", withdraw);
    console.log("advanced:", useAdvancedAdmin);
    console.log("Collection contract address:", zkCollectionKey.toBase58());
    console.log("Admin contract address:", zkAdminKey.toBase58());
    console.log("NFT contract address:", zkNFTKey.toBase58());
    console.log(
      "Upgrade authority contract address:",
      upgradeAuthority.toBase58()
    );
    console.log("AdvancedAdmin:", useAdvancedAdmin);
    console.log("Auction contract address:", zkAuctionKey.toBase58());
    console.log("Token contract address:", zkTokenKey.toBase58());
    console.log("Token admin contract address:", zkTokenAdminKey.toBase58());
    console.log("Shares NFT owner contract address:", zkSharesKey.toBase58());

    if (chain === "local" || chain === "lightnet") {
      await fetchMinaAccount({ publicKey: faucet, force: true });
      let nonce = Number(Mina.getAccount(faucet).nonce.toBigint());
      let txs: (
        | Mina.PendingTransaction
        | Mina.RejectedTransaction
        | Mina.IncludedTransaction
        | undefined
      )[] = [];

      for (const user of whitelistedUsers) {
        await fetchMinaAccount({ publicKey: user, force: false });
        const balance = await accountBalanceMina(user);
        if (balance > 30) {
          continue;
        }
        const transaction = await Mina.transaction(
          {
            sender: users[0],
            fee: 100_000_000,
            memo: "topup",
            nonce: nonce++,
          },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(users[0]);
            if (balance === 0) senderUpdate.balance.subInPlace(1000000000);
            senderUpdate.send({ to: user, amount: 100_000_000_000 });
          }
        );
        txs.push(
          await sendTx({
            tx: transaction.sign([users[0].key]),
            description: "topup",
            wait: false,
          })
        );
      }
      for (const tx of txs) {
        if (tx?.status === "pending") {
          const txIncluded = await tx.safeWait();
          if (txIncluded.status !== expectedTxStatus) {
            throw new Error("Transaction not included");
          } else {
            console.log("Topup tx included:", txIncluded.hash);
          }
        } else throw new Error("Topup transaction not pending");
      }
      console.log("Topup done");
    }

    console.log(
      "Creator",
      creator.toBase58(),
      "balance:",
      await accountBalanceMina(creator)
    );
    console.log(
      "Auctioneer",
      auctioneer.toBase58(),
      "balance:",
      await accountBalanceMina(auctioneer)
    );
    console.log(
      "Admin  ",
      admin.toBase58(),
      "balance:",
      await accountBalanceMina(admin)
    );
    for (let i = 0; i < NUMBER_OF_USERS; i++) {
      console.log(
        `User ${i} `,
        users[i].toBase58(),
        "balance:",
        await accountBalanceMina(users[i])
      );
    }
    for (let i = 0; i < NUMBER_OF_USERS; i++) {
      console.log(
        `Whitelisted User ${i} `,
        whitelistedUsers[i].toBase58(),
        "balance:",
        await accountBalanceMina(whitelistedUsers[i])
      );
    }
    Memory.info("before compiling");
  });

  it("should compile NFT Contract", async () => {
    console.log("compiling...");
    console.time("compiled NFTContract");
    const { verificationKey } = await NFT.compile({ cache });
    nftContractVk = verificationKey;
    console.timeEnd("compiled NFTContract");
    assert.strictEqual(nftContractVk.hash.toJSON(), vk.NFT.hash);
    assert.strictEqual(nftContractVk.data, vk.NFT.data);
  });

  it("should compile Admin", async () => {
    console.time("compiled Admin");
    const { verificationKey } = await Admin.compile({ cache });
    adminVk = verificationKey;
    console.timeEnd("compiled Admin");
    console.log("Admin vk hash:", adminVk.hash.toJSON());
  });

  it("should compile Shares Admin", async () => {
    console.time("compiled Shares Admin");
    const { verificationKey } = await SharesAdmin.compile({ cache });
    sharesAdminVk = verificationKey;
    console.timeEnd("compiled Shares Admin");
    console.log("Shares Admin vk hash:", sharesAdminVk.hash.toJSON());
    assert.strictEqual(sharesAdminVk.hash.toJSON(), adminVk.hash.toJSON());
    assert.strictEqual(sharesAdminVk.data, adminVk.data);
  });

  it(
    "should compile UpgradeAuthority",
    { skip: !useAdvancedAdmin },
    async () => {
      console.time("compiled UpgradeAuthority");
      const { verificationKey } = await VerificationKeyUpgradeAuthority.compile(
        {
          cache,
        }
      );
      upgradeAuthorityVk = verificationKey;
      console.timeEnd("compiled UpgradeAuthority");
      console.log(
        "UpgradeAuthority vk hash:",
        upgradeAuthorityVk.hash.toJSON()
      );
    }
  );

  it("should compile Collection", async () => {
    console.time("compiled Collection");
    const { verificationKey } = await Collection.compile({ cache });
    collectionVk = verificationKey;
    console.timeEnd("compiled Collection");
    console.log("Collection vk hash:", collectionVk.hash.toJSON());
  });

  it(
    "should compile Shares Collection",
    { skip: !shares || withdraw },
    async () => {
      console.time("compiled Shares Collection");
      const { verificationKey } = await SharesCollection.compile({ cache });
      sharesCollectionVk = verificationKey;
      console.timeEnd("compiled Shares Collection");
      console.log(
        "Shares Collection vk hash:",
        sharesCollectionVk.hash.toJSON()
      );
      assert.strictEqual(
        sharesCollectionVk.hash.toJSON(),
        collectionVk.hash.toJSON()
      );
      assert.strictEqual(sharesCollectionVk.data, collectionVk.data);
    }
  );

  it("should compile Auction Contract", async () => {
    console.time("compiled Auction Contract");
    const { verificationKey } = await NonFungibleTokenAuctionContract.compile({
      cache,
    });
    offerVk = verificationKey;
    console.timeEnd("compiled Auction Contract");
    console.log("Auction Contract vk hash:", offerVk.hash.toJSON());
  });

  it("should compile Token Admin Contract", { skip: !shares }, async () => {
    console.time("compiled Token Admin Contract");
    const { verificationKey } = await NFTSharesAdmin.compile({ cache });
    tokenAdminVk = verificationKey;
    console.timeEnd("compiled Token Admin Contract");
    console.log("Token Admin Contract vk hash:", tokenAdminVk.hash.toJSON());
  });

  it("should compile Token Contract", { skip: !shares }, async () => {
    console.time("compiled Token Contract");
    const { verificationKey } = await FungibleToken.compile({ cache });
    tokenVk = verificationKey;
    console.timeEnd("compiled Token Contract");
    console.log("Token Contract vk hash:", tokenVk.hash.toJSON());
  });

  it("should compile Shares Owner Contract", { skip: !shares }, async () => {
    console.time("compiled Shares Owner Contract");
    const { verificationKey } = await NFTSharesOwner.compile({ cache });
    sharesVk = verificationKey;
    console.timeEnd("compiled Shares Owner Contract");
    console.log("Shares Owner Contract vk hash:", sharesVk.hash.toJSON());
  });

  it(
    "should compile Shares Owner Contract (2)",
    { skip: !shares || withdraw },
    async () => {
      console.time("compiled Shares Approval Contract");
      const { verificationKey } = await NFTSharesOwner2.compile({ cache });
      sharesApprovalVk = verificationKey;
      console.timeEnd("compiled Shares Approval Contract");
      console.log(
        "Shares Approval Contract vk hash:",
        sharesApprovalVk.hash.toJSON()
      );
      assert.strictEqual(
        sharesApprovalVk.hash.toJSON(),
        sharesVk.hash.toJSON()
      );
      assert.strictEqual(sharesApprovalVk.data, sharesVk.data);
    }
  );

  it(
    "should compile ValidatorsVoting",
    { skip: !useAdvancedAdmin },
    async () => {
      console.time("compiled ValidatorsVoting");
      const { verificationKey } = await ValidatorsVoting.compile({ cache });
      validatorsVotingVk = verificationKey;
      console.timeEnd("compiled ValidatorsVoting");
      console.log(
        "ValidatorsVoting vk hash:",
        validatorsVotingVk.hash.toJSON()
      );
    }
  );

  it(
    "should deploy an UpgradeAuthority",
    { skip: !useAdvancedAdmin },
    async () => {
      Memory.info("before deploy");
      console.time("deployed UpgradeAuthority");
      const validatorsList = new ValidatorsList();
      const validatorsCount = 2; // majority is 2 validators out of 3
      const list: { key: TestPublicKey; authorizedToVote: boolean }[] = [
        { key: validators[0], authorizedToVote: true },
        { key: TestPublicKey.random(), authorizedToVote: false },
        { key: validators[1], authorizedToVote: true },
        { key: validators[2], authorizedToVote: true },
        { key: TestPublicKey.random(), authorizedToVote: false },
      ];

      for (let i = 0; i < list.length; i++) {
        const key = Poseidon.hashPacked(PublicKey, list[i].key);
        validatorsList.set(key, Field(Bool(list[i].authorizedToVote).value));
      }

      const data: ValidatorsListData = {
        validators: list.map((v) => ({
          publicKey: v.key.toBase58(),
          authorizedToVote: v.authorizedToVote,
        })),
        validatorsCount,
        root: validatorsList.root.toJSON(),
        map: serializeIndexedMap(validatorsList),
      };

      const ipfs = await pinJSON({
        data,
        name: "upgrade-authority-list",
      });
      if (!ipfs) {
        throw new Error("List IPFS hash is undefined");
      }

      const validatorState = new ValidatorsState({
        chainId: ChainId[chain === "devnet" ? "mina:devnet" : "zeko:devnet"],
        root: validatorsList.root,
        count: UInt32.from(validatorsCount),
      });

      await fetchMinaAccount({ publicKey: admin, force: true });
      const tx = await Mina.transaction(
        {
          sender: admin,
          fee: 100_000_000,
          memo: `Deploy UpgradeAuthority`,
        },
        async () => {
          AccountUpdate.fundNewAccount(admin, 1);
          // deploy() and initialize() create 2 account updates for the same publicKey, it is intended
          await upgradeAuthorityContract.deploy();
          await upgradeAuthorityContract.initialize(
            validatorState,
            Storage.fromString(ipfs),
            validatorsVotingVk.hash
          );
        }
      );
      await tx.prove();
      assert.strictEqual(
        (
          await sendTx({
            tx: tx.sign([admin.key, upgradeAuthority.key]),
            description: "deploy UpgradeAuthority",
          })
        )?.status,
        expectedTxStatus
      );
      console.timeEnd("deployed UpgradeAuthority");
    }
  );

  it("should deploy a Collection", async () => {
    console.time("deployed Collection");
    const {
      metadataRoot,
      ipfsHash,
      serializedMap,
      name: nftName,
      privateMetadata,
    } = await randomMetadata({
      includePrivateTraits: false,
      includeBanner: true,
    });
    name = nftName;
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    const expiry = slot.add(UInt32.from(100000));
    const masterNFT = new MintParams({
      name: fieldFromString(name),
      address: zkCollectionKey,
      tokenId,
      data: NFTData.new({
        owner: creator,
      }),
      fee: UInt64.zero,
      metadata: metadataRoot,
      storage: Storage.fromString(ipfsHash),
      metadataVerificationKeyHash: Field(0),
      expiry,
    });
    await fetchMinaAccount({ publicKey: creator, force: true });
    const whitelist = useAdvancedAdmin
      ? (
          await Whitelist.create({
            list: [
              ...whitelistedUsers.map((user) => ({
                address: user,
                amount: 50_000_000_000,
              })),
              {
                address: zkAuctionKey,
                amount: 50_000_000_000,
              },
              {
                address: zkSharesKey,
                amount: 50_000_000_000,
              },
            ],
          })
        ).whitelist
      : undefined;
    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Deploy Collection ${name}`.substring(0, 30),
      },
      async () => {
        AccountUpdate.fundNewAccount(creator, 3);

        if (adminContract instanceof NFTAdvancedAdmin) {
          if (!whitelist) {
            throw new Error("Whitelist is undefined");
          }
          await adminContract.deploy({
            admin: creator,
            upgradeAuthority,
            whitelist,
            uri: `AdvancedAdminContract`,
            adminData: AdminData.new(),
          });
        } else if (adminContract instanceof NFTAdmin) {
          await adminContract.deploy({
            admin: creator,
            uri: `AdminContract`,
          });
        } else {
          throw new Error("Admin contract is not supported");
        }
        // deploy() and initialize() create 2 account updates for the same publicKey, it is intended
        await collectionContract.deploy({
          creator,
          collectionName: fieldFromString(name),
          baseURL: fieldFromString("ipfs"),
          admin: zkAdminKey,
          symbol: "NFT",
          url: `https://${chain}.minanft.io`,
        });
        await collectionContract.initialize(
          masterNFT,
          CollectionData.new({
            requireTransferApproval: approveTransfer,
            royaltyFee: 10_000, // 10%
            transferFee: 1_000_000_000, // 1 MINA
          })
        );
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([
            creator.key,
            zkCollectionKey.key,
            zkAdminKey.key,
            upgradeAuthority.key,
          ]),
          description: "deploy Collection",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("deployed Collection");
  });

  it("should mint NFT", async () => {
    Memory.info("before mint");
    console.time("minted NFT");
    const {
      name,
      ipfsHash,
      metadataRoot,
      privateMetadata,
      serializedMap,
      map,
    } = await randomMetadata();
    nftParams.push({
      name,
      address: zkNFTKey,
      collection: zkCollectionKey,
      privateMetadata,
    });
    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    owner = creator;
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    const expiry = slot.add(UInt32.from(100000));
    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Mint NFT ${name}`.substring(0, 30),
      },
      async () => {
        await collectionContract.mintByCreator({
          name: fieldFromString(name),
          address: zkNFTKey,
          tokenId,
          metadata: metadataRoot,
          data: NFTData.new({
            canChangeMetadata: true,
            canPause: true,
            owner,
          }),
          metadataVerificationKeyHash: Field(0),
          expiry,
          fee: UInt64.from(10_000_000_000),
          storage: Storage.fromString(ipfsHash),
        });
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key, zkNFTKey.key]),
          description: "mint",
        })
      )?.status,
      expectedTxStatus
    );
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const nft = new NFT(zkNFTKey, tokenId);
    const dataCheck = NFTData.unpack(nft.packedData.get());
    console.log("owner", owner.toBase58());
    console.log("ownerCheck", dataCheck.owner.toBase58());
    console.log("approvalCheck", dataCheck.approved.toBase58());

    console.log("creator", creator.toBase58());
    assert.strictEqual(dataCheck.owner.equals(creator).toBoolean(), true);
    assert.strictEqual(
      dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
      true
    );
    console.timeEnd("minted NFT");
    owner = creator;
  });

  it("should transfer NFT", async () => {
    Memory.info("before transfer");
    console.time("transferred NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const requireTransferApproval = CollectionData.unpack(
      collectionContract.packedData.get()
    ).requireTransferApproval.toBoolean();
    console.log("requireTransferApproval", requireTransferApproval);
    const to = whitelistedUsers[1];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Transfer NFT ${name}`.substring(0, 30),
      },
      async () => {
        if (requireTransferApproval) {
          await collectionContract.approvedTransferBySignature(
            new TransferParams({
              address: zkNFTKey,
              from: owner,
              to,
              price: UInt64Option.none(),
              context: NFTTransactionContext.empty(),
            })
          );
        } else {
          await collectionContract.transferBySignature(
            new TransferParams({
              address: zkNFTKey,
              from: owner,
              to,
              price: UInt64Option.none(),
              context: NFTTransactionContext.empty(),
            })
          );
        }
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key]),
          description: "transfer",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("transferred NFT");
    owner = to;
  });

  it("should offer NFT for auction", async () => {
    Memory.info("before auction");
    console.time("auctioned NFT");
    const seller = owner;
    await fetchMinaAccount({ publicKey: seller, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());
    const auctionEndTime = slot.add(
      UInt32.from((shares ? 20 : 10) * (chain === "lightnet" ? 2 : 1))
    );
    console.log("auctionEndTime", auctionEndTime.toBigint());

    const tx = await Mina.transaction(
      {
        sender: seller,
        fee: 100_000_000,
        memo: `Auction NFT ${name}`.substring(0, 30),
      },
      async () => {
        AccountUpdate.fundNewAccount(seller, 1);
        if (withdraw) {
          await collectionContract.approvedTransferBySignature(
            new TransferParams({
              address: zkNFTKey,
              from: seller,
              to: zkAuctionKey,
              price: UInt64Option.none(),
              context: NFTTransactionContext.empty(),
            })
          );
        } else {
          await collectionContract.approveAddress(zkNFTKey, zkAuctionKey);
        }
        await auctionContract.deploy({
          collection: zkCollectionKey,
          nft: zkNFTKey,
          owner: seller,
          minimumPrice: UInt64.from(10_000_000_000),
          auctionEndTime,
          auctioneer,
          transferFee: UInt64.from(1_000_000_000),
          saleFee: UInt32.from(15_000),
          withdrawPeriod: UInt32.from(chain === "local" ? 1000 : 2),
        });
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([seller.key, zkAuctionKey.key]),
          description: "auction",
        })
      )?.status,
      expectedTxStatus
    );

    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const zkNFT = new NFT(zkNFTKey, tokenId);
    const dataCheck = NFTData.unpack(zkNFT.packedData.get());
    console.log("owner", owner.toBase58());
    console.log("ownerCheck", dataCheck.owner.toBase58());
    console.log("approvalCheck", dataCheck.approved.toBase58());

    console.log("whitelisted 1", whitelistedUsers[1].toBase58());
    console.log("creator", creator.toBase58());
    assert.strictEqual(
      dataCheck.owner
        .equals(withdraw ? zkAuctionKey : whitelistedUsers[1])
        .toBoolean(),
      true
    );
    assert.strictEqual(
      dataCheck.approved
        .equals(withdraw ? PublicKey.empty() : zkAuctionKey)
        .toBoolean(),
      true
    );
    console.timeEnd("auctioned NFT");
  });

  it("should deploy NFT Shares Owner", { skip: !shares }, async () => {
    Memory.info("before NFT Shares Owner");
    console.time("NFT Shares Owner");
    await fetchMinaAccount({ publicKey: sharesAdmin, force: true });

    const tx = await Mina.transaction(
      {
        sender: sharesAdmin,
        fee: 100_000_000,
        memo: `NFT Shares Owner ${name}`.substring(0, 30),
      },
      async () => {
        AccountUpdate.fundNewAccount(sharesAdmin, 4);
        await tokenAdminContract.deploy({
          admin: sharesAdmin,
          owner: zkSharesKey,
        });
        await tokenContract.deploy({
          symbol: "NFT_SH",
          src: "NFT Shares tokens",
          allowUpdates: true,
        });
        await tokenContract.initialize(
          zkTokenAdminKey,
          UInt8.from(9),
          Bool(false)
        );
        await sharesOwnerContract.deploy({
          admin: sharesAdmin,
          owner: zkTokenKey,
          collection: zkCollectionKey,
          nft: zkNFTKey,
          auction: zkAuctionKey,
          maxBuyPrice: UInt64.from(25_000_000_000),
          minSellPrice: UInt64.from(30_000_000_000),
          uri: "NFT Shares owner",
        });
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([
            sharesAdmin.key,
            zkSharesKey.key,
            zkTokenKey.key,
            zkTokenAdminKey.key,
          ]),
          description: "NFT Shares Owner",
        })
      )?.status,
      expectedTxStatus
    );

    console.timeEnd("NFT Shares Owner");
  });

  it("should subscribe to NFT Shares", { skip: !shares }, async () => {
    const users = [whitelistedUsers[3], whitelistedUsers[4]];
    Memory.info("before NFT Shares Subscription");
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const tokenId = tokenContract.deriveTokenId();
      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
      await fetchMinaAccount({ publicKey: zkTokenKey, force: true });
      await fetchMinaAccount({ publicKey: zkTokenKey, tokenId, force: true });
      await fetchMinaAccount({ publicKey: zkTokenAdminKey, force: true });

      const tx = await Mina.transaction(
        {
          sender: user,
          fee: 100_000_000,
          memo: `NFT Shares Subscription (${i + 1})`.substring(0, 30),
        },
        async () => {
          AccountUpdate.fundNewAccount(user, 1);
          await tokenContract.mint(user, UInt64.from(10_000_000_000));
        }
      );
      await tx.prove();
      assert.strictEqual(
        (
          await sendTx({
            tx: tx.sign([user.key]),
            description: `NFT Shares Subscription (${i + 1})`,
          })
        )?.status,
        expectedTxStatus
      );
    }
  });

  it("should bid NFT (1)", async () => {
    Memory.info("before bid 1");
    console.time("bid NFT 1");
    const buyer = whitelistedUsers[2];
    await fetchMinaAccount({ publicKey: buyer, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: buyer,
        fee: 100_000_000,
        memo: `Bid NFT (1) ${name}`.substring(0, 30),
      },
      async () => {
        await auctionContract.bid(UInt64.from(15_000_000_000), buyer);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key]),
          description: "bid 1",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("bid NFT 1");
  });

  it("should bid NFT (2) with NFT Shares", { skip: !shares }, async () => {
    Memory.info("before bid 2");
    console.time("bid NFT 2 shares");
    const buyer = whitelistedUsers[3];
    await fetchMinaAccount({ publicKey: sharesAdmin, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
    const tokenId = tokenContract.deriveTokenId();
    await fetchMinaAccount({ publicKey: buyer, tokenId, force: true });
    console.log("tokenId", tokenId.toJSON());
    console.log("buyer", buyer.toBase58());
    console.log("zkTokenKey", zkTokenKey.toBase58());
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const outstandingShares = sharesOwnerContract.sharesOutstanding.get();
    console.log(
      "Outstanding shares",
      outstandingShares.toBigInt() / 1_000_000_000n
    );
    const sharesBalance = Mina.getAccount(buyer, tokenId).balance;
    console.log(
      "User shares balance",
      sharesBalance.toBigInt() / 1_000_000_000n,
      `(${
        (sharesBalance.toBigInt() * 100n) / outstandingShares.toBigInt()
      }%, required min 25%)`
    );
    console.log(
      "Shares balance in MINA",
      await accountBalanceMina(zkSharesKey)
    );
    const balance = sharesOwnerContract.account.balance.get();
    console.log("Shares balance", balance.toBigInt());

    const tx = await Mina.transaction(
      {
        sender: buyer,
        fee: 100_000_000,
        memo: `Bid with Shares NFT ${name}`.substring(0, 30),
      },
      async () => {
        await sharesOwnerContract.bid(UInt64.from(17_000_000_000));
        //await tokenContract.approveAccountUpdate(sharesOwnerContract.self);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key]),
          description: "bid 2 shares",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("bid NFT 2 shares");
    await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
    console.log("Shares balance", await accountBalanceMina(zkSharesKey));
  });

  it("should bid NFT (3)", async () => {
    Memory.info("before bid 3");
    console.time("bid NFT 3");
    const buyer = whitelistedUsers[4];
    await fetchMinaAccount({ publicKey: buyer, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: buyer,
        fee: 100_000_000,
        memo: `Bid NFT (3) ${name}`.substring(0, 30),
      },
      async () => {
        await auctionContract.bid(UInt64.from(18_000_000_000), buyer);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key]),
          description: "bid 3",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("bid NFT 3");
  });

  it("should bid NFT (4) with NFT Shares", { skip: !shares }, async () => {
    Memory.info("before bid 4");
    console.time("bid NFT 4 shares");
    const buyer = whitelistedUsers[4];
    await fetchMinaAccount({ publicKey: sharesAdmin, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
    const tokenId = tokenContract.deriveTokenId();
    await fetchMinaAccount({ publicKey: buyer, tokenId, force: true });
    console.log("tokenId", tokenId.toJSON());
    console.log("buyer", buyer.toBase58());
    console.log("zkTokenKey", zkTokenKey.toBase58());
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const outstandingShares = sharesOwnerContract.sharesOutstanding.get();
    console.log(
      "Outstanding shares",
      outstandingShares.toBigInt() / 1_000_000_000n
    );
    const sharesBalance = Mina.getAccount(buyer, tokenId).balance;
    console.log(
      "User shares balance",
      sharesBalance.toBigInt() / 1_000_000_000n,
      `(${
        (sharesBalance.toBigInt() * 100n) / outstandingShares.toBigInt()
      }%, required min 25%)`
    );
    console.log(
      "Shares balance in MINA",
      await accountBalanceMina(zkSharesKey)
    );
    const balance = sharesOwnerContract.account.balance.get();
    console.log("Shares balance", balance.toBigInt());

    const tx = await Mina.transaction(
      {
        sender: buyer,
        fee: 100_000_000,
        memo: `Bid with Shares NFT ${name}`.substring(0, 30),
      },
      async () => {
        await sharesOwnerContract.bid(UInt64.from(20_000_000_000));
        //await tokenContract.approveAccountUpdate(sharesOwnerContract.self);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key]),
          description: "bid 4 shares",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("bid NFT 4 shares");
    await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
    console.log("Shares balance", await accountBalanceMina(zkSharesKey));
  });

  it("should wait for auction end", async () => {
    Memory.info("before auction end");
    console.time("auction end");
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    const auctionData = auctionContract.auctionData.get();
    const auctionEndTime = Auction.unpack(auctionData).auctionEndTime.add(1);
    const withdrawPeriod = Auction.unpack(auctionData).withdrawPeriod;
    console.log("auctionEndTime", auctionEndTime.toBigint());
    console.log("withdrawPeriod", withdrawPeriod.toBigint());
    const endSlot = withdraw
      ? auctionEndTime.add(withdrawPeriod)
      : auctionEndTime;

    let slot = (
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis
    ).toBigint();
    console.log("slot", slot);
    while (slot <= endSlot.toBigint() + 1n) {
      if (chain === "local") {
        local.incrementGlobalSlot(withdraw ? 3500 : 100);
        slot += withdraw ? 3500n : 100n;
      } else {
        await sleep(60000);
        slot = (await fetchLastBlock()).globalSlotSinceGenesis.toBigint();
      }

      console.log("slot", slot);
    }
    console.timeEnd("auction end");
  });

  it("should settle auction", { skip: withdraw }, async () => {
    Memory.info("before settle auction");
    console.time("settled auction");
    const user = whitelistedUsers[4];
    await fetchMinaAccount({ publicKey: user, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: user,
        fee: 100_000_000,
        memo: `Settle auction ${name}`.substring(0, 30),
      },
      async () => {
        // Any address can settle the auction
        await auctionContract.settleAuction();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([user.key]),
          description: "settle auction",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("settled auction");
    owner = shares ? zkSharesKey : whitelistedUsers[4]; // The auction winner, not the user

    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const zkNFT = new NFT(zkNFTKey, tokenId);
    const dataCheck = NFTData.unpack(zkNFT.packedData.get());
    console.log("owner", owner.toBase58());
    console.log("ownerCheck", dataCheck.owner.toBase58());
    console.log("approvalCheck", dataCheck.approved.toBase58());

    assert.strictEqual(dataCheck.owner.equals(owner).toBoolean(), true);
    assert.strictEqual(
      dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
      true
    );
  });

  it("should withdraw NFT", { skip: !withdraw }, async () => {
    Memory.info("before withdraw NFT");
    console.time("withdrawn NFT");
    const user = whitelistedUsers[4];
    await fetchMinaAccount({ publicKey: user, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: user,
        fee: 100_000_000,
        memo: `Withdraw NFT ${name}`.substring(0, 30),
      },
      async () => {
        // Any address can settle the auction
        await auctionContract.withdrawNFT();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([user.key]),
          description: "withdraw NFT",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("withdrawn NFT");
    owner = whitelistedUsers[1]; // The auction winner, not the user

    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const zkNFT = new NFT(zkNFTKey, tokenId);
    const dataCheck = NFTData.unpack(zkNFT.packedData.get());
    console.log("whitelisted 1", whitelistedUsers[1].toBase58());
    console.log("ownerCheck", dataCheck.owner.toBase58());
    console.log("approvalCheck", dataCheck.approved.toBase58());

    assert.strictEqual(
      dataCheck.owner.equals(whitelistedUsers[1]).toBoolean(),
      true
    );
    assert.strictEqual(
      dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
      true
    );
  });

  it("should withdraw deposit", { skip: !withdraw }, async () => {
    Memory.info("before withdraw deposit");
    console.time("withdrawn deposit");
    const user = whitelistedUsers[4];
    await fetchMinaAccount({ publicKey: user, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: user,
        fee: 100_000_000,
        memo: `Withdraw NFT ${name}`.substring(0, 30),
      },
      async () => {
        // Any address can withdraw the deposit
        await auctionContract.withdraw();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([user.key]),
          description: "withdraw deposit",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("withdrawn deposit");
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));
  });

  it("should settle auction payment", { skip: withdraw }, async () => {
    Memory.info("before settle auction payment");
    console.time("settled auction payment");
    const user = auctioneer;
    await fetchMinaAccount({ publicKey: user, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    const auctionData = auctionContract.auctionData.get();
    const auction = Auction.unpack(auctionData);
    const balance = auctionContract.account.balance.get();
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));
    const slot =
      chain === "local"
        ? Mina.currentSlot()
        : chain === "zeko"
        ? UInt32.zero
        : (await fetchLastBlock()).globalSlotSinceGenesis;
    console.log("slot", slot.toBigint());

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: user,
        fee: 100_000_000,
        memo: `Settle auction payment ${name}`.substring(0, 30),
      },
      async () => {
        // Any address can settle the auction
        await auctionContract.settlePayment();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([user.key]),
          description: "settle auction payment",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("settled auction payment");
  });

  it("should settle auctioneer payment", { skip: withdraw }, async () => {
    Memory.info("before settle auctioneer payment");
    console.time("settled auctioneer payment");
    const user = auctioneer;
    await fetchMinaAccount({ publicKey: user, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkAuctionKey, force: true });
    const auctionData = auctionContract.auctionData.get();
    const auction = Auction.unpack(auctionData);
    const balance = auctionContract.account.balance.get();
    console.log("Auction balance", await accountBalanceMina(zkAuctionKey));

    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: user,
        fee: 100_000_000,
        memo: `Settle auctioneer payment ${name}`.substring(0, 30),
      },
      async () => {
        // Any address can settle the auction
        await auctionContract.settleAuctioneerPayment(balance);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([user.key]),
          description: "settle auctioneer payment",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("settled auctioneer payment");
  });

  it("should transfer NFT", { skip: shares && !withdraw }, async () => {
    Memory.info("before transfer");
    console.time("transferred NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const requireTransferApproval = CollectionData.unpack(
      collectionContract.packedData.get()
    ).requireTransferApproval.toBoolean();
    console.log("requireTransferApproval", requireTransferApproval);
    const to = whitelistedUsers[5];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Transfer NFT ${name}`.substring(0, 30),
      },
      async () => {
        if (requireTransferApproval) {
          await collectionContract.approvedTransferBySignature(
            new TransferParams({
              address: zkNFTKey,
              from: owner,
              to,
              price: UInt64Option.none(),
              context: NFTTransactionContext.empty(),
            })
          );
        } else {
          await collectionContract.transferBySignature(
            new TransferParams({
              address: zkNFTKey,
              from: owner,
              to,
              price: UInt64Option.none(),
              context: NFTTransactionContext.empty(),
            })
          );
        }
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key]),
          description: "transfer",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("transferred NFT");
    owner = to;
  });

  it(
    "should transfer NFT from NFTSharesOwner",
    { skip: !shares || withdraw },
    async () => {
      Memory.info("before transfer");
      console.time("transferred NFT");
      console.log("zkSharesKey", zkSharesKey.toBase58());
      const to = whitelistedUsers[7];
      console.log("to", to.toBase58());
      await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
      await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
      await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
      await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
      await fetchMinaAccount({ publicKey: to, force: true });
      const requireTransferApproval = CollectionData.unpack(
        collectionContract.packedData.get()
      ).requireTransferApproval.toBoolean();
      console.log("requireTransferApproval", requireTransferApproval);
      console.log("sharesOwner balance", await accountBalanceMina(zkSharesKey));

      const nft = nftParams.find(
        (p) =>
          p.address.equals(zkNFTKey).toBoolean() &&
          p.collection.equals(zkCollectionKey).toBoolean()
      );
      if (!nft) {
        throw new Error("NFT not found");
      }
      const { name } = nft;

      const tx = await Mina.transaction(
        {
          sender: to,
          fee: 100_000_000,
          memo: `Transfer NFT ${name}`.substring(0, 30),
        },
        async () => {
          if (requireTransferApproval) {
            await sharesCollectionContract.approvedTransferByProof(
              new TransferParams({
                address: zkNFTKey,
                from: zkSharesKey,
                to,
                price: UInt64Option.fromValue(30_000_000_000n),
                context: NFTTransactionContext.empty(),
              })
            );
          } else {
            await sharesCollectionContract.transferByProof(
              new TransferParams({
                address: zkNFTKey,
                from: zkSharesKey,
                to,
                price: UInt64Option.fromValue(30_000_000_000n),
                context: NFTTransactionContext.empty(),
              })
            );
          }
        }
      );
      await tx.prove();
      assert.strictEqual(
        (
          await sendTx({
            tx: tx.sign([to.key]),
            description: "transfer from shares",
          })
        )?.status,
        expectedTxStatus
      );
      console.timeEnd("transferred NFT");
      owner = to;
      await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
      console.log("sharesOwner balance", await accountBalanceMina(zkSharesKey));
      await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
      const zkNFT = new NFT(zkNFTKey, tokenId);
      const dataCheck = NFTData.unpack(zkNFT.packedData.get());
      console.log("owner", owner.toBase58());
      console.log("ownerCheck", dataCheck.owner.toBase58());
      console.log("approvalCheck", dataCheck.approved.toBase58());

      assert.strictEqual(dataCheck.owner.equals(owner).toBoolean(), true);
      assert.strictEqual(
        dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
        true
      );
    }
  );
  it(
    "should withdraw proceeds from NFT Shares",
    { skip: !shares },
    async () => {
      const users = [whitelistedUsers[3], whitelistedUsers[4]];
      Memory.info("before NFT Shares Withdraw");
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const tokenId = tokenContract.deriveTokenId();
        await fetchMinaAccount({ publicKey: user, force: true });
        await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
        await fetchMinaAccount({ publicKey: zkTokenKey, force: true });
        await fetchMinaAccount({ publicKey: zkTokenKey, tokenId, force: true });
        await fetchMinaAccount({ publicKey: zkTokenAdminKey, force: true });
        console.log(
          `${user.toBase58()} balance`,
          await accountBalanceMina(user)
        );

        const tx = await Mina.transaction(
          {
            sender: user,
            fee: 100_000_000,
            memo: `Withdraw NFT Shares (${i + 1})`.substring(0, 30),
          },
          async () => {
            await sharesOwnerContract.withdraw(UInt64.from(10_000_000_000));
          }
        );
        await tx.prove();
        assert.strictEqual(
          (
            await sendTx({
              tx: tx.sign([user.key]),
              description: `NFT Shares Withdraw (${i + 1})`,
            })
          )?.status,
          expectedTxStatus
        );
        console.log(
          `${user.toBase58()} balance`,
          await accountBalanceMina(user)
        );
      }
      await fetchMinaAccount({ publicKey: zkSharesKey, force: true });
      console.log("sharesOwner balance", await accountBalanceMina(zkSharesKey));
    }
  );
});
