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
  Struct,
  state,
  State,
  SmartContract,
  method,
  Provable,
  Bool,
} from "o1js";
import {
  fetchMinaAccount,
  initBlockchain,
  accountBalanceMina,
  Memory,
  sendTx,
  pinJSON,
} from "zkcloudworker";
import { TEST_ACCOUNTS } from "./helpers/config.js";
import {
  NFT,
  NFTAdmin,
  CollectionData,
  fieldFromString,
  NFTData,
  NFTState,
  NFTUpdateProof,
  NFTStateStruct,
  MintParams,
  NFTGameProgram,
  nftVerificationKeys,
  Metadata,
  NonFungibleTokenContractsFactory,
  NFTTransactionContext,
  TransferParams,
  NFTUpdateBase,
  MetadataValue,
} from "@silvana-one/nft";

import { processArguments } from "./helpers/utils.js";
import { randomMetadata } from "./helpers/metadata.js";
import { Storage, UInt64Option, createIpfsURL } from "@silvana-one/storage";

let { chain, readOnly, noLog } = processArguments();
const networkId = chain === "mainnet" ? "mainnet" : "devnet";
const expectedTxStatus = chain === "zeko" ? "pending" : "included";
const vk = nftVerificationKeys[networkId].vk;

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

/*
“Richard Of York Gave Battle In Vain”:
	1.	Richard – Red
Hex: #FF0000
	2.	Of – Orange
Hex: #FFA500
	3.	York – Yellow
Hex: #FFFF00
	4.	Gave – Green
Hex: #008000
	5.	Battle – Blue
Hex: #0000FF
	6.	In – Indigo
Hex: #4B0082
	7.	Vain – Violet
Hex: #EE82EE
*/

const colors = [
  0xff0000, 0xffa500, 0xffff00, 0x008000, 0x0000ff, 0x4b0082, 0xee82ee,
];

const black = 0x000000;

class Colors extends Struct({
  Richard: Field,
  Of: Field,
  York: Field,
  Gave: Field,
  Battle: Field,
  In: Field,
  Vain: Field,
}) {}

const rightAnswers = new Colors({
  Richard: Field(colors[0]),
  Of: Field(colors[1]),
  York: Field(colors[2]),
  Gave: Field(colors[3]),
  Battle: Field(colors[4]),
  In: Field(colors[5]),
  Vain: Field(colors[6]),
});

class ColorGame extends SmartContract implements NFTUpdateBase {
  @state(Field) score = State<Field>(Field(0));
  @state(Field) color = State<Field>(Field(black));
  @state(PublicKey) user = State<PublicKey>(PublicKey.empty());
  @state(Field) maxScore = State<Field>(Field(0));

  @method async play(answers: Colors) {
    const Richard = answers.Richard.equals(rightAnswers.Richard);
    const Of = answers.Of.equals(rightAnswers.Of);
    const York = answers.York.equals(rightAnswers.York);
    const Gave = answers.Gave.equals(rightAnswers.Gave);
    const Battle = answers.Battle.equals(rightAnswers.Battle);
    const In = answers.In.equals(rightAnswers.In);
    const Vain = answers.Vain.equals(rightAnswers.Vain);
    const isCorrectArray = [Richard, Of, York, Gave, Battle, In, Vain];
    let score = Field(0);
    for (let i = 0; i < 7; i++) {
      score = score.add(Provable.if(isCorrectArray[i], Field(1), Field(0)));
    }

    this.score.set(score);
    const maxScore = this.maxScore.getAndRequireEquals();
    maxScore
      .equals(Field(7))
      .assertFalse("Game is over, the winner is already known");
    this.maxScore.set(
      Provable.if(score.greaterThan(maxScore), score, maxScore)
    );

    const color = Provable.if(
      Vain,
      rightAnswers.Vain,
      Provable.if(
        In,
        rightAnswers.In,
        Provable.if(
          Battle,
          rightAnswers.Battle,
          Provable.if(
            Gave,
            rightAnswers.Gave,
            Provable.if(
              York,
              rightAnswers.York,
              Provable.if(
                Of,
                rightAnswers.Of,
                Provable.if(Richard, rightAnswers.Richard, Field(black))
              )
            )
          )
        )
      )
    );
    this.color.set(color);
    const sender = this.sender.getAndRequireSignature();
    this.user.set(sender);
  }

