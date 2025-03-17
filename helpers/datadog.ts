import { exec } from "child_process";
import { promisify } from "util";
import type { WorkerManager } from "@workers/manager";
import metrics from "datadog-metrics";

let isInitialized = false;
let currentGeo = "";

// Add this mapping function
function getCountryCodeFromGeo(geolocation: string): string {
  // Map your geo regions to ISO country codes
  const geoToCountryCode: Record<string, string> = {
    "us-east": "US",
    "us-west": "US",
    europe: "FR", // Using France as a representative for Europe
    asia: "JP", // Using Japan as a representative for Asia
    "south-america": "BR", // Using Brazil as a representative for South America
  };

  return geoToCountryCode[geolocation] || "US"; // Default to US if not found
}
export const exportTestResults = (
  expect: any,
  workers: WorkerManager,
  start: number,
) => {
  const testName = expect.getState().currentTestName;
  if (testName) {
    console.timeEnd(testName as string);
    expect(workers.getWorkers()).toBeDefined();
    expect(workers.getWorkers().length).toBeGreaterThan(0);
    void sendPerformanceMetric(
      performance.now() - start,
      testName as string,
      workers.getVersion(),
    );
  }
};
// Add success status tag to duration metrics

// Expanded threshold function to handle different operation types and regions
export function getThresholdForOperation(
  operation: string,
  operationType: string = "core",
  members: string = "",
  region: string = "us-east",
): number {
  // 1. Core SDK Operations thresholds
  const coreOperationThresholds: Record<string, number> = {
    createdm: 500,
    sendgm: 200,
    receivegm: 200,
    receivegroupmessage: 200,
    updategroupname: 200,
    syncgroup: 200,
    addmembers: 500,
    removemembers: 300,
    inboxstate: 100,
  };

  // 2. Group Operations thresholds by size
  const groupSizeThresholds: Record<string, Record<string, number>> = {
    create: {
      "50": 2000,
      "100": 2000,
      "150": 4000,
      "200": 5000,
      "250": 7000,
      "300": 9000,
      "350": 11000,
      "400": 15000,
    },
    send: {
      "50": 100, // Using conservative values based on README
      "100": 100,
      "150": 100,
      "200": 150,
      "250": 200,
      "300": 300,
      "350": 350,
      "400": 500,
    },
    sync: {
      "50": 100,
      "100": 100,
      "150": 100,
      "200": 150,
      "250": 200,
      "300": 350,
      "350": 350,
      "400": 500,
    },
    update: {
      "50": 100,
      "100": 100,
      "150": 150,
      "200": 200,
      "250": 200,
      "300": 300,
      "350": 350,
      "400": 500,
    },
    remove: {
      "50": 150,
      "100": 200,
      "150": 200,
      "200": 250,
      "250": 300,
      "300": 350,
      "350": 400,
      "400": 550,
    },
  };

  // 3. Regional performance adjustments (multipliers based on baseline us-east)
  const regionMultipliers: Record<string, number> = {
    "us-east": 1.0, // Baseline
    "us-west": 1.0, // Similar to us-east
    europe: 1.0, // Similar to us-east
    asia: 1.5, // 50% slower expected
    "south-america": 2.6, // 160% slower expected
  };

  // 4. Network performance thresholds
  const networkThresholds: Record<string, number> = {
    server_call: 100,
    tls_handshake: 100,
    processing: 300, // end-to-end
  };

  // Determine which threshold to use
  if (operationType === "network") {
    return networkThresholds[operation.toLowerCase()] || 200;
  } else if (operationType === "group") {
    // Extract group operation type and size
    const groupOp = operation.toLowerCase().replace(/group/, "");
    const size = members || "50"; // Default to smallest group size if not specified

    if (groupSizeThresholds[groupOp] && groupSizeThresholds[groupOp][size]) {
      const baseThreshold = groupSizeThresholds[groupOp][size];
      // Apply regional adjustment for group operations
      return Math.round(baseThreshold * (regionMultipliers[region] || 1.0));
    }
    return 2000; // Default fallback for group operations
  } else {
    // Handle core operations with regional adjustments
    const baseThreshold =
      coreOperationThresholds[operation.toLowerCase()] || 300;
    return Math.round(baseThreshold * (regionMultipliers[region] || 1.0));
  }
}

