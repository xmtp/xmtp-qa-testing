# 🧪 XMTP Test Suites & Monitoring Documentation

This document provides a comprehensive overview of the XMTP testing infrastructure, organized by test suites and their associated workflows and monitoring dashboards.

## 🚀 TS_Performance Test Suite

The TS_Performance test suite comprehensively measures XMTP network performance across various operations, providing critical insights into system scalability and responsiveness.

### Implementation Details

This test suite evaluates:

- Client creation performance
- Inbox state retrieval speeds
- Direct message (DM) creation and communication latency
- Group creation with various sizes (configurable batch and total size)
- Group creation using different identifier methods
- Group synchronization efficiency
- Group name update latency
- Member removal performance
- Group messaging and verification throughput

Configuration parameters include:

```javascript
// Configuration parameters from TS_Performance
const batchSize = parseInt(
  process.env.CLI_BATCH_SIZE ?? process.env.BATCH_SIZE ?? "5",
);
const total = parseInt(
  process.env.CLI_GROUP_SIZE ?? process.env.MAX_GROUP_SIZE ?? "10",
);
```

Example test implementation:

```javascript
// Example from TS_Performance implementation
it(`createGroup-${i}: should create a large group of ${i} participants ${i}`, async () => {
  try {
    const sliced = generatedInboxes.slice(0, i);
    newGroup = await workers
      .get("henry")!
      .client.conversations.newGroup(sliced.map((inbox) => inbox.inboxId));
    expect(newGroup.id).toBeDefined();
  } catch (e) {
    hasFailures = logError(e, expect);
    throw e;
  }
});
```

### Associated Workflow

The [`TS_Performance.yml`](/.github/workflows/TS_Performance.yml) workflow automates this test suite:

- ⏱️ **Schedule**: Runs every 30 minutes via cron schedule
- ⚙️ **Configuration**: Supports adjustable batch size and group size parameters
- 🔄 **Retry Mechanism**: Implements retry logic for test stability
- 📊 **Metrics**: Reports comprehensive performance metrics to Datadog
- 👁️ **Visibility**: Provides real-time visibility into XMTP network performance

The [`TS_Geolocation.yml`](/.github/workflows/TS_Geolocation.yml) workflow replicates this test suite for the production network.

