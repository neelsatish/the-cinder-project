export type Role = "student" | "teacher";

export type User = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  grade_level: string | null;
  section: string | null;
  roll_number: string | null;
  must_change_password: boolean;
  created_at: string;
};

export type LoginResponse = {
  token: string;
  user: User;
  expires_at: string;
};

export type Classroom = {
  id: string;
  name: string;
  subject_code: string | null;
  description: string;
  color: string;
  owner_teacher_id: string;
  owner_teacher_name: string;
  enrolment_code: string;
  student_count: number;
  created_at: string;
};

export type ClassroomTeachers = {
  owner: User;
  co_teachers: User[];
};

export type TeacherInvitePin = {
  invite_pin: string;
  expires_at: string;
};

export type ClassroomRoster = {
  classroom: Classroom;
  students: User[];
};

export type AssignmentStatus = "draft" | "published" | "closed";

export type Assignment = {
  id: string;
  classroom_id: string;
  classroom_name: string;
  title: string;
  instructions: string;
  due_at: string | null;
  max_points: number;
  grading_scheme: unknown;
  status: AssignmentStatus;
  created_at: string;
  updated_at: string;
};

export type SubmissionVersion = {
  id: string;
  version_number: number;
  doc_json: Record<string, unknown>;
  plaintext: string;
  change_note: string | null;
  late: boolean;
  created_at: string;
};

export type Grade = {
  id: string;
  points: number | null;
  grade_label: string | null;
  feedback: string;
  published: boolean;
  updated_at: string;
};

export type Submission = {
  id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  status: "draft" | "submitted" | "resubmitted" | "graded" | "withdrawn";
  version: SubmissionVersion | null;
  grade: Grade | null;
  submitted_at: string | null;
  updated_at: string;
};

export type SubmissionComment = {
  id: string;
  author_name: string;
  body: string;
  anchor: unknown | null;
  created_at: string;
};

export type GradeChange = {
  id: string;
  previous: unknown;
  current: unknown;
  changed_at: string;
};

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type AttendanceRecord = {
  student_id: string;
  student_name: string;
  status: AttendanceStatus | null;
  note: string;
  checked_in: boolean;
};

export type AttendanceDay = {
  classroom_id: string;
  day: string;
  records: AttendanceRecord[];
};

export type LiveSession = {
  id: string;
  classroom_id: string;
  classroom_name: string;
  module_id: string;
  module_name: string;
  duration_minutes: number;
  join_code: string;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
};

export type LiveSessionResult = {
  score: number;
  elapsed_seconds: number;
  submitted_at: string;
};

export type LiveSessionParticipant = {
  student_id: string;
  student_name: string;
  joined_at: string;
  result: LiveSessionResult | null;
};

export type LiveSessionDetails = {
  session: LiveSession;
  participants: LiveSessionParticipant[];
};

export type DashboardStats = {
  students: number;
  classrooms: number;
  pending_submissions: number;
  ungraded_submissions: number;
  present_today: number;
};

export type NodeKind = "folder" | "note" | "pdf" | "deck";

export type StudyNode = {
  id: string;
  owner_id: string | null;
  parent_id: string | null;
  classroom_id: string | null;
  name: string;
  kind: NodeKind;
  position: number;
  icon: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteBody = {
  doc_json: Record<string, unknown>;
  plaintext: string;
  updated_at: string;
};

export type AiSettings = {
  base_url?: string;
  model: string;
  has_key: boolean;
  reachable: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GradebookSuggestion = {
  student_id: string;
  assignment_id: string;
  points: number;
};

export type Card = {
  id: string;
  deck_node_id: string;
  front: string;
  back: string;
  source_node_id: string | null;
  source_excerpt: string | null;
  generated_by: "manual" | "ai";
};