export function initDataDog(
  testName: string,
  envValue: string,
  geolocation: string,
  apiKey: string,
): boolean {
  if (isInitialized) {
    return true;
  }
  if (!testName.includes("ts_")) {
    return true;
  }
  if (!apiKey) {
    console.warn("⚠️ DATADOG_API_KEY not found. Metrics will not be sent.");
    return false;
  }

  try {
    const countryCode = getCountryCodeFromGeo(geolocation);
    currentGeo = geolocation;
    const initConfig = {
      apiKey: apiKey,
      defaultTags: [
        `env:${envValue}`,
        `test:${testName}`,
        `geo:${geolocation}`,
        `geo.country_iso_code:${countryCode}`,
      ],
    };
    metrics.init(initConfig);
    isInitialized = true;
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize DataDog metrics:", error);
    return false;
  }
}

// Enhanced function to send message delivery metrics with success tags
export function sendDeliveryMetric(
  metricValue: number,
  testName: string,
  libxmtpVersion: string,
  metricType: string = "stream",
  metricName: string = "delivery",
  deliveryStatus: string = "success", // "success", "order_error", or "failed"
  isOrderCorrect: boolean = true,
): void {
  if (!isInitialized) {
    return;
  }

  try {
    const members = testName.split("-")[1] || "";

    // Determine thresholds - for message delivery we want 100% success (or 99.9% minimum)
    let isSuccess = false;
    if (metricName === "delivery" || metricName === "recovery") {
      isSuccess = deliveryStatus === "success";
    } else if (metricName === "order") {
      isSuccess = isOrderCorrect;
    }

    // Set target thresholds based on README
    const threshold = metricName === "order" ? 100 : 99.9;

    metrics.gauge(`xmtp.sdk.${metricName}`, Math.round(metricValue), [
      `libxmtp:${libxmtpVersion}`,
      `test:${testName}`,
      `metric_type:${metricType}`, // "stream", "poll", or "recovery"
      `members:${members}`,
      `success:${isSuccess}`,
      `delivery_status:${deliveryStatus}`,
      `order_correct:${isOrderCorrect}`,
      `threshold:${threshold}`,
      `metric_category:reliability`,
    ]);

    // For binary metrics (success/fail), also send a 1/0 value
    const binaryValue = isSuccess ? 100 : 0;
    metrics.gauge(`xmtp.sdk.${metricName}.status`, binaryValue, [
      `libxmtp:${libxmtpVersion}`,
      `test:${testName}`,
      `metric_type:${metricType}`,
      `members:${members}`,
      `delivery_status:${deliveryStatus}`,
      `order_correct:${isOrderCorrect}`,
      `metric_category:reliability`,
    ]);
  } catch (error) {
    console.error("❌ Error sending message delivery metrics:", error);
  }
}

export function sendTestResults(hasFailures: boolean, testName: string): void {
  if (!isInitialized) {
    console.error("WARNING: Datadog metrics not initialized");
    return;
  }
  const status = hasFailures ? "failed" : "successful";

  console.log(`The tests indicated that the test ${testName} was ${status}`);

  try {
    // Send metric to Datadog using metrics.gauge
    const metricValue = hasFailures ? 0 : 1;
    const metricName = `xmtp.sdk.workflow.status`;
    // console.debug({
    //   metricName,
    //   metricValue,
    //   status,
    //   workflow: testName,
    // });
    metrics.gauge(metricName, Math.round(metricValue), [
      `status:${status}`,
      `workflow:${testName}`,
    ]);

    console.log(`Successfully reported ${status} to Datadog`);
  } catch (error) {
    console.error("Error reporting to Datadog:", error);
  }
}

