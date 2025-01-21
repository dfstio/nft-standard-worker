import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import {
  Mina,
  VerificationKey,
  Field,
  AccountUpdate,
  UInt32,
  Cache,
  UInt64,
  fetchLastBlock,
  PublicKey,
} from "o1js";
import {
  fetchMinaAccount,
  initBlockchain,
  accountBalanceMina,
  Memory,
  sendTx,
} from "zkcloudworker";
import { TEST_ACCOUNTS } from "../config.js";
import {
  NFT,
  Collection,
  NFTAdmin,
  CollectionData,
  fieldFromString,
  NFTData,
  MintParams,
  nftVerificationKeys,
} from "@minatokens/nft";
import { Storage } from "@minatokens/storage";
import { processArguments } from "./helpers/utils.js";
import { randomMetadata } from "./helpers/metadata.js";

let { chain, approveTransfer, noLog } = processArguments();
const NUMBER_OF_NFTS = 5;
const networkId = chain === "mainnet" ? "mainnet" : "devnet";
const expectedTxStatus = chain === "zeko" ? "pending" : "included";
const vk = nftVerificationKeys[networkId].vk;

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

let nftContractVk: VerificationKey;
let nftProgramVk: VerificationKey;
let collectionVk: VerificationKey;
let adminVk: VerificationKey;
const cache: Cache = Cache.FileSystem("./cache");
const zkCollectionKey = TestPublicKey.random();
const zkAdminKey = TestPublicKey.random();

const collectionContract = new Collection(zkCollectionKey);
const tokenId = collectionContract.deriveTokenId();
const adminContract = new NFTAdmin(zkAdminKey);
const NUMBER_OF_USERS = 1;
let admin: TestPublicKey;
let faucet: TestPublicKey;
const whitelistedUsers = TEST_ACCOUNTS.slice(NUMBER_OF_USERS)
  .map((account) => TestPublicKey.fromBase58(account.privateKey))
  .slice(0, NUMBER_OF_USERS);
const validators = [
  TestPublicKey.random(),
  TestPublicKey.random(),
  TestPublicKey.random(),
];
const creator = whitelistedUsers[0];

interface NFTParams {
  name: string;
  address: PublicKey;
  collection: PublicKey;
  privateMetadata: string;
}

const nftParams: NFTParams[] = [];

describe(`NFT contracts tests: ${chain} ${approveTransfer ? "approve " : ""}${
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
    } else if (chain === "local") {
      const { keys } = await initBlockchain(chain, 2);
      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
    } else if (chain === "lightnet") {
      const { keys } = await initBlockchain(chain, 2);

      faucet = TestPublicKey(keys[0].key);
      admin = TestPublicKey(keys[1].key);
    }
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());

    console.log("Collection contract address:", zkCollectionKey.toBase58());
    console.log("Admin contract address:", zkAdminKey.toBase58());

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
        const balance = await accountBalanceMina(user);
        if (balance > 30) {
          continue;
        }

        const transaction = await Mina.transaction(
          {
            sender: faucet,
            fee: 100_000_000,
            memo: "topup",
            nonce: nonce++,
          },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(faucet);
            if (balance === 0) senderUpdate.balance.subInPlace(1000000000);
            senderUpdate.send({ to: user, amount: 100_000_000_000 });
          }
        );
        txs.push(
          await sendTx({
            tx: transaction.sign([faucet.key]),
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
    const { verificationKey } = await NFTAdmin.compile({ cache });
    adminVk = verificationKey;
    console.timeEnd("compiled Admin");
    console.log("Admin vk hash:", adminVk.hash.toJSON());
  });

  it("should compile Collection", async () => {
    console.time("compiled Collection");
    const { verificationKey } = await Collection.compile({ cache });
    collectionVk = verificationKey;
    console.timeEnd("compiled Collection");
    console.log("Collection vk hash:", collectionVk.hash.toJSON());
  });

  it("should deploy a Collection", async () => {
    console.time("deployed Collection");
    const { metadataRoot, ipfsHash, serializedMap, name, privateMetadata } =
      await randomMetadata({
        includePrivateTraits: false,
        includeBanner: true,
      });
    if (!ipfsHash) {
      throw new Error("IPFS hash is undefined");
    }
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
    const tx = await Mina.transaction(
      {
        sender: creator,
        fee: 100_000_000,
        memo: `Deploy Collection ${name}`.substring(0, 30),
      },
      async () => {
        AccountUpdate.fundNewAccount(creator, 3);

        await adminContract.deploy({
          admin: creator,
          uri: `AdminContract`,
        });
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
          tx: tx.sign([creator.key, zkCollectionKey.key, zkAdminKey.key]),
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
    for (let i = 0; i < NUMBER_OF_NFTS; i++) {
      const { name, ipfsHash, metadataRoot, privateMetadata } =
        await randomMetadata();
      if (!ipfsHash) {
        throw new Error("IPFS hash is undefined");
      }
      const zkNFTKey = TestPublicKey.random();
      console.log(`NFT ${i}:`, zkNFTKey.toBase58());
      nftParams.push({
        name,
        address: zkNFTKey,
        collection: zkCollectionKey,
        privateMetadata,
      });
      await fetchMinaAccount({ publicKey: creator, force: true });
      await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
      await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
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
              canChangeMetadata: false,
              canPause: false,
              owner: creator,
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
      console.log("owner", creator.toBase58());
      console.log("ownerCheck", dataCheck.owner.toBase58());
      console.log("approvalCheck", dataCheck.approved.toBase58());

      console.log("creator", creator.toBase58());
      assert.strictEqual(dataCheck.owner.equals(creator).toBoolean(), true);
      assert.strictEqual(
        dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
        true
      );
    }
    console.timeEnd("minted NFT");
  });
});
