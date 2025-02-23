import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger, flushLogger, overrideConsole } from "../helpers/logger";
import {
  DefaultPersonas,
  defaultValues,
  getWorkers,
} from "../helpers/personas";

const env = "dev";
const testName = "TS_Personas_" + env;

/* 
TODO:
- Inconsistent test results (~20%).
- Performance issues (>1000ms) for operations
- Old sdk to new sdk breaks (node 41 to 42)
- agent stream failures
- 20% missed streams

*/

describe(testName, () => {
  beforeAll(async () => {
    const logger = createLogger(testName);
    overrideConsole(logger);
    // Ensure the data folder is clean before running tests
    //fs.rmSync(".data", { recursive: true, force: true });
  }, defaultValues.timeout);

  it(
    "should create a persona",
    async () => {
      // Get Bob's persona using the enum value.
      const [bob] = await getWorkers([DefaultPersonas.BOB], env, testName);

      expect(bob.client?.accountAddress).toBeDefined();
    },
    defaultValues.timeout,
  );

  it(
    "should create a random persona",
    async () => {
      const [randomPersona] = await getWorkers(["random"], env, testName);
      expect(randomPersona.client?.accountAddress).toBeDefined();
    },
    defaultValues.timeout,
  );

  it(
    "should create multiple personas",
    async () => {
      const personas = await getWorkers(
        [DefaultPersonas.BOB, DefaultPersonas.ALICE, "randompep", "randombob"],
        env,
        testName,
      );
      const [bob, alice, random, randomBob] = personas;
      expect(bob.client?.accountAddress).toBeDefined();
      expect(alice.client?.accountAddress).toBeDefined();
      expect(random.client?.accountAddress).toBeDefined();
      expect(randomBob.client?.accountAddress).toBeDefined();
    },
    defaultValues.timeout * 2,
  );

  // it(
  //   "should create 10 personas",
  //   async () => {
  //     const selectedPersonas = [
  //       DefaultPersonas.BOB,
  //       DefaultPersonas.ALICE,
  //       DefaultPersonas.ADAM,
  //       DefaultPersonas.BELLA,
  //       DefaultPersonas.CARL,
  //       DefaultPersonas.DIANA,
  //       DefaultPersonas.ERIC,
  //       DefaultPersonas.FIONA,
  //       DefaultPersonas.GEORGE,
  //       DefaultPersonas.HANNAH,
  //     ];
  //     const personas = await personaFactory.getWorkers(selectedPersonas);

  //     for (const persona of personas) {
  //       expect(persona.address).toBeDefined();
  //     }
  //   },
  //   defaultValues.timeout * 4,
  // );
  afterAll(() => {
    flushLogger(testName);
  });
});
