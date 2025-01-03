import { describe, it } from "node:test";
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
  Signature,
  Poseidon,
  verify,
  Nullifier,
} from "o1js";
import {
  fetchMinaAccount,
  initBlockchain,
  accountBalanceMina,
  Memory,
  serializeIndexedMap,
  sendTx,
  pinJSON,
} from "zkcloudworker";
import { TEST_ACCOUNTS } from "../config.js";
import {
  NFT,
  NFTAdmin,
  NFTAdvancedAdmin,
  CollectionData,
  fieldFromString,
  NFTData,
  NFTImmutableState,
  NFTState,
  NFTUpdateProof,
  NFTStateStruct,
  MintParams,
  NFTProgram,
  nftVerificationKeys,
  Metadata,
  BidFactory,
  NFTAddress,
  Bid,
  NFTOraclePreconditions,
  UInt64Option,
  OfferFactory,
  AdminData,
  NonFungibleTokenContractsFactory,
  NFTStandardOwner,
  DefineApprovalFactory,
  NFTCollectionContractConstructor,
  NFTAdminContractConstructor,
} from "@minatokens/nft";
import {
  VerificationKeyUpgradeAuthority,
  ChainId,
  UpgradeDatabaseState,
  ValidatorsList,
  ValidatorsState,
  ValidatorsVoting,
  ValidatorsListEvent,
  ValidatorsListData,
  UpgradeAuthorityDatabase,
  ValidatorsDecision,
  ValidatorDecisionType,
  ValidatorsDecisionState,
  ValidatorsVotingProof,
  VerificationKeyUpgradeData,
  PublicKeyOption,
} from "@minatokens/upgradable";
import { processArguments } from "./helpers/utils.js";
import { checkValidatorsList } from "./helpers/validators.js";
import { randomMetadata } from "./helpers/metadata.js";
import { Whitelist, Storage, OffChainList } from "@minatokens/storage";
import fs from "fs/promises";

let { chain, useAdvancedAdmin, proofsEnabled } = processArguments();
const networkId = chain === "mainnet" ? "mainnet" : "devnet";
const expectedTxStatus = chain === "zeko" ? "pending" : "included";
const vk = nftVerificationKeys[networkId].vk;

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

let nftContractVk: VerificationKey;
let nftProgramVk: VerificationKey;
let collectionVk: VerificationKey;
let adminVk: VerificationKey;
let AdvancedAdminVk: VerificationKey;
let upgradeAuthorityVk: VerificationKey;
let validatorsVotingVk: VerificationKey;
let offerVk: VerificationKey;
const cache: Cache = Cache.FileSystem("./cache");
const zkNFTKey = TestPublicKey.random();
const zkCollectionKey = TestPublicKey.random();
const zkAdminKey = TestPublicKey.random();
const zkBidKey = TestPublicKey.random();
const zkOfferKey = TestPublicKey.random();
const upgradeAuthority = TestPublicKey.random();
const upgradeAuthorityContract = new VerificationKeyUpgradeAuthority(
  upgradeAuthority
);

// https://github.com/o1-labs/o1js/issues/1317 - issue with #private in SmartContract
// is being fixed by using unknown as ...
const { Collection, Approval, Owner, Admin } = NonFungibleTokenContractsFactory(
  {
    approvalFactory: OfferFactory as unknown as DefineApprovalFactory,
    adminContract: useAdvancedAdmin
      ? (NFTAdvancedAdmin as unknown as NFTAdminContractConstructor)
      : NFTAdmin,
  }
);

const NonFungibleTokenBidContract = BidFactory({
  collectionContract: () =>
    Collection as unknown as NFTCollectionContractConstructor,
});

const NonFungibleTokenOfferContract = Approval as unknown as ReturnType<
  typeof OfferFactory
>;
const collectionContract = new Collection(zkCollectionKey);
const tokenId = collectionContract.deriveTokenId();
const nftContract = new NFT(zkNFTKey, tokenId);
const adminContract = useAdvancedAdmin
  ? new NFTAdvancedAdmin(zkAdminKey)
  : new NFTAdmin(zkAdminKey);
