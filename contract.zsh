#!/usr/bin/env zsh

# contract.zsh
# Runs the contract.test.ts for all combinations of ADVANCED and APPROVE_TRANSFER

# Start timer for all tests
ALL_START=$(date +%s)
TEST_NUM=0

for ADVANCED in true false
  do
    for APPROVE_TRANSFER in true false
      do
        # Calculate test number (1-4)
        TEST_NUM=$((TEST_NUM + 1))
        echo "==> Running test $TEST_NUM with ADVANCED=$ADVANCED,  APPROVE_TRANSFER=$APPROVE_TRANSFER"
        
        # Start timer for this test combination
        TEST_START=$(date +%s)
        
        CLOUD=local \
        NO_LOG=true \
        NODE_NO_WARNINGS=1 \
        ADVANCED="$ADVANCED" \
        APPROVE_TRANSFER="$APPROVE_TRANSFER" \
          node --loader=ts-node/esm \
            --enable-source-maps \
            -r dotenv/config \
            --require dotenv/config \
            --env-file=.env \
            --test test/contract.test.ts

        # Calculate and display time for this test combination
        TEST_END=$(date +%s)
        TEST_DURATION=$((TEST_END - TEST_START))
        echo "Test time: ${TEST_DURATION}s"
        echo

  done
done

# Calculate and display total time for all tests
ALL_END=$(date +%s)
ALL_DURATION=$((ALL_END - ALL_START))
echo "Total time for all tests: ${ALL_DURATION} seconds"