# NFT Standard

## Running Tests for NFT Standard

### Local network

```sh
yarn local:all
```

The test will take approximately 2 hours to complete on Mac M2 Max

### Lightnet network

```sh
zk lightnet start
yarn lightnet:all
```

The test will take approximately 7 hours to complete on Mac M2 Max

### Devnet network

```sh
yarn devnet:all
```

The test will take approximately one day to complete on Mac M2 Max. In case of the devnet node instability, some tests can fail and can be rerun by
`yarn devnet:auction:rerun`, setting the `RERUN` environment variable to the number of the test to rerun (1-16)
`yarn devnet:contract:matrix`
`yarn devnet:zkprogram:matrix`

## Environment

```sh
cp .env.example .env
```

Set the environment variables in the .env file for Pinata IPFS, getting the values from the pinata.cloud

```
PINATA_IPFS_GATEWAY=https://.....mypinata.cloud/ipfs/
PINATA_GATEWAY_TOKEN=gFu...
PINATA_JWT=eyJhb...
IPFS_PIN_URL=https://api.pinata.cloud/pinning/pinFileToIPFS
```
