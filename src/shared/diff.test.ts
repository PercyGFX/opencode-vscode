import { describe, expect, it } from "vitest"
import { applyPatch, diffLines, readFileDiffs } from "./diff.ts"

const patch = `Index: src/a.ts
===================================================================
--- src/a.ts
+++ src/a.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
`

describe("applyPatch", () => {
  it("applies a change in the middle of a file", () => {
    expect(applyPatch("one\ntwo\nthree\n", patch)).toBe("one\nTWO\nthree\n")
  })

  it("keeps Windows line endings", () => {
    expect(applyPatch("one\r\ntwo\r\nthree\r\n", patch)).toBe("one\r\nTWO\r\nthree\r\n")
  })

  it("finds the hunk when lines above it moved", () => {
    expect(applyPatch("zero\none\ntwo\nthree\n", patch)).toBe("zero\none\nTWO\nthree\n")
  })

  it("applies several hunks in order", () => {
    const twoHunks = "@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -5,2 +5,3 @@\n e\n+E2\n f\n"
    expect(applyPatch("a\nb\nc\nd\ne\nf\n", twoHunks)).toBe("A\nb\nc\nd\ne\nE2\nf\n")
  })

  it("creates a new file from an insert-only hunk", () => {
    expect(applyPatch("", "--- /dev/null\n+++ b.ts\n@@ -0,0 +1,2 @@\n+hello\n+world\n")).toBe("hello\nworld\n")
  })

  it("gives up when the file no longer matches", () => {
    expect(applyPatch("one\nchanged\nthree\n", patch)).toBeUndefined()
    expect(applyPatch("anything", "not a patch")).toBeUndefined()
  })
})

describe("diffLines", () => {
  it("drops file headers and marks each line", () => {
    expect(diffLines(patch)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "ctx", text: "one" },
      { kind: "del", text: "two" },
      { kind: "add", text: "TWO" },
      { kind: "ctx", text: "three" },
    ])
  })
})

describe("readFileDiffs", () => {
  it("reads the files list from edit and write tools", () => {
    const diffs = readFileDiffs({ files: [{ file: "src/a.ts", patch, additions: 1, deletions: 1, status: "modified" }] })
    expect(diffs).toEqual([{ file: "src/a.ts", patch, additions: 1, deletions: 1, status: "modified" }])
  })

  it("reads the single diff from the patch tool and counts its lines", () => {
    expect(readFileDiffs({ filepath: "src/a.ts", diff: patch })).toMatchObject([
      { file: "src/a.ts", additions: 1, deletions: 1, status: "modified" },
    ])
  })

  it("ignores metadata without a diff", () => {
    expect(readFileDiffs(undefined)).toEqual([])
    expect(readFileDiffs({ url: "https://example.com" })).toEqual([])
    expect(readFileDiffs({ files: [{ file: "a.ts" }] })).toEqual([])
  })
})
