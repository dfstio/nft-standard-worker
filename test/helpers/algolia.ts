import { algoliasearch } from "algoliasearch";
const { ALGOLIA_KEY, ALGOLIA_PROJECT } = process.env;

const chain = "devnet";

export interface NFTDataSerialized {
  type: "nft" | "collection";
  address: string;
  collectionName: string;
  collectionAddress: string;
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
}

export interface CollectionDataSerialized extends NFTDataSerialized {
  type: "collection";
  banner?: string;
  creator: string;
  admin: string;
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
    console.log("algoliaWriteToken", info.name, indexName);

    const data = {
      objectID:
        info.collectionAddress + info.type === "nft" ? "." + info.address : "",
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
