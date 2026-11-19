// The Node binary for child processes in tests. Under Electron's Node (CI job "tests in the Node of
// Electron") process.execPath is the Electron binary, which only acts as Node with
// ELECTRON_RUN_AS_NODE, and the sidecar environment drops that on purpose.
export const NODE_BIN = process.versions.electron ? process.env.LEVUVO_TEST_NODE || 'node' : process.execPath;
