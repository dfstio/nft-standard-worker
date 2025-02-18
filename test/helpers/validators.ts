import { Field, Bool, PublicKey, Poseidon } from "o1js";
import {
  ValidatorsList,
  ValidatorsState,
  ValidatorsListData,
} from "@silvana-one/upgradable";
import {
  Storage,
  createIpfsURL,
  deserializeIndexedMerkleMap,
} from "@silvana-one/storage";

/**
/**
 * Checks the validators list against the provided storage.
 * @param params Object containing validators state and storage.
 * @returns An object containing the `ValidatorsList` and `ValidatorsListData`.
 */
export async function checkValidatorsList(params: {
  validators?: ValidatorsState;
  storage: Storage;
}): Promise<{ map: ValidatorsList; data: ValidatorsListData }> {
  const { validators, storage } = params;
  const data = (await (
    await fetch(createIpfsURL({ hash: storage.toString() }))
  ).json()) as unknown as ValidatorsListData;
  const validatorsList = new ValidatorsList();
  let hashSum = Field(0);
  let count = 0;
  for (let i = 0; i < data.validators.length; i++) {
    const publicKey = PublicKey.fromBase58(data.validators[i].publicKey);
    const key = Poseidon.hashPacked(PublicKey, publicKey);
    validatorsList.set(
      key,
      Field(Bool(data.validators[i].authorizedToVote).value)
    );
    count++;
    hashSum = hashSum.add(key);
  }

  const map = deserializeIndexedMerkleMap({
    serializedIndexedMap: data.map,
    type: ValidatorsList,
  });

  if (!map) {
    throw new Error("Invalid validators list");
  }
  if (map.root.equals(validatorsList.root).toBoolean() === false) {
    throw new Error("Invalid validators list root");
  }

  if (validators) {
    if (data.validatorsCount !== Number(validators.count.toBigint())) {
      throw new Error("Invalid validators list count");
    }
    if (data.root !== validators.root.toJSON()) {
      throw new Error("Invalid validators list root");
    }

    if (Number(validators.count.toBigint()) > count) {
      throw new Error("Invalid validators list count");
    }
  }

  return { map, data };
}