const bidContract = new NonFungibleTokenBidContract(zkBidKey);
const offerContract = new NonFungibleTokenOfferContract(zkOfferKey);
const NUMBER_OF_USERS = 6;
let admin: TestPublicKey;
let faucet: TestPublicKey;
let users: TestPublicKey[] = [];
const whitelistedUsers = TEST_ACCOUNTS.slice(NUMBER_OF_USERS)
  .map((account) => TestPublicKey.fromBase58(account.privateKey))
  .slice(0, NUMBER_OF_USERS);
const validators = [
  TestPublicKey.random(),
  TestPublicKey.random(),
  TestPublicKey.random(),
];
const creator = whitelistedUsers[0];
let owner = creator;
const price = UInt64.from(10_000_000_000);
let collectionName: string;

interface NFTParams {
  name: string;
  address: PublicKey;
  collection: PublicKey;
  privateMetadata: string;
}

const nftParams: NFTParams[] = [];

describe("NFT contracts tests", () => {
  it("should initialize a blockchain", async () => {
    if (chain === "devnet" || chain === "zeko" || chain === "mainnet") {
      await initBlockchain(chain);
      admin = TestPublicKey.fromBase58(TEST_ACCOUNTS[0].privateKey);
      users = TEST_ACCOUNTS.slice(1).map((account) =>
        TestPublicKey.fromBase58(account.privateKey)
      );
    } else if (chain === "local") {
      const { keys } = await initBlockchain(chain, NUMBER_OF_USERS + 2);
      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    } else if (chain === "lightnet") {
      const { keys } = await initBlockchain(chain, 7);

      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    }
    owner = creator;
    assert(users.length >= NUMBER_OF_USERS);
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());

    console.log("Collection contract address:", zkCollectionKey.toBase58());
    console.log("Admin contract address:", zkAdminKey.toBase58());
    console.log("NFT contract address:", zkNFTKey.toBase58());
    console.log(
      "Upgrade authority contract address:",
      upgradeAuthority.toBase58()
    );
    console.log("AdvancedAdmin:", useAdvancedAdmin);
    console.log("Bid contract address:", zkBidKey.toBase58());
    console.log("Offer contract address:", zkOfferKey.toBase58());

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
        await fetchMinaAccount({ publicKey: user, force: true });
        const transaction = await Mina.transaction(
          {
            sender: users[0],
            fee: 100_000_000,
            memo: "topup",
            nonce: nonce++,
          },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(users[0]);
            senderUpdate.balance.subInPlace(1000000000);
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

  it("should analyze contracts methods", async () => {
    console.log("Analyzing contracts methods...");
    console.time("methods analyzed");
    const methods = [
      {
        name: "NFT",
        result: await NFT.analyzeMethods(),
        skip: false,
      },
      {
        name: "Admin",
        result: await NFTAdmin.analyzeMethods(),
        skip: false,
      },
      {
        name: "AdvancedAdmin",
        result: await NFTAdvancedAdmin.analyzeMethods(),
        skip: false,
      },
      {
        name: "UpgradeAuthority",
        result: await VerificationKeyUpgradeAuthority.analyzeMethods(),
        skip: false,
      },
      {
        name: "Collection",
        result: await (Collection as any).analyzeMethods(),
        skip: false,
      },
      {
        name: "NFTProgram",
        result: await NFTProgram.analyzeMethods(),
        skip: true,
      },
      {
        name: "Offer Contract",
        result: await (NonFungibleTokenOfferContract as any).analyzeMethods(),
        skip: false,
      },
      {
        name: "Bid Contract",
        result: await NonFungibleTokenBidContract.analyzeMethods(),
        skip: false,
      },
    ];
    console.timeEnd("methods analyzed");
    const maxRows = 2 ** 16;
    for (const contract of methods) {
      // calculate the size of the contract - the sum or rows for each method
      const size = Object.values(contract.result).reduce(
        (acc, method) => acc + (method as any).rows,
        0
      );
      // calculate percentage rounded to 0 decimal places
      const percentage =
        Math.round((((size as number) * 100) / maxRows) * 100) / 100;

      console.log(
        `${contract.name} rows: ${size} (${percentage}% of max ${maxRows} rows)`
      );
      if (contract.skip !== true)
        for (const method in contract.result) {
          console.log(
            "\t",
            method,
            `rows:`,
            (contract.result as any)[method].rows
          );
        }
    }
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

  it("should compile Admin", { skip: useAdvancedAdmin }, async () => {
    console.time("compiled Admin");
    const { verificationKey } = await NFTAdmin.compile({ cache });
    adminVk = verificationKey;
    console.timeEnd("compiled Admin");
    console.log("Admin vk hash:", adminVk.hash.toJSON());
  });

  it("should compile AdvancedAdmin", { skip: !useAdvancedAdmin }, async () => {
    console.time("compiled AdvancedAdmin");
    const { verificationKey } = await NFTAdvancedAdmin.compile({
      cache,
    });
    AdvancedAdminVk = verificationKey;
    console.timeEnd("compiled AdvancedAdmin");
    console.log("AdvancedAdmin vk hash:", AdvancedAdminVk.hash.toJSON());
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

  it("should compile Collection", async () => {
    console.time("compiled Collection");
    const { verificationKey } = await Collection.compile({ cache });
    collectionVk = verificationKey;
    console.timeEnd("compiled Collection");
    console.log("Collection vk hash:", collectionVk.hash.toJSON());
  });

  it("should compile nft ZkProgram", async () => {
    console.time("compiled NFTProgram");
    nftProgramVk = (await NFTProgram.compile({ cache })).verificationKey;
    console.timeEnd("compiled NFTProgram");
    console.log("NFTProgram vk hash:", nftProgramVk.hash.toJSON());
  });

  it("should compile Offer Contract", async () => {
    console.time("compiled Offer Contract");
    const { verificationKey } = await NonFungibleTokenOfferContract.compile({
      cache,
    });
    offerVk = verificationKey;
    console.timeEnd("compiled Offer Contract");
    console.log("Offer Contract vk hash:", offerVk.hash.toJSON());
  });

  it("should compile Bid Contract", async () => {
    console.time("compiled Bid Contract");
    const { verificationKey } = await NonFungibleTokenBidContract.compile({
      cache,
    });
    const bidVk = verificationKey;
    console.timeEnd("compiled Bid Contract");
    console.log("Bid Contract vk hash:", bidVk.hash.toJSON());
  });

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
    const { metadataRoot, ipfsHash, serializedMap, name, privateMetadata } =
      await randomMetadata({
        includePrivateTraits: false,
        includeBanner: true,
      });
    collectionName = name;
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
            list: whitelistedUsers.map((user) => ({
              address: user,
              amount: 50_000_000_000,
            })),
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
            uri: `zkcloudworker@$0.20.0#AdvancedAdminContract`,
            adminData: AdminData.new(),
          });
        } else if (adminContract instanceof NFTAdmin) {
          await adminContract.deploy({
            admin: creator,
            uri: `zkcloudworker@0.18.29#AdminContract`,
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
            requireTransferApproval: false,
            royaltyFee: 10, // 10%
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
          metadataVerificationKeyHash: nftProgramVk.hash,
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

  it("should offer NFT for sale", async () => {
    Memory.info("before offer");
    console.time("offered NFT");
    const seller = owner;
    await fetchMinaAccount({ publicKey: seller, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    // const requireOfferApproval = CollectionData.unpack(
    //   collectionContract.packedData.get()
    // ).requireOfferApproval.toBoolean();
    // console.log("requireOfferApproval", requireOfferApproval);
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
        sender: seller,
        fee: 100_000_000,
        memo: `Offer NFT ${name}`.substring(0, 30),
      },
      async () => {
        AccountUpdate.fundNewAccount(seller, 1);
        await collectionContract.approveAddress(zkNFTKey, zkOfferKey);
        await offerContract.deploy({
          collection: zkCollectionKey,
          nft: zkNFTKey,
          owner: seller,
          price,
        });
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([seller.key, zkOfferKey.key]),
          description: "offer",
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

    console.log("creator", creator.toBase58());
    assert.strictEqual(dataCheck.owner.equals(creator).toBoolean(), true);
    assert.strictEqual(dataCheck.approved.equals(zkOfferKey).toBoolean(), true);
    console.timeEnd("offered NFT");
  });

  it("should buy NFT", async () => {
    Memory.info("before buy");
    console.time("bought NFT");
    const buyer = whitelistedUsers[1];
    await fetchMinaAccount({ publicKey: buyer, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkOfferKey, force: true });
    // const requireBuyApproval = CollectionData.unpack(
    //   collectionContract.packedData.get()
    // ).requireBuyApproval.toBoolean();
    // console.log("requireBuyApproval", requireBuyApproval);
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
        memo: `Buy NFT ${name}`.substring(0, 30),
      },
      async () => {
        await offerContract.buy();
      }
    );
    await tx.prove();
    //console.log("tx", tx.toPretty());
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key]),
          description: "buy",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("bought NFT");
    owner = buyer;

    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const zkNFT = new NFT(zkNFTKey, tokenId);
    const dataCheck = NFTData.unpack(zkNFT.packedData.get());
    console.log("owner", owner.toBase58());
    console.log("ownerCheck", dataCheck.owner.toBase58());
    console.log("approvalCheck", dataCheck.approved.toBase58());

    console.log("creator", creator.toBase58());
    assert.strictEqual(dataCheck.owner.equals(owner).toBoolean(), true);
    assert.strictEqual(
      dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
      true
    );
  });

  it("should bid NFT", async () => {
    Memory.info("before bid");
    console.time("bid NFT");
    const buyer = whitelistedUsers[1];
    console.log("Bid contract address:", zkBidKey.toBase58());
    console.log("Buyer address:", buyer.toBase58());
    await fetchMinaAccount({ publicKey: buyer, force: true });
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
    const nftAddress: NFTAddress = {
      collection: zkCollectionKey,
      nft: zkNFTKey,
    };
    const bidsData = [
      {
        collection: zkCollectionKey,
        nft: zkNFTKey,
        price: UInt64.from(3_000_000_000),
        points: UInt64.from(100),
      },
    ];
    const key = Poseidon.hashPacked(NFTAddress, nftAddress);
    const price = UInt64.from(3_000_000_000);
    const points = UInt64.from(100);
    const bids = await OffChainList.create({
      list: bidsData.map((bid) => ({
        key: Poseidon.hashPacked(
          NFTAddress,
          new NFTAddress({ collection: bid.collection, nft: bid.nft })
        ),
        value: new Bid({ price: bid.price, points: bid.points }).pack(),
      })),
      name: "bids",
      data: bidsData.map((bid) => ({
        collection: bid.collection.toBase58(),
        nft: bid.nft.toBase58(),
        price: Number(bid.price.toBigInt()) / 1_000_000_000,
        points: Number(bid.points.toBigInt()),
      })),
      pin: false,
    });
    const whitelist = await Whitelist.create({
      list: [{ address: owner, amount: price }],
      name: "whitelist",
      json: bids.json,
      pin: true,
    });
    const storage = whitelist.whitelist.list.storage;

    const tx = await Mina.transaction(
      {
        sender: buyer,
        fee: 100_000_000,
        memo: `Bid NFT ${name}`.substring(0, 30),
      },
      async () => {
        //AccountUpdate.fundNewAccount(buyer, 1);
        await bidContract.deploy({
          bids: bids.list.root,
          whitelist: whitelist.whitelist.list.root,
          storage,
        });
        await bidContract.initialize(
          UInt64.from(5_000_000_000),
          UInt64.from(1000)
        );
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([buyer.key, zkBidKey.key]),
          description: "bid",
        })
      )?.status,
      expectedTxStatus
    );

    console.timeEnd("bid NFT");
  });

  it("should accept bid on NFT", async () => {
    Memory.info("before accepting bid");
    console.time("accept bid");
    const seller = owner;
    console.log("Seller address:", seller.toBase58());
    await fetchMinaAccount({ publicKey: seller, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkBidKey, force: true });
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;
    const price = UInt64.from(2_000_000_000); // 1 MINA less than the bid
    const nftAddress: NFTAddress = {
      collection: zkCollectionKey,
      nft: zkNFTKey,
    };

    const tx = await Mina.transaction(
      {
        sender: seller,
        fee: 100_000_000,
        memo: `Accept bid on NFT ${name}`.substring(0, 30),
      },
      async () => {
        await bidContract.sell(nftAddress, price);
      }
    );
    await tx.prove();
    // console.log("tx", tx.toPretty());
    // await fs.writeFile("tx.json", JSON.stringify(tx.toJSON(), null, 2));
    // console.log("Seller", seller.toBase58());
    // console.log("bid contract", zkBidKey.toBase58());
    // console.log("nft", zkNFTKey.toBase58());
    // console.log("collection", zkCollectionKey.toBase58());
    // console.log("price", price.toString());
    // console.log("admin", zkAdminKey.toBase58());
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([seller.key]),
          description: "accept bid",
        })
      )?.status,
      expectedTxStatus
    );

    console.timeEnd("accept bid");
    owner = whitelistedUsers[1];
  });

  it("should update NFT metadata", { skip: useAdvancedAdmin }, async () => {
    Memory.info("before update");
    console.time("updated NFT");

    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const nftAccount = Mina.getAccount(zkNFTKey, tokenId);
    const nftStateStruct = NFTStateStruct.fromAccount(nftAccount);
    assert.strictEqual(
      nftAccount.zkapp?.verificationKey?.hash.toJSON(),
      nftContractVk.hash.toJSON()
    );
    const nftState = NFTState.fromNFTState({
      nftState: nftStateStruct,
      creator: creator,
      address: zkNFTKey,
      tokenId,
      oracle: NFTOraclePreconditions.new(),
    });

    const index = nftParams.findIndex(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (index === -1) {
      throw new Error("NFT not found");
    }
    const nft = nftParams[index];
    const { name } = nft;
    const metadata = Metadata.fromJSON({
      json: JSON.parse(nft.privateMetadata),
      checkRoot: true,
    });
    assert.strictEqual(nftState.metadata.toJSON(), metadata.map.root.toJSON());
    if (nftState.metadata.toJSON() !== metadata.map.root.toJSON()) {
      throw new Error(
        "NFT metadata is not the same as the one in the collection"
      );
    }

    console.time("proved update 1");
    const map1 = metadata.map.clone();
    let { key: key1, value: value1 } = metadata.addTrait({
      key: "New Key 1",
      value: "New Value 1",
      type: "string",
    });
    const signature1 = Signature.create(owner.key, [
      ...NFTState.toFields(nftState),
      key1,
      value1.hash(),
    ]);

    const update1 = await NFTProgram.insertMetadata(
      nftState,
      map1,
      key1,
      value1.hash(),
      signature1
    );

    console.timeEnd("proved update 1");
    assert.strictEqual(
      update1.auxiliaryOutput.root.toJSON(),
      metadata.map.root.toJSON()
    );
    console.time("proved update 2");
    const map2 = metadata.map.clone();
    const { key: key2, value: value2 } = metadata.addTrait({
      key: "New Key 2",
      value: "New Value 2",
      type: "string",
    });
    const signature2 = Signature.create(owner.key, [
      ...NFTState.toFields(update1.proof.publicOutput),
      key2,
      value2.hash(),
    ]);

    const update2 = await NFTProgram.insertMetadata(
      update1.proof.publicOutput,
      map2,
      key2,
      value2.hash(),
      signature2
    );
    console.timeEnd("proved update 2");
    assert.strictEqual(
      update2.auxiliaryOutput.root.toJSON(),
      metadata.map.root.toJSON()
    );
    console.time("merged proofs");
    const mergedProof = await NFTProgram.merge(
      nftState,
      update1.proof,
      update2.proof
    );
    const dynamicProof = NFTUpdateProof.fromProof(mergedProof.proof);
    console.timeEnd("merged proofs");

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Update NFT ${name}`.substring(0, 30),
      },
      async () => {
        await collectionContract.update(dynamicProof, nftProgramVk);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key]),
          description: "update",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("updated NFT");
    nftParams[index].privateMetadata = JSON.stringify(
      metadata.toJSON(true),
      null,
      2
    );
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
    const to = whitelistedUsers[2];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;

    // let success = true;
    // try {
    //   const tx = await Mina.transaction(
    //     {
    //       sender: owner,
    //       fee: 100_000_000,
    //       memo: `Transfer NFT ${name}`.substring(0, 30),
    //     },
    //     async () => {
    //       if (!requireTransferApproval) {
    //         await collectionContract.transferBySignature(
    //           zkNFTKey,
    //           to,
    //           UInt64Option.none()
    //         );
    //       } else {
    //         await collectionContract.transferBySignature(
    //           zkNFTKey,
    //           to,
    //           UInt64Option.none()
    //         );
    //       }
    //     }
    //   );
    //   await tx.prove();
    //   await sendTx({
    //     tx: tx.sign([owner.key]),
    //     description: "transfer attempt",
    //   });
    // } catch (e: any) {
    //   success = false;
    //   console.error(
    //     `Attempt to transfer NFT with wrong approval failed: ${
    //       e?.message ?? ""
    //     }`
    //   );
    // }
    // assert.strictEqual(success, false);

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Transfer NFT ${name}`.substring(0, 30),
      },
      async () => {
        if (requireTransferApproval) {
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
          );
        } else {
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
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

  it("should pause NFT", async () => {
    Memory.info("before pause");
    console.time("paused NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
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

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Pause NFT ${name}`.substring(0, 30),
      },
      async () => {
        await collectionContract.pauseNFTBySignature(zkNFTKey);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key]),
          description: "pause NFT",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("paused NFT");
  });

  it("should fail to transfer paused NFT", async () => {
    Memory.info("before transfer");
    console.time("tried to transfer paused NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const requireTransferApproval = CollectionData.unpack(
      collectionContract.packedData.get()
    ).requireTransferApproval.toBoolean();
    console.log("requireTransferApproval", requireTransferApproval);
    const to = whitelistedUsers[3];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;
    let transferred = true;
    try {
      const tx = await Mina.transaction(
        {
          sender: owner,
          fee: 100_000_000,
          memo: `Transfer NFT ${name}`.substring(0, 30),
        },
        async () => {
          if (requireTransferApproval) {
            await collectionContract.transferBySignature(
              zkNFTKey,
              to,
              UInt64Option.none()
            );
          } else {
            await collectionContract.transferBySignature(
              zkNFTKey,
              to,
              UInt64Option.none()
            );
          }
        }
      );
      await tx.prove();
      await sendTx({
        tx: tx.sign([owner.key]),
        description: "tried to transfer paused NFT",
      });
    } catch (e: any) {
      console.log(
        "error during attempt to transfer paused NFT:",
        e?.message ?? ""
      );
      transferred = false;
    }
    assert.strictEqual(transferred, false);
    console.timeEnd("tried to transfer paused NFT");
  });

  it("should resume NFT", async () => {
    Memory.info("before resume");
    console.time("resumed NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
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

    const tx = await Mina.transaction(
      {
        sender: owner,
        fee: 100_000_000,
        memo: `Resume NFT ${name}`.substring(0, 30),
      },
      async () => {
        await collectionContract.resumeNFT(zkNFTKey);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key]),
          description: "resume NFT",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("resumed NFT");
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
    const to = whitelistedUsers[3];
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
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
          );
        } else {
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
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

  it("should pause Collection", async () => {
    Memory.info("before pause");
    console.time("paused Collection");
    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });

    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Pause Collection ${collectionName}`.substring(0, 30),
      },
      async () => {
        await collectionContract.pause();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key]),
          description: "pause Collection",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("paused Collection");
  });

  it("should fail to transfer NFT on paused Collection", async () => {
    Memory.info("before transfer");
    console.time("tried to transfer NFT on paused Collection");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const requireTransferApproval = CollectionData.unpack(
      collectionContract.packedData.get()
    ).requireTransferApproval.toBoolean();
    console.log("requireTransferApproval", requireTransferApproval);
    const to = whitelistedUsers[4];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;
    let transferred = true;
    try {
      const tx = await Mina.transaction(
        {
          sender: owner,
          fee: 100_000_000,
          memo: `Transfer NFT ${name}`.substring(0, 30),
        },
        async () => {
          if (requireTransferApproval) {
            await collectionContract.transferBySignature(
              zkNFTKey,
              to,
              UInt64Option.none()
            );
          } else {
            await collectionContract.transferBySignature(
              zkNFTKey,
              to,
              UInt64Option.none()
            );
          }
        }
      );
      await tx.prove();
      await sendTx({
        tx: tx.sign([owner.key]),
        description: "tried to transfer NFT on paused Collection",
      });
    } catch (e: any) {
      console.log(
        "error during attempt to transfer NFT on paused Collection:",
        e?.message ?? ""
      );
      transferred = false;
    }
    assert.strictEqual(transferred, false);
    console.timeEnd("tried to transfer NFT on paused Collection");
  });

  it("should resume Collection", async () => {
    Memory.info("before resume");
    console.time("resumed Collection");
    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });

    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Resume Collection ${collectionName}`.substring(0, 30),
      },
      async () => {
        await collectionContract.resume();
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key]),
          description: "resume Collection",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("resumed Collection");
  });

  it(
    "should set a UpgradeAuthority database",
    { skip: !useAdvancedAdmin },
    async () => {
      console.time("Set UpgradeAuthority");
      await fetchMinaAccount({ publicKey: admin, force: true });
      await fetchMinaAccount({ publicKey: upgradeAuthority, force: true });
      const events = await upgradeAuthorityContract.fetchEvents();
      const lastEvent = events
        .filter((e) => e.type === "validatorsList")
        .reverse()[0];
      if (!lastEvent) {
        throw new Error("No validatorsList event found");
      }
      const eventData = lastEvent.event.data as unknown as ValidatorsListEvent;

      const storage = eventData.storage;
      console.log("storage", storage.toString());

      const { map, data } = await checkValidatorsList({
        storage,
      });
      const validatorState = new ValidatorsState({
        chainId: ChainId[chain === "devnet" ? "mina:devnet" : "zeko:devnet"],
        root: map.root,
        count: UInt32.from(data.validatorsCount),
      });

      const key1 = new VerificationKeyUpgradeData({
        address: collectionContract.address,
        tokenId: collectionContract.tokenId,
        previousVerificationKeyHash: collectionVk.hash,
        newVerificationKeyHash: collectionVk.hash,
      });
      const key2 = new VerificationKeyUpgradeData({
        address: nftContract.address,
        tokenId: nftContract.tokenId,
        previousVerificationKeyHash: nftContractVk.hash,
        newVerificationKeyHash: nftContractVk.hash,
      });
      const key3 = new VerificationKeyUpgradeData({
        address: adminContract.address,
        tokenId: adminContract.tokenId,
        previousVerificationKeyHash: useAdvancedAdmin
          ? AdvancedAdminVk.hash
          : adminVk.hash,
        newVerificationKeyHash: useAdvancedAdmin
          ? AdvancedAdminVk.hash
          : adminVk.hash,
      });
      const db = new UpgradeAuthorityDatabase();
      db.set(key1.hash(), key1.newVerificationKeyHash);
      db.set(key2.hash(), key2.newVerificationKeyHash);
      db.set(key3.hash(), key3.newVerificationKeyHash);
      const ipfs = await pinJSON({
        data: { "indexed-map": { map: serializeIndexedMap(db) } },
        name: "upgrade-authority-database",
      });
      if (!ipfs) {
        throw new Error("UpgradeAuthority database IPFS hash is undefined");
      }

      const decision = new ValidatorsDecision({
        message: fieldFromString("Set UpgradeAuthority"),
        decisionType: ValidatorDecisionType["updateDatabase"],
        contractAddress: upgradeAuthority,
        chainId: ChainId[chain === "devnet" ? "mina:devnet" : "zeko:devnet"],
        validators: validatorState,
        upgradeDatabase: new UpgradeDatabaseState({
          root: db.root,
          storage: Storage.fromString(ipfs),
          nextUpgradeAuthority: PublicKeyOption.none(),
          version: UInt32.from(1),
          validFrom: UInt32.zero,
        }),
        updateValidatorsList: ValidatorsState.empty(),
        expiry: UInt32.MAXINT(),
      });
      let state = ValidatorsDecisionState.startVoting(decision);
      const proofs = [];

      console.log("voting...");
      console.time("voted");
      const voted = new ValidatorsList();
      const startProof = await ValidatorsVoting.startVoting(state, decision);
      proofs.push(startProof.proof);
      for (let i = 0; i < validators.length; i++) {
        const signature = Signature.create(
          validators[i].key,
          ValidatorsDecision.toFields(decision)
        );
        const nullifier = Nullifier.fromJSON(
          decision.createJsonNullifier({
            network: "testnet",
            privateKey: validators[i].key,
          })
        );

        //  state = ValidatorsDecisionState.vote(
        //   state,
        //   decision,
        //   validators[i],
        //   map.clone(),
        //   signature
        // );
        /*
        state: ValidatorsDecisionState,
        decision: ValidatorsDecision,
        nullifier: Nullifier,
        validatorsList: ValidatorsList,
        votedList: ValidatorsList,
        yes: Bool,
        no: Bool,
        abstain: Bool,
        signature: Signature
      */
        const step = await ValidatorsVoting.vote(
          state,
          decision,
          nullifier,
          map.clone(),
          voted.clone(),
          Bool(true),
          Bool(false),
          Bool(false),
          signature
        );
        voted.insert(nullifier.key(), Field(1));
        state = step.proof.publicOutput;
        proofs.push(step.proof);
      }
      let proof = proofs[0];
      console.timeEnd("voted");
      console.log("merging vote proofs...");
      console.time("merged vote proofs");
      for (let i = 1; i < proofs.length; i++) {
        const mergedProof = await ValidatorsVoting.merge(
          proofs[i - 1].publicInput,
          proofs[i - 1],
          proofs[i]
        );
        proof = mergedProof.proof;
        const ok = await verify(mergedProof.proof, validatorsVotingVk);
        if (!ok) {
          throw new Error("calculateValidatorsProof: Proof is not valid");
        }
      }
      const dynamicProof = ValidatorsVotingProof.fromProof(proof);
      console.timeEnd("merged vote proofs");

      await fetchMinaAccount({ publicKey: admin, force: true });
      await fetchMinaAccount({ publicKey: upgradeAuthority, force: true });

      const tx = await Mina.transaction(
        {
          sender: admin,
          fee: 100_000_000,
          memo: `Set UpgradeAuthority`,
        },
        async () => {
          await upgradeAuthorityContract.updateDatabase(
            dynamicProof,
            validatorsVotingVk,
            validatorState
          );
        }
      );
      await tx.prove();
      assert.strictEqual(
        (
          await sendTx({
            tx: tx.sign([admin.key]),
            description: "Set UpgradeAuthority",
          })
        )?.status,
        expectedTxStatus
      );
      console.timeEnd("Set UpgradeAuthority");
    }
  );

  it("should upgrade NFT verification key", async () => {
    Memory.info("before NFT upgrade");
    console.time("upgraded NFT");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: upgradeAuthority, force: true });

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
        memo: `Upgrade NFT ${name}`.substring(0, 30),
      },
      async () => {
        await collectionContract.upgradeNFTVerificationKeyBySignature(
          nft.address,
          nftContractVk
        );
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([owner.key, creator.key]),
          description: "upgrade NFT vk",
        })
      )?.status,
      expectedTxStatus
    );

    console.timeEnd("upgraded NFT");
  });

  it("should upgrade Collection verification key", async () => {
    Memory.info("before Collection upgrade");
    console.time("upgraded Collection");

    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: upgradeAuthority, force: true });

    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Upgrade Collection ${collectionName}`.substring(0, 30),
      },
      async () => {
        await collectionContract.upgradeVerificationKey(collectionVk);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key]),
          description: "upgrade Collection vk",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("upgraded Collection");
  });

  it("should upgrade AdminContract verification key", async () => {
    Memory.info("before AdminContract upgrade");
    console.time("upgraded AdminContract");

    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: upgradeAuthority, force: true });
    console.log(
      "useAdvancedAdmin",
      useAdvancedAdmin,
      useAdvancedAdmin ? AdvancedAdminVk.hash.toJSON() : adminVk.hash.toJSON()
    );

    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Upgrade AdminContract`.substring(0, 30),
      },
      async () => {
        await adminContract.upgradeVerificationKey(
          useAdvancedAdmin ? AdvancedAdminVk : adminVk
        );
      }
    );
    console.log("tx upgradeAdmin 1", tx.toPretty());
    await tx.prove();
    console.log("tx upgradeAdmin 2", tx.toPretty());
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key]),
          description: "upgrade AdminContract vk",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("upgraded AdminContract");
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
    const to = whitelistedUsers[4];
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
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
          );
        } else {
          await collectionContract.transferBySignature(
            zkNFTKey,
            to,
            UInt64Option.none()
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
});
