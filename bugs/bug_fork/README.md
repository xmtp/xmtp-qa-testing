# Fork test

This test simulates a scenario where multiple XMTP clients (workers) interact with the same group conversation to test message consistency and group membership changes across different client versions.

## Test steps

### 1. Initialize first worker and create group

- Set up test environment for the "dev" network
- Create first worker (bob-a-100) with version 100
- Sync conversations for the first worker
- Create a new group with two predefined users (convos and xmtpchat)
- Store the group ID for later use

### 2. Initialize random workers with different versions

- Create additional workers (alice-b-100 and ivy-c-100) with version 100
- Sync conversations for each worker
- Have each worker send a test message to the group
- Wait for messages to be processed

### 3. Verify message consistency across all workers

- Sync all workers to ensure they have the latest messages
- Get messages from the first worker (bob) to use as reference
- Check each worker's messages against the reference
- Verify that all workers have the same number of messages
- Wait for any pending operations

### 4. Test removing and adding members to the group

- Sync all workers to ensure they have the latest state
- Get the group from the first worker
- Get current members of the group
- Add a new member (the first worker's inbox ID) to the group
- Wait for the addition to propagate
- Have all workers send messages after adding a member
- Wait for messages to be processed
- Verify message consistency after membership changes
- Get updated members of the group
- Check each worker's messages against the reference
- Wait for any pending operations

## Expected behavior

- All workers should have the same messages after syncing
- All workers should see the same members after membership changes
- All workers should be able to send and receive messages in the group
