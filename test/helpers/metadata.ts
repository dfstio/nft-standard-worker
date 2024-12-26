import { Field } from "o1js";
import {
  Metadata,
  MetadataTree,
  Text,
  MetadataFieldType,
  MetadataFieldTypeValues,
} from "@minatokens/nft";
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
  randomTree,
  randomMap,
};

const NUMBER_OF_TRAITS = 5;
const NUMBER_OF_TREE_ENTRIES = 20;

async function randomMetadata(
  params: { includePrivateTraits?: boolean; includeBanner?: boolean } = {}
): Promise<{
  name: string;
  ipfsHash: string;
  metadataRoot: Field;
  privateMetadata: string;
  serializedMap: IndexedMapSerialized;
  map: Metadata;
  data: object;
}> {
  const { includePrivateTraits = true, includeBanner = false } = params;
  const metadata = randomMap({ includePrivateTraits, includeBanner });
  const privateMetadata = JSON.stringify(metadata.toJSON(true), null, 2);
  const ipfsHash = await pinJSON({
    data: metadata.toJSON(false),
    name: "metadata",
  });
  if (!ipfsHash) throw new Error("Failed to pin metadata");
  return {
    name: metadata.name,
    ipfsHash,
    metadataRoot: metadata.map.root,
    privateMetadata,
    serializedMap: serializeIndexedMap(metadata.map),
    map: metadata,
    data: metadata.toJSON(false),
  };
}

function randomName() {
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

function randomText() {
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

function randomImage() {
  return `https://picsum.photos/seed/${Math.floor(
    Math.random() * 10000000
  )}/540/670`;
}

function randomBanner() {
  return `https://picsum.photos/seed/${Math.floor(
    Math.random() * 10000000
  )}/1920/300`;
}

function randomURL() {
  return `https://example.com/${randomName()}`;
}

function randomField() {
  return Field.random();
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
    let value: string | Text | Field | Metadata | MetadataTree;
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
