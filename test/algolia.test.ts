import { describe, it } from "node:test";
import assert from "node:assert";
import {
  algoliaWriteNFT,
  CollectionDataSerialized,
  NFTDataSerialized,
} from "./helpers/algolia.js";
import {
  Collection,
  NFT,
  MintEvent,
  NFTData,
  fieldToString,
  CollectionData,
} from "@minatokens/nft";
import { PublicKey, TokenId, Mina } from "o1js";
import { fetchMinaAccount, initBlockchain, sleep } from "zkcloudworker";
import { processArguments } from "./helpers/utils.js";
import { createIpfsURL } from "@minatokens/storage";

const { chain } = processArguments();

const collectionAddresses: string[] = [
  "B62qkhsLDWs1juimpkvj7DJokLuNkfTwBkUekpN2MxKTjgMqntWyAWT",
  "B62qpqba9DS37GQUD6ftixCpYpZSFvvef1hC4LQphpCWVyJrVb2jTRU",
  "B62qk8ibS4FcSSSduJvkYcNFPAETbW36yk865ypiCeKHwoeLR2tsc1A",
  "B62qmEJG4kpCWNLStGJtvAmJKeKmUovnFvaZhvQmwcyaW6ASN2EyC6K",
  "B62qjss762qWFkcxv9UdmTyhTTBpkGoJHXtkBMiWTzQQeRWs3mE6S2U",
  "B62qmPKTEcQ3mv9vbmFJjDrpqCtpJmeKNoaRHXvtctzFsp2RLkm3Kkh",
];
const nfts: NFTDataSerialized[] = [];
const collections: CollectionDataSerialized[] = [];

describe("Algolia", () => {
  it("should get collection data", async () => {
    await initBlockchain(chain);
    for (const collectionAddress of collectionAddresses) {
      await fetchMinaAccount({ publicKey: collectionAddress, force: true });
      const collection = new Collection(
        PublicKey.fromBase58(collectionAddress)
      );
      const events = await collection.fetchEvents();
      console.log(
        `${collectionAddress} NFTs:`,
        events.filter((e) => e.type === "mint").length
      );
      const collectionDataResult = await getCollectionData({
        collection: collectionAddress,
      });
      if (!collectionDataResult) {
        throw new Error("Failed to get collection data");
      }
      collections.push(collectionDataResult);
      for (const event of events) {
        if (event.type === "mint") {
          if (event.event.data instanceof MintEvent) {
            const mintEvent: MintEvent = event.event.data;
            const address = mintEvent.address.toBase58();
            if (address !== collectionAddress) {
              const nftData = await getNFTData({
                address,
                collection: collectionAddress,
                collectionName: collectionDataResult.collectionName,
                symbol: collectionDataResult.symbol,
                uri: collectionDataResult.uri,
                adminAddress: collectionDataResult.adminAddress,
              });
              if (nftData) {
                nfts.push(nftData);
              } else throw new Error(`Failed to get NFT data for ${address}`);
            }
          } else {
            throw new Error("Event data is not a MintEvent");
          }
        }
      }
    }
  });

  it("should write metadata to Algolia", async () => {
    console.time("NFT data updated");
    for (const collection of collections) await algoliaWriteNFT(collection);
    for (const nft of nfts) {
      await algoliaWriteNFT(nft);
      await sleep(1000);
    }
    console.timeEnd("NFT data updated");
  });
});

