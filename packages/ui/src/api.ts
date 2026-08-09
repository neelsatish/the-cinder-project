import type {
  AiSettings,
  Assignment,
  AttendanceDay,
  AttendanceStatus,
  ChatMessage,
  Card,
  Classroom,
  ClassroomRoster,
  DashboardStats,
  Grade,
  GradeChange,
  LoginResponse,
  NoteBody,
  Role,
  StudyNode,
  Submission,
  SubmissionComment,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get offline() {
    return this.status === 0;
  }
}

export class CinderApi {
  private token: string | null;

  constructor(
    private readonly baseUrl: string,
    token: string | null = null,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = 10_000,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (
      init.body &&
      !(init.body instanceof FormData) &&
      !headers.has("Content-Type")
    )
      headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        controller.signal.aborted ? "timeout" : "offline",
        controller.signal.aborted
          ? "The teacher computer did not respond in time."
          : "The teacher computer is currently unreachable.",
        0,
      );
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      throw new ApiError(
        body?.error ?? "request_failed",
        body?.message ?? `Request failed (${response.status})`,
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health() {
    return this.request<{ ok: boolean; version: string }>("/api/health");
  }

  authStatus() {
    return this.request<{ needs_setup: boolean }>(
      "/api/auth/status",
      {},
      2_000,
    );
  }

  login(
    username: string,
    password: string,
    expectedRole: Role,
    deviceLabel?: string | null,
  ) {
    return this.request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        expected_role: expectedRole,
        device_label: deviceLabel || null,
      }),
    });
  }

  me() {
    return this.request<User>("/api/me", {}, 4_000);
  }

  logout() {
    return this.request<{ ok: true }>("/api/auth/logout", { method: "POST" });
  }

  bootstrapTeacher(username: string, displayName: string, password: string) {
    return this.request<{ user: User; recovery_code: string }>(
      "/api/auth/bootstrap",
      {
        method: "POST",
        body: JSON.stringify({ username, display_name: displayName, password }),
      },
    );
  }

  recoverTeacher(username: string, recoveryCode: string, newPassword: string) {
    return this.request<{ user: User; recovery_code: string }>(
      "/api/auth/recover",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          recovery_code: recoveryCode,
          new_password: newPassword,
        }),
      },
    );
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.request<User>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  students() {
    return this.request<User[]>("/api/teacher/users");
  }

  createStudent(input: {
    username: string;
    display_name: string;
    grade_level?: string | null;
    section?: string | null;
    roll_number?: string | null;
  }) {
    return this.request<{
      user: User;
      temporary_password: string;
      recovery_code: string;
    }>("/api/teacher/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  resetStudentCredentials(studentId: string) {
    return this.request<{
      user: User;
      temporary_password: string;
      recovery_code: string;
    }>(`/api/teacher/users/${studentId}/reset-credentials`, { method: "POST" });
  }

  updateStudent(
    studentId: string,
    input: {
      username: string;
      display_name: string;
      grade_level?: string | null;
      section?: string | null;
      roll_number?: string | null;
    },
  ) {
    return this.request<User>(`/api/teacher/users/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteStudent(studentId: string) {
    return this.request<{ ok: true }>(`/api/teacher/users/${studentId}`, {
      method: "DELETE",
    });
  }

  recoverStudent(username: string, recoveryCode: string, newPassword: string) {
    return this.request<{ user: User; recovery_code: string }>(
      "/api/auth/student-recover",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          recovery_code: recoveryCode,
          new_password: newPassword,
        }),
      },
    );
  }

  classrooms() {
    return this.request<Classroom[]>("/api/classrooms");
  }

  createClassroom(input: {
    name: string;
    subject_code?: string | null;
    description: string;
    color: string;
  }) {
    return this.request<Classroom>("/api/classrooms", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateClassroom(
    id: string,
    input: {
      name: string;
      subject_code?: string | null;
      description: string;
      color: string;
    },
  ) {
    return this.request<Classroom>(`/api/classrooms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteClassroom(id: string) {
    return this.request<{ ok: true }>(`/api/classrooms/${id}`, {
      method: "DELETE",
    });
  }

  classroomRoster(id: string) {
    return this.request<ClassroomRoster>(`/api/classrooms/${id}`);
  }

  enrolStudent(classroomId: string, studentId: string) {
    return this.request<{ ok: true }>(
      `/api/classrooms/${classroomId}/students`,
      {
        method: "POST",
        body: JSON.stringify({ student_id: studentId }),
      },
    );
  }

  removeStudent(classroomId: string, studentId: string) {
    return this.request<{ ok: true }>(
      `/api/classrooms/${classroomId}/students/${studentId}`,
      { method: "DELETE" },
    );
  }

  assignments(classroomId?: string) {
    const query = classroomId
      ? `?classroom_id=${encodeURIComponent(classroomId)}`
      : "";
    return this.request<Assignment[]>(`/api/assignments${query}`);
  }

  createAssignment(input: {
    classroom_id: string;
    title: string;
    instructions: string;
    due_at: string | null;
    max_points: number;
    grading_scheme: unknown;
    publish: boolean;
  }) {
    return this.request<Assignment>("/api/assignments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateAssignment(
    id: string,
    input: {
      classroom_id: string;
      title: string;
      instructions: string;
      due_at: string | null;
      max_points: number;
      grading_scheme: unknown;
      status: Assignment["status"];
    },
  ) {
    return this.request<Assignment>(`/api/assignments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteAssignment(id: string) {
    return this.request<{ ok: true }>(`/api/assignments/${id}`, {
      method: "DELETE",
    });
  }

  submissions(assignmentId: string) {
    return this.request<Submission[]>(
      `/api/assignments/${assignmentId}/submissions`,
    );
  }

  mySubmission(assignmentId: string) {
    return this.request<Submission | null>(
      `/api/assignments/${assignmentId}/submission`,
    );
  }

  submitWork(
    assignmentId: string,
    docJson: Record<string, unknown>,
    plaintext: string,
    changeNote?: string,
  ) {
    return this.request<Submission>(
      `/api/assignments/${assignmentId}/submission`,
      {
        method: "PUT",
        body: JSON.stringify({
          doc_json: docJson,
          plaintext,
          change_note: changeNote || null,
        }),
      },
    );
  }

  withdrawWork(assignmentId: string) {
    return this.request<{ ok: true }>(
      `/api/assignments/${assignmentId}/submission`,
      {
        method: "DELETE",
      },
    );
  }

  saveGrade(
    submissionId: string,
    input: {
      points: number | null;
      grade_label: string | null;
      feedback: string;
      publish: boolean;
    },
  ) {
    return this.request<Grade>(`/api/submissions/${submissionId}/grade`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  comments(submissionId: string) {
    return this.request<SubmissionComment[]>(
      `/api/submissions/${submissionId}/comments`,
    );
  }

  addComment(submissionId: string, body: string, anchor: unknown = null) {
    return this.request<SubmissionComment>(
      `/api/submissions/${submissionId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body, anchor }),
      },
    );
  }

  gradeHistory(submissionId: string) {
    return this.request<GradeChange[]>(
      `/api/submissions/${submissionId}/grade-history`,
    );
  }

  attendance(day: string) {
    return this.request<AttendanceDay>(`/api/attendance/${day}`);
  }

  saveAttendance(
    day: string,
    studentId: string,
    status: AttendanceStatus,
    note = "",
  ) {
    return this.request<AttendanceDay["records"][number]>(
      `/api/attendance/${day}`,
      {
        method: "PUT",
        body: JSON.stringify({ student_id: studentId, status, note }),
      },
    );
  }

  dashboard() {
    return this.request<DashboardStats>("/api/teacher/dashboard");
  }

  tree() {
    return this.request<{ nodes: StudyNode[] }>("/api/tree");
  }

  createNode(input: {
    parent_id: string | null;
    classroom_id: string | null;
    name: string;
    kind: "folder" | "note" | "deck";
    icon?: string | null;
  }) {
    return this.request<StudyNode>("/api/nodes", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateNode(
    id: string,
    input: {
      name?: string;
      parent_id?: string | null;
      position?: number;
      icon?: string;
    },
  ) {
    return this.request<StudyNode>(`/api/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteNode(id: string) {
    return this.request<{ ok: true }>(`/api/nodes/${id}`, { method: "DELETE" });
  }

  uploadMaterial(classroomId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return this.request<StudyNode>(
      `/api/files?shared=true&classroom_id=${encodeURIComponent(classroomId)}`,
      { method: "POST", body: form },
      60_000,
    );
  }

  async materialBlob(id: string) {
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/files/${id}`, {
        headers,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        controller.signal.aborted ? "timeout" : "offline",
        controller.signal.aborted
          ? "The material download timed out."
          : "The teacher computer is currently unreachable.",
        0,
      );
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok)
      throw new ApiError(
        "request_failed",
        "The material could not be opened.",
        response.status,
      );
    return response.blob();
  }

  note(id: string) {
    return this.request<NoteBody>(`/api/notes/${id}`);
  }

  saveNote(
    id: string,
    docJson: Record<string, unknown>,
    plaintext: string,
    baseUpdatedAt: string | null,
  ) {
    return this.request<NoteBody>(`/api/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        doc_json: docJson,
        plaintext,
        base_updated_at: baseUpdatedAt,
      }),
    });
  }

  aiSettings() {
    return this.request<AiSettings>("/api/ai/settings");
  }

  saveAiSettings(input: {
    base_url?: string;
    model: string;
    api_key?: string;
  }) {
    return this.request<AiSettings>("/api/ai/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  chat(messages: ChatMessage[], context?: string) {
    return this.request<{ content: string }>(
      "/api/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ messages, context }),
      },
      190_000,
    );
  }

  cards(deckId: string) {
    return this.request<Card[]>(`/api/decks/${deckId}/cards`);
  }

  createCard(deckId: string, front: string, back: string) {
    return this.request<Card>(`/api/decks/${deckId}/cards`, {
      method: "POST",
      body: JSON.stringify({
        front,
        back,
        source_node_id: null,
        source_excerpt: null,
      }),
    });
  }

  deleteCard(cardId: string) {
    return this.request<{ ok: true }>(`/api/cards/${cardId}`, {
      method: "DELETE",
    });
  }
}

export async function probeHost(baseUrl: string, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
