#!/usr/bin/env zsh

# auction.zsh
# Runs the auction.test.ts for all combinations of ADVANCED and WITHDRAW

# Start timer for all tests
ALL_START=$(date +%s)

for ADVANCED in true false
do
  for WITHDRAW in true false
  do
    for APPROVE_TRANSFER in true false
    do
      for SHARES in true false
      do
        echo "==> Running tests with ADVANCED=$ADVANCED, WITHDRAW=$WITHDRAW, APPROVE_TRANSFER=$APPROVE_TRANSFER, SHARES=$SHARES"
        
        # Start timer for this test combination
        TEST_START=$(date +%s)
        
        CLOUD=local \
        NO_LOG=true \
        NODE_NO_WARNINGS=1 \
        ADVANCED="$ADVANCED" \
        WITHDRAW="$WITHDRAW" \
        APPROVE_TRANSFER="$APPROVE_TRANSFER" \
        SHARES="$SHARES" \
          node --loader=ts-node/esm \
            --enable-source-maps \
            -r dotenv/config \
            --require dotenv/config \
            --env-file=.env \
            --test test/auction.test.ts

        # Calculate and display time for this test combination
        TEST_END=$(date +%s)
        TEST_DURATION=$((TEST_END - TEST_START))
        echo "Test time: ${TEST_DURATION}s"
        echo

      done
    done
  done
done

# Calculate and display total time for all tests
ALL_END=$(date +%s)
ALL_DURATION=$((ALL_END - ALL_START))
echo "Total time for all tests: ${ALL_DURATION} seconds"