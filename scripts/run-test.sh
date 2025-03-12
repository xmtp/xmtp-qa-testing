#!/bin/bash

# Script to run tests with retry logic
MAX_ATTEMPTS=3
RETRY_DELAY=10

# Get test name from command line argument or use default
TEST_NAME=${1:-"TS_Delivery"}

echo "Starting $TEST_NAME tests with up to $MAX_ATTEMPTS attempts"

for i in $(seq 1 $MAX_ATTEMPTS); do
  echo "Attempt $i of $MAX_ATTEMPTS..."
  
  # Set environment variable for Rust backtrace
  export RUST_BACKTRACE=1
  
  # Run the test with the provided test name
  yarn test $TEST_NAME
  exit_code=$?
  
  if [ $exit_code -eq 0 ]; then
    echo "Tests passed successfully!"
    exit 0
  fi
  
  if [ $i -eq $MAX_ATTEMPTS ]; then
    echo "Test failed after $MAX_ATTEMPTS attempts."
    exit 1
  fi
  
  echo "Test failed with exit code $exit_code. Retrying in $RETRY_DELAY seconds..."
  sleep $RETRY_DELAY
  echo "Clearing memory and cache before next attempt..."
done 