  @method.returns(Bool)
  async canUpdate(
    collectionAddress: PublicKey,
    nftAddress: PublicKey,
    input: NFTState,
    output: NFTState
  ): Promise<Bool> {
    const user = this.user.getAndRequireEquals();
    const score = this.score.getAndRequireEquals();
    const color = this.color.getAndRequireEquals();
    input.context.custom[0].assertEquals(score);
    input.context.custom[1].assertEquals(color);
    input.owner
      .equals(user)
      .or(score.equals(Field(7)))
      .assertTrue("Only the winner can change the NFT owner");
    output.owner.assertEquals(user);
    return Bool(true);
  }
}

let nftContractVk: VerificationKey;
let nftProgramVk: VerificationKey;
let collectionVk: VerificationKey;
let adminVk: VerificationKey;
const cache: Cache = Cache.FileSystem("./cache");
const zkNFTKey = TestPublicKey.random();
const zkCollectionKey = TestPublicKey.random();
const zkAdminKey = TestPublicKey.random();
const zkColorGameKey = TestPublicKey.random();
const { Collection } = NonFungibleTokenContractsFactory({
  adminContract: NFTAdmin,
  updateFactory: () => ColorGame,
});

const collectionContract = new Collection(zkCollectionKey);
const tokenId = collectionContract.deriveTokenId();
const adminContract = new NFTAdmin(zkAdminKey);
const colorGameContract = new ColorGame(zkColorGameKey);
const NUMBER_OF_USERS = 6;
let admin: TestPublicKey;
let users: TestPublicKey[] = [];

let creator: TestPublicKey;
let owner: TestPublicKey;

interface NFTParams {
  name: string;
  address: PublicKey;
  collection: PublicKey;
  // We do not use private metadata in this test
  //privateMetadata: string;
}

const nftParams: NFTParams[] = [];

