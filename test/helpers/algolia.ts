import { algoliasearch } from "algoliasearch";
const { ALGOLIA_KEY, ALGOLIA_PROJECT } = process.env;

const chain = "devnet";

export interface NFTDataSerialized {
  type: "nft" | "collection";
  tokenAddress: string;
  collectionName: string;
  collectionAddress: string;
  symbol: string;
  uri: string;
  tokenId: string;
  adminAddress: string;
  name: string;
  image: string;
  description?: string;
  metadataRoot: string;
  storage: string;
  metadataVerificationKeyHash: string;
  owner: string;
  approved?: string;
  version: number;
  id: string;
  canChangeOwnerByProof: boolean;
  canTransfer: boolean;
  canApprove: boolean;
  canChangeMetadata: boolean;
  canChangeStorage: boolean;
  canChangeName: boolean;
  canChangeMetadataVerificationKeyHash: boolean;
  canPause: boolean;
  isPaused: boolean;
  requireOwnerAuthorizationToUpgrade: boolean;
  metadata: object;
  status: string;
  rating: number;
  updated: number;
  created: number;
  chain: string;
  price?: number;
  likes?: number;
  like?: boolean;
}

export interface CollectionDataSerialized extends NFTDataSerialized {
  type: "collection";
  banner?: string;
  creator: string;
  adminAddress: string;
  baseURL: string;
  royaltyFee: number;
  transferFee: string;
  requireTransferApproval: boolean;
  mintingIsLimited: boolean;
  collectionIsPaused: boolean;
}

export async function algoliaWriteNFT(
  info: NFTDataSerialized | CollectionDataSerialized
): Promise<boolean> {
  if (ALGOLIA_KEY === undefined) throw new Error("ALGOLIA_KEY is undefined");
  if (ALGOLIA_PROJECT === undefined)
    throw new Error("ALGOLIA_PROJECT is undefined");
  try {
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    const indexName = `standard-${chain}`;
    const objectID =
      info.collectionAddress +
      (info.type === "nft" ? "." + info.tokenAddress : "");
    //console.log("objectID", objectID);
    console.log("NFT", info.name, indexName, objectID);

    const data = {
      objectID,
      ...info,
    };

    const result = await client.saveObject({
      indexName,
      body: data,
    });
    if (result.taskID === undefined) {
      console.error("algoliaWriteToken: Algolia write result is", result);
      return false;
    }

    return true;
  } catch (error) {
    console.error("algoliaWriteNFT error:", { error, info });
    return false;
  }
}
