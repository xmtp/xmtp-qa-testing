import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { WorkerManager } from "@workers/manager";
import metrics from "datadog-metrics";

// Types definitions
interface MemberThresholds {
  creategroup: number;
  creategroupbyidentifiers: number;
  sendgroupmessage: number;
  syncgroup: number;
  updategroupname: number;
  removemembers: number;
  addmembers: number;
  receivegroupmessage: number;
  [key: string]: number;
}

interface ThresholdsData {
  core: {
    [key: string]: number;
  };
  network: {
    [key: string]: number;
  };
  memberBasedThresholds: {
    [memberCount: string]: MemberThresholds;
  };
  regionMultipliers: {
    [region: string]: number;
  };
  GEO_TO_COUNTRY_CODE: {
    [region: string]: string;
  };
  reliability: number;
}

interface NetworkStats {
  "DNS Lookup": number;
  "TCP Connection": number;
  "TLS Handshake": number;
  Processing: number;
  "Server Call": number;
}

interface MetricData {
  values: number[];
  threshold: number;
  members?: string;
}

interface ParsedTestName {
  metricName: string;
  metricDescription: string;
  testNameExtracted: string;
  operationType: string;
  operationName: string;
  members: string;
}

type OperationType = "core" | "group" | "network";
type MetricSubType = "stream" | "poll" | "recovery";
type MetricType = "delivery" | "order";

// Constants
const THRESHOLDS: ThresholdsData = {
  core: {
    clientcreate: 350,
    inboxstate: 350,
    createdm: 350,
    sendgm: 200,
    receivegm: 200,
    creategroup: 350,
    creategroupbyidentifiers: 350,
    syncgroup: 200,
    updategroupname: 200,
    removemembers: 250,
    sendgroupmessage: 200,
    receivegroupmessage: 200,
  },
  network: {
    dns_lookup: 100,
    tcp_connection: 150,
    tls_handshake: 250,
    processing: 100,
    server_call: 350,
  },
  memberBasedThresholds: {
    "50": {
      creategroup: 350,
      creategroupbyidentifiers: 350,
      receivegroupmessage: 350,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 250,
      addmembers: 200,
    },
    "100": {
      creategroup: 400,
      creategroupbyidentifiers: 400,
      receivegroupmessage: 400,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 300,
      addmembers: 200,
    },
    "150": {
      creategroup: 500,
      creategroupbyidentifiers: 500,
      receivegroupmessage: 500,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 300,
      addmembers: 200,
    },
    "200": {
      creategroup: 700,
      creategroupbyidentifiers: 700,
      receivegroupmessage: 700,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 300,
      addmembers: 200,
    },
    "250": {
      creategroup: 900,
      creategroupbyidentifiers: 900,
      receivegroupmessage: 900,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 400,
      addmembers: 200,
    },
    "300": {
      creategroup: 1100,
      creategroupbyidentifiers: 1100,
      receivegroupmessage: 1100,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 400,
      addmembers: 200,
    },
    "350": {
      creategroup: 1300,
      creategroupbyidentifiers: 1300,
      receivegroupmessage: 1300,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 400,
      addmembers: 200,
    },
    "400": {
      creategroup: 1500,
      creategroupbyidentifiers: 1500,
      receivegroupmessage: 1500,
      sendgroupmessage: 200,
      syncgroup: 200,
      updategroupname: 200,
      removemembers: 500,
      addmembers: 200,
    },
  },
  regionMultipliers: {
    "us-east": 1,
    "us-west": 1,
    europe: 1,
    asia: 1.5,
    "south-america": 3,
  },
  GEO_TO_COUNTRY_CODE: {
    "us-east": "US",
    "us-west": "US",
    europe: "FR",
    asia: "JP",
    "south-america": "BR",
  },
  reliability: 99.9,
};

// Global state with proper initialization
const state = {
  isInitialized: false,
  currentGeo: "",
  collectedMetrics: {} as Record<string, MetricData>,
};

