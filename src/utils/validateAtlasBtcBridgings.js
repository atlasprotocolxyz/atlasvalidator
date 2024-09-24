const { getConstants } = require("../constants");

const { getChainConfig } = require("./network.chain.config");
const { flagsBatch } = require("./batchFlags");

const { Web3 } = require("web3");
const { Ethereum } = require("../services/ethereum");

// VALIDATOR BATCH FOR aBTC BRIDGINGS:
// 1. Retrieve all NEAR bridging records with status = RED_ABTC_BURNT and verified_count < chain_id.validators_threshold
// 2. For each NEAR bridging record, find BurnBridge event from respective origin_chain_id and prepare a mempool_bridging record to pass into NEAR function
// 3. Call NEAR function increment_bridging_verified_count by passing in the mempool_bridging record
// 4. TO DISCUSS: If validator_threshold gets updated suddenly, will this introduce any bugs?
// 5. TO DISCUSS: Cannot delete verifications records else we are not able to allocate the airdrop
// 6. TO DISCUSS: How to prevent authorised validators to directly call the public NEAR function increment_bridging_verified_count without going through this server.js function?
async function ValidateAtlasBtcBridgings(  
  bridgings,
  accountId,
  near,  
) {
  const batchName = `Validator Batch ValidateAtlasBtcBridgings`;

  //console.log(`Checking for incomplete ${batchName} run...`);
  if (flagsBatch.ValidateAtlasBtcBridgingsRunning) {
    //console.log(`Previous ${batchName} incomplete. Will skip this run.`);
    return;
  } else {
    try {
      console.log(`${batchName}. Start run ...`);
      flagsBatch.ValidateAtlasBtcBridgingsRunning = true;

      // Retrieve constants and validators_threshold
      const { BRIDGING_STATUS, NETWORK_TYPE, DELIMITER } = getConstants(); // Access constants dynamically
      //console.log(BRIDGING_STATUS);
      //console.log(NETWORK_TYPE);

      // Get all chain_ids which the validator is authorised to validate and network type = EVM      
      const allChainIdsToValidate = await near.getChainIdsByValidatorAndNetworkType(accountId, NETWORK_TYPE.EVM);
      //console.log(accountId);
      //console.log(NETWORK_TYPE.EVM);
      //console.log(allChainIdsToValidate);
      
      // Go through each authorised chain_id for this validator
      for (const chainId of allChainIdsToValidate) {
        
        const chainConfig = getChainConfig(chainId);
        //console.log(chainId);
        //console.log(chainConfig);
      
        let validatorThreshold = chainConfig.validators_threshold;     
        //console.log(`validatorThreshold for chain_id ${chainId}: ${validatorThreshold}`);
        //console.log(BRIDGING_STATUS.ABTC_BURNT);
        //console.log(bridgings);
        
        // Retrieve all NEAR bridging records with respective origin_chain_id, status = ABTC_BURNT and verified_count < chain_id.validators_threshold
        const allBridgingsToValidate = bridgings.filter(
          (bridging) =>
            bridging.origin_chain_id === chainId &&
            bridging.status === BRIDGING_STATUS.ABTC_BURNT &&
            bridging.remarks === "" &&
            bridging.verified_count < validatorThreshold,
        );
        console.log(`chainId: ${chainId} - allBridgingsToValidate.length: ${allBridgingsToValidate.length}`);
        
        // For each NEAR bridging record, find BurnRedeem events from respective chainId mempool and for each BurnBridge event: prepare a mempool_bridging record to pass into NEAR function
        for (const nearTxn of allBridgingsToValidate) {
          
          const web3 = new Web3(chainConfig.chainRpcUrl);
          const ethereum = new Ethereum(
            chainConfig.chainID,
            chainConfig.chainRpcUrl,
            chainConfig.gasLimit,
            chainConfig.aBTCAddress,
            chainConfig.abiPath,
          );

          //fetch all BurnRedeem Events (TO-DO: Read start block from file based on chainId)
          const endBlock = await ethereum.getCurrentBlockNumber();          
          const events = await ethereum.getPastBurnEventsInBatches(
            //endBlock - 1600000n,     // to test Arb Sepolia
            endBlock - 700000n,   // to test OP Sepolia
            endBlock,
            chainConfig.batchSize,
          );

          console.log(
            `${chainConfig.networkName}: Found ${events.length} Burn events`,
          );

          //initialise BridgingRecord for each Burn event in one EVM chain
          for (const event of events) {            
            
            const { returnValues, transactionHash, blockNumber } = event;
            const { wallet, btcAddress, amount } = returnValues;
            
            const block = await web3.eth.getBlock(blockNumber);
            let bridgingTxnHash = `${chainConfig.chainID}${DELIMITER.COMMA}${transactionHash}`;              
            let aBtcBridgingChainId = chainConfig.chainID;
            let timestamp = Number(block.timestamp);            
            let remarks = "";

            // Fetch the transaction receipt to check the status
            const receipt = await web3.eth.getTransactionReceipt(transactionHash);
            let evmStatus = 0;
            if (receipt.status) {
              evmStatus = REDEMPTION_STATUS.ABTC_BURNT;
            }

            // Create the BridgingRecord object
            const evmMempoolBridgingRecord = {
              txn_hash: bridgingTxnHash,
              abtc_redemption_address: wallet,
              abtc_redemption_chain_id: aBtcBridgingChainId,
              btc_receiving_address: btcAddress,
              abtc_amount: Number(amount),
              btc_txn_hash: "",           // this field not used in validation
              timestamp: timestamp,
              status: evmStatus,
              remarks: remarks,
              date_created: timestamp,    // this field not used in validation
              verified_count: 0           // this field not used in validation
            };
            //console.log(evmMempoolBridgingRecord);

            let blnValidated = await near.incrementBridgingVerifiedCount(evmMempoolBridgingRecord);
            if (blnValidated) {
              console.log(`Txn Hash ${bridgingTxnHash} Validated.`);
            }
          }             
        }        
      }
                
      console.log(`${batchName} completed successfully.`);
    } catch (error) {
      console.error(`Error ${batchName}:`, error);
    } finally {
      flagsBatch.ValidateAtlasBtcBridgingsRunning = false;
    }
  }
}

module.exports = { ValidateAtlasBtcBridgings };
