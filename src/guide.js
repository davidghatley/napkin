// The guide agents read from napkin itself (AGT-07): served as the MCP resource napkin://guide,
// the prompt "napkin_guide" and GET /api/guide. Keep it short and exact: agents act on it.
export const GUIDE = `# napkin guide for agents

napkin edits real React components: components/<Name>.tsx plus a <Name>.napkin.json sidecar. You change them only through the napkin tools; never write the files directly.

## Workflow
1. list_components, then read_component { component } (name or id). You get { revision, doc, source }.
2. apply_edits { component, baseRevision: <revision you read>, edits: [...] }. All edits land together or none do.
3. Use dryRun: true first when unsure: it validates and returns the would-be TSX source without writing.
4. render_component { component, variant } returns a PNG of one variant cell so you can look at the result.

## The document (doc)
- doc.name, doc.props [{name,type,default,options?}], doc.root (a tree of nodes {id, tag, style, text?, attrs?, children}).
- Every node has a stable id (the data-n attribute). Styles are CSS properties in camelCase.
- A prop whose type is an enum (a union of strings) is a variant axis; its default is the base value.
- doc.variants[axis][value][nodeId] holds only what differs from the base.

## Edit ops
- set a style:      { "op": "set", "path": "title.fontWeight", "value": 600 }
- remove a style:   { "op": "set", "path": "title.color", "value": null }
- set text / attrs: { "op": "set", "path": "title.text", "value": "Hello" }  |  "image.@src" / "image.@alt"
- override for one variant: { "op": "set", "path": "root.padding", "value": "4px", "variant": { "size": "sm" } }
- insert a node:    { "op": "insert", "parent": "root", "index": 1, "node": { "id": "badge", "tag": "span", "style": { "color": "red" }, "text": "New" } }
- delete / move:    { "op": "delete", "id": "badge" }  |  { "op": "move", "id": "badge", "parent": "root", "index": 0 }
- props:            { "op": "addProp", "name": "tone", "type": "enum", "options": ["plain","loud"], "default": "plain" } | { "op": "removeProp", "name": "tone" } | { "op": "setDefault", "name": "label", "value": "Go" }
- text from a prop: { "op": "bindText", "id": "label", "prop": "label" }  (prop: null unbinds)
- variants:         { "op": "addVariant", "axis": "size", "value": "xl" } | { "op": "removeVariant", "axis": "size", "value": "xl" }
  The add_variant tool does addVariant plus style overrides in one call: { component, baseRevision, axis: "size", value: "xl", overrides: { root: { padding: "14px 28px" } } }.
Numbers stay numbers (fontSize: 20); strings are CSS text ("14px 28px").

## Other tools
- create_component { name (PascalCase), rootTag? }, rename_component { component, name }, delete_component { component }.
- search { query } finds components and nodes by name, id, tag or text.
- subscribe { waitMs? } returns { changes, resolved }: changes other people made since your last call, and how the person answered your proposals (see Propose mode).
- A file outside the napkin dialect is read-only: read it or render it with default props; direct edits, rename and delete are refused with the reason.
- propose_adoption { component } proposes a faithful dialect rewrite of a simple read-only file. It returns a source diff through the existing proposals system; nothing writes until a write-capable reviewer accepts. Reject leaves the source unchanged. Local logic, hooks, class names and other unsupported behavior are refused instead of approximated. A hand edit makes a pending adoption stale: reject it and propose again. Adoption needs a running canvas server.

## Stale revisions
If something you touch changed after your baseRevision, apply_edits fails with "stale revision" and a "stale" list:
[{ key, value (what it holds now), yours (what you tried), revision, by }] and currentRevision.
Look at the list, decide whether your edit still makes sense, then retry once with baseRevision = currentRevision. Edits to different properties never conflict, even on an old revision.
If your baseRevision is too old to remember (or unknown), the error still lists your keys that changed since (stale), plus changedKeys (everything that moved since oldestRevision): read the component again and rebase.

## Who you are, and permissions
Your name is NAPKIN_AGENT; the server names you from your session, not from anything you send. If the project's napkin.json has an "agents" key, only the names it lists get their listed mode (read, propose or write); any other name gets the "*" mode, which is read when absent. With no "agents" key everyone may write. Permissions are guard rails for agents that go through napkin, not a security boundary: any program running as the user can edit the files directly.

## Propose mode
apply_edits with propose: true (or an agent configured as "propose" in napkin.json) does not write. The edits are validated like a dry run and held as a proposal; the person accepts or rejects it on the canvas. You get { proposed: true, proposal: { id } }. An agent configured as "read" can only read and dry-run. Propose mode needs the napkin canvas to be running (that is where a person reviews); without it the call is refused, so apply directly if you are allowed to.

### Creating a component in propose mode
create_component { name } from a propose agent (or with propose: true) creates nothing. You get { proposed: true, proposal: { id, component: "new:<Name>" } }; the canvas shows the new component as a ghost frame in the proposals tray, and no file exists until the person accepts it (then it is written as yours, approved by them). Reject leaves no file.
While it is pending, read_component and apply_edits on that name are refused ("only proposed so far"): wait for the resolved event, then read_component and propose your edits. One pending create per name; the name must be free.

### Learning how your proposals were answered
subscribe { waitMs } returns { changes, resolved }. Each resolved entry is { proposal, component, summary, outcome: "accepted" | "rejected" | "partly", accepted: [edit summaries], rejected: [edit summaries], by (the person), final: true, revision? }. When the person answers only some edits of a proposal you get an entry with final: false and outcome "partly accepted" or "partly rejected", listing those edits and what remains. The same entry is pushed as notifications/napkin/resolved. A rejected proposal never touched the file: do not assume a change landed until its resolved entry says accepted; if it was rejected, read_component again before proposing something different.
`;
