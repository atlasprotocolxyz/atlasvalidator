const { Web3 } = require("web3");
const fs = require("fs");
const path = require("path");

const { getConstants } = require("../constants");

const {
  deriveChildPublicKey,
  najPublicKeyStrToUncompressedHexPoint,
  uncompressedHexPointToEvmAddress,
} = require("./kdf");

const { EVENT_NAME } = getConstants(); // Access constants dynamically

class Ethereum {
  constructor(chainID, rpcUrl, gasLimit, aBTCAddress, abiPath) {
    this.contractABI = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, abiPath), "utf-8"),
    );

    this.web3 = new Web3(rpcUrl);
    this.abtcContract = new this.web3.eth.Contract(
      this.contractABI,
      aBTCAddress,
    );
    this.chainID = Number(chainID);
    this.gasLimit = gasLimit;
    this.aBTCAddress = aBTCAddress;
  }

  async queryGasPrice() {
    const maxFeePerGas = await this.web3.eth.getGasPrice();
    const maxPriorityFeePerGas = await this.web3.eth.getMaxPriorityFeePerGas();
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async getBalance(accountId) {
    const balance = await this.web3.eth.getBalance(accountId);
    const ONE_ETH = 1000000000000000000n;
    return Number((balance * 100n) / ONE_ETH) / 100;
  }

  // Function to get block by number
  async getBlock(blockNumber) {
    return await this.web3.eth.getBlock(blockNumber);
  }

  // Function to get past events in batches
  // TO-DO: Create indexer so do not need to fetch all Burn Events for every run
  async getPastBurnEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches...`);

    let fromBlock = BigInt(startBlock);
    let toBlock;
    let allEvents = [];

    //console.log(`getPastEventsInBatches: Start block ${startBlock}`);
    //console.log(`getPastEventsInBatches: End block ${endBlock}`);
    while (fromBlock <= endBlock) {
      toBlock = fromBlock + BigInt(batchSize) - 1n;
      if (toBlock > endBlock) {
        toBlock = endBlock; // Ensure toBlock does not exceed endBlock
      }

      try {
        const events = await this.abtcContract.getPastEvents(
          EVENT_NAME.BURN_REDEEM,
          {
            fromBlock: fromBlock,
            toBlock: toBlock,
          },
        );

        allEvents = allEvents.concat(events);
        //console.log(`Fetched events from blocks ${fromBlock} to ${toBlock}`);
      } catch (error) {
        throw new Error(
          `Error getPastEventsInBatches: fetching events from blocks ${fromBlock} to ${toBlock}: ${error}`,
        );
      }

      fromBlock = toBlock + 1n;
    }
    //console.log(`allEvents.length: ${allEvents.length}`);
    return allEvents;
  }

  async getPastMintEventsInBatches(startBlock, endBlock, batchSize) {
    console.log(`Fetching Events in batches...`);

    let fromBlock = BigInt(startBlock);
    let toBlock;
    let allEvents = [];

    //console.log(`getPastEventsInBatches: Start block ${startBlock}`);
    //console.log(`getPastEventsInBatches: End block ${endBlock}`);
    while (fromBlock <= endBlock) {
      toBlock = fromBlock + BigInt(batchSize) - 1n;
      if (toBlock > endBlock) {
        toBlock = endBlock; // Ensure toBlock does not exceed endBlock
      }

      try {
        const events = await this.abtcContract.getPastEvents(
          EVENT_NAME.MINT_DEPOSIT,
          {
            fromBlock: fromBlock,
            toBlock: toBlock,
          },
        );

        allEvents = allEvents.concat(events);
        //console.log(`Fetched events from blocks ${fromBlock} to ${toBlock}`);
      } catch (error) {
        throw new Error(
          `Error getPastMintEventsInBatches: fetching events from blocks ${fromBlock} to ${toBlock}: ${error}`,
        );
      }

      fromBlock = toBlock + 1n;
    }
    //console.log(`allEvents.length: ${allEvents.length}`);
    return allEvents;
  }

  async deriveEthAddress(rootPublicKey, accountId, derivationPath) {
    //const rootPublicKey = 'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3';

    const publicKey = await deriveChildPublicKey(
      await najPublicKeyStrToUncompressedHexPoint(rootPublicKey),
      accountId,
      derivationPath,
    );

    return await uncompressedHexPointToEvmAddress(publicKey);
  }
}
module.exports = { Ethereum };
