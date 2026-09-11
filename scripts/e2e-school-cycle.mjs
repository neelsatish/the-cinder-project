import assert from "node:assert/strict";

const [baseUrl, setupPin] = process.argv.slice(2);
if (!baseUrl || !/^\d{8}$/.test(setupPin ?? "")) {
  throw new Error("Usage: node scripts/e2e-school-cycle.mjs <host-url> <8-digit-setup-pin>");
}

async function request(path, { token, method = "GET", body } = {}) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined && !(body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const value = response.status === 204
    ? undefined
    : (response.headers.get("content-type") ?? "").includes("application/json")
      ? await response.json()
      : await response.arrayBuffer();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

const suffix = Date.now().toString(36);
const teacherUsername = `teacher.${suffix}`;
const studentUsername = `student.${suffix}`;
const teacherPassword = "Teacher-Test-2036!";
const studentPassword = "Student-Test-2036!";

assert.equal((await request("/api/health")).ok, true);
await request("/api/auth/bootstrap", {
  method: "POST",
  body: {
    username: teacherUsername,
    display_name: "Cycle Teacher",
    password: teacherPassword,
    bootstrap_pin: setupPin,
  },
});
const teacherLogin = await request("/api/auth/login", {
  method: "POST",
  body: {
    username: teacherUsername,
    password: teacherPassword,
    expected_role: "teacher",
    device_label: "E2E Teacher",
  },
});
const teacherToken = teacherLogin.token;

const classroom = await request("/api/classrooms", {
  token: teacherToken,
  method: "POST",
  body: { name: "Cycle Science", subject_code: "SCI", description: "End-to-end class", color: "#E86A20" },
});
const secondClassroom = await request("/api/classrooms", {
  token: teacherToken,
  method: "POST",
  body: { name: "Cycle Writing", subject_code: "ENG", description: "Code join check", color: "#2680A8" },
});
const studentAccount = await request("/api/teacher/users", {
  token: teacherToken,
  method: "POST",
  body: {
    classroom_id: classroom.id,
    username: studentUsername,
    display_name: "Cycle Student",
    grade_level: "8",
    section: "A",
    roll_number: "E2E-1",
  },
});

const form = new FormData();
form.append("file", new Blob(["%PDF-1.4\n% Cinder end-to-end reference\n%%EOF\n"], { type: "application/pdf" }), "cycle-reference.pdf");
const material = await request(`/api/files?shared=true&classroom_id=${classroom.id}`, {
  token: teacherToken,
  method: "POST",
  body: form,
});

const assignment = await request("/api/assignments", {
  token: teacherToken,
  method: "POST",
  body: {
    classroom_id: classroom.id,
    title: "Cycle notes",
    instructions: "Submit the saved note.",
    due_at: null,
    max_points: 20,
    grading_scheme: {},
    publish: true,
  },
});
const studentLogin = await request("/api/auth/login", {
  method: "POST",
  body: {
    username: studentUsername,
    password: studentAccount.temporary_password,
    expected_role: "student",
    device_label: "E2E Student",
  },
});
let studentToken = studentLogin.token;
await request("/api/auth/change-password", {
  token: studentToken,
  method: "POST",
  body: { current_password: studentAccount.temporary_password, new_password: studentPassword },
});
const joinedClassroom = await request("/api/classrooms/join", {
  token: studentToken,
  method: "POST",
  body: { code: secondClassroom.enrolment_code },
});
assert.equal(joinedClassroom.id, secondClassroom.id);

const studentClassrooms = await request("/api/classrooms", { token: studentToken });
assert.equal(studentClassrooms.some((item) => item.id === classroom.id), true);
assert.equal(studentClassrooms.some((item) => item.id === secondClassroom.id), true);
const assignments = await request("/api/assignments", { token: studentToken });
assert.equal(assignments.some((item) => item.id === assignment.id), true);
const tree = await request("/api/tree", { token: studentToken });
assert.equal(tree.nodes.some((item) => item.id === material.id), true);
const materialBytes = await request(`/api/files/${material.id}`, { token: studentToken });
assert.equal(materialBytes.byteLength > 0, true);

const submission = await request(`/api/assignments/${assignment.id}/submission`, {
  token: studentToken,
  method: "PUT",
  body: {
    doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Cycle answer" }] }] },
    plaintext: "Cycle answer",
    change_note: "Submitted from E2E note",
  },
});
const teacherSubmissions = await request(`/api/assignments/${assignment.id}/submissions`, { token: teacherToken });
assert.equal(teacherSubmissions.some((item) => item.id === submission.id), true);
await request(`/api/submissions/${submission.id}/grade`, {
  token: teacherToken,
  method: "PUT",
  body: { points: 18, grade_label: "Excellent", feedback: "Clear work.", publish: true },
});
const studentSubmission = await request(`/api/assignments/${assignment.id}/submission`, { token: studentToken });
assert.equal(studentSubmission.grade.published, true);
assert.equal(studentSubmission.grade.points, 18);

console.log(JSON.stringify({
  ok: true,
  classroom: classroom.name,
  stableCodeJoin: secondClassroom.name,
  material: material.name,
  assignment: assignment.title,
  grade: studentSubmission.grade.points,
}, null, 2));
