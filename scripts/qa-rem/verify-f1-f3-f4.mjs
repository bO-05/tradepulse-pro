import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("DEPLOYMENT:", url);

// ---------- F1: project create persistence ----------
const title = `QA-REM-F1-verify-${Date.now()}`;
const createdId = await client.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA Verification",
  estBudget: 250000,
  targetCompletionWeeks: 12,
  specDocumentText: "QA verification project created by remediation script.",
  isDemoProject: false,
});
const afterCreate = await client.query("projects:listProjects", {});
check("F1a project returned id", typeof createdId === "string" && createdId.length > 0, createdId);
check(
  "F1b project visible in listProjects immediately",
  afterCreate.some((p) => p._id === createdId && p.title === title),
  `count=${afterCreate.length}`
);
// Fresh client simulates a page reload fetching all projects again
const fresh = new ConvexHttpClient(url);
const afterReload = await fresh.query("projects:listProjects", {});
check(
  "F1c project persists after fresh query (reload simulation)",
  afterReload.some((p) => p._id === createdId && p.title === title),
  `count=${afterReload.length}`
);

// ---------- F4: file upload -> saveFileRecord ----------
const uploadUrl = await client.mutation("files:generateUploadUrl", {});
const fileBody = new TextEncoder().encode("QA-REM live upload verification payload. CSI Div 26 test document.");
const uploadResp = await fetch(uploadUrl, {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: fileBody,
});
const uploadJson = await uploadResp.json();
const storageId = uploadJson.storageId;
check("F4a storage upload accepted", Boolean(storageId), String(storageId));
let fileId = null;
try {
  fileId = await client.mutation("files:saveFileRecord", {
    projectId: createdId,
    storageId,
    fileName: "QA-REM-live-upload.txt",
    fileType: "spec",
    fileSize: fileBody.length,
    uploadedBy: "QA-REM-Audit",
    contentType: "text/plain",
  });
  check("F4b saveFileRecord persisted (was server error)", Boolean(fileId), String(fileId));
} catch (err) {
  check("F4b saveFileRecord persisted (was server error)", false, err?.message || String(err));
}
const filesAfter = await client.query("files:listFilesByProject", { projectId: createdId });
check(
  "F4c file record visible in listFilesByProject",
  filesAfter.some((f) => f.fileName === "QA-REM-live-upload.txt"),
  `files=${filesAfter.length}`
);

// ---------- F3: legal addendum generation (0 pending RFIs on fresh QA project) ----------
try {
  const addendum = await client.action("files:generatePreBidAddendum", { projectId: createdId });
  check("F3a addendum action succeeded (was server error)", addendum?.success === true, addendum?.fileName);
  check("F3b addendum has downloadable storage id", Boolean(addendum?.storageId), String(addendum?.storageId));
  const filesAfterAddendum = await client.query("files:listFilesByProject", { projectId: createdId });
  check(
    "F3c addendum file record persisted",
    filesAfterAddendum.some((f) => String(f.fileType) === "addendum"),
    `files=${filesAfterAddendum.length}`
  );
} catch (err) {
  check("F3a addendum action succeeded (was server error)", false, err?.message || String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;