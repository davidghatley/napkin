// Flags for the node process that runs src/server.js (used by the CLI and the test harness; package.json's "start" repeats them).
// A 2 MB young generation instead of V8's default 16 MB: with 200 components and a page and agents editing, the default let the
// server's resident memory swing by about 45 MB between collections (REL-04: growth over 30 minutes counts the swing);
// 2 MB keeps it to a few. (The 2 is a measurement, not a rule: see docs/evidence/REL-04.txt.) Scavenges are more frequent and still take about a millisecond.
export const SERVER_FLAGS = ['--max-semi-space-size=2'];
