import { describe, it } from "node:test";
import assert from "node:assert";
import { UInt32, Bool, UInt64, PrivateKey, PublicKey, Field } from "o1js";
import { NFTData, CollectionData, PauseData } from "@minatokens/nft";
import { Storage } from "@minatokens/storage";
import {
  UpgradeDatabaseState,
  UpgradeDatabaseStatePacked,
  PublicKeyOption,
} from "@minatokens/upgradable";

const NUMBER_OF_ITERATIONS = 1000;
const randomBool = () => Math.random() < 0.5;

describe("Test packing and unpacking", async () => {
  it("should pack and unpack NFTData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const randomPrice = UInt64.from(Math.floor(Math.random() * 2 ** 64));
      const randomVersion = UInt32.from(Math.floor(Math.random() * 2 ** 32));
      const randomId = UInt32.from(Math.floor(Math.random() * 2 ** 32));
      const original = new NFTData({
        price: randomPrice,
        version: randomVersion,
        id: randomId,
        canChangeOwnerByProof: Bool(randomBool()),
        canChangeOwnerBySignature: Bool(randomBool()),
        canChangeMetadata: Bool(randomBool()),
        canChangePrice: Bool(randomBool()),
        canChangeStorage: Bool(randomBool()),
        canChangeName: Bool(randomBool()),
        canChangeMetadataVerificationKeyHash: Bool(randomBool()),
        canPause: Bool(randomBool()),
        isPaused: Bool(randomBool()),
        requireOwnerSignatureToUpgrade: Bool(randomBool()),
      });

      const packed = original.pack();
      const unpacked = NFTData.unpack(packed);

      assert.strictEqual(unpacked.price.toBigInt(), original.price.toBigInt());
      assert.strictEqual(
        unpacked.version.toBigint(),
        original.version.toBigint()
      );
      assert.strictEqual(unpacked.id.toBigint(), original.id.toBigint());
      assert.strictEqual(
        unpacked.canChangeOwnerByProof.toBoolean(),
        original.canChangeOwnerByProof.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeOwnerBySignature.toBoolean(),
        original.canChangeOwnerBySignature.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeMetadata.toBoolean(),
        original.canChangeMetadata.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangePrice.toBoolean(),
        original.canChangePrice.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeStorage.toBoolean(),
        original.canChangeStorage.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeName.toBoolean(),
        original.canChangeName.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeMetadataVerificationKeyHash.toBoolean(),
        original.canChangeMetadataVerificationKeyHash.toBoolean()
      );
      assert.strictEqual(
        unpacked.canPause.toBoolean(),
        original.canPause.toBoolean()
      );
      assert.strictEqual(
        unpacked.isPaused.toBoolean(),
        original.isPaused.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireOwnerSignatureToUpgrade.toBoolean(),
        original.requireOwnerSignatureToUpgrade.toBoolean()
      );
    }
  });
  it("should pack and unpack CollectionData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const publicKey = PrivateKey.random().toPublicKey();
      const original = new CollectionData({
        royaltyFee: UInt32.from(Math.floor(Math.random() * 2 ** 32)),
        transferFee: UInt64.from(Math.floor(Math.random() * 2 ** 64)),
        upgradeAuthority: publicKey,
        requireTransferApproval: Bool(randomBool()),
        requireUpdateApproval: Bool(randomBool()),
        requireOfferApproval: Bool(randomBool()),
        requireSaleApproval: Bool(randomBool()),
        requireBuyApproval: Bool(randomBool()),
        requireCreatorSignatureToUpgradeCollection: Bool(randomBool()),
        requireCreatorSignatureToUpgradeNFT: Bool(randomBool()),
        canMint: Bool(randomBool()),
        canChangeName: Bool(randomBool()),
        canChangeCreator: Bool(randomBool()),
        canChangeBaseUri: Bool(randomBool()),
        canChangeRoyalty: Bool(randomBool()),
        canChangeTransferFee: Bool(randomBool()),
        canPause: Bool(randomBool()),
        isPaused: Bool(randomBool()),
        canSetAdmin: Bool(randomBool()),
      });

      const packed = original.pack();
      const unpacked = CollectionData.unpack(packed);

      assert.strictEqual(
        unpacked.requireTransferApproval.toBoolean(),
        original.requireTransferApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireUpdateApproval.toBoolean(),
        original.requireUpdateApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireOfferApproval.toBoolean(),
        original.requireOfferApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireSaleApproval.toBoolean(),
        original.requireSaleApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireBuyApproval.toBoolean(),
        original.requireBuyApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireCreatorSignatureToUpgradeCollection.toBoolean(),
        original.requireCreatorSignatureToUpgradeCollection.toBoolean()
      );
      assert.strictEqual(
        unpacked.requireCreatorSignatureToUpgradeNFT.toBoolean(),
        original.requireCreatorSignatureToUpgradeNFT.toBoolean()
      );
      assert.strictEqual(
        unpacked.canMint.toBoolean(),
        original.canMint.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeName.toBoolean(),
        original.canChangeName.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeCreator.toBoolean(),
        original.canChangeCreator.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeBaseUri.toBoolean(),
        original.canChangeBaseUri.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeRoyalty.toBoolean(),
        original.canChangeRoyalty.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeTransferFee.toBoolean(),
        original.canChangeTransferFee.toBoolean()
      );
      assert.strictEqual(
        unpacked.canPause.toBoolean(),
        original.canPause.toBoolean()
      );
      assert.strictEqual(
        unpacked.isPaused.toBoolean(),
        original.isPaused.toBoolean()
      );
      assert.strictEqual(
        unpacked.upgradeAuthority.equals(original.upgradeAuthority).toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.royaltyFee.toBigint() === original.royaltyFee.toBigint(),
        true
      );
      assert.strictEqual(
        unpacked.transferFee.toBigInt() === original.transferFee.toBigInt(),
        true
      );
      assert.strictEqual(
        unpacked.canSetAdmin.toBoolean() === original.canSetAdmin.toBoolean(),
        true
      );
    }
  });
  it("should pack and unpack PublicKey", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const publicKey = PrivateKey.random().toPublicKey();
      const x = publicKey.x;
      const isOdd = publicKey.isOdd;
      const restored = PublicKey.from({ x, isOdd });
      assert.strictEqual(restored.equals(publicKey).toBoolean(), true);
    }
  });
  it("should pack and unpack PauseData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const original = new PauseData({
        canPause: Bool(randomBool()),
        isPaused: Bool(randomBool()),
      });
      const packed = original.pack();
      const unpacked = PauseData.unpack(packed);
      assert.strictEqual(
        unpacked.canPause.toBoolean(),
        original.canPause.toBoolean()
      );
      assert.strictEqual(
        unpacked.isPaused.toBoolean(),
        original.isPaused.toBoolean()
      );
    }
  });
  it("should pack and unpack UpgradeDatabaseState", async () => {
    const original = UpgradeDatabaseState.empty();
    const packed = original.pack();
    const unpacked = UpgradeDatabaseState.unpack(packed);
    assert.strictEqual(unpacked.root.equals(original.root).toBoolean(), true);
    assert.strictEqual(
      Storage.equals(unpacked.storage, original.storage).toBoolean(),
      true
    );
    assert.strictEqual(
      unpacked.nextUpgradeAuthority.value
        .equals(original.nextUpgradeAuthority.value)
        .toBoolean(),
      true
    );
    assert.strictEqual(
      unpacked.nextUpgradeAuthority.isSome.toBoolean() ===
        original.nextUpgradeAuthority.isSome.toBoolean(),
      true
    );
    assert.strictEqual(
      unpacked.version.toBigint(),
      original.version.toBigint()
    );
    assert.strictEqual(
      unpacked.validFrom.toBigint(),
      original.validFrom.toBigint()
    );
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const randomVersion = UInt32.from(Math.floor(Math.random() * 2 ** 32));
      const randomValidFrom = UInt32.from(Math.floor(Math.random() * 2 ** 32));
      const randomStorage = new Storage({
        url: [Field.random(), Field.random()],
      });
      const original = new UpgradeDatabaseState({
        root: Field.random(),
        storage: randomStorage,
        nextUpgradeAuthority:
          Math.random() < 0.5
            ? PublicKeyOption.from(PrivateKey.random().toPublicKey())
            : PublicKeyOption.none(),
        validFrom: randomValidFrom,
        version: randomVersion,
      });
      const packed = original.pack();
      const unpacked = UpgradeDatabaseState.unpack(packed);
      assert.strictEqual(unpacked.root.equals(original.root).toBoolean(), true);
      assert.strictEqual(
        Storage.equals(unpacked.storage, original.storage).toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.nextUpgradeAuthority.value
          .equals(original.nextUpgradeAuthority.value)
          .toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.nextUpgradeAuthority.isSome.toBoolean() ===
          original.nextUpgradeAuthority.isSome.toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.validFrom.toBigint(),
        original.validFrom.toBigint()
      );
    }
  });
});