// Helper functions
/**
 * Find the appropriate member bucket for a given member count
 */
function findMemberBucket(members: number): string {
  if (members <= 0) return "0";

  const memberBuckets = Object.keys(THRESHOLDS.memberBasedThresholds)
    .map(Number)
    .sort((a, b) => a - b);

  // Find highest bucket <= member count
  let applicableBucket = "0";
  for (const bucket of memberBuckets) {
    if (members >= bucket) {
      applicableBucket = bucket.toString();
    } else {
      break;
    }
  }

  return applicableBucket;
}

/**
 * Get the appropriate threshold for an operation based on type, member count, and region
 */
export function getThresholdForOperation(
  operation: string,
  operationType: OperationType,
  members: number = 0,
  region: string = "us-east",
): number {
  // Normalize inputs
  const operationLower = operation.toLowerCase();
  const regionNormalized = region.toLowerCase().trim();
  const regionMultiplier =
    THRESHOLDS.regionMultipliers[
      regionNormalized as keyof typeof THRESHOLDS.regionMultipliers
    ] || 1.0;

  let baseThreshold = 0;

  if (operationType === "network") {
    const networkThreshold =
      THRESHOLDS.network[operationLower as keyof typeof THRESHOLDS.network];
    baseThreshold =
      typeof networkThreshold === "number"
        ? networkThreshold
        : THRESHOLDS.network.server_call;
  } else if (operationType === "core") {
    baseThreshold =
      THRESHOLDS.core[operationLower as keyof typeof THRESHOLDS.core] || 0;
  } else if (operationType === "group" && members > 0) {
    const applicableBucket = findMemberBucket(members);
    const memberThresholds =
      THRESHOLDS.memberBasedThresholds[
        applicableBucket as keyof typeof THRESHOLDS.memberBasedThresholds
      ];

    if (memberThresholds && operationLower in memberThresholds) {
      baseThreshold =
        memberThresholds[operationLower as keyof typeof memberThresholds];
      // console.log(
      //   `Operation: ${operation}, members: ${members}, bucket: ${applicableBucket}, threshold: ${baseThreshold}`,
      // );
    } else {
      baseThreshold =
        THRESHOLDS.core[operationLower as keyof typeof THRESHOLDS.core] || 0;
      console.log(
        `Operation: ${operation}, members: ${members}, using core threshold: ${baseThreshold}`,
      );
    }
  } else {
    baseThreshold =
      THRESHOLDS.core[operationLower as keyof typeof THRESHOLDS.core] || 0;
  }

  return Math.round(baseThreshold * regionMultiplier);
}

/**
 * Calculate average of numeric values
 */
export function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Group metrics by operation name and member count
 */
export function groupMetricsByOperation(
  metrics: [string, MetricData][],
): Map<
  string,
  { operationName: string; members: string; operationData: MetricData }
