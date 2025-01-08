import { describe, it } from "node:test";
import assert from "node:assert";
import { UInt32, Bool, UInt64, PrivateKey, PublicKey, Field } from "o1js";
import { NFTData, CollectionData, AdminData } from "@minatokens/nft";
import { Storage } from "@minatokens/storage";
import { UpgradeDatabaseState, PublicKeyOption } from "@minatokens/upgradable";

const NUMBER_OF_ITERATIONS = 1000;
const randomBool = () => Math.random() < 0.5;

describe("Test packing and unpacking", async () => {
  it("should pack and unpack NFTData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const randomVersion = UInt32.from(Math.floor(Math.random() * 2 ** 32));
      const randomId = UInt64.from(Math.floor(Math.random() * 2 ** 64));
      const original = new NFTData({
        owner: PrivateKey.random().toPublicKey(),
        approved: PrivateKey.random().toPublicKey(),
        version: randomVersion,
        id: randomId,
        canChangeOwnerByProof: Bool(randomBool()),
        canTransfer: Bool(randomBool()),
        canApprove: Bool(randomBool()),
        canChangeMetadata: Bool(randomBool()),
        canChangeStorage: Bool(randomBool()),
        canChangeName: Bool(randomBool()),
        canChangeMetadataVerificationKeyHash: Bool(randomBool()),
        canPause: Bool(randomBool()),
        isPaused: Bool(randomBool()),
        requireOwnerAuthorizationToUpgrade: Bool(randomBool()),
      });

      const packed = original.pack();
      const unpacked = NFTData.unpack(packed);

      assert.strictEqual(
        unpacked.owner.equals(original.owner).toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.approved.equals(original.approved).toBoolean(),
        true
      );
      assert.strictEqual(
        unpacked.version.toBigint(),
        original.version.toBigint()
      );
      assert.strictEqual(unpacked.id.toBigInt(), original.id.toBigInt());
      assert.strictEqual(
        unpacked.canChangeOwnerByProof.toBoolean(),
        original.canChangeOwnerByProof.toBoolean()
      );
      assert.strictEqual(
        unpacked.canTransfer.toBoolean(),
        original.canTransfer.toBoolean()
      );
      assert.strictEqual(
        unpacked.canApprove.toBoolean(),
        original.canApprove.toBoolean()
      );
      assert.strictEqual(
        unpacked.canChangeMetadata.toBoolean(),
        original.canChangeMetadata.toBoolean()
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
        unpacked.requireOwnerAuthorizationToUpgrade.toBoolean(),
        original.requireOwnerAuthorizationToUpgrade.toBoolean()
      );
    }
  });
  it("should pack and unpack CollectionData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const publicKey = PrivateKey.random().toPublicKey();
      const original = new CollectionData({
        royaltyFee: UInt32.from(Math.floor(Math.random() * 2 ** 32)),
        transferFee: UInt64.from(Math.floor(Math.random() * 2 ** 64)),
        requireTransferApproval: Bool(randomBool()),
        mintingIsLimited: Bool(randomBool()),
        isPaused: Bool(randomBool()),
      });

      const packed = original.pack();
      const unpacked = CollectionData.unpack(packed);

      assert.strictEqual(
        unpacked.requireTransferApproval.toBoolean(),
        original.requireTransferApproval.toBoolean()
      );
      assert.strictEqual(
        unpacked.mintingIsLimited.toBoolean(),
        original.mintingIsLimited.toBoolean()
      );

      assert.strictEqual(
        unpacked.isPaused.toBoolean(),
        original.isPaused.toBoolean()
      );
      assert.strictEqual(
        unpacked.royaltyFee.toBigint() === original.royaltyFee.toBigint(),
        true
      );
      assert.strictEqual(
        unpacked.transferFee.toBigInt() === original.transferFee.toBigInt(),
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
  it("should pack and unpack AdminData", async () => {
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const original = new AdminData({
        canPause: Bool(randomBool()),
        isPaused: Bool(randomBool()),
        allowChangeRoyalty: Bool(randomBool()),
        allowChangeTransferFee: Bool(randomBool()),
        allowChangeBaseUri: Bool(randomBool()),
        allowChangeCreator: Bool(randomBool()),
        allowChangeAdmin: Bool(randomBool()),
        allowChangeName: Bool(randomBool()),
      });
      const packed = original.pack();
      const unpacked = AdminData.unpack(packed);
      assert.strictEqual(
        unpacked.canPause.toBoolean(),
        original.canPause.toBoolean()
      );
      assert.strictEqual(
        unpacked.isPaused.toBoolean(),
        original.isPaused.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeRoyalty.toBoolean(),
        original.allowChangeRoyalty.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeTransferFee.toBoolean(),
        original.allowChangeTransferFee.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeBaseUri.toBoolean(),
        original.allowChangeBaseUri.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeCreator.toBoolean(),
        original.allowChangeCreator.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeAdmin.toBoolean(),
        original.allowChangeAdmin.toBoolean()
      );
      assert.strictEqual(
        unpacked.allowChangeName.toBoolean(),
        original.allowChangeName.toBoolean()
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