- **Regions**: `us-east, us-west, asia, europe`
- **Railway:** Visit our Railway project with all our services - [see section](https://railway.com/project/cc97c743-1be5-4ca3-a41d-0109e41ca1fd)

### Monitoring Dashboard

> Performance metrics feed into the [SDK Performance Dashboard](https://app.datadoghq.com/dashboard/9z2-in4-3we/), which visualizes:

![TS_Performance](/media/ts_performance.png)

- Operation durations across different functions
- Network performance metrics
- Scalability indicators for various group sizes

#### Performance Metrics Collection

The test suite reports detailed performance metrics via the `xmtp.sdk.duration` metric:

```tsx
// Send main operation metric
const durationMetricName = `xmtp.sdk.duration`;

metrics.gauge(durationMetricName, value, [
  `libxmtp:${firstWorker.version}`,
  `operation:${operationName}`,
  `test:${testName}`,
  `metric_type:operation`,
  `description:${metricDescription}`,
  `members:${members}`,
]);
```

#### Network Performance Metrics

For each operation, the test suite tracks network performance across five key phases:

| Phase            | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `dns_lookup`     | DNS resolution time                                         |
| `tcp_connection` | TCP connection establishment time                           |
| `tls_handshake`  | TLS handshake duration                                      |
| `processing`     | Processing time (calculated as server_call - tls_handshake) |
| `server_call`    | Server response time                                        |

```tsx
const networkStats = await getNetworkStats();

for (const [statName, statValue] of Object.entries(networkStats)) {
  const metricValue = statValue * 1000; // Convert to milliseconds
  metrics.gauge(durationMetricName, metricValue, [
    `libxmtp:${firstWorker.version}`,
    `operation:${operationName}`,
    `test:${testName}`,
    `metric_type:network`,
    `network_phase:${statName.toLowerCase().replace(/\s+/g, "_")}`,
  ]);
}
```

## 📬 TS_Delivery Test Suite

The TS_Delivery test suite rigorously evaluates message delivery reliability across multiple streams, ensuring messages are delivered correctly and in order under varying conditions.

### Implementation Details

This test suite focuses on:

- Message delivery in streaming mode
- Message order verification
- Message delivery via polling
- Offline recovery (message recovery after disconnection)

Configurable parameters include:

```javascript
// Configuration parameters from TS_Delivery
const amountofMessages = parseInt(
  process.env.CLI_DELIVERY_AMOUNT ?? process.env.DELIVERY_AMOUNT ?? "10",
);
const receiverAmount = parseInt(
  process.env.CLI_DELIVERY_RECEIVERS ?? process.env.DELIVERY_RECEIVERS ?? "4",
);
```

Key test implementation:

```javascript
// Example from TS_Delivery implementation
it("tc_stream_order: verify message order when receiving via streams", () => {
  try {
    // Verify message reception and order
    const stats = calculateMessageStats(
      messagesByWorker,
      "gm-",
      amountofMessages,
      randomSuffix,
    );

    // We expect all messages to be received and in order
    expect(stats.receptionPercentage).toBeGreaterThan(95);
    expect(stats.orderPercentage).toBeGreaterThan(95);

    // Report metrics to Datadog
    sendDeliveryMetric(
      stats.receptionPercentage,
      workers.get("bob")!.version,
      testName,
      "stream",
      "delivery",
    );
  } catch (e) {
    hasFailures = logError(e, expect);
    throw e;
  }
});
```

### Associated Workflow

The [`TS_Delivery.yml`](/.github/workflows/TS_Delivery.yml) workflow automates this test suite execution:

- ⏱️ **Schedule**: Runs every 30 minutes via cron schedule
- 🔧 **Configuration**: Optimizes system resources for SQLCipher performance
- 🔍 **Error Handling**: Uses sophisticated filtering for transient issues
- 🔄 **Retry Logic**: Implements up to 3 retry attempts for stability
- 📊 **Metrics**: Sends detailed metrics to Datadog for tracking
- ⚙️ **Configuration**: Supports adjustable message volume via environment variables

### Monitoring Dashboard

#### Message Delivery Metrics

The test suite reports delivery reliability via the `xmtp.sdk.delivery` metric:

```tsx
// Send delivery rate metric
metrics.gauge("xmtp.sdk.delivery", deliveryRate, [
  `libxmtp:${firstWorker.version}`,
  `test:${testName}`,
  `metric_type:reliability`,
  `members:${members}`,
]);
```

## 👋 TS_Gm Test Suite

The TS_Gm test suite serves as a critical regression testing tool by verifying the GM bot functionality across different SDK versions. By using a simple bot as a consistent reference point, it ensures that new SDK versions maintain backward compatibility and reliable messaging capabilities.

![TS_Gm](/media/ts_gm.png)

### Implementation Details

This test suite uses a hybrid approach that combines direct SDK integration with Playwright-based browser automation:

- **SDK Integration Tests**: Direct SDK-to-bot communication testing
- **Playwright Automation**: Browser-based interaction testing that simulates real user experience

The test suite evaluates:

- Direct messaging with the GM bot using different SDK versions
- Group messaging functionality with the bot and random participants
- Cross-version compatibility through the bot's consistent interface
- Real-world browser interactions via Playwright automation

Key implementation highlights:

The Playwright helper function facilitates browser-based testing:

```javascript
await page.goto(`https://xmtp.chat/`);
await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
await page
  .getByRole("main")
  .getByRole("button", { name: "New conversation" })
  .click();
console.log("Clicking address textbox");
await page.getByRole("textbox", { name: "Address" }).click();
for (const address of addresses) {
  console.log(`Filling address: ${address}`);
  await page.getByRole("textbox", { name: "Address" }).fill(address);
  console.log("Clicking Add button");
  await page.getByRole("button", { name: "Add" }).click();
}
console.log("Clicking Create button");
await page.getByRole("button", { name: "Create" }).click();
console.log("Clicking message textbox");
await page.getByRole("textbox", { name: "Type a message..." }).click();
console.log("Filling message with 'hi'");
await page.getByRole("textbox", { name: "Type a message..." }).fill("hi");
console.log("Clicking Send button");
await page.getByRole("button", { name: "Send" }).click();

const hiMessage = await page.getByText("hi");
const hiMessageText = await hiMessage.textContent();
console.log("hiMessageText", hiMessageText);
const botMessage = await page.getByText("gm");
const botMessageText = await botMessage.textContent();
console.log("botMessageText", botMessageText);
```

### Associated Workflow

The [`TS_Gm.yml`](/.github/workflows/TS_Gm.yml) workflow automates the test suite execution:

- ⏱️ **Schedule**: Runs every 30 minutes via cron schedule
- 🔄 **Retry Mechanism**: Uses up to 3 attempts for test stability
- 📊 **Reporting**: Reports test results to Datadog for monitoring
- 🧪 **Multi-environment**: Tests against both Dev and Production environments
- 🔍 **Regression Testing**: Compares behavior across different SDK versions
- 🌐 **Browser Testing**: Includes Playwright-based browser automation tests

## 📦 Package compatibility

The package compatibility workflow validates that our codebase works correctly across different Node.js versions and package managers, ensuring broad compatibility across developer environments.

### Implementation details

This workflow tests:

- Multiple Node.js versions (20, 21, 22, 23)
- Various package managers (npm, yarn, yarn1, pnpm, bun)
- Successful installation of dependencies
- Build process completion
- Basic client connectivity check

### Associated workflow

The [`test-package-compatibility.yml`](/.github/workflows/test-package-compatibility.yml) workflow:

- 🚀 **Trigger**: Runs on every commit to main branch or manual dispatch
- 📊 **Matrix testing**: Tests combinations of Node.js versions and package managers
- 🔄 **Environment setup**: Configures appropriate package manager in each job
- 🔍 **Failure isolation**: Uses fail-fast: false to identify specific failing combinations
- 👁️ **Verification**: Performs a client connection check to validate functionality

## 🤖 Agent examples

The agent examples workflow tests the xmtp-agent-examples repository functionality, ensuring that code examples are valid and operational.

### Implementation details

This workflow:

- Clones the ephemeraHQ/xmtp-agent-examples repository
- Sets up the required environment with secrets
- Tests the agent's ability to initialize and connect to XMTP
- Validates that the agent reaches the "waiting for messages" state

### Associated workflow

The [`agent-examples.yml`](/.github/workflows/agent-examples.yml) workflow:

- ⏱️ **Schedule**: Runs hourly via cron schedule
- 🧪 **Test environment**: Configures the environment with appropriate secrets
- 🔄 **Timeout control**: Uses a 20-second timeout to avoid long-running jobs
- 🔍 **Success verification**: Checks for the "Waiting for messages..." message
- 👁️ **Error detection**: Reports and fails if agent doesn't initialize correctly
