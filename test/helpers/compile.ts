import { describe, it } from "node:test";
import assert from "node:assert";
import { Mina, VerificationKey, Field, Cache } from "o1js";
import {
  NFT,
  AdminContract,
  WhitelistedAdminContract,
  Collection,
  WhitelistedCollection,
  NonFungibleTokenBidContract,
  nftVerificationKeys,
} from "@minatokens/nft";
import { VerificationKeyUpgradeAuthority } from "@minatokens/upgradable";
import { initBlockchain, blockchain } from "zkcloudworker";
import fs from "fs/promises";

let o1jsVersion: string;
let zkcloudworkerVersion: string;
let isDifferent = false;

type CompilableInternal = {
  name: string;
  compile({ cache }: { cache: Cache }): Promise<{
    verificationKey: {
      data: string;
      hash: Field;
    };
  }>;
  analyzeMethods(): Promise<
    Record<
      string,
      {
        rows: number;
      }
    >
  >;
};

type Contracts = {
  o1js: string;
  zkcloudworker: string;
  vk: {
    [key: string]: {
      hash: string;
      data: string;
      type: "nft" | "collection" | "admin" | "upgrade" | "user";
    };
  };
};

const contracts: {
  name: string;
  contract: CompilableInternal;
  type: "nft" | "collection" | "admin" | "upgrade" | "user";
}[] = [
  { name: "NFT", contract: NFT, type: "nft" },
  { name: "Collection", contract: Collection, type: "collection" },
  {
    name: "WhitelistedCollection",
    contract: WhitelistedCollection,
    type: "collection",
  },
  { name: "AdminContract", contract: AdminContract, type: "admin" },
  {
    name: "WhitelistedAdminContract",
    contract: WhitelistedAdminContract,
    type: "admin",
  },
  {
    name: "VerificationKeyUpgradeAuthority",
    contract: VerificationKeyUpgradeAuthority,
    type: "upgrade",
  },
  {
    name: "NonFungibleTokenBidContract",
    contract: NonFungibleTokenBidContract,
    type: "user",
  },
];

const verificationKeys: { name: string; verificationKey: VerificationKey }[] =
  [];

export async function compileContracts(chain: blockchain) {
  const networkId = chain === "mainnet" ? "mainnet" : "devnet";

  const cache: Cache = Cache.FileSystem(
    networkId === "mainnet" ? "./cache/mainnet" : "./cache"
  );

  await it("should initialize a blockchain", async () => {
    await initBlockchain(chain);
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());
    o1jsVersion = JSON.parse(
      await fs.readFile("./node_modules/o1js/package.json", "utf8")
    ).version;
    console.log(`o1js version:`, o1jsVersion);
    zkcloudworkerVersion = JSON.parse(
      await fs.readFile("./node_modules/zkcloudworker/package.json", "utf8")
    ).version;
    console.log(`zkcloudworker version:`, zkcloudworkerVersion);
    for (const contract of contracts) {
      console.log(`${contract.name} contract:`, contract.contract.name);
    }
  });

  await it("should analyze methods", async () => {
    console.log("Analyzing contracts methods...");
    console.time("methods analyzed");
    const methods: any[] = [];
    for (const contract of contracts) {
      methods.push({
        name: contract.name,
        result: await contract.contract.analyzeMethods(),
        skip: true,
      });
    }
    console.timeEnd("methods analyzed");
    const maxRows = 2 ** 16;
    for (const contract of methods) {
      // calculate the size of the contract - the sum or rows for each method
      const size = Object.values(contract.result).reduce(
        (acc, method) => acc + (method as any).rows,
        0
      ) as number;
      // calculate percentage rounded to 0 decimal places
      const percentage = Math.round(((size * 100) / maxRows) * 100) / 100;

      console.log(
        `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
      );
      if (contract.skip !== true)
        for (const method in contract.result) {
          console.log(method, `rows:`, (contract.result as any)[method].rows);
        }
    }
  });

  await it("should compile", async () => {
    console.log("compiling...");
    for (const contract of contracts) {
      console.time(`compiled ${contract.name}`);
      const { verificationKey } = await contract.contract.compile({ cache });
      verificationKeys.push({ name: contract.name, verificationKey });
      console.timeEnd(`compiled ${contract.name}`);
    }
  });

  await it("should verify the verification keys", async () => {
    for (const contract of contracts) {
      const verificationKey = verificationKeys.find(
        (vk) => vk.name === contract.name
      )?.verificationKey;
      const recordedVerificationKey =
        nftVerificationKeys[networkId]["vk"][contract.name];
      if (!verificationKey) {
        throw new Error(`Verification key for ${contract.name} not found`);
      }
      if (!recordedVerificationKey) {
        isDifferent = true;
      } else {
        if (verificationKey.hash.toJSON() !== recordedVerificationKey.hash) {
          console.error(`Verification key for ${contract.name} is different`);
          isDifferent = true;
        }
        if (verificationKey.data !== recordedVerificationKey.data) {
          console.error(
            `Verification key data for ${contract.name} is different`
          );
          isDifferent = true;
        }
      }
    }
  });

  await it("should save new verification keys", async () => {
    if (isDifferent) {
      console.log("saving new verification keys");
      let vk: Contracts = {
        o1js: o1jsVersion,
        zkcloudworker: zkcloudworkerVersion,
        vk: contracts.reduce(
          (acc, c) => ({
            ...acc,
            [c.name]: {
              hash: (c.contract as any)?._verificationKey?.hash?.toJSON(),
              data: (c.contract as any)?._verificationKey?.data,
              type: c.type,
            },
          }),
          {}
        ),
      };

      let contractList = contracts.reduce(
        (acc, c) => ({
          ...acc,
          [c.name]: "ContractStart" + c.name + "ContractEnd",
        }),
        {}
      );

      const json: any = {};
      json[networkId] = vk;
      const contractsString = JSON.stringify({ contractList }, null, 2)
        .replace(/"ContractStart/g, "")
        .replace(/ContractEnd"/g, "");
      const vkString = JSON.stringify(json, null, 2);

      await fs.writeFile(
        `./vk/${networkId}-verification-keys.txt`,
        `${vkString}\n\n${contractsString}`
      );
    } else {
      console.log("Verification keys are up to date");
    }
  });
}
