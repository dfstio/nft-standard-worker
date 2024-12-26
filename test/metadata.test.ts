import { describe, it } from "node:test";
import assert from "node:assert";
import { Metadata, ColorPlugin } from "../src/metadata/index.js";
import { randomMap, randomImage, randomMetadata } from "./helpers/metadata.js";
import { algoliaWriteNFT } from "./helpers/algolia.js";
import MinaSigner from "mina-signer";
const minaSigner = new MinaSigner({ network: "testnet" });

const NUMBER_OF_ITERATIONS = 20;
const printMetadata = false;

describe("Test serializing and deserializing Metadata", () => {
  it.skip("should serialize and deserialize Metadata with plugins", async () => {
    const map = new Metadata({
      name: "test",
      image: randomImage(),
      plugins: [new ColorPlugin()],
    });
    map.addTrait({
      key: "color1",
      type: "color",
      value: "blue",
    });
    map.addTrait({
      key: "color2",
      type: "color",
      value: "#800080",
    });
    map.addTrait({
      key: "color3",
      type: "color",
      value: 0xffa500,
    });
    const serializedPublic = JSON.stringify(map.toJSON(false), null, 2);
    const serializedPrivate = JSON.stringify(map.toJSON(true), null, 2);
    if (printMetadata) console.log("Serialized", serializedPrivate);
    assert(!serializedPublic.includes("isPrivate"));
    const deserializedPublic = Metadata.fromJSON({
      json: JSON.parse(serializedPublic) as any,
      checkRoot: false,
      plugins: [new ColorPlugin()],
    });
    const deserializedPrivate = Metadata.fromJSON({
      json: JSON.parse(serializedPrivate) as any,
      checkRoot: true,
      plugins: [new ColorPlugin()],
    });
    assert.deepStrictEqual(deserializedPrivate, map);
  });
  it.skip("should serialize and deserialize Metadata", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const map = randomMap();
      const serializedPublic = JSON.stringify(map.toJSON(false), null, 2);
      const serializedPrivate = JSON.stringify(map.toJSON(true), null, 2);
      if (printMetadata) console.log("Serialized", serializedPrivate);
      assert(!serializedPublic.includes("isPrivate"));
      const deserializedPublic = Metadata.fromJSON({
        json: JSON.parse(serializedPublic) as any,
        checkRoot: false,
      });
      const deserializedPrivate = Metadata.fromJSON({
        json: JSON.parse(serializedPrivate) as any,
        checkRoot: true,
      });
      assert.deepStrictEqual(deserializedPrivate, map);
    }
  });
  it("should write metadata to Algolia", async () => {
    const collection = minaSigner.genKeys();
    const nft = minaSigner.genKeys();
    const { data } = await randomMetadata();
    await algoliaWriteNFT({
      tokenAddress: nft.publicKey,
      collectionAddress: collection.publicKey,
      info: data,
    });
  });
});
