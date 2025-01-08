#!/usr/bin/env zsh

# zkprogram.zsh
# Runs the zkprogram.test.ts for all combinations of READ_ONLY

# Start timer for all tests
ALL_START=$(date +%s)
TEST_NUM=0

for READ_ONLY in true false
  do
        # Calculate test number (1-4)
        TEST_NUM=$((TEST_NUM + 1))
        echo "==> Running test $TEST_NUM with READ_ONLY=$READ_ONLY"
        
        # Start timer for this test combination
        TEST_START=$(date +%s)
        
        CLOUD=local \
        NO_LOG=true \
        NODE_NO_WARNINGS=1 \
        READ_ONLY="$READ_ONLY" \
          node --loader=ts-node/esm \
            --enable-source-maps \
            -r dotenv/config \
            --require dotenv/config \
            --env-file=.env \
            --test test/zkprogram.test.ts

        # Calculate and display time for this test combination
        TEST_END=$(date +%s)
        TEST_DURATION=$((TEST_END - TEST_START))
        echo "Test time: ${TEST_DURATION}s"
        echo
done

# Calculate and display total time for all tests
ALL_END=$(date +%s)
ALL_DURATION=$((ALL_END - ALL_START))
echo "Total time for all tests: ${ALL_DURATION} seconds"