export async function sendPerformanceMetric(
  metricValue: number,
  testName: string,
  libxmtpVersion: string,
  skipNetworkStats: boolean = false,
): Promise<void> {
  if (!isInitialized) {
    return;
  }

  try {
    const metricNameParts = testName.split(":")[0];
    const metricName = metricNameParts.replaceAll(" > ", ".");
    const metricDescription = testName.split(":")[1];
    // Extract operation name for tagging
    const operationParts = metricName.split(".");
    const testNameExtracted = operationParts[0];
    const operationName = operationParts[1].split("-")[0];
    const members = operationParts[1].split("-")[1] || "";
    const durationMetricName = `xmtp.sdk.duration`;

    // Determine operation type (core, group, network)
    let operationType = "core";
    if (operationName.toLowerCase().includes("group")) {
      operationType = "group";
    }

    // Get threshold based on operation type, name, members count, and region
    const threshold = getThresholdForOperation(
      operationName,
      operationType,
      members,
      currentGeo,
    );

    const isSuccess = metricValue <= threshold;

    console.debug({
      durationMetricName,
      metricValue,
      libxmtpVersion,
      operationName,
      operationType,
      testNameExtracted,
      metricDescription,
      members,
      isSuccess,
      threshold,
      currentGeo,
    });

    // Send main operation metric
    metrics.gauge(durationMetricName, Math.round(metricValue), [
      `libxmtp:${libxmtpVersion}`,
      `operation:${operationName}`,
      `test:${testNameExtracted}`,
      `metric_type:${operationType}`,
      `description:${metricDescription}`,
      `members:${members}`,
      `success:${isSuccess}`,
      `threshold:${threshold}`,
      `region:${currentGeo}`,
    ]);

    // Handle network stats if needed
    if (!skipNetworkStats) {
      const networkStats = await getNetworkStats();
      const geo = currentGeo || "";
      const countryCode = getCountryCodeFromGeo(geo);

      for (const [statName, statValue] of Object.entries(networkStats)) {
        const networkMetricValue = Math.round(statValue * 1000); // Convert to milliseconds
        const networkPhase = statName.toLowerCase().replace(/\s+/g, "_");

        // Get network threshold for this specific phase
        const networkThreshold = getThresholdForOperation(
          networkPhase,
          "network",
        );
        const networkSuccess = networkMetricValue <= networkThreshold;

        metrics.gauge(durationMetricName, networkMetricValue, [
          `libxmtp:${libxmtpVersion}`,
          `operation:${operationName}`,
          `test:${testNameExtracted}`,
          `metric_type:network`,
          `network_phase:${networkPhase}`,
          `geo.country_iso_code:${countryCode}`,
          `members:${members}`,
          `success:${networkSuccess}`,
          `threshold:${networkThreshold}`,
          `region:${currentGeo}`,
        ]);
      }
    }
  } catch (error) {
    console.error(`❌ Error sending metric '${testName}':`, error);
    // Existing error handling
  }
}

/**
 * Explicitly flush all buffered metrics to DataDog
 * Call this at the end of your test suite
 */
export function flushMetrics(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isInitialized) {
      resolve();
      return;
    }

    //console.log("🔄 Flushing DataDog metrics...");

    void metrics.flush().then(() => {
      //console.log("✅ DataDog metrics flushed successfully");
      resolve();
    });
  });
}

const execAsync = promisify(exec);

/**
 * Get network performance statistics for a specific endpoint
 * @param endpoint The endpoint to monitor (defaults to XMTP gRPC endpoint)
 * @returns Object containing timing information in seconds
 */
let firstLogShared = false;

interface NetworkStats {
  "DNS Lookup": number;
  "TCP Connection": number;
  "TLS Handshake": number;
  "Server Call": number;
  Processing: number;
}

