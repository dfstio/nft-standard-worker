import { algoliasearch } from "algoliasearch";
const { ALGOLIA_KEY, ALGOLIA_PROJECT } = process.env;

const chain = "devnet";

export async function algoliaWriteNFT(params: {
  tokenAddress: string;
  collectionAddress: string;
  info: object;
}): Promise<boolean> {
  const { tokenAddress, collectionAddress, info } = params;
  if (ALGOLIA_KEY === undefined) throw new Error("ALGOLIA_KEY is undefined");
  if (ALGOLIA_PROJECT === undefined)
    throw new Error("ALGOLIA_PROJECT is undefined");
  try {
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    const indexName = `standard-${chain}`;
    console.log("algoliaWriteToken", params, indexName);

    const data = {
      objectID: collectionAddress + "." + tokenAddress,
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
    console.error("algoliaWriteToken error:", { error, params });
    return false;
  }
}
