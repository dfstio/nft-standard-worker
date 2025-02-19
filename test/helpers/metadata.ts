import { Field, UInt64, PrivateKey, PublicKey } from "o1js";
import {
  Metadata,
  MetadataTree,
  Text,
  MetadataFieldType,
  MetadataFieldTypeValues,
} from "@silvana-one/nft";
import {
  uniqueNamesGenerator,
  names,
  adjectives,
  colors,
  animals,
  countries,
  languages,
} from "unique-names-generator";
import {
  serializeIndexedMap,
  IndexedMapSerialized,
  pinJSON,
} from "zkcloudworker";
export {
  randomMetadata,
  randomName,
  randomText,
  randomImage,
  randomBanner,
  randomURL,
  randomField,
  randomNumber,
  randomAddress,
  randomTree,
  randomMap,
};

const NUMBER_OF_TRAITS = 5;
const NUMBER_OF_TREE_ENTRIES = 20;

async function randomMetadata(
  params: {
    includePrivateTraits?: boolean;
    includeBanner?: boolean;
    pin?: boolean;
  } = {}
): Promise<{
  name: string;
  ipfsHash?: string;
  metadataRoot: Field;
  privateMetadata: string;
  serializedMap: IndexedMapSerialized;
  metadata: Metadata;
  data: object;
}> {
  const {
    includePrivateTraits = true,
    includeBanner = false,
    pin = true,
  } = params;
  const metadata = randomMap({ includePrivateTraits, includeBanner });
  const privateMetadata = JSON.stringify(metadata.toJSON(true), null, 2);
  let ipfsHash: string | undefined = undefined;
  if (pin) {
    ipfsHash = pin
      ? await pinJSON({
          data: metadata.toJSON(false),
          name: "metadata",
        })
      : undefined;
    if (!ipfsHash) throw new Error("Failed to pin metadata");
  }
  return {
    name: metadata.name,
    ipfsHash,
    metadataRoot: metadata.map.root,
    privateMetadata,
    serializedMap: serializeIndexedMap(metadata.map),
    metadata,
    data: metadata.toJSON(false),
  };
}

function randomName(): string {
  let counter = 0;
  while (true) {
    const name = uniqueNamesGenerator({
      dictionaries: [names],
      length: 1,
    });
    if (name.length <= 30) return name;
    counter++;
    if (counter > 1000) throw new Error("Too many retries");
  }
}

function randomText(): string {
  const length = Math.floor(Math.random() * 20) + 1;
  const words = Array.from({ length }, () =>
    uniqueNamesGenerator({
      dictionaries: [
        ...[adjectives, names, colors, animals, countries, languages].sort(
          () => Math.random() - 0.5
        ),
      ],
      length: 6,
      separator: " ",
    })
  );
  const text = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(". ");
  return text;
}

function randomImage(): string {
  return `https://picsum.photos/seed/${Math.floor(
    Math.random() * 10000000
  )}/540/670`;
}

function randomBanner(): string {
  return `https://picsum.photos/seed/${Math.floor(
    Math.random() * 10000000
  )}/1920/300`;
}

function randomURL(): string {
  return `https://example.com/${randomName()}`;
}

function randomField(): Field {
  return Field.random();
}

function randomNumber(): UInt64 {
  const max = UInt64.MAXINT().toBigInt();
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomBigInt = BigInt(
    "0x" +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
  );
  if (randomBigInt > max) {
    throw new Error("Random number is greater than max");
  }
  return UInt64.from(randomBigInt);
}

function randomAddress(): PublicKey {
  return PrivateKey.random().toPublicKey();
}

function randomTree() {
  const height = Math.floor(Math.random() * 240) + 10;
  const numberOfElements = Math.floor(Math.random() * NUMBER_OF_TREE_ENTRIES);
  const values = Array.from({ length: numberOfElements }, (_, i) => ({
    key: BigInt(i),
    value: Field.random(),
  }));
  const tree = new MetadataTree(height, values);
  return tree;
}

function randomMap(
  params: { includePrivateTraits?: boolean; includeBanner?: boolean } = {}
): Metadata {
  const { includePrivateTraits = true, includeBanner = false } = params;
  const map = new Metadata({
    name: randomName(),
    description: Math.random() < 0.7 ? randomText() : undefined,
    image: randomImage(),
    banner: includeBanner ? randomBanner() : undefined,
  });
  const numberOfTraits = Math.floor(Math.random() * NUMBER_OF_TRAITS);
  for (let i = 0; i < numberOfTraits; i++) {
    const type = Object.keys(MetadataFieldTypeValues)[
      Math.floor(Math.random() * Object.keys(MetadataFieldTypeValues).length)
    ] as MetadataFieldType;
    let value:
      | string
      | Text
      | Field
      | Metadata
      | MetadataTree
      | UInt64
      | PublicKey;
    switch (type) {
      case "string":
        value = randomName();
        break;
      case "text":
        value = randomText();
        break;
      case "image":
        value = randomImage();
        break;
      case "url":
        value = randomURL();
        break;
      case "field":
        value = randomField();
        break;
      case "number":
        value = randomNumber();
        break;
      case "address":
        value = randomAddress();
        break;
      case "map":
        value = randomMap();
        break;
      case "tree":
        value = randomTree();
        break;
      default:
        throw new Error(`Unknown type: ${type}`);
    }
    map.addTrait({
      key: randomName(),
      type,
      value,
      isPrivate: includePrivateTraits
        ? Math.random() < 0.3
          ? undefined
          : Math.random() < 0.5
        : false,
    });
  }
  return map;
}