export async function getNetworkStats(
  endpoint = "https://grpc.dev.xmtp.network:443",
): Promise<NetworkStats> {
  const curlCommand = `curl -s -w "\\n{\\"DNS Lookup\\": %{time_namelookup}, \\"TCP Connection\\": %{time_connect}, \\"TLS Handshake\\": %{time_appconnect}, \\"Server Call\\": %{time_starttransfer}, \\"Total Time\\": %{time_total}}" -o /dev/null --max-time 10 ${endpoint}`;

  let stdout: string;

  try {
    const result = await execAsync(curlCommand);
    stdout = result.stdout;
  } catch (error: any) {
    // Even if curl returns an error, we might still have useful stdout
    if (error.stdout) {
      stdout = error.stdout;
      console.warn(
        `⚠️ Curl command returned error code ${error.code}, but stdout is available.`,
      );
    } else {
      console.error(`❌ Curl command failed without stdout:`, error);
      throw error; // rethrow if no stdout is available
    }
  }

  // Parse the JSON response
  const stats = JSON.parse(stdout.trim()) as NetworkStats & {
    "Total Time": number;
  };

  // Handle the case where Server Call time is 0
  if (stats["Server Call"] === 0) {
    console.warn(
      `Network request to ${endpoint} returned Server Call time of 0. Total time: ${stats["Total Time"]}s`,
    );

    // Use Total Time as a fallback if it's available and non-zero
    if (stats["Total Time"] && stats["Total Time"] > stats["TLS Handshake"]) {
      stats["Server Call"] = stats["Total Time"];
    } else {
      // Otherwise use a reasonable estimate
      stats["Server Call"] = stats["TLS Handshake"] + 0.1;
    }
  }

  // Calculate processing time
  stats["Processing"] = stats["Server Call"] - stats["TLS Handshake"];

  // Ensure processing time is not negative
  if (stats["Processing"] < 0) {
    stats["Processing"] = 0;
  }

  if (
    stats["Processing"] * 1000 > 300 ||
    stats["TLS Handshake"] * 1000 > 300 ||
    stats["Server Call"] * 1000 > 300
  ) {
    if (!firstLogShared) {
      firstLogShared = true;
      console.warn(
        `Slow connection detected - total: ${stats["Server Call"] * 1000}ms, TLS: ${stats["TLS Handshake"] * 1000}ms, processing: ${stats["Processing"] * 1000}ms`,
      );
    }
  }

  return stats as NetworkStats;
}

// Helper function for stream/poll delivery rate
export function sendDeliveryRateMetric(
  successRate: number, // percentage 0-100
  testName: string,
  libxmtpVersion: string,
  deliveryType: "stream" | "poll",
  totalMessages: number,
): void {
  sendDeliveryMetric(
    successRate,
    testName,
    libxmtpVersion,
    deliveryType,
    "delivery",
    successRate >= 99.9 ? "success" : "failed",
    true,
  );

  // Also send message count for reference
  metrics.gauge(`xmtp.sdk.delivery.count`, totalMessages, [
    `test:${testName}`,
    `metric_type:${deliveryType}`,
    `metric_category:reliability`,
  ]);
}

// Helper function for stream/poll order correctness
export function sendOrderCorrectnessMetric(
  isCorrect: boolean,
  testName: string,
  libxmtpVersion: string,
  orderType: "stream" | "poll",
  totalMessages: number,
): void {
  sendDeliveryMetric(
    isCorrect ? 100 : 0,
    testName,
    libxmtpVersion,
    orderType,
    "order",
    "success",
    isCorrect,
  );

  // Also send message count for reference
  metrics.gauge(`xmtp.sdk.order.count`, totalMessages, [
    `test:${testName}`,
    `metric_type:${orderType}`,
    `metric_category:reliability`,
  ]);
}

// Helper function for offline recovery
export function sendRecoveryMetric(
  successRate: number, // percentage 0-100
  testName: string,
  libxmtpVersion: string,
  isOrderCorrect: boolean,
  totalMessages: number,
): void {
  sendDeliveryMetric(
    successRate,
    testName,
    libxmtpVersion,
    "recovery",
    "recovery",
    successRate >= 100 ? "success" : "failed",
    isOrderCorrect,
  );

  // Also send message count for reference
  metrics.gauge(`xmtp.sdk.recovery.count`, totalMessages, [
    `test:${testName}`,
    `metric_category:reliability`,
  ]);
}