describe(`NFT ZkProgram tests: ${chain} ${readOnly ? "read-only " : ""}${
  noLog ? "noLog" : ""
} `, () => {
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
      const { keys } = await initBlockchain(chain, NUMBER_OF_USERS + 2);
      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    } else if (chain === "lightnet") {
      const { keys } = await initBlockchain(chain, NUMBER_OF_USERS + 2);

      admin = TestPublicKey(keys[1].key);
      users = keys.slice(2);
    }
    creator = users[0];
    owner = creator;
    assert(users.length >= NUMBER_OF_USERS);
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());

    console.log("Collection contract address:", zkCollectionKey.toBase58());
    console.log("Admin contract address:", zkAdminKey.toBase58());
    console.log("NFT contract address:", zkNFTKey.toBase58());
    console.log("Color Game contract address:", zkColorGameKey.toBase58());

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

  it("should compile Color Game", async () => {
    console.log("compiling...");
    console.time("compiled Color Game");
    await ColorGame.compile({ cache });
    console.timeEnd("compiled Color Game");
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

  it("should compile nft ZkProgram", async () => {
    console.time("compiled NFTProgram");
    nftProgramVk = (await NFTGameProgram.compile({ cache })).verificationKey;
    console.timeEnd("compiled NFTProgram");
    console.log("NFTProgram vk hash:", nftProgramVk.hash.toJSON());
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
    const { name, metadata } = await randomMetadata({
      includePrivateTraits: false,
      pin: false,
    });
    // add color game contract address to metadata to be checked by the Zkprogram
    metadata.addTrait({
      key: "contractX",
      type: "field",
      value: zkColorGameKey.x,
    });
    metadata.addTrait({
      key: "contractIsOdd",
      type: "field",
      value: zkColorGameKey.isOdd.toField(),
    });
    const contractX = metadata.map.get(fieldFromString("contractX"));
    const isOdd = metadata.map.get(fieldFromString("contractIsOdd"));

    assert.strictEqual(
      MetadataValue.new({ value: zkColorGameKey.x, type: "field" })
        .hash()
        .equals(contractX)
        .toBoolean(),
      true
    );
    assert.strictEqual(
      MetadataValue.new({
        value: zkColorGameKey.isOdd.toField(),
        type: "field",
      })
        .hash()
        .equals(isOdd)
        .toBoolean(),
      true
    );
    const ipfsHash = await pinJSON({
      data: metadata.toJSON(true),
      name: "metadata",
    });
    if (!ipfsHash) throw new Error("Failed to pin metadata");

    nftParams.push({
      name,
      address: zkNFTKey,
      collection: zkCollectionKey,
    });
    await fetchMinaAccount({ publicKey: creator, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    owner = users[1];
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
          metadata: metadata.map.root,
          data: NFTData.new({
            owner,
            canChangeMetadata: !readOnly,
            canChangeStorage: !readOnly,
            canPause: true,
            canChangeName: false,
            canChangeOwnerByProof: !readOnly,
            canTransfer: !readOnly,
          }),
          metadataVerificationKeyHash: nftProgramVk.hash,
          expiry,
          fee: UInt64.from(10_000_000_000),
          storage: Storage.fromString(ipfsHash),
        });
        AccountUpdate.fundNewAccount(creator, 1);
        await colorGameContract.deploy({});
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([creator.key, zkNFTKey.key, zkColorGameKey.key]),
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

    assert.strictEqual(dataCheck.owner.equals(owner).toBoolean(), true);
    assert.strictEqual(
      dataCheck.approved.equals(PublicKey.empty()).toBoolean(),
      true
    );
    console.timeEnd("minted NFT");
  });

  it("should play game", async () => {
    Memory.info("before play");
    console.time("played game");
    const player = owner;
    await fetchMinaAccount({ publicKey: player, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });

    const answers = new Colors({
      Richard: Field(colors[0]),
      Of: Field(75843),
      York: Field(colors[2]),
      Gave: Field(colors[3]),
      Battle: Field(65943),
      In: Field(colors[5]),
      Vain: Field(67483),
    });

    const tx = await Mina.transaction(
      {
        sender: player,
        fee: 100_000_000,
        memo: `Play game`.substring(0, 30),
      },
      async () => {
        await colorGameContract.play(answers);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([player.key]),
          description: "play",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("played game");

    await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });
    const score = colorGameContract.score.get();
    const color = colorGameContract.color.get();
    const user = colorGameContract.user.get();
    console.log("score:", score.toJSON());
    console.log("color:", "#" + color.toBigInt().toString(16).toUpperCase());
    console.log("user", user.toBase58());
    assert.strictEqual(user.equals(player).toBoolean(), true);
    assert.strictEqual(score.equals(Field(4)).toBoolean(), true);
  });

  it("should update NFT metadata", async () => {
    Memory.info("before update");
    console.time("updated NFT");

    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });
    const score = colorGameContract.score.get();
    const color = colorGameContract.color.get();
    const user = colorGameContract.user.get();
    assert.strictEqual(user.equals(owner).toBoolean(), true);
    assert.strictEqual(score.equals(Field(4)).toBoolean(), true);
    assert.strictEqual(color.equals(Field(colors[5])).toBoolean(), true);

    const nftAccount = Mina.getAccount(zkNFTKey, tokenId);
    const nftContract = new NFT(zkNFTKey, tokenId);
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
      oracleAddress: zkColorGameKey,
      context: new NFTTransactionContext({
        custom: [score, color, Field(0)],
      }),
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
    const fetchResult = await fetch(
      createIpfsURL({ hash: nftContract.storage.get().toString() })
    );
    if (!fetchResult.ok) {
      throw new Error("Failed to fetch metadata");
    }
    const json = await fetchResult.json();
    if (!json) {
      throw new Error("Failed to fetch metadata");
    }

    const metadata = Metadata.fromJSON({
      json,
      checkRoot: true,
    });
    assert.strictEqual(nftState.metadata.toJSON(), metadata.map.root.toJSON());
    if (nftState.metadata.toJSON() !== metadata.map.root.toJSON()) {
      throw new Error(
        "NFT metadata is not the same as the one in the collection"
      );
    }
    const map = metadata.map.clone(); // we need to pass original metadata to the zkprogram
    metadata.addTrait({
      key: "color",
      type: "field",
      value: color,
    });
    metadata.addTrait({
      key: "score",
      type: "field",
      value: score,
    });

    const ipfsHash = await pinJSON({
      data: metadata.toJSON(true),
      name: "metadata",
    });
    if (!ipfsHash) throw new Error("Failed to pin new metadata");
    console.time("proved update");

    const update = await NFTGameProgram.updateMetadataAndOwner(
      nftState,
      map,
      zkColorGameKey,
      score,
      color,
      Storage.fromString(ipfsHash),
      owner
    );

    const dynamicProof = NFTUpdateProof.fromProof(update.proof);
    console.timeEnd("proved update");

    let success = true;

    try {
      const tx = await Mina.transaction(
        {
          sender: users[2],
          fee: 100_000_000,
          memo: `Update NFT ${name}`.substring(0, 30),
        },
        async () => {
          await collectionContract.updateWithOracle(dynamicProof, nftProgramVk);
        }
      );
      await tx.prove();
      const txSigned = tx.sign([users[2].key]);
      assert.strictEqual(
        (
          await sendTx({
            tx: txSigned,
            description: "update",
          })
        )?.status,
        expectedTxStatus
      );
      await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
      const nftCheck = new NFT(zkNFTKey, tokenId);
      const storageCheck = nftCheck.storage.get().toString();
      assert.strictEqual(storageCheck, ipfsHash);
      const metadataCheck = nftCheck.metadata.get();
      assert.strictEqual(metadataCheck.toJSON(), metadata.map.root.toJSON());
    } catch (error: any) {
      console.log("Failed to update read-only NFT:", error?.message ?? "");
      success = false;
    }
    assert.strictEqual(success, !readOnly);
    console.timeEnd("updated NFT");
  });

  it("should win game", { skip: readOnly }, async () => {
    Memory.info("before win");
    console.time("win game");
    const player = users[3];
    await fetchMinaAccount({ publicKey: player, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });

    const answers = new Colors({
      Richard: Field(colors[0]),
      Of: Field(colors[1]),
      York: Field(colors[2]),
      Gave: Field(colors[3]),
      Battle: Field(colors[4]),
      In: Field(colors[5]),
      Vain: Field(colors[6]),
    });

    const tx = await Mina.transaction(
      {
        sender: player,
        fee: 100_000_000,
        memo: `Win game`.substring(0, 30),
      },
      async () => {
        await colorGameContract.play(answers);
      }
    );
    await tx.prove();
    assert.strictEqual(
      (
        await sendTx({
          tx: tx.sign([player.key]),
          description: "win game",
        })
      )?.status,
      expectedTxStatus
    );
    console.timeEnd("win game");

    await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });
    const score = colorGameContract.score.get();
    const color = colorGameContract.color.get();
    const user = colorGameContract.user.get();
    console.log("score:", score.toJSON());
    console.log("color:", "#" + color.toBigInt().toString(16).toUpperCase());
    console.log("user", user.toBase58());
    assert.strictEqual(user.equals(player).toBoolean(), true);
    assert.strictEqual(score.equals(Field(7)).toBoolean(), true);
  });

  it(
    "should update NFT owner to the game winner",
    {
      skip: readOnly,
    },
    async () => {
      Memory.info("before update");
      console.time("updated NFT");
      const winner = users[3];

      await fetchMinaAccount({ publicKey: winner, force: true });
      await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
      await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
      await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
      await fetchMinaAccount({ publicKey: zkColorGameKey, force: true });
      const score = colorGameContract.score.get();
      const color = colorGameContract.color.get();
      const user = colorGameContract.user.get();
      assert.strictEqual(user.equals(winner).toBoolean(), true);
      assert.strictEqual(score.equals(Field(7)).toBoolean(), true);
      assert.strictEqual(color.equals(Field(colors[6])).toBoolean(), true);

      const nftAccount = Mina.getAccount(zkNFTKey, tokenId);
      const nftContract = new NFT(zkNFTKey, tokenId);
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
        oracleAddress: zkColorGameKey,
        context: new NFTTransactionContext({
          custom: [score, color, Field(0)],
        }),
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
      const fetchResult = await fetch(
        createIpfsURL({ hash: nftContract.storage.get().toString() })
      );
      if (!fetchResult.ok) {
        throw new Error("Failed to fetch metadata");
      }
      const json = await fetchResult.json();
      if (!json) {
        throw new Error("Failed to fetch metadata");
      }

      const metadata = Metadata.fromJSON({
        json,
        checkRoot: true,
      });
      assert.strictEqual(
        nftState.metadata.toJSON(),
        metadata.map.root.toJSON()
      );
      if (nftState.metadata.toJSON() !== metadata.map.root.toJSON()) {
        throw new Error(
          "NFT metadata is not the same as the one in the collection"
        );
      }
      const map = metadata.map.clone(); // we need to pass original metadata to the zkprogram
      metadata.addTrait({
        key: "color",
        type: "field",
        value: color,
      });
      metadata.addTrait({
        key: "score",
        type: "field",
        value: score,
      });

      const ipfsHash = await pinJSON({
        data: metadata.toJSON(true),
        name: "metadata",
      });
      if (!ipfsHash) throw new Error("Failed to pin new metadata");
      console.time("proved update");

      const update = await NFTGameProgram.updateMetadataAndOwner(
        nftState,
        map,
        zkColorGameKey,
        score,
        color,
        Storage.fromString(ipfsHash),
        winner
      );

      const dynamicProof = NFTUpdateProof.fromProof(update.proof);
      console.timeEnd("proved update");

      let success = true;

      try {
        const tx = await Mina.transaction(
          {
            sender: winner,
            fee: 100_000_000,
            memo: `Change owner to the game winner for NFT ${name}`.substring(
              0,
              30
            ),
          },
          async () => {
            await collectionContract.updateWithOracle(
              dynamicProof,
              nftProgramVk
            );
          }
        );
        await tx.prove();
        const txSigned = tx.sign([winner.key]);
        assert.strictEqual(
          (
            await sendTx({
              tx: txSigned,
              description: "change owner to the game winner",
            })
          )?.status,
          expectedTxStatus
        );
        await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
        const nftCheck = new NFT(zkNFTKey, tokenId);
        const storageCheck = nftCheck.storage.get().toString();
        const ownerCheck = NFTData.unpack(nftCheck.packedData.get()).owner;
        const metadataCheck = nftCheck.metadata.get();
        assert.strictEqual(storageCheck, ipfsHash);
        assert.strictEqual(metadataCheck.toJSON(), metadata.map.root.toJSON());
        assert.strictEqual(ownerCheck.equals(winner).toBoolean(), true);
        owner = winner;
      } catch (error: any) {
        console.log("Failed to update read-only NFT:", error?.message ?? "");
        success = false;
      }
      assert.strictEqual(success, !readOnly);
      console.timeEnd("updated NFT");
    }
  );

  it("should fail to transfer soulbound NFT", { skip: !readOnly }, async () => {
    Memory.info("before transfer");
    await fetchMinaAccount({ publicKey: owner, force: true });
    await fetchMinaAccount({ publicKey: zkCollectionKey, force: true });
    await fetchMinaAccount({ publicKey: zkAdminKey, force: true });
    await fetchMinaAccount({ publicKey: zkNFTKey, tokenId, force: true });
    const requireTransferApproval = CollectionData.unpack(
      collectionContract.packedData.get()
    ).requireTransferApproval.toBoolean();
    console.log("requireTransferApproval", requireTransferApproval);
    const to = users[2];
    const nft = nftParams.find(
      (p) =>
        p.address.equals(zkNFTKey).toBoolean() &&
        p.collection.equals(zkCollectionKey).toBoolean()
    );
    if (!nft) {
      throw new Error("NFT not found");
    }
    const { name } = nft;
    let success = true;

    try {
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
    } catch (e: any) {
      console.log("Failed to transfer soulbound NFT:", e?.message ?? "");
      success = false;
    }
    assert.strictEqual(success, false);
  });
});