> {
  const groups = new Map();

  for (const [operation, data] of metrics) {
    // Use the operation parsing logic from parseTestName for consistency
    const parts = operation.split(":");
    const operationPart = parts[0];
    const dashMatch = operationPart.match(/^([a-zA-Z]+)-(\d+)$/);

    const operationName = dashMatch ? dashMatch[1] : operationPart;
    const memberCount = dashMatch ? dashMatch[2] : data.members || "-";
    const groupKey = `${operationName}-${memberCount}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        operationName,
        members: memberCount,
        operationData: null,
      });
    }

    groups.get(groupKey).operationData = data;
  }

  return groups as Map<
    string,
    { operationName: string; members: string; operationData: MetricData }
  >;
}

/**
 * Get country code from geolocation
 */
function getCountryCodeFromGeo(geolocation: string): string {
  return (
    THRESHOLDS.GEO_TO_COUNTRY_CODE[
      geolocation as keyof typeof THRESHOLDS.GEO_TO_COUNTRY_CODE
    ] || "US"
  );
}

// DataDog integration
/**
 * Initialize DataDog metrics reporting
 */
export function initDataDog(
  testName: string,
  envValue: string,
  geolocation: string,
  apiKey: string,
): boolean {
  if (state.isInitialized) {
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
    state.currentGeo = geolocation;

    const initConfig = {
      apiKey: apiKey,
      defaultTags: [
        `env:${envValue}`,
        `test:${testName}`,
        `region:${geolocation}`,
        `country_iso_code:${countryCode}`,
      ],
    };

    metrics.init(initConfig);
    state.isInitialized = true;
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize DataDog metrics:", error);
    return false;
  }
}

/**
 * Send a metric to DataDog and collect for summary
 */
export function sendMetric(
  metricName: string,
  metricValue: number,
  tags: Record<string, string>,
): void {
  if (!state.isInitialized) return;

  try {
    const fullMetricName = `xmtp.sdk.${metricName}`;
    const allTags = Object.entries({ ...tags }).map(
      ([key, value]) => `${key}:${String(value)}`,
    );

    // Add environment tag if not already present
    if (!allTags.some((tag) => tag.startsWith("env:"))) {
      allTags.push(`env:${process.env.XMTP_ENV as string}`);
    }

    // Add version tag if not already present
    if (!allTags.some((tag) => tag.startsWith("xv:"))) {
      allTags.push(`vm:${process.env.RAILWAY_SERVICE_ID || "unknown"}`);
    }

    // Create a distinctive operation key that properly includes member count
    // Format: operation_name-member_count (e.g., "createGroup-10")
    const memberCount = tags.members || "";
    const operationKey = tags.operation
      ? `${tags.operation}${memberCount ? `-${memberCount}` : ""}`
      : metricName;

    if (!state.collectedMetrics[operationKey]) {
      state.collectedMetrics[operationKey] = {
        values: [],
        threshold: Number(tags.threshold) || 0,
        members: memberCount,
      };
    }

    state.collectedMetrics[operationKey].values.push(metricValue);

    metrics.gauge(fullMetricName, Math.round(metricValue), allTags);
  } catch (error) {
    console.error(
      `❌ Error sending metric '${metricName}':`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Send test results metrics
 */
export function sendTestResults(hasFailures: boolean, testName: string): void {
  if (!state.isInitialized) {
    console.warn("Datadog metrics not initialized");
    return;
  }

  try {
    const metricValue = hasFailures ? 0 : 1;
    sendMetric("workflow", metricValue, {
      workflow: testName,
      metric_type: "workflow",
    });
  } catch (error) {
    console.error("Error reporting to Datadog:", error);
  }
}

// Performance tracking
/**
 * Send performance metrics for tests
 */
export const sendPerformanceResult = (
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
      false,
    );
  }
};

/**
 * Extract operation details from test name
 */
export function parseTestName(testName: string): ParsedTestName {
  const metricNameParts = testName.split(":")[0];
  const metricName = metricNameParts.replaceAll(" > ", ".");
  const metricDescription = testName.split(":")[1] || "";
  const operationParts = metricName.split(".");
  const testNameExtracted = operationParts[0];

  // Extract operation name and member count
  let operationName = "";
  let members = "";

  if (operationParts[1]) {
    // Check formats: "operation-10" and "operation10"
    const dashMatch = operationParts[1].match(/^([a-zA-Z]+)-(\d+)$/);
    const noSeparatorMatch = operationParts[1].match(/^([a-zA-Z]+)(\d+)$/);

    if (dashMatch) {
      operationName = dashMatch[1];
      members = dashMatch[2];
    } else if (noSeparatorMatch) {
      operationName = noSeparatorMatch[1];
      members = noSeparatorMatch[2];
    } else {
      operationName = operationParts[1];
    }
  }

  const operationType = operationName.toLowerCase().includes("group")
    ? "group"
    : "core";

  return {
    metricName,
    metricDescription,
    testNameExtracted,
    operationType,
    operationName,
    members,
  };
}

/**
 * Send detailed performance metrics
 */
export async function sendPerformanceMetric(
  metricValue: number,
  testName: string,
  libxmtpVersion: string,
  skipNetworkStats: boolean = false,
): Promise<void> {
  if (!state.isInitialized) return;

  try {
    const {
      metricDescription,
      testNameExtracted,
      operationType,
      operationName,
      members,
    } = parseTestName(testName);

    const threshold = getThresholdForOperation(
      operationName,
      operationType as OperationType,
      parseInt(members) || 0,
      state.currentGeo,
    );

    const isSuccess = metricValue <= threshold;

    sendMetric("duration", metricValue, {
      libxmtp: libxmtpVersion,
      operation: operationName,
      test: testNameExtracted,
      metric_type: "operation",
      metric_subtype: operationType,
      description: metricDescription,
      members: members,
      success: isSuccess.toString(),
      threshold: threshold.toString(),
      region: state.currentGeo,
    });

    // Network stats handling
    if (!skipNetworkStats) {
      const networkStats = await getNetworkStats();
      const countryCode = getCountryCodeFromGeo(state.currentGeo);

      for (const [statName, statValue] of Object.entries(networkStats)) {
        const networkMetricValue = Math.round(statValue * 1000);
        const networkPhase = statName.toLowerCase().replace(/\s+/g, "_");
        const networkThreshold = getThresholdForOperation(
          networkPhase,
          "network",
          parseInt(members) || 0,
          state.currentGeo,
        );

        sendMetric("duration", networkMetricValue, {
          libxmtp: libxmtpVersion,
          operation: operationName,
          test: testNameExtracted,
          metric_type: "network",
          network_phase: networkPhase,
          country_iso_code: countryCode,
          members: members,
          success: networkMetricValue <= networkThreshold ? "true" : "false",
          threshold: networkThreshold.toString(),
          region: state.currentGeo,
        });
      }
    }
  } catch (error) {
    console.error(
      `❌ Error sending performance metric for '${testName}':`,
      error,
    );
  }
}

/**
 * Send delivery reliability metrics
 */
export function sendDeliveryMetric(
  metricValue: number,
  version: string,
  testName: string,
  metricSubType: MetricSubType,
  metricType: MetricType,
): void {
  const threshold = THRESHOLDS.reliability;
  const isSuccess = metricValue >= threshold;

  sendMetric(metricType, Math.round(metricValue), {
    libxmtp: version,
    test: testName,
    metric_type: metricType,
    metric_subtype: metricSubType,
    success: isSuccess.toString(),
    threshold: threshold.toString(),
  });
}

// Network performance
const execAsync = promisify(exec);

/**
 * Measure network performance to an endpoint
 */
export async function getNetworkStats(
  endpoint = "https://grpc.dev.xmtp.network:443",
): Promise<NetworkStats> {
  const curlCommand = `curl -s -w "\\n{\\"DNS Lookup\\": %{time_namelookup}, \\"TCP Connection\\": %{time_connect}, \\"TLS Handshake\\": %{time_appconnect}, \\"Server Call\\": %{time_starttransfer}}" -o /dev/null --max-time 10 ${endpoint}`;

  let stdout: string;

  try {
    const result = await execAsync(curlCommand);
    stdout = result.stdout;
  } catch (error: unknown) {
    // Even if curl returns an error, we might still have useful stdout
    if (error instanceof Error && "stdout" in error) {
      stdout = error.stdout as string;
      console.warn(
        `⚠️ Curl command returned error code ${String(error)}, but stdout is available.`,
      );
    } else {
      console.error(`❌ Curl command failed without stdout:`, error);
      throw error; // rethrow if no stdout is available
    }
  }

  // Parse the JSON response
  const stats = JSON.parse(stdout.trim()) as NetworkStats;

  // Handle the case where Server Call time is 0
  if (stats["Server Call"] === 0) {
    console.warn(
      `Network request to ${endpoint} returned Server Call time of 0.`,
    );

    // Use a reasonable estimate
    stats["Server Call"] = stats["TLS Handshake"] + 0.1;
  }

  // Calculate processing time
  stats["Processing"] = stats["Server Call"] - stats["TLS Handshake"];

  // Ensure processing time is not negative
  if (stats["Processing"] < 0) {
    stats["Processing"] = 0;
  }

  return stats;
}

// Reporting and summary
/**
 * Flush all metrics and generate summary report
 */
export function flushMetrics(testName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!state.isInitialized) {
      resolve();
      return;
    }

    logMetricsSummary(testName);

    void metrics.flush().then(() => {
      resolve();
    });
  });
}

/**
 * Creates and saves the metrics report
 */
function saveMetricsReport(
  testName: string,
  validMetrics: [string, MetricData][],
): void {
  // Create directory for reports
  const reportsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Create filename with environment info
  const filename = path.join(
    reportsDir,
    `${testName}-${state.currentGeo}-${process.env.XMTP_ENV}.md`,
  );

  try {
    fs.writeFileSync(filename, generateReportContent(validMetrics));
    console.log(`✅ Report saved to ${filename}`);
  } catch (error) {
    console.error(`❌ Error writing metrics summary to file:`, error);
  }
}

/**
 * Generate and log a metrics summary report
 */
export function logMetricsSummary(testName: string): void {
  if (
    !state.isInitialized ||
    Object.keys(state.collectedMetrics).length === 0
  ) {
    console.log("No metrics collected to summarize");
    return;
  }

  console.log("\n📊 Creating metrics summary report");

  // Filter out workflow metrics and empty value arrays
  const validMetrics = Object.entries(state.collectedMetrics).filter(
    ([operation, data]) => operation !== "workflow" && data.values.length > 0,
  );

  // Count passed metrics
  const passedMetrics = validMetrics.filter(
    ([_, data]) => calculateAverage(data.values) <= data.threshold,
  ).length;

  const totalMetrics = validMetrics.length;
  const passRate =
    totalMetrics > 0 ? Math.round((passedMetrics / totalMetrics) * 100) : 0;

  console.log(
    `✅ Passed: ${passedMetrics}/${totalMetrics} metrics (${passRate}%)`,
  );

  saveMetricsReport(testName, validMetrics);

  // Reset metrics collection for next test run
  state.collectedMetrics = {};
}

/**
 * Generate the markdown report content
 */
function generateReportContent(validMetrics: [string, MetricData][]): string {
  let content = "# METRICS SUMMARY\n\n";
  content +=
    "| Operation | Members | Avg (ms) | Min/Max (ms) | Threshold (ms) | Variance (ms) | Status |\n";
  content +=
    "|-----------|---------|----------|--------------|----------------|---------------|---------|\n";

  // Group metrics by operation name and member count
  const operationGroups = groupMetricsByOperation(validMetrics);

  // Generate table rows
  for (const group of operationGroups.values()) {
    if (!group.operationData) continue;

    const { operationName, members, operationData: data } = group;
    const memberCount = members !== "-" ? parseInt(members) : 0;
    const operationType = operationName.toLowerCase().includes("group")
      ? "group"
      : "core";

    // Calculate metrics data
    const threshold = getThresholdForOperation(
      operationName,
      operationType as OperationType,
      memberCount,
      state.currentGeo,
    );
    data.threshold = threshold;

    const average = calculateAverage(data.values);
    const variance = Math.round(average - threshold);
    const varianceFormatted =
      variance <= 0 ? variance.toString() : `+${variance}`;

    // Format table row
    content += `| ${operationName} | ${members} | ${Math.round(average)} | ${Math.round(Math.min(...data.values))}/${Math.round(Math.max(...data.values))} | ${threshold} | ${varianceFormatted} | ${average <= threshold ? "PASS ✅" : "FAIL ❌"} |\n`;
  }

  return content;
}