async function getNFTData(params: {
  address: string;
  collection: string;
  collectionName: string;
  symbol: string;
  uri: string;
  adminAddress: string;
}): Promise<NFTDataSerialized | undefined> {
  try {
    const address = PublicKey.fromBase58(params.address);
    const collection = PublicKey.fromBase58(params.collection);
    const tokenId = TokenId.derive(collection);
    await fetchMinaAccount({ publicKey: address, tokenId, force: true });
    const nft = new NFT(address, tokenId);
    const name = fieldToString(nft.name.get());
    const metadataRoot = nft.metadata.get().toJSON();
    const storage = nft.storage.get().toString();
    const ipfs = createIpfsURL({ hash: storage });
    const response = await fetch(ipfs);
    if (!response.ok) {
      console.log("Failed to fetch metadata from IPFS");
      return undefined;
    }
    const metadata = await response.json();
    if (!metadata) {
      console.log("Failed to parse metadata from IPFS");
      return undefined;
    }
    const metadataVerificationKeyHash = nft.metadataVerificationKeyHash
      .get()
      .toJSON();
    const data = NFTData.unpack(nft.packedData.get());
    /*
class NFTData extends Struct({

  owner: PublicKey,
  approved: PublicKey,
  version: UInt32,
  id: UInt64,
  canChangeOwnerByProof: Bool,
  canTransfer: Bool,
  canApprove: Bool,
  canChangeMetadata: boolean;
  canChangeStorage: boolean;
  canChangeName: boolean;
  canChangeMetadataVerificationKeyHash: boolean;
  canPause: boolean;
  isPaused: boolean;
  requireOwnerAuthorizationToUpgrade: boolean;
}) 
  */
    if (!metadata.image) {
      console.error("No image found in metadata");
      return undefined;
    }
    if (typeof metadata.image !== "string") {
      console.error("Image url is not a string");
      return undefined;
    }
    if (!metadata.metadataRoot) {
      console.error("No metadataRoot found in metadata");
      return undefined;
    }
    if (typeof metadata.metadataRoot !== "string") {
      console.error("Metadata root is not a string");
      return undefined;
    }
    if (metadataRoot !== metadata.metadataRoot) {
      console.error("Metadata root does not match");
      return undefined;
    }
    if (!metadata.name) {
      console.error("No name found in metadata");
      return undefined;
    }
    if (typeof metadata.name !== "string") {
      console.error("Name is not a string");
      return undefined;
    }
    if (name !== metadata.name) {
      console.error("Name does not match");
      return undefined;
    }

    if (metadata.description && typeof metadata.description !== "string") {
      console.error("Description is not a string");
      return undefined;
    }
    const nftData: NFTDataSerialized = {
      type: "nft",
      tokenAddress: address.toBase58(),
      collectionName: params.collectionName,
      collectionAddress: params.collection,
      symbol: params.symbol,
      uri: params.uri,
      adminAddress: params.adminAddress,
      tokenId: TokenId.toBase58(tokenId),
      name,
      image: metadata.image,
      description: metadata.description,
      metadataRoot,
      storage,
      metadataVerificationKeyHash,
      owner: data.owner.toBase58(),
      approved: data.approved.equals(PublicKey.empty()).toBoolean()
        ? undefined
        : data.approved.toBase58(),
      version: Number(data.version.toBigint()),
      id: data.id.toBigInt().toString(),
      canChangeOwnerByProof: data.canChangeOwnerByProof.toBoolean(),
      canTransfer: data.canTransfer.toBoolean(),
      canApprove: data.canApprove.toBoolean(),
      canChangeMetadata: data.canChangeMetadata.toBoolean(),
      canChangeStorage: data.canChangeStorage.toBoolean(),
      canChangeName: data.canChangeName.toBoolean(),
      canChangeMetadataVerificationKeyHash:
        data.canChangeMetadataVerificationKeyHash.toBoolean(),
      canPause: data.canPause.toBoolean(),
      isPaused: data.isPaused.toBoolean(),
      requireOwnerAuthorizationToUpgrade:
        data.requireOwnerAuthorizationToUpgrade.toBoolean(),
      metadata,
      status: "created",
      rating: 100,
      created: Date.now(),
      updated: Date.now(),
      chain,
    };
    return nftData;
  } catch (error) {
    console.log("Failed to get NFT data", error);
    return undefined;
  }
}

async function getCollectionData(params: {
  collection: string;
}): Promise<CollectionDataSerialized | undefined> {
  try {
    const address = PublicKey.fromBase58(params.collection);
    await fetchMinaAccount({ publicKey: address, force: true });
    const collection = new Collection(address);
    const collectionName = fieldToString(collection.collectionName.get());
    const creator = collection.creator.get().toBase58();
    const adminAddress = collection.admin.get().toBase58();
    const data = CollectionData.unpack(collection.packedData.get());
    const baseURL = collection.baseURL.get().toString();
    const royaltyFee = Number(data.royaltyFee.toBigint());
    const transferFee = data.transferFee.toBigInt().toString();
    const requireTransferApproval = data.requireTransferApproval.toBoolean();
    const mintingIsLimited = data.mintingIsLimited.toBoolean();
    const collectionIsPaused = data.isPaused.toBoolean();
    const uri = Mina.getAccount(address).zkapp?.zkappUri;
    if (!uri) {
      console.error("No uri found in collection");
      return undefined;
    }
    const symbol = Mina.getAccount(address).tokenSymbol;
    if (!symbol) {
      console.error("No symbol found in collection");
      return undefined;
    }
    const nftData = await getNFTData({
      address: params.collection,
      collection: params.collection,
      collectionName,
      symbol,
      uri,
      adminAddress,
    });
    if (!nftData) {
      console.error("Failed to get Master NFT data");
      return undefined;
    }
    const banner = (nftData.metadata as any).banner;
    if (banner && typeof banner !== "string") {
      console.error("Banner is not a string");
      return undefined;
    }
    const collectionData: CollectionDataSerialized = {
      ...nftData,
      type: "collection",
      collectionName,
      symbol,
      uri,
      banner,
      creator,
      adminAddress,
      baseURL,
      royaltyFee,
      transferFee,
      requireTransferApproval,
      mintingIsLimited,
      collectionIsPaused,
    };
    return collectionData;
  } catch (error) {
    console.log("Failed to get collection data", error);
    return undefined;
  }
}
