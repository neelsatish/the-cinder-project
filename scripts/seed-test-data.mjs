#!/usr/bin/env node
// Seeds a NEW, EMPTY Cinder Host data folder with clearly labelled test data
// ("Cinder Test School") so every Teacher and Student screen has something to show.
//
//   node scripts/seed-test-data.mjs <empty-data-folder>
//
// It starts the standalone `cinder-host` server on 127.0.0.1 (a random port),
// creates everything through the classroom HTTPS API with the Host certificate
// pinned, then stops the server. Afterwards, set up the Cinder Host app with the
// same folder (use HOST_ADMIN_PASSWORD below) and sign in from Teacher and Student.
//
// It refuses to touch a folder that already has anything in it. To reseed, pick a
// new empty folder (or move the old one away yourself); nothing is ever deleted.
//
// Student notes are not seeded: the Student app keeps them on the device, not on
// the Host. Create a few by hand when testing.
//
// These are test credentials for a local test school only. Never reuse them.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const HOST_ADMIN_PASSWORD = "cinder-host-test-admin";
export const TEACHER_PASSWORD = "cinder-teacher-test";
export const STUDENT_PASSWORD = "cinder-student-test";
export const SCHOOL_NAME = "Cinder Test School";

const TEACHERS = [
  { username: "test.teacher", display_name: "Asha Raman" },
  { username: "test.coteacher", display_name: "Daniel Mensah-Clarke" },
];

const STUDENTS = [
  { username: "test.priya", display_name: "Priya Nair", roll: "01" },
  { username: "test.tom", display_name: "Tom Okafor", roll: "02" },
  { username: "test.meera", display_name: "Meera Krishnamurthy-Iyer", roll: "03" },
  { username: "test.sam", display_name: "Sam Li", roll: "04" },
  { username: "test.fatima", display_name: "Fatima Al-Hassan", roll: "05" },
  { username: "test.oliver", display_name: "Oliver Bennett", roll: "06" },
  { username: "test.ananya", display_name: "Ananya Rao", roll: "07" },
  { username: "test.jonah", display_name: "Jonah Fitzgerald", roll: "08" },
  { username: "test.zara", display_name: "Zara Thompson", roll: "09" },
  { username: "test.kiran", display_name: "Kiran Desai", roll: "10" },
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`seed-test-data: ${message}`);
  process.exit(1);
}

// ---------- small file generators ----------

function makePdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const body = [`BT /F1 20 Tf 56 770 Td (${esc(title)}) Tj /F1 12 Tf 0 -32 Td`];
  lines.forEach((line, i) => body.push(`${i ? "0 -18 Td " : ""}(${esc(line)}) Tj`));
  body.push("ET");
  const text = body.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function makePng(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const stripe = Math.floor((x + y) / 16) % 2 === 0 ? 1 : 0.85;
      row[1 + x * 3] = Math.round(r * stripe);
      row[2 + x * 3] = Math.round(g * stripe);
      row[3 + x * 3] = Math.round(b * stripe);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const doc = (...paragraphs) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

// ---------- dates ----------

const DAY = 86_400_000;
const isoIn = (days, hour = 17) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function recentSchoolDays(count) {
  const days = [];
  for (let d = new Date(); days.length < count; d = new Date(d.getTime() - DAY)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(localDay(d));
  }
  return days.reverse();
}

// ---------- server ----------

function hostBinary() {
  const exe = path.join(repoRoot, "target", "debug", process.platform === "win32" ? "cinder-host.exe" : "cinder-host");
  console.log("Building cinder-host (cargo build -p cinder-host)…");
  const built = spawnSync("cargo", ["build", "-p", "cinder-host"], { cwd: repoRoot, stdio: "inherit" });
  if (built.status !== 0 || !fs.existsSync(exe)) fail("could not build cinder-host.");
  return exe;
}

function startHost(exe, dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["--data-dir", dataDir, "--bind", "127.0.0.1", "--port", "0", "--name", "Cinder seed (temporary)"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pin = null;
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Host did not start:\n${output}`)), 30_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      pin ??= output.match(/setup PIN[^:]*:\s*(\d+)/)?.[1] ?? null;
      const port = output.match(/LAN URL: https:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      if (port && pin) {
        clearTimeout(timer);
        resolve({ child, port: Number(port), pin, log: () => output });
      }
    });
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => reject(new Error(`Host exited (${code}):\n${output}`)));
  });
}

// ---------- API client (certificate pinned) ----------

function makeClient(port, certDer) {
  const pem = `-----BEGIN CERTIFICATE-----\n${certDer.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const agent = new https.Agent({ ca: pem, keepAlive: true });

  function send(method, urlPath, { token, json, file } = {}) {
    return new Promise((resolve, reject) => {
      const headers = {};
      let body = null;
      if (token) headers.Authorization = `Bearer ${token}`;
      if (json !== undefined) {
        body = Buffer.from(JSON.stringify(json));
        headers["Content-Type"] = "application/json";
      } else if (file) {
        const boundary = `cinderseed${Date.now()}`;
        body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
          file.bytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
      }
      if (body) headers["Content-Length"] = body.length;
      const req = https.request(
        { host: "127.0.0.1", servername: "localhost", port, path: urlPath, method, headers, agent },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed = null;
            try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
            resolve({ status: res.statusCode, body: parsed });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async function call(method, urlPath, options = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await send(method, urlPath, options);
      if (res.status === 429 && attempt < 2) {
        console.log("  sign-in limit reached; waiting a minute…");
        await new Promise((r) => setTimeout(r, 61_000));
        continue;
      }
      if (res.status >= 400) {
        throw new Error(`${method} ${urlPath} failed (${res.status}): ${JSON.stringify(res.body)}`);
      }
      return res.body;
    }
  }

  return { call, close: () => agent.destroy() };
}

// ---------- seed ----------

async function seed({ call }, pin) {
  const as = (token) => ({
    get: (p) => call("GET", p, { token }),
    post: (p, json) => call("POST", p, { token, json }),
    put: (p, json) => call("PUT", p, { token, json }),
    patch: (p, json) => call("PATCH", p, { token, json }),
    upload: (p, file) => call("POST", p, { token, file }),
  });
  const login = async (username, password, role) =>
    (await call("POST", "/api/auth/login", {
      json: { username, password, expected_role: role, device_label: "Seed script" },
    })).token;

  console.log("Teachers…");
  const [lead, co] = TEACHERS;
  await call("POST", "/api/auth/bootstrap", {
    json: { ...lead, password: TEACHER_PASSWORD, bootstrap_pin: pin },
  });
  const t1 = as(await login(lead.username, TEACHER_PASSWORD, "teacher"));
  const invite = await t1.post("/api/teacher/invite-pin");
  await call("POST", "/api/auth/register-teacher", {
    json: { ...co, password: TEACHER_PASSWORD, invite_pin: invite.invite_pin },
  });
  const t2 = as(await login(co.username, TEACHER_PASSWORD, "teacher"));
  const coUser = await t2.get("/api/me");

  console.log("Classrooms…");
  const maths = await t1.post("/api/classrooms", {
    name: "Year 9 Mathematics", subject_code: "MATH9", color: "#b24e17",
    description: "Number, algebra and geometry for Year 9.",
  });
  const science = await t1.post("/api/classrooms", {
    name: "Year 9 Science", subject_code: "SCI9", color: "#2f6f5e",
    description: "Chemistry, physics and biology foundations.",
  });
  const english = await t2.post("/api/classrooms", {
    name: "Year 10 English Literature", subject_code: "ENG10", color: "#3b5b8c",
    description: "Poetry, prose and drama.",
  });
  // Deliberately left empty so empty states can be checked.
  await t1.post("/api/classrooms", {
    name: "Year 10 History", subject_code: "HIS10", color: "#7a5c2e", description: "",
  });
  await t1.post(`/api/classrooms/${maths.id}/teachers`, { teacher_id: coUser.id });

  console.log("Students…");
  const students = [];
  for (const s of STUDENTS) {
    const created = await t1.post("/api/teacher/users", {
      classroom_id: maths.id, username: s.username, display_name: s.display_name,
      grade_level: "9", section: "A", roll_number: s.roll,
    });
    const token = await login(s.username, created.temporary_password, "student");
    await call("POST", "/api/auth/change-password", {
      token, json: { current_password: created.temporary_password, new_password: STUDENT_PASSWORD },
    });
    students.push({ ...s, id: created.user.id, api: as(token) });
  }
  for (const s of students.slice(0, 6)) await t1.post(`/api/classrooms/${science.id}/students`, { student_id: s.id });
  for (const s of students.slice(4, 9)) await t2.post(`/api/classrooms/${english.id}/students`, { student_id: s.id });

  console.log("Materials…");
  const upload = (api, classroomId, name, bytes) =>
    api.upload(`/api/files?shared=true&classroom_id=${classroomId}`, { name, bytes });
  await upload(t1, maths.id, "Fractions worksheet.pdf", makePdf("Fractions worksheet (test material)", [
    "Cinder Test School - Year 9 Mathematics", "", "1. Simplify 18/24.", "2. Add 2/3 and 3/4.",
    "3. Work out 5/6 of 42.", "4. Write 0.375 as a fraction in its simplest form.",
  ]));
  await upload(t1, maths.id, "Algebra notes.pdf", makePdf("Algebra notes (test material)", [
    "Cinder Test School - Year 9 Mathematics", "", "Expanding brackets: a(b + c) = ab + ac",
    "Factorising: ab + ac = a(b + c)", "Solving: 3x + 5 = 20, so x = 5",
  ]));
  await upload(t1, maths.id, "Angles diagram.png", makePng(320, 200, [178, 78, 23]));
  await upload(t1, science.id, "States of matter.pdf", makePdf("States of matter (test material)", [
    "Cinder Test School - Year 9 Science", "", "Solid, liquid and gas.", "Melting, freezing, evaporation, condensation.",
  ]));
  await upload(t2, english.id, "Poems for comparison.pdf", makePdf("Poems for comparison (test material)", [
    "Cinder Test School - Year 10 English Literature", "", "Read both poems and note the imagery used.",
  ]));

  console.log("Assignments, submissions and grades…");
  const assignment = (api, input) => api.post("/api/assignments", {
    grading_scheme: { type: "points" }, due_at: null, max_points: 10, publish: true, ...input,
  });
  const fractions = await assignment(t1, {
    classroom_id: maths.id, title: "Fractions practice", max_points: 20, due_at: isoIn(-3),
    instructions: "Complete questions 1 to 4 from the fractions worksheet. Show your working.",
  });
  const algebra = await assignment(t1, {
    classroom_id: maths.id, title: "Algebra homework", due_at: isoIn(5),
    instructions: "Expand and simplify the expressions on page 2 of the algebra notes.",
  });
  await assignment(t1, {
    classroom_id: maths.id, title: "Geometry project", publish: false, due_at: isoIn(14),
    instructions: "Draft: design a floor plan and work out the area of each room.",
  });
  const closed = await assignment(t1, {
    classroom_id: maths.id, title: "Mental maths check", max_points: 5, due_at: isoIn(-10),
    instructions: "Ten quick questions, no calculator.",
  });
  await t1.patch(`/api/assignments/${closed.id}`, {
    classroom_id: maths.id, title: closed.title, instructions: closed.instructions, due_at: closed.due_at,
    max_points: closed.max_points, grading_scheme: closed.grading_scheme, status: "closed",
  });
  const lab = await assignment(t1, {
    classroom_id: science.id, title: "Lab report: states of matter", due_at: isoIn(2),
    instructions: "Write up the melting-ice experiment: method, results and conclusion.",
  });
  await assignment(t1, {
    classroom_id: science.id, title: "Label a plant cell",
    instructions: "Label the nucleus, cell wall, chloroplast and vacuole.",
  });
  const poetry = await assignment(t2, {
    classroom_id: english.id, title: "Poetry response", max_points: 25, due_at: isoIn(-1),
    instructions: "Compare how the two poets use imagery. About 400 words.",
  });

  const submit = (student, a, ...paras) =>
    student.api.put(`/api/assignments/${a.id}/submission`, {
      doc_json: doc(...paras), plaintext: paras.join("\n"), change_note: null,
    });
  const fractionSubs = [];
  for (const s of students.slice(0, 6)) {
    fractionSubs.push(await submit(s, fractions, "1. 18/24 = 3/4", "2. 2/3 + 3/4 = 17/12", "3. 5/6 of 42 = 35", "4. 0.375 = 3/8"));
  }
  for (const s of students.slice(0, 3)) await submit(s, algebra, "a) 3(x + 2) = 3x + 6", "b) 2(4 - y) = 8 - 2y");
  for (const s of students.slice(1, 3)) await submit(s, lab, "Method: we heated ice in a beaker.", "Result: it melted at about 0 degrees C.");
  await submit(students[5], poetry, "Both poets use the sea as an image of time passing.");

  const grades = [[18, true, "Clear working throughout."], [15, true, "Check question 2."], [20, true, "Excellent."], [12, false, "Draft feedback, not yet returned."]];
  for (const [i, [points, publish, feedback]] of grades.entries()) {
    await t1.put(`/api/submissions/${fractionSubs[i].id}/grade`, { points, grade_label: null, feedback, publish });
  }
  await t1.post(`/api/submissions/${fractionSubs[1].id}/comments`, { body: "Common denominator for question 2 is 12.", anchor: null });
  const poetrySub = await students[5].api.get(`/api/assignments/${poetry.id}/submission`);
  await t2.put(`/api/submissions/${poetrySub.id}/grade`, { points: 19, grade_label: "B", feedback: "Good comparison; add more quotations.", publish: true });

  console.log("Attendance…");
  const statuses = ["present", "present", "present", "late", "present", "absent", "present", "excused", "present", "present"];
  for (const [d, day] of recentSchoolDays(5).entries()) {
    for (const [i, s] of students.entries()) {
      await t1.put(`/api/classrooms/${maths.id}/attendance/${day}`, {
        student_id: s.id, status: statuses[(i + d * 3) % statuses.length], note: "",
      });
    }
    for (const s of students.slice(0, 6)) {
      await t1.put(`/api/classrooms/${science.id}/attendance/${day}`, { student_id: s.id, status: "present", note: "" });
    }
  }

  console.log("Quizzes…");
  const quiz = await t1.post("/api/quizzes", {
    classroom_id: maths.id, title: "Fractions quiz", time_limit_minutes: 15,
    instructions: "Answer every question. You have 15 minutes.",
    questions: [
      { kind: "single_choice", prompt: "What is 1/2 + 1/4?", options: ["3/4", "2/6", "1/8"], canonical_answer: "3/4", max_points: 1, required: true },
      { kind: "true_false", prompt: "6/8 is equivalent to 3/4.", options: [], canonical_answer: true, max_points: 1, required: true },
      { kind: "single_choice", prompt: "Which is largest?", options: ["2/3", "3/5", "5/8"], canonical_answer: "2/3", max_points: 1, required: true },
      { kind: "short_answer", prompt: "Explain how you would compare 3/7 and 4/9.", options: [], canonical_answer: "", max_points: 2, required: true },
    ],
  });
  await t1.post(`/api/quizzes/${quiz.id}/publish`);
  const delivery = await t1.post(`/api/quizzes/${quiz.id}/deliver`, { kind: "homework", opens_at: null, due_at: isoIn(3) });
  const answers = [["3/4", true, "2/3", "Use a common denominator of 63."], ["3/4", false, "5/8", "Change both to decimals."], ["2/6", true, "2/3", "Cross multiply."]];
  for (const [i, set] of answers.entries()) {
    const attempt = await students[i].api.post(`/api/quiz-deliveries/${delivery.id}/start`);
    for (const [q, question] of attempt.questions.entries()) {
      await students[i].api.put(`/api/quiz-attempts/${attempt.id}/responses/${question.id}`, { answer: set[q] });
    }
    await students[i].api.post(`/api/quiz-attempts/${attempt.id}/submit`);
    if (i < 2) {
      const written = attempt.questions.find((q) => q.kind === "short_answer");
      await t1.put(`/api/quiz-attempts/${attempt.id}/responses/${written.id}/grade`, { points: 2 - i, feedback: "" });
    }
  }
  await t1.post("/api/quizzes", {
    classroom_id: science.id, title: "Science starter", time_limit_minutes: null,
    instructions: "Draft quiz, not yet published.",
    questions: [{ kind: "true_false", prompt: "Water boils at 100 degrees C at sea level.", options: [], canonical_answer: true, max_points: 1, required: true }],
  });

  console.log("Live session…");
  const live = await t1.post("/api/live-sessions", {
    classroom_id: maths.id, module_id: "classroom.live", module_name: "Live Classroom", duration_minutes: 30,
  });
  for (const s of students.slice(0, 4)) await s.api.post("/api/live-sessions/join", { code: live.join_code });
  const task = await t1.post(`/api/live-sessions/${live.id}/task`, {
    kind: "instruction", target_id: null, title: "Warm-up", instructions: "Simplify 12/16 in your notebook.",
  });
  for (const s of students.slice(0, 3)) {
    await s.api.post(`/api/live-sessions/${live.id}/task-ack`, { revision: task.revision, state: "completed" });
  }
  await t1.post(`/api/live-sessions/${live.id}/end`);
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir) fail("usage: node scripts/seed-test-data.mjs <empty-data-folder>");
  const target = path.resolve(dataDir);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    fail(`${target} is not empty. Choose a new folder; this script never deletes data.`);
  }
  fs.mkdirSync(target, { recursive: true });

  const exe = hostBinary();
  const { child, port, pin, log } = await startHost(exe, target);
  const certDer = fs.readFileSync(path.join(target, "tls", "host-tls-cert.der"));
  const client = makeClient(port, certDer);
  try {
    await seed(client, pin);
  } catch (error) {
    console.error(`Host log (last lines):\n${log().split("\n").slice(-15).join("\n")}`);
    throw error;
  } finally {
    client.close();
    child.kill();
  }
  const fingerprint = createHash("sha256").update(certDer).digest("hex");
  console.log(`\nSeeded ${SCHOOL_NAME} into ${target}`);
  console.log(`Host certificate SHA-256: ${fingerprint}`);
  console.log("Next: open Cinder Host, choose this folder as the school-data folder and finish setup.");
}

main().catch((error) => fail(error.stack ?? String(error)));
