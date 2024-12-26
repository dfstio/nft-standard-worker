import { describe, it } from "node:test";
import assert from "node:assert";
import { Field } from "o1js";
import { Whitelist, Storage } from "@minatokens/storage";
import { TEST_ACCOUNTS } from "../config.js";

const hash = "bafkreiaqezwqytp4ne3cuxtvaihfnux6uii7mmcgydr47vu53spmppga64";
const root =
  "19832898645574460675189150233738669985941120585573738902441349680248352282647";
describe("Save whitelist", () => {
  it.skip("should save whitelist", async () => {
    const whitelist = await createWhitelist();
    console.log("ipfs:", whitelist.storage.toString());
    console.log("root:", whitelist.root.toJSON());
  });

  it("should load whitelist", async () => {
    const whitelist = new Whitelist({
      root: Field.fromJSON(root),
      storage: Storage.fromString(hash),
    });
    const map = (await whitelist.load()).assertSome();
    console.log(map.root.toJSON());
    assert.deepEqual(map.root.toJSON(), root);
  });
});

async function createWhitelist() {
  const whitelist = await Whitelist.create({
    list: TEST_ACCOUNTS.slice(5)
      .map((user) => ({
        address: user.publicKey,
        amount: 50_000_000_000,
      }))
      .slice(0, 5),
  });
  return whitelist;
}
